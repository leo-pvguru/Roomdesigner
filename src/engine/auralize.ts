/**
 * Phase C — auralization. Synthesizes a stereo room impulse response (IR)
 * from the same acoustic model that drives the heatmaps:
 *
 *   • Direct sound + early reflections from the ISM image sources — exact
 *     arrival times (unfolded path length / c) and per-band levels (speaker
 *     directivity, 1/r, air absorption, per-surface reflection loss).
 *   • Late tail: per-octave-band exponentially-decaying noise whose decay
 *     rate is the room's Eyring RT60 for that band, energy-matched to the
 *     early reflections at the seam (the classic hybrid-IR construction).
 *   • Stereo: each tap is panned by its TRUE arrival azimuth (the ISM image
 *     direction) via ITD + frequency-dependent ILD; the tail uses
 *     decorrelated left/right noise — which is what produces the sense of
 *     envelopment in a reverberant room.
 *
 * Everything here is plain numeric TypeScript — no Web Audio — so the
 * engine QA suite can run it under Node and assert the physics (decay
 * slope per band, direct-tap timing, treated vs untreated energy).
 * Convolution with dry program material happens UI-side (AuralizePanel)
 * with a ConvolverNode.
 */
import type { EquipmentItem, RoomState, Zone, SpeakerGroup, OctaveBand } from '../types';
import { OCTAVE_BANDS } from '../types';
import {
  buildRoomSurfaces, generateImageSources, audiblePath, imageAsEquipmentItem,
} from './ism';
import type { Vec3 } from './ism';
import {
  rt60, getActiveSpeakers, applyGroupSettings, speakerSPL,
  bandResponseAttenuation, airCoeffsPerBand,
} from './acoustics';

export const SPEED_OF_SOUND_FT_S = 1125;

// ---------------------------------------------------------------------------
// Deterministic RNG — auralization must be reproducible for QA
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// RBJ biquad bandpass (constant 0 dB peak gain), cascaded for octave skirts
// ---------------------------------------------------------------------------

function biquadBandpassInPlace(buf: Float32Array, sampleRate: number, f0: number, Q: number) {
  const w = 2 * Math.PI * Math.min(f0, sampleRate * 0.45) / sampleRate;
  const alpha = Math.sin(w) / (2 * Q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    buf[i] = y;
  }
}

/** Octave-band bandpass: two cascaded RBJ bandpasses at f0, Q = √2. */
export function octaveBandpassInPlace(buf: Float32Array, sampleRate: number, f0: number) {
  biquadBandpassInPlace(buf, sampleRate, f0, Math.SQRT2);
  biquadBandpassInPlace(buf, sampleRate, f0, Math.SQRT2);
}

// ---------------------------------------------------------------------------
// Schroeder backward integration — used by QA to verify the decay slope
// ---------------------------------------------------------------------------

/**
 * T30 from Schroeder backward integration: fit the -5..-35 dB span of the
 * decay curve and extrapolate to 60 dB. `skipSec` skips the direct sound so
 * the fit starts in the reverberant decay.
 */
export function schroederT30(buf: Float32Array, sampleRate: number, skipSec = 0.05): number | null {
  const n = buf.length;
  if (n < sampleRate * 0.2) return null;
  // Backward energy integral
  const edc = new Float64Array(n);
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) { acc += buf[i] * buf[i]; edc[i] = acc; }
  const total = edc[0] || 1e-30;
  const start = Math.min(n - 1, Math.floor(skipSec * sampleRate));
  const ref = edc[start] || 1e-30;
  // Find the -5 dB and -35 dB crossing times (relative to the post-skip energy)
  let t5 = -1, t35 = -1;
  for (let i = start; i < n; i++) {
    const db = 10 * Math.log10((edc[i] || 1e-30) / ref);
    if (t5 < 0 && db <= -5) t5 = i / sampleRate;
    if (t35 < 0 && db <= -35) { t35 = i / sampleRate; break; }
  }
  void total;
  if (t5 < 0 || t35 < 0 || t35 <= t5) return null;
  return (t35 - t5) * 2;   // 30 dB span → ×2 = 60 dB
}

// ---------------------------------------------------------------------------
// IR synthesis
// ---------------------------------------------------------------------------

export interface AuralizeOptions {
  room: RoomState;
  equipment: EquipmentItem[];
  zones: Zone[];
  groups: SpeakerGroup[];
  /** Listener position in room feet. Defaults to the room centroid at
   *  seated ear height (4 ft). */
  listener?: Vec3;
  sampleRate?: number;       // default 44100
  maxOrder?: number;         // ISM reflection order for the early part, default 3
  /** false = strip acoustic treatment (panels, traps, diffusers, rugs) for
   *  the "before treatment" A/B variant. */
  includeTreatment?: boolean;
  seed?: number;
}

export interface AuralizeResult {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  /** Per-band Eyring RT60 used for the tail. */
  t60ByBand: Record<OctaveBand, number>;
  t60Avg: number;
  /** Arrival time of the direct sound in seconds. */
  directDelaySec: number;
  /** Number of audible image-source taps placed (all speakers, all orders). */
  tapCount: number;
  lengthSec: number;
  /** True when the room is open-air (sentinel RT60) — tail omitted. */
  outdoor: boolean;
  listener: Vec3;
}

export function defaultListener(room: RoomState): Vec3 {
  let sx = 0, sy = 0;
  for (const p of room.shape) { sx += p.x; sy += p.y; }
  const n = Math.max(1, room.shape.length);
  return { x: sx / n, y: sy / n, z: 4 };
}

interface Tap {
  tSec: number;
  /** Linear amplitude per octave band. */
  amp: number[];
  /** Arrival azimuth relative to the listener's facing, radians, CCW
   *  positive (positive = from the listener's left). */
  relAz: number;
  order: number;
}

const TREATMENT_KINDS = new Set(['acoustic-panel', 'bass-trap', 'diffuser', 'rug']);

export function synthesizeIR(opts: AuralizeOptions): AuralizeResult | null {
  const {
    room, zones, groups,
    sampleRate = 44100,
    maxOrder = 3,
    includeTreatment = true,
    seed = 1234,
  } = opts;
  if (!room.shape || room.shape.length < 3) return null;

  const equipment = includeTreatment
    ? opts.equipment
    : opts.equipment.filter(e => !TREATMENT_KINDS.has(e.kind));

  const listener = opts.listener ?? defaultListener(room);

  // ===== Sources =====
  let speakers = getActiveSpeakers(
    equipment.filter(e => e.category === 'audio-speaker').map(s => applyGroupSettings(s, groups)),
  ).filter(s => s.kind !== 'speaker-iem');
  // No PA placed yet? Use a virtual omni voice source at the stage so the
  // room itself can still be auditioned.
  if (speakers.length === 0) {
    const bbMinY = Math.min(...room.shape.map(p => p.y));
    const cx = room.shape.reduce((a, p) => a + p.x, 0) / room.shape.length;
    speakers = [{
      id: '__virtual-voice__', templateId: '__virtual__', kind: 'speaker-point',
      category: 'audio-speaker', label: 'Voice (virtual)',
      x: cx, y: bbMinY + (room.stage?.depth ?? 8) * 0.5, z: (room.stage?.height ?? 0) + 5,
      rotation: 90, aim: 90, tilt: 0, horiz: 360, vert: 360, maxSPL: 110, drive: 100,
    } as EquipmentItem];
  }

  // ===== Reverb time (drives the tail) =====
  const panels = equipment.filter(e => e.category === 'acoustic');
  const rt = rt60(room, panels, zones, equipment, true /* Eyring */);
  // Outdoor = declared open-air venue OR degenerate-volume sentinel from the
  // engine. Either way: no reverberant field, and no walls/ceiling to bounce
  // off — only the ground reflection survives.
  const outdoor = room.roomType === 'outdoor' || rt.average >= 90;
  const t60ByBand = rt.byBand;

  // ===== Early reflections from the ISM =====
  const surfaces = outdoor
    ? buildRoomSurfaces(room).filter(s => s.kind === 'floor')
    : buildRoomSurfaces(room);
  const airCoeffs = airCoeffsPerBand(room.temperatureF ?? 70, room.relHumidity ?? 50);

  // Listener faces the acoustic centroid of the sources (i.e., the stage).
  const fx = speakers.reduce((a, s) => a + s.x, 0) / speakers.length - listener.x;
  const fy = speakers.reduce((a, s) => a + s.y, 0) / speakers.length - listener.y;
  const facing = Math.atan2(fy, fx);

  const taps: Tap[] = [];
  let directDelaySec = Infinity;
  const IMAGE_CAP = 6000;
  let imagesProcessed = 0;

  for (const sp of speakers) {
    const images = generateImageSources(sp, surfaces, maxOrder);
    for (const img of images) {
      if (imagesProcessed++ > IMAGE_CAP) break;
      const path = audiblePath(img, listener);
      if (!path) continue;
      const tSec = (path.totalDistFt * 0.3048) / (SPEED_OF_SOUND_FT_S * 0.3048)
        + (sp.delayMs ?? 0) / 1000;
      // Base level via the production SPL model at 1 kHz (distance,
      // directivity, drive, crossovers, obstruction-free), then per-band
      // corrections for speaker response, air absorption, and the chain's
      // per-surface reflection loss.
      const apparent = imageAsEquipmentItem(sp, img);
      const base1k = speakerSPL(apparent, listener, '1k', [], airCoeffs);
      if (!isFinite(base1k)) continue;
      const dM = Math.max(0.5, path.totalDistFt * 0.3048);
      const resp1k = bandResponseAttenuation(sp, 1000);
      const amp: number[] = [];
      for (const b of OCTAVE_BANDS) {
        const dB = base1k
          - (bandResponseAttenuation(sp, b) - resp1k)
          - dM * ((airCoeffs[b] ?? 0) - (airCoeffs[1000] ?? 0))
          - img.reflectionLossDb[b];
        amp.push(Math.pow(10, dB / 20));
      }
      // TRUE arrival direction: straight line from listener to the image.
      const az = Math.atan2(img.position.y - listener.y, img.position.x - listener.x);
      let relAz = az - facing;
      while (relAz > Math.PI) relAz -= 2 * Math.PI;
      while (relAz < -Math.PI) relAz += 2 * Math.PI;
      taps.push({ tSec, amp, relAz, order: img.order });
      if (img.order === 0 && tSec < directDelaySec) directDelaySec = tSec;
    }
  }
  if (taps.length === 0) return null;
  if (!isFinite(directDelaySec)) directDelaySec = Math.min(...taps.map(t => t.tSec));

  // ===== Buffer sizing =====
  const t60Max = outdoor ? 0 : Math.min(8, Math.max(...OCTAVE_BANDS.map(b => t60ByBand[b] ?? 0.5)));
  const lengthSec = Math.min(10, directDelaySec + 0.05 + (outdoor ? 0.4 : t60Max * 1.1 + 0.15));
  const N = Math.ceil(lengthSec * sampleRate);
  const left = new Float32Array(N);
  const right = new Float32Array(N);

  const tMix = directDelaySec + 0.08;   // hand over to the stochastic tail 80 ms after direct
  const rng = mulberry32(seed);

  // Per-band assembly
  const trackL = new Float32Array(N);
  const trackR = new Float32Array(N);
  for (let bi = 0; bi < OCTAVE_BANDS.length; bi++) {
    const band = OCTAVE_BANDS[bi];
    trackL.fill(0);
    trackR.fill(0);

    // --- Early taps with ITD + ILD panning ---
    let seamEnergy = 0;          // tap energy density near the seam (per sample)
    let seamCount = 0;
    for (const tap of taps) {
      const a = tap.amp[bi];
      if (!(a > 0)) continue;
      // ILD grows with frequency; ITD capped at ±0.33 ms per ear.
      const s = Math.sin(tap.relAz);
      const ildDb = s * (band >= 2000 ? 4 : band >= 500 ? 2.5 : 1);
      const itd = 0.00066 * s;
      const aL = a * Math.pow(10, +ildDb / 40);
      const aR = a * Math.pow(10, -ildDb / 40);
      placeTap(trackL, sampleRate, tap.tSec - itd / 2, aL);
      placeTap(trackR, sampleRate, tap.tSec + itd / 2, aR);
      if (Math.abs(tap.tSec - tMix) < 0.03) { seamEnergy += a * a; seamCount++; }
    }

    // --- Late tail: decorrelated exponential noise at the band's RT60 ---
    if (!outdoor) {
      const t60 = Math.min(8, Math.max(0.1, t60ByBand[band] ?? 0.5));
      // Seam amplitude: continue the early-reflection energy envelope. When
      // the 60 ms seam window held taps, use their measured energy density;
      // otherwise fall back to direct-level decayed to the seam time.
      let A: number;
      if (seamCount > 0) {
        A = Math.sqrt(seamEnergy / (0.06 * sampleRate));
      } else {
        const direct = taps.find(t => t.order === 0);
        const dAmp = direct ? direct.amp[bi] : 1;
        A = dAmp * Math.pow(10, -(60 * (tMix - directDelaySec) / t60 + 11) / 20);
      }
      const startI = Math.max(0, Math.floor(tMix * sampleRate));
      const k = -3 / t60;            // amplitude decay: 10^(-3 t / T60)
      for (let i = startI; i < N; i++) {
        const t = i / sampleRate - tMix;
        const env = A * Math.pow(10, k * t);
        trackL[i] += (rng() * 2 - 1) * env;
        trackR[i] += (rng() * 2 - 1) * env;
      }
    }

    octaveBandpassInPlace(trackL, sampleRate, band);
    octaveBandpassInPlace(trackR, sampleRate, band);
    for (let i = 0; i < N; i++) { left[i] += trackL[i]; right[i] += trackR[i]; }
  }

  // ===== Normalize to a sane convolver level =====
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const a = Math.abs(left[i]); if (a > peak) peak = a;
    const b = Math.abs(right[i]); if (b > peak) peak = b;
  }
  if (peak > 0) {
    const g = 0.5 / peak;
    for (let i = 0; i < N; i++) { left[i] *= g; right[i] *= g; }
  }

  return {
    sampleRate, left, right,
    t60ByBand, t60Avg: rt.average,
    directDelaySec, tapCount: taps.length, lengthSec, outdoor, listener,
  };
}

/** Place a tap with linear fractional-delay interpolation. */
function placeTap(buf: Float32Array, sampleRate: number, tSec: number, amp: number) {
  const x = tSec * sampleRate;
  const i = Math.floor(x);
  if (i < 0 || i >= buf.length) return;
  const frac = x - i;
  buf[i] += amp * (1 - frac);
  if (i + 1 < buf.length) buf[i + 1] += amp * frac;
}

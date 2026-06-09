// =====================================================================
// Stochastic ray tracing for the late reverberant tail
// ---------------------------------------------------------------------
// SPRINT 3 SCOPE
//
// This module casts thousands of rays from each loudspeaker, bounces them
// around the room geometry tracking per-octave-band energy, and accumulates
// arrival-time histograms at a single audience reference point. From those
// histograms it derives:
//
//   • The energy decay curve (EDC) via Schroeder backwards integration
//   • T20, T30, and EDT per octave band from the EDC slope
//
// These values replace Sabine / Eyring as the room's reverberation metric
// when ray tracing is enabled, and feed the IEC 60268-16 STI calculation
// for substantially better intelligibility prediction in non-trivial rooms.
//
// HYBRID MODEL
//
// The simulator already has Image Source Method (ISM) for early specular
// reflections (≤ 50–100 ms) and Sabine/Eyring for global decay. The ray
// tracer adds the LATE STATISTICAL TAIL — the fan of randomized bounces
// that builds the reverberant field after the early reflections die out.
//
// Implementation:
//   • Single audience-reference receiver (room geometric centroid at ear
//     height by default) — gives a globally meaningful T30. Per-cell ray
//     tracing is Sprint 4 work (needs spatial acceleration to be tractable).
//   • Uniform-direction Monte Carlo with per-ray polar-weighted initial
//     energy (no importance sampling — simpler bookkeeping, accept the
//     extra rays in low-response directions).
//   • Per-bounce surface absorption applied as 1 − α(band).
//   • Per-leg air absorption from current room temp/humidity (ANSI S1.26).
//   • "Image-source-on-each-bounce" deposition: at every reflection point,
//     deposit a fraction of the ray's remaining energy at the receiver
//     (weighted by inverse-square distance and a clear-line-of-sight test).
//     The remaining energy continues along the specular reflection path.
// =====================================================================

import {
  OCTAVE_BANDS,
  type OctaveBand,
  type EquipmentItem,
  type RoomState,
  type Point,
  type HeatmapData,
} from '../types';
import {
  buildRoomSurfaces,
  type SurfacePlane,
  type Vec3,
} from './ism';
import {
  speakerSplAt1m,
  airCoeffsPerBand,
  polarAttenuationDb,
  bandResponseAttenuation,
} from './acoustics';
import { polygonArea, bboxOf, pointInPolygon } from '../utils/geometry';

const SPEED_OF_SOUND_M_S = 343;
const SPEED_OF_SOUND_FT_PER_MS = 1.125;
const FT_TO_M = 0.3048;

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

export interface RayTraceOptions {
  /** Number of rays cast PER SPEAKER. 1k = quick preview, 5k = standard,
   *  20k = high quality. Diminishing returns past ~50k for room averages. */
  raysPerSpeaker: number;
  /** Maximum bounces per ray. 30 covers a 3-second tail in a typical
   *  room (T = path / c; 30 bounces × ~30 ft/bounce ≈ 800 ms). */
  maxBounces: number;
  /** Maximum tail length in milliseconds. Histograms are zero past this. */
  maxTimeMs: number;
  /** Time-bin width in milliseconds for the histograms / EDC. 5 ms is
   *  fine enough to localize early reflections accurately. */
  binMs: number;
  /** Energy below this threshold (relative to source) is considered dead
   *  and rays terminate early. -60 dB ≈ ratio 1e-6. */
  energyFloorDb: number;
  /** Receiver capture radius in feet. Each bounce point's contribution
   *  to the receiver is weighted by 1/distance², capped at this radius
   *  so the singularity at distance=0 doesn't blow up. */
  receiverRadiusFt: number;
  /** Reference receiver position in feet. If omitted, the room's
   *  geometric centroid at 5 ft (seated ear height) is used. */
  receiverPos?: Vec3;
  /** Random seed (so successive runs at the same params produce identical
   *  histograms). Defaults to 42. */
  seed?: number;
}

export const RAY_QUALITY_PRESETS = {
  low: {
    raysPerSpeaker: 1000,
    maxBounces: 25,
    binMs: 10,
  },
  medium: {
    raysPerSpeaker: 5000,
    maxBounces: 35,
    binMs: 5,
  },
  high: {
    raysPerSpeaker: 20000,
    maxBounces: 50,
    binMs: 2,
  },
} as const;

export type RayQuality = keyof typeof RAY_QUALITY_PRESETS;

export function defaultRayOptions(quality: RayQuality = 'medium'): RayTraceOptions {
  const preset = RAY_QUALITY_PRESETS[quality];
  return {
    raysPerSpeaker: preset.raysPerSpeaker,
    maxBounces: preset.maxBounces,
    maxTimeMs: 3000,
    binMs: preset.binMs,
    energyFloorDb: -60,
    receiverRadiusFt: 1.5,
    seed: 42,
  };
}

export interface DecayResult {
  /** Per-band time histogram in linear energy units. histograms[band][bin]. */
  histograms: Record<OctaveBand, Float32Array>;
  /** Per-band Schroeder EDC in dB (peak normalized to 0). edcDb[band][bin]. */
  edcDb: Record<OctaveBand, Float32Array>;
  /** Per-band T20 in seconds. NaN when EDC didn't decay enough to measure. */
  t20: Partial<Record<OctaveBand, number>>;
  /** Per-band T30 in seconds. */
  t30: Partial<Record<OctaveBand, number>>;
  /** Per-band Early Decay Time (0 to −10 dB, ×6) in seconds. */
  edt: Partial<Record<OctaveBand, number>>;
  /** Per-band RT60 estimate. Prefers T30 when valid (more robust);
   *  falls back to T20 then EDT when noise dominates. */
  rt60ByBand: Partial<Record<OctaveBand, number>>;
  /** Bin width / count — for any caller that wants to plot the EDC. */
  binMs: number;
  numBins: number;
  /** Reference receiver position used. */
  receiverPos: Vec3;
  /** Number of rays cast in total (across all speakers + bands). */
  rayCount: number;
}

// ---------------------------------------------------------------------
// Geometry + math helpers
// ---------------------------------------------------------------------

/** Mulberry32 — small, fast, seedable PRNG. Good enough for Monte Carlo. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform-on-sphere direction. Standard inverse-CDF method. */
function sampleSphereDirection(rng: () => number): Vec3 {
  const u = rng();
  const v = rng();
  const theta = 2 * Math.PI * u;
  const z = 2 * v - 1;
  const s = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: s * Math.cos(theta), y: s * Math.sin(theta), z };
}

/** Reflect vector d across unit normal n. */
function reflect(d: Vec3, n: Vec3): Vec3 {
  const dot = d.x * n.x + d.y * n.y + d.z * n.z;
  return {
    x: d.x - 2 * dot * n.x,
    y: d.y - 2 * dot * n.y,
    z: d.z - 2 * dot * n.z,
  };
}

/** Orthonormal tangent basis (t1, t2) for a unit normal n. */
function basisFromNormal(n: Vec3): { t1: Vec3; t2: Vec3 } {
  const a: Vec3 = Math.abs(n.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  // t1 = normalize(a × n)
  let t1: Vec3 = { x: a.y * n.z - a.z * n.y, y: a.z * n.x - a.x * n.z, z: a.x * n.y - a.y * n.x };
  const l1 = Math.hypot(t1.x, t1.y, t1.z) || 1;
  t1 = { x: t1.x / l1, y: t1.y / l1, z: t1.z / l1 };
  // t2 = n × t1
  const t2: Vec3 = { x: n.y * t1.z - n.z * t1.y, y: n.z * t1.x - n.x * t1.z, z: n.x * t1.y - n.y * t1.x };
  return { t1, t2 };
}

/** Cosine-weighted (Lambertian) random direction in the hemisphere about n.
 *  z-component along n is √(1−u1) ≥ 0, so the result always points into the
 *  room — no side-flip needed. */
function cosineSample(n: Vec3, rng: () => number): Vec3 {
  const u1 = rng(), u2 = rng();
  const r = Math.sqrt(u1);
  const theta = 2 * Math.PI * u2;
  const x = r * Math.cos(theta);
  const y = r * Math.sin(theta);
  const z = Math.sqrt(Math.max(0, 1 - u1));
  const { t1, t2 } = basisFromNormal(n);
  return {
    x: x * t1.x + y * t2.x + z * n.x,
    y: x * t1.y + y * t2.y + z * n.y,
    z: x * t1.z + y * t2.z + z * n.z,
  };
}

/** Representative broadband scattering scalar for the directional decision —
 *  mid-band weighted (500/1k/2k), the region where scattering matters most. */
function scatterScalar(s: Record<OctaveBand, number>): number {
  return (s[500] + s[1000] + s[2000]) / 3;
}

/**
 * Scatter-aware reflection. With probability = the surface's scattering
 * coefficient the bounce is DIFFUSE (Lambertian about the normal), otherwise
 * SPECULAR. This is the standard scattering-coefficient method (Vorländer):
 * it breaks up coherent flutter between parallel surfaces, smooths the
 * reverberant decay, and produces the diffuse late-field structure a purely
 * specular tracer fundamentally cannot — the #1 fidelity gap vs EASE.
 */
function scatterReflect(d: Vec3, surf: SurfacePlane, rng: () => number): Vec3 {
  const s = scatterScalar(surf.scattering);
  if (s > 0 && rng() < s) return cosineSample(surf.normal, rng);
  return reflect(d, surf.normal);
}

/**
 * Closest non-trivial intersection of a ray (origin, dir) with the room's
 * surface set. Returns null when no surface is hit (e.g. ray points outside
 * a non-closed room). The room's surface set is closed for sane geometry,
 * so misses indicate numerical edge cases.
 */
function nearestSurfaceHit(
  origin: Vec3,
  dir: Vec3,
  surfaces: SurfacePlane[],
): { t: number; surface: SurfacePlane; hit: Vec3 } | null {
  let bestT = Infinity;
  let bestSurface: SurfacePlane | null = null;
  let bestHit: Vec3 | null = null;
  for (const s of surfaces) {
    // Surface normal points INTO the room. A ray traveling outward
    // (toward the surface) has dir·normal < 0. Skip parallel / wrong-way.
    const denom = dir.x * s.normal.x + dir.y * s.normal.y + dir.z * s.normal.z;
    if (denom > -1e-9) continue;
    const t = (
      (s.origin.x - origin.x) * s.normal.x +
      (s.origin.y - origin.y) * s.normal.y +
      (s.origin.z - origin.z) * s.normal.z
    ) / denom;
    if (t <= 1e-4 || t >= bestT) continue;
    const hit: Vec3 = {
      x: origin.x + t * dir.x,
      y: origin.y + t * dir.y,
      z: origin.z + t * dir.z,
    };
    if (!s.pointInExtent(hit)) continue;
    bestT = t;
    bestSurface = s;
    bestHit = hit;
  }
  if (!bestSurface || !bestHit) return null;
  return { t: bestT, surface: bestSurface, hit: bestHit };
}

/**
 * Test whether the open segment from A to B is unobstructed by any of the
 * provided surfaces. We allow the endpoints themselves to land on surfaces
 * (within ε) but reject intermediate intersections — used for "is the
 * receiver visible from this bounce point?"
 */
function segmentClear(
  A: Vec3,
  B: Vec3,
  surfaces: SurfacePlane[],
): boolean {
  const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
  for (const s of surfaces) {
    const denom = dx * s.normal.x + dy * s.normal.y + dz * s.normal.z;
    if (Math.abs(denom) < 1e-9) continue;
    const t = (
      (s.origin.x - A.x) * s.normal.x +
      (s.origin.y - A.y) * s.normal.y +
      (s.origin.z - A.z) * s.normal.z
    ) / denom;
    if (t <= 1e-3 || t >= 1 - 1e-3) continue;
    const hit: Vec3 = { x: A.x + t * dx, y: A.y + t * dy, z: A.z + t * dz };
    if (s.pointInExtent(hit)) return false;
  }
  return true;
}

/**
 * Polar-pattern weight (linear pressure) for a ray leaving a speaker in
 * direction `rayDir`. Uses measured polar data when present; falls back to
 * the elliptical model otherwise. Returns 0..1+ — values > 1 are possible
 * for sources with on-axis gain, but we cap at 4 to avoid blowing up rays
 * that happen to fire down the main lobe.
 */
function speakerWeightInDirection(
  speaker: EquipmentItem,
  rayDir: Vec3,
  freqHz: number,
): number {
  const aimYaw = (speaker.aim ?? 90) * Math.PI / 180;
  const aimTilt = (speaker.tilt ?? 0) * Math.PI / 180;
  const ax = Math.cos(aimYaw) * Math.cos(aimTilt);
  const ay = Math.sin(aimYaw) * Math.cos(aimTilt);
  const az = Math.sin(aimTilt);
  const dotForward = ax * rayDir.x + ay * rayDir.y + az * rayDir.z;
  const angleRad = Math.acos(Math.max(-1, Math.min(1, dotForward)));
  const angleDeg = angleRad * 180 / Math.PI;
  // Horizontal vs vertical decomposition relative to aim plane.
  // For polar lookup we need (hAngle, vAngle). Approximate by projecting
  // ray onto horizontal aim plane to get hAngle and using elevation for v.
  // (Full polar 3D resolution would need a basis change; this is good enough.)
  const hAngle = angleDeg;
  const vAngle = 0;
  let attDb: number | null = null;
  if (speaker.polar) {
    attDb = polarAttenuationDb(speaker.polar, hAngle, vAngle, freqHz);
  }
  if (attDb == null) {
    // Elliptical fallback
    const horizCov = speaker.horiz ?? 90;
    if (horizCov >= 350) return 1; // omni
    const r = angleDeg / Math.max(1, horizCov / 2);
    let dispLoss: number;
    if (r <= 1) dispLoss = r * 6;
    else        dispLoss = 6 + 12 * Math.log2(r);
    attDb = -dispLoss;
  }
  const linW = Math.pow(10, attDb / 20);
  return Math.min(4, Math.max(0, linW));
}

// ---------------------------------------------------------------------
// Schroeder integration + decay-time analysis
// ---------------------------------------------------------------------

/**
 * Schroeder backwards integral: EDC[i] = Σ_{j ≥ i} histogram[j].
 * Then convert to dB relative to peak. Output is non-increasing and
 * starts at 0 dB at the bin where total tail energy is concentrated.
 */
function schroederEdc(histogram: Float32Array): Float32Array {
  const n = histogram.length;
  const out = new Float32Array(n);
  // Backwards cumulative sum
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) {
    acc += histogram[i];
    out[i] = acc;
  }
  // Normalize to dB relative to peak
  const peak = out[0];
  if (peak <= 1e-30) {
    for (let i = 0; i < n; i++) out[i] = -Infinity;
    return out;
  }
  for (let i = 0; i < n; i++) {
    out[i] = 10 * Math.log10(Math.max(1e-30, out[i] / peak));
  }
  return out;
}

/**
 * Find the time it takes the EDC to fall from `lowerLimitDb` to
 * `upperLimitDb` (e.g. -5 to -25 for T20). Uses linear interpolation
 * between the bins where the threshold is crossed. Returns NaN if the
 * EDC didn't reach the upper limit.
 */
function decayTime(
  edcDb: Float32Array,
  lowerLimitDb: number,
  upperLimitDb: number,
  binMs: number,
): number {
  // Find the FIRST index where edc <= lowerLimitDb (T0)
  let i0 = -1;
  for (let i = 0; i < edcDb.length; i++) {
    if (edcDb[i] <= lowerLimitDb) { i0 = i; break; }
  }
  if (i0 < 0) return NaN;
  // Linear interp for fractional bin
  const t0BinFrac = i0 === 0
    ? 0
    : i0 - 1 + (lowerLimitDb - edcDb[i0 - 1]) / (edcDb[i0] - edcDb[i0 - 1]);
  // Find first index where edc <= upperLimitDb (T1)
  let i1 = -1;
  for (let i = i0; i < edcDb.length; i++) {
    if (edcDb[i] <= upperLimitDb) { i1 = i; break; }
  }
  if (i1 < 0) return NaN;
  const t1BinFrac = i1 === 0
    ? 0
    : i1 - 1 + (upperLimitDb - edcDb[i1 - 1]) / (edcDb[i1] - edcDb[i1 - 1]);
  const decayBins = t1BinFrac - t0BinFrac;
  return (decayBins * binMs) / 1000;
}

// ---------------------------------------------------------------------
// Default receiver position
// ---------------------------------------------------------------------

function defaultReceiverPos(room: RoomState): Vec3 {
  const bb = bboxOf(room.shape);
  // Centroid at seated ear height (5 ft).
  const cx = bb.minX + bb.width / 2;
  const cy = bb.minY + bb.depth / 2;
  return { x: cx, y: cy, z: 5 };
}

// ---------------------------------------------------------------------
// Core trace
// ---------------------------------------------------------------------

/**
 * Trace stochastic rays from each active speaker, accumulating a per-band
 * energy-time histogram at the reference receiver. Returns the EDC and
 * decay-time analysis derived from those histograms.
 */
export function traceRays(
  room: RoomState,
  speakers: EquipmentItem[],
  options: Partial<RayTraceOptions> = {},
): DecayResult {
  const opts: RayTraceOptions = {
    ...defaultRayOptions('medium'),
    ...options,
  };
  const numBins = Math.max(1, Math.ceil(opts.maxTimeMs / opts.binMs));

  // Pre-build room surfaces once. (Floor α override not relevant here —
  // the ray tracer captures full energy decay including audience absorption
  // implicitly via the surface materials. Audience absorption from zones
  // could be added by blending the floor α; for v1 we use the bare material.)
  const surfaces = buildRoomSurfaces(room);
  const air = airCoeffsPerBand(room.temperatureF ?? 70, room.relHumidity ?? 50);
  const receiverPos = opts.receiverPos ?? defaultReceiverPos(room);
  const energyFloorLin = Math.pow(10, opts.energyFloorDb / 10);

  // Allocate histograms: float32 per band per bin.
  const histograms = {} as Record<OctaveBand, Float32Array>;
  for (const b of OCTAVE_BANDS) {
    histograms[b] = new Float32Array(numBins);
  }

  // Receiver capture: we model the receiver as a small sphere. Energy
  // deposited = ray_energy × min(1, (radius/distance)²). The 1/r² cap
  // avoids the singularity when a bounce lands directly on the receiver.
  const recvRadiusFt = opts.receiverRadiusFt;
  const recvRadiusM = recvRadiusFt * FT_TO_M;
  const recvRadiusM2 = recvRadiusM * recvRadiusM;

  let totalRays = 0;
  const rng = makeRng(opts.seed ?? 42);

  for (let spIdx = 0; spIdx < speakers.length; spIdx++) {
    const sp = speakers[spIdx];
    if (sp.kind === 'speaker-iem') continue;
    const splAt1m = speakerSplAt1m(sp);
    if (!isFinite(splAt1m)) continue;

    // Source power level: Lw ≈ Lp_at_1m + 11 dB (4πr² conversion factor).
    const lwDb = splAt1m + 11;
    // Per-ray initial energy: total source energy / num_rays. We work in
    // RELATIVE linear energy units (peak = 1) and reverse-engineer the dB
    // at the end. So the source energy is just lwLin = 10^(lwDb/10).
    const lwLin = Math.pow(10, lwDb / 10);
    // Per-band weights from the speaker's frequency response + crossovers.
    const bandSourceLin = {} as Record<OctaveBand, number>;
    for (const b of OCTAVE_BANDS) {
      const att = bandResponseAttenuation(sp, b);
      bandSourceLin[b] = lwLin * Math.pow(10, -att / 10);
    }

    const sourcePos: Vec3 = { x: sp.x, y: sp.y, z: sp.z };
    const sourceDelayMs = sp.delayMs ?? 0;

    for (let r = 0; r < opts.raysPerSpeaker; r++) {
      const dir = sampleSphereDirection(rng);
      // Speaker directivity weight at the chosen direction (uses 1 kHz
      // reference for sample weighting; per-band variation handled implicitly
      // by our broadband polar tables for now).
      const wDir = speakerWeightInDirection(sp, dir, 1000);
      if (wDir <= 1e-3) continue; // ray fires into a deep null — skip

      // Per-band remaining energy along this ray.
      const energy = {} as Record<OctaveBand, number>;
      for (const b of OCTAVE_BANDS) {
        // Each ray represents 4π/N solid angle (uniform sphere sampling).
        // Effective solid-angle factor: 4π/N; accept the constant scaling
        // since we normalize the EDC to peak anyway.
        energy[b] = bandSourceLin[b] * wDir * wDir;
      }

      let pos = sourcePos;
      let curDir = dir;
      let timeMs = sourceDelayMs;
      totalRays++;

      for (let bounce = 0; bounce <= opts.maxBounces; bounce++) {
        const hit = nearestSurfaceHit(pos, curDir, surfaces);
        if (!hit) break;

        // Apply air absorption per-band over this leg. Ray directions are
        // unit vectors throughout, so leg length = hit.t.
        const legFt = hit.t;
        const legM = legFt * FT_TO_M;
        for (const b of OCTAVE_BANDS) {
          const airDb = air[b] * legM;
          energy[b] *= Math.pow(10, -airDb / 10);
        }
        timeMs += legFt / SPEED_OF_SOUND_FT_PER_MS;
        if (timeMs > opts.maxTimeMs) break;

        // Deposit at receiver from THIS bounce point. We use an
        // image-source-on-each-bounce model: every reflection radiates
        // a fraction of its remaining energy diffusely toward the receiver,
        // attenuated by inverse-square.
        const dxR = receiverPos.x - hit.hit.x;
        const dyR = receiverPos.y - hit.hit.y;
        const dzR = receiverPos.z - hit.hit.z;
        const distFtToR = Math.sqrt(dxR * dxR + dyR * dyR + dzR * dzR);
        const distMToR = distFtToR * FT_TO_M;

        // Visibility test
        if (segmentClear(hit.hit, receiverPos, surfaces)) {
          // 1/r² with cap to avoid singularity for very close bounces.
          const r2 = Math.max(recvRadiusM2, distMToR * distMToR);
          const arrivalTimeMs = timeMs + distFtToR / SPEED_OF_SOUND_FT_PER_MS;
          const binIdx = Math.floor(arrivalTimeMs / opts.binMs);
          if (binIdx >= 0 && binIdx < numBins) {
            for (const b of OCTAVE_BANDS) {
              // Air absorption from bounce point to receiver
              const airAttDb = air[b] * distMToR;
              const e = energy[b] * Math.pow(10, -airAttDb / 10) / r2;
              if (e > 1e-30) histograms[b][binIdx] += e;
            }
          }
        }

        // Apply surface absorption to the surviving energy.
        let totalEnergy = 0;
        for (const b of OCTAVE_BANDS) {
          // surface.reflectionLoss is the per-band reflection loss in dB.
          // Linear factor = 10^(-loss/10) (since loss is on energy, not pressure).
          const loss = hit.surface.reflectionLoss[b];
          energy[b] *= Math.pow(10, -loss / 10);
          totalEnergy += energy[b];
        }
        if (totalEnergy < energyFloorLin * OCTAVE_BANDS.length) break;

        // Reflect (specular or diffuse, per the surface's scattering) + step
        // a tiny epsilon along the new direction so we don't immediately
        // re-hit the same surface.
        curDir = scatterReflect(curDir, hit.surface, rng);
        pos = {
          x: hit.hit.x + curDir.x * 1e-3,
          y: hit.hit.y + curDir.y * 1e-3,
          z: hit.hit.z + curDir.z * 1e-3,
        };
      }
    }
  }

  // Schroeder integrate per band → EDC dB
  const edcDb = {} as Record<OctaveBand, Float32Array>;
  const t20 = {} as Partial<Record<OctaveBand, number>>;
  const t30 = {} as Partial<Record<OctaveBand, number>>;
  const edt = {} as Partial<Record<OctaveBand, number>>;
  const rt60ByBand = {} as Partial<Record<OctaveBand, number>>;
  for (const b of OCTAVE_BANDS) {
    edcDb[b] = schroederEdc(histograms[b]);
    const t20Raw = decayTime(edcDb[b], -5, -25, opts.binMs);
    const t30Raw = decayTime(edcDb[b], -5, -35, opts.binMs);
    const edtRaw = decayTime(edcDb[b], 0, -10, opts.binMs);
    t20[b] = isFinite(t20Raw) ? +(t20Raw * 3).toFixed(3) : NaN;     // T20 → RT60
    t30[b] = isFinite(t30Raw) ? +(t30Raw * 2).toFixed(3) : NaN;     // T30 → RT60
    edt[b] = isFinite(edtRaw) ? +(edtRaw * 6).toFixed(3) : NaN;     // EDT → RT60-equivalent
    // Prefer T30 (most robust), fall back to T20, then EDT.
    if (isFinite(t30[b]!)) rt60ByBand[b] = t30[b];
    else if (isFinite(t20[b]!)) rt60ByBand[b] = t20[b];
    else if (isFinite(edt[b]!)) rt60ByBand[b] = edt[b];
  }

  return {
    histograms,
    edcDb,
    t20,
    t30,
    edt,
    rt60ByBand,
    binMs: opts.binMs,
    numBins,
    receiverPos,
    rayCount: totalRays,
  };
}

// Suppress unused-import warning for polygonArea — kept for future
// audience-zone-weighted receiver placement.
void polygonArea;

/**
 * Resolve the per-cell ear height for ray-tracing receivers.
 * Mirrors the behavior of acoustics.earHeightAt but lives here to avoid
 * pulling acoustics into the rays module's import graph.
 */
function resolveEarHeight(
  x: number, y: number,
  zones: import('../types').Zone[],
  defaultEarHeightFt: number,
): number {
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i];
    if (z.floorHeightFt == null && z.earHeightFt == null) continue;
    if (z.shape.length < 3) continue;
    if (!pointInPolygon({ x, y }, z.shape)) continue;
    const floor = z.floorHeightFt ?? 0;
    const ear = z.earHeightFt ?? defaultEarHeightFt;
    return floor + ear;
  }
  return defaultEarHeightFt;
}

// =====================================================================
// Per-cell ray tracing (Sprint 4)
// =====================================================================
// Same algorithm as traceRays() but accumulates a separate per-band energy
// histogram for every cell of an audience-plane grid, then derives a
// per-cell T30 from each cell's Schroeder EDC. Result is shaped like
// HeatmapData so the viewport renders it through the same colormap path
// as SPL/C50/arrival.
//
// Two optimizations make per-cell tracing practical:
//   • Spatial bucket lookup — each cell IS its own grid bucket, so per
//     bounce we only iterate cells within `maxDepositRadiusFt` of the
//     bounce point (typically 30-50 cells out of 100-1000).
//   • Convex-room LOS shortcut — most worship rooms are convex polygons.
//     In those, every bounce point has clear line of sight to every cell,
//     so we skip the LOS test entirely. ~10× speedup in typical rooms.
//
// For non-convex (L-shaped or balconied) rooms the LOS test runs as
// normal; correctness is preserved.

/** Test whether a 2D polygon is convex. Walks edges and checks the cross
 *  product sign stays consistent. Robust to consecutive collinear edges. */
function isPolygonConvex(poly: Point[]): boolean {
  if (poly.length < 4) return true;
  let lastSign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = poly[(i + 2) % poly.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const sign = cross > 0 ? 1 : -1;
    if (lastSign !== 0 && sign !== lastSign) return false;
    lastSign = sign;
  }
  return true;
}

export interface PerCellTraceOptions extends RayTraceOptions {
  cellWFt: number;
  cellHFt: number;
  earHeightFt: number;
  /** Cells beyond this distance from a bounce point don't get any deposit
   *  — the contribution would be far below the noise floor anyway. Pick
   *  a value that balances accuracy vs speed (50 ft is a sane default). */
  maxDepositRadiusFt: number;
  /** Which octave band's T30 to render. The histograms are stored per-band
   *  internally, but only one band is exposed via the t30Grid heatmap.
   *  Default: 1 kHz (most relevant for speech intelligibility). */
  reportBand: OctaveBand;
  /** Zones with optional `floorHeightFt` / `earHeightFt` overrides. Cells
   *  inside a zone with overrides sample at that zone's effective height
   *  (e.g. a balcony at 12 ft instead of the default 4 ft). Outside any
   *  override zone, cells sample at `earHeightFt`. */
  zones?: import('../types').Zone[];
}

export const PER_CELL_DEFAULTS: Pick<PerCellTraceOptions, 'cellWFt' | 'cellHFt' | 'earHeightFt' | 'maxDepositRadiusFt' | 'reportBand'> = {
  cellWFt: 4,
  cellHFt: 4,
  earHeightFt: 5,
  maxDepositRadiusFt: 50,
  reportBand: 1000,
};

export interface PerCellResult {
  /** T30 grid in HeatmapData shape — values are seconds (NaN outside room). */
  t30Grid: HeatmapData;
  rayCount: number;
  /** Whether the convex-room LOS shortcut was applied. */
  usedConvexShortcut: boolean;
  /** Compute time in milliseconds (approx — based on Date.now bookends). */
  computeMs: number;
}

/**
 * Cast rays from each speaker, accumulate per-band energy decay at every
 * audience-plane cell, and derive a per-cell T30 grid.
 */
export function traceRaysPerCell(
  room: RoomState,
  speakers: EquipmentItem[],
  options: Partial<PerCellTraceOptions> = {},
): PerCellResult {
  const t0 = Date.now();
  const opts: PerCellTraceOptions = {
    ...defaultRayOptions('medium'),
    ...PER_CELL_DEFAULTS,
    ...options,
  };
  const numBins = Math.max(1, Math.ceil(opts.maxTimeMs / opts.binMs));
  const surfaces = buildRoomSurfaces(room);
  const air = airCoeffsPerBand(room.temperatureF ?? 70, room.relHumidity ?? 50);
  const isConvex = isPolygonConvex(room.shape);

  // Build cell grid over the room's bounding box
  const bb = bboxOf(room.shape);
  const gridX = Math.max(2, Math.ceil(bb.width / opts.cellWFt));
  const gridY = Math.max(2, Math.ceil(bb.depth / opts.cellHFt));
  const numCells = gridX * gridY;

  // Pre-compute receiver positions + in-room mask. Per-cell ear height
  // resolves zone overrides (balcony, raised stage) inline via the helper.
  const zonesForHeight = opts.zones ?? [];
  const receivers: Vec3[] = new Array(numCells);
  const inRoom: boolean[] = new Array(numCells);
  for (let j = 0; j < gridY; j++) {
    for (let i = 0; i < gridX; i++) {
      const idx = j * gridX + i;
      const cx = bb.minX + (i + 0.5) * opts.cellWFt;
      const cy = bb.minY + (j + 0.5) * opts.cellHFt;
      const cz = resolveEarHeight(cx, cy, zonesForHeight, opts.earHeightFt);
      receivers[idx] = { x: cx, y: cy, z: cz };
      inRoom[idx] = pointInPolygon({ x: cx, y: cy }, room.shape);
    }
  }

  // Per-cell, per-band energy histograms. Using one large flat Float32Array
  // for memory locality: histograms[((cell * NB) + band) * numBins + bin].
  const NB = OCTAVE_BANDS.length;
  const histograms = new Float32Array(numCells * NB * numBins);
  const histStride = NB * numBins;
  const bandStride = numBins;

  // Spatial bucket for "cells near a bounce point" — each cell IS its own
  // bucket since the cell grid is already a 2D index. We just clamp ranges.
  const radInBucketsX = Math.ceil(opts.maxDepositRadiusFt / opts.cellWFt);
  const radInBucketsY = Math.ceil(opts.maxDepositRadiusFt / opts.cellHFt);
  const maxRadFt2 = opts.maxDepositRadiusFt * opts.maxDepositRadiusFt;
  const recvRadiusM = opts.receiverRadiusFt * FT_TO_M;
  const recvRadiusM2 = recvRadiusM * recvRadiusM;

  let totalRays = 0;
  const rng = makeRng(opts.seed ?? 42);
  const energyFloorLin = Math.pow(10, opts.energyFloorDb / 10);

  for (const sp of speakers) {
    if (sp.kind === 'speaker-iem') continue;
    const splAt1m = speakerSplAt1m(sp);
    if (!isFinite(splAt1m)) continue;
    const lwLin = Math.pow(10, (splAt1m + 11) / 10);
    const bandSourceLin = {} as Record<OctaveBand, number>;
    for (const b of OCTAVE_BANDS) {
      const att = bandResponseAttenuation(sp, b);
      bandSourceLin[b] = lwLin * Math.pow(10, -att / 10);
    }

    const sourcePos: Vec3 = { x: sp.x, y: sp.y, z: sp.z };
    const sourceDelayMs = sp.delayMs ?? 0;

    for (let r = 0; r < opts.raysPerSpeaker; r++) {
      const dir = sampleSphereDirection(rng);
      const wDir = speakerWeightInDirection(sp, dir, 1000);
      if (wDir <= 1e-3) continue;

      const energy = {} as Record<OctaveBand, number>;
      for (const b of OCTAVE_BANDS) energy[b] = bandSourceLin[b] * wDir * wDir;

      let pos = sourcePos;
      let curDir = dir;
      let timeMs = sourceDelayMs;
      totalRays++;

      for (let bounce = 0; bounce <= opts.maxBounces; bounce++) {
        const hit = nearestSurfaceHit(pos, curDir, surfaces);
        if (!hit) break;

        const legFt = hit.t;
        const legM = legFt * FT_TO_M;
        for (const b of OCTAVE_BANDS) {
          energy[b] *= Math.pow(10, -(air[b] * legM) / 10);
        }
        timeMs += legFt / SPEED_OF_SOUND_FT_PER_MS;
        if (timeMs > opts.maxTimeMs) break;

        // Find candidate cells near this bounce — clamp grid range.
        const bIdxX = Math.floor((hit.hit.x - bb.minX) / opts.cellWFt);
        const bIdxY = Math.floor((hit.hit.y - bb.minY) / opts.cellHFt);
        const i0 = Math.max(0, bIdxX - radInBucketsX);
        const i1 = Math.min(gridX - 1, bIdxX + radInBucketsX);
        const j0 = Math.max(0, bIdxY - radInBucketsY);
        const j1 = Math.min(gridY - 1, bIdxY + radInBucketsY);

        for (let cj = j0; cj <= j1; cj++) {
          for (let ci = i0; ci <= i1; ci++) {
            const cellIdx = cj * gridX + ci;
            if (!inRoom[cellIdx]) continue;
            const recv = receivers[cellIdx];
            const dxR = recv.x - hit.hit.x;
            const dyR = recv.y - hit.hit.y;
            const dzR = recv.z - hit.hit.z;
            const distFt2 = dxR * dxR + dyR * dyR + dzR * dzR;
            if (distFt2 > maxRadFt2) continue;
            const distFt = Math.sqrt(distFt2);
            // LOS check (skipped in convex rooms — see notes above).
            if (!isConvex && !segmentClear(hit.hit, recv, surfaces)) continue;
            const distM = distFt * FT_TO_M;
            const r2 = Math.max(recvRadiusM2, distM * distM);
            const arrivalTimeMs = timeMs + distFt / SPEED_OF_SOUND_FT_PER_MS;
            const binIdx = Math.floor(arrivalTimeMs / opts.binMs);
            if (binIdx < 0 || binIdx >= numBins) continue;
            const baseHist = cellIdx * histStride;
            for (let bIdx = 0; bIdx < NB; bIdx++) {
              const b = OCTAVE_BANDS[bIdx];
              const airAttDb = air[b] * distM;
              const e = energy[b] * Math.pow(10, -airAttDb / 10) / r2;
              if (e > 1e-30) histograms[baseHist + bIdx * bandStride + binIdx] += e;
            }
          }
        }

        // Apply surface absorption + early-out
        let totalEnergy = 0;
        for (const b of OCTAVE_BANDS) {
          energy[b] *= Math.pow(10, -hit.surface.reflectionLoss[b] / 10);
          totalEnergy += energy[b];
        }
        if (totalEnergy < energyFloorLin * NB) break;

        // Specular-or-diffuse bounce per the surface scattering coefficient.
        curDir = scatterReflect(curDir, hit.surface, rng);
        pos = {
          x: hit.hit.x + curDir.x * 1e-3,
          y: hit.hit.y + curDir.y * 1e-3,
          z: hit.hit.z + curDir.z * 1e-3,
        };
      }
    }
  }

  // Compute per-cell T30 at the report band.
  const reportBandIdx = OCTAVE_BANDS.indexOf(opts.reportBand);
  const t30Values = new Float32Array(numCells);
  let max = -Infinity, min = Infinity, sum = 0, n = 0;
  // Reusable scratch histogram view per cell (no copy needed — schroederEdc reads sequentially).
  const tmpHist = new Float32Array(numBins);
  for (let cellIdx = 0; cellIdx < numCells; cellIdx++) {
    if (!inRoom[cellIdx]) {
      t30Values[cellIdx] = NaN;
      continue;
    }
    const baseHist = cellIdx * histStride + reportBandIdx * bandStride;
    for (let k = 0; k < numBins; k++) tmpHist[k] = histograms[baseHist + k];
    const edc = schroederEdc(tmpHist);
    const t30Raw = decayTime(edc, -5, -35, opts.binMs);
    const t30 = isFinite(t30Raw) ? t30Raw * 2 : NaN;
    t30Values[cellIdx] = t30;
    if (isFinite(t30)) {
      if (t30 > max) max = t30;
      if (t30 < min) min = t30;
      sum += t30; n += 1;
    }
  }

  // Build HeatmapData-shaped grid.
  const grid: number[][] = [];
  for (let j = 0; j < gridY; j++) {
    const row: number[] = [];
    for (let i = 0; i < gridX; i++) row.push(t30Values[j * gridX + i]);
    grid.push(row);
  }
  const avg = n > 0 ? sum / n : 0;
  let varSum = 0;
  for (let i = 0; i < numCells; i++) {
    if (isFinite(t30Values[i])) varSum += (t30Values[i] - avg) ** 2;
  }
  const std = n > 1 ? Math.sqrt(varSum / (n - 1)) : 0;

  return {
    t30Grid: {
      grid,
      cellW: opts.cellWFt,
      cellH: opts.cellHFt,
      minX: bb.minX,
      minY: bb.minY,
      gridX,
      gridY,
      min: isFinite(min) ? min : 0,
      max: isFinite(max) ? max : 0,
      avg,
      std,
    },
    rayCount: totalRays,
    usedConvexShortcut: isConvex,
    computeMs: Date.now() - t0,
  };
}

import {
  OCTAVE_BANDS,
  type OctaveBand,
  type RT60Result,
  type RoomState,
  type EquipmentItem,
  type HeatmapData,
  type Recommendation,
  type Point,
  type Zone,
  type SpeakerGroup,
  type ComplianceTargets,
  type RoomType,
  type PolarData,
} from '../types';
import { getMaterial } from '../constants/materials';
import { ftToM, polygonArea, polygonPerimeter, pointInPolygon, bboxOf } from './../utils/geometry';
import { ceilingHeightAt, ceilingPanels } from '../utils/ceiling';
import {
  buildRoomSurfaces,
  generateImageSources,
  audiblePath,
  bandKeyForFreq,
  imageAsEquipmentItem,
  edgeSofteningLossDb,
  type ImageSource,
} from './ism';

/** Module-wide acoustic constants. Hoisted to the top so any function in the
 *  file (incl. obstructionLossDb / coherentCombinedSPL) can reference them. */
const SPEED_OF_SOUND_M_S = 343;
const FT_TO_M = 0.3048;

/** Air absorption coefficients (dB/m) at 70 °F / 50 % RH / sea level —
 *  used as the default when the room hasn't specified temp/humidity yet.
 *  Computed lazily on first reference. */
let _DEFAULT_AIR_COEFFS: Record<OctaveBand, number> | null = null;
function getDefaultAirCoeffs(): Record<OctaveBand, number> {
  if (!_DEFAULT_AIR_COEFFS) {
    _DEFAULT_AIR_COEFFS = airCoeffsPerBand(70, 50);
  }
  return _DEFAULT_AIR_COEFFS;
}
const DEFAULT_AIR_COEFFS = new Proxy({} as Record<OctaveBand, number>, {
  get(_t, prop) { return getDefaultAirCoeffs()[Number(prop) as OctaveBand]; },
});

// =============== Volume + surface area ===============

/**
 * Average ceiling height over the room footprint — used for volume. For
 * shapes that aren't simply linear (e.g. hip, cross-gable), we sample on a
 * grid so the answer reflects the actual surface, not a simple (h+peak)/2.
 *
 * Exported so the ISM (image-source) module can use this as a flat-plane
 * approximation when generating ceiling images for non-flat ceilings.
 */
export function avgCeilingHeight(room: RoomState): number {
  const h = room.height;
  if (room.ceilingShape === 'flat' || room.ceilingShape === 'coffered') return h;
  const peak = room.peakHeight ?? h;
  // Sloped + vaulted are linear in cross-axis → analytic average.
  if (room.ceilingShape === 'sloped' || room.ceilingShape === 'vaulted') {
    return (h + peak) / 2;
  }
  // Hip / cross-gable: sample on a 32×32 grid.
  const bb = bboxOf(room.shape);
  const N = 32;
  let sum = 0, cnt = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = bb.minX + ((i + 0.5) / N) * bb.width;
      const y = bb.minY + ((j + 0.5) / N) * bb.depth;
      if (!pointInPolygon({ x, y }, room.shape)) continue;
      sum += ceilingHeightAt(room, x, y);
      cnt++;
    }
  }
  return cnt > 0 ? sum / cnt : h;
}

export function roomVolumeFt3(room: RoomState): number {
  return polygonArea(room.shape) * avgCeilingHeight(room);
}

export function totalFloorAreaFt2(room: RoomState): number {
  return polygonArea(room.shape);
}

export function totalCeilingAreaFt2(room: RoomState): number {
  // Slope-corrected via the ceilingPanels helper. For coffered we add a
  // small surface-area bump to model the additional faces of the coffers.
  const panels = ceilingPanels(room);
  let total = 0;
  for (const p of panels) total += p.areaFt2;
  if (room.ceilingShape === 'coffered') total *= 1.05;
  return total;
}

export function totalWallAreaFt2(room: RoomState): number {
  // Eaves up to the WALL height (not the ceiling peak). Gable triangles above
  // the wall — when the ceiling slopes — are included in the ceiling panels.
  return polygonPerimeter(room.shape) * room.height;
}

export function totalSurfaceAreaFt2(room: RoomState): number {
  return totalFloorAreaFt2(room) + totalCeilingAreaFt2(room) + totalWallAreaFt2(room);
}

// Determine the material assigned to a particular surface, defaulting if missing.
function materialFor(room: RoomState, kind: 'wall' | 'floor' | 'ceiling', segIdx = 0) {
  const s = room.surfaces.find(x => x.kind === kind && x.segmentIndex === segIdx);
  if (s) return getMaterial(s.materialId);
  // Defaults
  if (kind === 'wall')    return getMaterial('drywall');
  if (kind === 'floor')   return getMaterial('carpet-thick');
  return getMaterial('drywall'); // ceiling
}

/**
 * Build an effective floor α curve that blends the floor material with the
 * per-zone audience seating material, weighted by what fraction of the floor
 * each zone covers. This is the per-bounce reflection coefficient the ISM
 * uses for the floor surface — separate from the global Sabine/Eyring
 * audience absorption sum that drives RT60.
 *
 * Why both? The Sabine sum models the audience as a uniform energy sink
 * across the volume; ISM models a specific bounce off the audience-covered
 * floor as a discrete reflective surface. Different mechanisms, same
 * physics — they coexist without double-counting.
 */
function effectiveFloorAlpha(
  room: RoomState,
  zones: import('../types').Zone[],
): Record<OctaveBand, number> {
  const floorAlpha = materialFor(room, 'floor', 0).alpha;
  if (!zones.length) return floorAlpha;
  const totalFloor = polygonArea(room.shape);
  if (totalFloor <= 0) return floorAlpha;
  const out: Partial<Record<OctaveBand, number>> = {};
  for (const band of OCTAVE_BANDS) {
    let coveredArea = 0;
    let weightedZoneAlpha = 0;
    for (const z of zones) {
      if (!z.seatingType || !z.shape || z.shape.length < 3) continue;
      const za = polygonArea(z.shape);
      if (za <= 0) continue;
      const m = getMaterial(seatingMaterialId(z.seatingType, room.occupied));
      coveredArea += za;
      weightedZoneAlpha += za * m.alpha[band];
    }
    const cappedCovered = Math.min(coveredArea, totalFloor);
    const uncovered = Math.max(0, totalFloor - cappedCovered);
    out[band] = (weightedZoneAlpha + uncovered * floorAlpha[band]) / totalFloor;
  }
  return out as Record<OctaveBand, number>;
}

/**
 * Resolve the heatmap sampling height (z, in feet) at a 2D listener position.
 *
 * If the point lies inside any zone with `floorHeightFt` or `earHeightFt`
 * override(s), the zone's elevated floor + ear-above-floor are used. Otherwise
 * the global `defaultEarHeightFt` is returned. First matching zone wins
 * (zones drawn later in the list override earlier ones — same convention as
 * z-index).
 *
 * Used by the heatmap, clarity, and ray-trace per-cell passes so a balcony
 * zone (floor at 9 ft + ear at 4 ft = sample at 13 ft) and a main-floor zone
 * (floor at 0 + ear at 4 ft = sample at 4 ft) coexist correctly in the same
 * room.
 */
export function earHeightAt(
  x: number,
  y: number,
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

// Material lookup for a seating type given current room occupancy.
function seatingMaterialId(type: import('../types').SeatingType, occupied: boolean): string {
  // 'standing' uses one material whether occupied or not — empty floor is no audience absorption at all.
  if (type === 'standing') return 'standing-audience';
  const suffix = occupied ? 'occupied' : 'empty';
  switch (type) {
    case 'padded-chair':   return `padded-chair-${suffix}`;
    case 'unpadded-chair': return `unpadded-chair-${suffix}`;
    case 'pew-padded':     return `pew-padded-${suffix}`;
    case 'pew-wood':       return `pew-wood-${suffix}`;
  }
}

/**
 * Audience absorption — each occupant adds approximately the absorption of a
 * seat (the type and occupied-vs-empty determines the alpha curve).
 *
 * If any zone has its own `seatingType` + `seatCount`, those seats are
 * accounted for using the per-zone material, and the remaining
 * (room.occupancy − sum-of-zone-seats) are treated as legacy upholstered.
 */
function audienceAbsorption(room: RoomState, zones: import('../types').Zone[] = [], band: OctaveBand): number {
  const seatAreaFt2 = 5;
  const occupied = room.occupied;
  let sa = 0;
  let zoneSeatsClaimed = 0;
  for (const z of zones) {
    if (!z.seatingType || !z.seatCount || z.seatCount <= 0) continue;
    // 'standing' areas don't claim seats from the room occupancy — they're separate.
    if (z.seatingType !== 'standing') zoneSeatsClaimed += z.seatCount;
    const m = getMaterial(seatingMaterialId(z.seatingType, occupied));
    sa += z.seatCount * ftToM(seatAreaFt2) * ftToM(1) * m.alpha[band];
  }
  const unzonedSeats = Math.max(0, room.occupancy - zoneSeatsClaimed);
  if (unzonedSeats > 0) {
    const m = getMaterial(occupied ? 'upholstered-occupied' : 'upholstered-empty');
    sa += unzonedSeats * ftToM(seatAreaFt2) * ftToM(1) * m.alpha[band];
  }
  return sa;
}

// =============== RT60 (Sabine) ===============

export function rt60(
  room: RoomState,
  panelItems: EquipmentItem[] = [],
  zones: import('../types').Zone[] = [],
  obstacleItems: EquipmentItem[] = [],
  /** When true, use the Eyring formula (more accurate for high-α rooms,
   *  matches the energy-decay model better than Sabine). Defaults to
   *  Sabine for backward compat. */
  useEyring: boolean = false,
): RT60Result {
  // Sum of exposed obstacle surface area in m² (5 of the 6 box faces — bottom is on
  // the floor / not exposed). Items with affectsAcoustics === false are ignored.
  //
  // Two buckets:
  //   • Generic gear (racks, consoles…) — box surface area × a generic
  //     mixed-material absorption curve (applied in rt60Inner).
  //   • Furniture (chairs, pews, tables…) — its own measured absorption,
  //     applied on the FOOTPRINT basis (w×d), since seating absorption
  //     coefficients are defined per occupied floor area, not box surface.
  let genericAreaM2 = 0;
  const furnitureSabines: Partial<Record<OctaveBand, number>> = {};
  let hasFurnitureSabine = false;
  for (const o of obstacleItems) {
    if (!affectsAcoustics(o)) continue;
    const w = o.width ?? 0, d = o.depth ?? 0;
    if (w <= 0 || d <= 0) continue;
    if (o.category === 'furniture' && o.alpha) {
      const footprintM2 = (w * d) * 0.092903;
      for (const b of OCTAVE_BANDS) {
        furnitureSabines[b] = (furnitureSabines[b] ?? 0) + footprintM2 * (o.alpha[b] ?? 0);
      }
      hasFurnitureSabine = true;
    } else {
      const h = o.itemHeight ?? Math.max(0.5, o.z * 0.2 + 1);
      // 4 sides + top
      const sidesFt2 = 2 * (w + d) * h + (w * d);
      genericAreaM2 += sidesFt2 * 0.092903;        // ft² → m²
    }
  }
  const obstacleAccumulator = (genericAreaM2 > 0 || hasFurnitureSabine)
    ? (band: OctaveBand, alpha: Record<OctaveBand, number>) =>
        genericAreaM2 * alpha[band] + (furnitureSabines[band] ?? 0)
    : null;
  return rt60Inner(room, panelItems, zones, obstacleAccumulator, useEyring);
}

function rt60Inner(
  room: RoomState,
  panelItems: EquipmentItem[],
  zones: import('../types').Zone[],
  obstacleAccumulator: ((band: OctaveBand, alpha: Record<OctaveBand, number>) => number) | null,
  useEyring: boolean = false,
): RT60Result {
  // V (m^3), S*alpha summed (m^2 sabines)
  const Vft = roomVolumeFt3(room);
  const Vm = Vft * 0.028316846592;
  const result: Partial<Record<OctaveBand, number>> = {};
  let avgSum = 0;

  for (const band of OCTAVE_BANDS) {
    let sa = 0;        // sabines (m² · α) — total absorption
    let totalS = 0;    // m² of reflective surface (boundaries only — used by Eyring)

    // floor
    const floorMat = materialFor(room, 'floor', 0);
    const floorAreaM = ftToM(ftToM(totalFloorAreaFt2(room)));
    sa += floorAreaM * floorMat.alpha[band];
    totalS += floorAreaM;

    // ceiling — per-panel so vaulted/hip/cross-gable can mix materials.
    {
      const panels = ceilingPanels(room);
      const cofferBump = room.ceilingShape === 'coffered' ? 1.05 : 1.0;
      for (const cp of panels) {
        const m = materialFor(room, 'ceiling', cp.segmentIndex);
        const areaM = ftToM(ftToM(cp.areaFt2 * cofferBump));
        sa += areaM * m.alpha[band];
        totalS += areaM;
      }
    }

    // walls — per segment
    const segs = (() => {
      const out: { length: number; index: number }[] = [];
      const n = room.shape.length;
      for (let i = 0; i < n; i++) {
        const a = room.shape[i], b = room.shape[(i + 1) % n];
        out.push({ length: Math.hypot(b.x - a.x, b.y - a.y), index: i });
      }
      return out;
    })();
    for (const seg of segs) {
      const m = materialFor(room, 'wall', seg.index);
      const wallAreaM = ftToM(ftToM(seg.length * room.height));
      sa += wallAreaM * m.alpha[band];
      totalS += wallAreaM;
    }

    // Acoustic treatment items — these REPLACE a portion of the wall, so they
    // add to absorption but do NOT add to the boundary surface area for Eyring.
    for (const p of panelItems) {
      if (!p.alpha) continue;
      const w = p.panelW ?? p.width ?? 4;
      const h = p.panelH ?? p.depth ?? 2;
      const areaM = ftToM(ftToM(w * h));
      sa += areaM * p.alpha[band];
    }

    // Audience absorption (zone-aware) — adds to absorption only (audience
    // sits on the floor, doesn't add a new boundary surface for Eyring).
    sa += audienceAbsorption(room, zones, band);

    // Other physical obstacles (racks, consoles, projectors, trusses, etc.)
    // contribute a small absorption from their exposed surface area. We use a
    // generic mid-low alpha curve typical of mixed mass (wood / fabric / steel).
    const obstacleAlpha: Record<OctaveBand, number> = { 125: 0.06, 250: 0.08, 500: 0.10, 1000: 0.10, 2000: 0.10, 4000: 0.10 };
    if (obstacleAccumulator) {
      sa += obstacleAccumulator(band, obstacleAlpha);
    }

    if (!Number.isFinite(Vm) || Vm <= 0 || sa <= 0) {
      // Degenerate / zero-volume room (empty or collinear polygon) or no
      // absorption — return a sentinel "very reverberant" value rather than
      // letting 0/0 or x/0 emit NaN/Infinity into the heatmap + STI chain.
      result[band] = 99;
    } else if (useEyring && totalS > 0) {
      // Eyring: RT60 = -0.161·V / (S · ln(1 - α_avg)).
      // Diverges as α_avg → 1; clamp 1-α to a tiny positive number.
      const alphaAvg = Math.min(0.999, sa / totalS);
      const denom = -totalS * Math.log(Math.max(1e-6, 1 - alphaAvg));
      result[band] = +(0.161 * Vm / Math.max(1e-6, denom)).toFixed(3);
    } else {
      // Sabine: RT60 = 0.161·V / Sa  (well-established for low-α rooms).
      result[band] = +(0.161 * Vm / sa).toFixed(3);
    }
    avgSum += result[band] ?? 0;
  }

  const average = +(avgSum / OCTAVE_BANDS.length).toFixed(2);
  const at1k = result[1000] ?? average;
  let rating: RT60Result['rating'];
  if (at1k < 0.6) rating = 'Excellent';
  else if (at1k < 1.0) rating = 'Good';
  else if (at1k < 1.5) rating = 'Moderate';
  else if (at1k < 2.0) rating = 'Reverberant';
  else rating = 'Poor';

  return { byBand: result as Record<OctaveBand, number>, average, rating };
}

// =============== Active source filter (mute / solo) ===============

/**
 * Apply mute/solo to a list of speakers. If any speaker is soloed, only soloed
 * speakers contribute. Otherwise all non-muted speakers contribute.
 */
export function getActiveSpeakers(speakers: EquipmentItem[]): EquipmentItem[] {
  const anySoloed = speakers.some(s => s.soloed);
  if (anySoloed) return speakers.filter(s => s.soloed && !s.muted);
  return speakers.filter(s => !s.muted);
}

/**
 * Returns a new EquipmentItem with the speaker's group offsets baked in:
 * group gainDb adds to drive (via drive scaling) and group delayMs adds to delayMs.
 * Speakers not in a group are returned as-is.
 */
export function applyGroupSettings(item: EquipmentItem, groups: SpeakerGroup[]): EquipmentItem {
  if (!item.groupId) return item;
  const g = groups.find(x => x.id === item.groupId);
  if (!g) return item;
  // Group gain shifts the effective drive-equivalent SPL@1m by gainDb. Convert dB → drive multiplier:
  // 20·log10(driveMul) = gainDb  →  driveMul = 10^(gainDb/20)
  const driveMul = Math.pow(10, g.gainDb / 20);
  const drive = (item.drive ?? 75) * driveMul;
  const delay = (item.delayMs ?? 0) + g.delayMs;
  return { ...item, drive: Math.max(0, Math.min(150, drive)), delayMs: delay };
}

// =============== SPL coverage heatmap ===============

/**
 * Source SPL@1m for a single source, including drive and (for line arrays) the
 * coherent stacking gain. Excludes distance / dispersion / air loss.
 *
 * Convention used here:
 *   • `sensitivity + 10·log₁₀(power)` when both are present (preferred).
 *   • Falls back to `maxSPL - 28` as a rough proxy when not.
 *   • Stage monitors are NOT penalized here — they're directional speakers and
 *     the dispersion model handles audience spill correctly when the monitor's
 *     aim is set toward the performer (default templates do this).
 *   • IEM transmitters are non-acoustic — return -Infinity (zero energy).
 */
export function speakerSplAt1m(item: EquipmentItem): number {
  if (item.kind === 'speaker-iem') return -Infinity;
  let splAt1m: number;
  if (item.sensitivity != null && item.power != null) {
    splAt1m = item.sensitivity + 10 * Math.log10(Math.max(1, item.power));
  } else {
    splAt1m = (item.maxSPL ?? 130) - 28;
  }
  // Line-array stacking: N coherent boxes add 10·log₁₀(N) dB.
  if (item.kind === 'speaker-line-array') {
    const n = Math.max(1, item.boxes ?? 6);
    splAt1m += 10 * Math.log10(n);
  }
  const drive = (item.drive ?? 75) / 100;
  splAt1m += 20 * Math.log10(Math.max(0.05, drive));
  return splAt1m;
}

/**
 * Effective vertical coverage angle. For a splayed line array this is wider
 * than the single-box rated `vert`.
 */
export function effectiveVertCoverage(item: EquipmentItem): number {
  if (item.kind === 'speaker-line-array' && item.boxes && item.boxes > 1) {
    const splay = item.splay ?? 1.5;
    const base = item.vert ?? 10;
    return base + (item.boxes - 1) * splay;
  }
  return item.vert ?? 60;
}

/**
 * Maps the heatmap's band selector to a center-frequency in Hz so we can
 * weight per-speaker frequency response and crossovers.
 */
export function bandHz(freq: '125'|'1k'|'4k'|'broadband'): number {
  if (freq === '125') return 125;
  if (freq === '4k') return 4000;
  return 1000; // 1k AND broadband — broadband uses 1k as a representative band
}

/**
 * Attenuation in dB applied to a speaker's SPL contribution at a given band,
 * based on its frequency response (lfHz / hfHz) and any external crossovers
 * (xoverLowHz / xoverHighHz). 12 dB/octave roll-off outside the pass-band,
 * capped at 60 dB so a sub at 1k just contributes very little instead of -∞.
 */
export function bandResponseAttenuation(item: EquipmentItem, bHz: number): number {
  const lf = Math.max(item.lfHz ?? 0, item.xoverLowHz ?? 0);
  const hf = Math.min(item.hfHz ?? Infinity, item.xoverHighHz ?? Infinity);
  if (bHz >= lf && bHz <= hf) return 0;
  if (bHz < lf && lf > 0) {
    const oct = Math.log2(lf / Math.max(20, bHz));
    return Math.min(60, 12 * oct);
  }
  if (bHz > hf && isFinite(hf)) {
    const oct = Math.log2(bHz / Math.max(20, hf));
    return Math.min(60, 12 * oct);
  }
  return 0;
}

// =============== Measured polar / directivity lookup ===============

/** Linearly interpolate between two values. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Look up the polar attenuation in dB at a given (angle, frequency) using
 * bilinear interpolation. Returns 0 if no curve is present for the axis.
 *
 * Symmetric polars (only 0..180) are handled by mirroring on |angleDeg|.
 * Out-of-range angles fall back to the nearest endpoint.
 */
function polarCurveAttenuationDb(
  angles: number[],
  curves: number[][],
  freqs: number[],
  angleDeg: number,
  freqHz: number,
): number {
  if (!angles.length || !curves.length || !freqs.length) return 0;
  // Symmetric polars: if all angles are >= 0, mirror on the absolute angle.
  const minAng = angles[0];
  const aQ = minAng >= 0 ? Math.abs(angleDeg) : angleDeg;

  // Find angle bracket
  let aLo = 0, aHi = angles.length - 1;
  if (aQ <= angles[0]) aLo = aHi = 0;
  else if (aQ >= angles[angles.length - 1]) aLo = aHi = angles.length - 1;
  else {
    for (let i = 0; i < angles.length - 1; i++) {
      if (angles[i] <= aQ && angles[i + 1] >= aQ) { aLo = i; aHi = i + 1; break; }
    }
  }
  const tA = aLo === aHi ? 0 : (aQ - angles[aLo]) / (angles[aHi] - angles[aLo]);

  // Find frequency bracket
  let fLo = 0, fHi = freqs.length - 1;
  const fQ = Math.max(20, freqHz);
  if (fQ <= freqs[0]) fLo = fHi = 0;
  else if (fQ >= freqs[freqs.length - 1]) fLo = fHi = freqs.length - 1;
  else {
    for (let i = 0; i < freqs.length - 1; i++) {
      if (freqs[i] <= fQ && freqs[i + 1] >= fQ) { fLo = i; fHi = i + 1; break; }
    }
  }
  // Frequency interpolation in log domain (musical centers are log-spaced).
  const tF = fLo === fHi
    ? 0
    : (Math.log2(fQ) - Math.log2(freqs[fLo])) / (Math.log2(freqs[fHi]) - Math.log2(freqs[fLo]));

  const v00 = curves[fLo][aLo];
  const v10 = curves[fLo][aHi];
  const v01 = curves[fHi][aLo];
  const v11 = curves[fHi][aHi];
  const vBottom = lerp(v00, v10, tA);
  const vTop = lerp(v01, v11, tA);
  return lerp(vBottom, vTop, tF);
}

/**
 * Total off-axis attenuation in dB combining horizontal + vertical polars.
 * Returns null when neither H nor V polar is present (so the caller can
 * fall back to the elliptical Gaussian model).
 *
 * When only one axis is provided, the missing axis is treated as 0 dB
 * (i.e. on-axis), which is correct for symmetric loudspeakers measured
 * on a single great-circle.
 */
export function polarAttenuationDb(
  polar: PolarData | undefined,
  hAngleDeg: number,
  vAngleDeg: number,
  freqHz: number,
): number | null {
  if (!polar) return null;
  const haveH = polar.hAngles && polar.hPolar && polar.hPolar.length > 0;
  const haveV = polar.vAngles && polar.vPolar && polar.vPolar.length > 0;
  if (!haveH && !haveV) return null;
  const hLoss = haveH
    ? polarCurveAttenuationDb(polar.hAngles!, polar.hPolar!, polar.freqs, hAngleDeg, freqHz)
    : 0;
  const vLoss = haveV
    ? polarCurveAttenuationDb(polar.vAngles!, polar.vPolar!, polar.freqs, vAngleDeg, freqHz)
    : 0;
  // Combine independently (separable approximation — good for most boxes
  // unless the polar has strong cross-axis coupling, which is rare).
  return hLoss + vLoss;
}

/** Should this item participate in the acoustic obstacle / absorption model? */
export function affectsAcoustics(item: EquipmentItem): boolean {
  if (item.affectsAcoustics !== undefined) return item.affectsAcoustics;
  // Acoustic panels are already accounted for in the absorption sum; reference points are logical-only.
  if (item.category === 'reference') return false;
  if (item.category === 'acoustic') return false;
  // Non-physical / negligible kinds.
  if (item.kind === 'speaker-iem' || item.kind === 'cable-run') return false;
  return true;
}

/**
 * Pull the items that count as physical obstacles for line-of-sight diffraction.
 * Excludes: reference points, acoustic panels (already absorbed), and the source itself.
 */
function obstacleSet(items: EquipmentItem[], excludeId?: string): EquipmentItem[] {
  return items.filter(o =>
    o.id !== excludeId &&
    affectsAcoustics(o) &&
    (o.width ?? 0) * (o.depth ?? 0) > 0.5  // only items with a meaningful footprint
  );
}

/** Slab-method ray/AABB intersection — returns true if the segment crosses the box. */
function segmentHitsBox(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  box: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
): boolean {
  let tmin = 0, tmax = 1;
  const segs: [number, number, number, number][] = [
    [b.x - a.x, a.x, box.minX, box.maxX],
    [b.y - a.y, a.y, box.minY, box.maxY],
    [b.z - a.z, a.z, box.minZ, box.maxZ],
  ];
  for (const [d, p0, lo, hi] of segs) {
    if (Math.abs(d) < 1e-6) {
      if (p0 < lo || p0 > hi) return false;
      continue;
    }
    let t1 = (lo - p0) / d;
    let t2 = (hi - p0) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  return tmin < 1 && tmax > 0;
}

// =============== Diffraction geometry (Maekawa) ===============

/** The 12 edges of an axis-aligned bounding box. Used to find the diffracting
 *  edge — the edge of an obstacle around which the sound bends to reach the
 *  listener with minimum extra path length. */
function aabbEdges(box: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }): Array<{ a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number } }> {
  const { minX, maxX, minY, maxY, minZ, maxZ } = box;
  const E = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
    ({ a: { x: ax, y: ay, z: az }, b: { x: bx, y: by, z: bz } });
  return [
    // x-aligned (4)
    E(minX, minY, minZ, maxX, minY, minZ),
    E(minX, maxY, minZ, maxX, maxY, minZ),
    E(minX, minY, maxZ, maxX, minY, maxZ),
    E(minX, maxY, maxZ, maxX, maxY, maxZ),
    // y-aligned (4)
    E(minX, minY, minZ, minX, maxY, minZ),
    E(maxX, minY, minZ, maxX, maxY, minZ),
    E(minX, minY, maxZ, minX, maxY, maxZ),
    E(maxX, minY, maxZ, maxX, maxY, maxZ),
    // z-aligned (4)
    E(minX, minY, minZ, minX, minY, maxZ),
    E(maxX, minY, minZ, maxX, minY, maxZ),
    E(minX, maxY, minZ, minX, maxY, maxZ),
    E(maxX, maxY, minZ, maxX, maxY, maxZ),
  ];
}

/** Closest point on segment AB to the infinite line passing through PQ.
 *  Solves the 2x2 system for the segment-line nearest-approach parameters,
 *  then clamps to the segment. */
function closestPointOnSegmentToLine(
  A: { x: number; y: number; z: number },
  B: { x: number; y: number; z: number },
  P: { x: number; y: number; z: number },
  Q: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const ux = B.x - A.x, uy = B.y - A.y, uz = B.z - A.z;
  const vx = Q.x - P.x, vy = Q.y - P.y, vz = Q.z - P.z;
  const wx = A.x - P.x, wy = A.y - P.y, wz = A.z - P.z;
  const a = ux * ux + uy * uy + uz * uz;
  const b = ux * vx + uy * vy + uz * vz;
  const c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz;
  const e = vx * wx + vy * wy + vz * wz;
  const denom = a * c - b * b;
  let t: number;
  if (Math.abs(denom) < 1e-9 || a < 1e-9) {
    t = 0; // segment degenerate or parallel to line — pick endpoint
  } else {
    t = (b * e - c * d) / denom;
  }
  const tClamped = Math.max(0, Math.min(1, t));
  return { x: A.x + tClamped * ux, y: A.y + tClamped * uy, z: A.z + tClamped * uz };
}

/**
 * Maekawa diffraction insertion loss in dB given a Fresnel number N.
 *
 * Uses the Kurze–Anderson form of Maekawa's empirical fit:
 *   IL = 5 + 20·log₁₀(√(2πN) / tanh(√(2πN)))   for N > 0
 *   IL = 0                                       for N ≤ 0 (LOS clear)
 *
 * Real-world barriers cap at ~24–25 dB (residual transmission through the
 * barrier and around-the-edges paths impose a floor on what a single barrier
 * can attenuate); we cap at 25 dB to match.
 */
export function maekawaIL(N: number): number {
  if (N <= 0) return 0;
  const x = Math.sqrt(2 * Math.PI * N);
  const t = Math.tanh(x);
  if (t <= 0) return 25;
  const IL = 5 + 20 * Math.log10(x / t);
  if (IL <= 0) return 0;
  return Math.min(25, IL);
}

// =============== Air absorption (ANSI S1.26 / ISO 9613-1) ===============

/**
 * Atmospheric air absorption coefficient α in dB/m at a given pure-tone
 * frequency, temperature, and relative humidity. Implements the canonical
 * ISO 9613-1 (= ANSI S1.26) two-relaxation formulation: the absorption
 * coefficient is the sum of classical, oxygen-relaxation, and nitrogen-
 * relaxation terms.
 *
 * Inputs:
 *   freqHz          — pure-tone frequency in Hz
 *   tempF           — temperature in °F (default 70 °F ≈ 21 °C)
 *   relHumidity     — relative humidity in % (default 50 %)
 *   pressureKpa     — atmospheric pressure in kPa (default sea level)
 *
 * Returns dB/m. Multiply by path length to get total air loss.
 */
export function airAbsorptionDbPerM(
  freqHz: number,
  tempF: number = 70,
  relHumidity: number = 50,
  pressureKpa: number = 101.325,
): number {
  if (freqHz <= 0) return 0;
  const T = (tempF - 32) * (5 / 9) + 273.15;       // °F → K
  const T0 = 293.15;                                // 20 °C reference
  const T01 = 273.16;                               // triple point
  const pr = 101.325;
  const pa_pr = pressureKpa / pr;

  // Saturation vapor pressure (Davis 1971 / Bass): C = log10(psat/pr)
  const C = -6.8346 * Math.pow(T01 / T, 1.261) + 4.6151;
  const psat_pr = Math.pow(10, C);
  const h = relHumidity * psat_pr / pa_pr;          // molar concentration of H2O (%)

  // Oxygen + nitrogen relaxation frequencies
  const frO = pa_pr * (24 + 4.04e4 * h * (0.02 + h) / (0.391 + h));
  const frN = pa_pr * Math.pow(T / T0, -0.5) *
              (9 + 280 * h * Math.exp(-4.17 * (Math.pow(T / T0, -1 / 3) - 1)));

  const f2 = freqHz * freqHz;
  const alpha = 8.686 * f2 * (
    1.84e-11 * (1 / pa_pr) * Math.pow(T / T0, 0.5) +
    Math.pow(T / T0, -2.5) * (
      0.01275 * Math.exp(-2239.1 / T) / (frO + f2 / frO) +
      0.1068 * Math.exp(-3352 / T)   / (frN + f2 / frN)
    )
  );
  return alpha; // dB/m
}

/** Pre-compute air absorption per octave band — much cheaper than calling
 *  ansiAirAbsorption() per cell, since it only depends on room conditions. */
export function airCoeffsPerBand(
  tempF: number = 70,
  relHumidity: number = 50,
): Record<OctaveBand, number> {
  const out: Partial<Record<OctaveBand, number>> = {};
  for (const b of OCTAVE_BANDS) {
    out[b] = airAbsorptionDbPerM(b, tempF, relHumidity);
  }
  return out as Record<OctaveBand, number>;
}

/**
 * Convert each interior WallObstacle (Sprint C12 — balcony fronts, stage-
 * riser fronts, half-walls) into a phantom `EquipmentItem` shaped so the
 * existing direct-field Maekawa blockage code (`obstructionLossDb`) treats
 * it as a thin axis-aligned-bounding-box obstacle.
 *
 * The bounding box covers the wall obstacle's full xy-segment + a small
 * default thickness (0.5 ft). For non-axis-aligned wall obstacles, the AABB
 * is the segment's bounding rectangle — slightly conservative (over-blocks
 * a few rays that just graze the segment), but the existing Maekawa
 * detour-around-corner test handles this gracefully.
 */
export function wallObstaclesToObstacleItems(
  obstacles: import('../types').WallObstacle[],
): EquipmentItem[] {
  const out: EquipmentItem[] = [];
  for (const w of obstacles) {
    const cx = (w.start.x + w.end.x) / 2;
    const cy = (w.start.y + w.end.y) / 2;
    const dx = w.end.x - w.start.x;
    const dy = w.end.y - w.start.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 1e-3) continue;
    if (w.topZ <= w.bottomZ) continue;
    // AABB: width = segment length × |cos| + thickness × |sin|, etc.
    // Cheaper conservative version: use the actual xy bounds of the segment.
    const minX = Math.min(w.start.x, w.end.x);
    const maxX = Math.max(w.start.x, w.end.x);
    const minY = Math.min(w.start.y, w.end.y);
    const maxY = Math.max(w.start.y, w.end.y);
    const thickness = 0.5;
    const width  = Math.max(thickness, maxX - minX);
    const depth  = Math.max(thickness, maxY - minY);
    out.push({
      id: `wall-obstacle-${w.id}`,
      templateId: 'wall-obstacle',
      kind: 'reference-point',         // arbitrary kind — not rendered as gear
      category: 'reference',
      label: w.label ?? 'Wall obstacle',
      x: cx, y: cy, z: w.bottomZ,
      rotation: 0,
      width,
      depth,
      itemHeight: w.topZ - w.bottomZ,
      affectsAcoustics: true,           // explicit override — affects diffraction
    });
  }
  return out;
}

/**
 * Sum Maekawa-style obstruction loss across every leg of a bent reflection
 * path. For order-0 (direct), `points` is [speaker, listener] and this is
 * exactly equivalent to the single-segment obstructionLossDb. For higher
 * orders, an obstacle that blocks an intermediate leg (e.g. the segment
 * between two corner reflection points) correctly attenuates the path.
 *
 * Result is capped at 25 dB total — the same physical ceiling as the
 * single-segment helper.
 */
export function pathObstructionLossDb(
  points: { x: number; y: number; z: number }[],
  obstacles: EquipmentItem[],
  bHz: number,
): number {
  if (obstacles.length === 0 || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += obstructionLossDb(points[i - 1], points[i], obstacles, bHz);
    if (total >= 25) return 25;
  }
  return total;
}

/**
 * Maekawa diffraction loss across all obstacles blocking line-of-sight.
 *
 * For each obstacle whose AABB the LOS pierces:
 *   1. Find the diffracting edge — whichever of the box's 12 edges yields
 *      the smallest detour kink (path S → edge_point → R) when the closest
 *      point on the edge to the LOS line is used as the kink point.
 *   2. δ = detour_length − direct_length (the path-length difference).
 *   3. Fresnel number N = 2δ / λ at the band's wavelength.
 *   4. IL = Maekawa(N), capped at 25 dB.
 *
 * This matches real-world frequency dependence (HF diffracts less → more loss)
 * AND geometry dependence (a barely-grazing obstacle gives small δ → small
 * loss; a deeply-blocking obstacle gives large δ → large loss). Replaces the
 * earlier flat per-band constants.
 */
export function obstructionLossDb(
  speaker: { x: number; y: number; z: number },
  listener: { x: number; y: number; z: number },
  obstacles: EquipmentItem[],
  bHz: number,
): number {
  if (obstacles.length === 0) return 0;
  const lambdaM = SPEED_OF_SOUND_M_S / Math.max(20, bHz);

  const dx = listener.x - speaker.x;
  const dy = listener.y - speaker.y;
  const dz = listener.z - speaker.z;
  const directFt = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (directFt < 1e-3) return 0;

  let total = 0;
  for (const o of obstacles) {
    const hw = (o.width ?? 0) / 2;
    const hd = (o.depth ?? 0) / 2;
    if (hw <= 0 || hd <= 0) continue;
    const hh = (o.itemHeight ?? Math.max(0.5, o.z * 0.2 + 1));
    const box = {
      minX: o.x - hw, maxX: o.x + hw,
      minY: o.y - hd, maxY: o.y + hd,
      minZ: o.z,        maxZ: o.z + hh,
    };
    if (!segmentHitsBox(speaker, listener, box)) continue;

    // Find the smallest detour over all 12 edges.
    let minDeltaFt = Infinity;
    for (const edge of aabbEdges(box)) {
      const T = closestPointOnSegmentToLine(edge.a, edge.b, speaker, listener);
      const ax = T.x - speaker.x, ay = T.y - speaker.y, az = T.z - speaker.z;
      const bx = listener.x - T.x, by = listener.y - T.y, bz = listener.z - T.z;
      const detour = Math.sqrt(ax * ax + ay * ay + az * az)
                   + Math.sqrt(bx * bx + by * by + bz * bz);
      const delta = detour - directFt;
      if (delta < minDeltaFt) minDeltaFt = delta;
    }
    if (!isFinite(minDeltaFt) || minDeltaFt <= 0) continue;

    const deltaM = minDeltaFt * 0.3048;
    const N = 2 * deltaM / lambdaM;
    total += maekawaIL(N);
    if (total >= 25) return 25;
  }
  return total;
}

/**
 * Predicted SPL from one source at a listener point.
 *
 * Models:
 *   • Inverse-square distance loss (20·log₁₀ r/1m)
 *   • Elliptical 3D off-axis loss in (horiz, vert) — yes, vertical tilt matters.
 *     -6 dB at the edge of rated coverage angle, then +12 dB per doubling beyond.
 *   • Frequency-dependent dispersion broadening (HF tighter, LF wider).
 *   • Per-band air absorption — full ANSI S1.26 model when room conditions are
 *     supplied via `airCoeffs`. Falls back to room-temperature defaults.
 *   • Per-speaker frequency response + external crossovers (12 dB/oct rolloff).
 *   • Optional obstacle diffraction loss when other physical items break LOS.
 *   • Subs (`horiz ≥ 350°`) are treated as omnidirectional.
 *   • Cardioid-flagged subs use a unipolar-cardioid pattern with rear rejection.
 *   • IEMs are non-acoustic — return -Infinity.
 */
export function speakerSPL(
  item: EquipmentItem,
  lp: Point & { z: number },
  freq: '125'|'1k'|'4k'|'broadband' = 'broadband',
  obstacles: EquipmentItem[] = [],
  airCoeffs?: Record<OctaveBand, number>,
): number {
  if (item.kind === 'speaker-iem') return -Infinity;

  const dx = lp.x - item.x;
  const dy = lp.y - item.y;
  const dz = lp.z - item.z;
  const distFt = Math.sqrt(dx*dx + dy*dy + dz*dz);
  const dM = Math.max(0.5, distFt * 0.3048);
  const distXY = Math.sqrt(dx*dx + dy*dy) || 1e-6;

  const horizCov = item.horiz ?? 90;
  const vertCov = effectiveVertCoverage(item);
  const isOmni = horizCov >= 350;
  const isCardioid = !!item.cardioid;
  const havePolar = !!item.polar &&
    ((item.polar.hPolar && item.polar.hPolar.length > 0) ||
     (item.polar.vPolar && item.polar.vPolar.length > 0));

  // Pre-compute aim-relative angles — used by the polar lookup AND the
  // elliptical fallback.
  const aimYawRad = (item.aim ?? 90) * Math.PI / 180;
  const aimTiltDeg = item.tilt ?? 0;
  const ax = Math.cos(aimYawRad);
  const ay = Math.sin(aimYawRad);
  const cosH = (dx * ax + dy * ay) / (distXY || 1e-6);
  const hAngleAbs = Math.acos(Math.max(-1, Math.min(1, cosH))) * 180 / Math.PI;
  const elevToListenerDeg = Math.atan2(dz, distXY) * 180 / Math.PI;
  const vAngleSigned = elevToListenerDeg - aimTiltDeg;

  // ===== Off-axis loss =====
  let dispLoss = 0;
  if (isCardioid) {
    // Unipolar cardioid: response(θ) = (1 + cos(θ)) / 2 in pressure;
    // floored at -25 dB so the rear isn't truly silent (real arrays
    // achieve 15-25 dB rejection in practice).
    const cosTheta = cosH;
    const ampLin = Math.max(0.056, (1 + cosTheta) / 2);   // 0.056 ≈ -25 dB
    dispLoss = -20 * Math.log10(ampLin);
  } else if (havePolar) {
    // Use measured/synthetic polar data when available — supersedes both the
    // elliptical pattern and the freq-dependent broadening tweaks since real
    // measurements already encode all that frequency dependence.
    const bHzPolar = bandHz(freq);
    const polarLoss = polarAttenuationDb(item.polar, hAngleAbs, vAngleSigned, bHzPolar);
    dispLoss = polarLoss == null ? 0 : Math.max(0, -polarLoss);
  } else if (!isOmni) {
    const hRatio = hAngleAbs / Math.max(1, horizCov / 2);
    const vRatio = Math.abs(vAngleSigned) / Math.max(1, vertCov / 2);
    const r = Math.sqrt(hRatio * hRatio + vRatio * vRatio);
    if (r <= 1) dispLoss = r * 6;                       // 0 → −6 dB at the edge
    else        dispLoss = 6 + 12 * Math.log2(r);       // −12 dB per doubling beyond
    // HF tightens, LF widens (real polar broadens with wavelength)
    if (freq === '4k') dispLoss *= 1.3;
    else if (freq === '125') dispLoss *= 0.55;
  }

  // ===== Distance + air absorption =====
  const distLoss = 20 * Math.log10(dM);
  // Air absorption: prefer the precomputed per-band coeffs (ANSI S1.26 with
  // current room temp/humidity). Fall back to defaults if not supplied.
  const bHzAir = bandHz(freq);
  const bandClosest: OctaveBand =
    bHzAir <= 125 ? 125 :
    bHzAir <= 250 ? 250 :
    bHzAir <= 500 ? 500 :
    bHzAir <= 1000 ? 1000 :
    bHzAir <= 2000 ? 2000 : 4000;
  const coeffs = airCoeffs ?? DEFAULT_AIR_COEFFS;
  const airLoss = dM * (coeffs[bandClosest] ?? 0);

  // ===== Per-speaker frequency response + crossovers =====
  const bHz = bandHz(freq);
  const bandLoss = bandResponseAttenuation(item, bHz);

  // ===== Obstacle diffraction (line-of-sight blockage) =====
  const obstLoss = obstacles.length > 0
    ? obstructionLossDb(item, lp, obstacles, bHz)
    : 0;

  return speakerSplAt1m(item) - distLoss - dispLoss - airLoss - bandLoss - obstLoss;
}

export function combinedSPL(splList: number[]): number {
  if (!splList.length) return 0;
  let lin = 0;
  for (const s of splList) lin += Math.pow(10, s / 10);
  return lin > 0 ? 10 * Math.log10(lin) : 0;
}

// =============== Coherent (phase-aware) source summation ===============
// When two sources radiate the same signal to a listener with different path
// lengths, their pressures add as COMPLEX numbers (with phase from path
// length × frequency), not as energy magnitudes. The result is a
// frequency-dependent comb pattern: 0 / λ phase difference → +6 dB peak,
// π → near-null. This is what makes subwoofer coverage uneven and what
// makes a first-order reflection audibly cancel the direct sound at certain
// frequencies and seats — a phenomenon plain energy summation can't model.
//
// In real rooms, full coherence holds well at low frequencies (long
// wavelengths, robust patterns) and decays toward incoherent at high
// frequencies (HF wavelengths are tiny — head movement, room scattering,
// finite source size all decorrelate). We blend coherent and incoherent
// sums via a frequency-dependent coherence factor.

export interface SourceContribution {
  /** SPL in dB at the listener after distance / dispersion / air / refl. */
  spl: number;
  /** Total acoustic path length in feet. Drives phase = ω·t = 2π·f·(L/c). */
  pathFt: number;
  /** Source-side electronic delay in ms. Adds to the path-derived time
   *  delay so a delay-speaker contribution lines up correctly when the
   *  geometry warrants it. */
  delayMs?: number;
}

/**
 * Frequency-dependent coherence factor (0 = pure incoherent, 1 = pure
 * coherent). At LF wavelengths are large and phase patterns are robust;
 * at HF wavelengths are tiny and listener-position jitter / room
 * scattering wash out the comb pattern. Below 250 Hz we treat the world
 * as fully coherent; above 2 kHz we treat it as nearly incoherent. The
 * crossover is log-linear between them.
 */
export function coherenceFactor(freqHz: number): number {
  if (freqHz <= 250) return 1.0;
  if (freqHz >= 2000) return 0.1;
  const t = (Math.log2(freqHz) - Math.log2(250)) / (Math.log2(2000) - Math.log2(250));
  return 1.0 - 0.9 * t;          // 1.0 at 250 Hz, 0.1 at 2 kHz
}

/**
 * Phase-aware combined SPL across multiple source contributions.
 *
 * Energy result is a blend:
 *   |p_total|² = α · |Σ pᵢ · e^(iφᵢ)|² + (1−α) · Σ |pᵢ|²
 *
 *   where pᵢ is the linear pressure ratio (10^(SPLᵢ/20)),
 *         φᵢ = 2π·f·(Lᵢ/c + Δᵢ),
 *         α   = coherence factor at f.
 *
 * For broadband or `coherence = 0`, falls back to plain energy sum so
 * the result matches `combinedSPL`.
 */
export function coherentCombinedSPL(
  contributions: SourceContribution[],
  freqHz: number,
  coherence: number = 1.0,
): number {
  if (!contributions.length) return 0;
  if (coherence <= 0 || freqHz <= 0) {
    return combinedSPL(contributions.map(c => c.spl));
  }
  const omega = 2 * Math.PI * freqHz;
  let re = 0, im = 0;
  let energyIncoh = 0;
  for (const { spl, pathFt, delayMs = 0 } of contributions) {
    if (!isFinite(spl)) continue;
    const p = Math.pow(10, spl / 20);
    // Time-of-flight in seconds → phase
    const t = (pathFt * FT_TO_M) / SPEED_OF_SOUND_M_S + delayMs / 1000;
    const phase = omega * t;
    re += p * Math.cos(phase);
    im += p * Math.sin(phase);
    energyIncoh += p * p;
  }
  const energyCoh = re * re + im * im;
  const blended = coherence * energyCoh + (1 - coherence) * energyIncoh;
  if (blended <= 0) return 0;
  return 20 * Math.log10(Math.sqrt(blended));
}

export function computeHeatmap(
  room: RoomState,
  speakers: EquipmentItem[],
  freq: '125'|'1k'|'4k'|'broadband',
  resolutionFt: number = 2,
  earHeightFt: number = 4,
  obstacleItems: EquipmentItem[] = [],
  useReflections: boolean = false,
  /** Max ISM bounce order. Sprint 2 default = 2 (corner reflections + ceiling).
   *  Higher values approach EASE-class but blow up image-source count by N×. */
  maxOrder: number = 2,
  /** Zones — used to blend audience seating material into the floor's
   *  reflection coefficient (C2). Optional for backward compat. */
  zones: import('../types').Zone[] = [],
  /** When true, sum source contributions as complex pressures (phase from
   *  path length × frequency). Reveals comb-filter nulls between
   *  coincident speakers and between direct + reflection paths. */
  useCoherentSum: boolean = false,
): HeatmapData | null {
  if (!speakers.length) return null;
  const bb = bboxOf(room.shape);
  const cellW = resolutionFt;
  const cellH = resolutionFt;
  const gridX = Math.max(2, Math.ceil(bb.width / cellW));
  const gridY = Math.max(2, Math.ceil(bb.depth / cellH));
  const grid: number[][] = [];
  let max = -Infinity, min = Infinity, sum = 0, n = 0;
  const valuesForStd: number[] = [];

  // Pre-filter obstacles once. Passing each speaker its own list (excluding itself)
  // means a sub never blocks its own coverage, but a tower can block the sub.
  // Sprint C12 — interior wall obstacles (balcony fronts, etc.) become
  // phantom obstacle items so the existing per-leg Maekawa code blocks
  // direct sound for under-balcony shadow zones automatically.
  const wallObstacleItems = wallObstaclesToObstacleItems(room.wallObstacles ?? []);
  const allObstacles = obstacleSet([...obstacleItems, ...wallObstacleItems]);

  // Pre-compute the room's surfaces and per-speaker image sources up to
  // maxOrder. Surface set is shared across all speakers; image sources
  // are per-speaker because the mirror geometry is anchored to the speaker's
  // physical position.
  const surfaces = useReflections
    ? buildRoomSurfaces(room, { floorAlphaOverride: effectiveFloorAlpha(room, zones ?? []) })
    : [];
  const imagesPerSpeaker: ImageSource[][] = useReflections
    ? speakers.map(sp => generateImageSources(sp, surfaces, maxOrder))
    : speakers.map(() => []);
  const reflBandKey = bandKeyForFreq(freq);

  // Per-band air absorption from the room's current temp/humidity (ANSI S1.26).
  const airCoeffs = airCoeffsPerBand(room.temperatureF ?? 70, room.relHumidity ?? 50);

  for (let j = 0; j < gridY; j++) {
    const row: number[] = [];
    for (let i = 0; i < gridX; i++) {
      const x = bb.minX + (i + 0.5) * cellW;
      const y = bb.minY + (j + 0.5) * cellH;
      // Per-cell sampling height — zones with floor / ear-height overrides
      // (balconies, raised stages) sample above the global default; cells
      // outside any override zone use earHeightFt directly.
      const cellZ = earHeightAt(x, y, zones, earHeightFt);
      const lp = { x, y, z: cellZ };
      // Skip cells outside the room polygon.
      if (!pointInPolygon({ x, y }, room.shape)) {
        row.push(NaN);
        continue;
      }
      // Build a flat list of all contributions (direct + every audible
      // image, across all speakers) so the coherent combiner can sum them
      // with proper phase relationships when enabled. With useCoherentSum
      // off, we still pass through the same combiner — coherence=0 makes
      // it equivalent to the legacy energy sum.
      const contributions: SourceContribution[] = [];
      const imgBHz = bandHz(freq);
      const lambdaMRefl = SPEED_OF_SOUND_M_S / Math.max(20, imgBHz);
      for (let idx = 0; idx < speakers.length; idx++) {
        const sp = speakers[idx];
        const blockers = allObstacles.filter(o => o.id !== sp.id);
        const direct = speakerSPL(sp, lp, freq, blockers, airCoeffs);
        if (isFinite(direct)) {
          const dx = lp.x - sp.x, dy = lp.y - sp.y, dz = lp.z - sp.z;
          contributions.push({
            spl: direct,
            pathFt: Math.sqrt(dx * dx + dy * dy + dz * dz),
            delayMs: sp.delayMs ?? 0,
          });
        }
        if (!useReflections) continue;
        const imgs = imagesPerSpeaker[idx];
        for (let k = 0; k < imgs.length; k++) {
          const img = imgs[k];
          if (img.order === 0) continue;
          const ap = audiblePath(img, lp);
          if (!ap) continue;
          const synth = imageAsEquipmentItem(sp, img);
          const splImg = speakerSPL(synth, lp, freq, [], airCoeffs);
          if (!isFinite(splImg)) continue;
          const refLoss = img.reflectionLossDb[reflBandKey];
          const pathBlock = pathObstructionLossDb(ap.points, blockers, imgBHz);
          // Edge softening — when a bounce point is within λ/2 of its
          // surface's boundary, the specular reflection fuzzes toward
          // edge diffraction. Sum across all bounces, cap at 10 dB.
          let edgeSoft = 0;
          for (let bIdx = 0; bIdx < img.chain.length; bIdx++) {
            const surface = img.chain[bIdx];
            const R = ap.points[bIdx + 1];
            const d = surface.distanceToEdgeFt(R);
            edgeSoft += edgeSofteningLossDb(d, lambdaMRefl);
            if (edgeSoft >= 10) { edgeSoft = 10; break; }
          }
          const splNet = splImg - refLoss - pathBlock - edgeSoft;
          if (splNet < -10) continue;
          contributions.push({
            spl: splNet,
            pathFt: ap.totalDistFt,
            delayMs: sp.delayMs ?? 0,
          });
        }
      }
      // Broadband + coherent makes no physical sense — broadband is the
      // average of many bands, and coherent comb patterns at any single
      // frequency don't survive that averaging.
      const coherence = (useCoherentSum && freq !== 'broadband')
        ? coherenceFactor(imgBHz)
        : 0;
      const s = coherence > 0
        ? coherentCombinedSPL(contributions, imgBHz, coherence)
        : combinedSPL(contributions.map(c => c.spl));
      row.push(s);
      if (s > max) max = s;
      if (s < min) min = s;
      sum += s; n += 1;
      valuesForStd.push(s);
    }
    grid.push(row);
  }

  const avg = n ? sum / n : 0;
  let std = 0;
  if (n > 1) {
    let v = 0;
    for (const s of valuesForStd) v += (s - avg) ** 2;
    std = Math.sqrt(v / (n - 1));
  }

  return {
    grid,
    cellW, cellH,
    minX: bb.minX, minY: bb.minY,
    gridX, gridY,
    min: isFinite(min) ? min : 0,
    max: isFinite(max) ? max : 0,
    avg,
    std,
  };
}

// SPL color based on dB value (matches design's blue→amber→red scale)
export function splColor(spl: number, lo = 65, hi = 100): string {
  if (!isFinite(spl)) return 'rgba(0,0,0,0)';
  const t = Math.max(0, Math.min(1, (spl - lo) / (hi - lo)));
  const stops: [number, [number, number, number]][] = [
    [0.00, [26, 79, 191]],
    [0.30, [46, 135, 245]],
    [0.50, [47, 158, 94]],
    [0.75, [245, 166, 35]],
    [1.00, [197, 48, 48]],
  ];
  for (let k = 0; k < stops.length - 1; k++) {
    const [t0, c0] = stops[k], [t1, c1] = stops[k+1];
    if (t >= t0 && t <= t1) {
      const u = (t - t0) / (t1 - t0);
      const r = Math.round(c0[0] + (c1[0]-c0[0]) * u);
      const g = Math.round(c0[1] + (c1[1]-c0[1]) * u);
      const b = Math.round(c0[2] + (c1[2]-c0[2]) * u);
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'rgb(120,120,120)';
}

// =============== Time-of-arrival map ===============
// For each cell, the earliest arriving source's time-of-flight (in ms). Useful
// for finding Haas / precedence-effect issues — a delay speaker that arrives
// before the front-of-house at any seat means the Haas zone is wrong.

const SPEED_OF_SOUND_FT_PER_MS = 1.125; // 343 m/s ≈ 1125 ft/s ≈ 1.125 ft/ms

export function computeArrivalMap(
  room: RoomState,
  speakers: EquipmentItem[],
  resolutionFt: number = 2,
  earHeightFt: number = 4,
  // Arrival uses pure geometry — no obstacle parameter, since first-arrival time
  // doesn't change much from a small diffraction path-length increase.
  zones: import('../types').Zone[] = [],
): HeatmapData | null {
  if (!speakers.length) return null;
  const bb = bboxOf(room.shape);
  const cellW = resolutionFt;
  const cellH = resolutionFt;
  const gridX = Math.max(2, Math.ceil(bb.width / cellW));
  const gridY = Math.max(2, Math.ceil(bb.depth / cellH));
  const grid: number[][] = [];
  let max = -Infinity, min = Infinity, sum = 0, n = 0;
  const vals: number[] = [];

  for (let j = 0; j < gridY; j++) {
    const row: number[] = [];
    for (let i = 0; i < gridX; i++) {
      const x = bb.minX + (i + 0.5) * cellW;
      const y = bb.minY + (j + 0.5) * cellH;
      if (!pointInPolygon({ x, y }, room.shape)) {
        row.push(NaN);
        continue;
      }
      const cellZ = earHeightAt(x, y, zones, earHeightFt);
      let earliest = Infinity;
      for (const sp of speakers) {
        if (sp.kind === 'speaker-iem') continue;
        const dx = x - sp.x, dy = y - sp.y, dz = cellZ - sp.z;
        const dFt = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const tofMs = dFt / SPEED_OF_SOUND_FT_PER_MS + (sp.delayMs ?? 0);
        if (tofMs < earliest) earliest = tofMs;
      }
      if (!isFinite(earliest)) { row.push(NaN); continue; }
      row.push(earliest);
      if (earliest > max) max = earliest;
      if (earliest < min) min = earliest;
      sum += earliest; n += 1;
      vals.push(earliest);
    }
    grid.push(row);
  }
  const avg = n ? sum / n : 0;
  let std = 0;
  if (n > 1) {
    let v = 0;
    for (const s of vals) v += (s - avg) ** 2;
    std = Math.sqrt(v / (n - 1));
  }
  return {
    grid, cellW, cellH,
    minX: bb.minX, minY: bb.minY, gridX, gridY,
    min: isFinite(min) ? min : 0, max: isFinite(max) ? max : 0, avg, std,
  };
}

// Color for time-of-arrival. Cooler (blue) = earlier; warmer = later.
export function arrivalColor(ms: number, lo = 0, hi = 80): string {
  if (!isFinite(ms)) return 'rgba(0,0,0,0)';
  const t = Math.max(0, Math.min(1, (ms - lo) / (hi - lo)));
  const stops: [number, [number, number, number]][] = [
    [0.00, [26, 79, 191]],
    [0.30, [46, 135, 245]],
    [0.55, [47, 158, 94]],
    [0.80, [245, 166, 35]],
    [1.00, [197, 48, 48]],
  ];
  for (let k = 0; k < stops.length - 1; k++) {
    const [t0, c0] = stops[k], [t1, c1] = stops[k+1];
    if (t >= t0 && t <= t1) {
      const u = (t - t0) / (t1 - t0);
      const r = Math.round(c0[0] + (c1[0]-c0[0]) * u);
      const g = Math.round(c0[1] + (c1[1]-c0[1]) * u);
      const b = Math.round(c0[2] + (c1[2]-c0[2]) * u);
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'rgb(120,120,120)';
}

// =============== Contour extraction ===============
// Marching-squares (linearly-interpolated) contour at a given level over a
// HeatmapData grid. Returns an array of [worldX0, worldY0, worldX1, worldY1]
// tuples in feet — line segments to draw on the floor plane.

export function extractContour(heatmap: HeatmapData, level: number): number[][] {
  const out: number[][] = [];
  const { grid, gridX, gridY, cellW, cellH, minX, minY } = heatmap;
  // For each 2×2 cell, compute the marching-squares case.
  const inside = (v: number, l: number) => isFinite(v) && v >= l;
  for (let j = 0; j < gridY - 1; j++) {
    for (let i = 0; i < gridX - 1; i++) {
      const v00 = grid[j][i],     v10 = grid[j][i + 1];
      const v01 = grid[j + 1][i], v11 = grid[j + 1][i + 1];
      if (!isFinite(v00) || !isFinite(v10) || !isFinite(v01) || !isFinite(v11)) continue;
      const code =
        (inside(v00, level) ? 1 : 0) |
        (inside(v10, level) ? 2 : 0) |
        (inside(v11, level) ? 4 : 0) |
        (inside(v01, level) ? 8 : 0);
      if (code === 0 || code === 15) continue;

      const x0 = minX + i * cellW, x1 = minX + (i + 1) * cellW;
      const y0 = minY + j * cellH, y1 = minY + (j + 1) * cellH;
      const lerp = (a: number, b: number, va: number, vb: number) => a + (b - a) * (level - va) / (vb - va);
      // Edge intersections (only computed when needed)
      const top    = () => [lerp(x0, x1, v00, v10), y0];
      const right  = () => [x1, lerp(y0, y1, v10, v11)];
      const bottom = () => [lerp(x0, x1, v01, v11), y1];
      const left   = () => [x0, lerp(y0, y1, v00, v01)];

      const segs: [number[], number[]][] = [];
      switch (code) {
        case 1:  case 14: segs.push([top(), left()]); break;
        case 2:  case 13: segs.push([top(), right()]); break;
        case 4:  case 11: segs.push([right(), bottom()]); break;
        case 8:  case 7:  segs.push([left(), bottom()]); break;
        case 3:  case 12: segs.push([left(), right()]); break;
        case 6:  case 9:  segs.push([top(), bottom()]); break;
        case 5:  segs.push([top(), left()]); segs.push([right(), bottom()]); break;
        case 10: segs.push([top(), right()]); segs.push([left(), bottom()]); break;
      }
      for (const [a, b] of segs) out.push([a[0], a[1], b[0], b[1]]);
    }
  }
  return out;
}

// =============== C50 / C80 clarity ===============
// Clarity index — ratio of early-arriving energy (≤ T_early ms) to late-arriving
// energy. Standard values: C50 (50ms, speech), C80 (80ms, music).
//
// Practical model used here: combine direct-field SPL (1/d² roll-off, computed
// from speakers like the heatmap) with a Sabine-derived diffuse reverberant
// field, then use the RT60 to split late-vs-early reverb energy. This isn't
// CATT/EASE-grade ray tracing but produces values that line up well with
// real-world speech-vs-music classification.
//
// Returns dB. Higher = clearer. Speech target ≥ 0 dB at 50ms; ≥ 5 dB is good.

export function computeClarity(
  room: RoomState,
  speakers: EquipmentItem[],
  rt60Result: RT60Result | null,
  freq: '125'|'1k'|'4k'|'broadband',
  earlyMs: 50 | 80 = 50,
  resolutionFt: number = 2,
  earHeightFt: number = 4,
  obstacleItems: EquipmentItem[] = [],
  useReflections: boolean = false,
  maxOrder: number = 2,
  zones: import('../types').Zone[] = [],
): HeatmapData | null {
  if (!speakers.length || !rt60Result) return null;
  // Pick the RT60 band closest to the active frequency
  const rt60 = rt60Band(rt60Result, freq);
  if (!isFinite(rt60) || rt60 <= 0) return null;

  const Vm3 = roomVolumeFt3(room) * 0.028316846592;

  // Build the source-power level (Lw, dB re 1pW). Sum incoherently across speakers.
  // Use the same SPL@1m helper so line-array boxes / drive / monitor penalty are honored.
  let lwSum = 0;
  for (const sp of speakers) {
    const splAt1m = speakerSplAt1m(sp);
    if (!isFinite(splAt1m)) continue; // IEMs etc — non-acoustic
    // Lw ≈ Lp_at_1m + 11 dB (4πr² at 1m → power conversion)
    const lw = splAt1m + 11;
    lwSum += Math.pow(10, lw / 10);
  }
  if (lwSum === 0) return null;
  const Lw = 10 * Math.log10(Math.max(1, lwSum));

  // Diffuse reverberant SPL (Sabine room equation, simplified):
  //   L_rev ≈ Lw - 10·log10(R)        where R is room constant in m²
  //   R ≈ 0.16·V/RT60   (Sabine sabines equivalent)
  // We omit the 4 m^2 absorber term because we already account for audience absorption in RT60.
  const R = (0.16 * Vm3) / rt60;
  const splReverb = Lw - 10 * Math.log10(Math.max(1, R));

  // Linear energies (proportional). Reverb energy is uniform across the room.
  const Erev_total = Math.pow(10, splReverb / 10);

  // Early-fraction of reverberant energy at T_early ms:
  // Exponential decay: E(t) = E0·e^(-13.8·t/RT60). Energy in [0, T_e] / total = 1 - e^(-13.8·T_e/RT60)
  const Te_s = earlyMs / 1000;
  const earlyFrac = 1 - Math.exp(-13.8 * Te_s / rt60);
  const Erev_early = Erev_total * earlyFrac;
  const Erev_late = Erev_total * (1 - earlyFrac);

  // Build the grid.
  const bb = bboxOf(room.shape);
  const cellW = resolutionFt;
  const cellH = resolutionFt;
  const gridX = Math.max(2, Math.ceil(bb.width / cellW));
  const gridY = Math.max(2, Math.ceil(bb.depth / cellH));
  const grid: number[][] = [];
  let max = -Infinity, min = Infinity, sum = 0, n = 0;
  const vals: number[] = [];

  // Pre-compute image sources once for clarity if reflections are enabled.
  // Each image source arrives at the listener with a path delay equal to
  // its bent-path length / speed_of_sound. We bucket the contribution into
  // "early" or "late" energy by comparing that delay to earlyMs (the
  // C50/C80 split).
  const surfaces = useReflections
    ? buildRoomSurfaces(room, { floorAlphaOverride: effectiveFloorAlpha(room, zones ?? []) })
    : [];
  const imagesPerSpeakerC: ImageSource[][] = useReflections
    ? speakers.map(sp => generateImageSources(sp, surfaces, maxOrder))
    : speakers.map(() => []);
  const reflBandKey = bandKeyForFreq(freq);
  const airCoeffs = airCoeffsPerBand(room.temperatureF ?? 70, room.relHumidity ?? 50);

  // Sprint C12 — fold interior wall obstacles into the obstacle list for
  // direct-path Maekawa diffraction. Same as computeHeatmap.
  const wallObstacleItemsC = wallObstaclesToObstacleItems(room.wallObstacles ?? []);
  const obstacleItemsAll = [...obstacleItems, ...wallObstacleItemsC];

  for (let j = 0; j < gridY; j++) {
    const row: number[] = [];
    for (let i = 0; i < gridX; i++) {
      const x = bb.minX + (i + 0.5) * cellW;
      const y = bb.minY + (j + 0.5) * cellH;
      if (!pointInPolygon({ x, y }, room.shape)) {
        row.push(NaN);
        continue;
      }
      // Direct field SPL (incoherent sum across speakers, with obstacle blockage applied)
      const cellZ = earHeightAt(x, y, zones, earHeightFt);
      const lp = { x, y, z: cellZ };
      let Edirect = 0;
      let Eimg_early = 0;
      let Eimg_late = 0;
      for (let s = 0; s < speakers.length; s++) {
        const sp = speakers[s];
        const blockers = obstacleItemsAll.filter(o => o.id !== sp.id && affectsAcoustics(o));
        const direct = speakerSPL(sp, lp, freq, blockers, airCoeffs);
        if (isFinite(direct)) Edirect += Math.pow(10, direct / 10);
        if (!useReflections) continue;
        const imgs = imagesPerSpeakerC[s];
        const imgBHz = bandHz(freq);
        const lambdaMRefl = SPEED_OF_SOUND_M_S / Math.max(20, imgBHz);
        for (let k = 0; k < imgs.length; k++) {
          const img = imgs[k];
          if (img.order === 0) continue; // direct counted above
          const ap = audiblePath(img, lp);
          if (!ap) continue;
          const synth = imageAsEquipmentItem(sp, img);
          // No straight-line block test — apply per-leg blocking on the unfolded path.
          const splImg = speakerSPL(synth, lp, freq, [], airCoeffs);
          if (!isFinite(splImg)) continue;
          const refLoss = img.reflectionLossDb[reflBandKey];
          const pathBlock = pathObstructionLossDb(ap.points, blockers, imgBHz);
          let edgeSoft = 0;
          for (let bIdx = 0; bIdx < img.chain.length; bIdx++) {
            const surface = img.chain[bIdx];
            const R = ap.points[bIdx + 1];
            const d = surface.distanceToEdgeFt(R);
            edgeSoft += edgeSofteningLossDb(d, lambdaMRefl);
            if (edgeSoft >= 10) { edgeSoft = 10; break; }
          }
          const splNet = splImg - refLoss - pathBlock - edgeSoft;
          if (splNet < -10) continue;
          // Path delay (ms) = bent-path distance / speed_of_sound + speaker delay.
          const tofMs = ap.totalDistFt / SPEED_OF_SOUND_FT_PER_MS + (sp.delayMs ?? 0);
          const e = Math.pow(10, splNet / 10);
          if (tofMs <= earlyMs) Eimg_early += e;
          else Eimg_late += e;
        }
      }
      // Direct sound is, by definition, "early" — arrives before any reverb buildup.
      // Audible first-order reflections are split early/late by their path delay.
      const Eearly = Edirect + Eimg_early + Erev_early;
      const Elate = Eimg_late + Erev_late;
      const c = Elate > 0 ? 10 * Math.log10(Eearly / Elate) : 30;
      const clamped = Math.max(-15, Math.min(30, c));
      row.push(clamped);
      if (clamped > max) max = clamped;
      if (clamped < min) min = clamped;
      sum += clamped; n += 1;
      vals.push(clamped);
    }
    grid.push(row);
  }

  const avg = n ? sum / n : 0;
  let std = 0;
  if (n > 1) {
    let v = 0;
    for (const s of vals) v += (s - avg) ** 2;
    std = Math.sqrt(v / (n - 1));
  }

  return {
    grid, cellW, cellH,
    minX: bb.minX, minY: bb.minY, gridX, gridY,
    min: isFinite(min) ? min : 0, max: isFinite(max) ? max : 0,
    avg, std,
  };
}

function rt60Band(rt: RT60Result, freq: '125'|'1k'|'4k'|'broadband'): number {
  if (freq === '125') return rt.byBand[125];
  if (freq === '1k')  return rt.byBand[1000];
  if (freq === '4k')  return rt.byBand[4000];
  return rt.average;
}

// Color scale for C50 — high = clear (good), low = mush (bad).
// Speech threshold C50 ≥ 0 dB; very good ≥ 5 dB.
export function clarityColor(c: number, lo = -10, hi = 15): string {
  if (!isFinite(c)) return 'rgba(0,0,0,0)';
  const t = Math.max(0, Math.min(1, (c - lo) / (hi - lo)));
  const stops: [number, [number, number, number]][] = [
    [0.00, [197, 48, 48]],   // bad — red
    [0.30, [245, 166, 35]],  // mush — amber
    [0.55, [200, 190, 80]],  // marginal — olive
    [0.75, [47, 158, 94]],   // good — green
    [1.00, [26, 79, 191]],   // excellent — royal
  ];
  for (let k = 0; k < stops.length - 1; k++) {
    const [t0, c0] = stops[k], [t1, c1] = stops[k+1];
    if (t >= t0 && t <= t1) {
      const u = (t - t0) / (t1 - t0);
      const r = Math.round(c0[0] + (c1[0]-c0[0]) * u);
      const g = Math.round(c0[1] + (c1[1]-c0[1]) * u);
      const b = Math.round(c0[2] + (c1[2]-c0[2]) * u);
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'rgb(120,120,120)';
}

/**
 * Color scale for per-cell T30 (decay time) heatmap.
 * Cool / green = short decay (good for speech), warm / red = long decay
 * (sluggish, problematic for intelligibility). Default range covers
 * 0.4 s → 2.5 s which spans the practical envelope from a well-treated
 * lecture room (~0.5 s) to a sluggish gym (~2 s+).
 */
export function t30Color(seconds: number, lo = 0.4, hi = 2.5): string {
  if (!isFinite(seconds)) return 'rgba(0,0,0,0)';
  const t = Math.max(0, Math.min(1, (seconds - lo) / (hi - lo)));
  const stops: [number, [number, number, number]][] = [
    [0.00, [26, 79, 191]],   // very dry — royal
    [0.25, [47, 158, 94]],   // good — green
    [0.50, [200, 190, 80]],  // moderate — olive
    [0.70, [245, 166, 35]],  // sluggish — amber
    [1.00, [197, 48, 48]],   // poor — red
  ];
  for (let k = 0; k < stops.length - 1; k++) {
    const [t0, c0] = stops[k], [t1, c1] = stops[k+1];
    if (t >= t0 && t <= t1) {
      const u = (t - t0) / (t1 - t0);
      const r = Math.round(c0[0] + (c1[0]-c0[0]) * u);
      const g = Math.round(c0[1] + (c1[1]-c0[1]) * u);
      const b = Math.round(c0[2] + (c1[2]-c0[2]) * u);
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'rgb(120,120,120)';
}

export function clarityRating(c: number): string {
  if (c >= 5) return 'Excellent';
  if (c >= 0) return 'Good';
  if (c >= -3) return 'Marginal';
  return 'Poor';
}

// =============== Compliance targets ===============

export function defaultComplianceTargets(roomType: RoomType): ComplianceTargets {
  // Industry-typical thresholds for each room type. Designers can edit these
  // per-project; these are just the starting points.
  const map: Record<RoomType, ComplianceTargets> = {
    sanctuary:    { rt60Min: 0.8, rt60Max: 1.2, stiMin: 0.55, coverageStdMax: 6,  splMin: 88, c50Min: 0  },
    multipurpose: { rt60Min: 0.8, rt60Max: 1.5, stiMin: 0.50, coverageStdMax: 6,  splMin: 85, c50Min: -2 },
    fellowship:   { rt60Min: 0.8, rt60Max: 1.5, stiMin: 0.50, coverageStdMax: 6,  splMin: 80, c50Min: -2 },
    gym:          { rt60Min: 0.8, rt60Max: 2.0, stiMin: 0.45, coverageStdMax: 8,  splMin: 88, c50Min: -3 },
    outdoor:      { rt60Min: 0.0, rt60Max: 0.5, stiMin: 0.55, coverageStdMax: 6,  splMin: 90, c50Min: 5  },
  };
  return map[roomType] ?? map.sanctuary;
}

export type ComplianceVerdict = 'pass' | 'fail' | 'warn' | 'na';

export interface ComplianceCheck {
  key: 'rt60' | 'sti' | 'coverage' | 'spl' | 'c50';
  label: string;
  currentLabel: string;        // formatted current value, e.g. "1.05 s"
  targetLabel: string;         // formatted target, e.g. "0.8–1.2 s"
  verdict: ComplianceVerdict;
  delta: number | null;        // signed deviation if applicable
}

export function evaluateCompliance(
  targets: ComplianceTargets,
  rt60: RT60Result | null,
  sti: number | null,
  heatmap: HeatmapData | null,
  clarity: HeatmapData | null,
): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];

  // RT60 @ 1kHz
  const rt60at1k = rt60?.byBand[1000] ?? null;
  if (rt60at1k == null) {
    checks.push({ key: 'rt60', label: 'RT60 @ 1 kHz',
      currentLabel: '—', targetLabel: `${targets.rt60Min.toFixed(2)}–${targets.rt60Max.toFixed(2)} s`,
      verdict: 'na', delta: null });
  } else {
    let v: ComplianceVerdict = 'pass';
    let delta = 0;
    if (rt60at1k < targets.rt60Min) { delta = rt60at1k - targets.rt60Min; v = 'warn'; }
    else if (rt60at1k > targets.rt60Max) { delta = rt60at1k - targets.rt60Max; v = rt60at1k > targets.rt60Max + 0.3 ? 'fail' : 'warn'; }
    checks.push({ key: 'rt60', label: 'RT60 @ 1 kHz',
      currentLabel: `${rt60at1k.toFixed(2)} s`,
      targetLabel: `${targets.rt60Min.toFixed(2)}–${targets.rt60Max.toFixed(2)} s`,
      verdict: v, delta });
  }

  // STI
  if (sti == null) {
    checks.push({ key: 'sti', label: 'STI',
      currentLabel: '—', targetLabel: `≥ ${targets.stiMin.toFixed(2)}`, verdict: 'na', delta: null });
  } else {
    const v: ComplianceVerdict = sti >= targets.stiMin ? 'pass' :
                                  sti >= targets.stiMin - 0.05 ? 'warn' : 'fail';
    checks.push({ key: 'sti', label: 'STI',
      currentLabel: sti.toFixed(2), targetLabel: `≥ ${targets.stiMin.toFixed(2)}`,
      verdict: v, delta: sti - targets.stiMin });
  }

  // Coverage uniformity (1σ)
  if (!heatmap) {
    checks.push({ key: 'coverage', label: 'Coverage ±σ',
      currentLabel: '—', targetLabel: `≤ ±${targets.coverageStdMax.toFixed(1)} dB`, verdict: 'na', delta: null });
  } else {
    const v: ComplianceVerdict = heatmap.std <= targets.coverageStdMax ? 'pass' :
                                  heatmap.std <= targets.coverageStdMax + 1.5 ? 'warn' : 'fail';
    checks.push({ key: 'coverage', label: 'Coverage ±σ',
      currentLabel: `±${heatmap.std.toFixed(1)} dB`,
      targetLabel: `≤ ±${targets.coverageStdMax.toFixed(1)} dB`,
      verdict: v, delta: heatmap.std - targets.coverageStdMax });
  }

  // Avg SPL
  if (!heatmap) {
    checks.push({ key: 'spl', label: 'Avg SPL',
      currentLabel: '—', targetLabel: `≥ ${targets.splMin} dB`, verdict: 'na', delta: null });
  } else {
    const v: ComplianceVerdict = heatmap.avg >= targets.splMin ? 'pass' :
                                  heatmap.avg >= targets.splMin - 3 ? 'warn' : 'fail';
    checks.push({ key: 'spl', label: 'Avg SPL',
      currentLabel: `${heatmap.avg.toFixed(1)} dB`,
      targetLabel: `≥ ${targets.splMin} dB`,
      verdict: v, delta: heatmap.avg - targets.splMin });
  }

  // C50
  if (!clarity) {
    checks.push({ key: 'c50', label: 'C50 clarity',
      currentLabel: '—', targetLabel: `≥ ${targets.c50Min.toFixed(0)} dB`, verdict: 'na', delta: null });
  } else {
    const v: ComplianceVerdict = clarity.avg >= targets.c50Min ? 'pass' :
                                  clarity.avg >= targets.c50Min - 2 ? 'warn' : 'fail';
    checks.push({ key: 'c50', label: 'C50 clarity',
      currentLabel: `${clarity.avg.toFixed(1)} dB`,
      targetLabel: `≥ ${targets.c50Min.toFixed(0)} dB`,
      verdict: v, delta: clarity.avg - targets.c50Min });
  }

  return checks;
}

// =============== Zone statistics ===============

export interface ZoneStats {
  zoneId: string;
  name: string;
  cells: number;          // grid cells of the heatmap that fell inside the zone
  splAvg: number;
  splMin: number;
  splMax: number;
  splStd: number;
  c50Avg: number | null;
  vsTarget: number;       // splAvg - target
  passing: boolean;       // splAvg ≥ target
  uniformity: number;     // splStd (lower is better)
}

/**
 * Aggregate heatmap data over a zone polygon.
 * Returns null if the heatmap is missing or no cells fall inside the zone.
 */
export function computeZoneStats(
  zone: Zone,
  heatmap: HeatmapData | null,
  clarity: HeatmapData | null,
): ZoneStats | null {
  if (!heatmap) return null;
  const { grid, cellW, cellH, minX, minY, gridX, gridY } = heatmap;
  const splValues: number[] = [];
  const c50Values: number[] = [];
  for (let j = 0; j < gridY; j++) {
    for (let i = 0; i < gridX; i++) {
      const v = grid[j][i];
      if (!isFinite(v)) continue;
      const cx = minX + (i + 0.5) * cellW;
      const cy = minY + (j + 0.5) * cellH;
      if (!pointInPolygon({ x: cx, y: cy }, zone.shape)) continue;
      splValues.push(v);
      if (clarity) {
        const c = clarity.grid[j]?.[i];
        if (isFinite(c)) c50Values.push(c);
      }
    }
  }
  if (!splValues.length) return null;
  const n = splValues.length;
  const splAvg = splValues.reduce((s, x) => s + x, 0) / n;
  const splMin = Math.min(...splValues);
  const splMax = Math.max(...splValues);
  const splStd = Math.sqrt(splValues.reduce((s, x) => s + (x - splAvg) ** 2, 0) / Math.max(1, n - 1));
  const c50Avg = c50Values.length ? c50Values.reduce((s, x) => s + x, 0) / c50Values.length : null;
  return {
    zoneId: zone.id,
    name: zone.name,
    cells: n,
    splAvg, splMin, splMax, splStd,
    c50Avg,
    vsTarget: splAvg - zone.targetSPL,
    passing: splAvg >= zone.targetSPL - 1, // 1 dB margin
    uniformity: splStd,
  };
}

// =============== STI per IEC 60268-16 ===============
// The Speech Transmission Index quantifies how well a room preserves the
// modulation envelope of speech across 7 octave bands × 14 modulation
// frequencies. The two main mechanisms that hurt MTF:
//   • Reverberation smears the envelope:
//       m_rev(F, T) = 1 / √(1 + (2πF·T / 13.8)²)
//   • Background noise reduces modulation depth:
//       m_noise(SNR) = 1 / (1 + 10^(−SNR/10))
// Combined modulation transfer at (band f, mod-freq F):
//       m(f, F) = m_rev × m_noise
// Convert to apparent SNR, clip ±15 dB:
//       SNR_app = 10·log₁₀(m / (1 − m))
// Per-band Transmission Index (TI):
//       TI(f) = (mean_F SNR_app + 15) / 30  ∈ [0, 1]
// STI per IEC 60268-16 (with adjacent-band redundancy correction):
//       STI = Σ α_f · TI_f − Σ β_{f,f+1} · √(TI_f · TI_{f+1})
// α and β coefficients are gender-specific (male / female speech spectra).

/** STI octave bands per IEC 60268-16. We model 7 bands; our acoustic engine
 *  natively models 6 (125…4k), so 8k is extrapolated from 4k when missing. */
const STI_BANDS = [125, 250, 500, 1000, 2000, 4000, 8000] as const;

/** The 14 modulation frequencies the STI test signal uses (Hz). */
const STI_MOD_FREQS = [
  0.63, 0.80, 1.00, 1.25, 1.60, 2.00, 2.50,
  3.15, 4.00, 5.00, 6.30, 8.00, 10.00, 12.50,
] as const;

/** IEC 60268-16:2020 Annex A weighting coefficients. α weights individual
 *  band TIs; β weights adjacent-band redundancy correction. Female 125 Hz
 *  weight is zero — there's no female-voice content at that band. */
const STI_WEIGHTS = {
  male: {
    alpha: [0.085, 0.127, 0.230, 0.233, 0.309, 0.224, 0.173],
    beta:  [0.085, 0.078, 0.065, 0.011, 0.047, 0.095],
  },
  female: {
    alpha: [0,     0.117, 0.223, 0.216, 0.328, 0.250, 0.194],
    beta:  [0,     0.099, 0.066, 0.062, 0.025, 0.076],
  },
} as const;

export type SpeakerVoice = 'male' | 'female';

export interface STIResult {
  sti: number;
  rating: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Bad';
  /** Per-band Transmission Index (TI), 0..1. Lets the UI show which band
   *  is dragging intelligibility down. */
  tiByBand: Record<number, number>;
  /** Per-band SNR used (dB). */
  snrByBand: Record<number, number>;
}

function ratingForSTI(sti: number): STIResult['rating'] {
  if (sti >= 0.75) return 'Excellent';
  if (sti >= 0.60) return 'Good';
  if (sti >= 0.45) return 'Fair';
  if (sti >= 0.30) return 'Poor';
  return 'Bad';
}

/**
 * Full IEC 60268-16 STI calculation.
 *
 * Inputs accept partial maps — any missing band falls back to 1 kHz, and 8 kHz
 * specifically extrapolates from 4 kHz when absent (our 6-band acoustic engine
 * doesn't model 8 kHz natively).
 */
export function computeSTI(
  rt60ByBand: Partial<Record<number, number>>,
  splByBand: Partial<Record<number, number>>,
  noiseFloorByBand: Partial<Record<number, number>>,
  voice: SpeakerVoice = 'male',
): STIResult {
  const lookup = (
    band: number,
    src: Partial<Record<number, number>>,
    fallback: number,
  ): number => {
    if (src[band] !== undefined) return src[band]!;
    if (band === 8000 && src[4000] !== undefined) return src[4000]!;
    if (src[1000] !== undefined) return src[1000]!;
    return fallback;
  };

  const tiByBand: Record<number, number> = {};
  const snrByBand: Record<number, number> = {};

  for (const f of STI_BANDS) {
    const T = Math.max(0.05, lookup(f, rt60ByBand, 1.0));
    const SPL = lookup(f, splByBand, 65);
    const noise = lookup(f, noiseFloorByBand, 35);
    const SNR = SPL - noise;
    snrByBand[f] = SNR;

    let snrAppSum = 0;
    for (const F of STI_MOD_FREQS) {
      const mRev = 1 / Math.sqrt(1 + Math.pow((2 * Math.PI * F * T) / 13.8, 2));
      const mNoise = 1 / (1 + Math.pow(10, -SNR / 10));
      const m = Math.max(1e-6, Math.min(1 - 1e-6, mRev * mNoise));
      let snrApp = 10 * Math.log10(m / (1 - m));
      if (snrApp > 15) snrApp = 15;
      else if (snrApp < -15) snrApp = -15;
      snrAppSum += snrApp;
    }
    const meanSnrApp = snrAppSum / STI_MOD_FREQS.length;
    const ti = (meanSnrApp + 15) / 30;
    tiByBand[f] = Math.max(0, Math.min(1, ti));
  }

  // Weighted MTI sum minus adjacent-band redundancy
  const W = STI_WEIGHTS[voice];
  let main = 0;
  for (let i = 0; i < STI_BANDS.length; i++) {
    main += W.alpha[i] * tiByBand[STI_BANDS[i]];
  }
  let redundancy = 0;
  for (let i = 0; i < STI_BANDS.length - 1; i++) {
    const a = tiByBand[STI_BANDS[i]];
    const b = tiByBand[STI_BANDS[i + 1]];
    redundancy += W.beta[i] * Math.sqrt(Math.max(0, a * b));
  }
  const sti = Math.max(0, Math.min(1, main - redundancy));

  return {
    sti: +sti.toFixed(2),
    rating: ratingForSTI(sti),
    tiByBand,
    snrByBand,
  };
}

/**
 * Legacy single-value wrapper. Synthesizes per-band data from the limited
 * inputs (RT60 at 1 kHz, average SPL, single noise-floor value) using
 * typical room and speech spectra. Backward-compat for callers that don't
 * yet have full octave-band data.
 *
 * Prefer `computeSTI(rt60ByBand, splByBand, noiseByBand)` when the engine
 * has full per-band data available (which is the case after Sprint 2 ISM).
 */
export function stiEstimate(
  rt60at1k: number,
  splAvg: number,
  noiseFloor: number,
): { sti: number; rating: string } {
  // Typical speech-room RT60 shape: LF longer, HF shorter relative to 1 kHz.
  const rt60Shape: Record<number, number> = {
    125:  rt60at1k * 1.20,
    250:  rt60at1k * 1.05,
    500:  rt60at1k * 1.00,
    1000: rt60at1k,
    2000: rt60at1k * 0.92,
    4000: rt60at1k * 0.80,
    8000: rt60at1k * 0.65,
  };
  const splFlat: Record<number, number> = {
    125: splAvg, 250: splAvg, 500: splAvg, 1000: splAvg,
    2000: splAvg, 4000: splAvg, 8000: splAvg,
  };
  const noiseFlat: Record<number, number> = {
    125: noiseFloor, 250: noiseFloor, 500: noiseFloor, 1000: noiseFloor,
    2000: noiseFloor, 4000: noiseFloor, 8000: noiseFloor,
  };
  const r = computeSTI(rt60Shape, splFlat, noiseFlat, 'male');
  return { sti: r.sti, rating: r.rating };
}

// =============== Spatial impression — LF + IACC (ISO 3382-1) ===============
// Lateral Fraction quantifies "envelopment" — how much early-window energy
// arrives from the listener's SIDES rather than from the front. A concert
// hall with strong side-wall reflections feels wide and immersive; a
// cinema-style room with mostly direct + front-wall reflections feels
// frontal and narrow. ISO 3382-1 defines LF as:
//
//     LF = (lateral early energy 5–80 ms) / (total early energy 0–80 ms)
//
// where "lateral" weighting is cos²(angle from listener's lateral axis).
// We compute this from the existing ISM image sources — each first/higher-
// order image gives us an arrival direction (the bent-path's first leg
// FROM the listener's side, which corresponds to ap.firstBounce in the
// audiblePath result), an arrival time, and an energy weighted by the
// surface chain's reflection losses + path distance.
//
// IACC_E (inter-aural cross-correlation, early window) is not directly
// computable without HRTF data, but the empirical relationship (Beranek,
// Bradley et al.) gives a reasonable approximation:
//     1 - IACC_E ≈ 0.4 × LF
// for typical concert-hall geometry. We expose this as a ROUGH indicator
// and label it as such in the UI.

import type { SpatialMetricsResult } from '../types';

function bandToFreqEnum(b: OctaveBand): '125' | '1k' | '4k' | 'broadband' {
  if (b <= 125) return '125';
  if (b >= 4000) return '4k';
  return '1k';
}

/**
 * Compute Lateral Fraction + approximate IACC_E at a single room-average
 * receiver. Requires specular reflections (ISM) since LF is fundamentally
 * about reflected-sound geometry — without ISM we'd only have direct
 * sound and the metric is meaningless.
 *
 * Returns null when ISM can't run (no speakers, useReflections off).
 */
export function computeSpatialMetrics(
  room: RoomState,
  speakers: EquipmentItem[],
  maxOrder: number = 2,
  zones: import('../types').Zone[] = [],
  listenerPos?: { x: number; y: number; z: number },
  listenerFacingRad?: number,
): SpatialMetricsResult | null {
  if (!speakers.length || maxOrder < 1) return null;

  const bb = bboxOf(room.shape);
  const lp = listenerPos ?? { x: bb.minX + bb.width / 2, y: bb.minY + bb.depth / 2, z: 5 };

  // Default facing: toward the stage center if a stage is defined; else
  // toward the front of the room (= +y direction by convention; if the
  // room is wider than deep we pick the longer axis).
  let facing: number;
  if (listenerFacingRad != null) {
    facing = listenerFacingRad;
  } else if (room.stage) {
    // Stage is centered along width at y = stage.depth/2 from the front
    const stageCx = bb.minX + bb.width / 2;
    const stageCy = bb.minY + (room.stage.depth ?? 12) / 2;
    facing = Math.atan2(stageCy - lp.y, stageCx - lp.x);
  } else {
    facing = -Math.PI / 2; // pointing in -y direction (toward "front" of room)
  }
  // Lateral axis (pointing to listener's right): facing rotated -90°.
  const lateralX = Math.sin(facing);
  const lateralY = -Math.cos(facing);

  const surfaces = buildRoomSurfaces(room, {
    floorAlphaOverride: effectiveFloorAlpha(room, zones),
  });

  const targetBands: Array<125 | 1000 | 4000> = [125, 1000, 4000];
  const lfByBand = { 125: 0, 1000: 0, 4000: 0 } as Record<125 | 1000 | 4000, number>;
  let totalImagesUsed = 0;

  for (const band of targetBands) {
    let totalEarly = 0;
    let lateralEarly = 0;
    const freqEnum = bandToFreqEnum(band);
    const airCoeffs = airCoeffsPerBand(room.temperatureF ?? 70, room.relHumidity ?? 50);

    for (const sp of speakers) {
      if (sp.kind === 'speaker-iem') continue;
      const images = generateImageSources(sp, surfaces, maxOrder);
      for (const img of images) {
        const ap = audiblePath(img, lp);
        if (!ap) continue;
        // ISO 3382 lateral-fraction window: 5 ms (or direct) to 80 ms.
        const tofMs = ap.totalDistFt / SPEED_OF_SOUND_FT_PER_MS + (sp.delayMs ?? 0);
        if (tofMs > 80) continue;
        // Direct sound (order 0) is excluded from LF numerator by ISO,
        // but counts toward total early energy.
        const isDirect = img.order === 0;

        // Energy contribution at this band — reuse the speakerSPL math
        // (consistent with everything else in the engine, including
        // reflection chain attenuation, dispersion, air absorption).
        const synth = imageAsEquipmentItem(sp, img);
        const splImg = speakerSPL(synth, lp, freqEnum, [], airCoeffs);
        if (!isFinite(splImg)) continue;
        const refLoss = isDirect ? 0 : (img.reflectionLossDb[band] ?? 0);
        const splNet = splImg - refLoss;
        if (splNet < -20) continue; // below floor — negligible
        const e = Math.pow(10, splNet / 10);

        totalEarly += e;
        if (!isDirect && tofMs >= 5) {
          // Arrival direction at the listener: from the LAST bounce point
          // (or image position if straight-line). The xy projection is
          // what determines lateral angle.
          const arrivalFrom = ap.firstBounce ?? img.position;
          const dx = lp.x - arrivalFrom.x;
          const dy = lp.y - arrivalFrom.y;
          const horizDist = Math.hypot(dx, dy);
          if (horizDist < 0.1) continue;
          // cos(angle from listener's lateral axis)
          const cosLat = (dx * lateralX + dy * lateralY) / horizDist;
          // ISO 3382 LF weighting: cos²(angle from lateral) — same as |sin|² of
          // angle from forward, so reflections from straight ahead/behind
          // contribute 0; from straight sides contribute fully.
          const w = cosLat * cosLat;
          lateralEarly += e * w;
          totalImagesUsed += 1;
        }
      }
    }

    lfByBand[band] = totalEarly > 0 ? +(lateralEarly / totalEarly).toFixed(3) : 0;
  }

  // ISO 3382-1 reports LF averaged over the 500 / 1k / 2k bands. Our
  // heatmap engine only computes 3 bands explicitly; we approximate
  // "mid-band LF" as the 1k value (closest to the standard average).
  const lf = lfByBand[1000];

  // Approximate IACC_E using the empirical Beranek/Bradley relationship.
  const iaccByBand = {
    125:  Math.max(0, Math.min(1, 1 - 0.4 * lfByBand[125])),
    1000: Math.max(0, Math.min(1, 1 - 0.4 * lfByBand[1000])),
    4000: Math.max(0, Math.min(1, 1 - 0.4 * lfByBand[4000])),
  };
  const iaccE = iaccByBand[1000];

  return {
    lf: +lf.toFixed(3),
    lfByBand,
    iaccE: +iaccE.toFixed(3),
    iaccByBand,
    listenerPos: lp,
    listenerFacingDeg: +(facing * 180 / Math.PI).toFixed(1),
    imageCount: totalImagesUsed,
  };
}

// =============== Rule-based recommendations ===============

export function generateRecommendations(args: {
  room: RoomState;
  speakers: EquipmentItem[];
  panelItems: EquipmentItem[];
  rt60: RT60Result | null;
  heatmap: HeatmapData | null;
  sti: number | null;
}): Recommendation[] {
  const recs: Recommendation[] = [];
  const id = () => `rec-${recs.length + 1}`;
  const rt60at1k = args.rt60?.byBand[1000] ?? 0;

  if (args.rt60 && args.room.roomType === 'sanctuary' && rt60at1k > 1.5) {
    recs.push({
      id: id(),
      severity: 'warn',
      title: `RT60 @1kHz is ${rt60at1k.toFixed(2)}s — too reverberant for speech`,
      detail: 'Add ~15–20% wall coverage of broadband acoustic panels to reduce reverberation. Target 0.8–1.2s for primarily speech use.',
    });
  } else if (args.rt60 && rt60at1k >= 0.8 && rt60at1k <= 1.2 && args.room.roomType === 'sanctuary') {
    recs.push({
      id: id(),
      severity: 'ok',
      title: `RT60 @1kHz is within target (${rt60at1k.toFixed(2)}s)`,
      detail: 'Reverberation is in the recommended range for sanctuary speech intelligibility.',
    });
  }

  // Bass mode reinforcement: if any sub is within 6ft of a wall
  const bb = bboxOf(args.room.shape);
  const subs = args.speakers.filter(s => s.kind === 'speaker-sub' || s.kind === 'speaker-sub-flown');
  for (const sub of subs) {
    const distLeft  = sub.x - bb.minX;
    const distRight = bb.maxX - sub.x;
    const distFront = sub.y - bb.minY;
    const distBack  = bb.maxY - sub.y;
    const minDist = Math.min(distLeft, distRight, distFront, distBack);
    if (minDist < 6) {
      recs.push({
        id: id(),
        severity: 'warn',
        title: `Subwoofer "${sub.label}" is ${minDist.toFixed(1)}ft from a wall`,
        detail: 'Boundary placement causes bass mode reinforcement. Move 6–10 ft off the nearest wall, or use an end-fire/cardioid array to control low-end build-up.',
      });
      break;
    }
  }

  // Coverage uniformity
  if (args.heatmap && args.heatmap.std > 6) {
    recs.push({
      id: id(),
      severity: 'warn',
      title: `Coverage variance ±${args.heatmap.std.toFixed(1)}dB is high`,
      detail: 'Consider adding delay/fill speakers, or re-aiming mains. ±3dB is excellent, ±6dB is acceptable for installed sound.',
    });
  } else if (args.heatmap && args.heatmap.std <= 4) {
    recs.push({
      id: id(),
      severity: 'ok',
      title: `Coverage uniformity ±${args.heatmap.std.toFixed(1)}dB is excellent`,
      detail: 'SPL across the audience plane is well within professional install standards.',
    });
  }

  // Front-vs-back SPL differential
  if (args.heatmap) {
    const { grid, gridY } = args.heatmap;
    const front = grid[Math.floor(gridY * 0.15)] ?? [];
    const back = grid[Math.floor(gridY * 0.85)] ?? [];
    const validFront = front.filter(v => isFinite(v));
    const validBack = back.filter(v => isFinite(v));
    if (validFront.length && validBack.length) {
      const fAvg = validFront.reduce((a, b) => a + b, 0) / validFront.length;
      const bAvg = validBack.reduce((a, b) => a + b, 0) / validBack.length;
      const diff = fAvg - bAvg;
      if (diff > 10) {
        recs.push({
          id: id(),
          severity: 'warn',
          title: `Back rows ${diff.toFixed(1)}dB quieter than front`,
          detail: 'Add a pair of delay speakers around row mid-house to bring up the back. Aim for a 6dB max front-to-back differential.',
        });
      }
    }
  }

  // STI
  if (args.sti != null && args.sti < 0.5) {
    recs.push({
      id: id(),
      severity: 'warn',
      title: `STI ${args.sti.toFixed(2)} is below 0.50 — speech is hard to follow`,
      detail: 'Reduce reverberation (more absorption) and/or improve direct/reverberant ratio (better-aimed coverage closer to listeners).',
    });
  } else if (args.sti != null && args.sti >= 0.6) {
    recs.push({
      id: id(),
      severity: 'ok',
      title: `STI ${args.sti.toFixed(2)} meets the IEC "Good" threshold`,
      detail: 'Speech intelligibility is at or above the typical worship-space target.',
    });
  }

  // Speaker count for room size
  const audienceArea = totalFloorAreaFt2(args.room) - (args.room.stage ? args.room.stage.width * args.room.stage.depth : 0);
  const recommendedMains = audienceArea < 1000 ? 2 : audienceArea < 3000 ? 2 : audienceArea < 8000 ? 4 : 6;
  const mainsCount = args.speakers.filter(s =>
    s.kind === 'speaker-line-array' || s.kind === 'speaker-point' || s.kind === 'speaker-column'
  ).length;
  if (mainsCount > 0 && mainsCount < recommendedMains) {
    recs.push({
      id: id(),
      severity: 'info',
      title: `${mainsCount} main speakers — typical install for this size is ~${recommendedMains}`,
      detail: 'Larger rooms benefit from additional fill/delay zones to maintain ±6dB coverage.',
    });
  }

  // Sub count
  const subCount = subs.length;
  if (mainsCount > 0 && subCount === 0) {
    recs.push({
      id: id(),
      severity: 'info',
      title: 'No subwoofers placed',
      detail: 'For modern worship music, plan for 1 sub per ~600 sq ft of audience as a starting point.',
    });
  }

  return recs;
}

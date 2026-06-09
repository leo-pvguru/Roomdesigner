// =====================================================================
// Bundled polar / directivity data for catalog speaker archetypes.
// ---------------------------------------------------------------------
// These curves are realistic synthetic polars built to match published
// datasheet behavior of common worship/install speakers — narrow at HF,
// broader at LF, with mild side-lobe asymmetry. They are NOT measured
// from any specific product; they're meant as plausible defaults until
// users import vendor measurement files (CLF/CSV — future sprint).
//
// Convention:
//   • 0 dB = on-axis. All other values are negative attenuations.
//   • H (horizontal) angles run 0..180 degrees and are mirrored: the
//     engine uses |angle| for symmetric polars to halve memory/lookup.
//   • V (vertical) similarly runs 0..90 (above) and 0..-90 (below);
//     we store -90..90 explicitly so asymmetric tilt is captured.
//   • Frequencies in Hz, sorted ascending (octave centers).
//   • Patterns tighten with frequency: HF main lobes are narrower and
//     side lobes are deeper.
// =====================================================================

import type { PolarData } from '../types';

// Helper: polar curve from beamwidth (-6 dB) and side-lobe depth.
function curveFromBeamwidth(
  angles: number[],
  bwAtMinus6db: number,
  sideLobeFloorDb: number,
): number[] {
  return angles.map(angleAbs => {
    const a = Math.abs(angleAbs);
    if (a < 0.01) return 0;
    const r = a / (bwAtMinus6db / 2);
    // Quasi-Gaussian main lobe to -6 dB at edge, then a softer floor.
    let db: number;
    if (r <= 1) {
      db = -6 * r * r;
    } else {
      // Past the main lobe, drop to side-lobe floor with a smooth curve.
      const tail = (r - 1) / 1.5;
      db = -6 - (sideLobeFloorDb - 6) * Math.min(1, tail * tail);
    }
    return db;
  });
}

// =====================================================================
// "Generic narrow line array" — typical 90° H × 10° V per box at 1 kHz.
// LF beamwidth widens significantly; HF beamwidth tightens.
// Suitable for line-array, column, and similar throw-focused speakers.
// =====================================================================

const LA_FREQS = [125, 250, 500, 1000, 2000, 4000];
// At each band: (H beamwidth -6 dB, V beamwidth -6 dB)
const LA_BANDS_H: number[] = [130, 110, 95, 90, 78, 65];
const LA_BANDS_V: number[] = [40, 25, 15, 10, 8, 6];
const LA_H_ANGLES = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 180];
const LA_V_ANGLES = [-90, -60, -45, -30, -20, -10, -5, 0, 5, 10, 20, 30, 45, 60, 90];

export const POLAR_LINE_ARRAY: PolarData = {
  label: 'Generic Line Array (90° × 10°)',
  freqs: LA_FREQS,
  hAngles: LA_H_ANGLES,
  vAngles: LA_V_ANGLES,
  hPolar: LA_BANDS_H.map((bw, i) => {
    // Side lobes deeper at HF (real arrays exhibit tighter, deeper nulls)
    const sideFloor = 14 + i * 2;
    return curveFromBeamwidth(LA_H_ANGLES, bw, sideFloor);
  }),
  vPolar: LA_BANDS_V.map((bw, i) => {
    const sideFloor = 18 + i * 2;
    // Vertical curve uses |angle| since splayed line arrays are symmetric.
    return LA_V_ANGLES.map(a => {
      const v = curveFromBeamwidth([Math.abs(a)], bw, sideFloor)[0];
      return v;
    });
  }),
};

// =====================================================================
// "Generic wide point source" — 90° H × 60° V. LF symmetric, HF lobes
// asymmetric. Models a typical 12" + 1.4" coaxial install speaker.
// =====================================================================

const PS_FREQS = [125, 250, 500, 1000, 2000, 4000];
const PS_BANDS_H: number[] = [150, 120, 100, 90, 75, 65];
const PS_BANDS_V: number[] = [120, 95, 70, 60, 52, 48];
const PS_H_ANGLES = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 180];
const PS_V_ANGLES = [-90, -60, -45, -30, -15, 0, 15, 30, 45, 60, 90];

export const POLAR_POINT_SOURCE: PolarData = {
  label: 'Generic Point Source (90° × 60°)',
  freqs: PS_FREQS,
  hAngles: PS_H_ANGLES,
  vAngles: PS_V_ANGLES,
  hPolar: PS_BANDS_H.map((bw, i) => {
    const sideFloor = 12 + i * 1.5;
    return curveFromBeamwidth(PS_H_ANGLES, bw, sideFloor);
  }),
  vPolar: PS_BANDS_V.map((bw, i) => {
    const sideFloor = 14 + i * 1.5;
    return PS_V_ANGLES.map(a => curveFromBeamwidth([Math.abs(a)], bw, sideFloor)[0]);
  }),
};

// =====================================================================
// "Generic stage monitor" — bi-amped 12" wedge, ~70° H × 50° V, narrow
// rear rejection. Used for floor-monitor and side-fill speakers.
// =====================================================================

const MON_FREQS = [125, 250, 500, 1000, 2000, 4000];
const MON_BANDS_H: number[] = [120, 95, 80, 70, 62, 55];
const MON_BANDS_V: number[] = [100, 75, 60, 50, 42, 38];
const MON_H_ANGLES = [0, 15, 30, 45, 60, 75, 90, 120, 150, 180];
const MON_V_ANGLES = [-90, -60, -45, -30, -15, 0, 15, 30, 45, 60, 90];

export const POLAR_MONITOR: PolarData = {
  label: 'Generic Stage Monitor (70° × 50°)',
  freqs: MON_FREQS,
  hAngles: MON_H_ANGLES,
  vAngles: MON_V_ANGLES,
  hPolar: MON_BANDS_H.map((bw, i) => {
    const sideFloor = 16 + i * 2;
    return curveFromBeamwidth(MON_H_ANGLES, bw, sideFloor);
  }),
  vPolar: MON_BANDS_V.map((bw, i) => {
    const sideFloor = 18 + i * 2;
    return MON_V_ANGLES.map(a => curveFromBeamwidth([Math.abs(a)], bw, sideFloor)[0]);
  }),
};

/** Lookup polars by archetype name — used by the catalog to attach a default
 *  when placing speakers without explicit per-template polar data. */
export const POLAR_DEFAULTS: Record<string, PolarData> = {
  'speaker-line-array': POLAR_LINE_ARRAY,
  'speaker-column':     POLAR_LINE_ARRAY,
  'speaker-point':      POLAR_POINT_SOURCE,
  'speaker-fill':       POLAR_POINT_SOURCE,
  'speaker-delay':      POLAR_POINT_SOURCE,
  'speaker-monitor':    POLAR_MONITOR,
};

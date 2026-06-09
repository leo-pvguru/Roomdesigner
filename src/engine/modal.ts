// =====================================================================
// Low-frequency modal engine
// ---------------------------------------------------------------------
// Geometrical methods (image-source + ray tracing, the basis of EASE and
// this app's main engine) are fundamentally inaccurate below the Schroeder
// frequency — they cannot represent room modes, modal decay, or the
// standing-wave interference that dominates the low end. That's exactly
// where worship/multipurpose-room problems live (bass build-up, boom,
// sub coverage & cancellation).
//
// This module adds a wave-accurate low-frequency model the way Treble's
// hybrid solver does it conceptually — wave physics below a transition
// frequency, geometry above — but scaled to run instantly in the browser:
// instead of a full DG-FEM/FDTD solve, it uses the closed-form modal
// expansion for a rectangular room (the room's bounding box). For the
// roughly-shoebox rooms this app targets, that captures the real modal
// structure (axial / tangential / oblique modes, their frequencies, and
// the standing-wave pressure field) at zero meaningful compute cost.
//
// Outputs:
//   • enumerateModes()      — the room's eigenmodes with type + frequency
//   • analyzeModes()        — Schroeder freq, modal density, plain-language
//                             warnings (boom frequency, coincident/isolated
//                             modes, degenerate dimensions)
//   • computeModalField()   — the standing-wave SPL heatmap at a chosen LF
//                             frequency, coherent across all LF sources,
//                             damped by the band RT60
// =====================================================================

import type { EquipmentItem, RoomState, HeatmapData } from '../types';
import { bboxOf, pointInPolygon } from '../utils/geometry';

/** Speed of sound in ft/s at a given air temperature (°F). */
export function speedOfSoundFtS(tempF = 70): number {
  const tC = (tempF - 32) * 5 / 9;
  const cMs = 331.3 * Math.sqrt(1 + tC / 273.15);
  return cMs * 3.280839895;
}

export type ModeType = 'axial' | 'tangential' | 'oblique';

export interface RoomMode {
  nx: number; ny: number; nz: number;
  /** Modal frequency in Hz. */
  f: number;
  type: ModeType;
}

/** Classify a mode by how many of its indices are non-zero. */
function modeType(nx: number, ny: number, nz: number): ModeType {
  const nz0 = (nx > 0 ? 1 : 0) + (ny > 0 ? 1 : 0) + (nz > 0 ? 1 : 0);
  return nz0 === 1 ? 'axial' : nz0 === 2 ? 'tangential' : 'oblique';
}

/**
 * Enumerate the eigenmodes of a rectangular room (Lx × Ly × Lz, in feet)
 * with modal frequency ≤ fMax. Frequencies:
 *   f(nx,ny,nz) = (c/2)·√((nx/Lx)² + (ny/Ly)² + (nz/Lz)²)
 * Sorted ascending by frequency.
 */
export function enumerateModes(Lx: number, Ly: number, Lz: number, fMax: number, tempF = 70): RoomMode[] {
  const c = speedOfSoundFtS(tempF);
  const out: RoomMode[] = [];
  // Per-axis index ceiling so a single axis can't exceed fMax on its own.
  const maxNx = Math.max(1, Math.floor((2 * fMax * Lx) / c));
  const maxNy = Math.max(1, Math.floor((2 * fMax * Ly) / c));
  const maxNz = Math.max(1, Math.floor((2 * fMax * Lz) / c));
  for (let nx = 0; nx <= maxNx; nx++) {
    const ax = (nx / Lx) ** 2;
    for (let ny = 0; ny <= maxNy; ny++) {
      const ay = (ny / Ly) ** 2;
      for (let nz = 0; nz <= maxNz; nz++) {
        if (nx === 0 && ny === 0 && nz === 0) continue;
        const az = (nz / Lz) ** 2;
        const f = (c / 2) * Math.sqrt(ax + ay + az);
        if (f <= fMax) out.push({ nx, ny, nz, f, type: modeType(nx, ny, nz) });
      }
    }
  }
  out.sort((a, b) => a.f - b.f);
  return out;
}

/** Schroeder (crossover) frequency in Hz — above this the field is
 *  statistically diffuse and geometry is valid; below it, modes dominate.
 *  f_s ≈ 2000·√(T60 / V), V in m³. */
export function schroederFrequency(volumeFt3: number, t60: number): number {
  const vM3 = Math.max(1e-3, volumeFt3 * 0.0283168466);
  const t = Math.max(0.05, t60);
  return 2000 * Math.sqrt(t / vM3);
}

export interface ModalAnalysis {
  /** Bounding-box dimensions used (ft). */
  dims: { Lx: number; Ly: number; Lz: number };
  schroeder: number;
  modes: RoomMode[];
  /** Count of modes at or below the Schroeder frequency (the problem region). */
  modesBelowSchroeder: number;
  /** Mean modal spacing (Hz) in the 20 Hz → Schroeder region. */
  meanSpacing: number;
  /** Plain-language findings for a non-acoustician. */
  warnings: string[];
  /** True when the room is materially non-rectangular, so modal results are
   *  a bounding-box approximation. */
  approximate: boolean;
}

/**
 * Analyze a room's low-frequency modal behavior. Uses the room bounding box
 * as the rectangular approximation. `t60Mid` (the mid-band RT60) sets the
 * Schroeder frequency.
 */
export function analyzeModes(room: RoomState, t60Mid: number): ModalAnalysis {
  const bb = bboxOf(room.shape);
  const Lx = Math.max(1, bb.width);
  const Ly = Math.max(1, bb.depth);
  const Lz = Math.max(1, room.height || 14);
  const volFt3 = Lx * Ly * Lz;
  const schroeder = schroederFrequency(volFt3, t60Mid);
  // Enumerate a little past Schroeder so the density/spacing stats have headroom.
  const fMax = Math.max(120, schroeder * 1.5);
  const modes = enumerateModes(Lx, Ly, Lz, fMax, room.temperatureF ?? 70);

  const below = modes.filter(m => m.f <= schroeder);
  const inRegion = modes.filter(m => m.f >= 20 && m.f <= Math.max(schroeder, 80));
  let meanSpacing = 0;
  for (let i = 1; i < inRegion.length; i++) meanSpacing += inRegion[i].f - inRegion[i - 1].f;
  meanSpacing = inRegion.length > 1 ? meanSpacing / (inRegion.length - 1) : 0;

  const warnings: string[] = [];

  // Lowest axial modes — the fundamentals along each room dimension.
  const axials = modes.filter(m => m.type === 'axial').slice(0, 3);
  if (axials.length) {
    const f0 = axials[0];
    const axisName = f0.nx > 0 ? 'length' : f0.ny > 0 ? 'width' : 'height';
    warnings.push(`Fundamental ${axisName} mode at ${f0.f.toFixed(0)} Hz — expect bass reinforcement and a null at the room's mid-plane there.`);
  }

  // Coincident / near-coincident modes below ~120 Hz — strong resonances.
  const lowModes = modes.filter(m => m.f >= 20 && m.f <= 120);
  for (let i = 1; i < lowModes.length; i++) {
    const a = lowModes[i - 1], b = lowModes[i];
    if (b.f > 0 && Math.abs(b.f - a.f) / b.f < 0.05) {
      warnings.push(`Modes at ${a.f.toFixed(0)} and ${b.f.toFixed(0)} Hz nearly coincide — a pronounced resonance / boom is likely there.`);
      break;
    }
  }

  // Isolated low mode — a gap much larger than the mean spacing leaves a
  // lonely mode that rings (classic "one-note bass").
  if (meanSpacing > 0) {
    for (let i = 1; i < lowModes.length; i++) {
      const gap = lowModes[i].f - lowModes[i - 1].f;
      if (gap > meanSpacing * 2.2 && lowModes[i - 1].f < 100) {
        warnings.push(`Isolated mode near ${lowModes[i - 1].f.toFixed(0)} Hz (large gap to the next) can sound like one-note boom.`);
        break;
      }
    }
  }

  // Degenerate dimensions — equal/integer-related room dimensions pile modes
  // on top of each other.
  const ratioFlag = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b) < 0.04;
  if (ratioFlag(Lx, Ly) || ratioFlag(Lx, Lz) || ratioFlag(Ly, Lz)) {
    warnings.push('Two room dimensions are nearly equal — their modes stack, concentrating LF energy at fewer frequencies. Splaying a wall or changing ceiling height spreads them out.');
  }

  // Is the polygon meaningfully non-rectangular?
  const rectArea = Lx * Ly;
  const polyArea = Math.abs(room.shape.reduce((s, p, i) => {
    const q = room.shape[(i + 1) % room.shape.length];
    return s + (p.x * q.y - q.x * p.y);
  }, 0)) / 2;
  const approximate = room.shape.length !== 4 || polyArea < rectArea * 0.92;

  return { dims: { Lx, Ly, Lz }, schroeder, modes, modesBelowSchroeder: below.length, meanSpacing, warnings, approximate };
}

// ===== Modal pressure field (standing-wave heatmap) =====

/** cos mode shape along one axis at local coordinate u ∈ [0, L]. */
function psi1(n: number, u: number, L: number): number {
  if (n === 0) return 1;
  return Math.cos((n * Math.PI * u) / L);
}

export interface ModalFieldOpts {
  /** LF frequency (Hz) to visualize the standing-wave field at. */
  freq: number;
  /** Low-frequency RT60 (s) — sets modal damping (bandwidth ≈ 2.2/T60). */
  t60LF: number;
  resolutionFt?: number;
  earHeightFt?: number;
  /** SPL the spatial mean is anchored to, so the map reads like the SPL
   *  heatmap (the modal *pattern* — peaks & nulls — is the real signal). */
  anchorSPL?: number;
  tempF?: number;
}

/**
 * Compute the low-frequency standing-wave SPL field across the room at
 * `freq`, summing the modal expansion coherently over all LF-radiating
 * sources. Returns a HeatmapData aligned with the geometrical heatmaps.
 */
export function computeModalField(
  room: RoomState,
  speakers: EquipmentItem[],
  opts: ModalFieldOpts,
): HeatmapData | null {
  const sources = speakers.filter(s => {
    if (s.category !== 'audio-speaker') return false;
    // Drop sources that don't reach this LF (e.g. an 80 Hz-limited fill at 50 Hz).
    if (s.lfHz != null && s.lfHz > opts.freq * 1.4) return false;
    return true;
  });
  if (sources.length === 0) return null;

  const bb = bboxOf(room.shape);
  const Lx = Math.max(1, bb.width);
  const Ly = Math.max(1, bb.depth);
  const Lz = Math.max(1, room.height || 14);
  const tempF = opts.tempF ?? room.temperatureF ?? 70;

  // Modes up to ~2.5× the visualized frequency capture the resonances that
  // shape the field at `freq` without unbounded enumeration.
  const fMax = Math.max(opts.freq * 2.5, 90);
  const modes = enumerateModes(Lx, Ly, Lz, fMax, tempF);
  if (modes.length === 0) return null;

  // Per-mode source drive: Σ_sources amp·ψ_m(source). amp carries level + polarity.
  const srcLocal = sources.map(s => {
    const lvlDb = (s.sensitivity ?? 95) + 20 * Math.log10(Math.max(1, Math.abs(s.drive ?? 75)) / 100);
    const amp = (s.drive != null && s.drive < 0 ? -1 : 1) * Math.pow(10, lvlDb / 20);
    return { u: s.x - bb.minX, v: s.y - bb.minY, w: Math.max(0, Math.min(Lz, s.z)), amp };
  });
  const modeDrive = modes.map(m => {
    let d = 0;
    for (const s of srcLocal) {
      d += s.amp * psi1(m.nx, s.u, Lx) * psi1(m.ny, s.v, Ly) * psi1(m.nz, s.w, Lz);
    }
    return d;
  });

  // Damping: pressure decay rate δ = 6.91/T60 (1/s). The modal denominator's
  // imaginary part is 2·δ·ω — constant across modes — so band-averaging only
  // re-evaluates the denominator. Sample a few freqs across ±1/6 octave.
  const delta = 6.91 / Math.max(0.1, opts.t60LF);
  const fSamples = [opts.freq * 0.917, opts.freq, opts.freq * 1.091];
  const denoms = modes.map(m => {
    const wm = 2 * Math.PI * m.f;
    return fSamples.map(fs => {
      const w = 2 * Math.PI * fs;
      const re = wm * wm - w * w;
      const im = 2 * delta * w;
      return { re, im, mag2: re * re + im * im };
    });
  });

  const res = opts.resolutionFt ?? 2;
  const earZ = opts.earHeightFt ?? 4;
  const cellW = res, cellH = res;
  const gridX = Math.max(2, Math.ceil(bb.width / cellW));
  const gridY = Math.max(2, Math.ceil(bb.depth / cellH));
  const grid: number[][] = [];
  const flat: number[] = [];

  for (let j = 0; j < gridY; j++) {
    const row: number[] = [];
    for (let i = 0; i < gridX; i++) {
      const x = bb.minX + (i + 0.5) * cellW;
      const y = bb.minY + (j + 0.5) * cellH;
      if (!pointInPolygon({ x, y }, room.shape)) { row.push(NaN); continue; }
      const u = x - bb.minX, v = y - bb.minY, w = Math.max(0, Math.min(Lz, earZ));
      // C_m(r) = modeDrive · ψ_m(r). Then G(ω)=Σ C_m/denom_m. Energy-average |G|².
      let energy = 0;
      for (let fsi = 0; fsi < fSamples.length; fsi++) {
        let gRe = 0, gIm = 0;
        for (let mi = 0; mi < modes.length; mi++) {
          const m = modes[mi];
          const cm = modeDrive[mi] * psi1(m.nx, u, Lx) * psi1(m.ny, v, Ly) * psi1(m.nz, w, Lz);
          if (cm === 0) continue;
          const d = denoms[mi][fsi];
          // C_m / (re + i·im) = C_m·(re − i·im)/mag2
          gRe += (cm * d.re) / d.mag2;
          gIm += (-cm * d.im) / d.mag2;
        }
        energy += gRe * gRe + gIm * gIm;
      }
      energy /= fSamples.length;
      const lp = 10 * Math.log10(Math.max(1e-30, energy));
      row.push(lp);
      flat.push(lp);
    }
    grid.push(row);
  }

  if (flat.length === 0) return null;
  // Anchor the spatial mean to a readable SPL so the map shows the modal
  // pattern (peaks/nulls) on an SPL-like scale.
  const meanLp = flat.reduce((a, b) => a + b, 0) / flat.length;
  const anchor = opts.anchorSPL ?? 85;
  let max = -Infinity, min = Infinity, sum = 0, n = 0;
  const vals: number[] = [];
  for (let j = 0; j < gridY; j++) {
    for (let i = 0; i < gridX; i++) {
      const lp = grid[j][i];
      if (!isFinite(lp)) continue;
      const spl = lp - meanLp + anchor;
      grid[j][i] = spl;
      if (spl > max) max = spl;
      if (spl < min) min = spl;
      sum += spl; n += 1; vals.push(spl);
    }
  }
  const avg = n > 0 ? sum / n : anchor;
  const std = n > 0 ? Math.sqrt(vals.reduce((a, b) => a + (b - avg) ** 2, 0) / n) : 0;

  return { grid, cellW, cellH, minX: bb.minX, minY: bb.minY, gridX, gridY, min, max, avg, std };
}

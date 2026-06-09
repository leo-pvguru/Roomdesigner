// Heatmap worker — runs the heavy SPL / clarity / arrival passes off the main
// thread so dragging items doesn't lag.
import {
  rt60 as computeRT60,
  computeHeatmap,
  computeClarity,
  computeArrivalMap,
  computeSpatialMetrics,
} from './acoustics';
import { traceRays, traceRaysPerCell, type RayQuality, defaultRayOptions, type DecayResult } from './rays';
import { OCTAVE_BANDS, type OctaveBand } from '../types';
import type {
  RoomState, EquipmentItem, RT60Result, HeatmapData, Zone, SpatialMetricsResult,
} from '../types';

export interface WorkerRequest {
  id: number;
  room: RoomState;
  speakers: EquipmentItem[];
  panels: EquipmentItem[];
  zones: Zone[];
  obstacles: EquipmentItem[];
  freq: '125' | '1k' | '4k' | 'broadband';
  earlyMs: 50 | 80;
  resolutionFt: number;
  /** Sprint-1 toggle: fold first-order specular reflections (image-source method)
   *  into the SPL heatmap and C50/C80 clarity. When false, the engine falls back
   *  to direct field + Sabine reverberation (the legacy behavior). */
  useReflections: boolean;
  /** Max ISM bounce order. 1 = first-order (Sprint 1 behavior), 2 = corner
   *  reflections (Sprint 2 default), 3 = late-early reflections at higher
   *  cost. Ignored when useReflections is false. */
  maxOrder: number;
  /** Phase-aware (coherent) source summation. When true, sources sum as
   *  complex pressures with phase from path length × frequency, producing
   *  the comb-filter pattern between coincident speakers and between
   *  direct + reflection paths. */
  useCoherentSum: boolean;
  /** Stochastic ray tracing for the late reverberant tail. When true, the
   *  worker runs traceRays() and uses the ray-derived T30 byBand as the
   *  reported RT60 (more accurate than Sabine/Eyring in non-trivial rooms;
   *  feeds STI directly). */
  useRayTracing: boolean;
  /** Ray-tracing quality — controls rays-per-speaker and bin width. */
  rayQuality: RayQuality;
  /** When true (Sprint 4: heatmapMetric === 't30'), the worker also runs
   *  traceRaysPerCell to produce a T30 heatmap. Significantly more compute
   *  than the global pass — only request when the user actually wants the
   *  T30 colormap. */
  computeT30Heatmap: boolean;
  /** Sprint C11 — global ear sampling height in feet. Overridden by zones
   *  with their own floorHeightFt / earHeightFt. */
  earHeightFt: number;
}

/** Subset of the DecayResult that's safe to serialize across the worker
 *  boundary (Float32Array values are transferable; histograms[] are kept
 *  on the worker side and not surfaced to the main thread for v1). */
export interface RaySummary {
  /** Per-band T20 in seconds (already multiplied by 3 → RT60). */
  t20: Partial<Record<OctaveBand, number>>;
  t30: Partial<Record<OctaveBand, number>>;
  edt: Partial<Record<OctaveBand, number>>;
  rt60ByBand: Partial<Record<OctaveBand, number>>;
  rayCount: number;
  /** Schroeder EDC dB per band — flattened for serialization. */
  edcDb: Partial<Record<OctaveBand, Float32Array>>;
  binMs: number;
  numBins: number;
}

export interface WorkerResponse {
  id: number;
  rt60: RT60Result;
  heatmap: HeatmapData | null;
  clarity: HeatmapData | null;
  arrival: HeatmapData | null;
  rays: RaySummary | null;
  /** Per-cell T30 grid from traceRaysPerCell — null when the user hasn't
   *  requested the T30 metric or ray tracing is off. */
  t30Heatmap: HeatmapData | null;
  /** Sprint C13 — Lateral Fraction + IACC_E room-average. Null when ISM
   *  is off (LF needs specular reflections to be physically meaningful). */
  spatial: SpatialMetricsResult | null;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, room, speakers, panels, zones, obstacles, freq, earlyMs, resolutionFt, useReflections, maxOrder, useCoherentSum, useRayTracing, rayQuality, computeT30Heatmap, earHeightFt } = e.data;

  // ===== Stochastic ray tracing (Sprint 3) =====
  // When enabled, the ray pass produces per-band T30 from a real energy
  // decay curve. We splice those values into the RT60Result so downstream
  // consumers (clarity, STI, compliance) all benefit automatically.
  let raysSummary: RaySummary | null = null;
  let rt60RayDerived: RT60Result | null = null;
  if (useRayTracing && speakers.length > 0) {
    const decay: DecayResult = traceRays(room, speakers, defaultRayOptions(rayQuality));
    // Build a shallow byBand RT60 map preferring T30, then T20, then EDT.
    const byBand: Partial<Record<OctaveBand, number>> = {};
    let avgSum = 0, avgN = 0;
    for (const b of OCTAVE_BANDS) {
      const v = decay.rt60ByBand[b];
      if (v != null && isFinite(v)) {
        byBand[b] = v;
        avgSum += v; avgN += 1;
      }
    }
    if (avgN > 0) {
      const avg = avgSum / avgN;
      const at1k = byBand[1000] ?? avg;
      let rating: RT60Result['rating'];
      if (at1k < 0.6) rating = 'Excellent';
      else if (at1k < 1.0) rating = 'Good';
      else if (at1k < 1.5) rating = 'Moderate';
      else if (at1k < 2.0) rating = 'Reverberant';
      else rating = 'Poor';
      rt60RayDerived = {
        byBand: byBand as Record<OctaveBand, number>,
        average: +avg.toFixed(2),
        rating,
      };
    }
    raysSummary = {
      t20: decay.t20,
      t30: decay.t30,
      edt: decay.edt,
      rt60ByBand: decay.rt60ByBand,
      rayCount: decay.rayCount,
      edcDb: decay.edcDb,
      binMs: decay.binMs,
      numBins: decay.numBins,
    };
  }

  // RT60: prefer ray-derived value when valid, else Sabine/Eyring.
  const rt60Stat = computeRT60(room, panels, zones, obstacles, useReflections);
  const rt60 = rt60RayDerived ?? rt60Stat;

  const heatmap = computeHeatmap(room, speakers, freq, resolutionFt, earHeightFt, obstacles, useReflections, maxOrder, zones, useCoherentSum);
  const clarity = computeClarity(room, speakers, rt60, freq, earlyMs, resolutionFt, earHeightFt, obstacles, useReflections, maxOrder, zones);
  const arrival = computeArrivalMap(room, speakers, resolutionFt, earHeightFt, zones);

  // Sprint 4 — per-cell T30 heatmap. Expensive; only run when explicitly requested.
  let t30Heatmap: HeatmapData | null = null;
  if (computeT30Heatmap && useRayTracing && speakers.length > 0) {
    // Map "freq" → octave band so the user's active band drives the report band.
    const reportBand: OctaveBand =
      freq === '125' ? 125 :
      freq === '4k'  ? 4000 : 1000;
    const cell = traceRaysPerCell(room, speakers, {
      ...defaultRayOptions(rayQuality),
      reportBand,
      earHeightFt,
      zones,
    });
    t30Heatmap = cell.t30Grid;
  }
  // Sprint C13 — spatial impression metrics. Cheap; only meaningful when
  // ISM is on (LF is fundamentally about reflected-sound geometry).
  const spatial = useReflections && speakers.length > 0
    ? computeSpatialMetrics(room, speakers, maxOrder, zones)
    : null;

  const response: WorkerResponse = { id, rt60, heatmap, clarity, arrival, rays: raysSummary, t30Heatmap, spatial };
  (self as unknown as Worker).postMessage(response);
};

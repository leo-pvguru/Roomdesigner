// Thin client over the heatmap web worker. Drops stale replies (id-based),
// falls back to main-thread compute if Workers aren't available.
import {
  rt60 as computeRT60,
  computeHeatmap,
  computeClarity,
  computeArrivalMap,
} from './acoustics';
import { traceRays, traceRaysPerCell, defaultRayOptions, type RayQuality } from './rays';
import { computeSpatialMetrics } from './acoustics';
import { OCTAVE_BANDS, type OctaveBand } from '../types';
import type {
  RoomState, EquipmentItem, RT60Result, HeatmapData, Zone, SpatialMetricsResult,
} from '../types';
import type { WorkerRequest, WorkerResponse, RaySummary } from './heatmap.worker';

export interface SimResult {
  rt60: RT60Result;
  heatmap: HeatmapData | null;
  clarity: HeatmapData | null;
  arrival: HeatmapData | null;
  rays: RaySummary | null;
  t30Heatmap: HeatmapData | null;
  spatial: SpatialMetricsResult | null;
}

export interface SimRequest {
  room: RoomState;
  speakers: EquipmentItem[];
  panels: EquipmentItem[];
  zones: Zone[];
  obstacles: EquipmentItem[];
  freq: '125' | '1k' | '4k' | 'broadband';
  earlyMs: 50 | 80;
  resolutionFt?: number;
  /** When true, fold specular reflections into the SPL field + clarity. */
  useReflections?: boolean;
  /** Max ISM bounce order. Defaults to 2. */
  maxOrder?: number;
  /** Phase-aware source summation. Off by default. */
  useCoherentSum?: boolean;
  /** Stochastic ray tracing for late-tail decay analysis. Off by default. */
  useRayTracing?: boolean;
  /** Ray quality preset. Defaults to 'medium'. */
  rayQuality?: RayQuality;
  /** Sprint 4 — when true, also run per-cell ray tracing to build a T30
   *  heatmap. Expensive; the caller passes true only when it actually needs
   *  to render the T30 colormap. */
  computeT30Heatmap?: boolean;
  /** Sprint C11 — global ear sampling height (ft). Defaults to 4. Per-zone
   *  overrides on Zone.floorHeightFt / Zone.earHeightFt take precedence. */
  earHeightFt?: number;
}

type Listener = (running: boolean) => void;

class HeatmapClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private latestRequestedId = 0;
  private listeners = new Set<Listener>();
  private inflight = false;

  constructor() {
    try {
      // Vite supports `?worker` to bundle a worker entry.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — Vite resolves this at build time.
      this.worker = new Worker(new URL('./heatmap.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      this.worker = null;
    }
  }

  onStateChange(listener: Listener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private setRunning(b: boolean) {
    if (this.inflight === b) return;
    this.inflight = b;
    for (const l of this.listeners) l(b);
  }

  /** Run a simulation. Resolves with the result, or null if a newer request superseded this one. */
  run(req: SimRequest): Promise<SimResult | null> {
    const id = ++this.nextId;
    this.latestRequestedId = id;
    this.setRunning(true);

    const request: WorkerRequest = {
      id,
      room: req.room,
      speakers: req.speakers,
      panels: req.panels,
      zones: req.zones,
      obstacles: req.obstacles,
      freq: req.freq,
      earlyMs: req.earlyMs,
      resolutionFt: req.resolutionFt ?? 2,
      useReflections: req.useReflections ?? false,
      maxOrder: req.maxOrder ?? 2,
      useCoherentSum: req.useCoherentSum ?? false,
      useRayTracing: req.useRayTracing ?? false,
      rayQuality: req.rayQuality ?? 'medium',
      computeT30Heatmap: req.computeT30Heatmap ?? false,
      earHeightFt: req.earHeightFt ?? 4,
    };

    if (!this.worker) {
      // Main-thread fallback — block during compute, but match the shape.
      return new Promise<SimResult | null>(resolve => {
        Promise.resolve().then(() => {
          if (id !== this.latestRequestedId) { resolve(null); return; }
          // Ray tracing (Sprint 3) — replicate worker logic.
          let raysSummary: RaySummary | null = null;
          let rt60RayDerived: RT60Result | null = null;
          if (request.useRayTracing && request.speakers.length > 0) {
            const decay = traceRays(request.room, request.speakers, defaultRayOptions(request.rayQuality));
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
          const rt60Stat = computeRT60(request.room, request.panels, request.zones, request.obstacles, request.useReflections);
          const rt60 = rt60RayDerived ?? rt60Stat;
          const heatmap = computeHeatmap(request.room, request.speakers, request.freq, request.resolutionFt, request.earHeightFt, request.obstacles, request.useReflections, request.maxOrder, request.zones, request.useCoherentSum);
          const clarity = computeClarity(request.room, request.speakers, rt60, request.freq, request.earlyMs, request.resolutionFt, request.earHeightFt, request.obstacles, request.useReflections, request.maxOrder, request.zones);
          const arrival = computeArrivalMap(request.room, request.speakers, request.resolutionFt, request.earHeightFt, request.zones);
          let t30Heatmap: HeatmapData | null = null;
          if (request.computeT30Heatmap && request.useRayTracing && request.speakers.length > 0) {
            const reportBand: OctaveBand =
              request.freq === '125' ? 125 :
              request.freq === '4k'  ? 4000 : 1000;
            const cell = traceRaysPerCell(request.room, request.speakers, {
              ...defaultRayOptions(request.rayQuality),
              reportBand,
              earHeightFt: request.earHeightFt,
              zones: request.zones,
            });
            t30Heatmap = cell.t30Grid;
          }
          const spatial = request.useReflections && request.speakers.length > 0
            ? computeSpatialMetrics(request.room, request.speakers, request.maxOrder, request.zones)
            : null;
          this.setRunning(false);
          resolve({ rt60, heatmap, clarity, arrival, rays: raysSummary, t30Heatmap, spatial });
        });
      });
    }

    return new Promise<SimResult | null>((resolve) => {
      const worker = this.worker!;
      // Generous ceiling — high-quality per-cell ray tracing on a large room
      // can legitimately take ~20s. 60s means "the worker is wedged", not
      // "it's still working". Without this, a worker that throws or hangs
      // would freeze the heatmap forever and leak this listener.
      const TIMEOUT_MS = 60_000;
      let settled = false;

      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        clearTimeout(timer);
      };
      // Resolve this request and, when it's still the active one, release the
      // running flag so the UI stops showing "Computing…".
      const finish = (value: SimResult | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (id === this.latestRequestedId) this.setRunning(false);
        resolve(value);
      };

      const onMessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.id !== id) return; // not ours
        if (id !== this.latestRequestedId) {
          // Superseded by a newer request — don't surface, and let the newer
          // request own the running flag (finish() guards on latestRequestedId).
          finish(null);
          return;
        }
        finish({
          rt60: e.data.rt60,
          heatmap: e.data.heatmap,
          clarity: e.data.clarity,
          arrival: e.data.arrival,
          rays: e.data.rays,
          t30Heatmap: e.data.t30Heatmap,
          spatial: e.data.spatial,
        });
      };

      const onError = (ev: ErrorEvent) => {
        // The worker threw. Unfreeze the UI and surface nothing rather than
        // hang. (ev.message is logged for debugging; not shown to the user.)
        if (typeof console !== 'undefined') {
          console.error('Heatmap worker error:', ev.message || ev);
        }
        finish(null);
      };

      const timer = setTimeout(() => {
        if (typeof console !== 'undefined') {
          console.error(`Heatmap worker timed out after ${TIMEOUT_MS}ms`);
        }
        finish(null);
      }, TIMEOUT_MS);

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage(request);
    });
  }

  destroy() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
  }
}

let _instance: HeatmapClient | null = null;
export function getHeatmapClient(): HeatmapClient {
  if (!_instance) _instance = new HeatmapClient();
  return _instance;
}

// Separate client for the A/B compare side so its requests don't cancel
// the live simulation (and vice versa) — they share the same id space otherwise.
let _compareInstance: HeatmapClient | null = null;
export function getCompareHeatmapClient(): HeatmapClient {
  if (!_compareInstance) _compareInstance = new HeatmapClient();
  return _compareInstance;
}

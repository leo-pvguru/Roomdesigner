// Electrical / power calc for equipment placed in the room.
// Converts wattage into amp draw at 120V (US default), groups by circuit,
// flags overloaded breakers per the NEC 80% continuous-load rule.

import type { EquipmentItem, EquipmentKind } from '../types';

export const VOLTS_AC = 120;          // US standard branch circuit
export const BREAKER_AMPS = 20;       // typical 20A circuit
export const NEC_DUTY = 0.80;         // continuous load max = 80% of breaker rating
export const POWER_FACTOR = 0.85;     // typical pro-AV equipment PF

// Sensible default running-watt draw per kind. Numbers are conservative for a
// "all things on, lights up, system at moderate level" condition — i.e. the
// scenario you'd plan circuits around.
const DEFAULTS_BY_KIND: Partial<Record<EquipmentKind, number>> = {
  // Powered speakers (full output) — derate from rated continuous power
  'speaker-point':       250,
  'speaker-line-array':  450,
  'speaker-column':      150,
  'speaker-sub':         800,
  'speaker-sub-flown':   800,
  'speaker-monitor':     350,
  'speaker-fill':         80,
  'speaker-delay':       250,
  'speaker-ceiling':      40,
  'speaker-iem':          40,

  // Audio signal chain
  'foh-console':         180,
  'monitor-console':     180,
  'amp-rack':           1200,
  'snake':                 5,
  'dsp':                  60,

  // Video
  'projector':           450,
  'led-wall':            350,        // per panel
  'ptz-camera':           20,
  'cam-handheld':         15,
  'confidence-monitor':  120,

  // Lighting
  'mh-spot':             450,
  'mh-wash':             400,
  'led-par':             100,
  'followspot':         1200,
  'lx-console':          120,
  'dimmer-rack':        2400,        // typical 12-channel pack at half load

  // Infrastructure
  'rack':                  0,
  'pdu':                   0,
  'cable-run':             0,
};

/** Default wattage for an item kind. Returns 0 if unknown (treated as no-load). */
export function defaultWattageFor(kind: EquipmentKind): number {
  return DEFAULTS_BY_KIND[kind] ?? 0;
}

/** Effective wattage for an item — uses the manual override if set, else the kind default. */
export function effectiveWattage(item: EquipmentItem): number {
  if (typeof item.wattage === 'number' && item.wattage >= 0) return item.wattage;
  // For powered speakers without an explicit override, scale the rated power
  // by ~25% to estimate a real-world average draw at speech / mid-program level.
  if (item.category === 'audio-speaker' && typeof item.power === 'number' && item.power > 0) {
    return Math.round(item.power * 0.25);
  }
  return defaultWattageFor(item.kind);
}

/** Amps drawn at the line voltage, accounting for power factor. */
export function ampsAt120V(watts: number): number {
  if (watts <= 0) return 0;
  return watts / (VOLTS_AC * POWER_FACTOR);
}

export interface CircuitSummary {
  id: string;            // circuit name; '__unassigned' if none
  name: string;          // display label
  items: EquipmentItem[];
  watts: number;
  amps: number;
  pctOfBreaker: number;  // 0..1+ — share of NEC continuous (80% × breakerAmps) limit
  overloaded: boolean;   // pctOfBreaker > 1.0
  warning: boolean;      // pctOfBreaker > 0.8 but not yet overloaded
}

const UNASSIGNED_KEY = '__unassigned';

/**
 * Bucket all equipment into circuits. Items with no circuit field are grouped
 * under the synthetic "Unassigned" bucket so the user can see what hasn't been
 * planned yet.
 */
export function summarizeCircuits(equipment: EquipmentItem[]): {
  circuits: CircuitSummary[];
  totalWatts: number;
  totalAmps: number;
} {
  const buckets = new Map<string, EquipmentItem[]>();
  for (const item of equipment) {
    if (item.category === 'reference') continue;
    const key = item.circuit && item.circuit.trim() !== '' ? item.circuit.trim() : UNASSIGNED_KEY;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(item);
  }

  const continuousLimit = BREAKER_AMPS * NEC_DUTY;   // 16 A on a 20 A breaker
  const circuits: CircuitSummary[] = [];
  let totalWatts = 0;

  for (const [id, items] of buckets) {
    const watts = items.reduce((sum, it) => sum + effectiveWattage(it), 0);
    const amps = ampsAt120V(watts);
    const pct = amps / continuousLimit;
    circuits.push({
      id,
      name: id === UNASSIGNED_KEY ? 'Unassigned' : id,
      items,
      watts,
      amps,
      pctOfBreaker: pct,
      overloaded: pct > 1.0,
      warning: pct > 0.8 && pct <= 1.0,
    });
    totalWatts += watts;
  }

  // Sort: assigned circuits alphabetically, "Unassigned" pinned last.
  circuits.sort((a, b) => {
    if (a.id === UNASSIGNED_KEY) return 1;
    if (b.id === UNASSIGNED_KEY) return -1;
    return a.name.localeCompare(b.name);
  });

  return { circuits, totalWatts, totalAmps: ampsAt120V(totalWatts) };
}

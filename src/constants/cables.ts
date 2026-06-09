// Cable type metadata — colors for rendering, labels for UI, signal class
// for grouping in BOMs, and rough per-foot pricing for proposal estimates.

import type { CableType } from '../types';

export type SignalClass = 'audio' | 'speaker' | 'network' | 'control' | 'power' | 'video';

export interface CableSpec {
  id: CableType;
  label: string;            // short label ("XLR", "Cat6")
  longLabel: string;        // verbose label ("Balanced analog audio (XLR)")
  signalClass: SignalClass;
  color: string;            // line color in viewport
  /** Recommended max run length in feet — used as a guideline warning. */
  maxLengthFt: number;
  /** Rough cost per foot for proposal estimates ($USD). */
  costPerFt: number;
}

export const CABLE_SPECS: Record<CableType, CableSpec> = {
  xlr: {
    id: 'xlr', label: 'XLR', longLabel: 'Analog audio · XLR (3-pin)',
    signalClass: 'audio', color: '#1A4FBF', maxLengthFt: 200, costPerFt: 1.20,
  },
  trs: {
    id: 'trs', label: 'TRS', longLabel: 'Analog line · 1/4" TRS',
    signalClass: 'audio', color: '#3B6BD0', maxLengthFt: 50, costPerFt: 0.90,
  },
  nl4: {
    id: 'nl4', label: 'NL4', longLabel: 'Speaker · Speakon NL4',
    signalClass: 'speaker', color: '#0B3A8C', maxLengthFt: 150, costPerFt: 2.40,
  },
  cat5e: {
    id: 'cat5e', label: 'Cat5e', longLabel: 'Network · Cat5e (Dante / control)',
    signalClass: 'network', color: '#2F9E5E', maxLengthFt: 295, costPerFt: 0.45,
  },
  cat6: {
    id: 'cat6', label: 'Cat6', longLabel: 'Network · Cat6 (Dante / AVB)',
    signalClass: 'network', color: '#1F7A47', maxLengthFt: 295, costPerFt: 0.65,
  },
  dmx: {
    id: 'dmx', label: 'DMX', longLabel: 'Lighting control · DMX512 (5-pin)',
    signalClass: 'control', color: '#A855F7', maxLengthFt: 1000, costPerFt: 1.10,
  },
  ac: {
    id: 'ac', label: 'AC', longLabel: 'AC mains power · 12 AWG',
    signalClass: 'power', color: '#C53030', maxLengthFt: 100, costPerFt: 0.85,
  },
  fiber: {
    id: 'fiber', label: 'Fiber', longLabel: 'Optical fiber (single-mode)',
    signalClass: 'network', color: '#FBBF24', maxLengthFt: 1000, costPerFt: 1.50,
  },
  hdmi: {
    id: 'hdmi', label: 'HDMI', longLabel: 'Video · HDMI',
    signalClass: 'video', color: '#06B6D4', maxLengthFt: 50, costPerFt: 1.80,
  },
  sdi: {
    id: 'sdi', label: 'SDI', longLabel: 'Video · 3G/12G-SDI',
    signalClass: 'video', color: '#0891B2', maxLengthFt: 300, costPerFt: 1.30,
  },
  usb: {
    id: 'usb', label: 'USB', longLabel: 'USB / data',
    signalClass: 'control', color: '#94A3B8', maxLengthFt: 15, costPerFt: 1.00,
  },
};

export const CABLE_TYPES: CableType[] = [
  'xlr', 'trs', 'nl4', 'cat5e', 'cat6', 'dmx', 'ac', 'fiber', 'hdmi', 'sdi', 'usb',
];

/** Default cable type to suggest when starting a new connection from a given device kind. */
export function defaultCableForKind(kind: string): CableType {
  if (kind.startsWith('speaker-') || kind === 'speaker') return 'nl4';
  if (kind === 'mh-spot' || kind === 'mh-wash' || kind === 'led-par'
      || kind === 'followspot' || kind === 'lx-console' || kind === 'dimmer-rack') return 'dmx';
  if (kind === 'projector' || kind === 'led-wall' || kind === 'confidence-monitor') return 'hdmi';
  if (kind === 'ptz-camera' || kind === 'cam-handheld') return 'sdi';
  if (kind === 'foh-console' || kind === 'monitor-console' || kind === 'dsp' || kind === 'snake') return 'cat6';
  if (kind === 'breaker-panel' || kind === 'pdu') return 'ac';
  return 'xlr';
}

/**
 * Straight-line distance between two points in feet, with a slack
 * multiplier so a quoted length includes service loops + routing.
 */
export function straightLineLengthFt(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  slackPct = 0.20,
): number {
  const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  return d * (1 + slackPct);
}

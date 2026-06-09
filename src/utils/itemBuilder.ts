// =====================================================================
// Item-from-template builder
// ---------------------------------------------------------------------
// Single source of truth for turning an EquipmentTemplate into a placed
// EquipmentItem. Both the catalog "+ Place" button and the viewport's
// drag-drop handler call this so the resulting item has IDENTICAL fields
// regardless of how it was placed — no more "items dropped via drag look
// different from items placed via the catalog button" surprises.
//
// Also handles:
//   • Smart default rotation (face the room center / audience)
//   • Per-kind frequency-response defaults
//   • Polar-data inheritance from the catalog defaults
//   • All the brand-specific spec fields (lf, polar, panelPattern,
//     panelColor, throwRatio, brightness, beamAngleDeg, etc.)
// =====================================================================

import type { EquipmentItem, EquipmentTemplate, RoomState } from '../types';
import { POLAR_DEFAULTS } from '../constants/polars';

export interface PlacementOpts {
  /** World-space x,y where the item should land. */
  x: number;
  y: number;
  /** World-space z. When omitted, a sensible per-kind default is used. */
  z?: number;
  /** Override rotation in degrees (CCW from +x). When omitted, rotation
   *  defaults to "face the room center" — speakers and lights point
   *  toward the room centroid; cameras / projectors face the same way. */
  rotation?: number;
}

function makeId(kind: string): string {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}

/** Default Z height for an item kind when the caller doesn't specify. */
function defaultZFor(kind: string): number {
  if (kind === 'speaker-sub')           return 1;
  if (kind === 'speaker-sub-flown')     return 16;
  if (kind === 'speaker-ceiling')       return 12;
  if (kind === 'speaker-line-array')    return 18;
  if (kind === 'speaker-monitor')       return 1;
  if (kind === 'speaker-fill')          return 8;
  if (kind === 'speaker-delay')         return 14;
  if (kind === 'speaker-column')        return 14;
  if (kind === 'speaker-point')         return 14;
  if (kind === 'speaker-iem')           return 4;
  if (kind === 'projector')             return 14;
  if (kind === 'led-wall')              return 6;
  if (kind === 'ptz-camera')            return 12;
  if (kind === 'cam-handheld')          return 5;
  if (kind === 'confidence-monitor')    return 4;
  if (kind === 'mh-spot' || kind === 'mh-wash' || kind === 'led-par' || kind === 'followspot') return 14;
  if (kind === 'truss-straight' || kind === 'truss-square' || kind === 'truss-circle') return 16;
  if (kind === 'acoustic-panel')        return 5;
  if (kind === 'bass-trap')             return 0.5;
  if (kind === 'diffuser')              return 5;
  if (kind === 'breaker-panel')         return 4;
  if (kind === 'pdu')                   return 3;
  if (kind === 'dimmer-rack' || kind === 'amp-rack' || kind === 'rack' || kind === 'dsp') return 0;
  // Furniture sits on the floor.
  if (kind === 'chair-padded' || kind === 'chair-stacking' || kind === 'pew' ||
      kind === 'table' || kind === 'podium' || kind === 'rug') return 0;
  return 4;
}

/** Default tilt in degrees (negative = aimed downward). */
function defaultTiltFor(kind: string): number {
  if (kind === 'speaker-ceiling')                  return -88;   // straight down
  if (kind === 'speaker-line-array')               return -10;
  if (kind === 'speaker-fill')                     return -25;
  if (kind === 'speaker-delay')                    return -10;
  if (kind === 'speaker-monitor')                  return  18;   // tilt up at performer
  if (kind === 'mh-spot' || kind === 'mh-wash')    return -45;
  if (kind === 'followspot')                       return -30;
  if (kind === 'led-par')                          return -45;
  if (kind === 'projector')                        return -10;
  return -8;
}

/** Default drive (% of sensitivity) for speakers. */
function defaultDriveFor(kind: string): number {
  if (kind === 'speaker-sub' || kind === 'speaker-sub-flown') return 80;
  if (kind === 'speaker-ceiling')                              return 70;
  if (kind === 'speaker-monitor')                              return 70;
  if (kind === 'speaker-fill')                                 return 50;
  if (kind === 'speaker-delay')                                return 60;
  if (kind === 'speaker-iem')                                  return 0;
  return 75;
}

/** Per-kind LF/HF rolloff defaults — speakers without explicit lfHz/hfHz
 *  get sensible filter corners so the heatmap respects each kind's role. */
function defaultFreqResponse(kind: string): { lfHz?: number; hfHz?: number } {
  switch (kind) {
    case 'speaker-sub':
    case 'speaker-sub-flown':   return { lfHz: 30,  hfHz: 100  };
    case 'speaker-line-array':  return { lfHz: 60,  hfHz: 18000 };
    case 'speaker-monitor':     return { lfHz: 70,  hfHz: 16000 };
    case 'speaker-ceiling':     return { lfHz: 80,  hfHz: 15000 };
    case 'speaker-fill':
    case 'speaker-delay':       return { lfHz: 70,  hfHz: 18000 };
    case 'speaker-column':      return { lfHz: 80,  hfHz: 17000 };
    case 'speaker-iem':         return { lfHz: 0,   hfHz: 0     };
    case 'speaker-point':       return { lfHz: 60,  hfHz: 18000 };
    default:                    return {};
  }
}

/**
 * Compute a smart default rotation/aim so a fresh item faces the room
 * center / audience based on its drop position.
 *
 * For speakers + lights + cameras + projectors + screens that have a
 * "front", we want them aimed inward — at the room centroid. So an item
 * dropped at the back of the room should face the front (negative y),
 * and an item dropped at the front should face the back, etc.
 *
 * Returns rotation in degrees (CCW from +x, where 90° = +y / facing back).
 */
function smartDefaultRotation(
  kind: string,
  x: number, y: number,
  room: RoomState | null | undefined,
): number {
  if (!room) return 0;
  // Trusses / panels / consoles / racks rotate to align with room axis,
  // not to face anything. Default 0 (along +x).
  if (kind === 'truss-straight' || kind === 'truss-square' || kind === 'truss-circle') return 0;
  if (kind === 'acoustic-panel' || kind === 'bass-trap' || kind === 'diffuser') return 0;
  // Seating faces the stage (front of room = low y → facing −y = −90°).
  if (kind === 'chair-padded' || kind === 'chair-stacking' || kind === 'pew') return -90;
  // A lectern faces the audience (toward the back = +y = 90°); tables are neutral.
  if (kind === 'podium') return 90;
  if (kind === 'table' || kind === 'rug') return 0;
  if (kind === 'foh-console' || kind === 'monitor-console' || kind === 'lx-console') return 90;
  if (kind === 'amp-rack' || kind === 'rack' || kind === 'dsp' || kind === 'dimmer-rack' ||
      kind === 'pdu' || kind === 'snake' || kind === 'breaker-panel') return 0;
  if (kind === 'cable-run') return 0;
  if (kind === 'reference-point') return 0;

  // Need at least 3 vertices for a meaningful centroid. A 0/1/2-vertex
  // "polygon" is a point or line — there's no inside to face. Bail with
  // the audience-facing default (90° = +y) rather than computing a bogus
  // angle from a degenerate centroid.
  if (!room.shape || room.shape.length < 3) return 90;

  // Compute room centroid
  let cx = 0, cy = 0;
  for (const p of room.shape) { cx += p.x; cy += p.y; }
  cx /= room.shape.length;
  cy /= room.shape.length;

  // Vector from item to centroid — that's the direction the item should face.
  const dx = cx - x, dy = cy - y;
  if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) return 90;
  return Math.atan2(dy, dx) * 180 / Math.PI;
}

/**
 * Build a fully-populated EquipmentItem from a template + placement opts.
 * Used by both the catalog "+ Place" path and the viewport drag-drop path
 * so the two are guaranteed to produce identical results.
 */
export function buildItemFromTemplate(
  t: EquipmentTemplate,
  opts: PlacementOpts,
  room?: RoomState | null,
): EquipmentItem {
  const z = opts.z ?? defaultZFor(t.kind);
  const rotation = opts.rotation ?? smartDefaultRotation(t.kind, opts.x, opts.y, room);
  const aim = rotation;                        // aim follows rotation by default
  const tilt = defaultTiltFor(t.kind);
  const drive = defaultDriveFor(t.kind);
  const freq = defaultFreqResponse(t.kind);

  const isPanel = t.category === 'acoustic';
  const isLineArray = t.kind === 'speaker-line-array';

  return {
    id: makeId(t.kind),
    templateId: `${t.brand ?? ''}-${t.label}`,
    kind: t.kind,
    category: t.category,
    label: t.label,
    brand: t.brand,
    x: opts.x, y: opts.y, z,
    rotation,
    aim, tilt, drive,
    horiz: t.horiz, vert: t.vert,
    maxSPL: t.maxSPL, sensitivity: t.sensitivity, power: t.power,
    lfHz: t.lfHz ?? freq.lfHz,
    hfHz: t.hfHz ?? freq.hfHz,
    lf:   t.lf,
    polar: t.polar ?? POLAR_DEFAULTS[t.kind],
    nrc: t.nrc,
    alpha: t.alpha,
    panelW: isPanel ? (t.defaultW ?? 4) : undefined,
    panelH: isPanel ? (t.defaultD ?? 2) : undefined,
    wall:   isPanel ? 'L' : undefined,
    panelPattern: t.panelPattern,
    panelColor:   t.panelColor,
    width:  t.defaultW,
    depth:  t.defaultD,
    // Line-array preset
    ...(isLineArray ? { boxes: 6, splay: 1.5 } : {}),
    // Truss preset dimensions
    ...(t.kind === 'truss-straight' ? { trussLengthFt: 20 } : {}),
    ...(t.kind === 'truss-square'   ? { trussWidthFt: 16, trussDepthFt: 16 } : {}),
    ...(t.kind === 'truss-circle'   ? { trussDiameterFt: 12 } : {}),
    // Video / lighting spec inheritance — drives 3D shape recipes
    throwRatio:     t.throwRatio,
    screenWidthFt:  t.screenWidthFt,
    screenHeightFt: t.screenHeightFt,
    resolution:     t.resolution,
    brightness:     t.brightness,
    fovDeg:         t.fovDeg,
    hasPtz:         t.hasPtz,
    beamAngleDeg:   t.beamAngleDeg,
    zoomMinDeg:     t.zoomMinDeg,
    zoomMaxDeg:     t.zoomMaxDeg,
    colorTempK:     t.colorTempK,
    wattage:        t.wattage,
  };
}

/** Snap a coordinate to the nearest grid step (default 1 ft). */
export function snapToGrid(v: number, stepFt: number = 1): number {
  return Math.round(v / stepFt) * stepFt;
}

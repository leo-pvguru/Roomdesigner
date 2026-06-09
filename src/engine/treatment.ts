// =====================================================================
// Auto-treatment planner
// ---------------------------------------------------------------------
// Two-stage treatment placement:
//
//   1. **Reflection-point pass** — find first-order specular reflections
//      from each speaker to each sample listener and cluster them on
//      each surface (left/right walls, back wall, ceiling). Drop a panel
//      at every cluster. Treats the *audible* early reflections, which
//      is the textbook starting point for any room.
//
//   2. **RT60 fitting pass** — compute Eyring RT60 with the reflection
//      panels in place, and add ceiling clouds + corner bass traps
//      iteratively until the mid-band average lands at the target. Stops
//      when the target is reached or the panel budget is exhausted.
//
// Together this addresses both spatial fidelity (early reflections) and
// total energy decay (RT60), which is what room treatment actually has
// to do — neither alone is enough.
// =====================================================================

import type {
  AbsorptionCoefficients, EquipmentItem, Point3, RoomState, Zone,
} from '../types';
import { rt60 } from './acoustics';

export type TreatmentStrategy = 'reflections' | 'rt60' | 'both';

export interface TreatmentOptions {
  /** Target RT60 in seconds (mid-band 500/1k average). When omitted, uses a
   *  per-room-type sensible default. */
  targetRT60?: number;
  /** Where to place panels. */
  strategy?: TreatmentStrategy;
  /** Cap on total panels added — prevents the planner from drowning a
   *  hopelessly reverberant room in panels. Default 24. */
  maxPanels?: number;
  /** Add corner bass traps when the 125 Hz RT60 is above 1.4× target.
   *  Default true. Bass traps are strongly recommended for any room with
   *  exposed corners, but the user can opt out. */
  addBassTraps?: boolean;
}

export interface TreatmentResult {
  /** New panels to add to the room (does not include any pre-existing
   *  acoustic items). */
  panels: EquipmentItem[];
  /** Predicted RT60 (mid-band 500/1k average) after placement. */
  predictedRT60: number;
  /** Per-band predicted RT60. */
  predictedByBand: Record<number, number>;
  /** True when the target was hit within 0.1 s. */
  reachedTarget: boolean;
}

/** Sensible default RT60 target by room type, in seconds (mid-band). */
export function defaultTargetRT60(roomType: RoomState['roomType']): number {
  switch (roomType) {
    case 'sanctuary':    return 1.4;   // worship — supports congregational singing
    case 'multipurpose': return 1.0;   // mixed speech + music
    case 'fellowship':   return 0.9;   // primarily speech
    case 'gym':          return 1.4;   // ambitious for a gym; modest goal
    case 'outdoor':      return 0.0;   // N/A — no auto-treat
    default:             return 1.0;
  }
}

// ===== Reflection-point geometry =====

const PANEL_BROADBAND_ALPHA: AbsorptionCoefficients = {
  125: 0.20, 250: 0.55, 500: 0.89, 1000: 0.99, 2000: 0.99, 4000: 0.99,
};
/** 4"-thick broadband panel — extends absorption into the low-mids. Used
 *  when the room's absorption deficit is large enough that 2" panels would
 *  blow the panel-count budget. */
const PANEL_4IN_ALPHA: AbsorptionCoefficients = {
  125: 0.45, 250: 0.95, 500: 1.05, 1000: 1.00, 2000: 1.00, 4000: 0.98,
};
const PANEL_CLOUD_ALPHA: AbsorptionCoefficients = {
  125: 0.18, 250: 0.50, 500: 0.85, 1000: 0.95, 2000: 0.95, 4000: 0.95,
};
const PANEL_BASSTRAP_ALPHA: AbsorptionCoefficients = {
  125: 0.85, 250: 0.85, 500: 0.70, 1000: 0.55, 2000: 0.45, 4000: 0.35,
};

type Wall = 'L' | 'R' | 'F' | 'B' | 'C';

/** Mirror a 3D point across one of the room's bounding planes. */
function mirror(P: Point3, wall: Wall, room: RoomState): Point3 {
  switch (wall) {
    case 'L': return { x: -P.x,                y: P.y,                z: P.z };
    case 'R': return { x: 2 * room.width - P.x, y: P.y,                z: P.z };
    case 'F': return { x: P.x,                  y: -P.y,               z: P.z };
    case 'B': return { x: P.x,                  y: 2 * room.depth - P.y, z: P.z };
    case 'C': return { x: P.x,                  y: P.y,                z: 2 * room.height - P.z };
  }
}

/** Where a line from `from` to `to` intersects a wall plane, or `null`
 *  if the segment doesn't cross the plane within [0, 1]. */
function intersectWall(from: Point3, to: Point3, wall: Wall, room: RoomState): Point3 | null {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  let t: number;
  switch (wall) {
    case 'L': if (Math.abs(dx) < 1e-6) return null; t = -from.x / dx; break;
    case 'R': if (Math.abs(dx) < 1e-6) return null; t = (room.width  - from.x) / dx; break;
    case 'F': if (Math.abs(dy) < 1e-6) return null; t = -from.y / dy; break;
    case 'B': if (Math.abs(dy) < 1e-6) return null; t = (room.depth  - from.y) / dy; break;
    case 'C': if (Math.abs(dz) < 1e-6) return null; t = (room.height - from.z) / dz; break;
  }
  if (t < 0 || t > 1) return null;
  return {
    x: from.x + t * dx,
    y: from.y + t * dy,
    z: from.z + t * dz,
  };
}

/** First-order specular reflection point on a wall — where the line from
 *  the mirrored speaker to the listener crosses that wall. */
function reflectionPoint(S: Point3, L: Point3, wall: Wall, room: RoomState): Point3 | null {
  const Sm = mirror(S, wall, room);
  return intersectWall(Sm, L, wall, room);
}

interface ReflectionCluster {
  point: Point3;
  wall: Wall;
  count: number;
}

/** Bin reflection points into clusters within `radius` ft on the same
 *  wall. Returns clusters sorted by hit count (busiest first). */
function clusterPoints(
  points: Array<{ point: Point3; wall: Wall }>,
  radius: number,
): ReflectionCluster[] {
  const clusters: ReflectionCluster[] = [];
  for (const p of points) {
    let merged = false;
    for (const c of clusters) {
      if (c.wall !== p.wall) continue;
      const dx = c.point.x - p.point.x;
      const dy = c.point.y - p.point.y;
      const dz = c.point.z - p.point.z;
      if (Math.hypot(dx, dy, dz) < radius) {
        // Running average so the cluster's centroid converges toward the
        // dense centroid of its members.
        const k = c.count + 1;
        c.point.x = (c.point.x * c.count + p.point.x) / k;
        c.point.y = (c.point.y * c.count + p.point.y) / k;
        c.point.z = (c.point.z * c.count + p.point.z) / k;
        c.count = k;
        merged = true;
        break;
      }
    }
    if (!merged) clusters.push({ point: { ...p.point }, wall: p.wall, count: 1 });
  }
  return clusters.sort((a, b) => b.count - a.count);
}

/** Pick a few representative listener positions. Prefers audience zones
 *  when they exist; otherwise samples across the audience area. */
function sampleListeners(room: RoomState, zones: Zone[]): Point3[] {
  const usable = zones.filter(z => z.shape && z.shape.length >= 3);
  if (usable.length > 0) {
    return usable.map(z => {
      const cx = z.shape.reduce((s, p) => s + p.x, 0) / z.shape.length;
      const cy = z.shape.reduce((s, p) => s + p.y, 0) / z.shape.length;
      const cz = (z.floorHeightFt ?? 0) + (z.earHeightFt ?? 4);
      return { x: cx, y: cy, z: cz };
    });
  }
  const stageDepth = room.stage?.depth ?? 8;
  const audY = (frac: number) => stageDepth + (room.depth - stageDepth) * frac;
  return [
    { x: room.width * 0.50, y: audY(0.30), z: 4 },
    { x: room.width * 0.30, y: audY(0.55), z: 4 },
    { x: room.width * 0.70, y: audY(0.55), z: 4 },
    { x: room.width * 0.50, y: audY(0.85), z: 4 },
  ];
}

// ===== Panel factories =====

let panelCounter = 0;
function newId(prefix: string): string {
  panelCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${panelCounter.toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}

function broadbandPanelAt(point: Point3, wall: Wall, size: 'standard' | 'large' = 'standard'): EquipmentItem {
  const isCeiling = wall === 'C';
  const large = size === 'large';
  // Standard: 2"×(2×4) wall panel / 4×4 cloud. Large (for big absorption
  // deficits): 4"×(4×8) wall panel / 6×8 cloud — ~4× the sabins per item,
  // so reverberant rooms reach target without blowing the panel budget.
  const panelW = isCeiling ? (large ? 8 : 4) : (large ? 8 : 4);
  const panelH = isCeiling ? (large ? 6 : 4) : (large ? 4 : 2);
  // Anchor on the wall plane — push the centroid slightly off the wall so
  // the rendered panel face hugs the wall instead of intersecting it.
  let x = point.x, y = point.y, z = point.z;
  if      (wall === 'L') x = 0.2;
  else if (wall === 'R') x = 0; // anchored at right wall
  else if (wall === 'F') y = 0.2;
  else if (wall === 'B') y = 0;
  else if (wall === 'C') z = 0; // ceiling height handled by render
  return {
    id: newId(`panel-${wall}`),
    templateId: isCeiling ? 'Primacoustic-cloud' : 'GIK-broadband',
    kind: 'acoustic-panel',
    category: 'acoustic',
    label: isCeiling
      ? (large ? 'Ceiling Cloud 6×8' : 'Ceiling Cloud')
      : (large ? '4"×(4×8) Broadband Panel' : '2"×(2×4) Broadband Panel'),
    brand: isCeiling ? 'Primacoustic' : 'GIK Acoustics',
    x, y, z,
    rotation: 0,
    panelW, panelH,
    wall,
    nrc: isCeiling ? 0.95 : (large ? 1.15 : 1.05),
    alpha: isCeiling ? PANEL_CLOUD_ALPHA : (large ? PANEL_4IN_ALPHA : PANEL_BROADBAND_ALPHA),
  };
}

function bassTrapAt(x: number, y: number, wall: 'L' | 'R' | 'B' | 'F'): EquipmentItem {
  return {
    id: newId(`trap-${wall}`),
    templateId: 'GIK-trap',
    kind: 'bass-trap',
    category: 'acoustic',
    label: 'Soffit Bass Trap',
    brand: 'GIK Acoustics',
    x, y, z: 0,
    rotation: 0,
    panelW: 4, panelH: 6,
    wall,
    nrc: 0.85,
    alpha: PANEL_BASSTRAP_ALPHA,
  };
}

// ===== Main planner =====

export function planTreatment(
  room: RoomState,
  zones: Zone[],
  speakers: EquipmentItem[],
  obstacles: EquipmentItem[],
  options: TreatmentOptions = {},
): TreatmentResult {
  const target = options.targetRT60 ?? defaultTargetRT60(room.roomType);
  const strategy: TreatmentStrategy = options.strategy ?? 'both';
  const maxPanels = options.maxPanels ?? 24;
  const addBassTraps = options.addBassTraps ?? true;

  const newPanels: EquipmentItem[] = [];

  // Existing acoustic items (so the planner accounts for whatever was
  // already manually placed and doesn't double up at the same spots).
  const existingAcoustic = obstacles.filter(e => e.category === 'acoustic');

  // ----- Stage 1: Reflection-point placement -----
  if ((strategy === 'reflections' || strategy === 'both') && speakers.length > 0) {
    const listeners = sampleListeners(room, zones);
    const allPoints: Array<{ point: Point3; wall: Wall }> = [];

    for (const sp of speakers) {
      // Skip muted speakers — they don't excite the room.
      if (sp.muted) continue;
      const S: Point3 = { x: sp.x, y: sp.y, z: sp.z };
      for (const L of listeners) {
        // Skip the front (stage) wall — speakers face away from it; treating
        // the stage wall isn't useful in this room model.
        for (const wall of ['L', 'R', 'B', 'C'] as const) {
          const p = reflectionPoint(S, L, wall, room);
          if (p) allPoints.push({ point: p, wall });
        }
      }
    }

    // Cluster within ~4 ft on each wall — points closer than that are
    // realistically the same reflection from a panel-coverage perspective.
    const clusters = clusterPoints(allPoints, 4);

    // Don't place where there's already a panel within 3 ft.
    const freeClusters = clusters.filter(c => {
      return !existingAcoustic.some(e => {
        if (e.wall !== c.wall) return false;
        return Math.hypot((e.x ?? 0) - c.point.x, (e.y ?? 0) - c.point.y, (e.z ?? 0) - c.point.z) < 3;
      });
    });

    // Cap the reflection panels — past ~10 you're past the diminishing
    // returns of the early-reflection zone.
    const reflectionCap = strategy === 'reflections' ? maxPanels : Math.min(10, maxPanels);
    for (const c of freeClusters.slice(0, reflectionCap)) {
      newPanels.push(broadbandPanelAt(c.point, c.wall));
    }
  }

  // ----- Stage 2: RT60 fitting -----
  // Compute current RT60 (with our reflection panels merged in) and add
  // ceiling clouds / sidewall panels until target is hit.
  const computeRT60 = () => {
    const allPanels = [...existingAcoustic, ...newPanels];
    return rt60(room, allPanels, zones, obstacles, /*useEyring*/ true);
  };

  // Bass-trap pass: when 125 Hz RT60 is high (typical for any untreated
  // box), corner traps make a disproportionately large dent. Only added if
  // the user opted in AND there's no trap already in the same corner.
  if ((strategy === 'rt60' || strategy === 'both') && addBassTraps) {
    const lowRT = computeRT60().byBand[125];
    if (lowRT > target * 1.4) {
      const candidates: Array<{ x: number; y: number; wall: 'L' | 'R' | 'B' | 'F' }> = [
        { x: 4,                 y: room.depth - 0.2, wall: 'B' },
        { x: room.width - 4,    y: room.depth - 0.2, wall: 'B' },
        { x: 4,                 y: 0.2,               wall: 'F' },
        { x: room.width - 4,    y: 0.2,               wall: 'F' },
      ];
      for (const c of candidates) {
        if (newPanels.length >= maxPanels) break;
        // Skip if a trap already exists nearby
        const taken = [...existingAcoustic, ...newPanels].some(e =>
          e.kind === 'bass-trap' &&
          Math.hypot((e.x ?? 0) - c.x, (e.y ?? 0) - c.y) < 4);
        if (taken) continue;
        newPanels.push(bassTrapAt(c.x, c.y, c.wall));
      }
    }
  }

  if (strategy === 'rt60' || strategy === 'both') {
    let safety = 0;
    let result = computeRT60();
    let avgMid = (result.byBand[500] + result.byBand[1000]) / 2;

    while (avgMid > target + 0.05 && newPanels.length < maxPanels && safety < 60) {
      safety += 1;

      // Size escalation: when the remaining RT60 gap is large, place LARGE
      // elements (6×8 clouds / 4"×(4×8) wall panels — ~4× the sabins each)
      // so reverberant rooms can actually reach target within the panel
      // budget. Inside ~0.35 s of target, drop back to standard sizes for
      // finer convergence.
      const size: 'standard' | 'large' = (avgMid - target) > 0.35 ? 'large' : 'standard';
      const cloudStepX = size === 'large' ? 0.28 : 0.25;
      const cloudStepY = size === 'large' ? 12 : 10;

      // Prefer ceiling clouds (large area, low visual impact). Stagger
      // their placement on a 3 × N grid in front of the audience.
      const stageEnd = room.stage?.depth ?? 8;
      const cloudsPlaced = newPanels.filter(p => p.wall === 'C').length;
      const col = cloudsPlaced % 3;
      const row = Math.floor(cloudsPlaced / 3);
      const cloudX = room.width * (0.22 + col * cloudStepX);
      const cloudY = stageEnd + 8 + row * cloudStepY;
      if (cloudY < room.depth - 4) {
        newPanels.push(broadbandPanelAt({ x: cloudX, y: cloudY, z: room.height - 1 }, 'C', size));
      } else {
        // Out of ceiling room; pivot to side walls
        const sideCount = newPanels.filter(p => p.wall === 'L' || p.wall === 'R').length;
        const wall: 'L' | 'R' = sideCount % 2 === 0 ? 'L' : 'R';
        const x = wall === 'L' ? 0.2 : room.width - 0.2;
        const y = stageEnd + 4 + Math.floor(sideCount / 2) * (size === 'large' ? 10 : 6);
        if (y < room.depth - 4) {
          newPanels.push(broadbandPanelAt({ x, y, z: 6 }, wall, size));
        } else {
          break; // physically out of room
        }
      }

      result = computeRT60();
      avgMid = (result.byBand[500] + result.byBand[1000]) / 2;
    }
  }

  // Final RT60
  const finalResult = computeRT60();
  const predictedRT60 = (finalResult.byBand[500] + finalResult.byBand[1000]) / 2;

  return {
    panels: newPanels,
    predictedRT60: +predictedRT60.toFixed(2),
    predictedByBand: { ...finalResult.byBand },
    reachedTarget: predictedRT60 <= target + 0.1,
  };
}

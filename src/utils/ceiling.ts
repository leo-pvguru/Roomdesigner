// Ceiling geometry — derives the ceiling surfaces (panels) and per-wall top
// profiles from a RoomState. This is the single source of truth used by both
// the viewport renderer and the acoustics engine, so a vaulted/hip/cross-gable
// roof is drawn and modeled the same way.

import type { RoomState, Point } from '../types';
import { bboxOf, polygonArea } from './geometry';

/** A single planar polygon — one slope of a roof. */
export interface CeilingFacet {
  vertices: [number, number, number][];
  floorProjection: Point[];
  areaFt2: number;
}

/**
 * A logical ceiling panel — one entry in the inspector materials list.
 * Most shapes produce 1 facet per panel; cross-gable produces 2.
 */
export interface CeilingPanel {
  segmentIndex: number;
  label: string;
  facets: CeilingFacet[];
  /** Sum of facet areas — convenience accessor. */
  areaFt2: number;
}

/** Effective ridge axis. Defaults to the longer side of the bbox when unset. */
export function effectiveRidgeAxis(room: RoomState): 'width' | 'depth' {
  if (room.ridgeAxis) return room.ridgeAxis;
  const bb = bboxOf(room.shape);
  return bb.width >= bb.depth ? 'width' : 'depth';
}

/** Position 0..1 of the ridge or high edge across the cross-axis. */
function effectivePeakOffset(room: RoomState): number {
  if (typeof room.peakOffset === 'number') {
    return Math.max(0, Math.min(1, room.peakOffset));
  }
  return room.ceilingShape === 'sloped' ? 1 : 0.5;
}

/**
 * Ceiling height at a world (x, y). Returns wall height for flat/coffered;
 * piecewise-linear for sloped, vaulted, hip, and cross-gable.
 */
export function ceilingHeightAt(room: RoomState, x: number, y: number): number {
  const h = room.height;
  const peak = room.peakHeight ?? h;
  if (room.ceilingShape === 'flat' || room.ceilingShape === 'coffered') return h;
  if (peak <= h) return h;

  const bb = bboxOf(room.shape);
  const u = (x - bb.minX) / Math.max(0.001, bb.width);
  const v = (y - bb.minY) / Math.max(0.001, bb.depth);
  const along = effectiveRidgeAxis(room);
  const offset = effectivePeakOffset(room);
  const crossT = along === 'width' ? v : u;

  switch (room.ceilingShape) {
    case 'sloped': {
      // Linear from low edge to high edge. peakOffset selects the high side:
      // 1 = high at crossT==1; 0 = high at crossT==0; 0.5 = flat.
      const dir = offset - 0.5;
      const f = 0.5 + dir * (crossT - 0.5) * 2;
      return h + (peak - h) * Math.max(0, Math.min(1, f));
    }
    case 'vaulted': {
      // Two slopes meeting at the ridge.
      const distToRidge = Math.abs(crossT - offset);
      const span = Math.max(offset, 1 - offset, 0.0001);
      const f = 1 - distToRidge / span;
      return h + (peak - h) * Math.max(0, Math.min(1, f));
    }
    case 'cross-gable': {
      // MAX of two centred perpendicular vaults — gable peaks at every wall midpoint.
      const fU = 1 - Math.abs(u - 0.5) / 0.5;
      const fV = 1 - Math.abs(v - 0.5) / 0.5;
      const f = Math.max(fU, fV);
      return h + (peak - h) * Math.max(0, Math.min(1, f));
    }
    case 'hip': {
      // True hip roof: ridge runs along the longer axis (or ridgeAxis if set),
      // hip ends inset by half the SHORTER dimension. Same pitch on every face.
      const W = bb.width, D = bb.depth;
      const half = Math.min(W, D) / 2;
      let dist: number;
      if (along === 'width' && W >= D) {
        const yPart = Math.abs(y - (bb.minY + D / 2));
        const xPart = Math.max(0, half - (x - bb.minX), (x - bb.minX) - (W - half));
        dist = Math.hypot(xPart, yPart);
      } else if (along === 'depth' && D >= W) {
        const xPart = Math.abs(x - (bb.minX + W / 2));
        const yPart = Math.max(0, half - (y - bb.minY), (y - bb.minY) - (D - half));
        dist = Math.hypot(xPart, yPart);
      } else {
        const xPart = Math.abs(x - (bb.minX + W / 2));
        const yPart = Math.abs(y - (bb.minY + D / 2));
        dist = Math.max(xPart, yPart);
      }
      const f = 1 - dist / Math.max(half, 0.001);
      return h + (peak - h) * Math.max(0, Math.min(1, f));
    }
    default:
      return h;
  }
}

function triArea3D(a: [number, number, number], b: [number, number, number], c: [number, number, number]): number {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return 0.5 * Math.hypot(cx, cy, cz);
}

function polyArea3D(poly: [number, number, number][]): number {
  if (poly.length < 3) return 0;
  let a = 0;
  for (let i = 1; i < poly.length - 1; i++) {
    a += triArea3D(poly[0], poly[i], poly[i + 1]);
  }
  return a;
}

function makeFacet(verts: [number, number, number][], floor: Point[]): CeilingFacet {
  return { vertices: verts, floorProjection: floor, areaFt2: polyArea3D(verts) };
}

/**
 * Decompose the ceiling into one or more flat polygonal panels.
 *
 * For irregular (non-rectangular) room shapes, panels still align to the
 * room's bounding-box axes. Most A-frame churches have rectangular footprints
 * so this is a reasonable simplification.
 */
export function ceilingPanels(room: RoomState): CeilingPanel[] {
  const bb = bboxOf(room.shape);
  const h = room.height;
  const peak = Math.max(h, room.peakHeight ?? h);
  const along = effectiveRidgeAxis(room);
  const offset = effectivePeakOffset(room);
  const minX = bb.minX, maxX = bb.maxX, minY = bb.minY, maxY = bb.maxY;
  const cx = minX + bb.width * 0.5;
  const cy = minY + bb.depth * 0.5;

  const single = (label: string, verts: [number, number, number][], floor: Point[]): CeilingPanel => {
    const facet = makeFacet(verts, floor);
    return { segmentIndex: 0, label, facets: [facet], areaFt2: facet.areaFt2 };
  };

  switch (room.ceilingShape) {
    case 'flat':
    case 'coffered': {
      const verts = room.shape.map(p => [p.x, p.y, h] as [number, number, number]);
      return [single('Ceiling', verts, [...room.shape])];
    }

    case 'sloped': {
      const verts = room.shape.map(p => [
        p.x, p.y, ceilingHeightAt(room, p.x, p.y),
      ] as [number, number, number]);
      return [single('Ceiling slope', verts, [...room.shape])];
    }

    case 'vaulted': {
      // Two slope panels meeting at the ridge.
      const heights = (poly: Point[]) =>
        poly.map(p => [p.x, p.y, ceilingHeightAt(room, p.x, p.y)] as [number, number, number]);
      if (along === 'width') {
        const ry = minY + offset * bb.depth;
        const ribA: Point[] = [
          { x: minX, y: minY }, { x: maxX, y: minY },
          { x: maxX, y: ry },   { x: minX, y: ry },
        ];
        const ribB: Point[] = [
          { x: minX, y: ry },   { x: maxX, y: ry },
          { x: maxX, y: maxY }, { x: minX, y: maxY },
        ];
        const fA = makeFacet(heights(ribA), ribA);
        const fB = makeFacet(heights(ribB), ribB);
        return [
          { segmentIndex: 0, label: 'Slope (front)', facets: [fA], areaFt2: fA.areaFt2 },
          { segmentIndex: 1, label: 'Slope (back)',  facets: [fB], areaFt2: fB.areaFt2 },
        ];
      } else {
        const rx = minX + offset * bb.width;
        const ribA: Point[] = [
          { x: minX, y: minY }, { x: rx, y: minY },
          { x: rx, y: maxY },   { x: minX, y: maxY },
        ];
        const ribB: Point[] = [
          { x: rx, y: minY },   { x: maxX, y: minY },
          { x: maxX, y: maxY }, { x: rx, y: maxY },
        ];
        const fA = makeFacet(heights(ribA), ribA);
        const fB = makeFacet(heights(ribB), ribB);
        return [
          { segmentIndex: 0, label: 'Slope (left)',  facets: [fA], areaFt2: fA.areaFt2 },
          { segmentIndex: 1, label: 'Slope (right)', facets: [fB], areaFt2: fB.areaFt2 },
        ];
      }
    }

    case 'hip': {
      // True rectangular hip — two trapezoidal "main" slopes plus two
      // triangular hip ends. For a square room or one where the ridge can't
      // physically fit, fall back to a 4-sided pyramid.
      const W = bb.width, D = bb.depth;
      const half = Math.min(W, D) / 2;
      const useRidgeAlongX = (along === 'width' && W > D) || (along !== 'depth' && W > D);
      if (!useRidgeAlongX && !(along === 'depth' && D > W)) {
        // Square (or degenerate) → 4-sided pyramid: 4 triangles meeting at apex.
        const apex: [number, number, number] = [cx, cy, peak];
        const corners: [number, number, number][] = [
          [minX, minY, h], [maxX, minY, h], [maxX, maxY, h], [minX, maxY, h],
        ];
        const cornersXY: Point[] = [
          { x: minX, y: minY }, { x: maxX, y: minY },
          { x: maxX, y: maxY }, { x: minX, y: maxY },
        ];
        const labels = ['Front slope', 'Right slope', 'Back slope', 'Left slope'];
        const apexXY: Point = { x: cx, y: cy };
        const out: CeilingPanel[] = [];
        for (let i = 0; i < 4; i++) {
          const verts: [number, number, number][] = [corners[i], corners[(i + 1) % 4], apex];
          const xy: Point[] = [cornersXY[i], cornersXY[(i + 1) % 4], apexXY];
          const facet = makeFacet(verts, xy);
          out.push({ segmentIndex: i, label: labels[i], facets: [facet], areaFt2: facet.areaFt2 });
        }
        return out;
      }
      // Rectangular hip with a ridge segment.
      if (useRidgeAlongX) {
        const ridgeStart: [number, number, number] = [minX + half, cy, peak];
        const ridgeEnd:   [number, number, number] = [maxX - half, cy, peak];
        // 4 panels: front trapezoid, back trapezoid, left hip end, right hip end.
        const front = makeFacet(
          [[minX, minY, h], [maxX, minY, h], ridgeEnd, ridgeStart],
          [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX - half, y: cy }, { x: minX + half, y: cy }],
        );
        const back = makeFacet(
          [[maxX, maxY, h], [minX, maxY, h], ridgeStart, ridgeEnd],
          [{ x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX + half, y: cy }, { x: maxX - half, y: cy }],
        );
        const left = makeFacet(
          [[minX, maxY, h], [minX, minY, h], ridgeStart],
          [{ x: minX, y: maxY }, { x: minX, y: minY }, { x: minX + half, y: cy }],
        );
        const right = makeFacet(
          [[maxX, minY, h], [maxX, maxY, h], ridgeEnd],
          [{ x: maxX, y: minY }, { x: maxX, y: maxY }, { x: maxX - half, y: cy }],
        );
        return [
          { segmentIndex: 0, label: 'Front slope', facets: [front], areaFt2: front.areaFt2 },
          { segmentIndex: 1, label: 'Right hip',   facets: [right], areaFt2: right.areaFt2 },
          { segmentIndex: 2, label: 'Back slope',  facets: [back],  areaFt2: back.areaFt2 },
          { segmentIndex: 3, label: 'Left hip',    facets: [left],  areaFt2: left.areaFt2 },
        ];
      } else {
        // Ridge along Y
        const ridgeStart: [number, number, number] = [cx, minY + half, peak];
        const ridgeEnd:   [number, number, number] = [cx, maxY - half, peak];
        const left = makeFacet(
          [[minX, maxY, h], [minX, minY, h], ridgeStart, ridgeEnd],
          [{ x: minX, y: maxY }, { x: minX, y: minY }, { x: cx, y: minY + half }, { x: cx, y: maxY - half }],
        );
        const right = makeFacet(
          [[maxX, minY, h], [maxX, maxY, h], ridgeEnd, ridgeStart],
          [{ x: maxX, y: minY }, { x: maxX, y: maxY }, { x: cx, y: maxY - half }, { x: cx, y: minY + half }],
        );
        const front = makeFacet(
          [[minX, minY, h], [maxX, minY, h], ridgeStart],
          [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: cx, y: minY + half }],
        );
        const back = makeFacet(
          [[maxX, maxY, h], [minX, maxY, h], ridgeEnd],
          [{ x: maxX, y: maxY }, { x: minX, y: maxY }, { x: cx, y: maxY - half }],
        );
        return [
          { segmentIndex: 0, label: 'Front hip',  facets: [front], areaFt2: front.areaFt2 },
          { segmentIndex: 1, label: 'Right slope',facets: [right], areaFt2: right.areaFt2 },
          { segmentIndex: 2, label: 'Back hip',   facets: [back],  areaFt2: back.areaFt2 },
          { segmentIndex: 3, label: 'Left slope', facets: [left],  areaFt2: left.areaFt2 },
        ];
      }
    }

    case 'cross-gable': {
      // 4 gable panels (front/right/back/left). Each is two triangles meeting
      // at the line that runs from the wall midpoint up to the apex.
      const apex: [number, number, number] = [cx, cy, peak];
      const apexXY: Point = { x: cx, y: cy };
      const cornFL: [number, number, number] = [minX, minY, h];
      const cornFR: [number, number, number] = [maxX, minY, h];
      const cornBR: [number, number, number] = [maxX, maxY, h];
      const cornBL: [number, number, number] = [minX, maxY, h];
      // Wall midpoints — these are at PEAK height (gable peaks above each wall).
      const midF: [number, number, number] = [cx, minY, peak];
      const midR: [number, number, number] = [maxX, cy, peak];
      const midB: [number, number, number] = [cx, maxY, peak];
      const midL: [number, number, number] = [minX, cy, peak];
      // Floor projections (XY only, ignoring z).
      const fL: Point = { x: minX, y: cy };
      const fF: Point = { x: cx, y: minY };
      const fR: Point = { x: maxX, y: cy };
      const fB: Point = { x: cx, y: maxY };
      const xyFL: Point = { x: minX, y: minY };
      const xyFR: Point = { x: maxX, y: minY };
      const xyBR: Point = { x: maxX, y: maxY };
      const xyBL: Point = { x: minX, y: maxY };

      // Each gable has TWO triangle facets, sharing the apex and the wall-mid-to-apex edge.
      const front: CeilingFacet[] = [
        makeFacet([cornFL, midF, apex], [xyFL, fF, apexXY]),
        makeFacet([midF, cornFR, apex], [fF, xyFR, apexXY]),
      ];
      const right: CeilingFacet[] = [
        makeFacet([cornFR, midR, apex], [xyFR, fR, apexXY]),
        makeFacet([midR, cornBR, apex], [fR, xyBR, apexXY]),
      ];
      const back: CeilingFacet[] = [
        makeFacet([cornBR, midB, apex], [xyBR, fB, apexXY]),
        makeFacet([midB, cornBL, apex], [fB, xyBL, apexXY]),
      ];
      const left: CeilingFacet[] = [
        makeFacet([cornBL, midL, apex], [xyBL, fL, apexXY]),
        makeFacet([midL, cornFL, apex], [fL, xyFL, apexXY]),
      ];
      const sumArea = (fs: CeilingFacet[]) => fs.reduce((s, f) => s + f.areaFt2, 0);
      return [
        { segmentIndex: 0, label: 'Front gable', facets: front, areaFt2: sumArea(front) },
        { segmentIndex: 1, label: 'Right gable', facets: right, areaFt2: sumArea(right) },
        { segmentIndex: 2, label: 'Back gable',  facets: back,  areaFt2: sumArea(back) },
        { segmentIndex: 3, label: 'Left gable',  facets: left,  areaFt2: sumArea(left) },
      ];
    }
  }
  // Unreachable, but the compiler needs an unconditional return.
  const verts = room.shape.map(p => [p.x, p.y, h] as [number, number, number]);
  return [single('Ceiling', verts, [...room.shape])];
}

/**
 * Top-edge profile for a wall segment — used for rendering the wall as a
 * polygon with a non-flat top. For flat ceilings, returns the two corners at
 * eave height. For sloped/vaulted/hip/cross-gable ceilings, samples along the
 * wall and returns the height at each sample.
 */
export function wallTopProfile(
  room: RoomState,
  wallStart: Point, wallEnd: Point,
): [number, number, number][] {
  const h = room.height;
  if (room.ceilingShape === 'flat' || room.ceilingShape === 'coffered') {
    return [
      [wallStart.x, wallStart.y, h],
      [wallEnd.x, wallEnd.y, h],
    ];
  }
  const SAMPLES = 24;
  const out: [number, number, number][] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const x = wallStart.x + (wallEnd.x - wallStart.x) * t;
    const y = wallStart.y + (wallEnd.y - wallStart.y) * t;
    const z = ceilingHeightAt(room, x, y);
    out.push([x, y, z]);
  }
  return out;
}

/** Highest z reached anywhere on the ceiling. */
export function ceilingMaxHeight(room: RoomState): number {
  const h = room.height;
  if (room.ceilingShape === 'flat' || room.ceilingShape === 'coffered') return h;
  return Math.max(h, room.peakHeight ?? h);
}

/**
 * Convert (peakHeight, run-distance) into a slope angle in degrees and back.
 * The "run" is half of the room's cross-axis dimension for a vault, or the
 * full cross-axis for a sloped ceiling.
 */
export function slopeAngleDeg(peakAboveEave: number, runFt: number): number {
  if (runFt <= 0) return 0;
  return Math.atan2(peakAboveEave, runFt) * 180 / Math.PI;
}
export function peakHeightFromAngle(eaveHeight: number, angleDeg: number, runFt: number): number {
  return eaveHeight + Math.tan(angleDeg * Math.PI / 180) * runFt;
}

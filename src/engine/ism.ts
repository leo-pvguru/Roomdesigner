// =====================================================================
// Image-Source Method (ISM) — recursive, multi-order
// ---------------------------------------------------------------------
// SPRINT 2 SCOPE
// • Higher-order images (default maxOrder = 2): each first-order image
//   spawns up to (N-1) second-order images by mirroring across every
//   surface OTHER than its immediate parent. The same recursion can
//   continue to 3+ orders by raising maxOrder.
// • Per-facet ceiling reflections via ceilingPanels(): a vault, hip,
//   or cross-gable roof is mirrored across each individual sloped
//   panel — the mirror geometry is correct for non-vertical normals.
// • Strict audibility unfolding: for an image of order n, we walk the
//   path back through the chain (listener → R_n → R_{n-1} → ... → R_1
//   → original speaker), validating that each reflection point R_k
//   lies inside the actual extent of surface S_k. Any out-of-extent
//   bend invalidates the path.
// • Per-band reflection loss accumulates additively across the chain.
//
// SPL CONTRIBUTION
// SPL of an image source at a listener uses the unfolded total path
// length for distance/air loss, and the synthetic image position for
// dispersion (the off-axis angle from the mirrored aim). Reflection
// loss is subtracted per-band before energy summation.
//
// COST GUARDRAILS
// At maxOrder=2 with N surfaces (4-6 walls + floor + ceiling facets),
// per-speaker image count is roughly N * (N-1) ≈ 30-60. Per-cell
// audibility is an O(order × surfaces) chain walk — each iteration is
// 1 segment-plane intersect + 1 in-extent test. The audibility check
// runs in the worker; main thread is unaffected.
// =====================================================================

import {
  OCTAVE_BANDS,
  type OctaveBand,
  type RoomState,
  type EquipmentItem,
  type Point,
  type WallObstacle,
} from '../types';
import { getMaterial, getScattering } from '../constants/materials';
import { pointInPolygon } from '../utils/geometry';
import { ceilingPanels, type CeilingFacet } from '../utils/ceiling';

export type Vec3 = { x: number; y: number; z: number };

const ZERO_LOSS: Record<OctaveBand, number> = {
  125: 0, 250: 0, 500: 0, 1000: 0, 2000: 0, 4000: 0,
};
/** Per-surface reflection-loss cap. Past 30 dB the surface is
 *  effectively absorbent — clamping keeps the energy sum well-conditioned. */
const PER_SURFACE_LOSS_CAP_DB = 30;

// ---------------------------------------------------------------------
// Surface abstraction
// ---------------------------------------------------------------------

export interface SurfacePlane {
  kind: 'wall' | 'floor' | 'ceiling';
  /** Index used to look up the surface material (wall = polygon edge index;
   *  floor = 0; ceiling = ceilingPanel.segmentIndex). */
  index: number;
  /** Optional sub-facet index — for cross-gable / hip ceilings each panel
   *  has multiple triangle facets. Each facet is its own SurfacePlane. */
  subIndex?: number;
  /** A point on the plane. */
  origin: Vec3;
  /** Unit normal. Convention: points INTO the room from this surface. */
  normal: Vec3;
  /** Per-band reflection loss in dB derived from the surface material. */
  reflectionLoss: Record<OctaveBand, number>;
  /** Per-band scattering (diffusion) coefficient s ∈ [0,1] from the surface
   *  material. The ray tracer uses it to split each bounce between specular
   *  and diffuse (Lambertian) reflection — the late-field structure that a
   *  purely specular model can't produce. */
  scattering: Record<OctaveBand, number>;
  /** True iff a 3D point on the plane lies within the actual surface extent
   *  (within the wall edge length + height range, or within the ceiling /
   *  floor polygon). */
  pointInExtent: (p: Vec3) => boolean;
  /** Distance in feet from a 3D point ON THE PLANE to the nearest surface
   *  boundary (edge). Returns Infinity if the point is outside the surface
   *  extent. Used by the ISM's edge-softening attenuation: reflection
   *  bounces near a surface edge fuzz from clean specular toward edge
   *  diffraction, costing some energy. The softening ramps in over λ/2,
   *  so it's frequency-dependent at the heatmap level. */
  distanceToEdgeFt: (p: Vec3) => number;
  /** Total surface area in m² — used by Eyring RT60. */
  areaM2: number;
}

// Resolve material id for a particular surface (with sensible defaults).
function surfaceMaterialId(
  room: RoomState,
  kind: 'wall' | 'floor' | 'ceiling',
  segIdx = 0,
): string {
  const s = room.surfaces.find(x => x.kind === kind && x.segmentIndex === segIdx);
  if (s) return s.materialId;
  if (kind === 'floor') return 'carpet-thick';
  return 'drywall';
}

function lossFromAlpha(alpha: Record<OctaveBand, number>): Record<OctaveBand, number> {
  const out: Partial<Record<OctaveBand, number>> = {};
  for (const b of OCTAVE_BANDS) {
    const a = Math.max(0.001, Math.min(0.999, alpha[b] ?? 0.1));
    out[b] = Math.min(PER_SURFACE_LOSS_CAP_DB, -10 * Math.log10(1 - a));
  }
  return out as Record<OctaveBand, number>;
}

function reflectionLossByBand(materialId: string): Record<OctaveBand, number> {
  return lossFromAlpha(getMaterial(materialId).alpha);
}

// ---------------------------------------------------------------------
// Build the room's surfaces (walls, floor, ceiling facets)
// ---------------------------------------------------------------------

/** Triangle area helper (3D). */
function triArea3(a: Vec3, b: Vec3, c: Vec3): number {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return 0.5 * Math.hypot(cx, cy, cz);
}

/**
 * Compute the inward-facing normal for a triangular ceiling facet given
 * its 3D vertices. We orient it so that the room's interior (z below
 * the apex) lies on the side the normal points toward — i.e., the normal
 * has a NEGATIVE z component.
 */
function ceilingFacetPlane(facet: CeilingFacet): { origin: Vec3; normal: Vec3; areaM2: number } {
  const v0: Vec3 = { x: facet.vertices[0][0], y: facet.vertices[0][1], z: facet.vertices[0][2] };
  const v1: Vec3 = { x: facet.vertices[1][0], y: facet.vertices[1][1], z: facet.vertices[1][2] };
  const v2: Vec3 = { x: facet.vertices[2][0], y: facet.vertices[2][1], z: facet.vertices[2][2] };
  const ax = v1.x - v0.x, ay = v1.y - v0.y, az = v1.z - v0.z;
  const bx = v2.x - v0.x, by = v2.y - v0.y, bz = v2.z - v0.z;
  // Cross product
  let nx = ay * bz - az * by;
  let ny = az * bx - ax * bz;
  let nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  // Orient inward: ceiling normal should point DOWN into the room (nz < 0).
  if (nz > 0) { nx = -nx; ny = -ny; nz = -nz; }
  return {
    origin: v0,
    normal: { x: nx, y: ny, z: nz },
    areaM2: facet.areaFt2 * 0.092903,
  };
}

/**
 * Test whether a 3D point on the facet's plane lies within its polygonal
 * extent. We use the floor projection (which corresponds 1-to-1 with the
 * 3D facet by dropping z, since the facet is planar).
 */
function pointInFacet(p: Vec3, facet: CeilingFacet): boolean {
  return pointInPolygon({ x: p.x, y: p.y }, facet.floorProjection);
}

/** 2D distance from point to segment AB. */
function pointToSegmentDist2D(
  p: { x: number; y: number },
  a: Point,
  b: Point,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Distance from a 2D point to the nearest edge of a polygon (assumed inside). */
function distToPolygonEdge2D(
  p: { x: number; y: number },
  poly: Point[],
): number {
  let minD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const d = pointToSegmentDist2D(p, a, b);
    if (d < minD) minD = d;
  }
  return minD;
}

export interface BuildSurfacesOptions {
  /** Override the floor's per-band absorption coefficient α. Used to blend
   *  in audience seating material when occupants cover part of the floor —
   *  a hardwood floor under a packed pew is acoustically much more absorbent
   *  for low/mid frequencies than the bare floor material would suggest. */
  floorAlphaOverride?: Record<OctaveBand, number>;
}

/**
 * Build all room surfaces (walls, floor, ceiling facets).
 *
 * Walls:    one SurfacePlane per polygon edge (vertical, height = room.height).
 * Floor:    one SurfacePlane (horizontal at z=0, extent = room polygon).
 * Ceiling:  one SurfacePlane PER FACET — a vault has 2 facets, hip has 4,
 *           cross-gable has 8 (each gable is 2 triangles).
 */
export function buildRoomSurfaces(room: RoomState, opts: BuildSurfacesOptions = {}): SurfacePlane[] {
  const out: SurfacePlane[] = [];
  const wallH = room.height;

  // ===== Walls =====
  const segs = room.shape;
  const n = segs.length;
  for (let i = 0; i < n; i++) {
    const a: Point = segs[i];
    const b: Point = segs[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const segLen = Math.hypot(ex, ey);
    if (segLen < 1e-3) continue;
    // Inward 2D normal for CCW polygon: (-ey, ex) / |edge|
    const nx = -ey / segLen;
    const ny = ex / segLen;

    const wallMatId = surfaceMaterialId(room, 'wall', i);
    const wallReflLoss = reflectionLossByBand(wallMatId);
    const wallAreaM2 = (segLen * wallH) * 0.092903;

    out.push({
      kind: 'wall',
      index: i,
      origin: { x: a.x, y: a.y, z: 0 },
      normal: { x: nx, y: ny, z: 0 },
      reflectionLoss: wallReflLoss,
      scattering: getScattering(wallMatId),
      areaM2: wallAreaM2,
      pointInExtent: (p: Vec3): boolean => {
        // Project onto edge; require u ∈ [0,1] and z ∈ [0, wallH].
        const u = ((p.x - a.x) * ex + (p.y - a.y) * ey) / (segLen * segLen);
        if (u < -1e-3 || u > 1 + 1e-3) return false;
        if (p.z < -1e-3 || p.z > wallH + 1e-3) return false;
        return true;
      },
      distanceToEdgeFt: (p: Vec3): number => {
        const u = ((p.x - a.x) * ex + (p.y - a.y) * ey) / (segLen * segLen);
        if (u < 0 || u > 1) return Infinity;
        if (p.z < 0 || p.z > wallH) return Infinity;
        // Distance to each of the wall's 4 edges (sides + top + bottom).
        const distFromStart = u * segLen;
        const distFromEnd = (1 - u) * segLen;
        const distBottom = p.z;
        const distTop = wallH - p.z;
        return Math.min(distFromStart, distFromEnd, distBottom, distTop);
      },
    });
  }

  // ===== Floor =====
  const floorMatId = surfaceMaterialId(room, 'floor', 0);
  const floorRefl = opts.floorAlphaOverride
    ? lossFromAlpha(opts.floorAlphaOverride)
    : reflectionLossByBand(floorMatId);
  let floorAreaFt2 = 0;
  for (let i = 0; i < segs.length - 2; i++) {
    floorAreaFt2 += triArea3(
      { x: segs[0].x, y: segs[0].y, z: 0 },
      { x: segs[i + 1].x, y: segs[i + 1].y, z: 0 },
      { x: segs[i + 2].x, y: segs[i + 2].y, z: 0 },
    );
  }
  out.push({
    kind: 'floor',
    index: 0,
    origin: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
    reflectionLoss: floorRefl,
    scattering: getScattering(floorMatId),
    areaM2: floorAreaFt2 * 0.092903,
    pointInExtent: (p: Vec3): boolean => {
      if (Math.abs(p.z) > 0.05) return false;
      return pointInPolygon({ x: p.x, y: p.y }, segs);
    },
    distanceToEdgeFt: (p: Vec3): number => {
      if (Math.abs(p.z) > 0.05) return Infinity;
      if (!pointInPolygon({ x: p.x, y: p.y }, segs)) return Infinity;
      return distToPolygonEdge2D({ x: p.x, y: p.y }, segs);
    },
  });

  // ===== Interior wall obstacles (Sprint C12) =====
  // Each WallObstacle becomes TWO SurfacePlanes — one per face — so an
  // image source can mirror across whichever side faces the room space the
  // listener occupies. Both faces share the same material (typical for
  // balcony fronts, riser fronts, half-walls).
  const wallObstacles = room.wallObstacles ?? [];
  for (const w of wallObstacles) {
    const ax = w.start.x, ay = w.start.y;
    const bx = w.end.x,   by = w.end.y;
    const ex = bx - ax, ey = by - ay;
    const segLen = Math.hypot(ex, ey);
    if (segLen < 1e-3) continue;
    if (w.topZ <= w.bottomZ) continue;
    const reflLoss = reflectionLossByBand(w.materialId);
    const obstScatter = getScattering(w.materialId);
    const heightFt = w.topZ - w.bottomZ;
    const obstAreaM2 = (segLen * heightFt) * 0.092903;

    // Two unit normals along the perpendicular (rotated +90° and -90°).
    // Both faces are valid reflectors; an image source picks the side
    // facing the listener via the standard plane-side test in audiblePath.
    const sideNormals: Array<{ nx: number; ny: number }> = [
      { nx:  ey / segLen, ny: -ex / segLen },   // right of segment direction
      { nx: -ey / segLen, ny:  ex / segLen },   // left
    ];
    for (let s = 0; s < 2; s++) {
      const { nx, ny } = sideNormals[s];
      out.push({
        kind: 'wall',
        index: -1,                            // sentinel — not a polygon edge
        subIndex: s,                          // 0 = right face, 1 = left face
        origin: { x: ax, y: ay, z: w.bottomZ },
        normal: { x: nx, y: ny, z: 0 },
        reflectionLoss: reflLoss,
        scattering: obstScatter,
        areaM2: obstAreaM2,
        pointInExtent: (p: Vec3): boolean => {
          const u = ((p.x - ax) * ex + (p.y - ay) * ey) / (segLen * segLen);
          if (u < -1e-3 || u > 1 + 1e-3) return false;
          if (p.z < w.bottomZ - 1e-3 || p.z > w.topZ + 1e-3) return false;
          return true;
        },
        distanceToEdgeFt: (p: Vec3): number => {
          const u = ((p.x - ax) * ex + (p.y - ay) * ey) / (segLen * segLen);
          if (u < 0 || u > 1) return Infinity;
          if (p.z < w.bottomZ || p.z > w.topZ) return Infinity;
          const dStart = u * segLen;
          const dEnd = (1 - u) * segLen;
          const dBot = p.z - w.bottomZ;
          const dTop = w.topZ - p.z;
          return Math.min(dStart, dEnd, dBot, dTop);
        },
      });
    }
  }

  // ===== Ceiling — one SurfacePlane per facet =====
  const panels = ceilingPanels(room);
  for (const panel of panels) {
    const ceilMatId = surfaceMaterialId(room, 'ceiling', panel.segmentIndex);
    const ceilingReflLoss = reflectionLossByBand(ceilMatId);
    const ceilingScatter = getScattering(ceilMatId);
    for (let f = 0; f < panel.facets.length; f++) {
      const facet = panel.facets[f];
      if (facet.vertices.length < 3) continue;
      const { origin, normal, areaM2 } = ceilingFacetPlane(facet);
      out.push({
        kind: 'ceiling',
        index: panel.segmentIndex,
        subIndex: f,
        origin,
        normal,
        reflectionLoss: ceilingReflLoss,
        scattering: ceilingScatter,
        areaM2,
        pointInExtent: (p: Vec3): boolean => pointInFacet(p, facet),
        distanceToEdgeFt: (p: Vec3): number => {
          if (!pointInFacet(p, facet)) return Infinity;
          return distToPolygonEdge2D({ x: p.x, y: p.y }, facet.floorProjection);
        },
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------
// Image source generation (recursive, BFS by order)
// ---------------------------------------------------------------------

export interface ImageSource {
  /** The image's mirrored speaker position (= positions[order]). */
  position: Vec3;
  /** Mirrored aim. */
  aim: { yaw: number; tilt: number };
  /** Surfaces in bounce order: chain[0] = first bounce off original speaker,
   *  chain[order-1] = last bounce before the listener. */
  chain: SurfacePlane[];
  /** All speaker positions across the chain.
   *  positions[0] = original speaker.
   *  positions[k] = speaker mirrored across chain[0..k-1].
   *  positions[order] = this image's position. */
  positions: Vec3[];
  /** Sum of per-band reflection losses across all surfaces in the chain. */
  reflectionLossDb: Record<OctaveBand, number>;
  /** Bounce count. 0 = direct (no chain). */
  order: number;
}

function mirrorPoint(p: Vec3, plane: SurfacePlane): Vec3 {
  const d = (p.x - plane.origin.x) * plane.normal.x
          + (p.y - plane.origin.y) * plane.normal.y
          + (p.z - plane.origin.z) * plane.normal.z;
  return {
    x: p.x - 2 * d * plane.normal.x,
    y: p.y - 2 * d * plane.normal.y,
    z: p.z - 2 * d * plane.normal.z,
  };
}

function mirrorAim(yawDeg: number, tiltDeg: number, n: Vec3): { yaw: number; tilt: number } {
  const yawR = (yawDeg * Math.PI) / 180;
  const tiltR = (tiltDeg * Math.PI) / 180;
  const ax = Math.cos(yawR) * Math.cos(tiltR);
  const ay = Math.sin(yawR) * Math.cos(tiltR);
  const az = Math.sin(tiltR);
  const dot = ax * n.x + ay * n.y + az * n.z;
  const rx = ax - 2 * dot * n.x;
  const ry = ay - 2 * dot * n.y;
  const rz = az - 2 * dot * n.z;
  const newTilt = (Math.asin(Math.max(-1, Math.min(1, rz))) * 180) / Math.PI;
  const newYaw = (Math.atan2(ry, rx) * 180) / Math.PI;
  return { yaw: newYaw, tilt: newTilt };
}

/**
 * Generate ImageSource entries for one speaker, from order 0 (the direct
 * source) up to maxOrder. We never mirror a parent across the SAME surface
 * it just bounced off (that would just give back the parent — wasted work).
 *
 * Returns ALL orders interleaved — a single flat array. Order 0 is at index
 * 0; higher orders follow in BFS order.
 */
export function generateImageSources(
  speaker: EquipmentItem,
  surfaces: SurfacePlane[],
  maxOrder: number,
): ImageSource[] {
  if (speaker.kind === 'speaker-iem') return [];

  const speakerPos: Vec3 = { x: speaker.x, y: speaker.y, z: speaker.z };
  const direct: ImageSource = {
    position: speakerPos,
    aim: { yaw: speaker.aim ?? 90, tilt: speaker.tilt ?? 0 },
    chain: [],
    positions: [speakerPos],
    reflectionLossDb: { ...ZERO_LOSS },
    order: 0,
  };
  const all: ImageSource[] = [direct];
  if (maxOrder < 1) return all;

  let prev: ImageSource[] = [direct];
  for (let order = 1; order <= maxOrder; order++) {
    const next: ImageSource[] = [];
    for (const parent of prev) {
      const lastSurface = parent.chain.length > 0
        ? parent.chain[parent.chain.length - 1]
        : null;
      for (const s of surfaces) {
        if (s === lastSurface) continue; // skip mirroring back across same plane
        const newPos = mirrorPoint(parent.position, s);
        const newAim = mirrorAim(parent.aim.yaw, parent.aim.tilt, s.normal);
        const lossSum: Record<OctaveBand, number> = { ...parent.reflectionLossDb };
        for (const b of OCTAVE_BANDS) lossSum[b] = parent.reflectionLossDb[b] + s.reflectionLoss[b];
        const child: ImageSource = {
          position: newPos,
          aim: newAim,
          chain: [...parent.chain, s],
          positions: [...parent.positions, newPos],
          reflectionLossDb: lossSum,
          order,
        };
        next.push(child);
        all.push(child);
      }
    }
    prev = next;
    if (prev.length === 0) break;
  }
  return all;
}

// ---------------------------------------------------------------------
// Audibility check — unfolds the bent path and validates each bounce
// ---------------------------------------------------------------------

/** Find the intersection of segment a → b with a plane, or null if it
 *  misses or lies at the segment endpoints. */
function intersectSegmentPlane(a: Vec3, b: Vec3, plane: SurfacePlane): Vec3 | null {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const denom = dx * plane.normal.x + dy * plane.normal.y + dz * plane.normal.z;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((plane.origin.x - a.x) * plane.normal.x
           + (plane.origin.y - a.y) * plane.normal.y
           + (plane.origin.z - a.z) * plane.normal.z) / denom;
  if (t <= 1e-4 || t >= 1 - 1e-4) return null;
  return { x: a.x + t * dx, y: a.y + t * dy, z: a.z + t * dz };
}

export interface AudibleResult {
  /** Total bent-path length in feet — sum of all leg lengths. */
  totalDistFt: number;
  /** First reflection point (R_n, the bounce nearest the listener).
   *  We expose this so dispersion math can use the actual first-leg
   *  geometry from the listener instead of the listener-to-image straight
   *  line. */
  firstBounce: Vec3 | null;
  /** Last reflection point (R_1, the bounce nearest the original
   *  speaker). Used by the dispersion model: the first leg LEAVING the
   *  speaker heads toward R_1. */
  lastBounce: Vec3 | null;
  /** Full ordered point list along the bent path: speaker → R_1 → R_2 →
   *  ... → R_n → listener. For order 0 (direct), this is just
   *  [speaker, listener]. Per-leg obstacle blocking iterates pairs. */
  points: Vec3[];
}

/**
 * Validate the bent path for an image source given a specific listener
 * position, and return the unfolded total path length plus the first/last
 * reflection points if audible. Returns null if any reflection point falls
 * outside its surface's extent.
 */
export function audiblePath(image: ImageSource, listener: Vec3): AudibleResult | null {
  const n = image.chain.length;
  if (n === 0) {
    const dx = listener.x - image.positions[0].x;
    const dy = listener.y - image.positions[0].y;
    const dz = listener.z - image.positions[0].z;
    return {
      totalDistFt: Math.sqrt(dx * dx + dy * dy + dz * dz),
      firstBounce: null,
      lastBounce: null,
      points: [image.positions[0], listener],
    };
  }
  // We collect bounce points listener-side first, then reverse so the final
  // ordered list runs speaker → R_1 → ... → R_n → listener.
  let pos = listener;
  let total = 0;
  const bouncesListenerFirst: Vec3[] = [];
  for (let k = n; k >= 1; k--) {
    const surface = image.chain[k - 1];
    const target = image.positions[k];
    const R = intersectSegmentPlane(pos, target, surface);
    if (!R) return null;
    if (!surface.pointInExtent(R)) return null;
    bouncesListenerFirst.push(R);
    total += Math.hypot(pos.x - R.x, pos.y - R.y, pos.z - R.z);
    pos = R;
  }
  // Final leg: last bounce → original speaker
  const speaker = image.positions[0];
  const lastBounce = bouncesListenerFirst[bouncesListenerFirst.length - 1];
  const firstBounce = bouncesListenerFirst[0];
  total += Math.hypot(
    lastBounce.x - speaker.x,
    lastBounce.y - speaker.y,
    lastBounce.z - speaker.z,
  );
  // points runs speaker → R_1 → ... → R_n → listener (speaker-to-listener order).
  const points: Vec3[] = [speaker];
  for (let i = bouncesListenerFirst.length - 1; i >= 0; i--) points.push(bouncesListenerFirst[i]);
  points.push(listener);
  return { totalDistFt: total, firstBounce, lastBounce, points };
}

// ---------------------------------------------------------------------
// Helpers (re-exported)
// ---------------------------------------------------------------------

/**
 * Edge-softening attenuation in dB for an ISM reflection point near a
 * surface boundary. Real surfaces are finite — a specular reflection that
 * bounces near an edge fuzzes from clean specular toward edge diffraction
 * over a transition zone of width ~λ/2. We model that with a smooth
 * quadratic ramp from 0 dB (at distFt ≥ λ/2) to 6 dB (at the edge).
 *
 * Frequency-dependent: at LF the wavelength is large so softening ramps
 * over a wider distance; at HF it's tightly localized to right at the edge.
 *
 * @param distFt   distance from the bounce point to the nearest surface edge
 * @param lambdaM  wavelength in meters at the band of interest
 */
export function edgeSofteningLossDb(distFt: number, lambdaM: number): number {
  const distM = distFt * 0.3048;
  const halfLambda = lambdaM / 2;
  if (!isFinite(distM) || distM >= halfLambda) return 0;
  const t = 1 - distM / halfLambda;   // 0 at the boundary of the soft zone, 1 at the edge
  return 6 * t * t;                    // smooth quadratic, max 6 dB
}

export function bandKeyForFreq(freq: '125' | '1k' | '4k' | 'broadband'): OctaveBand {
  if (freq === '125') return 125;
  if (freq === '4k') return 4000;
  return 1000;
}

/**
 * Synthesize an EquipmentItem-shaped object that represents the image
 * source's apparent listener-facing geometry. We use this when feeding
 * the image into the existing speakerSPL() helper so its dispersion +
 * frequency-response math runs unchanged.
 *
 * The "apparent" speaker faces from the lastBounce point if known
 * (the path leaves the original speaker pointing at lastBounce, then
 * unfolds — so when the image source "looks at" the listener through
 * the mirrored aim, the geometry is correct).
 */
export function imageAsEquipmentItem(
  base: EquipmentItem,
  image: ImageSource,
): EquipmentItem {
  return {
    ...base,
    id: `${base.id}__img__o${image.order}__${image.chain.map(s => `${s.kind[0]}${s.index}${s.subIndex ?? ''}`).join('-')}`,
    x: image.position.x,
    y: image.position.y,
    z: image.position.z,
    aim: image.aim.yaw,
    tilt: image.aim.tilt,
  };
}

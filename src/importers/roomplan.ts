// =====================================================================
// Apple RoomPlan scan importer
// ---------------------------------------------------------------------
// Parses the JSON export of a RoomPlan `CapturedRoom` (iPhone/iPad LiDAR
// scan — produced by Apple's RoomPlan sample app and most third-party
// scanner apps that wrap the API) and converts it into this app's room
// model: a floor polygon in feet, wall height, and any recognized
// furniture (chairs / tables) as placeable items.
//
// Format notes (Swift Codable encoding of CapturedRoom):
//   • All coordinates are METERS in a y-up world; the floor is the xz
//     plane. We map scan (x, z) → app (x, y) and convert to feet.
//   • `transform` is a 4×4 column-major matrix, encoded either as a flat
//     [16] array or as nested [[4],[4],[4],[4]] columns — both occur in
//     the wild, so we accept both. Translation = elements 12..14; the
//     surface's local +x axis (its run direction) = elements 0..2.
//   • `dimensions` is a simd_float3 → [width, height, thickness].
//   • `category` is an enum encoded as a single-key object, e.g.
//     { "wall": {} } or { "table": {} }.
//   • RoomPlan v2 adds `floors` with `polygonCorners` — when present this
//     is the authoritative floor outline and we use it directly. Otherwise
//     we reconstruct the polygon by chaining wall segments end-to-end;
//     if the chain doesn't close (messy scans), we fall back to the
//     bounding box of all wall endpoints.
// =====================================================================

import type { Point } from '../types';

const M_TO_FT = 3.280839895;
/** Endpoint-merge tolerance when chaining wall segments (meters). Scans
 *  routinely leave 5–30 cm gaps at corners. */
const CHAIN_TOL_M = 0.35;

export interface ScannedFurniture {
  kind: 'chair-padded' | 'table';
  xFt: number;
  yFt: number;
  rotationDeg: number;
  widthFt: number;
  depthFt: number;
}

export interface ScanImportResult {
  /** Floor polygon in feet, normalized so the bbox min corner is (0,0), CCW. */
  shape: Point[];
  widthFt: number;
  depthFt: number;
  heightFt: number;
  furniture: ScannedFurniture[];
  /** Wall segment indices (into `shape` edges) that contain detected
   *  windows — the importer assigns glass material to these walls. */
  glassWallSegments: number[];
  /** Provenance + what was found, for the user-facing summary. */
  counts: { walls: number; doors: number; windows: number; openings: number; objectsImported: number; objectsSkipped: number };
  usedFloorPolygon: boolean;
}

type Mat16 = number[];

function isObj(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Accept flat [16] or nested [[4]×4] column-major transforms. */
function asMat16(t: unknown): Mat16 | null {
  if (Array.isArray(t)) {
    if (t.length === 16 && t.every(n => typeof n === 'number')) return t as number[];
    if (t.length === 4 && t.every(c => Array.isArray(c) && c.length === 4)) {
      return (t as number[][]).flat();
    }
  }
  return null;
}

function asVec3(d: unknown): [number, number, number] | null {
  if (Array.isArray(d) && d.length >= 3 && d.slice(0, 3).every(n => typeof n === 'number')) {
    return [d[0], d[1], d[2]];
  }
  // Some encoders emit {x, y, z}
  if (isObj(d) && typeof d.x === 'number' && typeof d.y === 'number' && typeof d.z === 'number') {
    return [d.x, d.y, d.z];
  }
  return null;
}

/** The single key of a category object ({"wall": {}} → "wall"). */
function categoryKey(c: unknown): string | null {
  if (typeof c === 'string') return c.toLowerCase();
  if (isObj(c)) {
    const keys = Object.keys(c);
    if (keys.length >= 1) return keys[0].toLowerCase();
  }
  return null;
}

interface WallSeg { a: [number, number]; b: [number, number]; heightM: number }

/** Extract a wall's endpoints on the floor plane (scan xz, meters). */
function wallSegment(surf: Record<string, any>): WallSeg | null {
  const m = asMat16(surf.transform);
  const dim = asVec3(surf.dimensions);
  if (!m || !dim) return null;
  const len = dim[0];
  if (!(len > 0.05)) return null;
  const cx = m[12], cz = m[14];
  // Local +x axis in world — the direction the wall runs.
  let dx = m[0], dz = m[2];
  const dl = Math.hypot(dx, dz);
  if (dl < 1e-6) return null;
  dx /= dl; dz /= dl;
  const hx = (len / 2) * dx, hz = (len / 2) * dz;
  return { a: [cx - hx, cz - hz], b: [cx + hx, cz + hz], heightM: dim[1] > 0 ? dim[1] : 0 };
}

/** Chain wall segments into a closed loop by greedily connecting nearest
 *  endpoints. Returns the corner list (meters) or null if the chain breaks. */
function chainWalls(segs: WallSeg[]): [number, number][] | null {
  if (segs.length < 3) return null;
  const remaining = segs.slice(1);
  const pts: [number, number][] = [segs[0].a, segs[0].b];
  let guard = 0;
  while (remaining.length > 0 && guard++ < 200) {
    const cur = pts[pts.length - 1];
    let bestI = -1, bestD = Infinity, bestFlip = false;
    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i];
      const dA = Math.hypot(s.a[0] - cur[0], s.a[1] - cur[1]);
      const dB = Math.hypot(s.b[0] - cur[0], s.b[1] - cur[1]);
      if (dA < bestD) { bestD = dA; bestI = i; bestFlip = false; }
      if (dB < bestD) { bestD = dB; bestI = i; bestFlip = true; }
    }
    if (bestI < 0 || bestD > CHAIN_TOL_M) return null;   // chain broken
    const s = remaining.splice(bestI, 1)[0];
    pts.push(bestFlip ? s.a : s.b);
  }
  // Closed if the last point returns near the first — drop the duplicate.
  const first = pts[0], last = pts[pts.length - 1];
  if (Math.hypot(last[0] - first[0], last[1] - first[1]) <= CHAIN_TOL_M * 2) {
    pts.pop();
    return pts.length >= 3 ? pts : null;
  }
  return null;
}

/** Signed (shoelace) area — positive matches the app's winding convention. */
function signedArea(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

/**
 * Parse a RoomPlan JSON export. Throws an Error with a user-friendly
 * message when the file isn't a usable scan.
 */
export function parseRoomPlanJSON(raw: unknown): ScanImportResult {
  if (!isObj(raw)) throw new Error('Not a RoomPlan export — expected a JSON object.');

  const walls = (Array.isArray(raw.walls) ? raw.walls : []).filter(isObj);
  const doors = Array.isArray(raw.doors) ? raw.doors.length : 0;
  const windowSurfs = (Array.isArray(raw.windows) ? raw.windows : []).filter(isObj);
  const windows = windowSurfs.length;
  const openings = Array.isArray(raw.openings) ? raw.openings.length : 0;
  const objects = (Array.isArray(raw.objects) ? raw.objects : []).filter(isObj);
  const floors = (Array.isArray(raw.floors) ? raw.floors : []).filter(isObj);

  // ----- Floor polygon -----
  let cornersM: [number, number][] | null = null;
  let usedFloorPolygon = false;

  // v2 fast path: floors[].polygonCorners — authoritative outline.
  for (const f of floors) {
    const pc = f.polygonCorners;
    if (Array.isArray(pc) && pc.length >= 3) {
      const pts: [number, number][] = [];
      for (const c of pc) {
        const v = asVec3(c);
        if (v) pts.push([v[0], v[2]]);          // xz plane
      }
      if (pts.length >= 3) { cornersM = pts; usedFloorPolygon = true; break; }
    }
  }

  // Fallback: chain the wall segments.
  const segs = walls.map(wallSegment).filter((s): s is WallSeg => s !== null);
  if (!cornersM) cornersM = chainWalls(segs);

  // Last resort: bounding box of all wall endpoints.
  if (!cornersM) {
    if (segs.length === 0) {
      throw new Error('No usable walls or floor outline found in this scan.');
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of segs) {
      for (const p of [s.a, s.b]) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minZ) minZ = p[1];
        if (p[1] > maxZ) maxZ = p[1];
      }
    }
    cornersM = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]];
  }

  // ----- Convert to feet, normalize to (0,0), enforce app winding -----
  let shape: Point[] = cornersM.map(([x, z]) => ({ x: x * M_TO_FT, y: z * M_TO_FT }));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of shape) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  shape = shape.map(p => ({ x: +(p.x - minX).toFixed(2), y: +(p.y - minY).toFixed(2) }));
  if (signedArea(shape) < 0) shape.reverse();

  const widthFt = +(maxX - minX).toFixed(1);
  const depthFt = +(maxY - minY).toFixed(1);
  if (widthFt < 3 || depthFt < 3) {
    throw new Error('Scanned room is too small to import (under 3 ft across).');
  }

  // ----- Height: median wall height -----
  const heights = segs.map(s => s.heightM).filter(h => h > 0.5).sort((a, b) => a - b);
  const heightFt = heights.length
    ? +(heights[Math.floor(heights.length / 2)] * M_TO_FT).toFixed(1)
    : 10;

  // ----- Recognized objects → furniture -----
  const furniture: ScannedFurniture[] = [];
  let skipped = 0;
  for (const o of objects) {
    const cat = categoryKey(o.category);
    const m = asMat16(o.transform);
    const dim = asVec3(o.dimensions);
    if (!cat || !m || !dim) { skipped++; continue; }
    const kind = cat === 'chair' || cat === 'stool' ? 'chair-padded'
      : cat === 'table' ? 'table'
      : null;
    if (!kind) { skipped++; continue; }
    let dx = m[0], dz = m[2];
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    furniture.push({
      kind,
      xFt: +((m[12] * M_TO_FT) - minX).toFixed(2),
      yFt: +((m[14] * M_TO_FT) - minY).toFixed(2),
      rotationDeg: +(Math.atan2(dz, dx) * 180 / Math.PI).toFixed(1),
      widthFt: +Math.max(0.8, dim[0] * M_TO_FT).toFixed(2),
      depthFt: +Math.max(0.8, dim[2] * M_TO_FT).toFixed(2),
    });
  }

  // ----- Map detected windows onto wall segments (for glass material) -----
  // Each window's center, in normalized feet, is matched to the nearest
  // polygon edge within 2.5 ft; matched edges get glass assigned.
  const glassSet = new Set<number>();
  for (const wnd of windowSurfs) {
    const m = asMat16(wnd.transform);
    if (!m) continue;
    const wx = m[12] * M_TO_FT - minX;
    const wy = m[14] * M_TO_FT - minY;
    let bestI = -1, bestD = Infinity;
    for (let i = 0; i < shape.length; i++) {
      const A = shape[i], B = shape[(i + 1) % shape.length];
      const ex = B.x - A.x, ey = B.y - A.y;
      const len2 = ex * ex + ey * ey;
      if (len2 < 1e-6) continue;
      let t = ((wx - A.x) * ex + (wy - A.y) * ey) / len2;
      t = Math.max(0, Math.min(1, t));
      const dist = Math.hypot(wx - (A.x + t * ex), wy - (A.y + t * ey));
      if (dist < bestD) { bestD = dist; bestI = i; }
    }
    if (bestI >= 0 && bestD <= 2.5) glassSet.add(bestI);
  }

  return {
    shape,
    widthFt,
    depthFt,
    heightFt,
    furniture,
    glassWallSegments: Array.from(glassSet).sort((a, b) => a - b),
    counts: {
      walls: walls.length, doors, windows, openings,
      objectsImported: furniture.length, objectsSkipped: skipped,
    },
    usedFloorPolygon,
  };
}

/** Read + parse a RoomPlan JSON file with friendly errors. */
export async function importRoomPlanFile(file: File): Promise<ScanImportResult> {
  let text: string;
  try { text = await file.text(); }
  catch { throw new Error('Could not read the file.'); }
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('Not valid JSON — export the scan as JSON from your scanning app.'); }
  return parseRoomPlanJSON(parsed);
}

/** Open a file picker for a scan JSON. Resolves null when cancelled. */
export function pickRoomScanFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** One-line user-facing summary of an imported scan. */
export function scanSummary(r: ScanImportResult): string {
  const bits = [
    `${r.counts.walls} walls`,
    `${r.widthFt.toFixed(0)}×${r.depthFt.toFixed(0)} ft × ${r.heightFt.toFixed(0)} ft high`,
  ];
  if (r.furniture.length) bits.push(`${r.furniture.length} furniture item${r.furniture.length === 1 ? '' : 's'}`);
  if (r.glassWallSegments.length) bits.push(`glass applied to ${r.glassWallSegments.length} window wall${r.glassWallSegments.length === 1 ? '' : 's'}`);
  else if (r.counts.windows) bits.push(`${r.counts.windows} window${r.counts.windows === 1 ? '' : 's'} detected`);
  return `Scan imported — ${bits.join(' · ')}`;
}

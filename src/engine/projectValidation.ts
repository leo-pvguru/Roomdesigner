// =====================================================================
// Project validation + migration
// ---------------------------------------------------------------------
// Single gate that every "load a project from outside" path runs through:
//   • file import (.bavl / .json)
//   • autosave restore
//   • #bavl= share link
//   • scenario snapshot restore
//
// Goals (in priority order):
//   1. NEVER crash the app on bad input. A hand-edited file, a truncated
//      autosave, an old save from a previous schema, or a malicious share
//      link must all resolve to either a usable project or a clean null.
//   2. NEVER silently corrupt state. If the geometry is unusable (no room
//      polygon), reject outright rather than letting a degenerate room
//      reach the acoustics engine and emit NaN heatmaps.
//   3. Forward-migrate. Old saves miss fields added in later sprints
//      (lf, polar, wallObstacles, panelPattern, temperatureF, zone
//      floorHeightFt, …). Those are all optional and resolved with
//      defaults at their read sites, so migration here is mostly about
//      guaranteeing the *required* shape: arrays exist, room has a valid
//      polygon, meta has a name.
// =====================================================================

import type {
  ProjectFile, ProjectMeta, RoomState, Zone, Point,
} from '../types';

/** Bump when a breaking schema change requires real migration logic.
 *  Stamped onto every saved project via buildProjectFile(). */
export const PROJECT_SCHEMA_VERSION = 1;

/** Max decoded size for a share-link payload (bytes-ish). A multi-MB hash
 *  is almost certainly junk or an attack; decoding it would jank the UI. */
export const MAX_SHARE_PAYLOAD = 4_000_000;

function isObj(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFinitePoint(p: unknown): p is Point {
  return isObj(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** A polygon is usable iff it has ≥3 finite vertices. */
function validPolygon(shape: unknown): shape is Point[] {
  return Array.isArray(shape) && shape.length >= 3 && shape.every(isFinitePoint);
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Fill in the required RoomState scalars that older / partial saves might
 *  be missing, without clobbering anything that's present. Geometry
 *  (`shape`) is validated separately by the caller — by the time we're
 *  here we know it's a valid polygon. */
function migrateRoom(raw: Record<string, any>): RoomState {
  const shape = raw.shape as Point[];
  // Derive a bounding box so width/depth defaults track the actual polygon.
  let maxX = 0, maxY = 0;
  for (const p of shape) { if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
  return {
    name: typeof raw.name === 'string' ? raw.name : 'Untitled Room',
    shape,
    width: Number.isFinite(raw.width) ? raw.width : Math.max(1, maxX),
    depth: Number.isFinite(raw.depth) ? raw.depth : Math.max(1, maxY),
    height: Number.isFinite(raw.height) && raw.height > 0 ? raw.height : 14,
    ceilingShape: raw.ceilingShape ?? 'flat',
    peakHeight: Number.isFinite(raw.peakHeight) ? raw.peakHeight : undefined,
    ridgeAxis: raw.ridgeAxis,
    peakOffset: Number.isFinite(raw.peakOffset) ? raw.peakOffset : undefined,
    occupancy: Number.isFinite(raw.occupancy) ? raw.occupancy : 0,
    occupied: typeof raw.occupied === 'boolean' ? raw.occupied : false,
    roomType: raw.roomType ?? 'multipurpose',
    surfaces: asArray(raw.surfaces),
    stage: isObj(raw.stage) ? raw.stage as RoomState['stage'] : null,
    unitSystem: raw.unitSystem === 'metric' ? 'metric' : 'imperial',
    floorPlan: isObj(raw.floorPlan) ? raw.floorPlan as RoomState['floorPlan'] : undefined,
    // Optional acoustic fields — absence is fine; read sites default them.
    temperatureF: Number.isFinite(raw.temperatureF) ? raw.temperatureF : undefined,
    relHumidity: Number.isFinite(raw.relHumidity) ? raw.relHumidity : undefined,
    voice: raw.voice === 'female' ? 'female' : (raw.voice === 'male' ? 'male' : undefined),
    wallObstacles: Array.isArray(raw.wallObstacles) ? raw.wallObstacles : undefined,
  };
}

function migrateMeta(raw: unknown): ProjectMeta {
  const m = isObj(raw) ? raw : {};
  const now = new Date().toISOString();
  return {
    name: typeof m.name === 'string' && m.name.trim() ? m.name : 'Untitled Project',
    clientName: typeof m.clientName === 'string' ? m.clientName : '',
    consultantName: typeof m.consultantName === 'string' ? m.consultantName : '',
    createdAt: typeof m.createdAt === 'string' ? m.createdAt : now,
    updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : now,
    version: typeof m.version === 'string' ? m.version : '0.1.0',
    notes: typeof m.notes === 'string' ? m.notes : undefined,
  };
}

/** Drop zones whose polygon is unusable so the engine never divides by a
 *  zero-area zone. Keeps everything else as-is. */
function migrateZones(raw: unknown): Zone[] {
  return asArray<any>(raw).filter(z => isObj(z) && validPolygon(z.shape)) as Zone[];
}

export interface ValidationResult {
  ok: boolean;
  /** The cleaned, migration-applied project — present iff ok. */
  project?: ProjectFile;
  /** Human-readable reason when !ok, for surfacing to the user. */
  reason?: string;
}

/**
 * Validate + migrate an untrusted blob into a safe ProjectFile.
 * Returns { ok:false, reason } when the data is unusable (so callers can
 * show a toast instead of crashing). On success the returned project is
 * guaranteed to have: a valid room polygon, all array fields present,
 * and a meta with a name.
 */
export function validateAndMigrateProject(raw: unknown): ValidationResult {
  if (!isObj(raw)) {
    return { ok: false, reason: 'File is not a valid Beacon project (not an object).' };
  }
  if (!isObj(raw.room)) {
    return { ok: false, reason: 'Project is missing its room data.' };
  }
  if (!validPolygon(raw.room.shape)) {
    return { ok: false, reason: 'Project room has no valid floor polygon (need at least 3 corners).' };
  }

  const project: ProjectFile = {
    meta: migrateMeta(raw.meta),
    room: migrateRoom(raw.room),
    equipment: asArray(raw.equipment),
    zones: migrateZones(raw.zones),
    groups: asArray(raw.groups),
    simulation: {
      noiseFloor: isObj(raw.simulation) && Number.isFinite(raw.simulation.noiseFloor)
        ? raw.simulation.noiseFloor
        : 35,
    },
    compliance: isObj(raw.compliance) ? raw.compliance as ProjectFile['compliance'] : undefined,
    scenarios: asArray(raw.scenarios),
    activeScenarioId: typeof raw.activeScenarioId === 'string' ? raw.activeScenarioId : null,
    annotations: asArray(raw.annotations),
    connections: asArray(raw.connections),
  };

  return { ok: true, project };
}

/** Convenience wrapper — returns the project or null (no reason). */
export function coerceProject(raw: unknown): ProjectFile | null {
  const r = validateAndMigrateProject(raw);
  return r.ok ? r.project! : null;
}

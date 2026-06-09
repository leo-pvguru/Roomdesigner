// =====================================================================
// CSV exporter
// ---------------------------------------------------------------------
// Emits every field on EquipmentItem that's populated for at least one
// row in the project — but suppresses any column that's empty for ALL
// rows. That way an audio-only project doesn't export a wall of blank
// lighting / video / truss columns, and a video-heavy project doesn't
// export blank speaker columns. Keeps the CSV scannable.
//
// Mirrors the JSON exporter's data fidelity for spec-bearing fields so
// CSV is no longer a lossy export.
// =====================================================================

import { saveAs } from 'file-saver';
import type { EquipmentItem } from '../types';

interface Column {
  header: string;
  /** Return the cell value as a string. Empty string ('') means "no value
   *  for this row"; if every row returns '', the column is dropped. */
  get: (e: EquipmentItem) => string;
}

/** Format a number with N decimals, or '' when undefined / null. */
function n(v: number | undefined | null, decimals = 2): string {
  if (v == null || !Number.isFinite(v)) return '';
  return v.toFixed(decimals);
}

/** Stringify an optional value, mapping null/undefined to ''. */
function s(v: string | number | boolean | undefined | null): string {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'yes' : '';
  return String(v);
}

const COLUMNS: Column[] = [
  // Identity
  { header: 'Label',         get: e => e.label },
  { header: 'Brand',         get: e => e.brand ?? '' },
  { header: 'Kind',          get: e => e.kind },
  { header: 'Category',      get: e => e.category },
  { header: 'Template ID',   get: e => e.templateId },
  // Position & orientation
  { header: 'X (ft)',        get: e => n(e.x) },
  { header: 'Y (ft)',        get: e => n(e.y) },
  { header: 'Z (ft)',        get: e => n(e.z) },
  { header: 'Rotation (°)',  get: e => n(e.rotation, 0) },
  { header: 'Aim (°)',       get: e => n(e.aim, 0) },
  { header: 'Tilt (°)',      get: e => n(e.tilt, 0) },
  // Speaker dispersion + level
  { header: 'Horiz (°)',     get: e => s(e.horiz) },
  { header: 'Vert (°)',      get: e => s(e.vert) },
  { header: 'Max SPL (dB)',  get: e => s(e.maxSPL) },
  { header: 'Sensitivity',   get: e => s(e.sensitivity) },
  { header: 'Power (W)',     get: e => s(e.power) },
  { header: 'Drive (%)',     get: e => s(e.drive) },
  { header: 'Delay (ms)',    get: e => n(e.delayMs, 2) },
  // Driver / frequency response
  { header: 'LF Driver',     get: e => e.lf ?? '' },
  { header: 'LF Hz',         get: e => s(e.lfHz) },
  { header: 'HF Hz',         get: e => s(e.hfHz) },
  { header: 'Xover Low Hz',  get: e => s(e.xoverLowHz) },
  { header: 'Xover High Hz', get: e => s(e.xoverHighHz) },
  { header: 'Cardioid',      get: e => s(e.cardioid) },
  // Polar (stringify presence only — full curves would blow up the CSV)
  { header: 'Polar Data',    get: e => e.polar ? (e.polar.label || 'measured') : '' },
  // Line array
  { header: 'Boxes',         get: e => s(e.boxes) },
  { header: 'Splay (°/box)', get: e => n(e.splay, 1) },
  // Panel / acoustic
  { header: 'Panel W (ft)',  get: e => n(e.panelW) },
  { header: 'Panel H (ft)',  get: e => n(e.panelH) },
  { header: 'Wall',          get: e => e.wall ?? '' },
  { header: 'NRC',           get: e => n(e.nrc, 2) },
  { header: 'Panel Pattern', get: e => e.panelPattern ?? '' },
  { header: 'Panel Color',   get: e => e.panelColor ?? '' },
  // Generic dimensions
  { header: 'Width (ft)',    get: e => n(e.width) },
  { header: 'Depth (ft)',    get: e => n(e.depth) },
  { header: 'Height (ft)',   get: e => n(e.itemHeight) },
  // Truss
  { header: 'Truss L (ft)',  get: e => n(e.trussLengthFt) },
  { header: 'Truss W (ft)',  get: e => n(e.trussWidthFt) },
  { header: 'Truss D (ft)',  get: e => n(e.trussDepthFt) },
  { header: 'Truss Ø (ft)',  get: e => n(e.trussDiameterFt) },
  // Video / projection
  { header: 'Throw Ratio',   get: e => n(e.throwRatio, 2) },
  { header: 'Screen W (ft)', get: e => n(e.screenWidthFt) },
  { header: 'Screen H (ft)', get: e => n(e.screenHeightFt) },
  { header: 'Resolution',    get: e => e.resolution ?? '' },
  { header: 'Brightness',    get: e => s(e.brightness) },
  // Lighting
  { header: 'Beam Angle (°)',get: e => s(e.beamAngleDeg) },
  { header: 'Zoom Min (°)',  get: e => s(e.zoomMinDeg) },
  { header: 'Zoom Max (°)',  get: e => s(e.zoomMaxDeg) },
  { header: 'Color Temp (K)',get: e => s(e.colorTempK) },
  { header: 'Wattage (W)',   get: e => s(e.wattage) },
  // Camera
  { header: 'FOV (°)',       get: e => s(e.fovDeg) },
  { header: 'PTZ',           get: e => s(e.hasPtz) },
  // Membership / wiring / state
  { header: 'Group ID',      get: e => e.groupId ?? '' },
  { header: 'Parent ID',     get: e => e.parentId ?? '' },
  { header: 'Circuit',       get: e => e.circuit ?? '' },
  { header: 'Locked',        get: e => s(e.locked) },
  { header: 'Muted',         get: e => s(e.muted) },
  { header: 'Soloed',        get: e => s(e.soloed) },
];

export function exportCSV(equipment: EquipmentItem[], filename = 'equipment.csv') {
  // Pre-compute every cell so we can drop empty columns in one pass.
  const cells: string[][] = equipment.map(e => COLUMNS.map(c => c.get(e)));
  // Keep a column iff at least one row has a non-empty value for it.
  const keep: boolean[] = COLUMNS.map((_, ci) =>
    cells.some(row => row[ci] !== '')
  );
  const headers = COLUMNS.filter((_, ci) => keep[ci]).map(c => c.header);
  const rows = cells.map(row => row.filter((_, ci) => keep[ci]));

  const csv = [
    headers.map(quote).join(','),
    ...rows.map(r => r.map(quote).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, filename);
}

/** CSV-quote a cell when it contains delimiters, quotes, or newlines. */
function quote(value: string): string {
  if (value === '') return '';
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

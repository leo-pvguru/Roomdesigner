import { saveAs } from 'file-saver';
import type { EquipmentItem, RoomState } from '../types';

// Minimal DXF AutoCAD writer — produces a R12-compatible ASCII DXF
// with named layers per the spec.
//
// Coordinates in feet (DXF is unitless; consumers can interpret as feet).
//
// Layers: ROOM_WALLS, EQUIPMENT_AUDIO, EQUIPMENT_VIDEO, EQUIPMENT_LIGHTING,
//         COVERAGE_CONES, REFERENCE_POINTS, DIMENSIONS

function header(): string[] {
  return [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$INSUNITS', '70', '2', // 2 = feet
    '0', 'ENDSEC',
  ];
}

function tablesSection(): string[] {
  const layers: { name: string; color: number }[] = [
    { name: 'ROOM_WALLS',         color: 7 },
    { name: 'EQUIPMENT_AUDIO',    color: 5 },
    { name: 'EQUIPMENT_VIDEO',    color: 4 },
    { name: 'EQUIPMENT_LIGHTING', color: 2 },
    { name: 'COVERAGE_CONES',     color: 1 },
    { name: 'REFERENCE_POINTS',   color: 3 },
    { name: 'DIMENSIONS',         color: 6 },
    { name: 'ACOUSTIC',           color: 30 },
  ];
  const out: string[] = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(layers.length)];
  for (const l of layers) {
    out.push('0', 'LAYER', '2', l.name, '70', '0', '62', String(l.color), '6', 'CONTINUOUS');
  }
  out.push('0', 'ENDTAB', '0', 'ENDSEC');
  return out;
}

function entityLine(layer: string, x1: number, y1: number, x2: number, y2: number): string[] {
  return [
    '0', 'LINE',
    '8', layer,
    '10', x1.toFixed(4), '20', y1.toFixed(4), '30', '0',
    '11', x2.toFixed(4), '21', y2.toFixed(4), '31', '0',
  ];
}

function entityCircle(layer: string, x: number, y: number, r: number): string[] {
  return [
    '0', 'CIRCLE',
    '8', layer,
    '10', x.toFixed(4), '20', y.toFixed(4), '30', '0',
    '40', r.toFixed(4),
  ];
}

function entityText(layer: string, x: number, y: number, text: string, h = 0.6): string[] {
  return [
    '0', 'TEXT',
    '8', layer,
    '10', x.toFixed(4), '20', y.toFixed(4), '30', '0',
    '40', h.toFixed(2),
    '1', text,
  ];
}

function layerFor(category: string): string {
  if (category === 'audio-speaker' || category === 'audio-signal') return 'EQUIPMENT_AUDIO';
  if (category === 'video') return 'EQUIPMENT_VIDEO';
  if (category === 'lighting') return 'EQUIPMENT_LIGHTING';
  if (category === 'acoustic') return 'ACOUSTIC';
  if (category === 'reference') return 'REFERENCE_POINTS';
  return '0';
}

export function exportDXF(room: RoomState, equipment: EquipmentItem[], filename = 'design.dxf') {
  const out: string[] = [];
  out.push(...header());
  out.push(...tablesSection());
  out.push('0', 'SECTION', '2', 'ENTITIES');

  // Room polyline as separate lines
  const n = room.shape.length;
  for (let i = 0; i < n; i++) {
    const a = room.shape[i], b = room.shape[(i + 1) % n];
    out.push(...entityLine('ROOM_WALLS', a.x, a.y, b.x, b.y));
  }

  // Stage rectangle
  if (room.stage) {
    const cx = room.shape.reduce((s, p) => s + p.x, 0) / n;
    const sx = cx - room.stage.width / 2;
    const sy = 0;
    const sw = room.stage.width;
    const sd = room.stage.depth;
    out.push(...entityLine('ROOM_WALLS', sx, sy, sx + sw, sy));
    out.push(...entityLine('ROOM_WALLS', sx + sw, sy, sx + sw, sy + sd));
    out.push(...entityLine('ROOM_WALLS', sx + sw, sy + sd, sx, sy + sd));
    out.push(...entityLine('ROOM_WALLS', sx, sy + sd, sx, sy));
    out.push(...entityText('DIMENSIONS', sx + sw / 2, sy + sd / 2, 'STAGE'));
  }

  // Equipment as labeled circles + coverage cones
  for (const item of equipment) {
    const layer = layerFor(item.category);
    out.push(...entityCircle(layer, item.x, item.y, 1));
    out.push(...entityText(layer, item.x + 1.5, item.y + 0.5, item.label, 0.5));

    if (item.category === 'audio-speaker' && item.kind !== 'speaker-sub') {
      const aim = (item.aim ?? 90) * Math.PI / 180;
      const half = (item.horiz ?? 90) / 2 * Math.PI / 180;
      const reach = 25;
      const lx = item.x + Math.cos(aim + half) * reach;
      const ly = item.y + Math.sin(aim + half) * reach;
      const rx = item.x + Math.cos(aim - half) * reach;
      const ry = item.y + Math.sin(aim - half) * reach;
      out.push(...entityLine('COVERAGE_CONES', item.x, item.y, lx, ly));
      out.push(...entityLine('COVERAGE_CONES', item.x, item.y, rx, ry));
    }
  }

  out.push('0', 'ENDSEC', '0', 'EOF');
  const blob = new Blob([out.join('\n')], { type: 'application/dxf' });
  saveAs(blob, filename);
}

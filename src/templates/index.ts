import type { RoomState, Surface, EquipmentItem } from '../types';
import { rectShape } from '../utils/geometry';

function defaultSurfaces(wallSegments: number, wallMat: string, floorMat: string, ceilMat: string): Surface[] {
  const out: Surface[] = [];
  for (let i = 0; i < wallSegments; i++) {
    out.push({ id: `surf-w-${i}`, kind: 'wall', segmentIndex: i, materialId: wallMat });
  }
  out.push({ id: 'surf-floor', kind: 'floor', segmentIndex: 0, materialId: floorMat });
  out.push({ id: 'surf-ceiling', kind: 'ceiling', segmentIndex: 0, materialId: ceilMat });
  return out;
}

export interface RoomTemplate {
  id: string;
  name: string;
  description: string;
  build: () => { room: RoomState; equipment: EquipmentItem[] };
}

export const TEMPLATES: RoomTemplate[] = [
  {
    id: 'small-chapel',
    name: 'Small Chapel',
    description: '40×60 ft · ~200 seats · flat ceiling · drywall walls, carpet floor',
    build() {
      const w = 40, d = 60, h = 14;
      const room: RoomState = {
        name: 'Small Chapel',
        shape: rectShape(w, d), width: w, depth: d, height: h,
        ceilingShape: 'flat',
        occupancy: 200,
        occupied: false,
        roomType: 'sanctuary',
        surfaces: defaultSurfaces(4, 'drywall', 'carpet-thick', 'drywall'),
        stage: { width: w - 8, depth: 8, height: 0.75 },
        unitSystem: 'imperial',
      };
      return { room, equipment: [] };
    },
  },
  {
    id: 'medium-sanctuary',
    name: 'Medium Sanctuary',
    description: '70×90 ft · ~500 seats · slight vault · brick side walls',
    build() {
      const w = 70, d = 90, h = 22;
      const room: RoomState = {
        name: 'Medium Sanctuary',
        shape: rectShape(w, d), width: w, depth: d, height: h,
        ceilingShape: 'vaulted', peakHeight: 28, ridgeAxis: 'depth',
        occupancy: 500,
        occupied: false,
        roomType: 'sanctuary',
        surfaces: [
          // Walls in order: bottom (back), right, top (front), left
          { id: 'surf-w-0', kind: 'wall', segmentIndex: 0, materialId: 'drywall' },     // back wall
          { id: 'surf-w-1', kind: 'wall', segmentIndex: 1, materialId: 'brick-bare' },  // right side
          { id: 'surf-w-2', kind: 'wall', segmentIndex: 2, materialId: 'drywall' },     // front (rear)
          { id: 'surf-w-3', kind: 'wall', segmentIndex: 3, materialId: 'brick-bare' },  // left side
          { id: 'surf-floor',   kind: 'floor',   segmentIndex: 0, materialId: 'carpet-thick' },
          { id: 'surf-ceiling-0', kind: 'ceiling', segmentIndex: 0, materialId: 'wood-paneling' },
          { id: 'surf-ceiling-1', kind: 'ceiling', segmentIndex: 1, materialId: 'wood-paneling' },
        ],
        stage: { width: w - 12, depth: 12, height: 1.5 },
        unitSystem: 'imperial',
      };
      const equipment: EquipmentItem[] = [
        // Two stereo mains + one sub
        {
          id: 'sp-1', templateId: 'L-Acoustics-X12', kind: 'speaker-point', category: 'audio-speaker',
          label: 'X12 (FOH L)', brand: 'L-Acoustics',
          x: 14, y: 14, z: 14, rotation: 110, aim: 110, tilt: -12,
          horiz: 90, vert: 60, maxSPL: 138, sensitivity: 102, power: 350, drive: 75,
        },
        {
          id: 'sp-2', templateId: 'L-Acoustics-X12', kind: 'speaker-point', category: 'audio-speaker',
          label: 'X12 (FOH R)', brand: 'L-Acoustics',
          x: w - 14, y: 14, z: 14, rotation: 70, aim: 70, tilt: -12,
          horiz: 90, vert: 60, maxSPL: 138, sensitivity: 102, power: 350, drive: 75,
        },
        {
          id: 'sp-3', templateId: 'L-Acoustics-SB18', kind: 'speaker-sub', category: 'audio-speaker',
          label: 'SB18', brand: 'L-Acoustics',
          x: w / 2, y: 14, z: 1, rotation: 90, aim: 90, tilt: 0,
          horiz: 360, vert: 360, maxSPL: 138, sensitivity: 100, power: 1200, drive: 80,
        },
      ];
      return { room, equipment };
    },
  },
  {
    id: 'large-sanctuary',
    name: 'Large Sanctuary',
    description: '120×150 ft · ~1500 seats · vaulted · concrete walls',
    build() {
      const w = 120, d = 150, h = 35;
      const room: RoomState = {
        name: 'Large Sanctuary',
        shape: rectShape(w, d), width: w, depth: d, height: h,
        ceilingShape: 'vaulted', peakHeight: 45, ridgeAxis: 'depth',
        occupancy: 1500,
        occupied: false,
        roomType: 'sanctuary',
        surfaces: [
          { id: 'surf-w-0', kind: 'wall', segmentIndex: 0, materialId: 'panel-2in' },
          { id: 'surf-w-1', kind: 'wall', segmentIndex: 1, materialId: 'concrete-bare' },
          { id: 'surf-w-2', kind: 'wall', segmentIndex: 2, materialId: 'drywall' },
          { id: 'surf-w-3', kind: 'wall', segmentIndex: 3, materialId: 'concrete-bare' },
          { id: 'surf-floor',   kind: 'floor',   segmentIndex: 0, materialId: 'carpet-thick' },
          { id: 'surf-ceiling-0', kind: 'ceiling', segmentIndex: 0, materialId: 'wood-paneling' },
          { id: 'surf-ceiling-1', kind: 'ceiling', segmentIndex: 1, materialId: 'wood-paneling' },
        ],
        stage: { width: w - 16, depth: 18, height: 2.5 },
        unitSystem: 'imperial',
      };
      return { room, equipment: [] };
    },
  },
  {
    id: 'multipurpose',
    name: 'Multipurpose Room',
    description: '50×80 ft · ~300 seats · flat · concrete block walls',
    build() {
      const w = 50, d = 80, h = 14;
      const room: RoomState = {
        name: 'Multipurpose Room',
        shape: rectShape(w, d), width: w, depth: d, height: h,
        ceilingShape: 'flat',
        occupancy: 300,
        occupied: false,
        roomType: 'multipurpose',
        surfaces: defaultSurfaces(4, 'concrete-bare', 'wood-floor', 'drywall'),
        stage: { width: w - 8, depth: 10, height: 1.5 },
        unitSystem: 'imperial',
      };
      return { room, equipment: [] };
    },
  },
  {
    id: 'outdoor-stage',
    name: 'Outdoor Stage',
    description: 'No ceiling · open-air · direct SPL only',
    build() {
      const w = 80, d = 100, h = 0;
      const room: RoomState = {
        name: 'Outdoor Stage',
        shape: rectShape(w, d), width: w, depth: d, height: h,
        ceilingShape: 'flat',
        occupancy: 600,
        occupied: false,
        roomType: 'outdoor',
        surfaces: [
          { id: 'surf-floor', kind: 'floor', segmentIndex: 0, materialId: 'concrete-bare' },
        ],
        stage: { width: 50, depth: 16, height: 4 },
        unitSystem: 'imperial',
      };
      return { room, equipment: [] };
    },
  },
];

export function defaultRoom(): RoomState {
  return TEMPLATES[1].build().room;
}

export function defaultEquipment(): EquipmentItem[] {
  return TEMPLATES[1].build().equipment;
}

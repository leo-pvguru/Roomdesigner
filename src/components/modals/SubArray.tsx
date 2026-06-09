import { useState } from 'react';
import { useStore } from '../../stores/useStore';
import { Icon } from '../Icon';
import { EQUIPMENT } from '../../constants/equipmentLibrary';
import { buildItemFromTemplate } from '../../utils/itemBuilder';
import type { EquipmentItem, EquipmentTemplate, RoomState } from '../../types';

type Preset = 'cardioid' | 'endfire2' | 'endfire3' | 'gradient' | 'lcr';

interface PresetCtx {
  sub: EquipmentTemplate;
  x: number; y: number; z: number;
  groupId: string;
  room: RoomState;
}

interface PresetDef {
  id: Preset;
  name: string;
  description: string;
  build: (ctx: PresetCtx) => EquipmentItem[];
}

// 343 m/s ≈ 1125 ft/s ≈ 1 ft / 0.889 ms.
const MS_PER_FT = 0.889;

/** Build a single sub for an array. Routes through buildItemFromTemplate so
 *  every brand-specific field (lf, polar, lfHz/hfHz, etc.) is inherited —
 *  otherwise sub-array placements would render generically while a manual
 *  catalog placement would render brand-aware. */
function makeSub(t: EquipmentTemplate, room: RoomState,
                 x: number, y: number, z: number, label: string,
                 aim: number, delayMs: number, polarity: '+' | '-', groupId: string): EquipmentItem {
  const base = buildItemFromTemplate(t, { x, y, z, rotation: aim }, room);
  return {
    ...base,
    label: `${t.label} (${label})`,
    aim,
    tilt: 0,                            // subs don't tilt — flat on the floor / flown level
    drive: polarity === '-' ? -75 : 80, // negative drive = inverted polarity
    delayMs,
    groupId,
  };
}

const PRESETS: PresetDef[] = [
  {
    id: 'cardioid',
    name: 'Cardioid pair',
    description: '2 subs · one forward, one inverted with delay. Cancels rear-radiated bass.',
    build({ sub, x, y, z, groupId, room }) {
      // Rear sub flipped polarity, delayed by sub-cabinet-depth / c
      const cabDepthFt = 2.5;
      const delay = cabDepthFt * MS_PER_FT; // ≈ 2.2 ms
      return [
        makeSub(sub, room, x, y, z, 'front', 90, 0, '+', groupId),
        makeSub(sub, room, x, y - cabDepthFt, z, 'rear (inverted)', 90, delay, '-', groupId),
      ];
    },
  },
  {
    id: 'endfire2',
    name: 'End-fire (2-box)',
    description: '2 subs in a line, rear one delayed by spacing/c. Direction-cancels rearward.',
    build({ sub, x, y, z, groupId, room }) {
      const spacingFt = 4.0;
      const delay = spacingFt * MS_PER_FT;
      return [
        makeSub(sub, room, x, y + spacingFt, z, 'front', 90, 0, '+', groupId),
        makeSub(sub, room, x, y, z, 'rear (delayed)', 90, delay, '+', groupId),
      ];
    },
  },
  {
    id: 'endfire3',
    name: 'End-fire (3-box)',
    description: '3 subs spaced equally, each subsequent box delayed cumulatively. Strong forward gain.',
    build({ sub, x, y, z, groupId, room }) {
      const spacingFt = 4.0;
      return [
        makeSub(sub, room, x, y + spacingFt * 2, z, 'front',  90, 0,                          '+', groupId),
        makeSub(sub, room, x, y + spacingFt,     z, 'middle', 90, spacingFt * MS_PER_FT,      '+', groupId),
        makeSub(sub, room, x, y,                 z, 'rear',   90, spacingFt * 2 * MS_PER_FT,  '+', groupId),
      ];
    },
  },
  {
    id: 'gradient',
    name: 'Gradient (front + rear)',
    description: 'Like cardioid but spaced wider. Better cancellation, narrower forward beam.',
    build({ sub, x, y, z, groupId, room }) {
      const spacingFt = 5.5;
      const delay = spacingFt * MS_PER_FT * 0.5; // half-period for partial cancellation
      return [
        makeSub(sub, room, x, y, z, 'front', 90, 0, '+', groupId),
        makeSub(sub, room, x, y - spacingFt, z, 'rear (delayed)', 90, delay, '-', groupId),
      ];
    },
  },
  {
    id: 'lcr',
    name: 'L+C+R sub line',
    description: '3 subs across the front, evenly spaced. Good basic horizontal coverage.',
    build({ sub, x, y, z, groupId, room }) {
      const spacingFt = 8;
      return [
        makeSub(sub, room, x - spacingFt, y, z, 'L', 90, 0, '+', groupId),
        makeSub(sub, room, x,             y, z, 'C', 90, 0, '+', groupId),
        makeSub(sub, room, x + spacingFt, y, z, 'R', 90, 0, '+', groupId),
      ];
    },
  },
];

export function SubArrayModal() {
  const open = useStore(s => s.openModal === 'sub-array');
  const setOpenModal = useStore(s => s.setOpenModal);
  const room = useStore(s => s.room);
  const equipment = useStore(s => s.equipment);
  const beginHistoryGroup = useStore(s => s.beginHistoryGroup);
  const addEquipmentLive = useStore(s => s.addEquipmentLive);
  const addGroup = useStore(s => s.addGroup);
  const setHint = useStore(s => s.setHint);
  void equipment;

  const subs = EQUIPMENT.filter(t => t.kind === 'speaker-sub');
  const [presetId, setPresetId] = useState<Preset>('cardioid');
  const [subIdx, setSubIdx] = useState(0);

  if (!open) return null;
  const preset = PRESETS.find(p => p.id === presetId)!;
  const selectedSub = subs[subIdx];

  const onApply = () => {
    if (!selectedSub) return;
    const cx = room.width / 2;
    const cy = 6; // 6 ft from front of stage
    const z = 1;
    const gid = addGroup('Sub Array', '#143F99');
    beginHistoryGroup();
    const items = preset.build({ sub: selectedSub, x: cx, y: cy, z, groupId: gid, room });
    for (const item of items) addEquipmentLive(item);
    setHint(`${preset.name} placed (${items.length} subs)`);
    setOpenModal(null);
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpenModal(null)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <div>
            <h2>Insert subwoofer array</h2>
            <div className="sub">Auto-calculates polarity and delay for the chosen geometry.</div>
          </div>
          <button className="icon-close" onClick={() => setOpenModal(null)}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <div className="field-row" style={{ gridTemplateColumns: '110px 1fr' }}>
            <label>Sub model</label>
            <select value={subIdx} onChange={e => setSubIdx(parseInt(e.target.value, 10))}>
              {subs.map((s, i) => <option key={i} value={i}>{s.brand} · {s.label}</option>)}
            </select>
          </div>

          <div className="section-label" style={{ marginTop: 14 }}>Array type</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {PRESETS.map(p => (
              <button key={p.id} className="template-tile"
                onClick={() => setPresetId(p.id)}
                style={{
                  borderColor: presetId === p.id ? 'var(--royal-blue)' : 'var(--border)',
                  boxShadow: presetId === p.id ? '0 0 0 2px rgba(26,79,191,.16)' : 'none',
                }}>
                <h4>{p.name}</h4>
                <div className="specs" style={{ marginTop: 4 }}>{p.description}</div>
              </button>
            ))}
          </div>

          <div className="muted" style={{ fontSize: 11.5, marginTop: 12 }}>
            Subs will be added as a new "Sub Array" speaker group with auto-calculated delay (343 m/s).
            You can fine-tune positions and delay after placement.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setOpenModal(null)}>Cancel</button>
          <button className="btn btn-cta" onClick={onApply} disabled={!selectedSub}>
            <Icon name="plus" size={14}/> Insert array
          </button>
        </div>
      </div>
    </div>
  );
}

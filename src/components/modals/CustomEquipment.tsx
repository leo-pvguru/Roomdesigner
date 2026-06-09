import { useState } from 'react';
import { useStore } from '../../stores/useStore';
import type { EquipmentCategory, EquipmentKind, EquipmentTemplate } from '../../types';
import { Icon } from '../Icon';

const KIND_OPTIONS: { kind: EquipmentKind; category: EquipmentCategory; label: string }[] = [
  { kind: 'speaker-point',      category: 'audio-speaker', label: 'Speaker — point source' },
  { kind: 'speaker-line-array', category: 'audio-speaker', label: 'Speaker — line array' },
  { kind: 'speaker-column',     category: 'audio-speaker', label: 'Speaker — column' },
  { kind: 'speaker-sub',        category: 'audio-speaker', label: 'Speaker — subwoofer' },
  { kind: 'speaker-ceiling',    category: 'audio-speaker', label: 'Speaker — ceiling' },
  { kind: 'speaker-monitor',    category: 'audio-speaker', label: 'Speaker — stage monitor' },
  { kind: 'acoustic-panel',     category: 'acoustic',      label: 'Acoustic panel' },
  { kind: 'bass-trap',          category: 'acoustic',      label: 'Bass trap' },
  { kind: 'diffuser',           category: 'acoustic',      label: 'Diffuser' },
  { kind: 'projector',          category: 'video',         label: 'Projector' },
  { kind: 'led-wall',           category: 'video',         label: 'LED wall' },
  { kind: 'ptz-camera',         category: 'video',         label: 'PTZ camera' },
  { kind: 'mh-spot',            category: 'lighting',      label: 'Moving head — spot' },
  { kind: 'mh-wash',            category: 'lighting',      label: 'Moving head — wash' },
  { kind: 'led-par',            category: 'lighting',      label: 'LED PAR' },
  { kind: 'rack',               category: 'infrastructure',label: 'Equipment rack' },
];

export function CustomEquipmentModal() {
  const open = useStore(s => s.openModal === 'custom-equipment');
  const setOpenModal = useStore(s => s.setOpenModal);
  const addCustom = useStore(s => s.addCustomEquipment);
  const setHint = useStore(s => s.setHint);

  const [kindIdx, setKindIdx] = useState(0);
  const [brand, setBrand] = useState('');
  const [label, setLabel] = useState('');
  const [horiz, setHoriz] = useState(90);
  const [vert, setVert] = useState(60);
  const [maxSPL, setMaxSPL] = useState(130);
  const [sensitivity, setSensitivity] = useState(99);
  const [power, setPower] = useState(300);
  const [nrc, setNrc] = useState(1.0);

  if (!open) return null;
  const sel = KIND_OPTIONS[kindIdx];
  const isSpeaker = sel.category === 'audio-speaker';
  const isAcoustic = sel.category === 'acoustic';

  const submit = () => {
    if (!label.trim()) return;
    const t: EquipmentTemplate = {
      kind: sel.kind,
      category: sel.category,
      label: label.trim(),
      brand: brand.trim() || 'Custom',
      badge: 'Custom',
    };
    if (isSpeaker) {
      t.horiz = horiz; t.vert = vert; t.maxSPL = maxSPL;
      t.sensitivity = sensitivity; t.power = power;
    }
    if (isAcoustic) {
      t.nrc = nrc;
      t.defaultW = 4; t.defaultD = 2;
      t.alpha = {
        125: clamp(nrc * 0.45), 250: clamp(nrc * 0.75),
        500: clamp(nrc * 1.05), 1000: clamp(nrc * 1.10),
        2000: clamp(nrc * 1.05), 4000: clamp(nrc * 0.95),
      };
    }
    addCustom(t);
    setHint(`${t.label} added to your custom library`);
    setOpenModal(null);
    // Reset
    setLabel(''); setBrand('');
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpenModal(null)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div>
            <h2>Add custom equipment</h2>
            <div className="sub">Save a one-off model to your catalog. Stays with this project.</div>
          </div>
          <button className="icon-close" onClick={() => setOpenModal(null)}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <div className="field-row" style={{ gridTemplateColumns: '110px 1fr' }}>
            <label>Type</label>
            <select value={kindIdx} onChange={e => setKindIdx(parseInt(e.target.value, 10))}>
              {KIND_OPTIONS.map((k, i) => (
                <option key={k.kind + i} value={i}>{k.label}</option>
              ))}
            </select>
          </div>
          <div className="field-row" style={{ gridTemplateColumns: '110px 1fr' }}>
            <label>Brand</label>
            <input className="text-input" value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Custom"/>
          </div>
          <div className="field-row" style={{ gridTemplateColumns: '110px 1fr' }}>
            <label>Model</label>
            <input className="text-input" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. House Special 12"/>
          </div>

          {isSpeaker && (
            <>
              <div className="field-row" style={{ gridTemplateColumns: '110px 1fr' }}>
                <label>Horizontal °</label>
                <input className="num-input tabular" type="number" value={horiz} onChange={e => setHoriz(parseFloat(e.target.value))}/>
              </div>
              <div className="field-row" style={{ gridTemplateColumns: '110px 1fr' }}>
                <label>Vertical °</label>
                <input className="num-input tabular" type="number" value={vert} onChange={e => setVert(parseFloat(e.target.value))}/>
              </div>
              <div className="field-row" style={{ gridTemplateColumns: '110px 1fr' }}>
                <label>Max SPL (dB)</label>
                <input className="num-input tabular" type="number" value={maxSPL} onChange={e => setMaxSPL(parseFloat(e.target.value))}/>
              </div>
              <div className="field-row" style={{ gridTemplateColumns: '110px 1fr' }}>
                <label>Sensitivity</label>
                <input className="num-input tabular" type="number" value={sensitivity} onChange={e => setSensitivity(parseFloat(e.target.value))}/>
              </div>
              <div className="field-row" style={{ gridTemplateColumns: '110px 1fr' }}>
                <label>Power (W)</label>
                <input className="num-input tabular" type="number" value={power} onChange={e => setPower(parseFloat(e.target.value))}/>
              </div>
            </>
          )}

          {isAcoustic && (
            <div className="field-row" style={{ gridTemplateColumns: '110px 1fr' }}>
              <label>NRC</label>
              <input className="num-input tabular" type="number" step="0.05" value={nrc} onChange={e => setNrc(parseFloat(e.target.value))}/>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setOpenModal(null)}>Cancel</button>
          <button className="btn btn-cta" onClick={submit} disabled={!label.trim()}>
            <Icon name="plus" size={14}/> Add to catalog
          </button>
        </div>
      </div>
    </div>
  );
}

function clamp(n: number) {
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(0.99, n));
}

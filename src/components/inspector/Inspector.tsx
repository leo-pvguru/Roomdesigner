import { useRef, useState } from 'react';
import { useStore } from '../../stores/useStore';
import { Icon } from '../Icon';
import { MATERIALS, getMaterial, getScattering, materialNRC, materialsForSurface } from '../../constants/materials';
import { polygonArea, polygonPerimeter, bboxOf } from '../../utils/geometry';
import { effectiveRidgeAxis, slopeAngleDeg, peakHeightFromAngle, ceilingPanels } from '../../utils/ceiling';
import type { CeilingShape, EquipmentItem, RoomType, RoomState, OctaveBand } from '../../types';
import { OCTAVE_BANDS } from '../../types';
import {
  roomVolumeFt3, totalSurfaceAreaFt2, totalFloorAreaFt2,
  speakerSPL, combinedSPL, effectiveVertCoverage,
  computeZoneStats, evaluateCompliance,
  airAbsorptionDbPerM,
  type ComplianceCheck,
} from '../../engine/acoustics';
import {
  effectiveWattage, ampsAt120V, summarizeCircuits,
  BREAKER_AMPS, NEC_DUTY,
} from '../../engine/power';
import { CABLE_SPECS, CABLE_TYPES, defaultCableForKind, straightLineLengthFt } from '../../constants/cables';
import type { ComplianceTargets, CableType } from '../../types';

const FT_FORMAT = (n: number) => `${n.toFixed(1)} ft`;

/**
 * Collapsible section. Open/closed state persists per `sectionKey` in localStorage.
 */
function Section({
  sectionKey, title, icon, defaultOpen = false, badge, children,
}: {
  sectionKey: string;
  title: string;
  icon: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const storageKey = `beacon.inspector.section.${sectionKey}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v === '1') return true;
      if (v === '0') return false;
    } catch { /* noop */ }
    return defaultOpen;
  });
  const toggle = () => {
    const v = !open;
    setOpen(v);
    try { localStorage.setItem(storageKey, v ? '1' : '0'); } catch { /* noop */ }
  };
  return (
    <div className="inspector-section">
      <button className={`inspector-section-header ${open ? 'open' : ''}`} onClick={toggle}>
        <span className="ico"><Icon name={icon} size={13}/></span>
        <span className="title">{title}</span>
        {badge}
        <span className="chev"><Icon name="chevD" size={14}/></span>
      </button>
      {open && <div className="inspector-section-body">{children}</div>}
    </div>
  );
}

export function Inspector() {
  const tab = useStore(s => s.inspectorTab);
  const setTab = useStore(s => s.setInspectorTab);
  const selectedIds = useStore(s => s.selectedIds);
  const equipment = useStore(s => s.equipment);
  const deleteEquipment = useStore(s => s.deleteEquipment);
  const duplicateEquipment = useStore(s => s.duplicateEquipment);
  const meta = useStore(s => s.meta);
  const room = useStore(s => s.room);
  const collapsed = useStore(s => s.inspectorCollapsed);
  const toggleCollapsed = useStore(s => s.toggleInspectorCollapsed);

  const selectedSurface = useStore(s => s.selectedSurface);
  const multi = selectedIds.length > 1;
  const selected = selectedIds.length === 1 ? equipment.find(e => e.id === selectedIds[0]) ?? null : null;
  const surfaceActive = !selected && !multi && !!selectedSurface;

  if (collapsed) {
    return <CollapsedInspectorRail
      onExpand={toggleCollapsed}
      hasSelection={!!selected}
      activeTab={tab}
      setTab={setTab}
    />;
  }

  return (
    <aside className="sidebar right">
      <div className="sb-header">
        <div className="row between">
          <h3>Inspector</h3>
          <div className="row" style={{ gap: 4 }}>
            {selected && (
              <>
                <button className="btn btn-ghost btn-sm" title="Duplicate" onClick={() => duplicateEquipment(selected.id)}>
                  <Icon name="copy" size={14}/>
                </button>
                <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => deleteEquipment(selected.id)}>
                  <Icon name="trash" size={14}/>
                </button>
              </>
            )}
            <button className="sb-collapse" title="Collapse panel" onClick={toggleCollapsed}>
              <Icon name="chevR" size={14}/>
            </button>
          </div>
        </div>
        <div className="sub">
          {multi
            ? `${selectedIds.length} items selected`
            : selected
              ? `${selected.brand ?? ''} · ${selected.label}`
              : surfaceActive
                ? `Surface · ${surfaceLabel(selectedSurface!, room)}`
                : `${meta.name} · ${room.occupancy} seats · ${room.roomType}`}
        </div>
      </div>

      <div className="sb-tabs">
        {(['properties','acoustics','notes'] as const).map(t => (
          <button key={t} className={`sb-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'properties' ? 'Properties' : t === 'acoustics' ? 'Acoustics' : 'Notes'}
          </button>
        ))}
      </div>

      <div className="sb-body">
        {tab === 'properties' && (
          multi ? <MultiSelectPanel/>
          : selected ? <SelectedPanel item={selected}/>
          : surfaceActive ? <SurfacePanel sel={selectedSurface!}/>
          : <RoomPanel/>
        )}
        {tab === 'acoustics' && <AcousticsPanel/>}
        {tab === 'notes' && <NotesPanel/>}
      </div>
    </aside>
  );
}

// ===== Surface material panel =====

function defaultMaterialFor(kind: 'wall' | 'floor' | 'ceiling'): string {
  if (kind === 'floor') return 'carpet-thick';
  return 'drywall'; // walls + ceilings
}

function surfaceLabel(sel: { kind: 'wall' | 'floor' | 'ceiling'; segmentIndex: number }, room: RoomState): string {
  if (sel.kind === 'floor') return 'Floor';
  if (sel.kind === 'wall') return `Wall ${sel.segmentIndex + 1}`;
  // ceiling — resolve facet label
  const panels = ceilingPanels(room);
  if (panels.length <= 1) return 'Ceiling';
  const cp = panels.find(p => p.segmentIndex === sel.segmentIndex);
  return cp ? `Ceiling — ${cp.label}` : 'Ceiling';
}

/** Tiny per-band bar readout for an absorption or scattering curve (0..1+). */
function BandBars({ values, color }: { values: Record<OctaveBand, number>; color: string }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 46, marginTop: 4 }}>
      {OCTAVE_BANDS.map(b => {
        const v = Math.max(0, Math.min(1, values[b]));
        return (
          <div key={b} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{ height: 30, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ width: '100%', height: `${v * 100}%`, background: color, borderRadius: '2px 2px 0 0', minHeight: 1 }} title={`${b} Hz: ${values[b].toFixed(2)}`}/>
            </div>
            <span style={{ fontSize: 8.5, color: 'var(--fg3)', fontFamily: 'var(--font-mono)' }}>
              {b >= 1000 ? `${b / 1000}k` : b}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SurfacePanel({ sel }: { sel: { kind: 'wall' | 'floor' | 'ceiling'; segmentIndex: number } }) {
  const room = useStore(s => s.room);
  const setSelectedSurfaceMaterial = useStore(s => s.setSelectedSurfaceMaterial);
  const selectSurface = useStore(s => s.selectSurface);

  const seg = room.surfaces.find(s => s.kind === sel.kind && s.segmentIndex === sel.segmentIndex);
  const matId = seg?.materialId ?? defaultMaterialFor(sel.kind);
  const mat = getMaterial(matId);
  const scattering = getScattering(matId);
  const nrc = materialNRC(mat);

  const options = materialsForSurface(sel.kind);
  // Group options by their display group for the dropdown.
  const groups: Record<string, typeof options> = {};
  for (const m of options) {
    const g = m.group ?? 'other';
    (groups[g] = groups[g] || []).push(m);
  }
  const GROUP_LABEL: Record<string, string> = {
    reflective: 'Reflective / hard', wood: 'Wood', absorptive: 'Absorptive / soft',
    'glass-metal': 'Glass & metal', ceiling: 'Ceiling', treatment: 'Acoustic treatment',
    floor: 'Floor', other: 'Other',
  };

  return (
    <div>
      <Section sectionKey="surf-material" title={surfaceLabel(sel, room)} icon="panel2" defaultOpen={true}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Assign a material to this surface. Absorption drives RT60 & clarity;
          scattering feeds the diffuse-reflection model.
        </div>

        <div className="field-row" style={{ gridTemplateColumns: '70px 1fr' }}>
          <label>Material</label>
          <select value={matId} onChange={e => setSelectedSurfaceMaterial(e.target.value)}>
            {Object.entries(groups).map(([g, list]) => (
              <optgroup key={g} label={GROUP_LABEL[g] ?? g}>
                {list.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Swatch + headline numbers */}
        <div className="row" style={{ gap: 10, alignItems: 'center', marginTop: 10 }}>
          <span style={{ width: 28, height: 28, borderRadius: 6, background: mat.color, border: '1px solid var(--border)', flexShrink: 0 }}/>
          <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
            <div><span className="muted">NRC </span><b className="tabular">{nrc.toFixed(2)}</b></div>
            {mat.thicknessIn != null && <div><span className="muted">Thick </span><b className="tabular">{mat.thicknessIn}"</b></div>}
          </div>
        </div>
        {mat.description && (
          <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>{mat.description}</div>
        )}
      </Section>

      <Section sectionKey="surf-alpha" title="Absorption (α)" icon="ray" defaultOpen={true}>
        <BandBars values={mat.alpha} color="#2E87F5"/>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          Fraction absorbed per octave band (125 Hz → 4 kHz).
        </div>
      </Section>

      <Section sectionKey="surf-scatter" title="Scattering (s)" icon="ray" defaultOpen={false}>
        <BandBars values={scattering} color="#A855F7"/>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          Fraction of the reflection scattered diffusely vs specularly. Higher =
          more diffusion (textured / modeled surfaces, audience, diffusers).
        </div>
      </Section>

      <div style={{ padding: '4px 16px 16px' }}>
        <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => selectSurface(null)}>
          Done — clear surface selection
        </button>
      </div>
    </div>
  );
}

function RoomPanel() {
  const room = useStore(s => s.room);
  const setRoom = useStore(s => s.setRoom);
  const meta = useStore(s => s.meta);
  const setMeta = useStore(s => s.setMeta);
  const setSurfaceMaterial = useStore(s => s.setSurfaceMaterial);
  const setStage = useStore(s => s.setStage);
  const equipment = useStore(s => s.equipment);
  const addReferencePoint = useStore(s => s.addReferencePoint);
  const deleteEquipment = useStore(s => s.deleteEquipment);
  const setSelected = useStore(s => s.setSelected);

  const volume = roomVolumeFt3(room);
  const surfaceArea = totalSurfaceAreaFt2(room);
  const floorArea = totalFloorAreaFt2(room);
  const refPoints = equipment.filter(e => e.category === 'reference');

  return (
    <div>
      <Section sectionKey="project" title="Project" icon="user" defaultOpen={true}>
        <div className="card-head" style={{ marginBottom: 6 }}>
          <div>
            <strong style={{ fontSize: 14, fontFamily: 'Montserrat' }}>{meta.name}</strong>
            <div className="card-sub">{meta.clientName || 'Beacon AVL project'}</div>
          </div>
          <span className="pill-mini">Active</span>
        </div>
        <div className="field-row"><label>Project name</label>
          <input className="text-input" value={meta.name} onChange={e => setMeta({ name: e.target.value })}/>
        </div>
        <div className="field-row"><label>Client</label>
          <input className="text-input" value={meta.clientName} onChange={e => setMeta({ clientName: e.target.value })}/>
        </div>
        <div className="field-row"><label>Consultant</label>
          <input className="text-input" value={meta.consultantName} onChange={e => setMeta({ consultantName: e.target.value })}/>
        </div>
      </Section>

      <Section sectionKey="dimensions" title="Dimensions" icon="cube" defaultOpen={true}
        badge={room.shape.length !== 4 ? <span className="pill-mini">{room.shape.length}-sided</span> : null}>
        <RoomShapeButton/>
        <div className="field-row"><label>Width</label>
          <input className="num-input tabular" type="number" step="1" value={room.width.toFixed(1)}
            onChange={e => setRoom({ width: parseFloat(e.target.value) || room.width, shape: rectFromDims(parseFloat(e.target.value) || room.width, room.depth) })}/>
        </div>
        <div className="field-row"><label>Depth</label>
          <input className="num-input tabular" type="number" step="1" value={room.depth.toFixed(1)}
            onChange={e => setRoom({ depth: parseFloat(e.target.value) || room.depth, shape: rectFromDims(room.width, parseFloat(e.target.value) || room.depth) })}/>
        </div>
        <div className="field-row">
          <label>{(room.ceilingShape !== 'flat' && room.ceilingShape !== 'coffered') ? 'Eave height' : 'Wall height'}</label>
          <input className="num-input tabular" type="number" step="0.5" value={room.height.toFixed(1)}
            onChange={e => setRoom({ height: parseFloat(e.target.value) || room.height })}/>
        </div>
        <div className="field-row"><label>Ceiling shape</label>
          <select value={room.ceilingShape}
            onChange={e => {
              const next = e.target.value as CeilingShape;
              const wasFlat = room.ceilingShape === 'flat' || room.ceilingShape === 'coffered';
              const isFlat = next === 'flat' || next === 'coffered';
              const patch: Partial<typeof room> = { ceilingShape: next };
              // Seed a reasonable peak height when transitioning into a non-flat
              // shape — otherwise the ceiling collapses to the eave height.
              if (!isFlat && wasFlat && (!room.peakHeight || room.peakHeight <= room.height)) {
                patch.peakHeight = room.height + Math.max(4, room.height * 0.3);
              }
              // Cascade the existing ceiling material to all new slope segments
              // so the user doesn't get a default-drywall slope on transitions.
              const baseMat = room.surfaces.find(s => s.kind === 'ceiling' && s.segmentIndex === 0)?.materialId;
              if (baseMat) {
                const tempRoom = { ...room, ...patch } as typeof room;
                const panels = ceilingPanels(tempRoom);
                const newSurfaces = [...room.surfaces];
                for (const cp of panels) {
                  const exists = newSurfaces.some(s => s.kind === 'ceiling' && s.segmentIndex === cp.segmentIndex);
                  if (!exists) {
                    newSurfaces.push({
                      id: `surf-ceiling-${cp.segmentIndex}-${Date.now()}-${cp.segmentIndex}`,
                      kind: 'ceiling',
                      segmentIndex: cp.segmentIndex,
                      materialId: baseMat,
                    });
                  }
                }
                if (newSurfaces.length !== room.surfaces.length) patch.surfaces = newSurfaces;
              }
              setRoom(patch);
            }}>
            <option value="flat">Flat</option>
            <option value="sloped">Sloped (shed)</option>
            <option value="vaulted">Vaulted (A-frame)</option>
            <option value="hip">Hip</option>
            <option value="cross-gable">Cross-gable</option>
            <option value="coffered">Coffered</option>
          </select>
        </div>
        {room.ceilingShape !== 'flat' && room.ceilingShape !== 'coffered' && (() => {
          const peak = room.peakHeight ?? room.height + 4;
          const bb = bboxOf(room.shape);
          const along = effectiveRidgeAxis(room);
          const cross = along === 'width' ? bb.depth : bb.width;
          // Run distance for the slope-angle calc — half the cross-axis for a
          // centred vault, full cross-axis for a single-slope shed.
          const run = room.ceilingShape === 'sloped'
            ? cross
            : (room.ceilingShape === 'hip' ? Math.min(bb.width, bb.depth) / 2 : cross / 2);
          const angle = slopeAngleDeg(peak - room.height, run);
          const showRidge = room.ceilingShape === 'sloped'
            || room.ceilingShape === 'vaulted'
            || room.ceilingShape === 'hip';
          const showOffset = room.ceilingShape === 'sloped' || room.ceilingShape === 'vaulted';
          const offset = typeof room.peakOffset === 'number'
            ? room.peakOffset
            : (room.ceilingShape === 'sloped' ? 1 : 0.5);
          return (
            <>
              <div className="field-row"><label>Peak height</label>
                <input className="num-input tabular" type="number" step="0.5"
                  value={peak.toFixed(1)}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    if (!isFinite(v)) return;
                    setRoom({ peakHeight: Math.max(room.height, v) });
                  }}/>
              </div>
              <div className="field-row"><label>Slope angle</label>
                <input className="num-input tabular" type="number" step="0.5"
                  value={angle.toFixed(1)}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    if (!isFinite(v)) return;
                    const newPeak = peakHeightFromAngle(room.height, Math.max(0, Math.min(80, v)), run);
                    setRoom({ peakHeight: newPeak });
                  }}
                  title="Pitch angle from horizontal — auto-syncs with peak height"/>
              </div>
              {showRidge && (
                <div className="field-row"><label>Ridge runs along</label>
                  <select value={along} onChange={e => setRoom({ ridgeAxis: e.target.value as 'width' | 'depth' })}>
                    <option value="width">Width (X axis)</option>
                    <option value="depth">Depth (Y axis)</option>
                  </select>
                </div>
              )}
              {showOffset && (
                <div className="slider-row">
                  <label>{room.ceilingShape === 'sloped' ? 'High edge' : 'Ridge offset'}</label>
                  <input type="range" min="0" max="1" step="0.05"
                    value={offset}
                    onChange={e => setRoom({ peakOffset: parseFloat(e.target.value) })}/>
                  <span className="val tabular">{(offset * 100).toFixed(0)}%</span>
                </div>
              )}
            </>
          );
        })()}
        <div className="field-row"><label>Occupancy</label>
          <input className="num-input tabular" type="number" step="1" value={room.occupancy}
            onChange={e => setRoom({ occupancy: parseInt(e.target.value) || 0 })}/>
        </div>
        <div className="field-row"><label>Room type</label>
          <select value={room.roomType} onChange={e => setRoom({ roomType: e.target.value as RoomType })}>
            <option value="sanctuary">Sanctuary</option>
            <option value="multipurpose">Multipurpose</option>
            <option value="fellowship">Fellowship hall</option>
            <option value="gym">Gym</option>
            <option value="outdoor">Outdoor</option>
          </select>
        </div>
      </Section>

      <Section sectionKey="computed" title="Computed" icon="info">
        <div className="field-row"><label>Floor area</label><div className="tabular">{floorArea.toFixed(0)} sq ft</div></div>
        <div className="field-row"><label>Volume</label><div className="tabular">{volume.toFixed(0)} ft³</div></div>
        <div className="field-row"><label>Surface area</label><div className="tabular">{surfaceArea.toFixed(0)} sq ft</div></div>
      </Section>

      <Section sectionKey="stage" title="Stage / platform" icon="triangle"
        badge={room.stage ? <span className="pill-mini">{room.stage.width.toFixed(0)}×{room.stage.depth.toFixed(0)} ft</span> : null}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 12 }}>Raised platform at the front of the room.</span>
          {room.stage ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setStage(null)}>Remove</button>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={() => setStage({ width: room.width - 8, depth: 8, height: 1.5 })}>
              <Icon name="plus" size={12}/> Add
            </button>
          )}
        </div>
        {room.stage ? (
          <>
            <div className="field-row"><label>Width</label>
              <input className="num-input tabular" type="number" step="0.5"
                value={room.stage.width.toFixed(1)}
                onChange={e => setStage({ ...room.stage!, width: parseFloat(e.target.value) || room.stage!.width })}/>
            </div>
            <div className="field-row"><label>Depth</label>
              <input className="num-input tabular" type="number" step="0.5"
                value={room.stage.depth.toFixed(1)}
                onChange={e => setStage({ ...room.stage!, depth: parseFloat(e.target.value) || room.stage!.depth })}/>
            </div>
            <div className="field-row"><label>Height</label>
              <input className="num-input tabular" type="number" step="0.25"
                value={room.stage.height.toFixed(2)}
                onChange={e => setStage({ ...room.stage!, height: parseFloat(e.target.value) || room.stage!.height })}/>
            </div>
          </>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>No stage / platform.</div>
        )}
      </Section>

      <Section sectionKey="references" title="Reference points" icon="microphone"
        badge={refPoints.length > 0 ? <span className="pill-mini">{refPoints.length}</span> : null}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 12 }}>Predict SPL at named seats.</span>
          <button className="btn btn-secondary btn-sm" onClick={() => addReferencePoint()}>
            <Icon name="plus" size={12}/> Add
          </button>
        </div>
        {refPoints.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>
            Drop measurement points (Mix Position, Back Row, Balcony Rail) so the simulation can predict SPL there.
          </div>
        ) : (
          <div className="col" style={{ gap: 6 }}>
            {refPoints.map(r => (
              <div key={r.id} className="row between" style={{
                padding: '6px 8px',
                background: 'var(--bg-alt)',
                borderRadius: 6,
                fontSize: 12.5,
              }}>
                <button onClick={() => setSelected(r.id)} style={{
                  background: 'transparent', border: 0, cursor: 'pointer',
                  textAlign: 'left', flex: 1, padding: 0, color: 'var(--fg1)',
                }}>
                  <strong>{r.label}</strong>
                  <span className="muted" style={{ marginLeft: 6 }}>
                    ({r.x.toFixed(1)}, {r.y.toFixed(1)}, {r.z.toFixed(1)})
                  </span>
                </button>
                <button className="btn btn-ghost btn-sm" title="Remove"
                  onClick={() => deleteEquipment(r.id)}>
                  <Icon name="trash" size={12}/>
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <ScenariosCard/>
      <ZonesCard/>
      <GroupsCard/>
      <CircuitsCard/>
      <CablingCard/>
      <TrussesCard/>

      <FloorPlanCard/>

      <Section sectionKey="materials" title="Surface materials" icon="panel2">
        {/* Walls in shape order */}
        {room.shape.map((_, i) => {
          const seg = room.surfaces.find(s => s.kind === 'wall' && s.segmentIndex === i);
          const matId = seg?.materialId ?? 'drywall';
          return (
            <div key={`wall-${i}`} className="field-row">
              <label>Wall {i + 1}</label>
              <select value={matId} onChange={e => setSurfaceMaterial('wall', i, e.target.value)}>
                {MATERIALS.filter(m => m.category === 'wall' || m.category === 'panel').map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          );
        })}
        <div className="field-row">
          <label>Floor</label>
          <select value={room.surfaces.find(s => s.kind === 'floor')?.materialId ?? 'carpet-thick'}
            onChange={e => setSurfaceMaterial('floor', 0, e.target.value)}>
            {MATERIALS.filter(m => m.category === 'floor').map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        {(() => {
          const panels = ceilingPanels(room);
          return panels.map(cp => {
            const seg = room.surfaces.find(s => s.kind === 'ceiling' && s.segmentIndex === cp.segmentIndex);
            const matId = seg?.materialId ?? 'drywall';
            const label = panels.length > 1 ? `Ceiling — ${cp.label}` : 'Ceiling';
            return (
              <div key={`ceil-${cp.segmentIndex}`} className="field-row">
                <label title={`${cp.areaFt2.toFixed(0)} sq ft`}>{label}</label>
                <select value={matId}
                  onChange={e => setSurfaceMaterial('ceiling', cp.segmentIndex, e.target.value)}>
                  {MATERIALS.filter(m => m.category === 'wall' || m.category === 'ceiling' || m.category === 'panel').map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            );
          });
        })()}
      </Section>
    </div>
  );
}

function RoomShapeButton() {
  const editing = useStore(s => s.editingRoomShape);
  const setEditing = useStore(s => s.setEditingRoomShape);
  const room = useStore(s => s.room);
  const setRoom = useStore(s => s.setRoom);
  return (
    <div className="row" style={{ gap: 6, marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
      <button
        className={editing ? 'btn btn-cta btn-sm' : 'btn btn-secondary btn-sm'}
        onClick={() => setEditing(!editing)}>
        <Icon name="polygon" size={12}/>
        {editing ? 'Drawing…' : 'Redraw shape'}
      </button>
      {room.shape.length !== 4 && (
        <button className="btn btn-ghost btn-sm" title="Reset to rectangle"
          onClick={() => setRoom({ shape: [
            { x: 0, y: 0 }, { x: room.width, y: 0 },
            { x: room.width, y: room.depth }, { x: 0, y: room.depth },
          ] })}>
          <Icon name="refresh" size={12}/> Rectangle
        </button>
      )}
    </div>
  );
}

function rectFromDims(w: number, d: number) {
  return [
    { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d },
  ];
}

function MultiSelectPanel() {
  const selectedIds = useStore(s => s.selectedIds);
  const equipment = useStore(s => s.equipment);
  const updateEquipment = useStore(s => s.updateEquipment);
  const beginHistoryGroup = useStore(s => s.beginHistoryGroup);
  const updateEquipmentLive = useStore(s => s.updateEquipmentLive);
  const addEquipmentLive = useStore(s => s.addEquipmentLive);
  const deleteEquipmentLive = useStore(s => s.deleteEquipmentLive);
  const clearSelection = useStore(s => s.clearSelection);
  const setSelection = useStore(s => s.setSelection);
  const addGroup = useStore(s => s.addGroup);
  const setItemGroup = useStore(s => s.setItemGroup);
  const setHint = useStore(s => s.setHint);
  // Suppress unused-import warning
  void updateEquipment;

  const items = selectedIds
    .map(id => equipment.find(e => e.id === id))
    .filter(Boolean) as EquipmentItem[];

  const combineIntoLineArray = useStore(s => s.combineIntoLineArray);

  const speakerCount = items.filter(i => i.category === 'audio-speaker').length;
  const allMuted = items.every(i => i.muted);
  const allSoloed = items.every(i => i.soloed);
  const allLocked = items.every(i => i.locked);
  // Combinable speakers — point sources, columns, fills, delays, and existing arrays.
  const COMBINABLE = new Set(['speaker-point', 'speaker-column', 'speaker-line-array', 'speaker-fill', 'speaker-delay']);
  const combinable = items.filter(i => COMBINABLE.has(i.kind));
  const sameModel = combinable.length > 0
    && combinable.every(i => i.brand === combinable[0].brand && i.label === combinable[0].label);

  const applyAll = (patch: (item: EquipmentItem) => Partial<EquipmentItem>) => {
    beginHistoryGroup();
    for (const it of items) updateEquipmentLive(it.id, patch(it));
  };

  const offset = (dx: number, dy: number, dz: number) => {
    applyAll(it => ({ x: it.x + dx, y: it.y + dy, z: it.z + dz }));
  };

  const palette = ['#1A4FBF', '#F5A623', '#2F9E5E', '#A855F7', '#06B6D4', '#F97316'];

  return (
    <div>
      <Section sectionKey="multiselect" title="Multi-select" icon="users" defaultOpen={true}
        badge={<span className="pill-mini">{selectedIds.length}</span>}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          {selectedIds.length} items selected · {speakerCount} speaker{speakerCount === 1 ? '' : 's'}
        </div>

        <div className="row" style={{ gap: 6, marginBottom: 8 }}>
          <button className="btn btn-secondary btn-sm" style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => {
              beginHistoryGroup();
              const newIds: string[] = [];
              for (const it of items) {
                const copy: EquipmentItem = { ...it,
                  id: `${it.kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,5)}`,
                  x: it.x + 2, y: it.y + 2 };
                addEquipmentLive(copy);
                newIds.push(copy.id);
              }
              setSelection(newIds);
              setHint(`${items.length} items duplicated`);
            }}>
            <Icon name="copy" size={12}/> Duplicate all
          </button>
          <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center', color: '#A52A2A' }}
            onClick={() => {
              // No confirm — deletes are fully undoable, and a hint with the
              // undo affordance is faster than a blocking dialog.
              beginHistoryGroup();
              const n = items.length;
              for (const it of items) deleteEquipmentLive(it.id);
              clearSelection();
              useStore.getState().setHint(`${n} items deleted — Cmd+Z to undo`);
            }}>
            <Icon name="trash" size={12}/> Delete all
          </button>
        </div>

        {speakerCount > 0 && (
          <div className="row" style={{ gap: 6, marginBottom: 8 }}>
            <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => applyAll(() => ({ muted: !allMuted, soloed: false }))}>
              {allMuted ? 'Unmute all' : 'Mute all'}
            </button>
            <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => applyAll(() => ({ soloed: !allSoloed, muted: false }))}>
              {allSoloed ? 'Unsolo all' : 'Solo all'}
            </button>
          </div>
        )}

        {combinable.length >= 2 && (
          <div style={{ marginBottom: 8 }}>
            <button className="btn btn-secondary btn-sm" style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => {
                const top = combinable.slice().sort((a, b) => b.z - a.z)[0];
                const id = combineIntoLineArray(combinable.map(i => i.id));
                if (id) {
                  const total = combinable.reduce((n, s) => n + Math.max(1, s.boxes ?? 1), 0);
                  // Mixed models: surface the spec-inheritance in the hint
                  // instead of a blocking confirm — the action is undoable.
                  setHint(sameModel
                    ? `Combined ${combinable.length} speakers into a ${total}-box line array`
                    : `Combined into a ${total}-box array — specs from "${top.label}" (Cmd+Z to undo)`);
                }
              }}>
              <Icon name="link" size={12}/> Combine into line array ({combinable.reduce((n, s) => n + Math.max(1, s.boxes ?? 1), 0)} boxes)
            </button>
            {!sameModel && (
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                Mixed models — array will use specs from the topmost speaker.
              </div>
            )}
          </div>
        )}

        <div className="row" style={{ gap: 6, marginBottom: 8 }}>
          <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => applyAll(() => ({ locked: !allLocked }))}>
            <Icon name={allLocked ? 'unlock' : 'lock'} size={12}/> {allLocked ? 'Unlock all' : 'Lock all'}
          </button>
          {speakerCount > 1 && (
            <button className="btn btn-secondary btn-sm" style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => {
                const gid = addGroup(`Group of ${selectedIds.length}`, palette[Math.floor(Math.random() * palette.length)]);
                for (const it of items) setItemGroup(it.id, gid);
                setHint('Group created');
              }}>
              <Icon name="link" size={12}/> Group
            </button>
          )}
        </div>
      </Section>

      <Section sectionKey="multioffset" title="Offset position" icon="cube" defaultOpen={true}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Nudge all selected items together.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {[
            ['−1 ft X', () => offset(-1, 0, 0)],
            ['+1 ft X', () => offset(1, 0, 0)],
            ['−1 ft Y', () => offset(0, -1, 0)],
            ['+1 ft Y', () => offset(0, 1, 0)],
            ['−1 ft Z', () => offset(0, 0, -1)],
            ['+1 ft Z', () => offset(0, 0, 1)],
          ].map(([label, fn]) => (
            <button key={label as string} className="btn btn-ghost btn-sm"
              style={{ justifyContent: 'center' }}
              onClick={fn as () => void}>{label as string}</button>
          ))}
        </div>
      </Section>

      <Section sectionKey="multialign" title="Align & distribute" icon="grid" defaultOpen={true}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Snap everything in this selection to a shared edge or even spacing.
        </div>
        {(() => {
          // Typed axis-patch helper — narrows `axis` to the three position
          // keys on EquipmentItem and produces a properly typed Partial<>.
          // Replaces a previous `{ [axis]: target } as any` that defeated
          // the typechecker on every alignment call.
          type PosAxis = 'x' | 'y' | 'z';
          const axisPatch = (axis: PosAxis, value: number): Partial<EquipmentItem> => {
            switch (axis) {
              case 'x': return { x: value };
              case 'y': return { y: value };
              case 'z': return { z: value };
            }
          };
          const alignTo = (axis: PosAxis, mode: 'min' | 'max' | 'mean') => {
            beginHistoryGroup();
            const vals = items.map(i => i[axis]);
            const target = mode === 'min' ? Math.min(...vals) : mode === 'max' ? Math.max(...vals) : vals.reduce((s, v) => s + v, 0) / vals.length;
            for (const it of items) updateEquipmentLive(it.id, axisPatch(axis, target));
          };
          const distribute = (axis: 'x' | 'y') => {
            if (items.length < 3) return;
            const sorted = [...items].sort((a, b) => a[axis] - b[axis]);
            const min = sorted[0][axis];
            const max = sorted[sorted.length - 1][axis];
            const step = (max - min) / (sorted.length - 1);
            beginHistoryGroup();
            sorted.forEach((it, i) => updateEquipmentLive(it.id, axisPatch(axis, min + i * step)));
          };
          return (
            <>
              <div style={{ fontSize: 11, color: 'var(--fg2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'Montserrat', fontWeight: 600 }}>Align</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => alignTo('x', 'min')}>Left</button>
                <button className="btn btn-ghost btn-sm" onClick={() => alignTo('x', 'mean')}>Center X</button>
                <button className="btn btn-ghost btn-sm" onClick={() => alignTo('x', 'max')}>Right</button>
                <button className="btn btn-ghost btn-sm" onClick={() => alignTo('y', 'min')}>Front</button>
                <button className="btn btn-ghost btn-sm" onClick={() => alignTo('y', 'mean')}>Center Y</button>
                <button className="btn btn-ghost btn-sm" onClick={() => alignTo('y', 'max')}>Back</button>
                <button className="btn btn-ghost btn-sm" onClick={() => alignTo('z', 'min')}>Lowest Z</button>
                <button className="btn btn-ghost btn-sm" onClick={() => alignTo('z', 'mean')}>Mean Z</button>
                <button className="btn btn-ghost btn-sm" onClick={() => alignTo('z', 'max')}>Highest Z</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'Montserrat', fontWeight: 600 }}>Distribute</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <button className="btn btn-ghost btn-sm" disabled={items.length < 3}
                  onClick={() => distribute('x')}>Even on X</button>
                <button className="btn btn-ghost btn-sm" disabled={items.length < 3}
                  onClick={() => distribute('y')}>Even on Y</button>
              </div>
            </>
          );
        })()}
      </Section>

      <Section sectionKey="multilist" title="Selected items" icon="layers">
        <div className="col" style={{ gap: 4, fontSize: 12 }}>
          {items.map(it => (
            <div key={it.id} className="row between" style={{
              padding: '4px 8px', background: 'var(--bg-alt)', borderRadius: 4,
            }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong>{it.label}</strong>
              </span>
              <span className="muted" style={{ fontSize: 11 }}>{it.kind.replace('speaker-', '')}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function SelectedPanel({ item }: { item: EquipmentItem }) {
  if (item.category === 'audio-speaker') return <SpeakerInspector item={item}/>;
  if (item.category === 'acoustic') return <PanelInspector item={item}/>;
  if (item.category === 'reference') return <ReferenceInspector item={item}/>;
  return <GenericInspector item={item}/>;
}

function ReferenceInspector({ item }: { item: EquipmentItem }) {
  const update = useStore(s => s.updateEquipment);
  const set = (patch: Partial<EquipmentItem>) => update(item.id, patch);
  const setOpenModal = useStore(s => s.setOpenModal);
  // Predict SPL from all speakers at this point.
  const equipment = useStore(s => s.equipment);
  const activeFreq = useStore(s => s.activeFreq);
  const speakers = equipment.filter(e => e.category === 'audio-speaker');

  const splList = speakers.map(sp => speakerSPL(sp, item, activeFreq));
  const acousticSpls = splList.filter(s => isFinite(s));
  const totalSpl = combinedSPL(acousticSpls);

  return (
    <div>
      <div className="inspector-card">
        <div className="card-head">
          <div>
            <h4>{item.label}</h4>
            <div className="card-sub">Reference / measurement point</div>
          </div>
          <span className="pill-mini amber">Reference</span>
        </div>
        <div className="field-row"><label>Label</label>
          <input className="text-input" value={item.label} onChange={e => set({ label: e.target.value })}/>
        </div>
        <div className="field-row"><label>X (ft)</label>
          <input className="num-input tabular" type="number" step="0.5" value={item.x.toFixed(1)} onChange={e => set({ x: parseFloat(e.target.value) })}/>
        </div>
        <div className="field-row"><label>Y (ft)</label>
          <input className="num-input tabular" type="number" step="0.5" value={item.y.toFixed(1)} onChange={e => set({ y: parseFloat(e.target.value) })}/>
        </div>
        <div className="field-row"><label>Z (ft)</label>
          <input className="num-input tabular" type="number" step="0.5" value={item.z.toFixed(1)} onChange={e => set({ z: parseFloat(e.target.value) })}/>
        </div>
      </div>

      <div className="inspector-card">
        <h4 style={{ marginBottom: 8 }}>Predicted SPL @ this point</h4>
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <strong style={{ fontFamily: 'Montserrat', fontSize: 26 }} className="tabular">
            {speakers.length ? totalSpl.toFixed(1) : '—'}
          </strong>
          <span className="muted" style={{ fontSize: 12 }}>dB SPL · {activeFreq === 'broadband' ? 'broadband' : activeFreq + 'Hz'}</span>
        </div>
        {speakers.length === 0 && (
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Place speakers to see a prediction.</div>
        )}
        <button
          className="btn btn-secondary btn-sm"
          style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
          onClick={() => setOpenModal('snapshot')}>
          <Icon name="microphone" size={12}/> Detailed snapshot
        </button>
      </div>
    </div>
  );
}

function SpeakerInspector({ item }: { item: EquipmentItem }) {
  const update = useStore(s => s.updateEquipment);
  const splitLineArray = useStore(s => s.splitLineArray);
  const set = (patch: Partial<EquipmentItem>) => update(item.id, patch);
  // Mirrors the engine's speakerSplAt1m so the inspector's headline number
  // matches the heatmap. (No flat -8 dB monitor penalty anymore — directional
  // dispersion does that work via the monitor's aim.)
  const splAt1m = item.kind === 'speaker-iem'
    ? null
    : (() => {
        let s = (item.sensitivity != null && item.power != null)
          ? item.sensitivity + 10 * Math.log10(Math.max(1, item.power))
          : (item.maxSPL ?? 130) - 28;
        if (item.kind === 'speaker-line-array') {
          s += 10 * Math.log10(Math.max(1, item.boxes ?? 6));
        }
        const drive = (item.drive ?? 75) / 100;
        s += 20 * Math.log10(Math.max(0.05, drive));
        return s;
      })();

  return (
    <div>
      <div className="inspector-card">
        <div className="card-head">
          <div>
            <h4>{item.label}</h4>
            <div className="card-sub">{item.brand}</div>
          </div>
          <span className="pill-mini">{kindLabel(item.kind)}</span>
        </div>
        <div className="row" style={{ gap: 6, marginBottom: 8 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => set({ muted: !item.muted, soloed: item.muted ? item.soloed : false })}
            style={{
              flex: 1, justifyContent: 'center',
              background: item.muted ? 'rgba(197,48,48,.18)' : 'var(--bg-alt)',
              color: item.muted ? '#A52A2A' : 'var(--fg2)',
              fontWeight: 700, letterSpacing: '0.10em',
            }}>
            {item.muted ? 'MUTED' : 'M'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => set({ soloed: !item.soloed, muted: item.soloed ? item.muted : false })}
            style={{
              flex: 1, justifyContent: 'center',
              background: item.soloed ? 'rgba(245,166,35,.18)' : 'var(--bg-alt)',
              color: item.soloed ? '#B57600' : 'var(--fg2)',
              fontWeight: 700, letterSpacing: '0.10em',
            }}>
            {item.soloed ? 'SOLO' : 'S'}
          </button>
        </div>
        <div className="field-row"><label>Label</label>
          <input className="text-input" value={item.label} onChange={e => set({ label: e.target.value })}/>
        </div>
        <div className="field-row"><label>Position X</label>
          <input className="num-input tabular" type="number" step="0.1" value={item.x.toFixed(1)} onChange={e => set({ x: parseFloat(e.target.value) })}/>
        </div>
        <div className="field-row"><label>Position Y</label>
          <input className="num-input tabular" type="number" step="0.1" value={item.y.toFixed(1)} onChange={e => set({ y: parseFloat(e.target.value) })}/>
        </div>
        <div className="field-row"><label>Height (Z)</label>
          <input className="num-input tabular" type="number" step="0.1" value={item.z.toFixed(1)} onChange={e => set({ z: parseFloat(e.target.value) })}/>
        </div>
      </div>

      <div className="inspector-card">
        <h4 style={{ marginBottom: 8 }}>Aim & dispersion</h4>
        <div className="slider-row">
          <label>Aim (yaw)</label>
          <input type="range" min="0" max="360" step="1" value={item.aim ?? 90} onChange={e => set({ aim: parseInt(e.target.value, 10) })}/>
          <span className="val">{item.aim ?? 90}°</span>
        </div>
        <div className="slider-row">
          <label>Down-tilt</label>
          <input type="range" min="-90" max="30" step="1" value={item.tilt ?? -8} onChange={e => set({ tilt: parseInt(e.target.value, 10) })}/>
          <span className="val">{item.tilt ?? -8}°</span>
        </div>
        <div className="slider-row">
          <label>Horiz pattern</label>
          <input type="range" min="20" max="180" step="1" value={item.horiz ?? 90} onChange={e => set({ horiz: parseInt(e.target.value, 10) })}/>
          <span className="val">{item.horiz ?? 90}°</span>
        </div>
        <div className="slider-row">
          <label>Vert pattern</label>
          <input type="range" min="10" max="180" step="1" value={item.vert ?? 60} onChange={e => set({ vert: parseInt(e.target.value, 10) })}/>
          <span className="val">{item.vert ?? 60}°</span>
        </div>
        <div className="slider-row">
          <label>Drive</label>
          <input type="range" min="0" max="100" step="1" value={item.drive ?? 75} onChange={e => set({ drive: parseInt(e.target.value, 10) })}/>
          <span className="val">{item.drive ?? 75}%</span>
        </div>
      </div>

      <div className="inspector-card">
        <h4 style={{ marginBottom: 8 }}>SPL & power</h4>
        <div className="field-row"><label>Sensitivity</label>
          <input className="num-input tabular" type="number" step="1" value={item.sensitivity ?? 99} onChange={e => set({ sensitivity: parseFloat(e.target.value) })}/>
        </div>
        <div className="field-row"><label>Power (W)</label>
          <input className="num-input tabular" type="number" step="50" value={item.power ?? 300} onChange={e => set({ power: parseFloat(e.target.value) })}/>
        </div>
        <div className="field-row"><label>Max SPL</label>
          <input className="num-input tabular" type="number" step="1" value={item.maxSPL ?? 130} onChange={e => set({ maxSPL: parseFloat(e.target.value) })}/>
        </div>
        <div className="field-row"><label>Delay (ms)</label>
          <input className="num-input tabular" type="number" step="0.5" value={item.delayMs ?? 0} onChange={e => set({ delayMs: parseFloat(e.target.value) })}/>
        </div>
        <div className="row" style={{ marginTop: 8, gap: 10 }}>
          <span className="muted" style={{ fontSize: 11.5 }}>Effective SPL @ 1m</span>
          <strong className="tabular" style={{ marginLeft: 'auto', fontSize: 14 }}>
            {splAt1m == null ? '—' : `${splAt1m.toFixed(0)} dB`}
          </strong>
        </div>
        <div className="meter" style={{ marginTop: 6 }}>
          {Array.from({length: 24}).map((_, i) => {
            const drive = (item.drive ?? 75) / 100;
            const lit = i < Math.round(drive * 24);
            const cls = i < 14 ? 'lo' : i < 20 ? 'mid' : 'hi';
            return <div key={i} className={`seg ${lit ? 'on' : ''} ${cls}`}/>;
          })}
        </div>
      </div>

      <div className="inspector-card">
        <ParentTrussPicker item={item}/>
      </div>
      <AcousticsContributionCard item={item}/>
      <FrequencyResponseCard item={item}/>
      <PolarResponseCard item={item}/>
      <SpeakerGroupAssign item={item}/>
      <ConnectionsCardForItem item={item}/>

      {(item.kind === 'speaker-line-array') && (() => {
        const boxes = Math.max(1, item.boxes ?? 6);
        return (
          <div className="inspector-card">
            <h4 style={{ marginBottom: 8 }}>Line-array config</h4>
            <div className="field-row"><label>Boxes</label>
              <input className="num-input tabular" type="number" step="1" min="1" max="24"
                value={item.boxes ?? 6} onChange={e => set({ boxes: parseInt(e.target.value, 10) })}/>
            </div>
            <div className="field-row"><label>Splay/box</label>
              <input className="num-input tabular" type="number" step="0.5" min="0" max="10"
                value={item.splay ?? 1.5} onChange={e => set({ splay: parseFloat(e.target.value) })}/>
            </div>
            <div className="field-row"><label>Effective V cov</label>
              <div className="tabular">{effectiveVertCoverage(item).toFixed(1)}°</div>
            </div>
            <div className="field-row"><label>Stack gain</label>
              <div className="tabular">+{(10 * Math.log10(boxes)).toFixed(1)} dB</div>
            </div>
            {boxes >= 2 && (
              <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
                onClick={() => {
                  splitLineArray(item.id);
                  useStore.getState().setHint(`Split into ${boxes} point sources — Cmd+Z to undo`);
                }}>
                Split into {boxes} point sources
              </button>
            )}
          </div>
        );
      })()}

      {item.kind === 'speaker-iem' && (
        <div className="inspector-card">
          <div className="row" style={{ gap: 8 }}>
            <Icon name="info" size={14}/>
            <div style={{ fontSize: 12, color: 'var(--fg2)' }}>
              IEM transmitters are RF — no acoustic output is added to the SPL heatmap.
              They appear here for placement and BOM only.
            </div>
          </div>
        </div>
      )}

      {item.kind === 'speaker-monitor' && (
        <div className="inspector-card">
          <div className="row" style={{ gap: 8 }}>
            <Icon name="info" size={14}/>
            <div style={{ fontSize: 12, color: 'var(--fg2)' }}>
              Stage monitors are directional. Set the monitor's <b>aim</b> back toward
              the performer — the dispersion model will naturally roll off audience
              spill from the off-axis side. (No more flat −8 dB penalty.)
            </div>
          </div>
        </div>
      )}

      {(item.kind === 'speaker-sub' || item.kind === 'speaker-sub-flown') && (
        <div className="inspector-card">
          <h4 style={{ marginBottom: 8 }}>Subwoofer pattern</h4>
          <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={!!item.cardioid}
              onChange={e => set({ cardioid: e.target.checked })}
              style={{ marginTop: 2 }}
            />
            <div style={{ fontSize: 12, color: 'var(--fg2)' }}>
              <b style={{ color: 'var(--fg)' }}>Cardioid / end-fire array</b>
              <div style={{ marginTop: 4 }}>
                When enabled, this sub uses a cardioid pattern (full forward, ~−6 dB
                side, ~−25 dB rear) instead of being treated as omnidirectional.
                Use for gradient-stack, end-fire, and cardioid-card subwoofer arrays
                where you've configured the rear-cancel sub on its own time-aligned
                channel.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PanelInspector({ item }: { item: EquipmentItem }) {
  const update = useStore(s => s.updateEquipment);
  const set = (patch: Partial<EquipmentItem>) => update(item.id, patch);
  const sabines = ((item.panelW ?? 4) * (item.panelH ?? 2) * (item.nrc ?? 1.0)).toFixed(1);
  return (
    <div className="inspector-card">
      <div className="card-head">
        <div>
          <h4>{item.label}</h4>
          <div className="card-sub">{item.brand}{item.nrc ? ` · NRC ${item.nrc}` : ''}</div>
        </div>
        <span className="pill-mini amber">Acoustic</span>
      </div>
      <div className="field-row"><label>Wall</label>
        <select value={item.wall ?? 'L'} onChange={e => set({ wall: e.target.value as EquipmentItem['wall'] })}>
          <option value="L">Left</option>
          <option value="R">Right</option>
          <option value="B">Back</option>
          <option value="F">Front</option>
          <option value="C">Ceiling</option>
        </select>
      </div>
      <div className="field-row"><label>X (ft)</label>
        <input className="num-input tabular" type="number" step="0.5" value={item.x.toFixed(1)} onChange={e => set({ x: parseFloat(e.target.value) })}/>
      </div>
      <div className="field-row"><label>Y (ft)</label>
        <input className="num-input tabular" type="number" step="0.5" value={item.y.toFixed(1)} onChange={e => set({ y: parseFloat(e.target.value) })}/>
      </div>
      <div className="field-row"><label>Z (ft)</label>
        <input className="num-input tabular" type="number" step="0.5" value={item.z.toFixed(1)} onChange={e => set({ z: parseFloat(e.target.value) })}/>
      </div>
      <div className="field-row"><label>Width</label>
        <input className="num-input tabular" type="number" step="0.5" value={(item.panelW ?? 4).toFixed(1)} onChange={e => set({ panelW: parseFloat(e.target.value) })}/>
      </div>
      <div className="field-row"><label>Height</label>
        <input className="num-input tabular" type="number" step="0.5" value={(item.panelH ?? 2).toFixed(1)} onChange={e => set({ panelH: parseFloat(e.target.value) })}/>
      </div>
      <div className="field-row"><label>NRC</label><div className="tabular">{(item.nrc ?? 1.0).toFixed(2)}</div></div>
      <div className="field-row"><label>Absorption</label><div className="tabular">{sabines} sabins</div></div>
    </div>
  );
}

function GenericInspector({ item }: { item: EquipmentItem }) {
  const update = useStore(s => s.updateEquipment);
  const equipment = useStore(s => s.equipment);
  const set = (patch: Partial<EquipmentItem>) => update(item.id, patch);
  const isProjector = item.kind === 'projector' || item.kind === 'led-wall' || item.kind === 'confidence-monitor';
  const isCamera = item.kind === 'ptz-camera' || item.kind === 'cam-handheld';
  const isMovingHead = item.kind === 'mh-spot' || item.kind === 'mh-wash';
  const isLight = isMovingHead || item.kind === 'led-par' || item.kind === 'followspot';
  const isTrussItem = isTrussKind(item.kind);
  const throwDistance = (item.throwRatio && item.screenWidthFt) ? item.screenWidthFt / item.throwRatio : null;
  const knownCircuits = Array.from(new Set(equipment.map(e => e.circuit).filter((c): c is string => !!c && c.trim() !== '')));
  const watts = effectiveWattage(item);
  const amps = ampsAt120V(watts);
  return (
    <div>
      <div className="inspector-card">
        <div className="card-head">
          <div>
            <h4>{item.label}</h4>
            <div className="card-sub">{item.brand} · {item.kind}</div>
          </div>
          <span className="pill-mini">{item.category}</span>
        </div>
        <div className="field-row"><label>Label</label>
          <input className="text-input" value={item.label} onChange={e => set({ label: e.target.value })}/>
        </div>
        <div className="field-row"><label>Position X</label>
          <input className="num-input tabular" type="number" step="0.1" value={item.x.toFixed(1)} onChange={e => set({ x: parseFloat(e.target.value) })}/>
        </div>
        <div className="field-row"><label>Position Y</label>
          <input className="num-input tabular" type="number" step="0.1" value={item.y.toFixed(1)} onChange={e => set({ y: parseFloat(e.target.value) })}/>
        </div>
        <div className="field-row"><label>Height (Z)</label>
          <input className="num-input tabular" type="number" step="0.1" value={item.z.toFixed(1)} onChange={e => set({ z: parseFloat(e.target.value) })}/>
        </div>
        <div className="field-row"><label>Rotation</label>
          <input className="num-input tabular" type="number" step="5" value={item.rotation.toFixed(0)} onChange={e => set({ rotation: parseFloat(e.target.value) })}/>
        </div>
        {!isTrussItem && <ParentTrussPicker item={item}/>}
      </div>

      {!isTrussItem && <AcousticsContributionCard item={item}/>}

      {isTrussItem && <TrussInspectorCard item={item}/>}

      <div className="inspector-card">
        <h4 style={{ marginBottom: 8 }}>Power</h4>
        <div className="field-row"><label>Wattage</label>
          <input className="num-input tabular" type="number" step="10"
            value={(item.wattage ?? watts).toFixed(0)}
            onChange={e => {
              const v = parseFloat(e.target.value);
              set({ wattage: isFinite(v) ? v : undefined });
            }}
            placeholder={`~${watts}`}
            title={item.wattage == null ? 'Estimated from kind / rated power. Type a number to override.' : 'Manual override'}/>
        </div>
        <div className="field-row"><label>Amps @ 120V</label>
          <div className="tabular">{amps.toFixed(2)} A</div>
        </div>
        <div className="field-row"><label>Circuit</label>
          <input className="text-input" list={`circuits-${item.id}`}
            value={item.circuit ?? ''}
            placeholder="e.g. Stage A"
            onChange={e => set({ circuit: e.target.value })}/>
          <datalist id={`circuits-${item.id}`}>
            {knownCircuits.map(c => <option key={c} value={c}/>)}
          </datalist>
        </div>
      </div>

      {isProjector && (
        <div className="inspector-card">
          <h4 style={{ marginBottom: 8 }}>Projection</h4>
          <div className="field-row"><label>Throw ratio</label>
            <input className="num-input tabular" type="number" step="0.05"
              value={(item.throwRatio ?? 1.5).toFixed(2)}
              onChange={e => set({ throwRatio: parseFloat(e.target.value) })}/>
          </div>
          <div className="field-row"><label>Screen W (ft)</label>
            <input className="num-input tabular" type="number" step="0.5"
              value={(item.screenWidthFt ?? 12).toFixed(1)}
              onChange={e => set({ screenWidthFt: parseFloat(e.target.value) })}/>
          </div>
          <div className="field-row"><label>Screen H (ft)</label>
            <input className="num-input tabular" type="number" step="0.5"
              value={(item.screenHeightFt ?? 6.75).toFixed(2)}
              onChange={e => set({ screenHeightFt: parseFloat(e.target.value) })}/>
          </div>
          <div className="field-row"><label>Resolution</label>
            <select value={item.resolution ?? '1920×1080'}
              onChange={e => set({ resolution: e.target.value })}>
              <option>1920×1080</option>
              <option>2560×1440</option>
              <option>3840×2160 (4K)</option>
              <option>5120×2880 (5K)</option>
            </select>
          </div>
          <div className="field-row"><label>Brightness</label>
            <input className="num-input tabular" type="number" step="100"
              value={(item.brightness ?? 5000).toFixed(0)}
              onChange={e => set({ brightness: parseFloat(e.target.value) })}/>
          </div>
          <div className="field-row"><label>Throw distance</label>
            <div className="tabular">{throwDistance ? `${throwDistance.toFixed(1)} ft` : '—'}</div>
          </div>
        </div>
      )}

      {isLight && (
        <div className="inspector-card">
          <h4 style={{ marginBottom: 8 }}>Fixture</h4>
          {isMovingHead && (
            <>
              <div className="slider-row">
                <label>Zoom min</label>
                <input type="range" min="3" max="60" step="1"
                  value={item.zoomMinDeg ?? 8}
                  onChange={e => set({ zoomMinDeg: parseInt(e.target.value, 10) })}/>
                <span className="val">{item.zoomMinDeg ?? 8}°</span>
              </div>
              <div className="slider-row">
                <label>Zoom max</label>
                <input type="range" min="10" max="80" step="1"
                  value={item.zoomMaxDeg ?? 40}
                  onChange={e => set({ zoomMaxDeg: parseInt(e.target.value, 10) })}/>
                <span className="val">{item.zoomMaxDeg ?? 40}°</span>
              </div>
            </>
          )}
          <div className="slider-row">
            <label>Beam angle</label>
            <input type="range"
              min={isMovingHead ? (item.zoomMinDeg ?? 3) : 3}
              max={isMovingHead ? (item.zoomMaxDeg ?? 80) : 80}
              step="1"
              value={item.beamAngleDeg ?? (isMovingHead ? 15 : 25)}
              onChange={e => set({ beamAngleDeg: parseInt(e.target.value, 10) })}/>
            <span className="val">{item.beamAngleDeg ?? (isMovingHead ? 15 : 25)}°</span>
          </div>
          <div className="slider-row">
            <label>Tilt</label>
            <input type="range" min="-90" max="0" step="1"
              value={item.tilt ?? -45}
              onChange={e => set({ tilt: parseInt(e.target.value, 10) })}/>
            <span className="val">{item.tilt ?? -45}°</span>
          </div>
          <div className="field-row"><label>Color temp</label>
            <select value={item.colorTempK ?? 5600}
              onChange={e => set({ colorTempK: parseInt(e.target.value, 10) })}>
              <option value="2700">2700 K (warm)</option>
              <option value="3200">3200 K (tungsten)</option>
              <option value="4000">4000 K</option>
              <option value="5600">5600 K (daylight)</option>
              <option value="6500">6500 K (cool)</option>
            </select>
          </div>
        </div>
      )}

      {isCamera && (
        <div className="inspector-card">
          <h4 style={{ marginBottom: 8 }}>Camera</h4>
          <div className="slider-row">
            <label>Field of view</label>
            <input type="range" min="20" max="120" step="1"
              value={item.fovDeg ?? 60}
              onChange={e => set({ fovDeg: parseInt(e.target.value, 10) })}/>
            <span className="val">{item.fovDeg ?? 60}°</span>
          </div>
          {item.kind === 'ptz-camera' && (
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              PTZ — pan/tilt remotely controllable, motorized zoom.
            </div>
          )}
        </div>
      )}

      <ConnectionsCardForItem item={item}/>
    </div>
  );
}

/**
 * Atmosphere card — controls the room-level inputs that aren't acoustic
 * geometry but DO drive the acoustic prediction:
 *
 *   • Temperature (°F) and Relative Humidity (%) → ANSI S1.26 / ISO 9613-1
 *     air absorption coefficients per band (set via the engine's
 *     airAbsorptionDbPerM helper). Hotter, drier air absorbs HF much more
 *     aggressively — a 90 °F / 20 % RH outdoor stage shows ~3× the 4 kHz
 *     air loss of a 70 °F / 50 % RH sanctuary at the same distance.
 *
 *   • Reference voice (male / female) → IEC 60268-16 Annex A weighting
 *     coefficients for STI. Female speech has no 125 Hz content and
 *     differs in upper-band weighting; using the right reference makes
 *     STI predictions track perceived intelligibility for the actual
 *     speakers in the room.
 *
 * The card also previews the resulting per-band air-absorption coefficient
 * so the user sees what the temperature/humidity is actually doing to the
 * simulation rather than treating it as a black-box knob.
 */
function AtmosphereCard() {
  const room = useStore(s => s.room);
  const setRoom = useStore(s => s.setRoom);
  const tempF = room.temperatureF ?? 70;
  const rh = room.relHumidity ?? 50;
  const voice = room.voice ?? 'male';
  // Air-loss preview at common distances. Per-band, in dB. The ANSI formula
  // is per-meter; we show 30 ft (~9 m) which is a typical mid-room throw.
  const distFt = 30;
  const distM = distFt * 0.3048;
  const previewBands = [125, 1000, 4000] as const;
  return (
    <div className="inspector-card">
      <h4 style={{ marginBottom: 8 }}>Atmosphere &amp; reference voice</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 50px', gap: 8, alignItems: 'center', padding: '2px 0' }}>
        <label style={{ fontSize: 11.5, color: 'var(--fg2)' }}>Temperature</label>
        <input
          type="range" min={32} max={110} step={1}
          value={tempF}
          onChange={e => setRoom({ temperatureF: parseFloat(e.target.value) })}
          style={{ width: '100%' }}
        />
        <span className="tabular" style={{ fontSize: 11, textAlign: 'right' }}>{tempF}°F</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 50px', gap: 8, alignItems: 'center', padding: '2px 0' }}>
        <label style={{ fontSize: 11.5, color: 'var(--fg2)' }}>Humidity</label>
        <input
          type="range" min={5} max={95} step={1}
          value={rh}
          onChange={e => setRoom({ relHumidity: parseFloat(e.target.value) })}
          style={{ width: '100%' }}
        />
        <span className="tabular" style={{ fontSize: 11, textAlign: 'right' }}>{rh}%</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, alignItems: 'center', padding: '2px 0' }}>
        <label style={{ fontSize: 11.5, color: 'var(--fg2)' }} title="Reference voice for IEC 60268-16 STI weighting. Affects the band weights used to compute STI from per-band Modulation Transfer.">
          Reference voice
        </label>
        <div className="freq-bands" style={{ display: 'flex', gap: 4 }}>
          {(['male', 'female'] as const).map(v => (
            <button
              key={v}
              className={voice === v ? 'on' : ''}
              onClick={() => setRoom({ voice: v })}
              style={{ flex: 1, fontSize: 11, textTransform: 'capitalize' }}
              title={
                v === 'male'
                  ? 'Male voice — uses 125 Hz–8 kHz weighting per IEC Annex A.'
                  : 'Female voice — excludes 125 Hz (no female speech content there); shifts weight to upper bands.'
              }
            >{v}</button>
          ))}
        </div>
      </div>
      <div style={{
        marginTop: 10, padding: '6px 8px', background: 'rgba(0,0,0,.04)',
        borderRadius: 4, fontSize: 11, color: 'var(--fg2)',
      }}>
        Air loss at {distFt} ft (
        {previewBands.map((b, i) => {
          const db = airAbsorptionDbPerM(b, tempF, rh) * distM;
          return (
            <span key={b}>
              {i > 0 ? ' · ' : ''}
              <strong className="tabular" style={{ color: 'var(--fg1)' }}>
                {b >= 1000 ? `${b / 1000}k` : b}: {db.toFixed(1)}
              </strong> dB
            </span>
          );
        })})
        <div style={{ fontSize: 10.5, marginTop: 3, color: 'var(--fg3)' }}>
          ANSI S1.26 / ISO 9613-1 — applied per band along every direct + reflection leg.
        </div>
      </div>
    </div>
  );
}

/**
 * Sprint C12 — interior wall obstacles. UI to manage balcony fronts,
 * stage-riser fronts, half-walls, and similar vertical-rectangle features
 * that aren't part of the room's outer perimeter.
 *
 * The most common workflow: draw a balcony zone with elevation (C11) →
 * one click here generates the matching front automatically. The obstacle
 * tracks the zone (auto-removes if the zone is deleted).
 */
function WallObstaclesCard() {
  const obstacles = useStore(s => s.room.wallObstacles ?? []);
  const zones = useStore(s => s.zones);
  const deleteWallObstacle = useStore(s => s.deleteWallObstacle);
  const updateWallObstacle = useStore(s => s.updateWallObstacle);
  const autoBalconyFront = useStore(s => s.autoBalconyFront);
  const addWallObstacle = useStore(s => s.addWallObstacle);
  const balconyZones = zones.filter(z => (z.floorHeightFt ?? 0) > 0);
  const haveBalconies = balconyZones.length > 0;

  return (
    <div className="inspector-card">
      <h4 style={{ marginBottom: 8 }}>Wall obstacles</h4>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>
        Interior vertical rectangles that aren't part of the room perimeter —
        balcony fronts, stage-riser fronts, half-walls. Reflect both faces and
        block direct sound (Maekawa diffraction) for shadow zones.
      </div>

      {haveBalconies && (
        <div style={{ marginBottom: 10 }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
            Auto-generate from elevated zone:
          </div>
          {balconyZones.map(z => {
            const exists = obstacles.some(o => o.derivedFromZoneId === z.id);
            return (
              <button
                key={z.id}
                className="btn btn-ghost btn-sm"
                style={{ width: '100%', justifyContent: 'space-between', marginBottom: 4 }}
                onClick={() => autoBalconyFront(z.id)}
                title={exists
                  ? `Refresh ${z.name} front to match the current zone polygon (e.g. after editing).`
                  : `Generate a balcony front along ${z.name}'s edge nearest the room centroid.`}
              >
                <span>
                  {exists ? '↻ Refresh' : '+'} {z.name} front
                </span>
                <span style={{ fontSize: 10, color: 'var(--fg3)' }}>
                  ↑{(z.floorHeightFt ?? 0).toFixed(1)} ft
                </span>
              </button>
            );
          })}
        </div>
      )}

      <button
        className="btn btn-ghost btn-sm"
        style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }}
        onClick={() => {
          // Default new-obstacle: a 10 ft segment in the middle of the room.
          // User can edit endpoints / heights afterward.
          const id = `wall-obstacle-${Date.now().toString(36)}`;
          addWallObstacle({
            id,
            start: { x: 10, y: 10 },
            end: { x: 20, y: 10 },
            bottomZ: 0,
            topZ: 8,
            materialId: 'drywall',
            label: 'Half wall',
            derivedFromZoneId: null,
          });
        }}
      >
        + Add custom obstacle
      </button>

      {obstacles.length === 0 ? (
        <div className="muted" style={{ fontSize: 11.5, textAlign: 'center', padding: 6 }}>
          No wall obstacles yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {obstacles.map(w => {
            const dx = w.end.x - w.start.x;
            const dy = w.end.y - w.start.y;
            const len = Math.hypot(dx, dy);
            return (
              <div key={w.id} style={{
                padding: 8, border: '1px solid var(--border)', borderRadius: 4,
                background: 'rgba(0,0,0,.02)',
              }}>
                <div className="row between" style={{ marginBottom: 6 }}>
                  <input
                    type="text"
                    value={w.label ?? ''}
                    onChange={e => updateWallObstacle(w.id, { label: e.target.value || undefined })}
                    placeholder="Wall obstacle"
                    style={{
                      flex: 1, marginRight: 6,
                      background: 'transparent', border: 0,
                      fontSize: 12, fontWeight: 600, color: 'var(--fg1)',
                    }}
                  />
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 8px' }}
                    onClick={() => deleteWallObstacle(w.id)}
                    title="Delete this obstacle"
                  >×</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
                  <div className="muted">Length</div>
                  <div className="tabular" style={{ textAlign: 'right' }}>{len.toFixed(1)} ft</div>
                  <div className="muted">Bottom</div>
                  <input
                    type="number" min={0} max={40} step={0.5}
                    value={w.bottomZ}
                    onChange={e => updateWallObstacle(w.id, { bottomZ: parseFloat(e.target.value) || 0 })}
                    className="num-input tabular"
                    style={{ width: '100%' }}
                  />
                  <div className="muted">Top</div>
                  <input
                    type="number" min={0.5} max={50} step={0.5}
                    value={w.topZ}
                    onChange={e => updateWallObstacle(w.id, { topZ: parseFloat(e.target.value) || 0 })}
                    className="num-input tabular"
                    style={{ width: '100%' }}
                  />
                  <div className="muted">Material</div>
                  <select
                    value={w.materialId}
                    onChange={e => updateWallObstacle(w.id, { materialId: e.target.value })}
                    style={{ fontSize: 11, padding: '2px 4px' }}
                  >
                    {MATERIALS.filter(m => m.category === 'wall' || m.category === 'panel').map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                {w.derivedFromZoneId && (
                  <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
                    Auto-generated from zone — refresh from the button above after editing the zone.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AcousticsPanel() {
  const rt60 = useStore(s => s.rt60);
  const heatmap = useStore(s => s.heatmap);
  const clarity = useStore(s => s.clarityHeatmap);
  const sti = useStore(s => s.sti);
  const stiRating = useStore(s => s.stiRating);
  const recommendations = useStore(s => s.recommendations);
  const noiseFloor = useStore(s => s.noiseFloor);
  const setNoiseFloor = useStore(s => s.setNoiseFloor);
  const compliance = useStore(s => s.compliance);

  const checks = evaluateCompliance(compliance, rt60, sti, heatmap, clarity);

  const bands = rt60 ? Object.entries(rt60.byBand).sort((a,b) => Number(a[0]) - Number(b[0])) : [];
  const maxRT = rt60 ? Math.max(...Object.values(rt60.byBand)) : 2.5;

  return (
    <div>
      <AtmosphereCard />
      <WallObstaclesCard />
      <ComplianceCard checks={checks}/>
      <div className="inspector-card">
        <h4 style={{ marginBottom: 8 }}>Reverb time (RT60) by octave band</h4>
        {rt60 ? (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 110 }}>
              {bands.map(([hz, val]) => (
                <div key={hz} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%' }}>
                    <div style={{
                      flex: 1,
                      background: val < 1.0 ? '#2F9E5E' : val < 1.5 ? '#F5A623' : '#C53030',
                      height: `${Math.min(100, (val / Math.max(maxRT, 2.5)) * 100)}%`,
                      borderRadius: '2px 2px 0 0',
                    }}/>
                  </div>
                  <span style={{ fontSize: 9.5, color: 'var(--fg3)', fontFamily: 'Montserrat', fontWeight: 600 }}>
                    {Number(hz) >= 1000 ? `${Number(hz)/1000}kHz` : `${hz}Hz`}
                  </span>
                  <span className="tabular" style={{ fontSize: 10, color: 'var(--fg2)' }}>{val.toFixed(2)}s</span>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10, gap: 14 }}>
              <span className="row" style={{ gap: 6, fontSize: 11.5, color: 'var(--fg2)' }}>
                <span style={{ width: 10, height: 10, background: '#2F9E5E', borderRadius: 2 }}/> {'< 1.0s'}
              </span>
              <span className="row" style={{ gap: 6, fontSize: 11.5, color: 'var(--fg2)' }}>
                <span style={{ width: 10, height: 10, background: '#F5A623', borderRadius: 2 }}/> 1.0–1.5s
              </span>
              <span className="row" style={{ gap: 6, fontSize: 11.5, color: 'var(--fg2)' }}>
                <span style={{ width: 10, height: 10, background: '#C53030', borderRadius: 2 }}/> {'>'} 1.5s
              </span>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--fg2)' }}>
              {rt60.average >= 90 ? (
                <span>Outdoor / unenclosed — no reverberant field to measure.</span>
              ) : (
                <>
                  Average <strong className="tabular" style={{ color: 'var(--fg1)' }}>{rt60.average.toFixed(2)}s</strong>
                  {' · '}<span className={
                    rt60.rating === 'Excellent' || rt60.rating === 'Good' ? 'royal-text'
                      : rt60.rating === 'Moderate' ? 'amber-text' : 'amber-text'
                  }><strong>{rt60.rating}</strong></span>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>Run simulation to compute RT60.</div>
        )}
      </div>

      <DecayTimesCard />
      <SpatialImpressionCard />
      <LowFrequencyModesCard />

      <div className="inspector-card">
        <h4 style={{ marginBottom: 8 }}>Speech intelligibility (STI)</h4>
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <strong style={{ fontFamily: 'Montserrat', fontSize: 26 }} className="tabular">
            {sti != null ? sti.toFixed(2) : '—'}
          </strong>
          <span className="muted" style={{ fontSize: 12 }}>
            {stiRating || 'Not computed'} · target ≥ 0.60
          </span>
        </div>
        <div style={{ height: 6, background: 'var(--bg-alt)', borderRadius: 3, marginTop: 8, overflow: 'hidden', position: 'relative' }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: sti != null ? `${Math.round(sti * 100)}%` : '0%',
            background: sti != null && sti >= 0.6 ? '#2F9E5E' : sti != null && sti >= 0.45 ? '#F5A623' : '#C53030',
            transition: 'all .3s var(--ease)',
          }}/>
          <div style={{ position: 'absolute', left: '60%', top: -3, bottom: -3, width: 1, background: 'var(--royal-blue)' }}/>
        </div>
        <div className="row between" style={{ fontSize: 10.5, color: 'var(--fg3)', marginTop: 2 }}>
          <span>Bad</span><span>Poor</span><span>Fair</span><span>Good</span><span>Excellent</span>
        </div>
        <div className="slider-row" style={{ marginTop: 8 }}>
          <label>Noise floor</label>
          <input type="range" min="20" max="60" step="1" value={noiseFloor} onChange={e => setNoiseFloor(parseInt(e.target.value, 10))}/>
          <span className="val">{noiseFloor} dB</span>
        </div>
      </div>

      <div className="inspector-card">
        <h4 style={{ marginBottom: 8 }}>Coverage uniformity</h4>
        <div className="field-row"><label>Avg SPL</label><div className="tabular">{heatmap ? heatmap.avg.toFixed(1) : '—'} dB</div></div>
        <div className="field-row"><label>Min SPL</label><div className="tabular">{heatmap ? heatmap.min.toFixed(1) : '—'} dB</div></div>
        <div className="field-row"><label>Max SPL</label><div className="tabular">{heatmap ? heatmap.max.toFixed(1) : '—'} dB</div></div>
        <div className="field-row"><label>±dB (1σ)</label><div className="tabular royal-text"><strong>±{heatmap ? heatmap.std.toFixed(1) : '—'}</strong></div></div>
      </div>

      <div className="inspector-card">
        <h4 style={{ marginBottom: 8 }}>Recommendations</h4>
        {recommendations.length === 0 && (
          <div className="muted" style={{ fontSize: 12 }}>No active recommendations — looking good.</div>
        )}
        <div className="recommendations-list">
          {recommendations.map(r => (
            <div key={r.id} className={`rec-item ${r.severity}`}>
              <div className="rec-icon">
                <Icon name={r.severity === 'warn' ? 'alert' : r.severity === 'ok' ? 'check' : 'info'} size={14}/>
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 2 }}>{r.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--fg2)' }}>{r.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NotesPanel() {
  const meta = useStore(s => s.meta);
  const setMeta = useStore(s => s.setMeta);
  return (
    <div>
      <div className="inspector-card">
        <h4 style={{ marginBottom: 6 }}>Design notes</h4>
        <div className="card-sub" style={{ marginBottom: 8 }}>For {meta.consultantName} · saved with the project</div>
        <textarea
          value={meta.notes ?? ''}
          onChange={e => setMeta({ notes: e.target.value })}
          placeholder={`• Confirm projector throw distance with client\n• Verify rigging points for line array\n• Check fire code: panels must be Class A`}
          style={{
            width: '100%', minHeight: 140, resize: 'vertical',
            border: '1px solid var(--border)', borderRadius: 8, padding: 10,
            fontFamily: 'Open Sans', fontSize: 13, color: 'var(--fg1)',
            background: 'var(--bg-alt)', outline: 'none', lineHeight: 1.5,
          }}/>
      </div>

      <div className="inspector-card">
        <h4 style={{ marginBottom: 6 }}>Activity</h4>
        <div className="col" style={{ gap: 10 }}>
          {[
            ['Leo', 'opened project', 'now'],
            ['System', 'engine ready', 'now'],
            ['System', 'auto-saved', '2m ago'],
          ].map(([who, what, when], i) => (
            <div key={i} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%',
                background: who === 'System' ? 'var(--bg-alt)' : 'var(--royal-blue)',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'Montserrat', fontSize: 11, fontWeight: 700, flexShrink: 0,
              }}>{who === 'System' ? <Icon name="bell" size={12}/> : who[0]}</div>
              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                <div><strong>{who}</strong> <span className="muted">{what}</span></div>
                <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>{when}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function kindLabel(k: string): string {
  return k.replace('speaker-', '').replace(/-/g, ' ');
}

function SpeakerGroupAssign({ item }: { item: EquipmentItem }) {
  const groups = useStore(s => s.groups);
  const setItemGroup = useStore(s => s.setItemGroup);
  const addGroup = useStore(s => s.addGroup);
  const palette = ['#1A4FBF', '#F5A623', '#2F9E5E', '#A855F7', '#06B6D4', '#F97316'];
  const onCreate = () => {
    const id = addGroup(`Group ${groups.length + 1}`, palette[groups.length % palette.length]);
    setItemGroup(item.id, id);
  };
  const current = groups.find(g => g.id === item.groupId);
  return (
    <div className="inspector-card">
      <h4 style={{ marginBottom: 8 }}>Group</h4>
      <div className="row" style={{ gap: 6 }}>
        <select className="text-input" style={{ flex: 1 }}
          value={item.groupId ?? ''}
          onChange={e => setItemGroup(item.id, e.target.value || undefined)}>
          <option value="">— Ungrouped —</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={onCreate}>
          <Icon name="plus" size={12}/> New
        </button>
      </div>
      {current && (
        <div style={{
          marginTop: 8, padding: '6px 10px',
          borderLeft: `3px solid ${current.color}`,
          background: 'var(--bg-alt)', borderRadius: 4,
          fontSize: 12, color: 'var(--fg2)',
        }}>
          Inherits <strong style={{ color: 'var(--fg1)' }}>{current.gainDb.toFixed(1)} dB</strong> gain ·
          <strong style={{ color: 'var(--fg1)' }}> {current.delayMs.toFixed(1)} ms</strong> delay from <em>{current.name}</em>.
        </div>
      )}
    </div>
  );
}

function GroupsCard() {
  const groups = useStore(s => s.groups);
  const updateGroup = useStore(s => s.updateGroup);
  const deleteGroup = useStore(s => s.deleteGroup);
  const addGroup = useStore(s => s.addGroup);
  const equipment = useStore(s => s.equipment);
  const palette = ['#1A4FBF', '#F5A623', '#2F9E5E', '#A855F7', '#06B6D4', '#F97316'];

  return (
    <Section sectionKey="groups" title="Speaker groups" icon="link"
      badge={groups.length > 0 ? <span className="pill-mini">{groups.length}</span> : null}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>Shared delay & gain.</span>
        <button className="btn btn-secondary btn-sm"
          onClick={() => addGroup(`Group ${groups.length + 1}`, palette[groups.length % palette.length])}>
          <Icon name="plus" size={12}/> Add
        </button>
      </div>
      {groups.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>
          Create groups (Mains L/R, Sub Array, Delay Ring) to apply shared delay and gain to multiple speakers.
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {groups.map(g => {
            const memberCount = equipment.filter(e => e.groupId === g.id).length;
            return (
              <div key={g.id} style={{
                border: '1px solid var(--border)',
                borderLeft: `4px solid ${g.color}`,
                borderRadius: 'var(--radius-md)',
                padding: '8px 10px',
                background: 'var(--bg-alt)',
              }}>
                <div className="row between" style={{ marginBottom: 6 }}>
                  <input className="text-input" value={g.name}
                    onChange={e => updateGroup(g.id, { name: e.target.value })}
                    style={{ background: 'transparent', border: 0, padding: 0, fontWeight: 600, fontSize: 13 }}/>
                  <div className="row" style={{ gap: 4 }}>
                    <input type="color" value={g.color}
                      onChange={e => updateGroup(g.id, { color: e.target.value })}
                      style={{ width: 22, height: 22, border: 0, padding: 0, background: 'transparent', cursor: 'pointer' }}/>
                    <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => deleteGroup(g.id)}>
                      <Icon name="trash" size={12}/>
                    </button>
                  </div>
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
                  {memberCount} {memberCount === 1 ? 'member' : 'members'}
                </div>

                <div className="slider-row" style={{ gridTemplateColumns: '70px 1fr 50px' }}>
                  <label>Gain</label>
                  <input type="range" min="-30" max="6" step="0.5" value={g.gainDb}
                    onChange={e => updateGroup(g.id, { gainDb: parseFloat(e.target.value) })}/>
                  <span className="val">{g.gainDb.toFixed(1)} dB</span>
                </div>
                <div className="slider-row" style={{ gridTemplateColumns: '70px 1fr 50px' }}>
                  <label>Delay</label>
                  <input type="range" min="0" max="200" step="0.5" value={g.delayMs}
                    onChange={e => updateGroup(g.id, { delayMs: parseFloat(e.target.value) })}/>
                  <span className="val">{g.delayMs.toFixed(1)} ms</span>
                </div>
                <div className="slider-row" style={{ gridTemplateColumns: '70px 1fr 50px' }}>
                  <label>HPF</label>
                  <input type="range" min="20" max="500" step="5" value={g.hpf}
                    onChange={e => updateGroup(g.id, { hpf: parseInt(e.target.value, 10) })}/>
                  <span className="val">{g.hpf} Hz</span>
                </div>
                <div className="slider-row" style={{ gridTemplateColumns: '70px 1fr 50px' }}>
                  <label>LPF</label>
                  <input type="range" min="80" max="20000" step="50" value={g.lpf}
                    onChange={e => updateGroup(g.id, { lpf: parseInt(e.target.value, 10) })}/>
                  <span className="val">{g.lpf} Hz</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function ComplianceCard({ checks }: { checks: ComplianceCheck[] }) {
  const compliance = useStore(s => s.compliance);
  const setComplianceTarget = useStore(s => s.setComplianceTarget);
  const resetComplianceTargets = useStore(s => s.resetComplianceTargets);
  const room = useStore(s => s.room);
  const [showTargets, setShowTargets] = useState(false);

  const valid = checks.filter(c => c.verdict !== 'na');
  const passing = valid.filter(c => c.verdict === 'pass').length;
  const failing = valid.filter(c => c.verdict === 'fail').length;
  const allPass = valid.length > 0 && passing === valid.length;

  return (
    <div className="inspector-card" style={{
      borderLeft: `4px solid ${allPass ? 'var(--success)' : failing > 0 ? 'var(--danger)' : 'var(--amber-gold)'}`,
    }}>
      <div className="row between" style={{ alignItems: 'center', marginBottom: 6 }}>
        <h4 style={{ margin: 0 }}>Compliance</h4>
        <div className="row" style={{ gap: 6 }}>
          <span style={{
            fontFamily: 'Montserrat', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.10em',
            textTransform: 'uppercase',
            padding: '3px 9px', borderRadius: 999,
            background: allPass ? 'rgba(47,158,94,.18)' : failing > 0 ? 'rgba(197,48,48,.18)' : 'rgba(245,166,35,.18)',
            color: allPass ? '#1E7A45' : failing > 0 ? '#A52A2A' : '#B57600',
          }}>
            {valid.length === 0 ? 'No data' : `${passing} of ${valid.length} pass`}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowTargets(v => !v)} title="Edit targets">
            <Icon name={showTargets ? 'chevU' : 'chevD'} size={12}/>
          </button>
        </div>
      </div>

      <div className="card-sub" style={{ fontSize: 11.5, marginBottom: 8 }}>
        {room.roomType.charAt(0).toUpperCase() + room.roomType.slice(1)} defaults · target thresholds editable per project.
      </div>

      <div className="col" style={{ gap: 4 }}>
        {checks.map(c => (
          <div key={c.key} style={{
            display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8,
            alignItems: 'center', padding: '6px 8px',
            background: 'var(--bg-alt)', borderRadius: 6,
            fontSize: 12.5,
          }}>
            <span style={{ fontWeight: 500 }}>{c.label}</span>
            <span className="tabular muted" style={{ fontSize: 11.5 }}>{c.targetLabel}</span>
            <span className="tabular" style={{ fontWeight: 600, minWidth: 60, textAlign: 'right' }}>{c.currentLabel}</span>
            <VerdictBadge v={c.verdict}/>
          </div>
        ))}
      </div>

      {showTargets && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <strong style={{ fontSize: 12, fontFamily: 'Montserrat', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Targets</strong>
            <button className="btn btn-ghost btn-sm" onClick={resetComplianceTargets}>
              <Icon name="refresh" size={12}/> Reset to defaults
            </button>
          </div>

          <TargetRow label="RT60 min (s)" value={compliance.rt60Min} step={0.05} min={0} max={3}
            onChange={v => setComplianceTarget('rt60Min', v)}/>
          <TargetRow label="RT60 max (s)" value={compliance.rt60Max} step={0.05} min={0} max={3}
            onChange={v => setComplianceTarget('rt60Max', v)}/>
          <TargetRow label="STI min" value={compliance.stiMin} step={0.05} min={0.30} max={1}
            onChange={v => setComplianceTarget('stiMin', v)}/>
          <TargetRow label="±σ max (dB)" value={compliance.coverageStdMax} step={0.5} min={2} max={12}
            onChange={v => setComplianceTarget('coverageStdMax', v)}/>
          <TargetRow label="Avg SPL min (dB)" value={compliance.splMin} step={1} min={70} max={105}
            onChange={v => setComplianceTarget('splMin', v)}/>
          <TargetRow label="C50 min (dB)" value={compliance.c50Min} step={1} min={-10} max={15}
            onChange={v => setComplianceTarget('c50Min', v)}/>
        </div>
      )}
    </div>
  );
}

function VerdictBadge({ v }: { v: 'pass' | 'fail' | 'warn' | 'na' }) {
  if (v === 'na') return <span className="muted" style={{ fontSize: 10.5 }}>—</span>;
  const config = {
    pass: { bg: 'rgba(47,158,94,.18)',  fg: '#1E7A45', label: 'Pass', icon: 'check' },
    warn: { bg: 'rgba(245,166,35,.18)', fg: '#B57600', label: 'Warn', icon: 'alert' },
    fail: { bg: 'rgba(197,48,48,.18)',  fg: '#A52A2A', label: 'Fail', icon: 'x' },
  }[v];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontFamily: 'Montserrat', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.10em',
      textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 999,
      background: config.bg, color: config.fg, minWidth: 56, justifyContent: 'center',
    }}>
      <Icon name={config.icon} size={10}/>{config.label}
    </span>
  );
}

function TargetRow({ label, value, step, min, max, onChange }: {
  label: string; value: number; step: number; min: number; max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '130px 1fr 70px',
      gap: 10, alignItems: 'center', padding: '4px 0',
      fontSize: 12,
    }}>
      <label style={{ color: 'var(--fg2)' }}>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}/>
      <input className="num-input tabular" type="number" min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: 70 }}/>
    </div>
  );
}

function FloorPlanCard() {
  const room = useStore(s => s.room);
  const setRoom = useStore(s => s.setRoom);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(f.type)) {
      useStore.getState().setHint('⚠ Floor plan must be a PNG, JPG, WEBP, or GIF.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Pre-load to read pixel dimensions, then default the displayed size to the room bounding box.
      const img = new Image();
      img.onload = () => {
        // Default: stretch to room width, preserve aspect
        const widthFt = room.width;
        const heightFt = (img.height / Math.max(1, img.width)) * widthFt;
        setRoom({
          floorPlan: {
            dataUrl,
            widthFt, heightFt,
            offsetX: 0, offsetY: 0,
            opacity: 0.6, rotation: 0,
          },
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  };

  const fp = room.floorPlan;
  return (
    <Section sectionKey="floorplan" title="Floor plan" icon="folderOpen"
      badge={fp ? <span className="pill-mini">imported</span> : null}>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile}/>
      {!fp ? (
        <>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Drop in a PNG / JPG of the architect's plan; trace your room and equipment over it.
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.click()}>
            <Icon name="upload" size={12}/> Import floor plan
          </button>
        </>
      ) : (
        <>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Calibrate so a known dimension on the plan matches its real-world length.
          </div>
          <div className="field-row"><label>Width (ft)</label>
            <input className="num-input tabular" type="number" step="0.5" value={fp.widthFt.toFixed(1)}
              onChange={e => setRoom({ floorPlan: { ...fp, widthFt: parseFloat(e.target.value) || fp.widthFt } })}/>
          </div>
          <div className="field-row"><label>Height (ft)</label>
            <input className="num-input tabular" type="number" step="0.5" value={fp.heightFt.toFixed(1)}
              onChange={e => setRoom({ floorPlan: { ...fp, heightFt: parseFloat(e.target.value) || fp.heightFt } })}/>
          </div>
          <div className="field-row"><label>Offset X</label>
            <input className="num-input tabular" type="number" step="0.5" value={fp.offsetX.toFixed(1)}
              onChange={e => setRoom({ floorPlan: { ...fp, offsetX: parseFloat(e.target.value) || 0 } })}/>
          </div>
          <div className="field-row"><label>Offset Y</label>
            <input className="num-input tabular" type="number" step="0.5" value={fp.offsetY.toFixed(1)}
              onChange={e => setRoom({ floorPlan: { ...fp, offsetY: parseFloat(e.target.value) || 0 } })}/>
          </div>
          <div className="slider-row">
            <label>Opacity</label>
            <input type="range" min="0.1" max="1" step="0.05" value={fp.opacity}
              onChange={e => setRoom({ floorPlan: { ...fp, opacity: parseFloat(e.target.value) } })}/>
            <span className="val">{Math.round(fp.opacity * 100)}%</span>
          </div>
          <div className="slider-row">
            <label>Rotation</label>
            <input type="range" min="-180" max="180" step="1" value={fp.rotation}
              onChange={e => setRoom({ floorPlan: { ...fp, rotation: parseInt(e.target.value, 10) } })}/>
            <span className="val">{fp.rotation}°</span>
          </div>
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => inputRef.current?.click()}>
              <Icon name="upload" size={12}/> Replace
            </button>
            <button className="btn btn-ghost btn-sm" style={{ color: '#A52A2A' }}
              onClick={() => setRoom({ floorPlan: undefined })}>
              <Icon name="trash" size={12}/> Remove
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

function ScenariosCard() {
  const scenarios = useStore(s => s.scenarios);
  const activeScenarioId = useStore(s => s.activeScenarioId);
  const saveAsScenario = useStore(s => s.saveAsScenario);
  const switchScenario = useStore(s => s.switchScenario);
  const updateActiveScenario = useStore(s => s.updateActiveScenario);
  const duplicateScenario = useStore(s => s.duplicateScenario);
  const deleteScenario = useStore(s => s.deleteScenario);
  const renameScenario = useStore(s => s.renameScenario);
  const compareScenarioId = useStore(s => s.compareScenarioId);
  const setCompareScenarioId = useStore(s => s.setCompareScenarioId);

  const onSaveNew = () => {
    const n = scenarios.length + 1;
    saveAsScenario(`Layout ${String.fromCharCode(64 + n)}`); // A, B, C…
  };

  return (
    <Section sectionKey="scenarios" title="Scenarios" icon="copy"
      badge={scenarios.length > 0 ? <span className="pill-mini">{scenarios.length}</span> : null}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>Save layouts to compare.</span>
        <div className="row" style={{ gap: 4 }}>
          {activeScenarioId && (
            <button className="btn btn-ghost btn-sm" title="Save current state into the active scenario"
              onClick={updateActiveScenario}>
              <Icon name="save" size={12}/> Update
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={onSaveNew}>
            <Icon name="plus" size={12}/> Save as new
          </button>
        </div>
      </div>
      {compareScenarioId && (
        <div className="row between" style={{
          marginBottom: 8, padding: '6px 10px', borderRadius: 'var(--radius-md)',
          background: 'rgba(245,166,35,0.10)', border: '1px solid rgba(245,166,35,0.4)',
        }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            Comparing: <span style={{ color: 'var(--royal-blue)' }}>
              {scenarios.find(sc => sc.id === activeScenarioId)?.name ?? 'Live'}
            </span>
            {' vs '}
            <span style={{ color: '#A36904' }}>
              {scenarios.find(sc => sc.id === compareScenarioId)?.name ?? '—'}
            </span>
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setCompareScenarioId(null)}>
            Stop
          </button>
        </div>
      )}
      {scenarios.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>
          Save your current room + equipment as a scenario, then build alternates and switch between them
          ("Layout A — line array", "Layout B — point sources").
        </div>
      ) : (
        <div className="col" style={{ gap: 6 }}>
          {scenarios.map(sc => (
            <div key={sc.id} style={{
              border: `1px solid var(--border)`,
              borderLeft: `4px solid ${sc.id === activeScenarioId ? 'var(--royal-blue)' : 'transparent'}`,
              borderRadius: 'var(--radius-md)',
              padding: '6px 10px',
              background: sc.id === activeScenarioId ? 'rgba(26,79,191,.06)' : 'var(--bg-alt)',
            }}>
              <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                <input className="text-input" value={sc.name}
                  onChange={e => renameScenario(sc.id, e.target.value)}
                  style={{ background: 'transparent', border: 0, padding: 0, fontWeight: 600, fontSize: 13, flex: 1 }}/>
                {sc.id !== activeScenarioId && (
                  <button className="btn btn-ghost btn-sm" title="Switch to this scenario"
                    onClick={() => switchScenario(sc.id)}>
                    Switch
                  </button>
                )}
                {sc.id !== activeScenarioId && (
                  <button
                    className={`btn btn-sm ${compareScenarioId === sc.id ? 'btn-cta' : 'btn-ghost'}`}
                    title="Compare side-by-side with the active scenario"
                    onClick={() => setCompareScenarioId(compareScenarioId === sc.id ? null : sc.id)}>
                    {compareScenarioId === sc.id ? 'Comparing' : 'Compare'}
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" title="Duplicate"
                  onClick={() => duplicateScenario(sc.id)}>
                  <Icon name="copy" size={12}/>
                </button>
                <button className="btn btn-ghost btn-sm" title="Delete"
                  onClick={() => deleteScenario(sc.id)}>
                  <Icon name="trash" size={12}/>
                </button>
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {sc.snapshot.equipment.length} items · {sc.snapshot.zones.length} zones · {sc.snapshot.groups.length} groups
                {sc.id === activeScenarioId && <strong style={{ color: 'var(--royal-blue)', marginLeft: 6 }}>· active</strong>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Linear feet for a truss item, used by the inspector + BOM. */
function trussLinearFt(item: EquipmentItem): number {
  if (item.kind === 'truss-straight') return item.trussLengthFt ?? 10;
  if (item.kind === 'truss-square') {
    const w = item.trussWidthFt ?? 16, d = item.trussDepthFt ?? 16;
    return 2 * (w + d);
  }
  if (item.kind === 'truss-circle') {
    const dia = item.trussDiameterFt ?? 12;
    return Math.PI * dia;
  }
  return 0;
}

function isTrussKind(kind: string): boolean {
  return kind === 'truss-straight' || kind === 'truss-square' || kind === 'truss-circle';
}

/** Truss-only configuration — dimensions, hang height, items hung from it. */
function TrussInspectorCard({ item }: { item: EquipmentItem }) {
  const update = useStore(s => s.updateEquipment);
  const equipment = useStore(s => s.equipment);
  const setSelected = useStore(s => s.setSelected);
  const set = (patch: Partial<EquipmentItem>) => update(item.id, patch);
  const children = equipment.filter(e => e.parentId === item.id);
  const totalFt = trussLinearFt(item);

  return (
    <div className="inspector-card">
      <h4 style={{ marginBottom: 8 }}>Truss</h4>
      {item.kind === 'truss-straight' && (
        <div className="field-row"><label>Length</label>
          <input className="num-input tabular" type="number" step="0.5" min="2"
            value={(item.trussLengthFt ?? 10).toFixed(1)}
            onChange={e => set({ trussLengthFt: parseFloat(e.target.value) || 10 })}/>
        </div>
      )}
      {item.kind === 'truss-square' && (
        <>
          <div className="field-row"><label>Width</label>
            <input className="num-input tabular" type="number" step="0.5" min="2"
              value={(item.trussWidthFt ?? 16).toFixed(1)}
              onChange={e => set({ trussWidthFt: parseFloat(e.target.value) || 16 })}/>
          </div>
          <div className="field-row"><label>Depth</label>
            <input className="num-input tabular" type="number" step="0.5" min="2"
              value={(item.trussDepthFt ?? 16).toFixed(1)}
              onChange={e => set({ trussDepthFt: parseFloat(e.target.value) || 16 })}/>
          </div>
        </>
      )}
      {item.kind === 'truss-circle' && (
        <div className="field-row"><label>Diameter</label>
          <input className="num-input tabular" type="number" step="0.5" min="2"
            value={(item.trussDiameterFt ?? 12).toFixed(1)}
            onChange={e => set({ trussDiameterFt: parseFloat(e.target.value) || 12 })}/>
        </div>
      )}
      <div className="field-row"><label>Hang height</label>
        <input className="num-input tabular" type="number" step="0.5" min="0"
          value={item.z.toFixed(1)}
          onChange={e => set({ z: parseFloat(e.target.value) || item.z })}/>
      </div>
      <div className="field-row"><label>Linear feet</label>
        <div className="tabular">{totalFt.toFixed(1)} ft</div>
      </div>
      {children.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>
            {children.length} item{children.length === 1 ? '' : 's'} hung from this truss — they move with it.
          </div>
          <div className="col" style={{ gap: 3 }}>
            {children.map(ch => (
              <button key={ch.id}
                className="btn btn-ghost btn-sm"
                onClick={() => setSelected(ch.id)}
                style={{ justifyContent: 'flex-start', fontSize: 12, padding: '2px 6px' }}>
                {ch.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** "Hang from truss" picker — shown for non-truss equipment so it can be parented. */
function ParentTrussPicker({ item }: { item: EquipmentItem }) {
  const equipment = useStore(s => s.equipment);
  const update = useStore(s => s.updateEquipment);
  const trusses = equipment.filter(e => isTrussKind(e.kind));
  if (trusses.length === 0) return null;
  return (
    <div className="field-row">
      <label>Hung from</label>
      <select value={item.parentId ?? ''}
        onChange={e => update(item.id, { parentId: e.target.value || undefined })}>
        <option value="">— none —</option>
        {trusses.map(t => (
          <option key={t.id} value={t.id}>{t.label} (z {t.z.toFixed(1)} ft)</option>
        ))}
      </select>
    </div>
  );
}

/**
 * "Affects room acoustics" toggle + physical-size fields. When the toggle is
 * on, this item folds into the heatmap (line-of-sight blocking) and RT60
 * (Sabine surface area). Defaults to true for everything visible-and-physical;
 * non-physical kinds (reference points, IEMs, cables) default to off.
 */
function AcousticsContributionCard({ item }: { item: EquipmentItem }) {
  const update = useStore(s => s.updateEquipment);
  const set = (patch: Partial<EquipmentItem>) => update(item.id, patch);
  const w = item.width ?? 0;
  const d = item.depth ?? 0;
  const h = item.itemHeight ?? Math.max(0.5, item.z * 0.2 + 1);
  const NON_PHYSICAL = new Set(['reference-point', 'speaker-iem', 'cable-run']);
  const inferredOn = !NON_PHYSICAL.has(item.kind);
  const enabled = item.affectsAcoustics ?? inferredOn;
  return (
    <div className="inspector-card">
      <div className="row between" style={{ alignItems: 'baseline', marginBottom: 6 }}>
        <h4 style={{ margin: 0 }}>Room acoustics</h4>
        <label className="row" style={{ gap: 6, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox"
            checked={enabled}
            onChange={e => set({ affectsAcoustics: e.target.checked })}/>
          {enabled ? 'Folded into sim' : 'Ignored'}
        </label>
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
        When on, this item blocks line-of-sight (per-band diffraction loss) and contributes its
        exposed surface area to the Sabine reverb sum.
      </div>
      <div className="field-row"><label>Width</label>
        <input className="num-input tabular" type="number" step="0.1" min="0"
          value={w.toFixed(1)}
          onChange={e => set({ width: parseFloat(e.target.value) || 0 })}/>
        <span className="muted" style={{ fontSize: 11 }}>ft</span>
      </div>
      <div className="field-row"><label>Depth</label>
        <input className="num-input tabular" type="number" step="0.1" min="0"
          value={d.toFixed(1)}
          onChange={e => set({ depth: parseFloat(e.target.value) || 0 })}/>
        <span className="muted" style={{ fontSize: 11 }}>ft</span>
      </div>
      <div className="field-row"><label>Item height</label>
        <input className="num-input tabular" type="number" step="0.1" min="0"
          value={h.toFixed(1)}
          onChange={e => set({ itemHeight: parseFloat(e.target.value) || 0 })}/>
        <span className="muted" style={{ fontSize: 11 }}>ft</span>
      </div>
    </div>
  );
}

/**
 * Frequency response & crossover controls for speakers. Edits feed straight
 * into the heatmap engine, so changing a sub's HPF or a tower's LPF instantly
 * shifts SPL coverage at the active band.
 */
function FrequencyResponseCard({ item }: { item: EquipmentItem }) {
  const update = useStore(s => s.updateEquipment);
  const set = (patch: Partial<EquipmentItem>) => update(item.id, patch);
  const lf = item.lfHz ?? 0;
  const hf = item.hfHz ?? 20000;
  const xLow = item.xoverLowHz;
  const xHigh = item.xoverHighHz;

  const applyPreset = (kind: 'full' | 'sub' | 'mains-80' | 'mains-100' | 'mains-with-sub') => {
    if (kind === 'full')             set({ xoverLowHz: undefined, xoverHighHz: undefined });
    else if (kind === 'sub')         set({ xoverLowHz: undefined, xoverHighHz: 100 });
    else if (kind === 'mains-80')    set({ xoverLowHz: 80,  xoverHighHz: undefined });
    else if (kind === 'mains-100')   set({ xoverLowHz: 100, xoverHighHz: undefined });
    else if (kind === 'mains-with-sub') set({ xoverLowHz: 80, xoverHighHz: undefined });
  };

  return (
    <div className="inspector-card">
      <h4 style={{ marginBottom: 8 }}>Frequency response</h4>
      <div className="field-row"><label>Range LF</label>
        <input className="num-input tabular" type="number" step="5" min="0" max="500"
          value={lf}
          onChange={e => set({ lfHz: parseInt(e.target.value, 10) || 0 })}/>
        <span className="muted" style={{ fontSize: 11 }}>Hz</span>
      </div>
      <div className="field-row"><label>Range HF</label>
        <input className="num-input tabular" type="number" step="100" min="0" max="22000"
          value={hf}
          onChange={e => set({ hfHz: parseInt(e.target.value, 10) || 0 })}/>
        <span className="muted" style={{ fontSize: 11 }}>Hz</span>
      </div>
      <div style={{ height: 1, background: 'var(--border)', margin: '8px 0' }}/>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
        Crossover (external HPF / LPF applied at the amp or DSP)
      </div>
      <div className="field-row"><label>HPF (low cut)</label>
        <input className="num-input tabular" type="number" step="5" min="0" max="500"
          value={xLow ?? 0}
          onChange={e => {
            const v = parseInt(e.target.value, 10);
            set({ xoverLowHz: v > 0 ? v : undefined });
          }}/>
        <span className="muted" style={{ fontSize: 11 }}>{xLow ? 'Hz' : 'off'}</span>
      </div>
      <div className="field-row"><label>LPF (high cut)</label>
        <input className="num-input tabular" type="number" step="5" min="0" max="20000"
          value={xHigh ?? 0}
          onChange={e => {
            const v = parseInt(e.target.value, 10);
            set({ xoverHighHz: v > 0 ? v : undefined });
          }}/>
        <span className="muted" style={{ fontSize: 11 }}>{xHigh ? 'Hz' : 'off'}</span>
      </div>
      <div className="row" style={{ gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => applyPreset('full')}>Full range</button>
        <button className="btn btn-ghost btn-sm" onClick={() => applyPreset('sub')}>Sub (LPF&nbsp;100)</button>
        <button className="btn btn-ghost btn-sm" onClick={() => applyPreset('mains-80')}>Mains+sub (HPF&nbsp;80)</button>
        <button className="btn btn-ghost btn-sm" onClick={() => applyPreset('mains-100')}>Mains+sub (HPF&nbsp;100)</button>
      </div>
    </div>
  );
}

/**
 * Polar / directivity card. Shows the active polar dataset (bundled or
 * imported) and reports the per-band -6 dB beamwidth derived from the
 * stored curves — so designers can compare what the engine "thinks" the
 * pattern is at each frequency vs. the manufacturer's spec sheet.
 *
 * For now this is a read-only preview. File import + visual rosette plot
 * are deferred to a future sprint; this card establishes the surface area.
 */
function PolarResponseCard({ item }: { item: EquipmentItem }) {
  const update = useStore(s => s.updateEquipment);
  const polar = item.polar;
  if (item.kind === 'speaker-iem' || item.kind === 'speaker-sub' || item.kind === 'speaker-sub-flown') {
    // IEMs / subs use cardioid or omni — polar data doesn't apply.
    return null;
  }
  if (!polar) {
    return (
      <div className="inspector-card">
        <h4 style={{ marginBottom: 8 }}>Polar response</h4>
        <div className="muted" style={{ fontSize: 12 }}>
          No measured polar — using the elliptical {item.horiz ?? 90}° × {item.vert ?? 60}°
          fallback pattern with frequency-dependent broadening.
        </div>
      </div>
    );
  }
  // Extract -6 dB beamwidth per band from each curve.
  const beamwidthAt = (
    angles: number[] | undefined,
    curves: number[][] | undefined,
    bandIdx: number,
  ): number | null => {
    if (!angles || !curves || !curves[bandIdx]) return null;
    const row = curves[bandIdx];
    // Walk angles outward from 0 until we cross -6 dB.
    let prev = row[0];
    for (let i = 1; i < row.length; i++) {
      if (prev > -6 && row[i] <= -6) {
        // Linear interp for fractional angle
        const a0 = angles[i - 1], a1 = angles[i];
        const v0 = prev, v1 = row[i];
        const t = (-6 - v0) / (v1 - v0);
        const ang = a0 + (a1 - a0) * t;
        // For symmetric polars (angles >=0), total beamwidth is 2× this.
        return angles[0] >= 0 ? 2 * ang : ang;
      }
      prev = row[i];
    }
    return null;
  };
  return (
    <div className="inspector-card">
      <h4 style={{ marginBottom: 8 }}>Polar response</h4>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>{polar.label}</div>
      <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--fg2)' }}>
            <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 600 }}>Hz</th>
            <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 600 }}>−6 dB H</th>
            <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 600 }}>−6 dB V</th>
          </tr>
        </thead>
        <tbody>
          {polar.freqs.map((f, i) => {
            const bwH = beamwidthAt(polar.hAngles, polar.hPolar, i);
            const bwV = beamwidthAt(polar.vAngles, polar.vPolar, i);
            return (
              <tr key={f}>
                <td className="tabular" style={{ padding: '2px 4px' }}>
                  {f >= 1000 ? `${f / 1000}k` : f}
                </td>
                <td className="tabular" style={{ textAlign: 'right', padding: '2px 4px' }}>
                  {bwH != null ? `${bwH.toFixed(0)}°` : '—'}
                </td>
                <td className="tabular" style={{ textAlign: 'right', padding: '2px 4px' }}>
                  {bwV != null ? `${bwV.toFixed(0)}°` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        className="btn btn-ghost btn-sm"
        style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
        onClick={() => update(item.id, { polar: undefined })}
        title="Remove the polar dataset; the engine will fall back to the elliptical pattern."
      >
        Use elliptical pattern
      </button>
    </div>
  );
}

/** Per-item connections card — shown inside the inspector for a selected device. */
function ConnectionsCardForItem({ item }: { item: EquipmentItem }) {
  const connections = useStore(s => s.connections);
  const equipment = useStore(s => s.equipment);
  const addConnection = useStore(s => s.addConnection);
  const updateConnection = useStore(s => s.updateConnection);
  const deleteConnection = useStore(s => s.deleteConnection);
  const setWiringMode = useStore(s => s.setWiringMode);
  const setWiringStartId = useStore(s => s.setWiringStartId);
  const setWiringCableType = useStore(s => s.setWiringCableType);
  const setSelected = useStore(s => s.setSelected);
  const setHint = useStore(s => s.setHint);

  const myLinks = connections.filter(c => c.fromId === item.id || c.toId === item.id);

  const lengthOf = (cId: string) => {
    const c = connections.find(x => x.id === cId);
    if (!c) return 0;
    if (typeof c.lengthOverride === 'number') return c.lengthOverride;
    const a = equipment.find(e => e.id === c.fromId);
    const b = equipment.find(e => e.id === c.toId);
    if (!a || !b) return 0;
    return straightLineLengthFt(a, b);
  };

  return (
    <div className="inspector-card">
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <h4 style={{ marginBottom: 8 }}>Connections</h4>
        <span className="muted" style={{ fontSize: 11 }}>
          {myLinks.length} link{myLinks.length === 1 ? '' : 's'}
        </span>
      </div>

      {myLinks.length === 0 && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          No cables on this device yet.
        </div>
      )}

      <div className="col" style={{ gap: 6 }}>
        {myLinks.map(c => {
          const spec = CABLE_SPECS[c.cableType];
          const otherId = c.fromId === item.id ? c.toId : c.fromId;
          const dir = c.fromId === item.id ? '→' : '←';
          const other = equipment.find(e => e.id === otherId);
          const len = lengthOf(c.id);
          return (
            <div key={c.id} style={{
              border: `1px solid var(--border)`,
              borderLeft: `4px solid ${spec.color}`,
              borderRadius: 'var(--radius-md)',
              padding: '6px 10px',
              background: 'var(--bg-alt)',
            }}>
              <div className="row between" style={{ alignItems: 'baseline' }}>
                <strong style={{ fontSize: 12.5 }}>
                  <span style={{ color: spec.color }}>{spec.label}</span> {dir}{' '}
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '0 4px', fontSize: 12.5, fontWeight: 600 }}
                    onClick={() => other && setSelected(other.id)}>
                    {other?.label ?? '(missing)'}
                  </button>
                </strong>
                <button className="btn btn-ghost btn-sm" title="Remove cable"
                  style={{ padding: '0 6px' }}
                  onClick={() => deleteConnection(c.id)}>
                  <Icon name="trash" size={11}/>
                </button>
              </div>
              <div className="row" style={{ gap: 6, marginTop: 4, fontSize: 11.5 }}>
                <select value={c.cableType}
                  onChange={e => updateConnection(c.id, { cableType: e.target.value as CableType })}
                  style={{ fontSize: 11, padding: '1px 4px' }}>
                  {CABLE_TYPES.map(t => <option key={t} value={t}>{CABLE_SPECS[t].longLabel}</option>)}
                </select>
                <span className="tabular muted">
                  {len.toFixed(1)} ft{len > spec.maxLengthFt ? ' ⚠' : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <button className="btn btn-secondary btn-sm" style={{ flex: 1, justifyContent: 'center' }}
          onClick={() => {
            setWiringCableType(defaultCableForKind(item.kind));
            setWiringStartId(item.id);
            setWiringMode(true);
            setHint(`Click a destination to wire from ${item.label}`);
          }}>
          <Icon name="link" size={12}/> Wire from this
        </button>
        <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center' }}
          title="Quick-connect: pick a destination from the list"
          onClick={() => {
            const target = window.prompt(
              'Quick connect — type the label (or part of it) of the device to wire to',
              ''
            );
            if (!target) return;
            const q = target.toLowerCase();
            const dest = equipment.find(e => e.id !== item.id && e.label.toLowerCase().includes(q));
            if (!dest) { useStore.getState().setHint(`⚠ No device matched "${target}".`); return; }
            addConnection({
              fromId: item.id, toId: dest.id,
              cableType: defaultCableForKind(item.kind),
            });
            setHint(`Wired ${item.label} → ${dest.label}`);
          }}>
          Quick connect
        </button>
      </div>
    </div>
  );
}

function TrussesCard() {
  const equipment = useStore(s => s.equipment);
  const setSelected = useStore(s => s.setSelected);
  const trusses = equipment.filter(e => isTrussKind(e.kind));
  if (trusses.length === 0) {
    return (
      <Section sectionKey="trusses" title="Trusses" icon="link">
        <div className="muted" style={{ fontSize: 12 }}>
          Drop a truss from the catalog (Infra tab) to start hanging equipment from it.
        </div>
      </Section>
    );
  }
  const totalFt = trusses.reduce((s, t) => s + trussLinearFt(t), 0);
  const childCounts = trusses.map(t => ({
    truss: t,
    children: equipment.filter(e => e.parentId === t.id).length,
  }));

  return (
    <Section sectionKey="trusses" title="Trusses" icon="link"
      badge={<span className="pill-mini">{trusses.length}</span>}>
      <div className="col" style={{ gap: 5 }}>
        {childCounts.map(({ truss, children }) => (
          <div key={truss.id} className="row between" style={{
            border: `1px solid var(--border)`,
            borderLeft: `4px solid #9CA3AF`,
            borderRadius: 'var(--radius-md)',
            padding: '5px 9px',
            background: 'var(--bg-alt)',
            fontSize: 12,
            cursor: 'pointer',
          }}
          onClick={() => setSelected(truss.id)}>
            <span><strong>{truss.label}</strong>{' '}
              <span className="muted">·{' '}
                {truss.kind === 'truss-straight' ? 'straight' :
                 truss.kind === 'truss-square'   ? 'box' : 'circle'}{' · z '}
                {truss.z.toFixed(1)} ft
              </span>
            </span>
            <span className="tabular">
              <strong>{trussLinearFt(truss).toFixed(0)} ft</strong>
              <span className="muted" style={{ marginLeft: 6 }}>
                {children} item{children === 1 ? '' : 's'}
              </span>
            </span>
          </div>
        ))}
      </div>
      <div className="row between" style={{
        marginTop: 8, padding: '6px 10px',
        background: 'var(--bg-alt)', borderRadius: 'var(--radius-md)',
        fontFamily: 'Montserrat', fontWeight: 600, fontSize: 12.5,
      }}>
        <span>Total truss</span>
        <span className="tabular">{totalFt.toFixed(0)} ft</span>
      </div>
    </Section>
  );
}

function CablingCard() {
  const connections = useStore(s => s.connections);
  const equipment = useStore(s => s.equipment);
  const deleteConnection = useStore(s => s.deleteConnection);
  const setSelected = useStore(s => s.setSelected);

  // Aggregate length per cable type, with rough estimated cost.
  const summary = (() => {
    const totals: Record<string, { ft: number; count: number; warned: number; cost: number }> = {};
    for (const c of connections) {
      const a = equipment.find(e => e.id === c.fromId);
      const b = equipment.find(e => e.id === c.toId);
      const spec = CABLE_SPECS[c.cableType];
      if (!a || !b || !spec) continue;
      const ft = typeof c.lengthOverride === 'number' ? c.lengthOverride : straightLineLengthFt(a, b);
      const t = totals[c.cableType] ??= { ft: 0, count: 0, warned: 0, cost: 0 };
      t.ft += ft;
      t.count += 1;
      if (ft > spec.maxLengthFt) t.warned += 1;
      t.cost += ft * spec.costPerFt;
    }
    return totals;
  })();
  const usedTypes = Object.keys(summary).sort();
  const totalCost = usedTypes.reduce((s, k) => s + summary[k].cost, 0);
  const totalCount = connections.length;
  const totalWarned = usedTypes.reduce((s, k) => s + summary[k].warned, 0);

  return (
    <Section sectionKey="cabling" title="Cabling" icon="link"
      badge={totalCount > 0
        ? <span className="pill-mini">{totalCount}</span>
        : null}>
      {totalCount === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>
          No cables yet. Pick the wiring tool from the rail (link icon), choose a cable type, then click source → destination devices.
        </div>
      ) : (
        <>
          {totalWarned > 0 && (
            <div className="muted" style={{
              fontSize: 11.5, marginBottom: 6, color: '#A52A2A',
            }}>
              ⚠ {totalWarned} run{totalWarned === 1 ? '' : 's'} exceed{totalWarned === 1 ? 's' : ''} the recommended max length.
            </div>
          )}
          <div className="col" style={{ gap: 5 }}>
            {usedTypes.map(t => {
              const spec = CABLE_SPECS[t as CableType];
              const s = summary[t];
              return (
                <div key={t} className="row between" style={{
                  border: `1px solid var(--border)`,
                  borderLeft: `4px solid ${spec.color}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '5px 9px',
                  background: 'var(--bg-alt)',
                  fontSize: 12,
                }}>
                  <span><strong>{spec.label}</strong>{' '}
                    <span className="muted">· {spec.signalClass}</span></span>
                  <span className="tabular">
                    {s.count} run{s.count === 1 ? '' : 's'} ·{' '}
                    <strong>{s.ft.toFixed(0)} ft</strong>
                    <span className="muted" style={{ marginLeft: 6 }}>
                      ${s.cost.toFixed(0)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="row between" style={{
            marginTop: 8, padding: '6px 10px',
            background: 'var(--bg-alt)', borderRadius: 'var(--radius-md)',
            fontFamily: 'Montserrat', fontWeight: 600, fontSize: 12.5,
          }}>
            <span>Cabling subtotal</span>
            <span className="tabular">${totalCost.toFixed(0)}</span>
          </div>
          {/* Per-run list, click to select */}
          <details style={{ marginTop: 8 }}>
            <summary className="muted" style={{ fontSize: 11.5, cursor: 'pointer' }}>
              Show all {totalCount} run{totalCount === 1 ? '' : 's'}
            </summary>
            <div className="col" style={{ gap: 4, marginTop: 6 }}>
              {connections.map(c => {
                const a = equipment.find(e => e.id === c.fromId);
                const b = equipment.find(e => e.id === c.toId);
                const spec = CABLE_SPECS[c.cableType];
                if (!a || !b) return null;
                const ft = typeof c.lengthOverride === 'number' ? c.lengthOverride : straightLineLengthFt(a, b);
                return (
                  <div key={c.id} className="row between" style={{ fontSize: 11.5, padding: '2px 4px' }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: spec.color, fontWeight: 700 }}>{spec.label}</span>{' '}
                      <button className="btn btn-ghost btn-sm" style={{ padding: '0 4px' }}
                        onClick={() => setSelected(a.id)}>{a.label}</button>
                      <span className="muted">→</span>
                      <button className="btn btn-ghost btn-sm" style={{ padding: '0 4px' }}
                        onClick={() => setSelected(b.id)}>{b.label}</button>
                    </span>
                    <span className="tabular muted">
                      {ft.toFixed(0)} ft
                      <button className="btn btn-ghost btn-sm" style={{ marginLeft: 4, padding: '0 4px' }}
                        onClick={() => deleteConnection(c.id)} title="Remove cable">
                        <Icon name="trash" size={10}/>
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </details>
        </>
      )}
    </Section>
  );
}

function CircuitsCard() {
  const equipment = useStore(s => s.equipment);
  const setSelected = useStore(s => s.setSelected);
  const { circuits, totalWatts, totalAmps } = summarizeCircuits(equipment);
  const continuousLimit = BREAKER_AMPS * NEC_DUTY;
  const overloaded = circuits.filter(c => c.overloaded).length;

  return (
    <Section sectionKey="circuits" title="Power & circuits" icon="bolt"
      badge={overloaded > 0
        ? <span className="pill-mini" style={{ background: '#C53030', color: '#fff' }}>{overloaded} over</span>
        : circuits.length > 0
          ? <span className="pill-mini">{circuits.length}</span>
          : null}>
      {circuits.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>
          Place equipment and assign each item to a circuit (in its inspector) to see amp draws and overload warnings.
        </div>
      ) : (
        <>
          <div className="row between" style={{ marginBottom: 8, fontSize: 12 }}>
            <span className="muted">
              {BREAKER_AMPS}A breaker · 120V · NEC 80% continuous = {continuousLimit.toFixed(0)}A max
            </span>
          </div>
          <div className="col" style={{ gap: 6 }}>
            {circuits.map(c => {
              const pct = Math.min(c.pctOfBreaker, 1.5);
              const color = c.overloaded ? '#C53030' : c.warning ? '#F5A623' : '#2F9E5E';
              const isUnassigned = c.id === '__unassigned';
              return (
                <div key={c.id} style={{
                  border: `1px solid var(--border)`,
                  borderLeft: `4px solid ${color}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '6px 10px',
                  background: 'var(--bg-alt)',
                }}>
                  <div className="row between" style={{ alignItems: 'baseline' }}>
                    <strong style={{ fontSize: 13, fontStyle: isUnassigned ? 'italic' : 'normal',
                      color: isUnassigned ? 'var(--fg2)' : 'var(--fg1)' }}>
                      {c.name}
                    </strong>
                    <span className="tabular" style={{ fontSize: 12 }}>
                      <strong style={{ color }}>{c.amps.toFixed(2)} A</strong>
                      <span className="muted" style={{ marginLeft: 4 }}>· {c.watts.toFixed(0)} W</span>
                    </span>
                  </div>
                  <div style={{
                    height: 4, background: 'rgba(255,255,255,.06)', borderRadius: 2,
                    marginTop: 5, overflow: 'hidden', position: 'relative',
                  }}>
                    <div style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0,
                      width: `${Math.min(pct, 1) * 100}%`,
                      background: color, transition: 'width .15s ease',
                    }}/>
                    {/* 80% continuous-load tick */}
                    <div style={{
                      position: 'absolute', left: '100%', top: -2, bottom: -2,
                      width: 1, background: 'rgba(255,255,255,.3)',
                    }}/>
                  </div>
                  <div className="row between" style={{ marginTop: 4, fontSize: 11 }}>
                    <span className="muted">
                      {c.items.length} item{c.items.length === 1 ? '' : 's'}
                      {' · '}
                      {(c.pctOfBreaker * 100).toFixed(0)}% of safe load
                    </span>
                    {c.overloaded && (
                      <span style={{ color: '#C53030', fontWeight: 600 }}>OVERLOAD</span>
                    )}
                    {!c.overloaded && c.warning && (
                      <span style={{ color: '#F5A623', fontWeight: 600 }}>NEAR LIMIT</span>
                    )}
                  </div>
                  <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {c.items.map(it => (
                      <button key={it.id}
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSelected(it.id)}
                        style={{ fontSize: 11, padding: '2px 6px' }}
                        title={`${it.label} · ${effectiveWattage(it)} W`}>
                        {it.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="row between" style={{
            marginTop: 10, padding: '8px 10px',
            background: 'var(--bg-alt)', borderRadius: 'var(--radius-md)',
            fontFamily: 'Montserrat', fontWeight: 600, fontSize: 12.5,
          }}>
            <span>System total</span>
            <span className="tabular">
              {totalAmps.toFixed(2)} A
              <span className="muted" style={{ marginLeft: 8, fontWeight: 400 }}>· {totalWatts.toFixed(0)} W</span>
            </span>
          </div>
        </>
      )}
    </Section>
  );
}

function ZonesCard() {
  const zones = useStore(s => s.zones);
  const heatmap = useStore(s => s.heatmap);
  const clarity = useStore(s => s.clarityHeatmap);
  const drawingZone = useStore(s => s.drawingZone);
  const setDrawingZone = useStore(s => s.setDrawingZone);
  const updateZone = useStore(s => s.updateZone);
  const deleteZone = useStore(s => s.deleteZone);

  return (
    <Section sectionKey="zones" title="Coverage zones" icon="polygon"
      badge={zones.length > 0 ? <span className="pill-mini">{zones.length}</span> : null}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>Per-zone SPL stats vs. target.</span>
        <button
          className={drawingZone ? 'btn btn-cta btn-sm' : 'btn btn-secondary btn-sm'}
          onClick={() => setDrawingZone(!drawingZone)}>
          <Icon name="polygon" size={12}/>
          {drawingZone ? 'Drawing…' : 'Draw zone'}
        </button>
      </div>

      {zones.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>
          Outline named regions of the audience plane (Main Floor, Balcony, Front Section)
          to get per-zone SPL stats vs. a target.
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {zones.map(z => {
            const stats = computeZoneStats(z, heatmap, clarity);
            return (
              <div key={z.id} style={{
                border: `1px solid var(--border)`,
                borderLeft: `4px solid ${z.color}`,
                borderRadius: 'var(--radius-md)',
                padding: '8px 10px',
                background: 'var(--bg-alt)',
              }}>
                <div className="row between" style={{ marginBottom: 6 }}>
                  <input className="text-input" value={z.name}
                    onChange={e => updateZone(z.id, { name: e.target.value })}
                    style={{ background: 'transparent', border: 0, padding: 0, fontWeight: 600, fontSize: 13 }}/>
                  <div className="row" style={{ gap: 4 }}>
                    <input type="color" value={z.color}
                      onChange={e => updateZone(z.id, { color: e.target.value })}
                      style={{ width: 22, height: 22, border: 0, padding: 0, background: 'transparent', cursor: 'pointer' }}/>
                    <button className="btn btn-ghost btn-sm" title="Delete zone"
                      onClick={() => deleteZone(z.id)}>
                      <Icon name="trash" size={12}/>
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 50px', gap: 8, alignItems: 'center', padding: '2px 0' }}>
                  <label style={{ fontSize: 11.5, color: 'var(--fg2)' }}>Target SPL</label>
                  <input type="range" min="60" max="105" step="1" value={z.targetSPL}
                    onChange={e => updateZone(z.id, { targetSPL: parseInt(e.target.value, 10) })}/>
                  <span className="tabular" style={{ fontSize: 11.5, textAlign: 'right' }}>{z.targetSPL} dB</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, alignItems: 'center', padding: '2px 0' }}>
                  <label style={{ fontSize: 11.5, color: 'var(--fg2)' }}>Seating</label>
                  <select value={z.seatingType ?? ''}
                    onChange={e => {
                      const t = e.target.value as import('../../types').SeatingType | '';
                      updateZone(z.id, { seatingType: t === '' ? undefined : t });
                    }}>
                    <option value="">— not specified —</option>
                    <option value="padded-chair">Padded chairs (theater)</option>
                    <option value="unpadded-chair">Unpadded chairs (plastic / metal)</option>
                    <option value="pew-padded">Padded pews</option>
                    <option value="pew-wood">Wood pews</option>
                    <option value="standing">Standing area</option>
                  </select>
                </div>

                {z.seatingType && (
                  <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 50px', gap: 8, alignItems: 'center', padding: '2px 0' }}>
                    <label style={{ fontSize: 11.5, color: 'var(--fg2)' }}>
                      {z.seatingType === 'standing' ? 'People' : 'Seats'}
                    </label>
                    <input type="number" min="0" step="1"
                      value={z.seatCount ?? 0}
                      onChange={e => updateZone(z.id, { seatCount: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                      className="num-input tabular"
                      style={{ width: '100%' }}/>
                    <span className="muted tabular" style={{ fontSize: 11, textAlign: 'right' }}>{z.seatCount ?? 0}</span>
                  </div>
                )}

                {/* Sprint C11 — per-zone heights for balconies / raised stages.
                    floorHeightFt = elevation of zone's floor above the room floor.
                    earHeightFt   = ear above zone's floor (overrides global default). */}
                <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 50px', gap: 8, alignItems: 'center', padding: '2px 0' }}>
                  <label style={{ fontSize: 11.5, color: 'var(--fg2)' }} title="Floor elevation of this zone above the room floor (ft). Use for balconies, raised stages, choir lofts.">
                    Floor ↑
                  </label>
                  <input type="number" min="0" max="40" step="0.5"
                    value={z.floorHeightFt ?? 0}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      updateZone(z.id, { floorHeightFt: isFinite(v) && v > 0 ? v : undefined });
                    }}
                    className="num-input tabular"
                    style={{ width: '100%' }}/>
                  <span className="muted tabular" style={{ fontSize: 11, textAlign: 'right' }}>ft</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 50px', gap: 8, alignItems: 'center', padding: '2px 0' }}>
                  <label style={{ fontSize: 11.5, color: 'var(--fg2)' }} title="Ear height above this zone's floor (ft). Overrides the global ear-height in the bottom strip for cells inside this zone.">
                    Ear above ↑
                  </label>
                  <input type="number" min="0" max="10" step="0.5"
                    placeholder="auto"
                    value={z.earHeightFt ?? ''}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      updateZone(z.id, { earHeightFt: isFinite(v) && v > 0 ? v : undefined });
                    }}
                    className="num-input tabular"
                    style={{ width: '100%' }}/>
                  <span className="muted tabular" style={{ fontSize: 11, textAlign: 'right' }}>
                    {z.earHeightFt != null ? 'ft' : 'auto'}
                  </span>
                </div>

                {stats ? (
                  <div style={{ marginTop: 6, fontSize: 11.5 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 4 }}>
                      <ZoneStat label="Avg" value={`${stats.splAvg.toFixed(1)}`}/>
                      <ZoneStat label="Min" value={`${stats.splMin.toFixed(1)}`}/>
                      <ZoneStat label="Max" value={`${stats.splMax.toFixed(1)}`}/>
                      <ZoneStat label="±σ" value={`${stats.splStd.toFixed(1)}`}/>
                    </div>
                    <div className="row between" style={{ alignItems: 'baseline', gap: 8 }}>
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        {stats.cells} cells · vs target
                        <strong className="tabular" style={{
                          marginLeft: 6,
                          color: stats.passing ? 'var(--success)' : '#A52A2A',
                        }}>
                          {stats.vsTarget >= 0 ? '+' : ''}{stats.vsTarget.toFixed(1)} dB
                        </strong>
                      </span>
                      <span style={{
                        fontFamily: 'Montserrat', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.10em',
                        textTransform: 'uppercase',
                        padding: '2px 8px', borderRadius: 999,
                        background: stats.passing ? 'rgba(47,158,94,.18)' : 'rgba(197,48,48,.18)',
                        color: stats.passing ? '#1E7A45' : '#A52A2A',
                      }}>
                        {stats.passing ? 'Pass' : 'Below target'}
                      </span>
                    </div>
                    {stats.c50Avg != null && (
                      <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                        Avg C50 <strong className="tabular" style={{ color: 'var(--fg1)' }}>{stats.c50Avg.toFixed(1)} dB</strong>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                    {heatmap ? 'No heatmap cells fall inside this zone.' : 'Place speakers to see stats.'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function ZoneStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 4, padding: '4px 6px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 9.5, color: 'var(--fg3)', textTransform: 'uppercase', letterSpacing: '0.10em', fontFamily: 'Montserrat', fontWeight: 600 }}>{label}</div>
      <div className="tabular" style={{ fontSize: 12.5, color: 'var(--fg1)', fontWeight: 600 }}>{value}</div>
    </div>
  );
}

/**
 * Per-band T20 / T30 / EDT readout from the stochastic ray tracer.
 *
 * Only renders when ray tracing is enabled and the worker has produced
 * a summary. The numbers come from Schroeder backwards integration of
 * the per-band energy histogram, then linear-fit decay analysis between
 * the standard limits (T20: −5 to −25 dB ×3; T30: −5 to −35 ×2; EDT:
 * 0 to −10 ×6, all giving an RT60-equivalent in seconds).
 *
 * T30 is the usual "RT60" value reported by acousticians — it's the
 * decay measurement most robust to background noise. EDT captures the
 * perceived liveness (early decay), which can differ noticeably from
 * T30 in rooms with strong early reflections.
 */
function LowFrequencyModesCard() {
  const useModalLF = useStore(s => s.useModalLF);
  const toggleModalLF = useStore(s => s.toggleModalLF);
  const analysis = useStore(s => s.modalAnalysis);

  const typeColor: Record<string, string> = {
    axial: '#C53030', tangential: '#F5A623', oblique: '#2E87F5',
  };

  return (
    <div className="inspector-card">
      <div className="row between" style={{ alignItems: 'center', marginBottom: 8 }}>
        <h4 style={{ margin: 0 }}>Low-frequency modes</h4>
        <button
          className={`btn btn-ghost btn-sm ${useModalLF ? 'amber-text' : ''}`}
          onClick={toggleModalLF}
          title="Wave-accurate room-mode analysis — the LF behavior ray tracing can't model"
        >
          {useModalLF ? 'On' : 'Enable'}
        </button>
      </div>

      {!useModalLF ? (
        <div className="muted" style={{ fontSize: 12 }}>
          Geometrical models (rays/ISM) can't represent room modes. Enable to
          compute the room's eigenmodes, Schroeder frequency, and where bass
          will build up or cancel.
        </div>
      ) : !analysis ? (
        <div className="muted" style={{ fontSize: 12 }}>Computing modes…</div>
      ) : (
        <>
          <div className="row" style={{ gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
            <div>
              <div className="muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Schroeder freq</div>
              <div className="tabular" style={{ fontSize: 20, fontWeight: 700 }}>{analysis.schroeder.toFixed(0)} <span style={{ fontSize: 12, fontWeight: 400 }}>Hz</span></div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Modes ≤ Schroeder</div>
              <div className="tabular" style={{ fontSize: 20, fontWeight: 700 }}>{analysis.modesBelowSchroeder}</div>
            </div>
          </div>
          <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
            Below ~{analysis.schroeder.toFixed(0)} Hz the room is modal — that's
            where bass problems live. {analysis.approximate ? 'Non-rectangular room — bounding-box approximation.' : ''}
          </div>

          {/* First several modes */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 10 }}>
            {analysis.modes.slice(0, 12).map((m, i) => (
              <div key={i} title={`(${m.nx},${m.ny},${m.nz}) ${m.type}`}
                style={{
                  fontSize: 11, textAlign: 'center', padding: '3px 2px', borderRadius: 4,
                  background: 'var(--bg-alt)', border: '1px solid var(--border)',
                  borderLeft: `3px solid ${typeColor[m.type]}`,
                }}>
                <div className="tabular" style={{ fontWeight: 700 }}>{m.f.toFixed(0)}</div>
                <div className="muted" style={{ fontSize: 8.5 }}>{m.type.slice(0, 3)}</div>
              </div>
            ))}
          </div>
          <div className="row" style={{ gap: 10, fontSize: 9.5, marginBottom: 10 }}>
            <span><span style={{ color: typeColor.axial }}>■</span> axial</span>
            <span><span style={{ color: typeColor.tangential }}>■</span> tangential</span>
            <span><span style={{ color: typeColor.oblique }}>■</span> oblique</span>
          </div>

          {analysis.warnings.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {analysis.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: 11.5, lineHeight: 1.4, color: 'var(--fg2)', paddingLeft: 16, position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#F5A623' }}>▲</span>{w}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DecayTimesCard() {
  const useRayTracing = useStore(s => s.useRayTracing);
  const rays = useStore(s => s.raysSummary);
  const rayQuality = useStore(s => s.rayQuality);
  if (!useRayTracing) {
    return (
      <div className="inspector-card">
        <h4 style={{ marginBottom: 8 }}>Decay times (T20 / T30 / EDT)</h4>
        <div className="muted" style={{ fontSize: 12 }}>
          Enable <b style={{ color: 'var(--fg)' }}>Ray-trace tail</b> in the bottom strip to compute
          per-band T20/T30/EDT from a stochastic energy decay curve. RT60 above will switch
          from Sabine/Eyring to ray-derived T30 once enabled.
        </div>
      </div>
    );
  }
  if (!rays) {
    return (
      <div className="inspector-card">
        <h4 style={{ marginBottom: 8 }}>Decay times (T20 / T30 / EDT)</h4>
        <div className="muted" style={{ fontSize: 12 }}>
          Tracing rays… (quality: {rayQuality})
        </div>
      </div>
    );
  }
  const bands = [125, 250, 500, 1000, 2000, 4000] as const;
  const fmt = (v: number | undefined) => (v == null || !isFinite(v)) ? '—' : `${v.toFixed(2)}s`;
  return (
    <div className="inspector-card">
      <h4 style={{ marginBottom: 8 }}>Decay times (T20 / T30 / EDT)</h4>
      <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--fg2)' }}>
            <th style={{ textAlign: 'left',  padding: '2px 4px', fontWeight: 600 }}>Hz</th>
            <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 600 }}>T20</th>
            <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 600 }}>T30</th>
            <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 600 }}>EDT</th>
          </tr>
        </thead>
        <tbody>
          {bands.map(b => (
            <tr key={b}>
              <td className="tabular" style={{ padding: '2px 4px' }}>
                {b >= 1000 ? `${b / 1000}k` : b}
              </td>
              <td className="tabular" style={{ textAlign: 'right', padding: '2px 4px' }}>
                {fmt(rays.t20[b])}
              </td>
              <td className="tabular" style={{ textAlign: 'right', padding: '2px 4px',
                  color: 'var(--fg1)', fontWeight: 600 }}>
                {fmt(rays.t30[b])}
              </td>
              <td className="tabular" style={{ textAlign: 'right', padding: '2px 4px' }}>
                {fmt(rays.edt[b])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <EDCChart rays={rays} />
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        {rays.rayCount.toLocaleString()} rays · receiver at room centroid · quality {rayQuality}
      </div>
    </div>
  );
}

/**
 * Compact SVG chart of the per-band Schroeder energy decay curve at the
 * room-average receiver. X axis = time in ms (0 to first band's RT60 + 200 ms);
 * Y axis = level in dB (0 at top, −60 at bottom). One line per octave band,
 * colored from cool blue (LF) to warm red (HF) so the user can see where
 * decay is sluggish band-by-band.
 */
function EDCChart({ rays }: { rays: import('../../engine/heatmap.worker').RaySummary }) {
  const W = 240;
  const H = 110;
  const PAD_L = 28;
  const PAD_B = 18;
  const PAD_T = 6;
  const PAD_R = 4;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  // Decide max time to plot: the longest T30 in the result, or 1500 ms minimum.
  const bands = [125, 250, 500, 1000, 2000, 4000] as const;
  const colors: Record<number, string> = {
    125: '#1A4FBF', 250: '#2E87F5', 500: '#2F9E5E',
    1000: '#C8BE50', 2000: '#F5A623', 4000: '#C53030',
  };
  const longestT60 = Math.max(0.5, ...bands
    .map(b => rays.t30[b] ?? rays.t20[b] ?? rays.edt[b] ?? 0)
    .filter(v => isFinite(v)));
  const maxMs = Math.min(rays.numBins * rays.binMs, Math.max(1500, longestT60 * 1000 * 1.4));
  const minDb = -60;
  const maxDb = 0;
  const xOf = (ms: number) => PAD_L + (ms / maxMs) * plotW;
  const yOf = (db: number) => PAD_T + (1 - (db - minDb) / (maxDb - minDb)) * plotH;
  // Draw -10, -25, -35 reference lines (the EDT/T20/T30 thresholds).
  const refLines = [-10, -25, -35];
  // Build per-band path strings.
  const paths: { band: number; d: string }[] = [];
  for (const b of bands) {
    const edc = rays.edcDb[b];
    if (!edc || !edc.length) continue;
    const last = Math.min(edc.length, Math.ceil(maxMs / rays.binMs));
    let d = '';
    for (let i = 0; i < last; i += 1) {
      const ms = i * rays.binMs;
      const db = Math.max(minDb, Math.min(maxDb, edc[i]));
      if (!isFinite(db)) continue;
      d += (i === 0 ? 'M' : 'L') + xOf(ms).toFixed(1) + ',' + yOf(db).toFixed(1) + ' ';
    }
    if (d) paths.push({ band: b, d });
  }
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--fg2)', marginBottom: 4 }}>
        Energy decay curve (per-band Schroeder integral)
      </div>
      <svg width={W} height={H} style={{ display: 'block' }}>
        <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH}
          fill="rgba(255,255,255,.02)" stroke="var(--border)" strokeWidth={0.5}/>
        {/* Reference dB lines */}
        {refLines.map(db => (
          <g key={db}>
            <line x1={PAD_L} x2={W - PAD_R} y1={yOf(db)} y2={yOf(db)}
              stroke="rgba(255,255,255,.10)" strokeWidth={0.5} strokeDasharray="2 3"/>
            <text x={PAD_L - 4} y={yOf(db) + 3} textAnchor="end"
              fontSize={9} fill="var(--fg3)">{db}</text>
          </g>
        ))}
        {/* Y-axis labels at 0 and -60 */}
        <text x={PAD_L - 4} y={yOf(0) + 3} textAnchor="end" fontSize={9} fill="var(--fg3)">0</text>
        <text x={PAD_L - 4} y={yOf(-60) + 3} textAnchor="end" fontSize={9} fill="var(--fg3)">-60</text>
        {/* X-axis labels */}
        <text x={PAD_L} y={H - 4} fontSize={9} fill="var(--fg3)">0</text>
        <text x={W - PAD_R} y={H - 4} textAnchor="end" fontSize={9} fill="var(--fg3)">{Math.round(maxMs)} ms</text>
        {/* Per-band EDC paths */}
        {paths.map(p => (
          <path key={p.band} d={p.d} stroke={colors[p.band]} strokeWidth={1.2}
            fill="none" opacity={0.85}/>
        ))}
      </svg>
      {/* Color legend */}
      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', fontSize: 10, color: 'var(--fg3)' }}>
        {bands.map(b => (
          <span key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 8, height: 2, background: colors[b], display: 'inline-block' }}/>
            {b >= 1000 ? `${b / 1000}k` : b}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Sprint C13 — Lateral Fraction + IACC_E spatial impression metrics.
 *
 * Reads `state.spatial` (computed by the worker when ISM is on). Shows:
 *   • Single LF value at 1 kHz with rating chip
 *   • Per-band breakdown across 125 / 1k / 4k as a stacked bar
 *   • Approximate IACC_E with disclaimer
 *
 * When reflections are off the card explains why the metric isn't
 * available (LF needs specular reflections to be meaningful).
 */
function SpatialImpressionCard() {
  const spatial = useStore(s => s.spatial);
  const useReflections = useStore(s => s.useReflections);

  if (!useReflections) {
    return (
      <div className="inspector-card">
        <h4 style={{ marginBottom: 8 }}>Spatial impression (LF / IACC)</h4>
        <div className="muted" style={{ fontSize: 12 }}>
          Enable <strong style={{ color: 'var(--fg)' }}>Reflections</strong> in the bottom strip to compute
          Lateral Fraction. Without specular reflections every arrival is "diffuse",
          and LF — which measures the geometric direction of early reflections — is
          undefined.
        </div>
      </div>
    );
  }
  if (!spatial) {
    return (
      <div className="inspector-card">
        <h4 style={{ marginBottom: 8 }}>Spatial impression (LF / IACC)</h4>
        <div className="muted" style={{ fontSize: 12 }}>Computing…</div>
      </div>
    );
  }

  const lf = spatial.lf;
  // Concert-hall LF rating per Beranek thresholds:
  //   < 0.10 = "narrow / direct-sound dominant" (cinema-like)
  //   0.10 – 0.19 = "moderate"
  //   0.19 – 0.30 = "wide / good envelopment" (typical fine concert hall)
  //   > 0.30 = "very wide / strongly reverberant"
  const rating: { label: string; color: string } =
    lf < 0.10 ? { label: 'Narrow', color: '#A52A2A' } :
    lf < 0.19 ? { label: 'Moderate', color: '#B57600' } :
    lf < 0.30 ? { label: 'Wide', color: '#1E7A45' } :
                { label: 'Very wide', color: '#1A4FBF' };

  const bands = [125, 1000, 4000] as const;
  const maxBand = Math.max(0.05, ...bands.map(b => spatial.lfByBand[b] ?? 0));

  return (
    <div className="inspector-card">
      <h4 style={{ marginBottom: 8 }}>Spatial impression (LF / IACC)</h4>
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <strong style={{ fontFamily: 'Montserrat', fontSize: 26 }} className="tabular">
          {lf.toFixed(2)}
        </strong>
        <span style={{
          fontFamily: 'Montserrat', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.10em',
          textTransform: 'uppercase',
          padding: '3px 10px', borderRadius: 999,
          background: rating.color + '20',
          color: rating.color,
        }}>
          {rating.label}
        </span>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
        Lateral Fraction at 1 kHz · ISO 3382-1
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--fg2)', marginBottom: 4 }}>
        Per-band LF
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 70 }}>
        {bands.map(b => {
          const v = spatial.lfByBand[b] ?? 0;
          return (
            <div key={b} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%' }}>
                <div style={{
                  flex: 1,
                  background: v < 0.10 ? '#A52A2A' : v < 0.19 ? '#B57600' : v < 0.30 ? '#1E7A45' : '#1A4FBF',
                  height: `${Math.max(2, (v / maxBand) * 100)}%`,
                  borderRadius: '2px 2px 0 0',
                }}/>
              </div>
              <span style={{ fontSize: 9.5, color: 'var(--fg3)', fontFamily: 'Montserrat', fontWeight: 600 }}>
                {b >= 1000 ? `${b / 1000}k` : b}
              </span>
              <span className="tabular" style={{ fontSize: 10, color: 'var(--fg2)' }}>{v.toFixed(2)}</span>
            </div>
          );
        })}
      </div>

      <div style={{
        marginTop: 12, padding: '6px 8px', background: 'rgba(0,0,0,.04)',
        borderRadius: 4, fontSize: 11.5,
      }}>
        <div className="row between">
          <span className="muted">IACC<sub>E</sub> ≈</span>
          <strong className="tabular" style={{ color: 'var(--fg1)' }}>
            {spatial.iaccE.toFixed(2)}
          </strong>
        </div>
        <div style={{ fontSize: 10.5, marginTop: 3, color: 'var(--fg3)' }}>
          Approximated from LF (Beranek/Bradley empirical fit). Lower = wider stereo image.
          Full IACC requires HRTF data and a binaural impulse response — this is a design indicator.
        </div>
      </div>

      <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>
        Receiver at room centroid · {spatial.imageCount.toLocaleString()} early-window image sources
      </div>
    </div>
  );
}

function CollapsedInspectorRail({
  onExpand, hasSelection, activeTab, setTab,
}: {
  onExpand: () => void;
  hasSelection: boolean;
  activeTab: 'properties' | 'acoustics' | 'notes';
  setTab: (t: 'properties' | 'acoustics' | 'notes') => void;
}) {
  const tabs: { key: 'properties' | 'acoustics' | 'notes'; icon: string; title: string }[] = [
    { key: 'properties', icon: 'cube',     title: 'Properties' },
    { key: 'acoustics',  icon: 'heatmap',  title: 'Acoustics' },
    { key: 'notes',      icon: 'panel',    title: 'Notes' },
  ];
  return (
    <div className="sidebar-rail right">
      <button className="expand-btn" title="Expand inspector" onClick={onExpand}>
        <Icon name="chevL" size={14}/>
      </button>
      <div style={{ height: 1, width: 24, background: 'var(--border)' }}/>
      {tabs.map(t => (
        <button
          key={t.key}
          className={`rail-mini ${activeTab === t.key ? 'active' : ''}`}
          title={t.title}
          onClick={() => { setTab(t.key); onExpand(); }}>
          <Icon name={t.icon} size={14}/>
        </button>
      ))}
      {hasSelection && (
        <div style={{
          width: 6, height: 6, borderRadius: 999,
          background: 'var(--amber-gold)',
          margin: '4px 0',
        }} title="Item selected"/>
      )}
      <div className="rail-label">Inspector</div>
    </div>
  );
}

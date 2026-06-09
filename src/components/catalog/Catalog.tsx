import { useMemo } from 'react';
import { useStore } from '../../stores/useStore';
import { Icon } from '../Icon';
import {
  EQUIPMENT, BRANDS, speakerTemplates, acousticTemplates,
  videoTemplates, lightingTemplates, audioSignalTemplates, infrastructureTemplates,
  furnitureTemplates,
} from '../../constants/equipmentLibrary';
import { buildItemFromTemplate } from '../../utils/itemBuilder';
import { MATERIALS, materialNRC } from '../../constants/materials';
import type { EquipmentItem, EquipmentTemplate, Material } from '../../types';

function defaultPlacement(t: EquipmentTemplate, roomBox: { width: number; depth: number }): Partial<EquipmentItem> {
  const cx = roomBox.width / 2;
  const cy = roomBox.depth * 0.25;
  if (t.category === 'audio-speaker') {
    // Per-kind position + aim + tilt defaults so a freshly placed speaker is
    // already in a usable acoustic configuration.
    if (t.kind === 'speaker-sub' || t.kind === 'speaker-sub-flown') {
      return { x: cx, y: cy, z: t.kind === 'speaker-sub-flown' ? 16 : 1,
        rotation: 90, aim: 90, tilt: 0, drive: 80 };
    }
    if (t.kind === 'speaker-ceiling') {
      const z = roomBox.depth > 60 ? 12 : 10;
      return { x: cx, y: cy + 6, z, rotation: 0, aim: 0, tilt: -88, drive: 70 };
    }
    if (t.kind === 'speaker-monitor') {
      // Wedge at the front of the stage, aiming back into the stage at the performer
      return { x: cx, y: 4, z: 1, rotation: 90, aim: 90, tilt: 18, drive: 70 };
    }
    if (t.kind === 'speaker-iem') {
      // RF transmitter — usually rack-mount; place it backstage at floor level
      return { x: cx, y: 2, z: 4, rotation: 0, aim: 0, tilt: 0, drive: 0 };
    }
    if (t.kind === 'speaker-line-array') {
      return { x: cx, y: cy, z: 18, rotation: 90, aim: 90, tilt: -10, drive: 75,
        boxes: 6, splay: 1.5 };
    }
    if (t.kind === 'speaker-delay') {
      return { x: cx, y: roomBox.depth * 0.55, z: 14, rotation: 90, aim: 90, tilt: -10, drive: 60, delayMs: 35 };
    }
    if (t.kind === 'speaker-fill') {
      return { x: cx, y: cy + 2, z: 8, rotation: 90, aim: 90, tilt: -25, drive: 50 };
    }
    // point source / column — front-of-stage, slightly down
    return { x: cx, y: cy, z: 14, rotation: 90, aim: 90, tilt: -10, drive: 75 };
  }
  if (t.category === 'acoustic') {
    return { x: 0.2, y: roomBox.depth / 2, z: 5, rotation: 0, panelW: t.defaultW ?? 4, panelH: t.defaultD ?? 2, wall: 'L' };
  }
  // ===== Truss / rigging =====
  if (t.kind === 'truss-straight') {
    // Default to a 20-ft span across the front of the audience, hung at 16 ft.
    return { x: cx, y: cy, z: 16, rotation: 0, trussLengthFt: 20 } as Partial<EquipmentItem>;
  }
  if (t.kind === 'truss-square') {
    return { x: cx, y: cy, z: 16, rotation: 0, trussWidthFt: 16, trussDepthFt: 16 } as Partial<EquipmentItem>;
  }
  if (t.kind === 'truss-circle') {
    return { x: cx, y: cy, z: 16, rotation: 0, trussDiameterFt: 12 } as Partial<EquipmentItem>;
  }
  // video / lighting / infra
  return { x: cx, y: cy + 6, z: t.kind.startsWith('mh-') || t.kind === 'led-par' || t.kind === 'projector' ? 14 : 4, rotation: 0 };
}

export function Catalog() {
  const mode = useStore(s => s.catalogMode);
  const brandFilter = useStore(s => s.brandFilter);
  const setBrandFilter = useStore(s => s.setBrandFilter);
  const query = useStore(s => s.searchQuery);
  const setQuery = useStore(s => s.setSearchQuery);
  const setCatalogMode = useStore(s => s.setCatalogMode);
  const room = useStore(s => s.room);
  const addEquipment = useStore(s => s.addEquipment);
  const setHint = useStore(s => s.setHint);
  const collapsed = useStore(s => s.catalogCollapsed);
  const toggleCollapsed = useStore(s => s.toggleCatalogCollapsed);
  const customEquipment = useStore(s => s.customEquipment);
  const setOpenModal = useStore(s => s.setOpenModal);
  const view = useStore(s => s.catalogView);
  const setView = useStore(s => s.setCatalogView);

  const baseList = useMemo(() => {
    let list: ReturnType<typeof speakerTemplates>;
    if (mode === 'speakers') list = speakerTemplates();
    else if (mode === 'acoustic') list = acousticTemplates();
    else if (mode === 'video')    list = videoTemplates();
    else if (mode === 'lighting') list = lightingTemplates();
    else if (mode === 'signal')   list = audioSignalTemplates();
    else if (mode === 'infra')    list = infrastructureTemplates();
    else if (mode === 'furniture') list = furnitureTemplates();
    else if (mode === 'materials') list = [];   // materials render via MaterialsBrowser
    else list = EQUIPMENT;
    // Append custom equipment that matches this mode.
    const matchesMode = (cat: string) => (
      (mode === 'speakers' && cat === 'audio-speaker') ||
      (mode === 'acoustic' && cat === 'acoustic') ||
      (mode === 'video' && cat === 'video') ||
      (mode === 'lighting' && cat === 'lighting') ||
      (mode === 'signal' && cat === 'audio-signal') ||
      (mode === 'infra' && cat === 'infrastructure') ||
      (mode === 'furniture' && cat === 'furniture')
    );
    return [...list, ...customEquipment.filter(c => matchesMode(c.category))];
  }, [mode, customEquipment]);

  const items = useMemo(() => {
    let list = baseList;
    if (brandFilter && brandFilter !== 'All') list = list.filter(x => x.brand === brandFilter);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(x => x.label.toLowerCase().includes(q) || (x.brand ?? '').toLowerCase().includes(q));
    }
    return list;
  }, [baseList, brandFilter, query]);

  const grouped = useMemo(() => {
    if (mode !== 'speakers') return null;
    const groups: Record<string, EquipmentTemplate[]> = {};
    for (const s of items) {
      const t = ({
        'speaker-point': 'Point source',
        'speaker-line-array': 'Line array',
        'speaker-sub': 'Subwoofers',
        'speaker-sub-flown': 'Subwoofers (flown)',
        'speaker-ceiling': 'Ceiling',
        'speaker-column': 'Columns',
        'speaker-monitor': 'Stage monitors',
        'speaker-iem': 'IEM',
        'speaker-delay': 'Delay',
        'speaker-fill': 'Fill',
      } as Record<string, string>)[s.kind] ?? s.kind;
      (groups[t] = groups[t] || []).push(s);
    }
    return groups;
  }, [items, mode]);

  const place = (t: EquipmentTemplate) => {
    // Compute a sensible default x/y/z (per-kind anchor — front of stage
    // for FOH speakers, ceiling for ceiling speakers, etc.) and let the
    // shared builder handle the rest.
    const placement = defaultPlacement(t, { width: room.width, depth: room.depth });
    const item = buildItemFromTemplate(t, {
      x: placement.x ?? room.width / 2,
      y: placement.y ?? room.depth * 0.25,
      z: placement.z,
      rotation: placement.rotation,
    }, room);
    // Pull through truss / panel dimensions that come from defaultPlacement
    // (these aren't on the template but on the per-kind position recipe).
    if (placement.trussLengthFt   != null) item.trussLengthFt   = placement.trussLengthFt;
    if (placement.trussWidthFt    != null) item.trussWidthFt    = placement.trussWidthFt;
    if (placement.trussDepthFt    != null) item.trussDepthFt    = placement.trussDepthFt;
    if (placement.trussDiameterFt != null) item.trussDiameterFt = placement.trussDiameterFt;
    if (placement.panelW          != null) item.panelW          = placement.panelW;
    if (placement.panelH          != null) item.panelH          = placement.panelH;
    if (placement.wall                  ) item.wall            = placement.wall;
    addEquipment(item);
    setHint(`${t.brand ? t.brand + ' ' : ''}${t.label} placed`);
  };

  const brandList = ['All', ...BRANDS];

  if (collapsed) {
    return <CollapsedCatalogRail onExpand={toggleCollapsed} active={mode} setMode={setCatalogMode}/>;
  }

  return (
    <aside className="sidebar">
      <button className="sb-collapse-edge" title="Collapse panel" onClick={toggleCollapsed}>
        <Icon name="chevL" size={14}/>
      </button>
      <div className="sb-header">
        <div className="row between" style={{ flexWrap: 'wrap', rowGap: 6 }}>
          <div style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--bg-alt)', borderRadius: 999, flexShrink: 0 }}>
            {(['library', 'placed'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                style={{
                  fontFamily: 'Montserrat', fontWeight: 700, fontSize: 11,
                  letterSpacing: '0.10em', textTransform: 'uppercase',
                  padding: '4px 12px', borderRadius: 999, border: 0,
                  background: view === v ? 'var(--royal-blue)' : 'transparent',
                  color: view === v ? '#fff' : 'var(--fg2)',
                  cursor: 'pointer',
                }}>{v}</button>
            ))}
          </div>
          <div className="row" style={{ gap: 4, flexShrink: 0 }}>
            {view === 'library' && mode === 'speakers' && (
              <button className="btn btn-ghost btn-sm" title="Insert sub array preset"
                style={{ height: 26, padding: '0 8px' }}
                onClick={() => setOpenModal('sub-array')}>
                <Icon name="bolt" size={14}/>
                Sub array
              </button>
            )}
            <button className="btn btn-ghost btn-sm" title="Add custom equipment" style={{ height: 26, padding: '0 8px' }}
              onClick={() => setOpenModal('custom-equipment')}>
              <Icon name="plus" size={14}/>
              Custom
            </button>
          </div>
        </div>
        <div className="search">
          <Icon name="search" size={14}/>
          <input
            type="text"
            placeholder={view === 'placed' ? 'Filter placed items…' : `Search ${EQUIPMENT.length}+ items…`}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        {view === 'library' && mode === 'speakers' && (
          // Brand picker — was a wrapping chip list, but with ~50 brands the
          // wrap consumed ~200px of vertical header space and squeezed the
          // catalog body off-screen on shorter viewports. A dropdown fits the
          // same picker into one row and keeps the scroll area usable.
          <div className="brand-filter">
            <select
              className="brand-select"
              value={brandFilter ?? 'All'}
              onChange={e => setBrandFilter(e.target.value)}
              title="Filter by manufacturer"
            >
              {brandList.map(b => (
                <option key={b} value={b}>{b === 'All' ? 'All brands' : b}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {view === 'library' && (
        <div className="sb-tabs">
          {([
            ['speakers','Speakers'],
            ['acoustic','Acoustic'],
            ['materials','Materials'],
            ['furniture','Furniture'],
            ['signal','Signal'],
            ['video','Video'],
            ['lighting','Lighting'],
            ['infra','Infra'],
          ] as const).map(([id, label]) => (
            <button key={id} className={`sb-tab ${mode === id ? 'active' : ''}`} onClick={() => setCatalogMode(id)}>{label}</button>
          ))}
        </div>
      )}

      {view === 'placed' && <PlacedList query={query}/>}

      {view === 'library' && mode === 'materials' && (
        <div className="sb-body">
          <MaterialsBrowser query={query}/>
        </div>
      )}

      {view === 'library' && mode !== 'materials' && (
      <div className="sb-body">
        {mode === 'speakers' && grouped ? (
          Object.entries(grouped).map(([gName, list]) => (
            <div key={gName}>
              <div className="section-label">{gName} · {list.length}</div>
              {list.map(sp => (
                <SpeakerCard key={`${sp.brand}-${sp.label}`} t={sp} onPlace={() => place(sp)}/>
              ))}
            </div>
          ))
        ) : (
          <div>
            <div className="section-label">{
              mode === 'acoustic' ? 'Treatment' :
              mode === 'video' ? 'Video' :
              mode === 'lighting' ? 'Lighting' :
              mode === 'signal' ? 'Audio signal chain' :
              mode === 'infra' ? 'Power & racks' :
              mode === 'furniture' ? 'Furniture & objects' : 'Items'
            } · {items.length}</div>
            {items.map(it => (
              <SimpleCard key={`${it.brand}-${it.label}`} t={it} onPlace={() => place(it)}/>
            ))}
            {items.length === 0 && (
              <div className="inspector-empty">
                <div className="icon-bubble"><Icon name="search" size={24}/></div>
                <p>No items match — try clearing the filter.</p>
              </div>
            )}
          </div>
        )}
      </div>
      )}
    </aside>
  );
}

// ===== Materials browser (drag-drop onto surfaces, or click to apply) =====

const MATERIAL_GROUP_ORDER: Array<{ key: NonNullable<Material['group']>; label: string }> = [
  { key: 'reflective',  label: 'Reflective / hard' },
  { key: 'wood',        label: 'Wood' },
  { key: 'absorptive',  label: 'Absorptive / soft' },
  { key: 'glass-metal', label: 'Glass & metal' },
  { key: 'ceiling',     label: 'Ceiling' },
  { key: 'floor',       label: 'Floor' },
  { key: 'treatment',   label: 'Acoustic treatment' },
];

function MaterialsBrowser({ query }: { query: string }) {
  const selectedSurface = useStore(s => s.selectedSurface);
  const setSelectedSurfaceMaterial = useStore(s => s.setSelectedSurfaceMaterial);
  const setHint = useStore(s => s.setHint);

  const q = query.trim().toLowerCase();
  // Audience/seating materials are managed via zones, not painted on surfaces.
  const pool = MATERIALS.filter(m => m.group !== 'audience' && (!q || m.name.toLowerCase().includes(q)));

  const apply = (m: Material) => {
    if (selectedSurface) {
      setSelectedSurfaceMaterial(m.id);
      setHint(`${m.name} applied to ${selectedSurface.kind}`);
    } else {
      setHint('Select a surface (click a wall/floor/ceiling) or drag this material onto one.');
    }
  };

  return (
    <div>
      <div className="muted" style={{ fontSize: 11.5, padding: '2px 2px 10px' }}>
        {selectedSurface
          ? `Editing the selected ${selectedSurface.kind}. Click a material to apply, or drag onto any surface.`
          : 'Drag a material onto a wall, floor, or ceiling — or click a surface first, then click a material.'}
      </div>
      {MATERIAL_GROUP_ORDER.map(({ key, label }) => {
        const list = pool.filter(m => m.group === key);
        if (list.length === 0) return null;
        return (
          <div key={key}>
            <div className="section-label">{label} · {list.length}</div>
            {list.map(m => <MaterialChip key={m.id} m={m} onApply={() => apply(m)}/>)}
          </div>
        );
      })}
      {pool.length === 0 && (
        <div className="inspector-empty">
          <div className="icon-bubble"><Icon name="search" size={24}/></div>
          <p>No materials match — try clearing the search.</p>
        </div>
      )}
    </div>
  );
}

function MaterialChip({ m, onApply }: { m: Material; onApply: () => void }) {
  return (
    <div
      className="cat-item"
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('application/x-beacon-material', JSON.stringify({ materialId: m.id }));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onApply}
      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
      title={m.description ?? m.name}
    >
      <span style={{ width: 26, height: 26, borderRadius: 6, background: m.color, border: '1px solid var(--border)', flexShrink: 0 }}/>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
        <div className="muted" style={{ fontSize: 10.5 }}>
          NRC {materialNRC(m).toFixed(2)}{m.thicknessIn != null ? ` · ${m.thicknessIn}"` : ''}
        </div>
      </div>
    </div>
  );
}

function PlacedList({ query }: { query: string }) {
  const equipment = useStore(s => s.equipment);
  const groups = useStore(s => s.groups);
  const selectedIds = useStore(s => s.selectedIds);
  const setSelected = useStore(s => s.setSelected);
  const toggleSelection = useStore(s => s.toggleSelection);
  const updateEquipment = useStore(s => s.updateEquipment);
  const deleteEquipment = useStore(s => s.deleteEquipment);

  const q = query.trim().toLowerCase();
  const filtered = equipment.filter(e =>
    !q || e.label.toLowerCase().includes(q) || (e.brand ?? '').toLowerCase().includes(q) || e.kind.toLowerCase().includes(q)
  );

  const groupCategories = [
    { key: 'audio-speaker',  label: 'Speakers' },
    { key: 'acoustic',       label: 'Acoustic treatment' },
    { key: 'video',          label: 'Video' },
    { key: 'lighting',       label: 'Lighting' },
    { key: 'audio-signal',   label: 'Audio signal' },
    { key: 'infrastructure', label: 'Infrastructure' },
    { key: 'reference',      label: 'Reference points' },
  ] as const;

  const groupColor = (gid?: string) => groups.find(g => g.id === gid)?.color;

  return (
    <div className="sb-body">
      {equipment.length === 0 && (
        <div className="inspector-empty">
          <div className="icon-bubble"><Icon name="layers" size={24}/></div>
          <p>Nothing placed yet — switch back to <strong>Library</strong> and drag items onto the canvas.</p>
        </div>
      )}
      {groupCategories.map(cat => {
        const items = filtered.filter(e => e.category === cat.key);
        if (items.length === 0) return null;
        return (
          <div key={cat.key}>
            <div className="section-label">{cat.label} · {items.length}</div>
            {items.map(it => {
              const isSelected = selectedIds.includes(it.id);
              const gColor = groupColor(it.groupId);
              return (
                <div key={it.id}
                  onClick={(e) => {
                    if (e.shiftKey || e.metaKey || e.ctrlKey) toggleSelection(it.id);
                    else setSelected(it.id);
                  }}
                  style={{
                    display: 'grid', gridTemplateColumns: '8px 1fr auto auto', gap: 8,
                    alignItems: 'center', padding: '7px 10px', marginBottom: 4,
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${isSelected ? 'var(--royal-blue)' : 'var(--border)'}`,
                    background: isSelected ? 'rgba(26,79,191,.06)' : 'var(--surface)',
                    cursor: 'pointer',
                    opacity: it.muted ? 0.6 : 1,
                  }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: 999,
                    background: gColor ?? (cat.key === 'audio-speaker' ? '#1A4FBF' : 'var(--fg3)'),
                  }}/>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'Montserrat', fontWeight: 600, fontSize: 12.5,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{it.label}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {it.brand ?? ''}{it.brand ? ' · ' : ''}({it.x.toFixed(0)}, {it.y.toFixed(0)}, {it.z.toFixed(0)})
                    </div>
                  </div>
                  <div className="row" style={{ gap: 2, fontSize: 10 }}>
                    {it.category === 'audio-speaker' && it.muted && (
                      <span style={{ background: 'rgba(197,48,48,.18)', color: '#A52A2A', padding: '1px 6px', borderRadius: 999, fontWeight: 700, letterSpacing: '0.10em' }}>M</span>
                    )}
                    {it.category === 'audio-speaker' && it.soloed && (
                      <span style={{ background: 'rgba(245,166,35,.18)', color: '#B57600', padding: '1px 6px', borderRadius: 999, fontWeight: 700, letterSpacing: '0.10em' }}>S</span>
                    )}
                    {it.locked && (
                      <span style={{ color: 'var(--fg3)' }}><Icon name="lock" size={10}/></span>
                    )}
                  </div>
                  <button className="btn btn-ghost btn-sm" title="Delete"
                    onClick={(e) => { e.stopPropagation(); deleteEquipment(it.id); }}
                    style={{ padding: '0 4px', width: 22, height: 22 }}>
                    <Icon name="trash" size={12}/>
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
      {equipment.length > 0 && filtered.length === 0 && (
        <div className="inspector-empty">
          <div className="icon-bubble"><Icon name="search" size={24}/></div>
          <p>No matches.</p>
        </div>
      )}
    </div>
  );
}

function SpeakerCard({ t, onPlace }: { t: EquipmentTemplate; onPlace: () => void }) {
  return (
    <div className="cat-item" onClick={onPlace} draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-beacon-equip', JSON.stringify(t));
        e.dataTransfer.effectAllowed = 'copy';
      }}>
      <div className="thumb">
        <Icon name={t.kind === 'speaker-sub' ? 'panel' : 'speaker'} size={22}/>
      </div>
      <div className="meta">
        <div className="model">{t.label}</div>
        <div className="specs">
          {t.brand} · {t.horiz}°×{t.vert}° · {t.maxSPL}dB SPL
        </div>
      </div>
      <div className="badge">{t.badge}</div>
    </div>
  );
}

function CollapsedCatalogRail({
  onExpand, active, setMode,
}: {
  onExpand: () => void;
  active: string;
  setMode: (m: 'speakers' | 'acoustic' | 'video' | 'lighting' | 'signal' | 'infra') => void;
}) {
  const buttons: { key: 'speakers' | 'acoustic' | 'signal' | 'video' | 'lighting' | 'infra'; icon: string; title: string }[] = [
    { key: 'speakers', icon: 'speaker', title: 'Speakers' },
    { key: 'acoustic', icon: 'panel2',  title: 'Acoustic treatment' },
    { key: 'signal',   icon: 'speaker', title: 'Audio signal chain' },
    { key: 'video',    icon: 'camera',  title: 'Video' },
    { key: 'lighting', icon: 'light',   title: 'Lighting' },
    { key: 'infra',    icon: 'bolt',    title: 'Infrastructure' },
  ];
  return (
    <div className="sidebar-rail">
      <button className="expand-btn" title="Expand equipment library" onClick={onExpand}>
        <Icon name="chevR" size={14}/>
      </button>
      <div style={{ height: 1, width: 24, background: 'var(--border)' }}/>
      {buttons.map(b => (
        <button
          key={b.key}
          className={`rail-mini ${active === b.key ? 'active' : ''}`}
          title={b.title}
          onClick={() => { setMode(b.key); }}>
          <Icon name={b.icon} size={14}/>
        </button>
      ))}
      <div className="rail-label">Equipment</div>
    </div>
  );
}

function SimpleCard({ t, onPlace }: { t: EquipmentTemplate; onPlace: () => void }) {
  const isAcoustic = t.category === 'acoustic';
  return (
    <div className="cat-item" onClick={onPlace} draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-beacon-equip', JSON.stringify(t));
        e.dataTransfer.effectAllowed = 'copy';
      }}>
      <div className="thumb" style={{ background: isAcoustic ? '#3a2f1f' : '#1a2230', color: isAcoustic ? '#F5A623' : '#2E87F5' }}>
        <Icon name={
          t.category === 'acoustic' ? 'panel2' :
          t.category === 'video' ? 'camera' :
          t.category === 'lighting' ? 'light' :
          t.category === 'audio-signal' ? 'speaker' :
          'bolt'
        } size={22}/>
      </div>
      <div className="meta">
        <div className="model">{t.label}</div>
        <div className="specs">{t.brand}{t.nrc ? ` · NRC ${t.nrc}` : ''}{t.maxSPL ? ` · ${t.maxSPL} dB SPL` : ''}</div>
      </div>
      <div className="badge" style={{ color: isAcoustic ? '#B57600' : '#143F99' }}>
        {t.category === 'acoustic' ? (t.kind === 'bass-trap' ? 'Trap' : t.kind === 'diffuser' ? 'Diff' : 'Panel')
          : t.category === 'video' ? 'Video'
          : t.category === 'lighting' ? 'LX'
          : t.category === 'audio-signal' ? 'Signal'
          : 'Infra'}
      </div>
    </div>
  );
}

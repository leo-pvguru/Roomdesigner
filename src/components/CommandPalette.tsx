import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../stores/useStore';
import { Icon } from './Icon';
import { TEMPLATES } from '../templates';
import { EQUIPMENT } from '../constants/equipmentLibrary';

interface Command {
  id: string;
  label: string;
  hint?: string;
  category: string;
  icon?: string;
  shortcut?: string;
  run: () => void;
  keywords?: string;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Cmd/Ctrl+K to open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isOpener = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isOpener) {
        e.preventDefault();
        setOpen(o => !o);
        setQuery('');
        setActive(0);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const commands = useCommands(() => setOpen(false));

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) ||
      (c.hint?.toLowerCase().includes(q) ?? false) ||
      c.category.toLowerCase().includes(q) ||
      (c.keywords?.toLowerCase().includes(q) ?? false)
    );
  }, [commands, query]);

  // Keep active index inside results bounds
  useEffect(() => {
    if (active >= results.length) setActive(0);
  }, [results.length, active]);

  if (!open) return null;

  const onKeyDownInput = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(i => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = results[active];
      if (cmd) cmd.run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  // Group results by category for visual grouping
  const grouped: Record<string, Command[]> = {};
  for (const c of results) (grouped[c.category] = grouped[c.category] || []).push(c);

  return (
    <div onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(18,21,26,.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 'min(120px, 12vh)',
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 640,
          background: 'var(--surface)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
          maxHeight: '70vh',
          display: 'flex', flexDirection: 'column',
        }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
        }}>
          <Icon name="search" size={16}/>
          <input ref={inputRef}
            placeholder="Type a command — toggle heatmap, export PDF, place X12, …"
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDownInput}
            style={{
              flex: 1, border: 0, outline: 0, background: 'transparent',
              fontFamily: 'Open Sans', fontSize: 15, color: 'var(--fg1)',
            }}/>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg3)',
            background: 'var(--bg-alt)', padding: '2px 6px', borderRadius: 4,
          }}>esc</span>
        </div>
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
          {results.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--fg3)' }}>
              No commands match "{query}".
            </div>
          )}
          {Object.entries(grouped).map(([category, cmds]) => (
            <div key={category}>
              <div style={{
                padding: '10px 18px 4px',
                fontFamily: 'Montserrat', fontWeight: 700, fontSize: 10.5,
                letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'var(--fg3)',
              }}>{category}</div>
              {cmds.map((c, _i) => {
                const flatIndex = results.indexOf(c);
                const isActive = flatIndex === active;
                return (
                  <button key={c.id}
                    onMouseEnter={() => setActive(flatIndex)}
                    onClick={() => c.run()}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      width: '100%', padding: '10px 18px',
                      background: isActive ? 'rgba(26,79,191,.08)' : 'transparent',
                      border: 0, cursor: 'pointer', textAlign: 'left',
                      borderLeft: `3px solid ${isActive ? 'var(--royal-blue)' : 'transparent'}`,
                    }}>
                    <span style={{ width: 18, color: 'var(--fg2)' }}>
                      <Icon name={c.icon ?? 'cube'} size={14}/>
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{
                        fontFamily: 'Open Sans', fontSize: 13.5, color: 'var(--fg1)', fontWeight: 500,
                      }}>{c.label}</span>
                      {c.hint && (
                        <span style={{
                          fontSize: 12, color: 'var(--fg3)', marginLeft: 8,
                        }}>{c.hint}</span>
                      )}
                    </span>
                    {c.shortcut && (
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg3)',
                        background: 'var(--bg-alt)', padding: '2px 6px', borderRadius: 4,
                      }}>{c.shortcut}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div style={{
          padding: '8px 18px', borderTop: '1px solid var(--border)',
          background: 'var(--bg-alt)',
          display: 'flex', gap: 16, alignItems: 'center',
          fontSize: 11, color: 'var(--fg3)',
        }}>
          <span><kbd style={kbd}>↑↓</kbd> navigate</span>
          <span><kbd style={kbd}>↵</kbd> run</span>
          <span><kbd style={kbd}>esc</kbd> close</span>
          <span style={{ marginLeft: 'auto' }}>{results.length} result{results.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}

const kbd: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10.5,
  background: 'var(--surface)', border: '1px solid var(--border)',
  padding: '0 5px', borderRadius: 3, marginRight: 4,
};

function useCommands(close: () => void): Command[] {
  // Subscribe to the few slices that influence the command list itself.
  // Action commands read live state via getState() at click-time.
  const equipment = useStore(state => state.equipment);
  const scenarios = useStore(state => state.scenarios);

  const wrap = (fn: () => void) => () => { fn(); close(); };

  const cmds: Command[] = [];

  // ===== View / camera =====
  cmds.push(
    { id: 'view.iso',   category: 'View', label: 'Switch to iso view',   icon: 'cube', run: wrap(() => useStore.getState().applyCameraPreset('iso')) },
    { id: 'view.top',   category: 'View', label: 'Switch to top-down view', icon: 'grid', run: wrap(() => useStore.getState().applyCameraPreset('top')) },
    { id: 'view.front', category: 'View', label: 'Switch to front view',  icon: 'cube', run: wrap(() => useStore.getState().applyCameraPreset('front')) },
    { id: 'view.side',  category: 'View', label: 'Switch to side view',   icon: 'cube', run: wrap(() => useStore.getState().applyCameraPreset('side')) },
    { id: 'view.walk',  category: 'View', label: 'Enter walk-through (first-person)', icon: 'user', run: wrap(() => useStore.getState().enterWalkthrough()) },
    { id: 'view.fit',   category: 'View', label: 'Fit room to view',      icon: 'fit',  shortcut: 'Ctrl+0', run: wrap(() => useStore.getState().bumpFit()) },
    { id: 'view.present', category: 'View', label: 'Toggle presentation mode', icon: 'presentation', shortcut: 'F', run: wrap(() => useStore.getState().setPresentationMode(!useStore.getState().presentationMode)) },
  );

  // ===== Heatmap / metrics =====
  cmds.push(
    { id: 'metric.spl',     category: 'Heatmap', label: 'Show SPL coverage',     icon: 'heatmap', run: wrap(() => useStore.getState().setHeatmapMetric('spl')) },
    { id: 'metric.c50',     category: 'Heatmap', label: 'Show C50 clarity',      icon: 'heatmap', run: wrap(() => useStore.getState().setHeatmapMetric('c50')) },
    { id: 'metric.c80',     category: 'Heatmap', label: 'Show C80 clarity',      icon: 'heatmap', run: wrap(() => useStore.getState().setHeatmapMetric('c80')) },
    { id: 'metric.arrival', category: 'Heatmap', label: 'Show time-of-arrival',  icon: 'heatmap', keywords: 'tof haas delay', run: wrap(() => useStore.getState().setHeatmapMetric('arrival')) },
    { id: 'toggle.heatmap', category: 'Heatmap', label: 'Toggle heatmap',        icon: 'heatmap', shortcut: 'H', run: wrap(() => useStore.getState().toggleHeatmap()) },
    { id: 'toggle.contours',category: 'Heatmap', label: 'Toggle ±dB contour overlay', icon: 'heatmap', run: wrap(() => useStore.getState().toggleContours()) },
    { id: 'toggle.cones',   category: 'Heatmap', label: 'Toggle coverage cones', icon: 'ray', shortcut: 'C', run: wrap(() => useStore.getState().toggleCones()) },
    { id: 'toggle.mesh',    category: 'View',    label: 'Toggle floor grid',      icon: 'grid', shortcut: 'G', run: wrap(() => useStore.getState().toggleMesh()) },
  );

  // ===== Frequency =====
  cmds.push(
    { id: 'freq.125',  category: 'Frequency', label: 'Frequency · 125 Hz', icon: 'heatmap', run: wrap(() => useStore.getState().setActiveFreq('125')) },
    { id: 'freq.1k',   category: 'Frequency', label: 'Frequency · 1 kHz',  icon: 'heatmap', run: wrap(() => useStore.getState().setActiveFreq('1k')) },
    { id: 'freq.4k',   category: 'Frequency', label: 'Frequency · 4 kHz',  icon: 'heatmap', run: wrap(() => useStore.getState().setActiveFreq('4k')) },
    { id: 'freq.bb',   category: 'Frequency', label: 'Frequency · broadband', icon: 'heatmap', run: wrap(() => useStore.getState().setActiveFreq('broadband')) },
  );

  // ===== Simulation =====
  cmds.push(
    { id: 'sim.run',         category: 'Simulation', label: 'Re-run simulation', icon: 'refresh', shortcut: 'R', run: wrap(() => useStore.getState().markSimulationDirty()) },
    { id: 'sim.auto-treat',  category: 'Simulation', label: 'Auto-treat room…', hint: 'Plan acoustic treatment for a target RT60', icon: 'panel2', run: wrap(() => useStore.getState().setOpenModal('auto-treat')) },
    { id: 'sim.auto-treat-quick', category: 'Simulation', label: 'Auto-treat room (instant)', hint: 'Apply default treatment without options', icon: 'bolt', run: wrap(() => { const r = useStore.getState().autoTreatRoom(); useStore.getState().setHint(`Auto-treat: +${r.panels.length} panels, RT60 ${r.predictedRT60.toFixed(2)}s`); }) },
    { id: 'sim.clear-treat', category: 'Simulation', label: 'Clear treatment',   icon: 'trash', run: wrap(() => useStore.getState().clearTreatment()) },
    { id: 'sim.add-ref',     category: 'Simulation', label: 'Add reference point', icon: 'microphone', run: wrap(() => useStore.getState().addReferencePoint()) },
    { id: 'sim.occupied',    category: 'Simulation', label: 'Toggle occupied audience', icon: 'users', run: wrap(() => useStore.getState().setOccupied(!useStore.getState().room.occupied)) },
  );

  // ===== Tools =====
  cmds.push(
    { id: 'tool.measure', category: 'Tools', label: 'Measure (click two points)', icon: 'ruler', run: wrap(() => useStore.getState().setMeasureMode(!useStore.getState().measureMode)) },
    { id: 'tool.zone',    category: 'Tools', label: 'Draw coverage zone',          icon: 'polygon', run: wrap(() => useStore.getState().setDrawingZone(!useStore.getState().drawingZone)) },
    { id: 'tool.shape',   category: 'Tools', label: 'Redraw room shape',           icon: 'polygon', run: wrap(() => useStore.getState().setEditingRoomShape(true)) },
  );

  // ===== Project / export =====
  cmds.push(
    { id: 'export.pdf',  category: 'Export', label: 'Export PDF report', icon: 'download', shortcut: 'Ctrl+E', run: wrap(() => useStore.getState().setOpenModal('export')) },
    { id: 'export.bom',  category: 'Export', label: 'Open BOM & quote',   icon: 'bag',     run: wrap(() => useStore.getState().setOpenModal('bom')) },
    { id: 'export.share',category: 'Export', label: 'Share project',      icon: 'share',   run: wrap(() => useStore.getState().setOpenModal('share')) },
    { id: 'project.new', category: 'Project',label: 'New project',        icon: 'plus',    run: wrap(() => useStore.getState().setOpenModal('new-project')) },
    { id: 'project.welcome', category: 'Project', label: 'Open welcome screen / templates', icon: 'folderOpen', run: wrap(() => useStore.getState().setOpenModal('welcome')) },
    { id: 'edit.undo',  category: 'Edit', label: 'Undo', icon: 'undo', shortcut: 'Ctrl+Z', run: wrap(() => useStore.getState().undo()) },
    { id: 'edit.redo',  category: 'Edit', label: 'Redo', icon: 'redo', shortcut: 'Ctrl+Shift+Z', run: wrap(() => useStore.getState().redo()) },
  );

  // ===== Templates =====
  for (const t of TEMPLATES) {
    cmds.push({
      id: `tmpl.${t.id}`, category: 'Templates',
      label: `Apply template — ${t.name}`,
      hint: t.description,
      icon: 'cube',
      run: wrap(() => useStore.getState().applyTemplate(t.id)),
    });
  }

  // ===== Quick speaker placement (top brand-name speakers) =====
  for (const t of EQUIPMENT.filter(t => t.category === 'audio-speaker').slice(0, 12)) {
    cmds.push({
      id: `place.${t.brand}.${t.label}`, category: 'Place equipment',
      label: `Place ${t.brand} ${t.label}`,
      hint: `${t.horiz}°×${t.vert}° · ${t.maxSPL}dB`,
      keywords: `${t.kind} ${t.brand} ${t.label}`,
      icon: 'speaker',
      run: wrap(() => {
        const st = useStore.getState();
        const id = `${t.kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,5)}`;
        const cx = st.room.width / 2;
        const cy = st.room.depth * 0.25;
        st.addEquipment({
          id, templateId: `${t.brand}-${t.label}`,
          kind: t.kind, category: t.category,
          label: t.label, brand: t.brand,
          x: cx, y: cy, z: t.kind === 'speaker-sub' ? 1 : 14,
          rotation: 90, aim: 90, tilt: -10, drive: 75,
          horiz: t.horiz, vert: t.vert,
          maxSPL: t.maxSPL, sensitivity: t.sensitivity, power: t.power,
          ...(t.kind === 'speaker-line-array' ? { boxes: 6, splay: 1.5 } : {}),
        });
      }),
    });
  }

  // ===== Sub array =====
  cmds.push({
    id: 'sub.array',
    category: 'Place equipment',
    label: 'Insert subwoofer array preset',
    hint: 'Cardioid pair, end-fire, gradient…',
    icon: 'bolt',
    run: wrap(() => useStore.getState().setOpenModal('sub-array')),
  });

  // ===== Scenarios — switch to existing =====
  for (const sc of scenarios) {
    cmds.push({
      id: `scn.${sc.id}`,
      category: 'Scenarios',
      label: `Switch to scenario — ${sc.name}`,
      icon: 'copy',
      run: wrap(() => useStore.getState().switchScenario(sc.id)),
    });
  }

  // ===== Selection actions =====
  if (equipment.length > 0) {
    cmds.push({
      id: 'sel.all', category: 'Selection',
      label: 'Select all equipment', icon: 'layers',
      run: wrap(() => useStore.getState().setSelection(useStore.getState().equipment.map(e => e.id))),
    });
    cmds.push({
      id: 'sel.clear', category: 'Selection',
      label: 'Deselect all', icon: 'x',
      run: wrap(() => useStore.getState().clearSelection()),
    });
  }

  return cmds;
}

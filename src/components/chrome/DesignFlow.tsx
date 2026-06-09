import { useState } from 'react';
import { useStore } from '../../stores/useStore';
import { Icon } from '../Icon';
import { pickRoomScanFile, importRoomPlanFile, scanSummary } from '../../importers/roomplan';

// =====================================================================
// Guided Design Flow
// ---------------------------------------------------------------------
// An ArrayCalc-style step rail that walks a mid-tier user through a
// complete design: Room → Audience → System → Simulate → Treat → Propose.
//
// Completion is DERIVED from project state (not a wizard that owns the
// app) — the user can work in any order, in any panel, and the rail
// reflects reality. Clicking a step expands plain-language guidance with
// action buttons that drive the relevant part of the app.
//
// Dismissible to a "Guide" pill; the choice persists per device.
// =====================================================================

const COLLAPSE_KEY = 'beacon.designflow.collapsed';

interface StepDef {
  id: string;
  label: string;
  icon: string;
  /** One-sentence plain-language guidance shown when expanded. */
  blurb: string;
  done: boolean;
  actions: Array<{ label: string; run: () => void }>;
}

export function DesignFlow() {
  const room = useStore(s => s.room);
  const zones = useStore(s => s.zones);
  const equipment = useStore(s => s.equipment);
  const heatmap = useStore(s => s.heatmap);
  const rt60 = useStore(s => s.rt60);
  const compliance = useStore(s => s.compliance);
  const proposalGeneratedAt = useStore(s => s.proposalGeneratedAt);
  const setOpenModal = useStore(s => s.setOpenModal);
  const setCatalogMode = useStore(s => s.setCatalogMode);
  const setCatalogView = useStore(s => s.setCatalogView);
  const setInspectorTab = useStore(s => s.setInspectorTab);
  const setEditingRoomShape = useStore(s => s.setEditingRoomShape);
  const setDrawingZone = useStore(s => s.setDrawingZone);
  const setHeatmapMetric = useStore(s => s.setHeatmapMetric);
  const clearSelection = useStore(s => s.clearSelection);
  const applyScannedRoom = useStore(s => s.applyScannedRoom);
  const setHint = useStore(s => s.setHint);

  const importScan = async () => {
    const f = await pickRoomScanFile();
    if (!f) return;
    try {
      const scan = await importRoomPlanFile(f);
      applyScannedRoom(scan);
      setHint(scanSummary(scan));
    } catch (err) {
      setHint(err instanceof Error ? err.message : 'Could not import that scan.');
    }
  };

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const setCollapsedPersist = (v: boolean) => {
    setCollapsed(v);
    try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch { /* noop */ }
  };

  const speakers = equipment.filter(e => e.category === 'audio-speaker');
  const panels = equipment.filter(e => e.category === 'acoustic');
  const rt60At1k = rt60?.byBand[1000] ?? null;

  const steps: StepDef[] = [
    {
      id: 'room', label: 'Room', icon: 'cube',
      blurb: 'Set the room size and shape, then click any wall, floor, or ceiling to assign its real material — drywall, concrete, glass, carpet. Materials drive everything downstream.',
      done: room.shape.length >= 3 && room.height > 0,
      actions: [
        { label: 'Import room scan', run: () => { void importScan(); } },
        { label: 'Edit room shape', run: () => setEditingRoomShape(true) },
        { label: 'Browse materials', run: () => { setCatalogView('library'); setCatalogMode('materials'); } },
        { label: 'Room properties', run: () => { clearSelection(); setInspectorTab('properties'); } },
      ],
    },
    {
      id: 'audience', label: 'Audience', icon: 'users',
      blurb: 'Tell the model who it\'s for: set the seat count, and draw audience zones for balconies or distinct seating areas. Occupied seats absorb sound — it changes the answer.',
      done: room.occupancy > 0 || zones.length > 0,
      actions: [
        { label: 'Set seat count', run: () => { clearSelection(); setInspectorTab('properties'); } },
        { label: 'Draw audience zone', run: () => setDrawingZone(true) },
        { label: 'Place seating', run: () => { setCatalogView('library'); setCatalogMode('furniture'); } },
      ],
    },
    {
      id: 'system', label: 'System', icon: 'speaker',
      blurb: 'Place loudspeakers from the catalog — drag onto the room or use “+ Place”. Start with mains, add subs and fills. Each speaker is aimed automatically; fine-tune in the Inspector.',
      done: speakers.length > 0,
      actions: [
        { label: 'Browse speakers', run: () => { setCatalogView('library'); setCatalogMode('speakers'); } },
        { label: 'Insert sub array', run: () => setOpenModal('sub-array') },
      ],
    },
    {
      id: 'simulate', label: 'Simulate', icon: 'heatmap',
      blurb: 'The heatmap shows SPL coverage live. Check evenness front-to-back, then open the Acoustics tab for RT60, clarity, and speech intelligibility (STI).',
      done: speakers.length > 0 && heatmap != null,
      actions: [
        { label: 'SPL coverage', run: () => setHeatmapMetric('spl') },
        { label: 'Acoustics report', run: () => setInspectorTab('acoustics') },
      ],
    },
    {
      id: 'treat', label: 'Treat', icon: 'panel2',
      blurb: 'If reverb is above target, add acoustic treatment. Auto-treat places panels at the reflection points that matter and sizes the dose to hit your target RT60.',
      done: panels.length > 0 || (rt60At1k != null && rt60At1k <= compliance.rt60Max + 0.1),
      actions: [
        { label: 'Auto-treat room…', run: () => setOpenModal('auto-treat') },
        { label: 'Browse treatment', run: () => { setCatalogView('library'); setCatalogMode('acoustic'); } },
      ],
    },
    {
      id: 'propose', label: 'Propose', icon: 'bag',
      blurb: 'Turn the design into a client-ready document: equipment list with pricing, labor, predicted performance, and your branding — generated in one click.',
      done: proposalGeneratedAt != null,
      actions: [
        { label: 'Generate proposal', run: () => setOpenModal('proposal') },
        { label: 'BOM & quote', run: () => setOpenModal('bom') },
      ],
    },
  ];

  // The "current" step = first incomplete one (or the last step when all done).
  const currentIdx = Math.max(0, steps.findIndex(st => !st.done));
  const allDone = steps.every(st => st.done);
  const expanded = steps.find(st => st.id === expandedStep) ?? null;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsedPersist(false)}
        title="Open the guided design flow"
        style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 24,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'rgba(18,21,26,.92)', color: 'rgba(255,255,255,.85)',
          border: '1px solid rgba(255,255,255,.14)', borderRadius: 999,
          padding: '5px 12px', fontSize: 11.5, fontFamily: 'Montserrat', fontWeight: 700,
          letterSpacing: '0.06em', cursor: 'pointer',
        }}>
        <Icon name="info" size={13}/> GUIDE
        {!allDone && (
          <span style={{
            background: 'var(--royal-blue)', color: '#fff', borderRadius: 999,
            fontSize: 10, padding: '1px 7px',
          }}>{steps.filter(st => st.done).length}/{steps.length}</span>
        )}
      </button>
    );
  }

  return (
    <div style={{
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 24,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      pointerEvents: 'none',
    }}>
      {/* Step rail */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2,
        background: 'rgba(18,21,26,.92)', borderRadius: 999,
        border: '1px solid rgba(255,255,255,.10)',
        padding: '4px 6px', pointerEvents: 'auto',
        boxShadow: '0 4px 16px rgba(0,0,0,.25)',
      }}>
        {steps.map((st, i) => {
          const isCurrent = i === currentIdx && !allDone;
          const isExpanded = expandedStep === st.id;
          return (
            <div key={st.id} style={{ display: 'flex', alignItems: 'center' }}>
              {i > 0 && <div style={{ width: 14, height: 1, background: steps[i - 1].done ? 'rgba(47,158,94,.6)' : 'rgba(255,255,255,.15)' }}/>}
              <button
                onClick={() => setExpandedStep(isExpanded ? null : st.id)}
                title={st.blurb}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: isExpanded ? 'rgba(26,79,191,.35)' : isCurrent ? 'rgba(26,79,191,.22)' : 'transparent',
                  border: isCurrent ? '1px solid rgba(46,135,245,.5)' : '1px solid transparent',
                  borderRadius: 999, padding: '4px 10px', cursor: 'pointer',
                  color: st.done ? 'rgba(255,255,255,.85)' : isCurrent ? '#fff' : 'rgba(255,255,255,.55)',
                  fontFamily: 'Montserrat', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                }}>
                <span style={{
                  width: 15, height: 15, borderRadius: '50%', display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center',
                  background: st.done ? '#2F9E5E' : 'rgba(255,255,255,.12)',
                  color: '#fff', fontSize: 9,
                }}>
                  {st.done ? '✓' : i + 1}
                </span>
                {st.label}
              </button>
            </div>
          );
        })}
        <div style={{ width: 8 }}/>
        <button
          onClick={() => setCollapsedPersist(true)}
          title="Hide the guide"
          style={{
            background: 'transparent', border: 0, color: 'rgba(255,255,255,.45)',
            cursor: 'pointer', padding: '2px 6px', borderRadius: 999, fontSize: 13, lineHeight: 1,
          }}>×</button>
      </div>

      {/* Expanded guidance card */}
      {expanded && (
        <div style={{
          maxWidth: 480, background: 'rgba(18,21,26,.95)', color: 'rgba(255,255,255,.85)',
          border: '1px solid rgba(255,255,255,.12)', borderRadius: 12,
          padding: '12px 14px', pointerEvents: 'auto',
          boxShadow: '0 6px 24px rgba(0,0,0,.3)',
          fontSize: 12.5, lineHeight: 1.5,
        }}>
          {expanded.blurb}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {expanded.actions.map(a => (
              <button key={a.label}
                onClick={() => { a.run(); setExpandedStep(null); }}
                style={{
                  background: 'var(--royal-blue)', color: '#fff', border: 0,
                  borderRadius: 999, padding: '5px 12px', cursor: 'pointer',
                  fontFamily: 'Montserrat', fontSize: 11, fontWeight: 700,
                }}>{a.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

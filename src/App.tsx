import React, { Suspense, useEffect } from 'react';
import { useStore } from './stores/useStore';
import { TopBar } from './components/chrome/TopBar';
import { ToolRail } from './components/chrome/ToolRail';
import { StatusStrip } from './components/chrome/StatusStrip';
import { Catalog } from './components/catalog/Catalog';
import { Inspector } from './components/inspector/Inspector';
import { Viewport, ViewportOverlays } from './components/viewport/Viewport';
import { CommandPalette } from './components/CommandPalette';
import { Tour } from './components/Tour';
import { DesignFlow } from './components/chrome/DesignFlow';
// Welcome is shown on every fresh load (initial openModal = 'welcome'), so
// keep it eagerly imported — lazy-loading would add a network round-trip
// to first paint without saving any bundle weight that isn't already on
// the critical path.
import { WelcomeModal } from './components/modals/Welcome';

// ===== Lazy-loaded modals =====
// Each modal is bundled as its own chunk and only fetched the first time
// the user opens it. The wrapping `openModal === '...'` gate at render
// time means React.lazy's import promise doesn't fire until then either —
// so first paint never pays for code paths the user may never visit.
const ExportModal          = React.lazy(() => import('./components/modals/Export')         .then(m => ({ default: m.ExportModal })));
const ShareModal           = React.lazy(() => import('./components/modals/Share')          .then(m => ({ default: m.ShareModal })));
const NewProjectModal      = React.lazy(() => import('./components/modals/NewProject')     .then(m => ({ default: m.NewProjectModal })));
const CustomEquipmentModal = React.lazy(() => import('./components/modals/CustomEquipment').then(m => ({ default: m.CustomEquipmentModal })));
const BomModal             = React.lazy(() => import('./components/modals/BOM')            .then(m => ({ default: m.BomModal })));
const SubArrayModal        = React.lazy(() => import('./components/modals/SubArray')       .then(m => ({ default: m.SubArrayModal })));
const SnapshotModal        = React.lazy(() => import('./components/modals/Snapshot')       .then(m => ({ default: m.SnapshotModal })));
const AutoTreatModal       = React.lazy(() => import('./components/modals/AutoTreat')      .then(m => ({ default: m.AutoTreatModal })));
const ProposalModal        = React.lazy(() => import('./components/modals/Proposal')       .then(m => ({ default: m.ProposalModal })));

const AUTOSAVE_KEY = 'beacon.autosave.v1';
import {
  computeSTI,
  generateRecommendations,
  getActiveSpeakers,
  applyGroupSettings,
} from './engine/acoustics';
import { getHeatmapClient, getCompareHeatmapClient } from './engine/heatmapClient';
import { tryDecodeShareHash, buildProjectFile } from './exporters/json';
import { coerceProject } from './engine/projectValidation';
import { analyzeModes, computeModalField } from './engine/modal';

export default function App() {
  const presentationMode = useStore(s => s.presentationMode);
  const setPresentationMode = useStore(s => s.setPresentationMode);
  const undo = useStore(s => s.undo);
  const redo = useStore(s => s.redo);
  const toggleHeatmap = useStore(s => s.toggleHeatmap);
  const toggleCones = useStore(s => s.toggleCones);
  const toggleMesh = useStore(s => s.toggleMesh);
  const setActiveAppTab = useStore(s => s.setActiveAppTab);
  const setOpenModal = useStore(s => s.setOpenModal);
  const selectedId = useStore(s => s.selectedId);
  const deleteEquipment = useStore(s => s.deleteEquipment);
  const duplicateEquipment = useStore(s => s.duplicateEquipment);
  const setSelected = useStore(s => s.setSelected);
  const hint = useStore(s => s.hint);
  const loadProject = useStore(s => s.loadProject);

  // ===== Apply theme to <html> =====
  const theme = useStore(s => s.theme);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // ===== On mount: try to decode a #bavl=... share link, or restore autosave =====
  useEffect(() => {
    const file = tryDecodeShareHash();
    if (file) { loadProject(file); return; }
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) {
        // Validate the autosave blob BEFORE trusting it — a partially-written
        // or schema-stale autosave must not crash the app on launch.
        const project = coerceProject(JSON.parse(saved));
        if (project) {
          // Auto-restore (no blocking confirm() — native dialogs freeze the
          // first paint and hang automated/headless environments). The hint
          // tells the user what happened; File → New starts fresh.
          loadProject(project);
          useStore.getState().setHint(`Restored "${project.meta.name}" from autosave — File → New for a fresh project`);
          useStore.getState().setOpenModal(null);
        }
      }
    } catch { /* corrupt autosave — ignore and start fresh */ }
  }, [loadProject]);

  // ===== Autosave loop =====
  useEffect(() => {
    const interval = window.setInterval(() => {
      const state = useStore.getState();
      if (!state.isDirty) return;
      try {
        const file = buildProjectFile(state);
        let serialized = JSON.stringify(file);
        // localStorage quota is typically ~5MB. If our serialized state is too
        // large (likely due to a big floor-plan image), drop the image and warn.
        if (serialized.length > 4_500_000 && file.room.floorPlan) {
          const stripped = { ...file, room: { ...file.room, floorPlan: undefined } };
          serialized = JSON.stringify(stripped);
          state.setHint('Autosave skipped the floor plan image (too large for browser storage)');
        }
        localStorage.setItem(AUTOSAVE_KEY, serialized);
        state.markAutoSaved();
      } catch (e) {
        // Quota exceeded or other failure — try one more time without floor plan
        try {
          const state2 = useStore.getState();
          const file = buildProjectFile(state2);
          const stripped = { ...file, room: { ...file.room, floorPlan: undefined } };
          localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(stripped));
          state2.markAutoSaved();
          state2.setHint('Autosave skipped the floor plan image to fit storage');
        } catch {
          // Still failing — storage is full or disabled (private browsing).
          // Don't fail silently: flag it so the status strip shows a persistent
          // warning and the user knows to export their work manually.
          const state3 = useStore.getState();
          state3.markAutoSaveFailed();
          state3.setHint('⚠ Autosave failed — browser storage is full or disabled. Export your project to avoid losing work.');
        }
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // ===== Live simulation: recompute when room/equipment/freq/noiseFloor change =====
  useEffect(() => {
    let pending: number | undefined;
    const unsub = useStore.subscribe((state, prev) => {
      const dirty = state.simulationDirty;
      const inputsChanged = state.room !== prev.room || state.equipment !== prev.equipment
        || state.zones !== prev.zones
        || state.activeFreq !== prev.activeFreq || state.noiseFloor !== prev.noiseFloor
        || state.useReflections !== prev.useReflections
        || state.ismMaxOrder !== prev.ismMaxOrder
        || state.useCoherentSum !== prev.useCoherentSum
        || state.useRayTracing !== prev.useRayTracing
        || state.rayQuality !== prev.rayQuality
        || state.earHeightFt !== prev.earHeightFt
        || state.useModalLF !== prev.useModalLF
        || state.modalFreq !== prev.modalFreq
        // Switching to/from T30 metric triggers per-cell ray tracing.
        || (state.heatmapMetric === 't30') !== (prev.heatmapMetric === 't30')
        // Switching to/from modal metric triggers the modal field compute.
        || (state.heatmapMetric === 'modal') !== (prev.heatmapMetric === 'modal');
      if (!dirty && !inputsChanged) return;
      // Debounce so we don't recompute on every keystroke
      if (pending !== undefined) clearTimeout(pending);
      pending = window.setTimeout(() => runSimulation(), 120);
    });
    runSimulation();
    return () => {
      unsub();
      if (pending !== undefined) clearTimeout(pending);
    };
  }, []);

  // ===== Compare-side simulation: recompute the partner scenario when its inputs change =====
  useEffect(() => {
    let pending: number | undefined;
    const unsub = useStore.subscribe((state, prev) => {
      const idChanged = state.compareScenarioId !== prev.compareScenarioId;
      const partnerChanged = state.scenarios !== prev.scenarios;
      const freqChanged = state.activeFreq !== prev.activeFreq;
      const metricChanged = state.heatmapMetric !== prev.heatmapMetric;
      const reflChanged = state.useReflections !== prev.useReflections
        || state.ismMaxOrder !== prev.ismMaxOrder
        || state.useCoherentSum !== prev.useCoherentSum
        || state.useRayTracing !== prev.useRayTracing
        || state.rayQuality !== prev.rayQuality
        || state.earHeightFt !== prev.earHeightFt;
      if (!idChanged && !partnerChanged && !freqChanged && !metricChanged && !reflChanged) return;
      if (pending !== undefined) clearTimeout(pending);
      pending = window.setTimeout(() => runCompareSimulation(), 120);
    });
    runCompareSimulation();
    return () => {
      unsub();
      if (pending !== undefined) clearTimeout(pending);
    };
  }, []);

  // ===== Keyboard shortcuts =====
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT';

      // Always allow Escape for closing
      if (e.key === 'Escape') {
        const st = useStore.getState();
        if (st.droppingAnnotation) { st.setDroppingAnnotation(false); return; }
        if (st.wiringMode) {
          if (st.wiringStartId) { st.setWiringStartId(null); }
          else { st.setWiringMode(false); }
          return;
        }
        if (st.editingRoomShape) { st.cancelEditingRoomShape(); return; }
        if (st.drawingZone) { st.cancelDrawingZone(); return; }
        if (st.measureMode) { st.setMeasureMode(false); return; }
        if (st.layersOpen) { st.setLayersOpen(false); return; }
        if (st.settingsOpen) { st.setSettingsOpen(false); return; }
        if (presentationMode) setPresentationMode(false);
        else if (st.openModal) setOpenModal(null);
        else setSelected(null);
        return;
      }

      if (inField) return;

      const cmd = e.ctrlKey || e.metaKey;
      if (cmd && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (cmd && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return; }
      if (cmd && e.key === '0') { e.preventDefault(); useStore.getState().resetView(); return; }
      if (cmd && e.key.toLowerCase() === 's') { e.preventDefault(); setOpenModal('export'); return; }
      if (cmd && e.key.toLowerCase() === 'e') { e.preventDefault(); setOpenModal('export'); return; }
      if (cmd && e.key.toLowerCase() === 'd') {
        const ids = useStore.getState().selectedIds;
        if (ids.length > 0) {
          e.preventDefault();
          const st = useStore.getState();
          st.beginHistoryGroup();
          for (const id of ids) {
            const item = st.equipment.find(i => i.id === id);
            if (!item) continue;
            const copy = { ...item,
              id: `${item.kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,5)}`,
              x: item.x + 2, y: item.y + 2 };
            st.addEquipmentLive(copy);
          }
          return;
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = useStore.getState().selectedIds;
        if (ids.length > 0) {
          e.preventDefault();
          const st = useStore.getState();
          st.beginHistoryGroup();
          for (const id of ids) st.deleteEquipmentLive(id);
          st.clearSelection();
          return;
        }
      }

      // ===== Selected-item manipulation shortcuts =====
      // Only fire when something is selected — avoids hijacking single-key
      // shortcuts (R refresh-sim, etc.) when the user isn't actively editing.
      const selIds = useStore.getState().selectedIds;
      if (selIds.length > 0) {
        const fine = e.shiftKey;
        const nudgeFt = fine ? 0.1 : 0.5;
        const rotateDeg = fine ? 5 : 15;
        const zStepFt = fine ? 0.25 : 1;
        const updateLive = useStore.getState().updateEquipmentLive;
        const begin = useStore.getState().beginHistoryGroup;
        const eq = useStore.getState().equipment;
        // Arrow keys — nudge xy. Up/Down map to -y / +y so "up" feels
        // like "toward the front of the room" in our +y-toward-back layout.
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
            e.key === 'ArrowUp'   || e.key === 'ArrowDown') {
          e.preventDefault();
          begin();
          const dx = e.key === 'ArrowLeft' ? -nudgeFt : e.key === 'ArrowRight' ? +nudgeFt : 0;
          const dy = e.key === 'ArrowUp'   ? -nudgeFt : e.key === 'ArrowDown'  ? +nudgeFt : 0;
          for (const id of selIds) {
            const it = eq.find(i => i.id === id);
            if (!it) continue;
            updateLive(id, { x: it.x + dx, y: it.y + dy });
          }
          return;
        }
        // R / Shift+R — rotate the selected items in place. Rotation
        // also rotates aim by the same delta so directional fixtures
        // (speakers, lights) keep their relative aim.
        if (e.key.toLowerCase() === 'r' && !cmd) {
          e.preventDefault();
          begin();
          const sign = e.shiftKey ? -1 : +1;     // Shift = rotate counter-clockwise
          const delta = rotateDeg * sign;
          for (const id of selIds) {
            const it = eq.find(i => i.id === id);
            if (!it) continue;
            updateLive(id, {
              rotation: ((it.rotation ?? 0) + delta) % 360,
              ...(it.aim != null ? { aim: ((it.aim ?? 0) + delta) % 360 } : {}),
            });
          }
          return;
        }
        // PageUp / PageDown — change Z height
        if (e.key === 'PageUp' || e.key === 'PageDown') {
          e.preventDefault();
          begin();
          const dz = e.key === 'PageUp' ? +zStepFt : -zStepFt;
          for (const id of selIds) {
            const it = eq.find(i => i.id === id);
            if (!it) continue;
            updateLive(id, { z: Math.max(0, it.z + dz) });
          }
          return;
        }
        // Tilt up/down with [ / ]
        if (e.key === '[' || e.key === ']') {
          e.preventDefault();
          begin();
          const dt = e.key === ']' ? +rotateDeg : -rotateDeg;
          for (const id of selIds) {
            const it = eq.find(i => i.id === id);
            if (!it || it.tilt == null) continue;
            updateLive(id, { tilt: Math.max(-90, Math.min(90, (it.tilt ?? 0) + dt)) });
          }
          return;
        }
      }

      if (e.key.toLowerCase() === 'g') { e.preventDefault(); toggleMesh(); return; }
      if (e.key.toLowerCase() === 'h') { e.preventDefault(); toggleHeatmap(); return; }
      if (e.key.toLowerCase() === 'c') { e.preventDefault(); toggleCones(); return; }
      if (e.key.toLowerCase() === 'f') { e.preventDefault(); setPresentationMode(!presentationMode); return; }
      if (e.key.toLowerCase() === 'r') { e.preventDefault(); runSimulation(); return; }

      if (e.key === '1') setActiveAppTab('design');
      if (e.key === '2') setActiveAppTab('acoustics');
      if (e.key === '3') setActiveAppTab('bom');
      if (e.key === '4') { setActiveAppTab('present'); setPresentationMode(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presentationMode, selectedId, duplicateEquipment, deleteEquipment, undo, redo, toggleHeatmap,
      toggleCones, toggleMesh, setPresentationMode, setActiveAppTab, setOpenModal, setSelected]);

  const catalogCollapsed = useStore(s => s.catalogCollapsed);
  const inspectorCollapsed = useStore(s => s.inspectorCollapsed);
  // Drives the lazy-modal gate. Each modal only mounts (and only fetches
  // its chunk) when openModal matches its key — so a user who never opens
  // BOM never downloads BOM.
  const openModal = useStore(s => s.openModal);

  const workspaceStyle: React.CSSProperties | undefined = presentationMode
    ? undefined
    : {
        gridTemplateColumns:
          `56px ${catalogCollapsed ? 36 : 320}px 1fr ${inspectorCollapsed ? 36 : 340}px`,
      };

  return (
    <>
      {!presentationMode && <TopBar />}
      <div className={`workspace ${presentationMode ? 'present-mode' : ''}`} style={workspaceStyle}>
        {!presentationMode && <ToolRail />}
        {!presentationMode && <Catalog />}
        <div className="viewport">
          <Viewport />
          <ViewportOverlays />
          {!presentationMode && <DesignFlow />}
          {hint && <div className="hint-flash"><span style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>✓</span>{hint}</div>}
          {presentationMode && (
            <button
              onClick={() => useStore.getState().setPresentationMode(false)}
              style={{
                position: 'absolute', top: 16, right: 16, zIndex: 30,
                background: 'rgba(255,255,255,0.95)', color: '#12151A',
                padding: '8px 14px', borderRadius: 999, border: 0,
                fontFamily: 'Montserrat', fontWeight: 600, fontSize: 12,
                cursor: 'pointer', pointerEvents: 'auto',
              }}>
              Exit presentation (Esc)
            </button>
          )}
        </div>
        {!presentationMode && <Inspector />}
      </div>
      {!presentationMode && <StatusStrip />}

      <WelcomeModal />
      {/* Lazy modal mount-points. Suspense fallback is `null` because every
          modal already shows its own loading state once it opens, and the
          chunk is small enough that the gap is imperceptible on a warm
          network. The conditional gate prevents the lazy import from
          firing until the user actually opens that modal. */}
      <Suspense fallback={null}>
        {openModal === 'export'           && <ExportModal />}
        {openModal === 'share'            && <ShareModal />}
        {openModal === 'new-project'      && <NewProjectModal />}
        {openModal === 'custom-equipment' && <CustomEquipmentModal />}
        {openModal === 'bom'              && <BomModal />}
        {openModal === 'sub-array'        && <SubArrayModal />}
        {openModal === 'snapshot'         && <SnapshotModal />}
        {openModal === 'auto-treat'       && <AutoTreatModal />}
        {openModal === 'proposal'         && <ProposalModal />}
      </Suspense>
      <CommandPalette />
      <Tour />
    </>
  );
}

// Compute the partner scenario's heatmaps for the A/B wipe.
async function runCompareSimulation() {
  const state = useStore.getState();
  const id = state.compareScenarioId;
  if (!id) {
    if (state.compareHeatmap || state.compareClarityHeatmap || state.compareArrivalHeatmap || state.compareRT60) {
      state.setCompareSimulation(null, null, null, null);
    }
    return;
  }
  const sc = state.scenarios.find(s => s.id === id);
  if (!sc) {
    state.setCompareSimulation(null, null, null, null);
    return;
  }
  const allSpeakers = sc.snapshot.equipment.filter(e => e.category === 'audio-speaker')
    .map(s => applyGroupSettings(s, sc.snapshot.groups));
  const activeSpeakers = getActiveSpeakers(allSpeakers);
  const panels = sc.snapshot.equipment.filter(e => e.category === 'acoustic');
  const obstacles = sc.snapshot.equipment;       // engine filters internally via affectsAcoustics()
  const earlyMs = state.heatmapMetric === 'c80' ? 80 : 50;

  const result = await getCompareHeatmapClient().run({
    room: sc.snapshot.room,
    speakers: activeSpeakers,
    panels,
    zones: sc.snapshot.zones,
    obstacles,
    freq: state.activeFreq,
    earlyMs,
    useReflections: state.useReflections,
    maxOrder: state.ismMaxOrder,
    useCoherentSum: state.useCoherentSum,
    useRayTracing: state.useRayTracing,
    rayQuality: state.rayQuality,
    computeT30Heatmap: state.heatmapMetric === 't30' && state.useRayTracing,
    earHeightFt: state.earHeightFt,
  });
  if (!result) return; // superseded
  useStore.getState().setCompareSimulation(
    result.rt60, result.heatmap, result.clarity, result.arrival,
  );
}

// Pulled out to keep effect deps simple. Reads/writes store directly.
async function runSimulation() {
  const state = useStore.getState();
  const allSpeakers = state.equipment.filter(e => e.category === 'audio-speaker')
    .map(s => applyGroupSettings(s, state.groups));
  const activeSpeakers = getActiveSpeakers(allSpeakers);
  const panels = state.equipment.filter(e => e.category === 'acoustic');
  const obstacles = state.equipment;       // engine filters internally via affectsAcoustics()
  const earlyMs = state.heatmapMetric === 'c80' ? 80 : 50;

  const result = await getHeatmapClient().run({
    room: state.room,
    speakers: activeSpeakers,
    panels,
    zones: state.zones,
    obstacles,
    freq: state.activeFreq,
    earlyMs,
    useReflections: state.useReflections,
    maxOrder: state.ismMaxOrder,
    useCoherentSum: state.useCoherentSum,
    useRayTracing: state.useRayTracing,
    rayQuality: state.rayQuality,
    computeT30Heatmap: state.heatmapMetric === 't30' && state.useRayTracing,
    earHeightFt: state.earHeightFt,
  });
  if (!result) return; // superseded by a newer request

  const splAvg = result.heatmap?.avg ?? 75;
  // IEC 60268-16 STI: full byBand RT60 from the engine, single SPL value
  // assumed flat across bands (good first approximation), single noise-floor
  // value applied flat. Swap to per-band SPL once we run the heatmap at all
  // octaves (currently we only render the active band, so flat is the best
  // we can do without 6× the compute).
  const noiseFloor = useStore.getState().noiseFloor;
  const splFlat: Record<number, number> = {
    125: splAvg, 250: splAvg, 500: splAvg, 1000: splAvg,
    2000: splAvg, 4000: splAvg, 8000: splAvg,
  };
  const noiseFlat: Record<number, number> = {
    125: noiseFloor, 250: noiseFloor, 500: noiseFloor, 1000: noiseFloor,
    2000: noiseFloor, 4000: noiseFloor, 8000: noiseFloor,
  };
  const voice = useStore.getState().room.voice ?? 'male';
  const sti = computeSTI(result.rt60.byBand, splFlat, noiseFlat, voice);
  const recs = generateRecommendations({
    room: useStore.getState().room,
    speakers: activeSpeakers,
    panelItems: panels,
    rt60: result.rt60,
    heatmap: result.heatmap,
    sti: sti.sti,
  });
  useStore.getState().setSimulation(
    result.rt60, result.heatmap, result.clarity, result.arrival,
    sti.sti, sti.rating, recs, result.rays, result.t30Heatmap, result.spatial,
  );

  // ===== Low-frequency modal engine =====
  // Wave-accurate LF behavior the geometrical solver can't represent. Cheap
  // (closed-form modal sum) so it runs inline on the main thread after the
  // geometrical result returns. Analysis (modes + Schroeder + warnings) is
  // always computed when enabled; the standing-wave heatmap only when the
  // modal metric is being viewed.
  {
    const st = useStore.getState();
    if (st.useModalLF) {
      const t60Mid = result.rt60.byBand[1000] ?? result.rt60.average ?? 1.0;
      const t60LF = result.rt60.byBand[125] ?? t60Mid;
      const analysis = analyzeModes(st.room, t60Mid);
      const wantField = st.heatmapMetric === 'modal';
      const modalField = wantField
        ? computeModalField(st.room, activeSpeakers, {
            freq: st.modalFreq,
            t60LF,
            resolutionFt: 2,
            earHeightFt: st.earHeightFt,
            anchorSPL: result.heatmap?.avg ?? 85,
            tempF: st.room.temperatureF ?? 70,
          })
        : null;
      useStore.getState().setModalResults(analysis, modalField);
    } else if (st.modalAnalysis || st.modalHeatmap) {
      useStore.getState().setModalResults(null, null);
    }
  }
}

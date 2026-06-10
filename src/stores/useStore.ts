import { create } from 'zustand';
import type {
  RoomState, EquipmentItem, Zone, SpeakerGroup,
  ProjectMeta, ProjectFile, RT60Result, HeatmapData, Recommendation,
  EquipmentTemplate, Point, ComplianceTargets, Scenario, Annotation,
  Connection, CableType,
} from '../types';
import { defaultRoom, defaultEquipment, TEMPLATES } from '../templates';
import { defaultComplianceTargets } from '../engine/acoustics';
import { planTreatment, type TreatmentOptions, type TreatmentResult } from '../engine/treatment';
import { coerceProject } from '../engine/projectValidation';
import { templateById } from '../constants/equipmentLibrary';
import { buildItemFromTemplate } from '../utils/itemBuilder';
import type { ScanImportResult } from '../importers/roomplan';

export type LayerKey =
  | 'audio-speaker' | 'audio-signal' | 'video' | 'lighting'
  | 'acoustic' | 'reference' | 'infrastructure'
  | 'pews' | 'mesh' | 'cones' | 'heatmap';

export type ViewMode = 'iso' | 'top' | 'walk';

// =============== Snapshotted, undoable state ===============
interface Snapshot {
  room: RoomState;
  equipment: EquipmentItem[];
  zones: Zone[];
  groups: SpeakerGroup[];
  annotations: Annotation[];
  connections: Connection[];
}

const HISTORY_LIMIT = 80;

interface Store {
  // ===== Project meta =====
  meta: ProjectMeta;
  isDirty: boolean;

  // ===== Snapshotted state =====
  room: RoomState;
  equipment: EquipmentItem[];
  zones: Zone[];
  groups: SpeakerGroup[];
  annotations: Annotation[];
  connections: Connection[];

  // ===== Wiring tool =====
  wiringMode: boolean;
  wiringStartId: string | null;
  /** Cable type used for the next connection started in wiring mode. */
  wiringCableType: CableType;

  // ===== Undo / redo =====
  past: Snapshot[];
  future: Snapshot[];

  // ===== Selection / UI =====
  selectedId: string | null;        // first / primary selection (back-compat)
  selectedIds: string[];            // full multi-selection set
  hoveredId: string | null;
  /** A selected room surface (wall segment / floor / ceiling facet) — mutually
   *  exclusive with equipment selection. Drives the Inspector's surface-material
   *  panel and the viewport highlight. */
  selectedSurface: { kind: 'wall' | 'floor' | 'ceiling'; segmentIndex: number } | null;
  catalogMode: 'speakers' | 'acoustic' | 'materials' | 'furniture' | 'video' | 'lighting' | 'signal' | 'infra';
  catalogView: 'library' | 'placed';
  brandFilter: string;
  searchQuery: string;
  inspectorTab: 'properties' | 'acoustics' | 'notes';

  // ===== Simulation flags =====
  showHeatmap: boolean;
  showCones: boolean;
  showRays: boolean;
  showMesh: boolean;
  showContours: boolean;
  /** Specular reflections (image-source method) folded into the SPL heatmap
   *  + C50/C80 clarity. Off by default — when on, the simulation becomes
   *  more accurate at the cost of additional per-cell computation. */
  useReflections: boolean;
  /** Render virtual image-source markers in the viewport when reflections
   *  are on. Useful for debugging / educating the room about where echoes
   *  are virtually originating. */
  showImageSources: boolean;
  /** ISM max bounce order. 1 = first-order only (cheap, ~6 sources/speaker),
   *  2 = corner reflections (Sprint 2 default, ~30 sources/speaker), 3 = late
   *  early reflections (~150 sources/speaker, slow). Ignored when reflections
   *  are off. */
  ismMaxOrder: 1 | 2 | 3;
  /** Phase-aware (coherent) source summation. When on, the SPL heatmap uses
   *  complex pressure summation at the active band's frequency, revealing
   *  comb-filter nulls between coincident sources and between direct +
   *  reflection paths. Coherence factor decays with frequency (full at
   *  ≤250 Hz, ~0.1 at ≥2 kHz) so HF doesn't show unrealistically deep nulls. */
  useCoherentSum: boolean;
  /** Sprint 3 — stochastic ray tracing for the late reverberant tail.
   *  When true, the engine traces thousands of rays per speaker through
   *  the room geometry, builds an energy decay curve from the resulting
   *  per-band time histograms, and reports T20/T30/EDT in place of the
   *  Sabine/Eyring statistical estimate. */
  useRayTracing: boolean;
  /** Ray-tracing quality preset. low ≈ 1k rays/source, medium ≈ 5k,
   *  high ≈ 20k. Higher = more accurate, longer compute time. */
  rayQuality: 'low' | 'medium' | 'high';
  /** Low-frequency modal engine. When on, the room's eigenmodes are computed
   *  and a wave-accurate standing-wave field is available at `modalFreq` —
   *  the LF behavior that geometrical methods (and EASE) cannot represent. */
  useModalLF: boolean;
  /** Frequency (Hz) the modal standing-wave heatmap is visualized at. */
  modalFreq: number;
  /** Sprint C11 — global ear height in feet for the heatmap sampling
   *  plane. Zones with their own floor/ear height override this for cells
   *  that fall inside the zone polygon. 4 ft = seated audience (default),
   *  5.5 ft = standing, 7 ft = stage performer ears (above riser), etc. */
  earHeightFt: number;
  activeFreq: '125' | '1k' | '4k' | 'broadband';
  heatmapOpacity: number;
  noiseFloor: number;

  // ===== Cached simulation results =====
  rt60: RT60Result | null;
  heatmap: HeatmapData | null;
  clarityHeatmap: HeatmapData | null;
  arrivalHeatmap: HeatmapData | null;
  heatmapMetric: 'spl' | 'c50' | 'c80' | 'arrival' | 't30' | 'modal';
  sti: number | null;
  stiRating: string;
  recommendations: Recommendation[];
  simulationDirty: boolean;
  /** Sprint 3 — cached ray-tracing summary (T20/T30/EDT byBand + EDC). Null
   *  when ray tracing is off or hasn't yet completed. */
  raysSummary: import('../engine/heatmap.worker').RaySummary | null;
  /** Sprint 4 — per-cell T30 heatmap from per-cell ray tracing. Only
   *  populated when heatmapMetric === 't30' AND useRayTracing. */
  t30Heatmap: HeatmapData | null;
  /** Sprint C13 — Lateral Fraction + IACC_E room-average. Null when
   *  reflections (ISM) are off; the metric is undefined without specular
   *  reflection geometry. */
  spatial: import('../types').SpatialMetricsResult | null;
  /** Low-frequency modal analysis (eigenmodes + Schroeder + warnings).
   *  Populated whenever useModalLF is on. */
  modalAnalysis: import('../engine/modal').ModalAnalysis | null;
  /** Standing-wave SPL field at modalFreq. Rendered when heatmapMetric === 'modal'. */
  modalHeatmap: HeatmapData | null;

  // ===== Modes (UI) =====
  presentationMode: boolean;
  /** Presentation rendering style — 'render' = the three.js photoreal view,
   *  'schematic' = the classic SVG iso/walk viewport. Phase C. */
  presentStyle: 'render' | 'schematic';
  activeAppTab: 'design' | 'acoustics' | 'bom' | 'present';
  hint: string | null;
  openModal: 'welcome' | 'export' | 'new-project' | 'share' | 'custom-equipment' | 'bom' | 'sub-array' | 'snapshot' | 'auto-treat' | 'proposal' | null;
  /** Timestamp of the last client-proposal generation — drives the Design
   *  Flow "Propose" step's completion check. Not persisted across loads. */
  proposalGeneratedAt: number | null;

  // ===== View / layers / measure =====
  viewMode: ViewMode;
  cameraYaw: number;     // radians; only used when viewMode === 'iso'
  cameraPitch: number;   // radians; only used when viewMode === 'iso'
  // Walk-through (first-person) camera. Position in feet; yaw/pitch in radians.
  walkEyeX: number;
  walkEyeY: number;
  walkEyeZ: number;      // standing eye height, default 5.5 ft
  walkYaw: number;
  walkPitch: number;
  fitVersion: number;
  layerVisibility: Record<LayerKey, boolean>;
  layersOpen: boolean;
  settingsOpen: boolean;
  gridSnap: boolean;
  measureMode: boolean;
  measurePoints: Point[];
  drawingZone: boolean;
  drawingZonePoints: Point[];
  editingRoomShape: boolean;
  editingRoomPoints: Point[];
  // Pan / zoom on top of fit-base
  tool: 'select' | 'hand';
  viewportZoom: number;
  viewportPanX: number;
  viewportPanY: number;

  // ===== Custom equipment =====
  customEquipment: EquipmentTemplate[];

  // ===== Compliance targets (project-editable) =====
  compliance: ComplianceTargets;

  // ===== Scenarios (saved layouts you can flip between) =====
  scenarios: Scenario[];
  activeScenarioId: string | null;

  // ===== A/B comparison wipe =====
  compareScenarioId: string | null;             // partner scenario; live state is the other side
  compareWipeX: number;                         // 0..1 — handle position normalized across viewport width
  compareHeatmap: HeatmapData | null;           // SPL heatmap for the partner snapshot
  compareClarityHeatmap: HeatmapData | null;    // C50/C80 heatmap for the partner snapshot
  compareArrivalHeatmap: HeatmapData | null;    // arrival heatmap for the partner snapshot
  compareRT60: RT60Result | null;               // RT60 of the partner snapshot

  // ===== Sidebar collapse =====
  catalogCollapsed: boolean;
  inspectorCollapsed: boolean;

  // ===== Theme =====
  theme: 'light' | 'dark';
  /** UI complexity mode. 'simple' hides expert-grade physics controls
   *  (ISM order, coherent sum, ray quality, modal frequency picker) behind
   *  sensible defaults so a mid-tier user sees outcomes, not parameters.
   *  'pro' exposes everything. Persisted per device. */
  uiMode: 'simple' | 'pro';

  // ===== Autosave =====
  lastAutoSaveAt: number | null; // ms timestamp
  /** True after an autosave attempt failed (quota exceeded / storage
   *  disabled). Surfaced in the status strip so the user knows their work
   *  is NOT being persisted and can export manually. Cleared on next success. */
  autoSaveFailed: boolean;

  // ===== Actions =====
  setMeta: (patch: Partial<ProjectMeta>) => void;
  applyTemplate: (templateId: string) => void;
  loadProject: (file: ProjectFile) => void;
  newProject: (name: string, clientName?: string) => void;

  setRoom: (patch: Partial<RoomState>) => void;
  /** Replace the room geometry with a phone LiDAR scan (RoomPlan import).
   *  Resets zones / stage / wall obstacles (they reference old coordinates),
   *  regenerates default surfaces for the new wall count, and places any
   *  furniture the scan recognized. Equipment is kept — reposition as needed. */
  applyScannedRoom: (scan: ScanImportResult) => void;
  setOccupied: (val: boolean) => void;
  setSurfaceMaterial: (kind: 'wall' | 'floor' | 'ceiling', segmentIndex: number, materialId: string) => void;
  /** Select a room surface (clears equipment selection). Pass null to clear. */
  selectSurface: (sel: { kind: 'wall' | 'floor' | 'ceiling'; segmentIndex: number } | null) => void;
  /** Assign a material to whatever surface is currently selected (no-op if none). */
  setSelectedSurfaceMaterial: (materialId: string) => void;

  addEquipment: (item: EquipmentItem) => void;
  updateEquipment: (id: string, patch: Partial<EquipmentItem>) => void;
  /** Same as updateEquipment but does NOT push history. Use during drag, then call beginHistoryGroup() once at drag start. */
  updateEquipmentLive: (id: string, patch: Partial<EquipmentItem>) => void;
  /** Add an item without pushing to history — pair with beginHistoryGroup() when batching. */
  addEquipmentLive: (item: EquipmentItem) => void;
  /** Delete an item without pushing to history — pair with beginHistoryGroup() when batching. */
  deleteEquipmentLive: (id: string) => void;
  /** Push the current state onto the undo stack as a single history entry (e.g. drag start). */
  beginHistoryGroup: () => void;
  deleteEquipment: (id: string) => void;
  duplicateEquipment: (id: string) => void;
  /** Replace N selected speakers with a single line-array item summing them.
   *  Returns the new line-array's id, or null if invalid (e.g. <2 speakers). */
  combineIntoLineArray: (ids: string[]) => string | null;
  /** Inverse: convert a line-array item into N stacked point-source boxes. */
  splitLineArray: (id: string) => void;
  addReferencePoint: (label?: string) => void;
  setStage: (stage: { width: number; depth: number; height: number } | null) => void;

  setSelected: (id: string | null) => void;
  addToSelection: (id: string) => void;
  toggleSelection: (id: string) => void;
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;
  setHovered: (id: string | null) => void;
  setCatalogMode: (m: Store['catalogMode']) => void;
  setCatalogView: (v: Store['catalogView']) => void;
  setBrandFilter: (b: string) => void;
  setSearchQuery: (q: string) => void;
  setInspectorTab: (t: Store['inspectorTab']) => void;

  toggleHeatmap: () => void;
  toggleCones: () => void;
  toggleRays: () => void;
  toggleMesh: () => void;
  toggleContours: () => void;
  toggleReflections: () => void;
  toggleImageSources: () => void;
  setIsmMaxOrder: (n: 1 | 2 | 3) => void;
  toggleCoherentSum: () => void;
  toggleRayTracing: () => void;
  setRayQuality: (q: 'low' | 'medium' | 'high') => void;
  toggleModalLF: () => void;
  setModalFreq: (hz: number) => void;
  /** Store modal results computed in the simulation loop. */
  setModalResults: (analysis: import('../engine/modal').ModalAnalysis | null, heatmap: HeatmapData | null) => void;
  setEarHeight: (ft: number) => void;
  setActiveFreq: (f: Store['activeFreq']) => void;
  setHeatmapOpacity: (v: number) => void;
  setNoiseFloor: (v: number) => void;

  setSimulation: (
    rt60: RT60Result,
    heatmap: HeatmapData | null,
    clarityHeatmap: HeatmapData | null,
    arrivalHeatmap: HeatmapData | null,
    sti: number | null,
    stiRating: string,
    recs: Recommendation[],
    rays?: import('../engine/heatmap.worker').RaySummary | null,
    t30Heatmap?: HeatmapData | null,
    spatial?: import('../types').SpatialMetricsResult | null,
  ) => void;
  setHeatmapMetric: (m: 'spl' | 'c50' | 'c80' | 'arrival' | 't30' | 'modal') => void;
  markSimulationDirty: () => void;

  setPresentationMode: (b: boolean) => void;
  setPresentStyle: (s: 'render' | 'schematic') => void;
  setActiveAppTab: (t: Store['activeAppTab']) => void;
  setHint: (h: string | null) => void;
  setOpenModal: (m: Store['openModal']) => void;

  setViewMode: (m: ViewMode) => void;
  setCamera: (yaw: number, pitch: number) => void;
  applyCameraPreset: (preset: 'iso' | 'top' | 'front' | 'side') => void;
  enterWalkthrough: () => void;
  setWalkPose: (patch: Partial<{ eyeX: number; eyeY: number; eyeZ: number; yaw: number; pitch: number }>) => void;
  bumpFit: () => void;
  setTool: (t: 'select' | 'hand') => void;
  setViewportZoom: (z: number) => void;
  setViewportPan: (x: number, y: number) => void;
  resetView: () => void;
  toggleLayer: (k: LayerKey) => void;
  setLayersOpen: (b: boolean) => void;
  setSettingsOpen: (b: boolean) => void;
  setGridSnap: (b: boolean) => void;
  setMeasureMode: (b: boolean) => void;
  pushMeasurePoint: (p: Point) => void;
  clearMeasure: () => void;

  // Zone CRUD + draw mode
  addZone: (zone: Zone) => void;
  updateZone: (id: string, patch: Partial<Zone>) => void;
  deleteZone: (id: string) => void;

  // Sprint C12 — Wall obstacle CRUD (interior vertical-rectangle obstacles
  // like balcony fronts, riser fronts, partitions).
  addWallObstacle: (w: import('../types').WallObstacle) => void;
  updateWallObstacle: (id: string, patch: Partial<import('../types').WallObstacle>) => void;
  deleteWallObstacle: (id: string) => void;
  /** Auto-generate (or refresh) a balcony-front obstacle from a zone whose
   *  floorHeightFt is set. The obstacle's segment is placed along the zone's
   *  edge nearest the room centroid (the "front" of the balcony), bottomZ=0,
   *  topZ=floorHeightFt + 3 ft (rail height). */
  autoBalconyFront: (zoneId: string) => void;

  addGroup: (name: string, color: string) => string; // returns new group id
  updateGroup: (id: string, patch: Partial<SpeakerGroup>) => void;
  deleteGroup: (id: string) => void;
  setItemGroup: (itemId: string, groupId: string | undefined) => void;
  setDrawingZone: (b: boolean) => void;
  pushZonePoint: (p: Point) => void;
  finishDrawingZone: () => void;
  cancelDrawingZone: () => void;

  setEditingRoomShape: (b: boolean) => void;
  pushRoomPoint: (p: Point) => void;
  finishEditingRoomShape: () => void;
  cancelEditingRoomShape: () => void;

  // Annotations
  droppingAnnotation: boolean;
  setDroppingAnnotation: (b: boolean) => void;
  addAnnotation: (x: number, y: number) => string;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  deleteAnnotation: (id: string) => void;

  // Wiring / cabling
  setWiringMode: (b: boolean) => void;
  setWiringStartId: (id: string | null) => void;
  setWiringCableType: (t: CableType) => void;
  addConnection: (conn: Omit<Connection, 'id'>) => string;
  updateConnection: (id: string, patch: Partial<Connection>) => void;
  deleteConnection: (id: string) => void;

  addCustomEquipment: (t: EquipmentTemplate) => void;

  setComplianceTarget: (k: keyof ComplianceTargets, v: number) => void;
  resetComplianceTargets: () => void;

  saveAsScenario: (name: string) => string;       // returns id
  switchScenario: (id: string) => void;
  updateActiveScenario: () => void;               // overwrite the active scenario with current state
  duplicateScenario: (id: string) => void;
  deleteScenario: (id: string) => void;
  renameScenario: (id: string, name: string) => void;

  setCompareScenarioId: (id: string | null) => void;
  setCompareWipeX: (x: number) => void;
  setCompareSimulation: (
    rt60: RT60Result | null,
    splHeatmap: HeatmapData | null,
    clarity: HeatmapData | null,
    arrival: HeatmapData | null,
  ) => void;

  toggleCatalogCollapsed: () => void;
  toggleInspectorCollapsed: () => void;
  setTheme: (t: 'light' | 'dark') => void;
  setUiMode: (m: 'simple' | 'pro') => void;
  markProposalGenerated: () => void;
  markAutoSaved: () => void;
  markAutoSaveFailed: () => void;

  // Auto-treat: drop a sensible set of acoustic panels.
  // Optional `options` lets the caller target a specific RT60 and/or pick a
  // strategy (reflection-points-only, RT60-fitting-only, or both — the
  // default). Returns the planner result so a UI can show predicted RT60
  // and whether the target was hit. When called with no args, falls back
  // to room-type-appropriate defaults.
  autoTreatRoom: (options?: TreatmentOptions) => TreatmentResult;
  clearTreatment: () => void;

  // Undo / redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

function defaultMeta(): ProjectMeta {
  return {
    name: 'Faith Community Chapel',
    clientName: 'Faith Community Church',
    consultantName: 'Leo Savory · Beacon AVL',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: '0.1.0',
  };
}

function snapshotFrom(s: Pick<Store, 'room' | 'equipment' | 'zones' | 'groups' | 'annotations' | 'connections'>): Snapshot {
  return {
    room: structuredClone(s.room),
    equipment: structuredClone(s.equipment),
    zones: structuredClone(s.zones),
    groups: structuredClone(s.groups),
    annotations: structuredClone(s.annotations),
    connections: structuredClone(s.connections),
  };
}

export const useStore = create<Store>((set, get) => ({
  meta: defaultMeta(),
  isDirty: false,

  room: defaultRoom(),
  equipment: defaultEquipment(),
  zones: [],
  groups: [],
  annotations: [],
  connections: [],
  droppingAnnotation: false,

  wiringMode: false,
  wiringStartId: null,
  wiringCableType: 'xlr',

  past: [],
  future: [],

  selectedId: null,
  selectedIds: [],
  selectedSurface: null,
  hoveredId: null,
  catalogMode: 'speakers',
  catalogView: 'library',
  brandFilter: 'All',
  searchQuery: '',
  inspectorTab: 'properties',

  showHeatmap: true,
  showCones: true,
  showRays: false,
  showMesh: true,
  showContours: false,
  useReflections: false,
  showImageSources: false,
  ismMaxOrder: 2,
  useCoherentSum: false,
  useRayTracing: false,
  rayQuality: 'medium',
  useModalLF: false,
  modalFreq: 63,
  earHeightFt: 4,
  activeFreq: '1k',
  heatmapOpacity: 0.55,
  noiseFloor: 35,

  rt60: null,
  heatmap: null,
  clarityHeatmap: null,
  arrivalHeatmap: null,
  heatmapMetric: 'spl',
  sti: null,
  stiRating: '',
  recommendations: [],
  simulationDirty: true,
  raysSummary: null,
  t30Heatmap: null,
  spatial: null,
  modalAnalysis: null,
  modalHeatmap: null,

  presentationMode: false,
  presentStyle: 'render',
  activeAppTab: 'design',
  hint: null,
  openModal: 'welcome',

  viewMode: 'iso',
  cameraYaw: -Math.PI / 4,
  cameraPitch: Math.PI / 6,
  walkEyeX: 0, walkEyeY: 0, walkEyeZ: 5.5,
  walkYaw: Math.PI / 2,        // facing +Y by default
  walkPitch: 0,
  fitVersion: 0,
  layerVisibility: {
    'audio-speaker': true, 'audio-signal': true, 'video': true, 'lighting': true,
    'acoustic': true, 'reference': true, 'infrastructure': true,
    'pews': true, 'mesh': true, 'cones': true, 'heatmap': true,
  },
  layersOpen: false,
  settingsOpen: false,
  gridSnap: true,
  measureMode: false,
  measurePoints: [],
  drawingZone: false,
  drawingZonePoints: [],
  editingRoomShape: false,
  editingRoomPoints: [],
  tool: 'select',
  viewportZoom: 1,
  viewportPanX: 0,
  viewportPanY: 0,

  customEquipment: [],
  catalogCollapsed: false,
  inspectorCollapsed: false,

  theme: (() => {
    try { return (localStorage.getItem('beacon.theme') as 'light' | 'dark') ?? 'light'; }
    catch { return 'light'; }
  })(),

  // Default to 'simple' — the rollout audience is mid-tier users; pros flip
  // once and the choice persists per device.
  uiMode: (() => {
    try { return (localStorage.getItem('beacon.uimode') as 'simple' | 'pro') ?? 'simple'; }
    catch { return 'simple'; }
  })(),

  lastAutoSaveAt: null,
  autoSaveFailed: false,
  proposalGeneratedAt: null,

  compliance: defaultComplianceTargets(defaultRoom().roomType),

  scenarios: [],
  activeScenarioId: null,

  compareScenarioId: null,
  compareWipeX: 0.5,
  compareHeatmap: null,
  compareClarityHeatmap: null,
  compareArrivalHeatmap: null,
  compareRT60: null,

  setMeta(patch) {
    set(state => ({ meta: { ...state.meta, ...patch, updatedAt: new Date().toISOString() }, isDirty: true }));
  },

  applyTemplate(templateId) {
    const template = TEMPLATES.find(t => t.id === templateId);
    if (!template) return;
    const built = template.build();
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
      room: built.room,
      equipment: built.equipment,
      zones: [],
      groups: [],
      annotations: [],
      connections: [],
      selectedId: null,
      selectedIds: [],
      meta: { ...state.meta, name: built.room.name, updatedAt: new Date().toISOString() },
      simulationDirty: true,
      isDirty: true,
      openModal: null,
    }));
  },

  loadProject(file) {
    // Defensive re-validation: even though the import / share / autosave
    // paths validate before calling us, run the same gate here so the store
    // can NEVER be populated with a degenerate room or missing arrays — no
    // matter which code path called loadProject. A bad file becomes a
    // no-op + hint rather than a crash.
    const safe = coerceProject(file);
    if (!safe) {
      set({ hint: 'Could not load that project — its room data is invalid.' });
      return;
    }
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
      meta: safe.meta,
      room: safe.room,
      equipment: safe.equipment,
      zones: safe.zones,
      groups: safe.groups,
      noiseFloor: safe.simulation?.noiseFloor ?? 35,
      compliance: safe.compliance ?? defaultComplianceTargets(safe.room.roomType),
      scenarios: safe.scenarios ?? [],
      activeScenarioId: safe.activeScenarioId ?? null,
      compareScenarioId: null,
      compareHeatmap: null,
      compareClarityHeatmap: null,
      compareArrivalHeatmap: null,
      compareRT60: null,
      annotations: safe.annotations ?? [],
      connections: safe.connections ?? [],
      selectedId: null,
      selectedIds: [],
      simulationDirty: true,
      // Dirty so the autosave loop persists the freshly loaded project —
      // otherwise a reload before the first edit reverts to the previous
      // autosave (same "project didn't stick" bug as newProject).
      isDirty: true,
      openModal: null,
    }));
  },

  newProject(name, clientName) {
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
      room: defaultRoom(),
      equipment: [],
      zones: [],
      groups: [],
      annotations: [],
      connections: [],
      compareScenarioId: null,
      compareHeatmap: null,
      compareClarityHeatmap: null,
      compareArrivalHeatmap: null,
      compareRT60: null,
      meta: {
        ...defaultMeta(),
        name,
        clientName: clientName ?? '',
      },
      selectedId: null,
      selectedIds: [],
      simulationDirty: true,
      // Dirty so the next autosave tick PERSISTS the new project. With
      // isDirty:false the autosave loop skipped it, and the next launch
      // silently restored the previous project — the new project (and its
      // name) appeared to "not stick".
      isDirty: true,
      openModal: null,
    }));
  },

  setRoom(patch) {
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
      room: { ...state.room, ...patch },
      simulationDirty: true,
      isDirty: true,
    }));
  },

  setOccupied(val) {
    set(state => ({
      room: { ...state.room, occupied: val },
      simulationDirty: true,
      isDirty: true,
    }));
  },

  applyScannedRoom(scan) {
    set(state => {
      // Default surfaces sized to the scanned wall count. Walls where the
      // scan detected windows get glass automatically.
      const glass = new Set(scan.glassWallSegments ?? []);
      const surfaces = [
        ...scan.shape.map((_, i) => ({
          id: `surf-w-${i}`, kind: 'wall' as const, segmentIndex: i,
          materialId: glass.has(i) ? 'glass-window' : 'drywall',
        })),
        { id: 'surf-floor', kind: 'floor' as const, segmentIndex: 0, materialId: 'carpet-thick' },
        { id: 'surf-ceiling', kind: 'ceiling' as const, segmentIndex: 0, materialId: 'drywall' },
      ];
      // Recognized furniture → placed items, with scanned footprints.
      const items: EquipmentItem[] = [];
      for (const f of scan.furniture) {
        const t = templateById(f.kind);
        if (!t) continue;
        const item = buildItemFromTemplate(t, { x: f.xFt, y: f.yFt, rotation: f.rotationDeg }, state.room);
        item.width = f.widthFt;
        item.depth = f.depthFt;
        if (item.kind === 'pew' || item.kind === 'table') item.panelW = f.widthFt;
        items.push(item);
      }
      return {
        past: pushPast(state.past, snapshotFrom(state)),
        future: [],
        room: {
          ...state.room,
          shape: scan.shape,
          width: scan.widthFt,
          depth: scan.depthFt,
          height: scan.heightFt,
          ceilingShape: 'flat' as const,
          peakHeight: undefined,
          surfaces,
          stage: null,
          wallObstacles: [],
          floorPlan: undefined,
        },
        zones: [],
        equipment: [...state.equipment, ...items],
        selectedId: null,
        selectedIds: [],
        selectedSurface: null,
        simulationDirty: true,
        isDirty: true,
        fitVersion: state.fitVersion + 1,
        viewportZoom: 1, viewportPanX: 0, viewportPanY: 0,
        openModal: null,
      };
    });
  },

  setSurfaceMaterial(kind, segmentIndex, materialId) {
    set(state => {
      const surfaces = [...state.room.surfaces];
      const idx = surfaces.findIndex(s => s.kind === kind && s.segmentIndex === segmentIndex);
      if (idx >= 0) surfaces[idx] = { ...surfaces[idx], materialId };
      else surfaces.push({ id: `surf-${kind}-${segmentIndex}-${Date.now()}`, kind, segmentIndex, materialId });
      return {
        past: pushPast(state.past, snapshotFrom(state)),
        future: [],
        room: { ...state.room, surfaces },
        simulationDirty: true,
        isDirty: true,
      };
    });
  },

  selectSurface(sel) {
    // Surface selection is mutually exclusive with equipment selection.
    set({ selectedSurface: sel, selectedId: null, selectedIds: [] });
  },

  setSelectedSurfaceMaterial(materialId) {
    const sel = get().selectedSurface;
    if (!sel) return;
    get().setSurfaceMaterial(sel.kind, sel.segmentIndex, materialId);
  },

  addEquipment(item) {
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
      equipment: [...state.equipment, item],
      selectedId: item.id,
      selectedIds: [item.id],
      selectedSurface: null,
      simulationDirty: true,
      isDirty: true,
    }));
  },

  updateEquipment(id, patch) {
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
      equipment: state.equipment.map(e => e.id === id ? { ...e, ...patch } : e),
      simulationDirty: true,
      isDirty: true,
    }));
  },

  updateEquipmentLive(id, patch) {
    set(state => ({
      equipment: state.equipment.map(e => e.id === id ? { ...e, ...patch } : e),
      simulationDirty: true,
      isDirty: true,
    }));
  },

  addEquipmentLive(item) {
    set(state => ({
      equipment: [...state.equipment, item],
      simulationDirty: true,
      isDirty: true,
    }));
  },

  deleteEquipmentLive(id) {
    set(state => {
      const remaining = state.selectedIds.filter(x => x !== id);
      return {
        equipment: state.equipment.filter(e => e.id !== id),
        connections: state.connections.filter(c => c.fromId !== id && c.toId !== id),
        selectedIds: remaining,
        selectedId: remaining[0] ?? null,
        simulationDirty: true,
        isDirty: true,
      };
    });
  },

  beginHistoryGroup() {
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
    }));
  },

  addReferencePoint(label) {
    const state = get();
    // Guard against a degenerate room polygon — without this, an empty
    // shape divides by zero and seeds the reference point at NaN, which
    // then poisons every downstream distance/SPL calc.
    const n = state.room.shape.length;
    const cx = n > 0 ? state.room.shape.reduce((s, p) => s + p.x, 0) / n : state.room.width / 2;
    const cy = n > 0 ? state.room.shape.reduce((s, p) => s + p.y, 0) / n : state.room.depth / 2;
    const id = `ref-${Date.now().toString(36)}`;
    const refIndex = state.equipment.filter(e => e.category === 'reference').length;
    const item: EquipmentItem = {
      id,
      templateId: 'reference-point',
      kind: 'reference-point',
      category: 'reference',
      label: label ?? (refIndex === 0 ? 'Mix Position' : `Reference ${refIndex + 1}`),
      x: cx, y: cy, z: 4,
      rotation: 0,
    };
    set(s => ({
      past: pushPast(s.past, snapshotFrom(s)),
      future: [],
      equipment: [...s.equipment, item],
      selectedId: id,
      simulationDirty: true,
      isDirty: true,
    }));
  },

  setStage(stage) {
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
      room: { ...state.room, stage },
      simulationDirty: true,
      isDirty: true,
    }));
  },

  deleteEquipment(id) {
    set(state => {
      const remaining = state.selectedIds.filter(x => x !== id);
      return {
        past: pushPast(state.past, snapshotFrom(state)),
        future: [],
        equipment: state.equipment.filter(e => e.id !== id),
        connections: state.connections.filter(c => c.fromId !== id && c.toId !== id),
        selectedIds: remaining,
        selectedId: remaining[0] ?? null,
        simulationDirty: true,
        isDirty: true,
      };
    });
  },

  duplicateEquipment(id) {
    const item = get().equipment.find(e => e.id === id);
    if (!item) return;
    const copy: EquipmentItem = {
      ...item,
      // Random suffix avoids id collisions when this is called in a loop
      // (e.g. context-menu Duplicate on a multi-selection within one ms).
      id: `${item.kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,5)}`,
      x: item.x + 2,
      y: item.y + 2,
    };
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
      equipment: [...state.equipment, copy],
      selectedId: copy.id,
      simulationDirty: true,
      isDirty: true,
    }));
  },

  combineIntoLineArray(ids) {
    const state = get();
    // Pull source items, keep only point-style speakers (incl. existing arrays).
    const SPEAKER_KINDS = new Set(['speaker-point', 'speaker-column', 'speaker-line-array', 'speaker-fill', 'speaker-delay']);
    const sources = ids
      .map(id => state.equipment.find(e => e.id === id))
      .filter((e): e is EquipmentItem => !!e && SPEAKER_KINDS.has(e.kind));
    if (sources.length < 2) return null;
    // The new array hangs from the topmost speaker — that's the rigging point.
    const top = [...sources].sort((a, b) => b.z - a.z)[0];
    // Sum existing box counts so combining two 3-box arrays gives a 6-box array.
    const totalBoxes = sources.reduce((n, s) => n + Math.max(1, s.boxes ?? 1), 0);
    // Inherit specs from the topmost; average the aim/tilt for sanity.
    const aim = sources.reduce((s, x) => s + (x.aim ?? 90), 0) / sources.length;
    const tilt = sources.reduce((s, x) => s + (x.tilt ?? 0), 0) / sources.length;
    const newId = `speaker-line-array-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,5)}`;
    const newItem: EquipmentItem = {
      ...top,
      id: newId,
      kind: 'speaker-line-array',
      label: top.brand ? `${top.brand} ${top.label} (${totalBoxes}-box array)` : `${top.label} (${totalBoxes}-box array)`,
      boxes: totalBoxes,
      splay: top.splay ?? 1.5,
      aim, tilt,
      // Preserve audience-side aim defaults if missing
    };
    set(s => ({
      past: pushPast(s.past, snapshotFrom(s)),
      future: [],
      equipment: [
        ...s.equipment.filter(e => !ids.includes(e.id)),
        newItem,
      ],
      selectedId: newId,
      selectedIds: [newId],
      simulationDirty: true,
      isDirty: true,
    }));
    return newId;
  },

  splitLineArray(id) {
    const state = get();
    const arr = state.equipment.find(e => e.id === id);
    if (!arr || arr.kind !== 'speaker-line-array') return;
    const n = Math.max(1, arr.boxes ?? 1);
    if (n < 2) return; // nothing to split
    // Stack the resulting boxes vertically below the rigging point with a
    // splay between each so they don't overlap visually. Box height ≈ 1 ft.
    const boxHeightFt = 1;
    const splayDeg = arr.splay ?? 1.5;
    const aim = arr.aim ?? 90;
    const aimRad = aim * Math.PI / 180;
    // Tilt accumulates downward across the array.
    const startTilt = arr.tilt ?? 0;
    const newItems: EquipmentItem[] = [];
    for (let i = 0; i < n; i++) {
      const z = arr.z - i * boxHeightFt;
      const tilt = startTilt - i * splayDeg;
      // A tiny lateral offset along the aim direction so the boxes don't all sit at exactly (x, y).
      const offset = i * 0.05;
      const x = arr.x + Math.cos(aimRad) * offset;
      const y = arr.y + Math.sin(aimRad) * offset;
      newItems.push({
        ...arr,
        id: `speaker-point-${Date.now().toString(36)}-${i}`,
        kind: 'speaker-point',
        label: `${arr.label} · box ${i + 1}`,
        boxes: undefined,
        splay: undefined,
        x, y, z, tilt,
      });
    }
    set(s => ({
      past: pushPast(s.past, snapshotFrom(s)),
      future: [],
      equipment: [...s.equipment.filter(e => e.id !== id), ...newItems],
      selectedId: newItems[0].id,
      selectedIds: newItems.map(i => i.id),
      simulationDirty: true,
      isDirty: true,
    }));
  },

  setSelected(id) {
    // Selecting equipment clears any selected surface (mutually exclusive).
    set({ selectedId: id, selectedIds: id ? [id] : [], selectedSurface: null });
  },
  addToSelection(id) {
    set(s => {
      if (s.selectedIds.includes(id)) return {};
      const ids = [...s.selectedIds, id];
      return { selectedIds: ids, selectedId: ids[0], selectedSurface: null };
    });
  },
  toggleSelection(id) {
    set(s => {
      const has = s.selectedIds.includes(id);
      const ids = has ? s.selectedIds.filter(x => x !== id) : [...s.selectedIds, id];
      return { selectedIds: ids, selectedId: ids[0] ?? null, selectedSurface: null };
    });
  },
  setSelection(ids) {
    set({ selectedIds: ids, selectedId: ids[0] ?? null, selectedSurface: null });
  },
  clearSelection() {
    set({ selectedIds: [], selectedId: null, selectedSurface: null });
  },
  setHovered(id) { set({ hoveredId: id }); },
  setCatalogMode(m) { set({ catalogMode: m }); },
  setCatalogView(v) { set({ catalogView: v }); },
  setBrandFilter(b) { set({ brandFilter: b }); },
  setSearchQuery(q) { set({ searchQuery: q }); },
  setInspectorTab(t) { set({ inspectorTab: t }); },

  toggleHeatmap() { set(s => ({ showHeatmap: !s.showHeatmap })); },
  toggleCones() { set(s => ({ showCones: !s.showCones })); },
  toggleRays() { set(s => ({ showRays: !s.showRays })); },
  toggleMesh() { set(s => ({ showMesh: !s.showMesh })); },
  toggleContours() { set(s => ({ showContours: !s.showContours })); },
  toggleReflections() { set(s => ({ useReflections: !s.useReflections, simulationDirty: true })); },
  toggleImageSources() { set(s => ({ showImageSources: !s.showImageSources })); },
  setIsmMaxOrder(n) { set({ ismMaxOrder: n, simulationDirty: true }); },
  toggleCoherentSum() { set(s => ({ useCoherentSum: !s.useCoherentSum, simulationDirty: true })); },
  toggleRayTracing() { set(s => ({ useRayTracing: !s.useRayTracing, simulationDirty: true })); },
  toggleModalLF() {
    set(s => {
      const on = !s.useModalLF;
      // Turning modal on auto-switches the heatmap to the modal view so the
      // standing-wave field is visible immediately; turning it off reverts to SPL.
      return {
        useModalLF: on,
        heatmapMetric: on ? 'modal' : (s.heatmapMetric === 'modal' ? 'spl' : s.heatmapMetric),
        simulationDirty: true,
      };
    });
  },
  setModalFreq(hz) { set({ modalFreq: hz, simulationDirty: true }); },
  setModalResults(analysis, heatmap) { set({ modalAnalysis: analysis, modalHeatmap: heatmap }); },
  setRayQuality(q) { set({ rayQuality: q, simulationDirty: true }); },
  setEarHeight(ft) { set({ earHeightFt: Math.max(0, Math.min(30, ft)), simulationDirty: true }); },
  setActiveFreq(f) { set({ activeFreq: f, simulationDirty: true }); },
  setHeatmapOpacity(v) { set({ heatmapOpacity: v }); },
  setNoiseFloor(v) { set({ noiseFloor: v, simulationDirty: true }); },

  setSimulation(rt60, heatmap, clarityHeatmap, arrivalHeatmap, sti, stiRating, recs, rays, t30Heatmap, spatial) {
    set({
      rt60, heatmap, clarityHeatmap, arrivalHeatmap, sti, stiRating,
      recommendations: recs, simulationDirty: false,
      raysSummary: rays ?? null,
      t30Heatmap: t30Heatmap ?? null,
      spatial: spatial ?? null,
    });
  },
  setHeatmapMetric(m) { set({ heatmapMetric: m, simulationDirty: true }); },
  markSimulationDirty() { set({ simulationDirty: true }); },

  setPresentationMode(b) { set({ presentationMode: b }); },
  setPresentStyle(s) { set({ presentStyle: s }); },
  setActiveAppTab(t) { set({ activeAppTab: t }); },
  setHint(h) {
    set({ hint: h });
    if (h) setTimeout(() => set(s => s.hint === h ? { hint: null } : {}), 2400);
  },
  setOpenModal(m) { set({ openModal: m }); },

  setViewMode(m) { set({ viewMode: m, fitVersion: get().fitVersion + 1, viewportZoom: 1, viewportPanX: 0, viewportPanY: 0 }); },
  setCamera(yaw, pitch) {
    // Clamp pitch so we don't flip upside-down: 1° from horizon to 89° from horizon.
    const p = Math.max(0.02, Math.min(Math.PI / 2 - 0.02, pitch));
    set({ cameraYaw: yaw, cameraPitch: p, viewMode: 'iso' });
  },
  applyCameraPreset(preset) {
    const map: Record<string, { yaw: number; pitch: number; mode: ViewMode }> = {
      iso:   { yaw: -Math.PI / 4, pitch: Math.PI / 6, mode: 'iso' },
      top:   { yaw: 0,            pitch: Math.PI / 2, mode: 'top' },
      front: { yaw: 0,            pitch: 0.02,        mode: 'iso' },
      side:  { yaw: -Math.PI / 2, pitch: 0.02,        mode: 'iso' },
    };
    const v = map[preset];
    if (!v) return;
    set({
      viewMode: v.mode, cameraYaw: v.yaw, cameraPitch: v.pitch,
      fitVersion: get().fitVersion + 1,
      viewportZoom: 1, viewportPanX: 0, viewportPanY: 0,
    });
  },
  bumpFit() { set({ fitVersion: get().fitVersion + 1, viewportZoom: 1, viewportPanX: 0, viewportPanY: 0 }); },
  enterWalkthrough() {
    const s = get();
    const r = s.room;
    const isoYaw = s.cameraYaw;
    // ===== Preserve the orbit-view's left/right layout in first-person =====
    //
    // Walk uses a perspective projection with `xc = (P − eye) · R_walk`.
    // Iso uses orthographic `screen_x = P · R_iso`. For a sub on the LEFT
    // in orbit to stay on the LEFT in first-person, two things must agree:
    //
    //   1. R_walk must point in the SAME world direction as R_iso. Iso has
    //      R_iso = (cos θ, sin θ); walk has R_walk = (−sin φ, cos φ). They
    //      match when φ = θ − π/2.
    //   2. eye · R_iso must equal zero — otherwise subtracting `eye` from
    //      `P` shifts every projected point by a constant offset, which
    //      can flip signs for points whose `P · R_iso` is near that offset.
    //
    // Without (2), the old hardcoded back-center eye + walk-yaw=−π/2 mapped
    // a sub at (5, 2) to screen-LEFT in walk while iso default put it on
    // screen-RIGHT — exactly the mirroring users were seeing.
    //
    // The fix: anchor at the room's "back-center" (so first-person spawns
    // feel like a person standing in the room, not on a wall), then PROJECT
    // that anchor onto the eye·R=0 line. For typical orbit angles this is a
    // tiny nudge from back-center; for the FRONT/SIDE presets the math
    // forces the eye onto a wall — we clamp inward with a buffer so the
    // camera isn't kissing the wall (at the cost of small layout drift for
    // those preset views, which is the lesser evil vs. spawning into a wall).
    const cx = r.width / 2;
    const cy = r.stage ? Math.max(r.stage.depth + 6, r.depth * 0.7) : r.depth * 0.7;
    const Rx = Math.cos(isoYaw);
    const Ry = Math.sin(isoYaw);
    const offset = cx * Rx + cy * Ry;             // back-center · R_iso
    const rawEyeX = cx - offset * Rx;
    const rawEyeY = cy - offset * Ry;
    const buf = 2;
    const eyeX = Math.max(buf, Math.min(r.width - buf, rawEyeX));
    const eyeY = Math.max(buf, Math.min(r.depth - buf, rawEyeY));
    // Walk yaw aligned with iso so screen-right is the same world direction.
    const yaw = isoYaw - Math.PI / 2;
    set({
      viewMode: 'walk',
      walkEyeX: eyeX, walkEyeY: eyeY, walkEyeZ: 5.5,
      walkYaw: yaw, walkPitch: 0,
      // Exit any tool/edit mode that wouldn't make sense in first-person.
      drawingZone: false, drawingZonePoints: [],
      editingRoomShape: false, editingRoomPoints: [],
      droppingAnnotation: false,
      measureMode: false, measurePoints: [],
      tool: 'select',
      fitVersion: get().fitVersion + 1,
      viewportZoom: 1, viewportPanX: 0, viewportPanY: 0,
    });
  },
  setWalkPose(patch) {
    set(s => ({
      walkEyeX: patch.eyeX ?? s.walkEyeX,
      walkEyeY: patch.eyeY ?? s.walkEyeY,
      walkEyeZ: patch.eyeZ ?? s.walkEyeZ,
      walkYaw:  patch.yaw  ?? s.walkYaw,
      // Clamp pitch so we don't flip the camera upside down
      walkPitch: patch.pitch != null
        ? Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, patch.pitch))
        : s.walkPitch,
    }));
  },
  setTool(t) { set({ tool: t }); },
  setViewportZoom(z) { set({ viewportZoom: Math.max(0.1, Math.min(8, z)) }); },
  setViewportPan(x, y) { set({ viewportPanX: x, viewportPanY: y }); },
  resetView() { set({ viewportZoom: 1, viewportPanX: 0, viewportPanY: 0, fitVersion: get().fitVersion + 1 }); },
  toggleLayer(k) {
    set(s => ({ layerVisibility: { ...s.layerVisibility, [k]: !s.layerVisibility[k] } }));
  },
  setLayersOpen(b) { set({ layersOpen: b, settingsOpen: false }); },
  setSettingsOpen(b) { set({ settingsOpen: b, layersOpen: false }); },
  setGridSnap(b) { set({ gridSnap: b }); },
  setMeasureMode(b) { set({ measureMode: b, measurePoints: [] }); },
  pushMeasurePoint(p) {
    set(s => {
      if (s.measurePoints.length >= 2) return { measurePoints: [p] };
      return { measurePoints: [...s.measurePoints, p] };
    });
  },
  clearMeasure() { set({ measurePoints: [] }); },

  addZone(zone) {
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
      zones: [...state.zones, zone],
      isDirty: true,
    }));
  },
  updateZone(id, patch) {
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
      zones: state.zones.map(z => z.id === id ? { ...z, ...patch } : z),
      isDirty: true,
    }));
  },
  deleteZone(id) {
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
      zones: state.zones.filter(z => z.id !== id),
      // Cascade: remove wall obstacles auto-derived from this zone.
      room: state.room.wallObstacles
        ? { ...state.room, wallObstacles: state.room.wallObstacles.filter(w => w.derivedFromZoneId !== id) }
        : state.room,
      isDirty: true,
      simulationDirty: true,
    }));
  },

  addWallObstacle(w) {
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
      room: { ...state.room, wallObstacles: [...(state.room.wallObstacles ?? []), w] },
      isDirty: true,
      simulationDirty: true,
    }));
  },
  updateWallObstacle(id, patch) {
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
      room: {
        ...state.room,
        wallObstacles: (state.room.wallObstacles ?? []).map(w => w.id === id ? { ...w, ...patch } : w),
      },
      isDirty: true,
      simulationDirty: true,
    }));
  },
  deleteWallObstacle(id) {
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
      room: {
        ...state.room,
        wallObstacles: (state.room.wallObstacles ?? []).filter(w => w.id !== id),
      },
      isDirty: true,
      simulationDirty: true,
    }));
  },
  autoBalconyFront(zoneId) {
    set(state => {
      const zone = state.zones.find(z => z.id === zoneId);
      if (!zone || zone.shape.length < 3) return {};
      const floorH = zone.floorHeightFt ?? 0;
      if (floorH <= 0) return {}; // not actually elevated
      // Pick the polygon edge whose midpoint is closest to the room centroid —
      // that's the "interior" / "front" edge of the balcony (the one facing
      // the stage), not the back-wall edge.
      const roomShape = state.room.shape;
      let cx = 0, cy = 0;
      for (const p of roomShape) { cx += p.x; cy += p.y; }
      cx /= Math.max(1, roomShape.length);
      cy /= Math.max(1, roomShape.length);
      let bestI = 0;
      let bestDist = Infinity;
      for (let i = 0; i < zone.shape.length; i++) {
        const a = zone.shape[i];
        const b = zone.shape[(i + 1) % zone.shape.length];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const d = Math.hypot(mx - cx, my - cy);
        if (d < bestDist) { bestDist = d; bestI = i; }
      }
      const start = zone.shape[bestI];
      const end = zone.shape[(bestI + 1) % zone.shape.length];
      const existing = (state.room.wallObstacles ?? []).filter(w => w.derivedFromZoneId !== zoneId);
      const obs: import('../types').WallObstacle = {
        id: `balcony-front-${zoneId}`,
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
        bottomZ: 0,
        topZ: floorH + 3,            // balcony floor + 3 ft railing/face
        materialId: 'drywall',
        label: `${zone.name} front`,
        derivedFromZoneId: zoneId,
      };
      return {
        past: pushPast(state.past, snapshotFrom(state)),
        future: [],
        room: { ...state.room, wallObstacles: [...existing, obs] },
        isDirty: true,
        simulationDirty: true,
      };
    });
  },
  setDrawingZone(b) {
    set({ drawingZone: b, drawingZonePoints: [] });
  },
  pushZonePoint(p) {
    set(state => ({ drawingZonePoints: [...state.drawingZonePoints, p] }));
  },
  finishDrawingZone() {
    const state = get();
    if (state.drawingZonePoints.length < 3) {
      set({ drawingZone: false, drawingZonePoints: [] });
      return;
    }
    const palette = ['#3B82F6', '#F5A623', '#2F9E5E', '#A855F7', '#06B6D4', '#F97316', '#10B981'];
    const color = palette[state.zones.length % palette.length];
    const zone: Zone = {
      id: `zone-${Date.now().toString(36)}`,
      name: state.zones.length === 0 ? 'Main Floor' : `Zone ${state.zones.length + 1}`,
      color,
      shape: state.drawingZonePoints,
      targetSPL: 88,
    };
    set(s => ({
      past: pushPast(s.past, snapshotFrom(s)),
      future: [],
      zones: [...s.zones, zone],
      drawingZone: false,
      drawingZonePoints: [],
      isDirty: true,
    }));
  },
  cancelDrawingZone() {
    set({ drawingZone: false, drawingZonePoints: [] });
  },

  setEditingRoomShape(b) {
    set({ editingRoomShape: b, editingRoomPoints: [] });
  },
  pushRoomPoint(p) {
    set(state => ({ editingRoomPoints: [...state.editingRoomPoints, p] }));
  },
  finishEditingRoomShape() {
    const state = get();
    if (state.editingRoomPoints.length < 3) {
      set({ editingRoomShape: false, editingRoomPoints: [] });
      return;
    }
    // Translate so the polygon's bounding-box min is at (0, 0) — keeps coordinates positive.
    const pts = state.editingRoomPoints;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    const shape = pts.map(p => ({ x: p.x - minX, y: p.y - minY }));
    const width = maxX - minX;
    const depth = maxY - minY;
    // Regenerate wall surfaces: one per edge, keep floor + ceiling materials.
    const oldFloor = state.room.surfaces.find(s => s.kind === 'floor');
    const oldCeil = state.room.surfaces.find(s => s.kind === 'ceiling');
    const surfaces: import('../types').Surface[] = shape.map((_, i) => ({
      id: `surf-w-${i}`, kind: 'wall', segmentIndex: i, materialId: 'drywall',
    }));
    surfaces.push(oldFloor
      ? { ...oldFloor, id: 'surf-floor', segmentIndex: 0 }
      : { id: 'surf-floor', kind: 'floor', segmentIndex: 0, materialId: 'carpet-thick' });
    surfaces.push(oldCeil
      ? { ...oldCeil, id: 'surf-ceiling', segmentIndex: 0 }
      : { id: 'surf-ceiling', kind: 'ceiling', segmentIndex: 0, materialId: 'drywall' });
    set(s => ({
      past: pushPast(s.past, snapshotFrom(s)),
      future: [],
      room: { ...s.room, shape, width, depth, surfaces },
      editingRoomShape: false,
      editingRoomPoints: [],
      simulationDirty: true,
      isDirty: true,
    }));
  },
  cancelEditingRoomShape() {
    set({ editingRoomShape: false, editingRoomPoints: [] });
  },

  setDroppingAnnotation(b) { set({ droppingAnnotation: b }); },
  addAnnotation(x, y) {
    const id = `ann-${Date.now().toString(36)}`;
    const ann: Annotation = {
      id, x, y, z: 4,
      text: '',
      color: '#F5A623',
      createdAt: new Date().toISOString(),
    };
    set(s => ({
      past: pushPast(s.past, snapshotFrom(s)),
      future: [],
      annotations: [...s.annotations, ann],
      droppingAnnotation: false,
      isDirty: true,
    }));
    return id;
  },
  updateAnnotation(id, patch) {
    set(s => ({
      past: pushPast(s.past, snapshotFrom(s)),
      future: [],
      annotations: s.annotations.map(a => a.id === id ? { ...a, ...patch } : a),
      isDirty: true,
    }));
  },
  deleteAnnotation(id) {
    set(s => ({
      past: pushPast(s.past, snapshotFrom(s)),
      future: [],
      annotations: s.annotations.filter(a => a.id !== id),
      isDirty: true,
    }));
  },

  setWiringMode(b) {
    set({ wiringMode: b, wiringStartId: null });
  },
  setWiringStartId(id) { set({ wiringStartId: id }); },
  setWiringCableType(t) { set({ wiringCableType: t }); },
  addConnection(conn) {
    const id = `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,5)}`;
    const next: Connection = { ...conn, id };
    set(s => ({
      past: pushPast(s.past, snapshotFrom(s)),
      future: [],
      connections: [...s.connections, next],
      isDirty: true,
    }));
    return id;
  },
  updateConnection(id, patch) {
    set(s => ({
      past: pushPast(s.past, snapshotFrom(s)),
      future: [],
      connections: s.connections.map(c => c.id === id ? { ...c, ...patch } : c),
      isDirty: true,
    }));
  },
  deleteConnection(id) {
    set(s => ({
      past: pushPast(s.past, snapshotFrom(s)),
      future: [],
      connections: s.connections.filter(c => c.id !== id),
      isDirty: true,
    }));
  },

  addGroup(name, color) {
    const id = `group-${Date.now().toString(36)}`;
    const group: SpeakerGroup = {
      id, name, color, itemIds: [], delayMs: 0, gainDb: 0, hpf: 20, lpf: 20000,
    };
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
      groups: [...state.groups, group],
      isDirty: true,
    }));
    return id;
  },
  updateGroup(id, patch) {
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
      groups: state.groups.map(g => g.id === id ? { ...g, ...patch } : g),
      simulationDirty: true, // delay/gain affect simulation
      isDirty: true,
    }));
  },
  deleteGroup(id) {
    set(state => ({
      past: pushPast(state.past, snapshotFrom(state)),
      future: [],
      groups: state.groups.filter(g => g.id !== id),
      equipment: state.equipment.map(e => e.groupId === id ? { ...e, groupId: undefined } : e),
      simulationDirty: true,
      isDirty: true,
    }));
  },
  setItemGroup(itemId, groupId) {
    set(state => {
      const groups = state.groups.map(g => ({
        ...g,
        itemIds: g.id === groupId
          ? Array.from(new Set([...g.itemIds, itemId]))
          : g.itemIds.filter(i => i !== itemId),
      }));
      return {
        past: pushPast(state.past, snapshotFrom(state)),
        future: [],
        groups,
        equipment: state.equipment.map(e => e.id === itemId ? { ...e, groupId } : e),
        simulationDirty: true,
        isDirty: true,
      };
    });
  },

  addCustomEquipment(t) { set(s => ({ customEquipment: [...s.customEquipment, t] })); },

  setComplianceTarget(k, v) {
    set(state => ({ compliance: { ...state.compliance, [k]: v }, isDirty: true }));
  },
  resetComplianceTargets() {
    set(state => ({ compliance: defaultComplianceTargets(state.room.roomType), isDirty: true }));
  },

  saveAsScenario(name) {
    const id = `scn-${Date.now().toString(36)}`;
    const state = get();
    const scenario: Scenario = {
      id, name,
      snapshot: {
        room: structuredClone(state.room),
        equipment: structuredClone(state.equipment),
        zones: structuredClone(state.zones),
        groups: structuredClone(state.groups),
      },
      createdAt: new Date().toISOString(),
    };
    set(s => ({
      past: pushPast(s.past, snapshotFrom(s)),
      future: [],
      scenarios: [...s.scenarios, scenario],
      activeScenarioId: id,
      isDirty: true,
    }));
    return id;
  },
  switchScenario(id) {
    const state = get();
    const sc = state.scenarios.find(s => s.id === id);
    if (!sc) return;
    set(s => ({
      past: pushPast(s.past, snapshotFrom(s)),
      future: [],
      room: structuredClone(sc.snapshot.room),
      equipment: structuredClone(sc.snapshot.equipment),
      zones: structuredClone(sc.snapshot.zones),
      groups: structuredClone(sc.snapshot.groups),
      activeScenarioId: id,
      // If you switch into the scenario you were comparing against, drop the compare.
      compareScenarioId: s.compareScenarioId === id ? null : s.compareScenarioId,
      compareHeatmap: s.compareScenarioId === id ? null : s.compareHeatmap,
      compareClarityHeatmap: s.compareScenarioId === id ? null : s.compareClarityHeatmap,
      compareArrivalHeatmap: s.compareScenarioId === id ? null : s.compareArrivalHeatmap,
      compareRT60: s.compareScenarioId === id ? null : s.compareRT60,
      selectedId: null,
      selectedIds: [],
      simulationDirty: true,
      isDirty: true,
    }));
  },
  updateActiveScenario() {
    const state = get();
    if (!state.activeScenarioId) return;
    set(s => ({
      scenarios: s.scenarios.map(sc => sc.id === s.activeScenarioId
        ? { ...sc, snapshot: {
            room: structuredClone(s.room),
            equipment: structuredClone(s.equipment),
            zones: structuredClone(s.zones),
            groups: structuredClone(s.groups),
          }}
        : sc
      ),
      isDirty: true,
    }));
  },
  duplicateScenario(id) {
    const state = get();
    const sc = state.scenarios.find(s => s.id === id);
    if (!sc) return;
    const dup: Scenario = {
      ...structuredClone(sc),
      id: `scn-${Date.now().toString(36)}`,
      name: `${sc.name} (copy)`,
      createdAt: new Date().toISOString(),
    };
    set(s => ({ scenarios: [...s.scenarios, dup], isDirty: true }));
  },
  deleteScenario(id) {
    set(s => ({
      scenarios: s.scenarios.filter(sc => sc.id !== id),
      activeScenarioId: s.activeScenarioId === id ? null : s.activeScenarioId,
      compareScenarioId: s.compareScenarioId === id ? null : s.compareScenarioId,
      compareHeatmap: s.compareScenarioId === id ? null : s.compareHeatmap,
      compareClarityHeatmap: s.compareScenarioId === id ? null : s.compareClarityHeatmap,
      compareArrivalHeatmap: s.compareScenarioId === id ? null : s.compareArrivalHeatmap,
      compareRT60: s.compareScenarioId === id ? null : s.compareRT60,
      isDirty: true,
    }));
  },
  renameScenario(id, name) {
    set(s => ({
      scenarios: s.scenarios.map(sc => sc.id === id ? { ...sc, name } : sc),
      isDirty: true,
    }));
  },

  setCompareScenarioId(id) {
    set(() => ({
      compareScenarioId: id,
      // Clear stale results — they'll be recomputed by the effect.
      compareHeatmap: null,
      compareClarityHeatmap: null,
      compareArrivalHeatmap: null,
      compareRT60: null,
    }));
  },
  setCompareWipeX(x) {
    set(() => ({ compareWipeX: Math.max(0, Math.min(1, x)) }));
  },
  setCompareSimulation(rt60, splHeatmap, clarity, arrival) {
    set(() => ({
      compareRT60: rt60,
      compareHeatmap: splHeatmap,
      compareClarityHeatmap: clarity,
      compareArrivalHeatmap: arrival,
    }));
  },

  toggleCatalogCollapsed() { set(s => ({ catalogCollapsed: !s.catalogCollapsed })); },
  toggleInspectorCollapsed() { set(s => ({ inspectorCollapsed: !s.inspectorCollapsed })); },
  setUiMode(m) {
    set({ uiMode: m });
    try { localStorage.setItem('beacon.uimode', m); } catch { /* noop */ }
  },
  markProposalGenerated() { set({ proposalGeneratedAt: Date.now() }); },
  setTheme(t) {
    set({ theme: t });
    try { localStorage.setItem('beacon.theme', t); } catch { /* noop */ }
  },
  markAutoSaved() {
    set({ lastAutoSaveAt: Date.now(), isDirty: false, autoSaveFailed: false });
  },
  markAutoSaveFailed() {
    set({ autoSaveFailed: true });
  },

  autoTreatRoom(options?: TreatmentOptions): TreatmentResult {
    const state = get();
    const speakers = state.equipment.filter(e => e.category === 'audio-speaker');
    const result = planTreatment(
      state.room,
      state.zones,
      speakers,
      state.equipment,                  // engine filters by affectsAcoustics()
      options ?? {},
    );
    if (result.panels.length > 0) {
      set(s => ({
        past: pushPast(s.past, snapshotFrom(s)),
        future: [],
        equipment: [...s.equipment, ...result.panels],
        simulationDirty: true,
        isDirty: true,
      }));
    }
    return result;
  },

  clearTreatment() {
    set(s => ({
      past: pushPast(s.past, snapshotFrom(s)),
      future: [],
      equipment: s.equipment.filter(e => e.category !== 'acoustic'),
      simulationDirty: true,
      isDirty: true,
    }));
  },

  undo() {
    const state = get();
    if (!state.past.length) return;
    const prev = state.past[state.past.length - 1];
    const present: Snapshot = snapshotFrom(state);
    // Preserve selection where it can be — if undo only changed properties,
    // the user shouldn't lose the panel they're working in.
    const validIds = state.selectedIds.filter(id => prev.equipment.some(e => e.id === id));
    set({
      past: state.past.slice(0, -1),
      future: [present, ...state.future].slice(0, HISTORY_LIMIT),
      room: prev.room,
      equipment: prev.equipment,
      zones: prev.zones,
      groups: prev.groups,
      annotations: prev.annotations ?? [],
      connections: prev.connections ?? [],
      selectedId: validIds[0] ?? null,
      selectedIds: validIds,
      simulationDirty: true,
    });
  },

  redo() {
    const state = get();
    if (!state.future.length) return;
    const next = state.future[0];
    const present: Snapshot = snapshotFrom(state);
    const validIds = state.selectedIds.filter(id => next.equipment.some(e => e.id === id));
    set({
      past: [...state.past, present].slice(-HISTORY_LIMIT),
      future: state.future.slice(1),
      room: next.room,
      equipment: next.equipment,
      zones: next.zones,
      groups: next.groups,
      annotations: next.annotations ?? [],
      connections: next.connections ?? [],
      selectedId: validIds[0] ?? null,
      selectedIds: validIds,
      simulationDirty: true,
    });
  },

  canUndo() { return get().past.length > 0; },
  canRedo() { return get().future.length > 0; },
}));

function pushPast(past: Snapshot[], snap: Snapshot): Snapshot[] {
  const next = [...past, snap];
  if (next.length > HISTORY_LIMIT) return next.slice(-HISTORY_LIMIT);
  return next;
}

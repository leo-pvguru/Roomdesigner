// Core domain types — coordinates always in feet (real-world).

export type Point = { x: number; y: number };
export type Point3 = { x: number; y: number; z: number };

export type CeilingShape = 'flat' | 'sloped' | 'vaulted' | 'coffered' | 'hip' | 'cross-gable';
export type RoomType = 'sanctuary' | 'multipurpose' | 'fellowship' | 'gym' | 'outdoor';

export const OCTAVE_BANDS = [125, 250, 500, 1000, 2000, 4000] as const;
export type OctaveBand = (typeof OCTAVE_BANDS)[number];
export type AbsorptionCoefficients = Record<OctaveBand, number>;

export interface Material {
  id: string;
  name: string;
  category: 'wall' | 'floor' | 'ceiling' | 'panel' | 'audience' | 'furniture';
  color: string;
  /** Per-band sound absorption coefficient α ∈ [0,1]. */
  alpha: AbsorptionCoefficients;
  /** Per-band scattering (diffusion) coefficient s ∈ [0,1] — the fraction
   *  of reflected energy that scatters diffusely rather than specularly.
   *  Feeds the hybrid specular/diffuse reflection model. When absent the
   *  engine assumes a smooth surface (low default, see DEFAULT_SCATTERING). */
  scattering?: AbsorptionCoefficients;
  /** Nominal material thickness in inches — informational, and used by the
   *  auto-treat planner to reason about panel/cloud sizing. */
  thicknessIn?: number;
  /** Noise Reduction Coefficient — mean of the 250/500/1k/2k α band values,
   *  rounded to the nearest 0.05. Computed from `alpha` when absent. */
  nrc?: number;
  /** Short human-readable note shown in the materials catalog. */
  description?: string;
  /** Display grouping for the materials catalog browser. Independent of
   *  `category` (which governs which surfaces a material is offered for). */
  group?: 'reflective' | 'wood' | 'absorptive' | 'glass-metal' | 'floor' | 'ceiling' | 'treatment' | 'audience';
}

/**
 * Measured polar / directivity data for a loudspeaker. Stored as separate
 * 1-D horizontal and vertical sweeps per frequency band — the same format
 * CLF1 uses. Each curve gives the relative attenuation in dB at each angle
 * (0 dB = on-axis; values are typically negative off-axis).
 *
 * When a placed speaker has `polar` set, `speakerSPL` uses bilinear
 * interpolation across (angle, frequency) to look up off-axis loss, replacing
 * the default elliptical Gaussian pattern.
 *
 * If only one of `hPolar` / `vPolar` is present, the missing axis falls back
 * to the elliptical model (using `horiz` / `vert` from the EquipmentItem).
 */
export interface PolarData {
  /** Human-readable label, e.g. "Yamaha CHR15 — measured 1/3 oct". */
  label: string;
  /** Frequency points in Hz, sorted ascending. Typically 1/3 or full octave. */
  freqs: number[];
  /** Horizontal angles in degrees, sorted ascending. Symmetric polars
   *  often run 0..180 (mirrored); wider data covers -180..180. */
  hAngles?: number[];
  /** Vertical angles in degrees, sorted ascending. */
  vAngles?: number[];
  /** Horizontal attenuation in dB. Shape: [freqs.length][hAngles.length].
   *  0 dB = on-axis reference. */
  hPolar?: number[][];
  /** Vertical attenuation in dB. Shape: [freqs.length][vAngles.length]. */
  vPolar?: number[][];
}

export type SurfaceKind = 'wall' | 'floor' | 'ceiling';

export interface Surface {
  id: string;
  kind: SurfaceKind;
  // For walls: index along the polygon (0..n-1). For floor/ceiling: 0.
  segmentIndex: number;
  materialId: string;
  // Override area in sq ft (otherwise computed from geometry)
  areaOverride?: number;
}

/**
 * An interior wall obstacle — a vertical rectangle that lives INSIDE the
 * room polygon (not part of its perimeter). Used for balcony fronts, stage-
 * riser fronts, half-wall partitions, hanging banners (when oriented near-
 * vertically), and similar features that reflect AND block sound but aren't
 * captured by the room's outer wall polygon.
 *
 * Geometry: line segment from `start` to `end` in xy, extruded vertically
 * from `bottomZ` to `topZ`. Both faces (front + back) reflect, so an image
 * source mirrors across both sides. Maekawa diffraction blockage applies in
 * the direct-field path.
 */
export interface WallObstacle {
  id: string;
  /** Segment endpoint A in feet. */
  start: Point;
  /** Segment endpoint B in feet. */
  end: Point;
  /** Bottom of the rectangle (ft above room floor). 0 for a partition that
   *  reaches the floor; > 0 for a balcony front (= balcony zone's floor height). */
  bottomZ: number;
  /** Top of the rectangle (ft above room floor). For a balcony front this is
   *  typically the balcony floor + 3 ft (railing height) or up to ceiling. */
  topZ: number;
  /** Material ID for both faces. Default 'drywall'. */
  materialId: string;
  /** Display label (e.g. "Balcony front", "Stage riser"). */
  label?: string;
  /** When non-null, this obstacle was generated from a zone (auto-managed —
   *  removing the zone removes the obstacle, geometry tracks zone updates). */
  derivedFromZoneId?: string | null;
}

export interface Stage {
  width: number;   // ft
  depth: number;   // ft
  height: number;  // ft above floor
}

export interface FloorPlan {
  dataUrl: string;        // base64-encoded image (data: URL)
  widthFt: number;        // displayed width in feet
  heightFt: number;       // displayed height in feet
  offsetX: number;        // ft, distance from origin
  offsetY: number;        // ft
  opacity: number;        // 0..1
  rotation: number;       // degrees, around image center
}

export interface RoomState {
  name: string;
  shape: Point[];          // CCW polygon, in feet
  width: number;           // ft (bounding)
  depth: number;           // ft (bounding)
  height: number;          // wall height in ft
  ceilingShape: CeilingShape;
  peakHeight?: number;     // for sloped/vaulted/hip/cross-gable
  // Which room axis the ridge (or high edge for sloped) runs along.
  // 'width' = ridge parallel to X axis; 'depth' = parallel to Y. Defaults to
  // the longer side when omitted. Ignored for flat/coffered/hip.
  ridgeAxis?: 'width' | 'depth';
  // For 'vaulted': position of the ridge across the cross-axis (0..1, default 0.5 = centered).
  // For 'sloped': position of the high edge along the cross-axis (0..1, default 1).
  // Ignored for flat/coffered/hip/cross-gable.
  peakOffset?: number;
  occupancy: number;       // seats
  occupied: boolean;       // simulation flag
  roomType: RoomType;
  surfaces: Surface[];
  stage: Stage | null;
  unitSystem: 'imperial' | 'metric';
  floorPlan?: FloorPlan;
  /** Air temperature in °F. Feeds ANSI S1.26 air-absorption per band.
   *  Defaults to 70°F when unset. */
  temperatureF?: number;
  /** Relative humidity 0..100 %. Feeds ANSI S1.26 air-absorption per band.
   *  Defaults to 50% when unset. */
  relHumidity?: number;
  /** Reference speaker voice for IEC 60268-16 STI weighting. Male and
   *  female speech have different spectral content, so the band-weighting
   *  coefficients differ. Defaults to 'male' when unset. */
  voice?: 'male' | 'female';
  /** Sprint C12 — interior vertical-rectangle obstacles (balcony fronts,
   *  stage-riser fronts, half-walls). Reflect both sides; block direct
   *  sound for under-balcony shadow zones via Maekawa diffraction. */
  wallObstacles?: WallObstacle[];
}

export type EquipmentKind =
  | 'speaker-line-array'
  | 'speaker-column'
  | 'speaker-point'
  | 'speaker-sub'
  | 'speaker-sub-flown'
  | 'speaker-monitor'
  | 'speaker-iem'
  | 'speaker-ceiling'
  | 'speaker-delay'
  | 'speaker-fill'
  | 'foh-console'
  | 'monitor-console'
  | 'amp-rack'
  | 'snake'
  | 'dsp'
  | 'projector'
  | 'led-wall'
  | 'ptz-camera'
  | 'cam-handheld'
  | 'confidence-monitor'
  | 'mh-spot'
  | 'mh-wash'
  | 'led-par'
  | 'followspot'
  | 'lx-console'
  | 'dimmer-rack'
  | 'rack'
  | 'pdu'
  | 'breaker-panel'
  | 'cable-run'
  | 'truss-straight'
  | 'truss-square'
  | 'truss-circle'
  | 'acoustic-panel'
  | 'bass-trap'
  | 'diffuser'
  // ===== Furniture / objects (acoustically active) =====
  | 'chair-padded'
  | 'chair-stacking'
  | 'pew'
  | 'table'
  | 'podium'
  | 'rug'
  | 'reference-point';

export type EquipmentCategory =
  | 'audio-speaker'
  | 'audio-signal'
  | 'video'
  | 'lighting'
  | 'infrastructure'
  | 'acoustic'
  | 'furniture'
  | 'reference';

export interface EquipmentTemplate {
  kind: EquipmentKind;
  category: EquipmentCategory;
  label: string;
  brand?: string;
  badge?: string;
  // speaker-only
  horiz?: number;   // horizontal dispersion (deg)
  vert?: number;    // vertical dispersion (deg)
  maxSPL?: number;  // dB SPL @ 1m max
  sensitivity?: number; // dB @ 1W/1m
  power?: number;   // W rated
  weightLb?: number;
  lf?: string;      // LF driver description
  // Default frequency response — passed to placed items so the heatmap respects it.
  lfHz?: number;
  hfHz?: number;
  price?: number;
  // panel-only
  nrc?: number;
  alpha?: AbsorptionCoefficients;
  // default size for non-point-style items
  defaultW?: number;
  defaultD?: number;
  /** Measured polar / directivity data. When present, placed instances
   *  inherit this and the engine uses it instead of the elliptical fallback. */
  polar?: PolarData;
  // Video-only template fields — describe the model's optical / display
  // characteristics so placed instances inherit sensible defaults.
  throwRatio?: number;
  screenWidthFt?: number;
  screenHeightFt?: number;
  resolution?: string;
  brightness?: number;
  fovDeg?: number;
  hasPtz?: boolean;
  // Lighting-only template fields — beam optics and electrical.
  beamAngleDeg?: number;
  zoomMinDeg?: number;
  zoomMaxDeg?: number;
  colorTempK?: number;
  wattage?: number;
  /** Acoustic-only — surface pattern for the panel render. Drives the
   *  visual texture (fabric weave, foam pyramids, QRD diffuser blocks,
   *  skyline, wood slats, wave wood). Defaults to 'fabric'. */
  panelPattern?: 'fabric' | 'foam-wedge' | 'qrd' | 'skyline' | 'wood-slat' | 'wave-wood' | 'cylindrical';
  /** Acoustic-only — fabric / panel face color, e.g. tan, charcoal,
   *  natural-wood. Drives the base color for the panel render. */
  panelColor?: string;
}

export interface EquipmentItem {
  id: string;
  templateId: string;
  kind: EquipmentKind;
  category: EquipmentCategory;
  label: string;
  brand?: string;
  // Position in feet
  x: number;
  y: number;
  z: number;
  rotation: number;     // yaw degrees, 0 = +x, CCW is positive
  // Speaker fields
  aim?: number;         // horizontal aim deg
  tilt?: number;        // vertical tilt deg (negative = down)
  horiz?: number;
  vert?: number;
  maxSPL?: number;
  sensitivity?: number;
  power?: number;
  drive?: number;       // 0-100 %
  delayMs?: number;
  /** LF driver description (e.g. "2x18", "12", "8x2"). Used by the 3D
   *  shape recipes to pick driver count and size for sub / column /
   *  line-array geometry. Inherited from the EquipmentTemplate at placement. */
  lf?: string;
  // Frequency response — speaker rolls off below `lfHz` and above `hfHz`.
  // Outside that range, the band's SPL contribution is attenuated.
  lfHz?: number;
  hfHz?: number;
  // Crossovers — extra HPF / LPF applied at the amp / DSP. A sub may have
  // xoverHighHz=100; a main might have xoverLowHz=80 to shed bass to the sub.
  xoverLowHz?: number;
  xoverHighHz?: number;
  // Line-array
  boxes?: number;
  splay?: number;       // deg per box
  // Panel
  panelW?: number;
  panelH?: number;
  wall?: 'L' | 'R' | 'B' | 'F' | 'C'; // attached wall (or ceiling)
  nrc?: number;
  alpha?: AbsorptionCoefficients;
  /** Inherited from template — drives the panel's surface texture in the
   *  3D viewport (fabric / foam wedge / QRD / skyline / wood slat / wave wood). */
  panelPattern?: 'fabric' | 'foam-wedge' | 'qrd' | 'skyline' | 'wood-slat' | 'wave-wood' | 'cylindrical';
  /** Inherited from template — base color for the panel face. */
  panelColor?: string;
  // Generic dimensions
  width?: number;       // ft
  depth?: number;       // ft
  itemHeight?: number;  // ft, for obstacle modeling (rack tall, console short, etc.)
  /** When true, this item is folded into the acoustic model: its footprint
   *  blocks line-of-sight (diffraction loss) and its surface area adds to the
   *  Sabine reverb sum. Defaults to true for speakers/panels and the racks/
   *  consoles that are physically large enough to matter. */
  affectsAcoustics?: boolean;
  // Group / zone membership
  groupId?: string;
  // Rigging — non-truss items hung from a truss carry its id here so they
  // move with the truss when it's dragged. Trusses themselves never have a parentId.
  parentId?: string;
  // Truss-only dimensions
  trussLengthFt?: number;      // straight runs — horizontal length
  trussWidthFt?: number;       // square truss — long side
  trussDepthFt?: number;       // square truss — short side
  trussDiameterFt?: number;    // circular truss — outer diameter
  // Electrical
  circuit?: string;            // free-form circuit ID (e.g. "Stage A", "FOH-1")
  // Locked from edits
  locked?: boolean;
  // Mute / solo for simulation (audio sources only)
  muted?: boolean;
  soloed?: boolean;
  /** Subwoofer cardioid / end-fire array. When true on a sub, the dispersion
   *  model uses a cardioid pattern (forward + side, ~20 dB rear rejection)
   *  instead of treating the sub as omnidirectional. */
  cardioid?: boolean;
  /** Measured polar / directivity data for this specific speaker instance.
   *  Set automatically from the template when the speaker is placed; can be
   *  overridden later (e.g. via JSON import). When null/undefined, the
   *  engine falls back to the elliptical pattern from `horiz`/`vert`. */
  polar?: PolarData;
  // Reference point fields
  predictedSPL?: number;
  // ===== Video / projection =====
  throwRatio?: number;       // image width / throw distance (e.g. 1.5)
  screenWidthFt?: number;
  screenHeightFt?: number;
  resolution?: string;        // "1920×1080", "4K"
  brightness?: number;        // ANSI lumens
  // ===== Lighting =====
  beamAngleDeg?: number;
  zoomMinDeg?: number;
  zoomMaxDeg?: number;
  colorTempK?: number;        // kelvin for white-light fixtures
  wattage?: number;
  // ===== Camera =====
  fovDeg?: number;
  hasPtz?: boolean;
}

export type SeatingType =
  | 'padded-chair'      // theater seats / heavy upholstery
  | 'unpadded-chair'    // hard plastic / metal stack chairs
  | 'pew-padded'        // cushioned wooden pew
  | 'pew-wood'          // bare wooden pew
  | 'standing';         // standing-only area (e.g. SRO)

export interface Zone {
  id: string;
  name: string;
  color: string;
  shape: Point[];      // polygon
  targetSPL: number;
  /** Seating type within this zone — drives audience absorption in RT60. */
  seatingType?: SeatingType;
  /** Number of seats in this zone. Defaults to room.occupancy share by area when unset. */
  seatCount?: number;
  /** Floor elevation of this zone above the room floor (ft). Use for balconies,
   *  raised stages, choir lofts. Defaults to 0 when unset. */
  floorHeightFt?: number;
  /** Ear height above this zone's floor (ft). When unset, falls back to the
   *  global earHeightFt from the store (typically 4 ft for seated audiences,
   *  5.5 ft for standing). Effective sampling z = floorHeightFt + earHeightFt. */
  earHeightFt?: number;
}

export interface SpeakerGroup {
  id: string;
  name: string;
  color: string;
  itemIds: string[];
  delayMs: number;
  gainDb: number;
  hpf: number;  // Hz
  lpf: number;  // Hz
}

export interface RT60Result {
  byBand: Record<OctaveBand, number>;
  average: number;
  rating: 'Excellent' | 'Good' | 'Moderate' | 'Reverberant' | 'Poor';
}

/**
 * Concert-hall-class spatial impression metrics (Sprint C13). Lateral
 * Fraction (LF, ISO 3382-1) measures how much early reflected energy
 * arrives from the SIDES of the listener vs the front — proxy for
 * "envelopment" / "width". IACC_E approximates inter-aural cross-
 * correlation in the early-energy window; lower = more spatial.
 *
 * Computed at a single room-centroid receiver, using the ISM image
 * sources for early-energy partition. Both metrics are room-average,
 * not per-cell — for design diagnosis, not seat-by-seat scoring.
 */
export interface SpatialMetricsResult {
  /** Overall LF averaged across the 500 / 1k / 2k bands per ISO 3382. */
  lf: number;
  /** Per-band LF (only the 3 heatmap bands: 125, 1k, 4k). */
  lfByBand: { 125: number; 1000: number; 4000: number };
  /** Approximate IACC_E (early-window). 1 = mono-like (narrow), 0 = fully
   *  decorrelated (wide). Derived empirically from LF — without HRTF data
   *  this is a rough indicator, not a measurement-grade value. */
  iaccE: number;
  iaccByBand: { 125: number; 1000: number; 4000: number };
  /** The receiver position used (room centroid by default). */
  listenerPos: Point3;
  /** Listener facing direction in degrees (0 = +x, CCW). */
  listenerFacingDeg: number;
  /** Number of audible early-window image-source contributions used. */
  imageCount: number;
}

export interface HeatmapData {
  grid: number[][];
  cellW: number;
  cellH: number;
  minX: number;
  minY: number;
  gridX: number;
  gridY: number;
  min: number;
  max: number;
  avg: number;
  std: number;
}

export interface Recommendation {
  id: string;
  severity: 'info' | 'warn' | 'ok';
  title: string;
  detail: string;
}

export interface SimulationState {
  rt60: RT60Result | null;
  heatmap: HeatmapData | null;
  sti: number | null;
  stiRating: string;
  recommendations: Recommendation[];
  noiseFloor: number;
  activeFreq: '125' | '1k' | '4k' | 'broadband';
  heatmapOpacity: number;
  showHeatmap: boolean;
  showCones: boolean;
  showRays: boolean;
  showMesh: boolean;
}

export interface ProjectMeta {
  name: string;
  clientName: string;
  consultantName: string;
  createdAt: string;
  updatedAt: string;
  version: string;
  notes?: string;
}

export interface Scenario {
  id: string;
  name: string;
  snapshot: {
    room: RoomState;
    equipment: EquipmentItem[];
    zones: Zone[];
    groups: SpeakerGroup[];
  };
  createdAt: string;
}

export interface ComplianceTargets {
  rt60Min: number;        // seconds (1k band)
  rt60Max: number;        // seconds
  stiMin: number;         // 0..1
  coverageStdMax: number; // dB (1σ)
  splMin: number;         // dB
  c50Min: number;         // dB
}

export interface Annotation {
  id: string;
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  createdAt: string;
}

export interface ProjectFile {
  meta: ProjectMeta;
  room: RoomState;
  equipment: EquipmentItem[];
  zones: Zone[];
  groups: SpeakerGroup[];
  simulation: {
    noiseFloor: number;
  };
  compliance?: ComplianceTargets;
  scenarios?: Scenario[];
  activeScenarioId?: string | null;
  annotations?: Annotation[];
  connections?: Connection[];
  /** Schema version stamped at save time. Absent on pre-versioning saves
   *  (treated as version 0 — the validator forward-migrates them). */
  schemaVersion?: number;
}

// =============== Cabling / wiring ===============

export type CableType =
  | 'xlr'         // analog mic / line audio
  | 'nl4'         // speaker (Speakon NL4 / NL2)
  | 'cat5e'       // network / Dante / control
  | 'cat6'
  | 'dmx'         // 5-pin DMX512 lighting
  | 'ac'          // AC mains power
  | 'fiber'       // optical fiber
  | 'hdmi'        // video
  | 'sdi'         // SDI video
  | 'trs'         // TRS / 1/4" line
  | 'usb';

export interface Connection {
  id: string;
  fromId: string;             // EquipmentItem.id (source — typically panel/console)
  toId: string;               // EquipmentItem.id (destination — typically powered device)
  cableType: CableType;
  /** Manual override for cable length in feet — defaults to a slack-padded straight-line distance. */
  lengthOverride?: number;
  /** Free-form label (e.g. "FOH L feed") shown when hovering. */
  label?: string;
}

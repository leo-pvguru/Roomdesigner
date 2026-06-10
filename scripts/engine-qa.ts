// =====================================================================
// Engine QA suite — exercises every pure (non-DOM) subsystem with
// assertions. Run with:  npm run qa:engine
// =====================================================================
/* eslint-disable no-console */

import { validateAndMigrateProject } from '../src/engine/projectValidation';
import { enumerateModes, schroederFrequency, analyzeModes, computeModalField, speedOfSoundFtS } from '../src/engine/modal';
import { rt60, computeHeatmap } from '../src/engine/acoustics';
import { buildRoomSurfaces, generateImageSources } from '../src/engine/ism';
import { traceRays, defaultRayOptions } from '../src/engine/rays';
import { planTreatment } from '../src/engine/treatment';
import { buildItemFromTemplate } from '../src/utils/itemBuilder';
import { EQUIPMENT } from '../src/constants/equipmentLibrary';
import { MATERIALS, getScattering, materialNRC } from '../src/constants/materials';
import { parseRoomPlanJSON } from '../src/importers/roomplan';
import {
  synthesizeIR, octaveBandpassInPlace, schroederT30, defaultListener, SPEED_OF_SOUND_FT_S,
} from '../src/engine/auralize';
import { OCTAVE_BANDS } from '../src/types';
import type { RoomState, EquipmentItem } from '../src/types';

let passed = 0, failed = 0;
const fails: string[] = [];
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; }
  else { failed++; fails.push(msg); console.error('  ✗', msg); }
}
function section(name: string) { console.log(`\n── ${name}`); }

// ---------- Fixtures ----------
function makeRoom(overrides: Partial<RoomState> = {}): RoomState {
  const w = overrides.width ?? 40, d = overrides.depth ?? 30;
  return {
    name: 'QA Room',
    shape: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }],
    width: w, depth: d, height: 14,
    ceilingShape: 'flat',
    occupancy: 100, occupied: false,
    roomType: 'multipurpose',
    surfaces: [
      { id: 's0', kind: 'wall', segmentIndex: 0, materialId: 'drywall' },
      { id: 's1', kind: 'wall', segmentIndex: 1, materialId: 'brick-bare' },
      { id: 's2', kind: 'wall', segmentIndex: 2, materialId: 'drywall' },
      { id: 's3', kind: 'wall', segmentIndex: 3, materialId: 'glass-window' },
      { id: 'sf', kind: 'floor', segmentIndex: 0, materialId: 'carpet-thick' },
      { id: 'sc', kind: 'ceiling', segmentIndex: 0, materialId: 'act-standard' },
    ],
    stage: null, unitSystem: 'imperial',
    ...overrides,
  };
}
function makeSpeaker(overrides: Partial<EquipmentItem> = {}): EquipmentItem {
  return {
    id: 'qa-spk', templateId: 'qa', kind: 'speaker-point', category: 'audio-speaker',
    label: 'QA Speaker', x: 20, y: 5, z: 12, rotation: 90, aim: 90, tilt: -10,
    horiz: 90, vert: 60, maxSPL: 130, sensitivity: 98, power: 400, drive: 75,
    ...overrides,
  };
}

// ---------- 1. Validation / migration ----------
section('Project validation & migration');
{
  const good = validateAndMigrateProject({
    meta: { name: 'X' }, room: makeRoom(), equipment: [], zones: [], groups: [],
  });
  ok(good.ok, 'valid project passes');
  ok(Array.isArray(good.project?.annotations), 'missing arrays are filled');
  ok(good.project?.simulation.noiseFloor === 35, 'noise floor defaulted');

  const noRoom = validateAndMigrateProject({ meta: {}, equipment: [] });
  ok(!noRoom.ok, 'project without room rejected');

  const degenerate = validateAndMigrateProject({ room: { shape: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } });
  ok(!degenerate.ok, '2-vertex room rejected');

  const legacy = validateAndMigrateProject({
    meta: { name: 'Old' },
    room: { shape: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 0, y: 20 }] },
    equipment: [{ id: 'a' }],
  });
  ok(legacy.ok, 'legacy save (missing fields) migrates');
  ok(legacy.project!.room.height > 0, 'legacy room height defaulted');
  ok(legacy.project!.zones.length === 0, 'legacy zones default to []');

  const badZones = validateAndMigrateProject({
    meta: { name: 'Z' }, room: makeRoom(),
    zones: [{ id: 'z1', shape: [{ x: 1, y: 1 }] }, { id: 'z2', name: 'ok', color: '#fff', shape: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }], targetSPL: 85 }],
  });
  ok(badZones.ok && badZones.project!.zones.length === 1, 'degenerate zones dropped, valid kept');
}

// ---------- 2. Modal engine ----------
section('Modal LF engine');
{
  const c = speedOfSoundFtS(70);
  ok(Math.abs(c - 1128) < 8, `speed of sound ~1128 ft/s (got ${c.toFixed(1)})`);

  const modes = enumerateModes(30, 20, 14, 80, 70);
  const ax = modes.filter(m => m.type === 'axial');
  ok(ax.length >= 3, 'axial modes found');
  ok(Math.abs(ax[0].f - c / 60) < 0.3, `first axial = c/2L (${ax[0].f.toFixed(1)} vs ${(c / 60).toFixed(1)})`);
  ok(modes.every((m, i) => i === 0 || m.f >= modes[i - 1].f), 'modes sorted ascending');
  ok(modes.every(m => m.f <= 80.01), 'fMax respected');

  const fs = schroederFrequency(30 * 20 * 14, 1.0);
  ok(fs > 80 && fs < 200, `Schroeder in plausible range (${fs.toFixed(0)} Hz)`);

  const analysis = analyzeModes(makeRoom(), 1.2);
  ok(analysis.modes.length > 0 && analysis.schroeder > 0, 'analyzeModes returns modes + Schroeder');
  ok(!analysis.approximate, 'rectangular room not flagged approximate');

  const lShape = makeRoom({ shape: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 15 }, { x: 20, y: 15 }, { x: 20, y: 30 }, { x: 0, y: 30 }] });
  ok(analyzeModes(lShape, 1.2).approximate, 'L-shaped room flagged approximate');

  const sub = makeSpeaker({ kind: 'speaker-sub', lfHz: 30, hfHz: 100, z: 1 });
  const field = computeModalField(makeRoom(), [sub], { freq: 63, t60LF: 1.5, resolutionFt: 4 });
  ok(field !== null, 'modal field computes with a sub');
  if (field) {
    ok(field.std > 0.5, `modal field shows standing-wave variation (±${field.std.toFixed(1)} dB)`);
    let finite = 0, nan = 0, bad = 0;
    for (const row of field.grid) for (const v of row) {
      if (Number.isFinite(v)) finite++;
      else if (Number.isNaN(v)) nan++;
      else bad++;
    }
    ok(finite > 0 && bad === 0, `field cells finite or NaN-outside only (${finite} finite, ${nan} outside, ${bad} bad)`);
  }
  const hfOnly = makeSpeaker({ lfHz: 120 });
  ok(computeModalField(makeRoom(), [hfOnly], { freq: 40, t60LF: 1 }) === null,
    'speaker that cannot reach the LF is excluded (null field)');
}

// ---------- 3. RT60 ----------
section('RT60 (Sabine/Eyring, furniture, degenerate)');
{
  const base = rt60(makeRoom(), [], [], [], true);
  ok(OCTAVE_BANDS.every(b => Number.isFinite(base.byBand[b]) && base.byBand[b] > 0.05 && base.byBand[b] < 20),
    `baseline RT60 finite & plausible (1k = ${base.byBand[1000]}s)`);

  const chairs: EquipmentItem[] = Array.from({ length: 40 }, (_, i) => ({
    id: `ch${i}`, templateId: 'c', kind: 'chair-padded', category: 'furniture',
    label: 'Chair', x: 5 + (i % 8) * 4, y: 10 + Math.floor(i / 8) * 3, z: 0, rotation: -90,
    width: 1.7, depth: 1.7,
    alpha: { 125: 0.19, 250: 0.37, 500: 0.56, 1000: 0.67, 2000: 0.61, 4000: 0.59 },
  }));
  const withChairs = rt60(makeRoom(), [], [], chairs, true);
  ok(withChairs.byBand[1000] < base.byBand[1000],
    `40 padded chairs reduce RT60 (${base.byBand[1000]}s → ${withChairs.byBand[1000]}s)`);

  const degenerate = rt60(makeRoom({ shape: [], height: 0 }), [], [], [], true);
  ok(degenerate.byBand[1000] === 99, 'degenerate room returns sentinel 99 (no NaN)');

  const sab = rt60(makeRoom(), [], [], [], false);
  ok(OCTAVE_BANDS.every(b => Number.isFinite(sab.byBand[b])), 'Sabine path finite');
}

// ---------- 4. ISM surfaces + scattering ----------
section('ISM surfaces & scattering');
{
  const surfaces = buildRoomSurfaces(makeRoom(), {});
  ok(surfaces.length >= 6, `surface count ≥ 6 (got ${surfaces.length})`);
  ok(surfaces.every(s => OCTAVE_BANDS.every(b =>
    Number.isFinite(s.reflectionLoss[b]) && Number.isFinite(s.scattering[b]) &&
    s.scattering[b] >= 0 && s.scattering[b] <= 1)),
    'every surface has finite reflectionLoss + scattering ∈ [0,1]');
  const imgs = generateImageSources(makeSpeaker(), surfaces, 2);
  ok(imgs.length > surfaces.length, `image sources generated (${imgs.length})`);
  ok(getScattering('diffuser-qrd')[1000] > getScattering('drywall')[1000],
    'QRD scatters more than drywall');
}

// ---------- 5. Ray tracer ----------
section('Ray tracer (with diffuse reflection)');
{
  const decay = traceRays(makeRoom(), [makeSpeaker()], { ...defaultRayOptions('low'), seed: 7 });
  const t30s = OCTAVE_BANDS.map(b => decay.rt60ByBand[b]).filter(v => v != null && Number.isFinite(v));
  ok(t30s.length >= 3, `ray-derived RT60 present for ≥3 bands (${t30s.length})`);
  ok(t30s.every(v => v! > 0.05 && v! < 20), 'ray RT60 values plausible');
  ok(decay.rayCount > 0, `rays cast (${decay.rayCount})`);
  // Determinism — same seed, same result.
  const decay2 = traceRays(makeRoom(), [makeSpeaker()], { ...defaultRayOptions('low'), seed: 7 });
  ok(decay.rt60ByBand[1000] === decay2.rt60ByBand[1000], 'seeded ray trace is deterministic');
}

// ---------- 6. Heatmap ----------
section('SPL heatmap');
{
  const hm = computeHeatmap(makeRoom(), [makeSpeaker()], '1k', 4, 4, [], false, 2, [], false);
  ok(hm !== null, 'heatmap computes');
  if (hm) {
    ok(Number.isFinite(hm.avg) && hm.avg > 40 && hm.avg < 130, `avg SPL plausible (${hm.avg.toFixed(1)} dB)`);
    let bad = 0;
    for (const row of hm.grid) for (const v of row) if (!Number.isFinite(v) && !Number.isNaN(v)) bad++;
    ok(bad === 0, 'no Infinity cells');
  }
  const hmRefl = computeHeatmap(makeRoom(), [makeSpeaker()], '125', 4, 4, [], true, 2, [], true);
  ok(hmRefl !== null && Number.isFinite(hmRefl!.avg), 'reflections + coherent sum at 125 Hz finite');
}

// ---------- 7. Treatment planner ----------
section('Auto-treatment planner');
{
  const hardRoom = makeRoom({
    surfaces: [
      { id: 's0', kind: 'wall', segmentIndex: 0, materialId: 'concrete-sealed' },
      { id: 's1', kind: 'wall', segmentIndex: 1, materialId: 'concrete-sealed' },
      { id: 's2', kind: 'wall', segmentIndex: 2, materialId: 'concrete-sealed' },
      { id: 's3', kind: 'wall', segmentIndex: 3, materialId: 'concrete-sealed' },
      { id: 'sf', kind: 'floor', segmentIndex: 0, materialId: 'concrete-floor' },
      { id: 'sc', kind: 'ceiling', segmentIndex: 0, materialId: 'gypsum-ceiling' },
    ],
  });
  const before = rt60(hardRoom, [], [], [], true).byBand[1000];
  const plan = planTreatment(hardRoom, [], [makeSpeaker()], [], { targetRT60: 1.0, strategy: 'both' });
  ok(plan.panels.length > 0, `planner adds panels in a hard room (${plan.panels.length})`);
  ok(plan.predictedRT60 < before, `treatment reduces RT60 (${before}s → ${plan.predictedRT60}s)`);
  ok(plan.panels.length <= 24, 'panel cap respected');
  ok(plan.panels.some(p => (p.panelW ?? 0) >= 8), 'large panels/clouds used when deficit is big');
  const reflOnly = planTreatment(hardRoom, [], [], [], { strategy: 'reflections' });
  ok(reflOnly.panels.length === 0, 'reflections-only with no speakers places nothing');
}

// ---------- 8. Item builder over the full catalog ----------
section('Item builder × full catalog');
{
  const room = makeRoom();
  let bad = 0;
  for (const t of EQUIPMENT) {
    const item = buildItemFromTemplate(t, { x: 10, y: 10 }, room);
    if (!item.id || !item.kind ||
        !Number.isFinite(item.x) || !Number.isFinite(item.y) || !Number.isFinite(item.z) ||
        !Number.isFinite(item.rotation)) {
      bad++;
      console.error(`    bad item from template: ${t.brand} ${t.label}`);
    }
  }
  ok(bad === 0, `all ${EQUIPMENT.length} templates build valid items`);
}

// ---------- 9. Materials DB ----------
section('Materials database');
{
  ok(MATERIALS.length >= 50, `≥50 materials (${MATERIALS.length})`);
  const badAlpha = MATERIALS.filter(m => OCTAVE_BANDS.some(b => !Number.isFinite(m.alpha[b]) || m.alpha[b] < 0));
  ok(badAlpha.length === 0, 'all alpha curves finite & non-negative');
  const ids = new Set(MATERIALS.map(m => m.id));
  ok(ids.size === MATERIALS.length, 'no duplicate material ids');
  ok(MATERIALS.every(m => materialNRC(m) >= 0), 'NRC computable for all');
}

// ---------- 10. RoomPlan importer (v2 floors + nested transforms) ----------
section('RoomPlan importer');
{
  // v2: floors.polygonCorners takes priority.
  const v2 = parseRoomPlanJSON({
    version: 2,
    walls: [],
    floors: [{ polygonCorners: [[0, 0, 0], [6, 0, 0], [6, 0, 8], [0, 0, 8]] }],
    objects: [],
  });
  ok(v2.usedFloorPolygon, 'v2 floors.polygonCorners path used');
  ok(Math.abs(v2.widthFt - 19.7) < 0.2, `v2 width correct (${v2.widthFt})`);

  // Nested 4×4 transform variant + window → glass-wall mapping.
  const nested = parseRoomPlanJSON({
    walls: [
      { category: { wall: {} }, dimensions: [6, 2.8, 0.1], transform: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [3, 1.4, 0, 1]] },
      { category: { wall: {} }, dimensions: [8, 2.8, 0.1], transform: [[0, 0, 1, 0], [0, 1, 0, 0], [-1, 0, 0, 0], [6, 1.4, 4, 1]] },
      { category: { wall: {} }, dimensions: [6, 2.8, 0.1], transform: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [3, 1.4, 8, 1]] },
      { category: { wall: {} }, dimensions: [8, 2.8, 0.1], transform: [[0, 0, 1, 0], [0, 1, 0, 0], [-1, 0, 0, 0], [0, 1.4, 4, 1]] },
    ],
    windows: [
      // On the east wall (x=6 m plane, mid-height)
      { category: { window: {} }, dimensions: [1.2, 1.0, 0.1], transform: [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 6, 1.5, 3, 1] },
    ],
  });
  ok(nested.shape.length === 4, 'nested-transform walls chain into a polygon');
  ok(nested.glassWallSegments.length === 1, `window mapped to exactly one wall segment (${JSON.stringify(nested.glassWallSegments)})`);

  let threw = false;
  try { parseRoomPlanJSON({ walls: [] }); } catch { threw = true; }
  ok(threw, 'empty scan throws a friendly error');
}

// ---------- Auralization (Phase C) ----------
section('Auralization — IR synthesis');
{
  // Hard floor so the treatment delta is visible
  const room = makeRoom({
    surfaces: [
      { id: 's0', kind: 'wall', segmentIndex: 0, materialId: 'drywall' },
      { id: 's1', kind: 'wall', segmentIndex: 1, materialId: 'brick-bare' },
      { id: 's2', kind: 'wall', segmentIndex: 2, materialId: 'drywall' },
      { id: 's3', kind: 'wall', segmentIndex: 3, materialId: 'concrete-sealed' },
      { id: 'sf', kind: 'floor', segmentIndex: 0, materialId: 'concrete-floor' },
      { id: 'sc', kind: 'ceiling', segmentIndex: 0, materialId: 'drywall' },
    ],
  });
  const spk = makeSpeaker();
  const base = { room, equipment: [spk], zones: [], groups: [] };

  const ir = synthesizeIR(base);
  ok(ir != null, 'IR synthesizes for a basic room');
  if (ir) {
    ok(ir.left.length === ir.right.length && ir.left.length > 0, 'stereo buffers allocated, equal length');

    // Direct-tap timing: distance speaker → listener over c
    const lp = defaultListener(room);
    const dist = Math.hypot(spk.x - lp.x, spk.y - lp.y, spk.z - lp.z);
    const expected = dist / SPEED_OF_SOUND_FT_S;
    ok(Math.abs(ir.directDelaySec - expected) < 0.001,
      `direct arrival matches geometry (${(ir.directDelaySec * 1000).toFixed(1)}ms vs ${(expected * 1000).toFixed(1)}ms)`);

    // IR length covers the decay
    ok(ir.lengthSec >= ir.t60ByBand[1000] * 0.9,
      `IR long enough for the 1k decay (${ir.lengthSec.toFixed(2)}s vs T60 ${ir.t60ByBand[1000].toFixed(2)}s)`);

    // Measured decay slope ≈ the Eyring T60 that drove the tail (1 kHz band)
    const band = new Float32Array(ir.left);
    octaveBandpassInPlace(band, ir.sampleRate, 1000);
    const t30 = schroederT30(band, ir.sampleRate, ir.directDelaySec + 0.09);
    ok(t30 != null, 'Schroeder T30 measurable from the IR');
    if (t30 != null) {
      const target = ir.t60ByBand[1000];
      ok(Math.abs(t30 - target) / target < 0.4,
        `measured decay ${t30.toFixed(2)}s within 40% of Eyring T60 ${target.toFixed(2)}s`);
    }

    // Stereo: channels decorrelated (tail noise differs)
    let differs = false;
    for (let i = Math.floor(ir.left.length / 2); i < ir.left.length; i++) {
      if (ir.left[i] !== ir.right[i]) { differs = true; break; }
    }
    ok(differs, 'left/right tails are decorrelated');

    // Determinism: same seed → identical output
    const ir2 = synthesizeIR(base);
    ok(ir2 != null && ir2.left[1000] === ir.left[1000] && ir2.right[5000] === ir.right[5000],
      'same seed reproduces the identical IR');
  }

  // Treatment A/B: rugs strip out in the untreated variant → longer T60
  const rugTpl = EQUIPMENT.find(t => t.kind === 'rug' && (t.defaultW ?? 0) >= 15);
  ok(!!rugTpl, 'rug template available for A/B fixture');
  if (rugTpl) {
    const rugs = [0, 1].map(i => ({
      ...buildItemFromTemplate(rugTpl, { x: 12 + i * 14, y: 15 }),
      id: `qa-rug-${i}`,
    }));
    const treated = synthesizeIR({ ...base, equipment: [spk, ...rugs], includeTreatment: true });
    const untreated = synthesizeIR({ ...base, equipment: [spk, ...rugs], includeTreatment: false });
    ok(treated != null && untreated != null, 'treated + untreated variants synthesize');
    if (treated && untreated) {
      ok(treated.t60ByBand[1000] < untreated.t60ByBand[1000],
        `treatment shortens T60 (${treated.t60ByBand[1000].toFixed(2)}s < ${untreated.t60ByBand[1000].toFixed(2)}s)`);
    }
  }

  // Outdoor: no reverberant field → no tail, short IR
  const outdoor = synthesizeIR({ ...base, room: makeRoom({ roomType: 'outdoor' }) });
  ok(outdoor != null && outdoor.outdoor, 'outdoor room flagged');
  if (outdoor) ok(outdoor.lengthSec < 1.0, `outdoor IR is direct-field only (${outdoor.lengthSec.toFixed(2)}s)`);

  // No speakers placed → virtual voice source still auditions the room
  const virtual = synthesizeIR({ ...base, equipment: [] });
  ok(virtual != null && virtual.tapCount > 0, 'virtual source used when no PA is placed');
}

// ---------- Summary ----------
console.log(`\n══════════════════════════════════`);
console.log(`  ${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.log('  Failures:');
  for (const f of fails) console.log('   ✗', f);
  process.exit(1);
}
console.log('  ENGINE QA: ALL PASS');

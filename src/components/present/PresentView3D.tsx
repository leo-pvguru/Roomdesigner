/**
 * Phase C — three.js presentation view.
 *
 * A real-time rendered 3D walkthrough of the designed room, used in Present
 * mode for client-facing reveals. This is deliberately separate from the
 * SVG schematic viewport: the schematic is the working drawing; this is the
 * "what it will feel like" view — lit, textured, and orbitable.
 *
 * Coordinate mapping (room → three):
 *   room x (ft, left-right)  → three x
 *   room z (ft, up)          → three y
 *   room y (ft, toward back) → three -z      (proper rotation, no mirroring)
 *
 * Equipment convention (matches equipment3d.tsx rotatedBoxFaces): an item's
 * `depth` runs ALONG its facing axis, `width` is LATERAL. rotation 0 = +x,
 * CCW positive. With object.rotation.y = θ the box's local +x maps to room
 * (cosθ, sinθ), so BoxGeometry(depth, height, width) keeps that convention.
 */
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useStore } from '../../stores/useStore';
import { getMaterial } from '../../constants/materials';
import { avgCeilingHeight } from '../../engine/acoustics';
import type { EquipmentItem, Point, RoomState, Zone } from '../../types';

const AuralizePanelLazy = React.lazy(() =>
  import('./AuralizePanel').then(m => ({ default: m.AuralizePanel })));

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

/** room (x, y, z) → three Vector3. */
function v3(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}

function bbox(shape: Point[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of shape) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

function centroid(shape: Point[]): Point {
  let sx = 0, sy = 0;
  for (const p of shape) { sx += p.x; sy += p.y; }
  return { x: sx / shape.length, y: sy / shape.length };
}

// ---------------------------------------------------------------------------
// Shared material cache — colors repeat constantly across a design, so meshes
// share THREE.Material instances keyed by color + surface options.
// ---------------------------------------------------------------------------

type MatOpts = {
  roughness?: number;
  metalness?: number;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
};

class MaterialCache {
  private map = new Map<string, THREE.MeshStandardMaterial>();

  get(color: string, opts: MatOpts = {}): THREE.MeshStandardMaterial {
    const key = `${color}|${opts.roughness ?? 0.9}|${opts.metalness ?? 0}|${opts.side ?? THREE.FrontSide}|${opts.opacity ?? 1}|${opts.emissive ?? ''}|${opts.emissiveIntensity ?? 0}`;
    let m = this.map.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        roughness: opts.roughness ?? 0.9,
        metalness: opts.metalness ?? 0,
        side: opts.side ?? THREE.FrontSide,
        transparent: opts.transparent ?? false,
        opacity: opts.opacity ?? 1,
      });
      if (opts.emissive) {
        m.emissive = new THREE.Color(opts.emissive);
        m.emissiveIntensity = opts.emissiveIntensity ?? 0.5;
      }
      this.map.set(key, m);
    }
    return m;
  }

  dispose() {
    for (const m of this.map.values()) m.dispose();
    this.map.clear();
  }
}

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------

/** Track all geometries created during a build so rebuilds can dispose them. */
class BuildContext {
  geoms: THREE.BufferGeometry[] = [];
  textures: THREE.Texture[] = [];
  constructor(public cache: MaterialCache) {}

  track<T extends THREE.BufferGeometry>(g: T): T { this.geoms.push(g); return g; }

  dispose() {
    for (const g of this.geoms) g.dispose();
    for (const t of this.textures) t.dispose();
    this.geoms = [];
    this.textures = [];
  }
}

/** A box whose `along` dimension runs along the facing axis. z = box BOTTOM. */
function addBox(
  ctx: BuildContext, group: THREE.Group, color: string,
  x: number, y: number, z: number,
  along: number, height: number, lateral: number,
  rotDeg: number, opts: MatOpts = {}, shadows = true,
): THREE.Mesh {
  const geo = ctx.track(new THREE.BoxGeometry(Math.max(0.05, along), Math.max(0.05, height), Math.max(0.05, lateral)));
  const mesh = new THREE.Mesh(geo, ctx.cache.get(color, opts));
  mesh.position.copy(v3(x, y, z + height / 2));
  mesh.rotation.y = rotDeg * Math.PI / 180;
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  group.add(mesh);
  return mesh;
}

/** Merge several translated box geometries into one mesh (1 draw call per item). */
function addMergedBoxes(
  ctx: BuildContext, group: THREE.Group, color: string,
  x: number, y: number, rotDeg: number,
  // Each part: [alongOffset, lateralOffset, bottomZ, alongDim, heightDim, lateralDim]
  parts: [number, number, number, number, number, number][],
  opts: MatOpts = {},
): THREE.Mesh | null {
  const geos: THREE.BufferGeometry[] = [];
  for (const [ao, lo, bz, ad, hd, ld] of parts) {
    const g = new THREE.BoxGeometry(Math.max(0.04, ad), Math.max(0.04, hd), Math.max(0.04, ld));
    // local: +x along facing, +z lateral (maps to room -y at rot 0 — symmetric
    // parts don't care; asymmetric offsets are computed in room coords below)
    g.translate(ao, bz + hd / 2, -lo);
    geos.push(g);
  }
  const merged = mergeGeometries(geos);
  for (const g of geos) g.dispose();
  if (!merged) return null;
  ctx.track(merged);
  const mesh = new THREE.Mesh(merged, ctx.cache.get(color, opts));
  mesh.position.copy(v3(x, y, 0));
  mesh.rotation.y = rotDeg * Math.PI / 180;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/** Ceiling height (ft) at a room xy for sloped/vaulted shapes. */
function ceilingHeightAt(room: RoomState, x: number, y: number): number {
  const h = room.height;
  const peak = room.peakHeight ?? h;
  const bb = bbox(room.shape);
  const longAxis: 'width' | 'depth' =
    room.ridgeAxis ?? ((bb.maxX - bb.minX) >= (bb.maxY - bb.minY) ? 'width' : 'depth');
  // Position across the cross-axis, normalized 0..1
  const cross = longAxis === 'width'
    ? (y - bb.minY) / Math.max(1e-6, bb.maxY - bb.minY)
    : (x - bb.minX) / Math.max(1e-6, bb.maxX - bb.minX);
  if (room.ceilingShape === 'sloped') {
    const highAt = room.peakOffset ?? 1;
    const t = highAt >= 0.5 ? cross : 1 - cross;
    return h + (peak - h) * t;
  }
  if (room.ceilingShape === 'vaulted') {
    const ridge = room.peakOffset ?? 0.5;
    const t = cross <= ridge
      ? cross / Math.max(1e-6, ridge)
      : (1 - cross) / Math.max(1e-6, 1 - ridge);
    return h + (peak - h) * Math.max(0, Math.min(1, t));
  }
  return avgCeilingHeight(room);
}

function buildRoomShell(ctx: BuildContext, group: THREE.Group, room: RoomState) {
  const shape = room.shape;
  if (!shape || shape.length < 3) return;
  const bb = bbox(shape);
  const ctr = centroid(shape);
  const isOutdoor = room.roomType === 'outdoor';

  // ===== Floor =====
  const floorMatId = room.surfaces.find(s => s.kind === 'floor')?.materialId ?? 'carpet-thick';
  const floorMat = getMaterial(floorMatId);
  const floorShape = new THREE.Shape(shape.map(p => new THREE.Vector2(p.x, p.y)));
  const floorGeo = ctx.track(new THREE.ShapeGeometry(floorShape));
  floorGeo.rotateX(-Math.PI / 2);   // (x, y, 0) → (x, 0, -y) — matches v3()
  const floor = new THREE.Mesh(floorGeo, ctx.cache.get(floorMat.color, { roughness: 1 }));
  floor.receiveShadow = true;
  group.add(floor);

  if (isOutdoor) return; // outdoor: ground only, open sky

  // ===== Walls (interior-facing planes; invisible from outside = dollhouse) =====
  const n = shape.length;
  for (let i = 0; i < n; i++) {
    const a = shape[i], b = shape[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.1) continue;
    const seg = room.surfaces.find(s => s.kind === 'wall' && s.segmentIndex === i);
    const mat = getMaterial(seg?.materialId ?? 'drywall');
    const isGlass = (seg?.materialId ?? '').includes('glass');
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Inward normal: perpendicular, flipped toward the centroid.
    let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    if (nx * (ctr.x - mid.x) + ny * (ctr.y - mid.y) < 0) { nx = -nx; ny = -ny; }
    // Wall height follows the ceiling at this segment for sloped/vaulted rooms.
    const hA = ceilingHeightAt(room, a.x, a.y);
    const hB = ceilingHeightAt(room, b.x, b.y);
    const h = Math.max(hA, hB);
    const geo = ctx.track(new THREE.PlaneGeometry(len, h));
    const mesh = new THREE.Mesh(geo, ctx.cache.get(mat.color, {
      roughness: isGlass ? 0.15 : 0.95,
      metalness: isGlass ? 0.05 : 0,
      transparent: isGlass,
      opacity: isGlass ? 0.28 : 1,
    }));
    mesh.position.copy(v3(mid.x, mid.y, h / 2));
    mesh.lookAt(v3(mid.x + nx, mid.y + ny, h / 2));
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ===== Ceiling =====
  const ceilSeg = room.surfaces.find(s => s.kind === 'ceiling' && s.segmentIndex === 0);
  const ceilMat = getMaterial(ceilSeg?.materialId ?? 'drywall');
  if (room.ceilingShape === 'sloped' || room.ceilingShape === 'vaulted') {
    // Displaced grid over the bbox — approximates ridge geometry. (For
    // L-shaped rooms the overhang outside the polygon is rarely visible
    // from interior camera angles; acceptable v1 tradeoff.)
    const SEG = 16;
    const bw = bb.maxX - bb.minX, bd = bb.maxY - bb.minY;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let iy = 0; iy <= SEG; iy++) {
      for (let ix = 0; ix <= SEG; ix++) {
        const rx = bb.minX + (ix / SEG) * bw;
        const ry = bb.minY + (iy / SEG) * bd;
        const rz = ceilingHeightAt(room, rx, ry);
        pos.push(rx, rz, -ry);
      }
    }
    for (let iy = 0; iy < SEG; iy++) {
      for (let ix = 0; ix < SEG; ix++) {
        const a0 = iy * (SEG + 1) + ix;
        idx.push(a0, a0 + 1, a0 + SEG + 1, a0 + 1, a0 + SEG + 2, a0 + SEG + 1);
      }
    }
    const geo = ctx.track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, ctx.cache.get(ceilMat.color, { roughness: 0.95, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    group.add(mesh);
  } else {
    const h = avgCeilingHeight(room);
    const geo = ctx.track(new THREE.ShapeGeometry(floorShape));
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, h, 0);
    // BackSide → visible from below (inside the room) only.
    const mesh = new THREE.Mesh(geo, ctx.cache.get(ceilMat.color, { roughness: 0.95, side: THREE.BackSide }));
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ===== Stage =====
  if (room.stage) {
    const { width: sw, depth: sd, height: sz } = room.stage;
    const cx = (bb.minX + bb.maxX) / 2;
    addBox(ctx, group, '#5b4128', cx, bb.minY + sd / 2, 0, sw, Math.max(0.3, sz), sd, 0, { roughness: 0.8 });
    // Slightly lighter deck surface on top
    addBox(ctx, group, '#7a5a38', cx, bb.minY + sd / 2, Math.max(0.3, sz), sw - 0.2, 0.06, sd - 0.2, 0, { roughness: 0.7 }, false);
  }

  // ===== Interior wall obstacles (balcony fronts, half-walls) =====
  for (const w of room.wallObstacles ?? []) {
    const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    if (len < 0.1) continue;
    const mat = getMaterial(w.materialId || 'drywall');
    const mid = { x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 };
    const rot = Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x) * 180 / Math.PI;
    addBox(ctx, group, mat.color, mid.x, mid.y, w.bottomZ, len, w.topZ - w.bottomZ, 0.35, rot, { roughness: 0.9 });
  }
}

/** Balcony slabs for elevated zones. */
function buildZones(ctx: BuildContext, group: THREE.Group, zones: Zone[]) {
  for (const z of zones) {
    const hFt = z.floorHeightFt ?? 0;
    if (hFt <= 0.5 || z.shape.length < 3) continue;
    const shape = new THREE.Shape(z.shape.map(p => new THREE.Vector2(p.x, p.y)));
    const geo = ctx.track(new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: false }));
    geo.rotateX(-Math.PI / 2);             // extrusion now runs UP
    const mesh = new THREE.Mesh(geo, ctx.cache.get('#3a3f48', { roughness: 0.9 }));
    mesh.position.y = hFt - 0.8;           // slab top lands at floorHeightFt
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

/** Map color temperature → a render color for fixture beams. */
function lightColor(kelvin: number | undefined): string {
  const k = kelvin ?? 3200;
  if (k < 3600) return '#ffd9a3';
  if (k < 5000) return '#fff1dc';
  return '#eaf2ff';
}

function speakerRotDeg(item: EquipmentItem): number {
  return item.aim ?? item.rotation ?? 0;
}

function buildEquipment(ctx: BuildContext, group: THREE.Group, items: EquipmentItem[], room: RoomState) {
  const bb = bbox(room.shape);
  const stageTarget = v3((bb.minX + bb.maxX) / 2, bb.minY + (room.stage?.depth ?? 8) / 2, (room.stage?.height ?? 0) + 4);
  let spotBudget = 8;       // hard cap on real SpotLights — perf
  let shadowSpots = 2;      // only the first couple cast shadows

  for (const item of items) {
    const { x, y, z } = item;
    const rot = item.rotation ?? 0;
    const w = item.width ?? 2;
    const d = item.depth ?? 2;
    const ih = item.itemHeight ?? 2;

    switch (item.kind) {
      // ===== Speakers =====
      case 'speaker-point':
      case 'speaker-delay':
      case 'speaker-fill': {
        addBox(ctx, group, '#1c1e22', x, y, z, d || 1.4, ih || 2.4, w || 1.6, speakerRotDeg(item), { roughness: 0.6 });
        break;
      }
      case 'speaker-column': {
        addBox(ctx, group, '#22252a', x, y, z, 0.6, ih || 3.5, 0.5, speakerRotDeg(item), { roughness: 0.6 });
        break;
      }
      case 'speaker-line-array': {
        const boxes = Math.max(2, Math.min(16, item.boxes ?? 6));
        const elemH = 0.95;
        const splayRad = ((item.splay ?? 4) * Math.PI) / 180;
        // Hang downward from z with progressive splay — the classic banana.
        let bz = z;
        let alongOff = 0;
        for (let i = 0; i < boxes; i++) {
          const shrink = 1 - i * 0.012;
          addBox(ctx, group, i % 2 ? '#1a1c20' : '#1f2227',
            x + Math.cos((speakerRotDeg(item)) * Math.PI / 180) * alongOff,
            y + Math.sin((speakerRotDeg(item)) * Math.PI / 180) * alongOff,
            bz - elemH, (d || 1.4) * shrink, elemH * 0.92, (w || 2.2) * shrink,
            speakerRotDeg(item), { roughness: 0.55 });
          bz -= elemH;
          alongOff += Math.sin(splayRad) * elemH * i * 0.35;
        }
        break;
      }
      case 'speaker-sub':
      case 'speaker-sub-flown': {
        const bz = item.kind === 'speaker-sub-flown' ? z - (ih || 2.5) : z;
        addBox(ctx, group, '#121419', x, y, bz, d || 2.5, ih || 2.5, w || 3, rot, { roughness: 0.7 });
        break;
      }
      case 'speaker-monitor': {
        addBox(ctx, group, '#1e2126', x, y, z, d || 1.6, 1.1, w || 2, speakerRotDeg(item), { roughness: 0.6 });
        break;
      }
      case 'speaker-ceiling': {
        const geo = ctx.track(new THREE.CylinderGeometry(0.55, 0.55, 0.35, 20));
        const mesh = new THREE.Mesh(geo, ctx.cache.get('#e8eaee', { roughness: 0.7 }));
        mesh.position.copy(v3(x, y, (z || avgCeilingHeight(room)) - 0.18));
        group.add(mesh);
        break;
      }
      case 'speaker-iem': break; // bodypack — invisible at room scale

      // ===== Consoles / racks / signal =====
      case 'foh-console':
      case 'monitor-console':
      case 'lx-console': {
        addMergedBoxes(ctx, group, '#262b35', x, y, rot, [
          [0, 0, 0, d || 3, 3.0, w || 5],            // desk body
        ], { roughness: 0.7 });
        // Glowing meter bridge — sells "live system" in the render
        addBox(ctx, group, '#0e1116', x, y, 3.0, (d || 3) * 0.7, 0.25, (w || 5) * 0.85, rot,
          { roughness: 0.4, emissive: '#2E87F5', emissiveIntensity: 0.7 }, false);
        break;
      }
      case 'amp-rack':
      case 'dimmer-rack':
      case 'rack': {
        addBox(ctx, group, '#1d2128', x, y, z, d || 2.5, ih || 6, w || 2.2, rot, { roughness: 0.75 });
        break;
      }
      case 'dsp':
      case 'pdu':
      case 'snake':
      case 'breaker-panel': {
        addBox(ctx, group, '#272c34', x, y, z, d || 1.5, ih || 1.2, w || 1.5, rot, { roughness: 0.8 });
        break;
      }

      // ===== Video =====
      case 'projector': {
        addBox(ctx, group, '#d8dce2', x, y, z, d || 1.8, 0.8, w || 1.4, speakerRotDeg(item), { roughness: 0.5 });
        break;
      }
      case 'led-wall': {
        const sw = item.screenWidthFt ?? w ?? 12;
        const sh = item.screenHeightFt ?? 7;
        addBox(ctx, group, '#0c0e12', x, y, z, 0.6, sh, sw, rot, { roughness: 0.5 });
        // Emissive face slightly proud of the frame
        const c = Math.cos(rot * Math.PI / 180), s = Math.sin(rot * Math.PI / 180);
        addBox(ctx, group, '#101725', x + c * 0.36, y + s * 0.36, z + 0.25, 0.05, sh - 0.5, sw - 0.5, rot,
          { roughness: 0.3, emissive: '#3D6DD8', emissiveIntensity: 1.4 }, false);
        break;
      }
      case 'confidence-monitor': {
        addBox(ctx, group, '#0e1014', x, y, z, 0.3, 2.2, w || 3.5, rot,
          { roughness: 0.4, emissive: '#274F8F', emissiveIntensity: 0.9 });
        break;
      }
      case 'ptz-camera':
      case 'cam-handheld': {
        addMergedBoxes(ctx, group, '#23262c', x, y, rot, [
          [0, 0, 0, 0.25, z || 4.5, 0.25],           // pole / tripod stem
          [0, 0, z || 4.5, 0.9, 0.7, 0.7],           // camera body
        ], { roughness: 0.6 });
        break;
      }

      // ===== Lighting fixtures =====
      case 'mh-spot':
      case 'mh-wash':
      case 'led-par':
      case 'followspot': {
        const isPar = item.kind === 'led-par';
        const bodyH = isPar ? 0.8 : 1.4;
        addMergedBoxes(ctx, group, '#23262b', x, y, rot, [
          [0, 0, z - 0.15, 0.9, 0.15, 0.9],          // clamp/base plate at hang point
          [0, 0, z - 0.15 - bodyH, 0.7, bodyH, 0.7], // head hanging below
        ], { roughness: 0.55 });
        // Real spotlight beams for the first few fixtures — the money shot.
        if (spotBudget > 0) {
          spotBudget--;
          const beamDeg = item.beamAngleDeg ?? (item.kind === 'mh-wash' ? 36 : isPar ? 30 : 16);
          const spot = new THREE.SpotLight(
            lightColor(item.colorTempK), 600, 120,
            (beamDeg / 2) * Math.PI / 180, 0.45, 1.2,
          );
          spot.position.copy(v3(x, y, Math.max(2, z - 0.2)));
          // Aim: follow the fixture aim if set, else wash the stage.
          if (item.aim != null || item.tilt != null) {
            const yaw = (item.aim ?? 0) * Math.PI / 180;
            const tilt = (item.tilt ?? -45) * Math.PI / 180;
            const reach = 25;
            spot.target.position.copy(v3(
              x + Math.cos(yaw) * Math.cos(tilt) * reach,
              y + Math.sin(yaw) * Math.cos(tilt) * reach,
              Math.max(0, z + Math.sin(tilt) * reach),
            ));
          } else {
            spot.target.position.copy(stageTarget);
          }
          if (shadowSpots > 0) {
            shadowSpots--;
            spot.castShadow = true;
            spot.shadow.mapSize.set(512, 512);
          }
          group.add(spot);
          group.add(spot.target);
        }
        break;
      }

      // ===== Truss =====
      case 'truss-straight': {
        const len = item.trussLengthFt ?? 10;
        const geoA = ctx.track(new THREE.CylinderGeometry(0.08, 0.08, len, 8));
        const tube = ctx.cache.get('#9aa2ad', { roughness: 0.35, metalness: 0.85 });
        for (const [oy, oz] of [[-0.5, 0], [0.5, 0], [0, 0.9]] as const) {
          const m = new THREE.Mesh(geoA, tube);
          m.rotation.z = Math.PI / 2;                 // lie along local x
          const c = Math.cos(rot * Math.PI / 180), s = Math.sin(rot * Math.PI / 180);
          m.position.copy(v3(x - s * oy, y + c * oy, z + oz + 0.1));
          m.rotation.y = rot * Math.PI / 180;
          m.castShadow = true;
          group.add(m);
        }
        break;
      }
      case 'truss-square': {
        const lw = item.trussWidthFt ?? 20, ld = item.trussDepthFt ?? 20;
        const tube = ctx.cache.get('#9aa2ad', { roughness: 0.35, metalness: 0.85 });
        const sides: [number, number, number, number][] = [
          [x, y - ld / 2, lw, 0], [x, y + ld / 2, lw, 0],
          [x - lw / 2, y, ld, 90], [x + lw / 2, y, ld, 90],
        ];
        for (const [sx, sy, slen, srot] of sides) {
          const g = ctx.track(new THREE.CylinderGeometry(0.08, 0.08, slen, 8));
          for (const oz of [0, 0.9]) {
            const m = new THREE.Mesh(g, tube);
            m.rotation.z = Math.PI / 2;
            m.position.copy(v3(sx, sy, z + oz + 0.1));
            m.rotation.y = (rot + srot) * Math.PI / 180;
            m.castShadow = true;
            group.add(m);
          }
        }
        break;
      }
      case 'truss-circle': {
        const r = (item.trussDiameterFt ?? 12) / 2;
        const geo = ctx.track(new THREE.TorusGeometry(r, 0.08, 8, 48));
        for (const oz of [0, 0.9]) {
          const m = new THREE.Mesh(geo, ctx.cache.get('#9aa2ad', { roughness: 0.35, metalness: 0.85 }));
          m.rotation.x = Math.PI / 2;
          m.position.copy(v3(x, y, z + oz + 0.1));
          m.castShadow = true;
          group.add(m);
        }
        break;
      }

      // ===== Acoustic treatment =====
      case 'acoustic-panel':
      case 'diffuser':
      case 'bass-trap': {
        const pw = item.panelW ?? 4;   // panel width (lateral on the wall)
        const ph = item.panelH ?? 2;   // panel height
        const color = item.panelColor ?? (item.kind === 'diffuser' ? '#8a6b4a' : '#7d7468');
        if (item.wall === 'C') {
          // Ceiling cloud — horizontal slab hung at z
          addBox(ctx, group, color, x, y, z, ph, 0.35, pw, rot, { roughness: 0.95 });
        } else {
          // Wall panel — thin box; rotation supplied by placement
          addBox(ctx, group, color, x, y, z, 0.35, ph, pw, rot, { roughness: 0.95 });
        }
        break;
      }

      // ===== Furniture =====
      case 'chair-padded':
      case 'chair-stacking': {
        const hex = item.panelColor ?? (item.kind === 'chair-padded' ? '#5C4033' : '#3F5564');
        addMergedBoxes(ctx, group, hex, x, y, rot, [
          [0, 0, 1.3, d * 0.8, 0.2, w * 0.85],            // seat
          [-d * 0.38, 0, 1.3, 0.16, 1.5, w * 0.85],       // backrest
          [0, 0, 0, d * 0.55, 1.3, w * 0.55],             // leg block (cheap)
        ], { roughness: 0.95 });
        break;
      }
      case 'pew': {
        const hex = item.panelColor ?? '#6B4226';
        addMergedBoxes(ctx, group, hex, x, y, rot, [
          [0, 0, 1.25, d * 0.85, 0.22, w],                // bench seat
          [-d * 0.4, 0, 1.25, 0.18, 1.6, w],              // backrest
          [0, -w / 2 + 0.1, 0, d * 0.85, 1.25, 0.2],      // end panel L
          [0, +w / 2 - 0.1, 0, d * 0.85, 1.25, 0.2],      // end panel R
        ], { roughness: 0.85 });
        break;
      }
      case 'table': {
        addMergedBoxes(ctx, group, '#7a5a38', x, y, rot, [
          [0, 0, 2.35, d, 0.15, w],                       // top
          [-d / 2 + 0.2, -w / 2 + 0.2, 0, 0.18, 2.35, 0.18],
          [-d / 2 + 0.2, +w / 2 - 0.2, 0, 0.18, 2.35, 0.18],
          [+d / 2 - 0.2, -w / 2 + 0.2, 0, 0.18, 2.35, 0.18],
          [+d / 2 - 0.2, +w / 2 - 0.2, 0, 0.18, 2.35, 0.18],
        ], { roughness: 0.8 });
        break;
      }
      case 'podium': {
        addMergedBoxes(ctx, group, '#5f4630', x, y, rot, [
          [0, 0, 0, d * 0.8, 3.6, w * 0.8],
          [0.25, 0, 3.6, d, 0.25, w],                     // reading top, proud at front
        ], { roughness: 0.8 });
        break;
      }
      case 'rug': {
        addBox(ctx, group, item.panelColor ?? '#6E3B3B', x, y, 0.02, d, 0.06, w, rot, { roughness: 1 }, false);
        break;
      }

      case 'cable-run':
      case 'reference-point':
        break; // schematic-only artifacts — not part of the rendered space

      default:
        // Unknown/new kinds: neutral box so nothing silently vanishes.
        addBox(ctx, group, '#3a3f48', x, y, z, d, ih, w, rot, { roughness: 0.85 });
    }
  }
}

/** Warm "house lights" — a small ceiling grid of point lights so the room
 *  interior reads naturally even before any fixtures are placed. */
function buildHouseDownlights(group: THREE.Group, room: RoomState) {
  if (room.roomType === 'outdoor' || room.shape.length < 3) return;
  const bb = bbox(room.shape);
  const W = bb.maxX - bb.minX, D = bb.maxY - bb.minY;
  const H = avgCeilingHeight(room);
  const cols = W > 55 ? 3 : 2;
  const rows = D > 65 ? 3 : 2;
  // Brightness scales with room span so big sanctuaries don't go dim.
  const intensity = 90 + Math.max(W, D) * 4.5;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = bb.minX + W * ((c + 1) / (cols + 1));
      const y = bb.minY + D * ((r + 1) / (rows + 1));
      const light = new THREE.PointLight('#ffe6c4', intensity, Math.max(W, D) * 1.5, 1.8);
      light.position.copy(v3(x, y, H - 1.5));
      group.add(light);
    }
  }
}

// ---------------------------------------------------------------------------
// View presets
// ---------------------------------------------------------------------------

type ViewPreset = 'orbit' | 'foh' | 'stage' | 'side';

function presetCamera(room: RoomState, preset: ViewPreset): { eye: THREE.Vector3; target: THREE.Vector3 } {
  const bb = bbox(room.shape);
  const W = bb.maxX - bb.minX, D = bb.maxY - bb.minY;
  const H = avgCeilingHeight(room);
  const cx = (bb.minX + bb.maxX) / 2;
  const center = v3(cx, bb.minY + D / 2, H * 0.35);
  switch (preset) {
    case 'foh':
      return { eye: v3(cx, bb.minY + D * 0.82, 5.8), target: v3(cx, bb.minY + D * 0.1, (room.stage?.height ?? 0) + 5) };
    case 'stage':
      return { eye: v3(cx, bb.minY + (room.stage?.depth ?? 6) * 0.6, (room.stage?.height ?? 0) + 5.5), target: v3(cx, bb.maxY - D * 0.15, 4.5) };
    case 'side':
      return { eye: v3(bb.minX - W * 0.25, bb.minY + D * 0.5, H * 0.9), target: center };
    case 'orbit':
    default: {
      const dist = Math.max(W, D) * 1.05 + H;
      return { eye: v3(cx - dist * 0.55, bb.minY - dist * 0.5, H * 1.5), target: center };
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PresentView3D() {
  const mountRef = useRef<HTMLDivElement>(null);
  const setPresentStyle = useStore(s => s.setPresentStyle);
  const [autoRotate, setAutoRotate] = useState(true);
  const [listenOpen, setListenOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<ViewPreset>('orbit');
  const controlsRef = useRef<OrbitControls | null>(null);
  const tweenRef = useRef<{ t: number; fromEye: THREE.Vector3; toEye: THREE.Vector3; fromTgt: THREE.Vector3; toTgt: THREE.Vector3 } | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0e13');

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    cameraRef.current = camera;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.52;   // don't dive (far) below the floor
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.7;
    controlsRef.current = controls;

    // ===== House lights (static) =====
    const houseLights = new THREE.Group();
    houseLights.add(new THREE.HemisphereLight('#cdd6e4', '#39312a', 0.85));
    houseLights.add(new THREE.AmbientLight('#ffffff', 0.22));
    const sun = new THREE.DirectionalLight('#fff3e0', 1.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(houseLights);
    scene.add(sun);

    const cache = new MaterialCache();
    let ctx = new BuildContext(cache);
    let content = new THREE.Group();
    scene.add(content);

    const rebuild = () => {
      scene.remove(content);
      ctx.dispose();
      content = new THREE.Group();
      ctx = new BuildContext(cache);
      const st = useStore.getState();
      buildRoomShell(ctx, content, st.room);
      buildZones(ctx, content, st.zones);
      buildEquipment(ctx, content, st.equipment, st.room);
      buildHouseDownlights(content, st.room);
      scene.add(content);

      // Fit the sun's shadow camera to the room
      const bb = bbox(st.room.shape);
      const W = bb.maxX - bb.minX, D = bb.maxY - bb.minY;
      const H = avgCeilingHeight(st.room);
      sun.position.copy(v3(bb.minX - W * 0.2, bb.minY - D * 0.3, H * 2.2));
      sun.target.position.copy(v3((bb.minX + bb.maxX) / 2, bb.minY + D / 2, 0));
      scene.add(sun.target);
      const cam = sun.shadow.camera as THREE.OrthographicCamera;
      const span = Math.max(W, D) * 0.9 + 10;
      cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span;
      cam.near = 1; cam.far = Math.max(W, D) * 4 + H * 4;
      cam.updateProjectionMatrix();
    };

    // Initial camera: orbit preset
    {
      const st = useStore.getState();
      const { eye, target } = presetCamera(st.room, 'orbit');
      camera.position.copy(eye);
      controls.target.copy(target);
    }
    rebuild();

    // Rebuild (debounced) when design state changes
    let pending: number | undefined;
    const unsub = useStore.subscribe((s, p) => {
      if (s.room === p.room && s.equipment === p.equipment && s.zones === p.zones) return;
      if (pending !== undefined) clearTimeout(pending);
      pending = window.setTimeout(rebuild, 120);
    });

    // Size to container
    const resize = () => {
      const wpx = el.clientWidth || 800;
      const hpx = el.clientHeight || 600;
      renderer.setSize(wpx, hpx);
      camera.aspect = wpx / hpx;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // Render loop with camera-tween support
    let raf = 0;
    let lastT = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      const tween = tweenRef.current;
      if (tween) {
        tween.t = Math.min(1, tween.t + dt / 0.8);
        const e = 1 - Math.pow(1 - tween.t, 3);    // ease-out cubic
        camera.position.lerpVectors(tween.fromEye, tween.toEye, e);
        controls.target.lerpVectors(tween.fromTgt, tween.toTgt, e);
        if (tween.t >= 1) tweenRef.current = null;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      if (pending !== undefined) clearTimeout(pending);
      unsub();
      ro.disconnect();
      controls.dispose();
      ctx.dispose();
      cache.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  const goToPreset = (p: ViewPreset) => {
    setActivePreset(p);
    const cam = cameraRef.current, controls = controlsRef.current;
    if (!cam || !controls) return;
    const { eye, target } = presetCamera(useStore.getState().room, p);
    tweenRef.current = {
      t: 0,
      fromEye: cam.position.clone(), toEye: eye,
      fromTgt: controls.target.clone(), toTgt: target,
    };
    // Auto-rotate only makes sense for the orbit preset
    const rotate = p === 'orbit' && autoRotate;
    controls.autoRotate = rotate;
  };

  const toggleAutoRotate = () => {
    const next = !autoRotate;
    setAutoRotate(next);
    if (controlsRef.current) controlsRef.current.autoRotate = next;
  };

  const pillBtn = (active: boolean): React.CSSProperties => ({
    fontFamily: 'Montserrat', fontWeight: 600, fontSize: 11.5,
    padding: '6px 12px', borderRadius: 999, border: 0, cursor: 'pointer',
    background: active ? 'var(--royal-blue, #1A4FBF)' : 'rgba(255,255,255,0.08)',
    color: active ? '#fff' : 'rgba(255,255,255,0.75)',
  });

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0b0e13' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Style switch — back to the schematic SVG view */}
      <div style={{
        position: 'absolute', top: 16, left: 16, zIndex: 30, display: 'flex', gap: 4,
        background: 'rgba(10,12,16,0.75)', borderRadius: 999, padding: 4,
        backdropFilter: 'blur(8px)', pointerEvents: 'auto',
      }}>
        <button style={pillBtn(true)} onClick={() => {}}>3D Render</button>
        <button style={pillBtn(false)} onClick={() => setPresentStyle('schematic')}>Schematic</button>
      </div>

      {/* Camera + listen pill bar */}
      <div style={{
        position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
        zIndex: 30, display: 'flex', gap: 4, alignItems: 'center',
        background: 'rgba(10,12,16,0.75)', borderRadius: 999, padding: 5,
        backdropFilter: 'blur(8px)', pointerEvents: 'auto',
      }}>
        {([['orbit', 'Orbit'], ['foh', 'FOH'], ['stage', 'Stage'], ['side', 'Side']] as const).map(([p, label]) => (
          <button key={p} style={pillBtn(activePreset === p)} onClick={() => goToPreset(p)}>{label}</button>
        ))}
        <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.15)', margin: '0 3px' }} />
        <button style={pillBtn(autoRotate && activePreset === 'orbit')} onClick={toggleAutoRotate}
          title="Slowly orbit the room (Orbit view)">
          ⟳ Auto
        </button>
        <button style={pillBtn(listenOpen)} onClick={() => setListenOpen(o => !o)}
          title="Auralization — hear this room's predicted acoustics">
          🔊 Listen
        </button>
      </div>

      {listenOpen && (
        <React.Suspense fallback={
          <div style={{
            position: 'absolute', bottom: 76, left: '50%', transform: 'translateX(-50%)',
            zIndex: 31, color: 'rgba(255,255,255,0.7)', fontFamily: 'Open Sans', fontSize: 12,
            background: 'rgba(10,12,16,0.85)', borderRadius: 12, padding: '10px 16px',
          }}>Loading auralization…</div>
        }>
          <AuralizePanelLazy onClose={() => setListenOpen(false)} />
        </React.Suspense>
      )}
    </div>
  );
}

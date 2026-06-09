import React from 'react';
import type { Point } from '../../types';

// =====================================================================
// Surface textures — realistic material rendering for room surfaces
// ---------------------------------------------------------------------
// Procedural, WORLD-SPACE textures so every material reads as its real
// counterpart: brick courses, CMU block grids, concrete speckle, wood
// planks & grain, slats, glass mullions + sheen, curtain folds, tile
// grids, carpet stipple, ACT ceiling grids, corrugated deck…
//
// Lines are generated in 3D room coordinates and projected through the
// caller's `p(x,y,z)` helper, so textures track the camera correctly in
// iso/walk/top views. Each surface clips its texture group with its own
// projected-polygon <clipPath>, which handles gabled wall tops and
// arbitrary ceiling facets exactly.
//
// Counts are capped per surface so a big room stays in the hundreds of
// SVG nodes, not thousands (LOD by stylization, not by zoom).
// =====================================================================

type Proj = (x: number, y: number, z: number) => [number, number];

/** Deterministic LCG so speckle/grain doesn't dance between re-renders. */
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function shade(hex: string, f: number): string {
  const m = hex.replace('#', '');
  const r = Math.min(255, Math.round(parseInt(m.slice(0, 2), 16) * f));
  const g = Math.min(255, Math.round(parseInt(m.slice(2, 4), 16) * f));
  const b = Math.min(255, Math.round(parseInt(m.slice(4, 6), 16) * f));
  return `rgb(${r},${g},${b})`;
}

export type TextureFamily =
  | 'brick' | 'block' | 'concrete' | 'smooth' | 'woodgrain' | 'slat'
  | 'glass' | 'curtain' | 'fabric' | 'perf' | 'marble' | 'tile'
  | 'planks' | 'carpet' | 'carpet-grid' | 'speckle-floor' | 'act' | 'corrugated'
  | 'none';

/** Map a material id to its visual texture family. */
export function textureFamilyFor(matId: string): TextureFamily {
  if (matId.startsWith('brick')) return 'brick';
  if (matId.startsWith('cmu')) return 'block';
  if (matId === 'concrete-floor') return 'speckle-floor';
  if (matId.startsWith('concrete')) return 'concrete';
  if (matId === 'wood-slat') return 'slat';
  if (matId.startsWith('wood-floor')) return 'planks';
  if (matId.startsWith('wood-paneling') || matId.startsWith('plywood') || matId === 'osb') return 'woodgrain';
  if (matId.startsWith('glass')) return 'glass';
  if (matId.startsWith('curtain')) return 'curtain';
  if (matId === 'perforated-metal') return 'perf';
  if (matId === 'marble-polished') return 'marble';
  if (matId === 'ceramic-tile') return 'tile';
  if (matId === 'ceramic-tile-floor') return 'tile';
  if (matId === 'metal-deck') return 'corrugated';
  if (matId === 'metal-panel') return 'smooth';
  if (matId.startsWith('act-')) return 'act';
  if (matId === 'carpet-tile') return 'carpet-grid';
  if (matId.startsWith('carpet')) return 'carpet';
  if (matId === 'vinyl-floor') return 'planks';
  if (matId === 'rubber-floor') return 'speckle-floor';
  if (matId === 'fabric-wrapped' || matId === 'mineral-wool-exposed' || matId === 'cork' || matId.startsWith('panel-') || matId === 'melamine-foam' || matId === 'ceiling-cloud') return 'fabric';
  if (matId.startsWith('diffuser')) return 'slat';
  return 'smooth';
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** True iff every coordinate is finite. Walk-mode projection returns
 *  [NaN, NaN] for points behind the camera — SVG polygons swallow that
 *  silently, but <line>/<circle> number attributes must never see NaN. */
const finite = (...ns: number[]) => ns.every(Number.isFinite);

// ---------------------------------------------------------------------
// Wall textures — vertical quad from edge (a→b) up to hMax, clip handles
// gabled tops.
// ---------------------------------------------------------------------
export function renderWallTexture(
  matId: string, color: string,
  a: Point, b: Point, hMax: number,
  p: Proj, seed: number,
): React.ReactNode[] {
  const fam = textureFamilyFor(matId);
  const out: React.ReactNode[] = [];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 0.5 || hMax < 0.5) return out;
  const rnd = lcg(seed);
  const k = (i: string) => `${seed}-${i}`;

  const hLine = (z: number, stroke: string, op: number, w = 0.6) => {
    const [x1, y1] = p(a.x, a.y, z);
    const [x2, y2] = p(b.x, b.y, z);
    if (!finite(x1, y1, x2, y2)) return null;
    return <line key={k(`h${z.toFixed(2)}`)} x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeOpacity={op} strokeWidth={w}/>;
  };
  const vLine = (u: number, z0: number, z1: number, stroke: string, op: number, w = 0.6, key?: string) => {
    const x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u);
    const [x1, y1] = p(x, y, z0);
    const [x2, y2] = p(x, y, z1);
    if (!finite(x1, y1, x2, y2)) return null;
    return <line key={k(key ?? `v${u.toFixed(3)}-${z0.toFixed(1)}`)} x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeOpacity={op} strokeWidth={w}/>;
  };

  switch (fam) {
    case 'brick':
    case 'block': {
      const courseStep = fam === 'brick' ? Math.max(0.45, hMax / 26) : Math.max(0.67, hMax / 18);
      const unitLen = fam === 'brick' ? 1.35 : 1.33;
      const mortar = shade(color, 1.35);
      const courses: number[] = [];
      for (let z = courseStep; z < hMax; z += courseStep) courses.push(z);
      for (const z of courses) out.push(hLine(z, mortar, 0.4, 0.55));
      // Staggered head joints — skip if it would explode the node count.
      const cols = Math.floor(len / unitLen);
      if (cols * courses.length <= 260) {
        courses.forEach((z, ci) => {
          const off = (ci % 2) * 0.5;
          for (let c = 0; c <= cols; c++) {
            const u = ((c + off) * unitLen) / len;
            if (u <= 0.01 || u >= 0.99) continue;
            out.push(vLine(u, z - courseStep, z, mortar, 0.32, 0.5, `t${ci}-${c}`));
          }
        });
      }
      break;
    }
    case 'concrete': {
      // Form-tie seams + speckle stains.
      for (let u = 0.25; u < 1; u += 0.25) out.push(vLine(u, 0, hMax, shade(color, 0.8), 0.18, 0.5));
      const n = Math.min(90, Math.round(len * hMax * 0.5));
      for (let i = 0; i < n; i++) {
        const u = rnd(), z = rnd() * hMax;
        const r = 0.5 + rnd() * 1.1;
        const fillF = rnd() > 0.5 ? 0.7 : 1.2;
        const [cx, cy] = p(lerp(a.x, b.x, u), lerp(a.y, b.y, u), z);
        if (!finite(cx, cy)) continue;
        out.push(<circle key={k(`s${i}`)} cx={cx} cy={cy} r={r}
          fill={shade(color, fillF)} fillOpacity={0.12}/>);
      }
      break;
    }
    case 'woodgrain': {
      const panelW = 4;
      for (let x = panelW; x < len; x += panelW) out.push(vLine(x / len, 0, hMax, shade(color, 0.65), 0.3, 0.6));
      const grains = Math.min(24, Math.round(len / 0.9));
      for (let i = 0; i < grains; i++) {
        const u = (i + 0.3 + rnd() * 0.4) / grains;
        out.push(vLine(u, hMax * rnd() * 0.25, hMax * (0.75 + rnd() * 0.25), shade(color, 0.78), 0.14, 0.45, `g${i}`));
      }
      break;
    }
    case 'slat': {
      const step = Math.max(0.30, len / 56);
      for (let x = step; x < len; x += step) out.push(vLine(x / len, 0, hMax, shade(color, 0.45), 0.5, 0.7));
      break;
    }
    case 'glass': {
      for (let x = 3; x < len; x += 3) out.push(vLine(x / len, 0, hMax, 'rgba(255,255,255,.9)', 0.25, 0.7));
      out.push(hLine(hMax * 0.5, 'rgba(255,255,255,.9)', 0.25, 0.7));
      // Diagonal sheen streaks
      for (let i = 0; i < 3; i++) {
        const u0 = 0.1 + i * 0.28, z0 = hMax * 0.12;
        const [x1, y1] = p(lerp(a.x, b.x, u0), lerp(a.y, b.y, u0), z0);
        const [x2, y2] = p(lerp(a.x, b.x, Math.min(1, u0 + 0.13)), lerp(a.y, b.y, Math.min(1, u0 + 0.13)), hMax * 0.88);
        if (!finite(x1, y1, x2, y2)) continue;
        out.push(<line key={k(`sh${i}`)} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff" strokeOpacity={0.18} strokeWidth={2.2}/>);
      }
      break;
    }
    case 'curtain': {
      const step = 0.85;
      for (let x = step; x < len; x += step) {
        const u = x / len;
        // Folds alternate light/dark for a draped read.
        const dark = Math.round(x / step) % 2 === 0;
        out.push(vLine(u, 0, hMax, dark ? shade(color, 0.7) : shade(color, 1.18), 0.32, 1.1, `f${x.toFixed(1)}`));
      }
      break;
    }
    case 'fabric': {
      const step = Math.max(0.5, hMax / 14);
      for (let z = step; z < hMax; z += step) out.push(hLine(z, shade(color, 0.85), 0.12, 0.5));
      break;
    }
    case 'perf': {
      const step = 0.55;
      const cols = Math.floor(len / step), rows = Math.floor(hMax / step);
      if (cols * rows <= 320) {
        for (let c = 1; c < cols; c++) for (let r = 1; r < rows; r++) {
          const [cx, cy] = p(lerp(a.x, b.x, (c * step) / len), lerp(a.y, b.y, (c * step) / len), r * step);
          if (!finite(cx, cy)) continue;
          out.push(<circle key={k(`p${c}-${r}`)} cx={cx} cy={cy} r={0.7} fill={shade(color, 0.5)} fillOpacity={0.5}/>);
        }
      }
      break;
    }
    case 'marble': {
      for (let i = 0; i < 4; i++) {
        const pts: string[] = [];
        let u = rnd() * 0.7, z = 0;
        let ok = true;
        while (z < hMax) {
          const [x1, y1] = p(lerp(a.x, b.x, Math.max(0, Math.min(1, u))), lerp(a.y, b.y, Math.max(0, Math.min(1, u))), z);
          if (!finite(x1, y1)) { ok = false; break; }
          pts.push(`${x1},${y1}`);
          z += hMax / 6;
          u += (rnd() - 0.45) * 0.12;
        }
        if (!ok) continue;
        out.push(<polyline key={k(`m${i}`)} points={pts.join(' ')} fill="none" stroke={shade(color, 0.78)} strokeOpacity={0.35} strokeWidth={0.6}/>);
      }
      break;
    }
    case 'tile': {
      for (let z = 1; z < hMax; z += 1) out.push(hLine(z, shade(color, 1.25), 0.3, 0.5));
      const cols = Math.floor(len);
      if (cols <= 60) for (let c = 1; c < cols; c++) out.push(vLine(c / len, 0, hMax, shade(color, 1.25), 0.3, 0.5, `tc${c}`));
      break;
    }
    case 'corrugated': {
      const step = 0.5;
      const cols = Math.floor(len / step);
      if (cols <= 90) for (let c = 1; c < cols; c++) {
        out.push(vLine((c * step) / len, 0, hMax, c % 2 ? shade(color, 0.8) : shade(color, 1.15), 0.35, 0.8, `cg${c}`));
      }
      break;
    }
    case 'act': {
      for (let z = 2; z < hMax; z += 2) out.push(hLine(z, shade(color, 0.8), 0.25, 0.5));
      for (let x = 2; x < len; x += 2) out.push(vLine(x / len, 0, hMax, shade(color, 0.8), 0.25, 0.5, `av${x}`));
      break;
    }
    case 'smooth':
    default: {
      // Faint 4-ft sheet seams — barely-there, breaks up large fields.
      for (let x = 4; x < len; x += 4) out.push(vLine(x / len, 0, hMax, shade(color, 0.8), 0.08, 0.5));
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Floor textures — drawn across the polygon bbox, clipped by the caller.
// ---------------------------------------------------------------------
export function renderFloorTexture(
  matId: string, color: string,
  shape: Point[],
  p: Proj, seed: number,
): React.ReactNode[] {
  const fam = textureFamilyFor(matId);
  const out: React.ReactNode[] = [];
  if (shape.length < 3) return out;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of shape) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  const w = maxX - minX, d = maxY - minY;
  const rnd = lcg(seed ^ 0x9e3779b9);
  const k = (i: string) => `f${seed}-${i}`;
  const Z = 0.03;
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, op: number, sw = 0.6, key?: string) => {
    const [px1, py1] = p(x1, y1, Z);
    const [px2, py2] = p(x2, y2, Z);
    if (!finite(px1, py1, px2, py2)) return null;
    return <line key={k(key ?? `${x1.toFixed(1)}-${y1.toFixed(1)}-${x2.toFixed(1)}`)} x1={px1} y1={py1} x2={px2} y2={py2} stroke={stroke} strokeOpacity={op} strokeWidth={sw}/>;
  };

  switch (fam) {
    case 'planks': {
      const isVinyl = matId === 'vinyl-floor';
      const plankW = isVinyl ? 0.62 : 0.42;
      const seam = shade(color, 0.68);
      const step = Math.max(plankW, d / 70);
      // Long boards run along the room's long axis.
      const alongX = w >= d;
      if (alongX) {
        for (let y = minY + step; y < maxY; y += step) out.push(line(minX, y, maxX, y, seam, isVinyl ? 0.22 : 0.32, 0.5, `p${y.toFixed(2)}`));
        // Staggered butt joints
        const rows = Math.floor(d / step);
        if (rows <= 70) for (let r = 0; r < rows; r++) {
          const y0 = minY + r * step, bl = 3 + rnd() * 3;
          for (let x = minX + ((r % 3) * bl) / 3 + bl * rnd() * 0.3; x < maxX; x += bl) {
            out.push(line(x, y0, x, Math.min(maxY, y0 + step), seam, 0.22, 0.45, `b${r}-${x.toFixed(1)}`));
          }
        }
      } else {
        for (let x = minX + step; x < maxX; x += step) out.push(line(x, minY, x, maxY, seam, isVinyl ? 0.22 : 0.32, 0.5, `p${x.toFixed(2)}`));
      }
      break;
    }
    case 'tile': {
      for (let x = minX + 1; x < maxX; x += 1) out.push(line(x, minY, x, maxY, shade(color, 1.22), 0.3, 0.45, `tx${x.toFixed(0)}`));
      for (let y = minY + 1; y < maxY; y += 1) out.push(line(minX, y, maxX, y, shade(color, 1.22), 0.3, 0.45, `ty${y.toFixed(0)}`));
      break;
    }
    case 'carpet-grid':
    case 'carpet': {
      if (fam === 'carpet-grid') {
        for (let x = minX + 2; x < maxX; x += 2) out.push(line(x, minY, x, maxY, shade(color, 0.85), 0.14, 0.5, `cx${x.toFixed(0)}`));
        for (let y = minY + 2; y < maxY; y += 2) out.push(line(minX, y, maxX, y, shade(color, 0.85), 0.14, 0.5, `cy${y.toFixed(0)}`));
      }
      const n = Math.min(380, Math.round(w * d * 0.45));
      for (let i = 0; i < n; i++) {
        const x = minX + rnd() * w, y = minY + rnd() * d;
        const r = 0.45 + rnd() * 0.5;
        const fillF = rnd() > 0.5 ? 0.78 : 1.18;
        const [cx, cy] = p(x, y, Z);
        if (!finite(cx, cy)) continue;
        out.push(<circle key={k(`st${i}`)} cx={cx} cy={cy} r={r}
          fill={shade(color, fillF)} fillOpacity={0.10}/>);
      }
      break;
    }
    case 'speckle-floor': {
      // Contraction joints + speckle (concrete / rubber).
      for (let x = minX + w / 3; x < maxX - 0.5; x += w / 3) out.push(line(x, minY, x, maxY, shade(color, 0.7), 0.25, 0.6, `jx${x.toFixed(0)}`));
      for (let y = minY + d / 3; y < maxY - 0.5; y += d / 3) out.push(line(minX, y, maxX, y, shade(color, 0.7), 0.25, 0.6, `jy${y.toFixed(0)}`));
      const n = Math.min(300, Math.round(w * d * 0.35));
      for (let i = 0; i < n; i++) {
        const r = 0.4 + rnd() * 0.7;
        const fillF = rnd() > 0.5 ? 0.75 : 1.2;
        const [cx, cy] = p(minX + rnd() * w, minY + rnd() * d, Z);
        if (!finite(cx, cy)) continue;
        out.push(<circle key={k(`sp${i}`)} cx={cx} cy={cy} r={r}
          fill={shade(color, fillF)} fillOpacity={0.12}/>);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

// ---------------------------------------------------------------------
// Ceiling textures — per planar facet; z interpolated on the facet plane.
// ---------------------------------------------------------------------
export function renderCeilingTexture(
  matId: string, color: string,
  vertices: [number, number, number][],
  p: Proj, seed: number,
): React.ReactNode[] {
  const fam = textureFamilyFor(matId);
  const out: React.ReactNode[] = [];
  if (vertices.length < 3) return out;
  if (fam !== 'act' && fam !== 'corrugated' && fam !== 'woodgrain' && fam !== 'planks' && fam !== 'fabric') return out;

  // Plane fit from the first 3 non-collinear vertices.
  const [v0, v1, v2] = [vertices[0], vertices[1], vertices[2]];
  const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
  const n = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  if (Math.abs(n[2]) < 1e-6) return out;     // vertical facet — skip
  const zAt = (x: number, y: number) =>
    v0[2] - (n[0] * (x - v0[0]) + n[1] * (y - v0[1])) / n[2] - 0.03;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of vertices) {
    if (v[0] < minX) minX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] > maxY) maxY = v[1];
  }
  const k = (i: string) => `c${seed}-${i}`;
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, op: number, key: string) => {
    const [px1, py1] = p(x1, y1, zAt(x1, y1));
    const [px2, py2] = p(x2, y2, zAt(x2, y2));
    if (!finite(px1, py1, px2, py2)) return null;
    return <line key={k(key)} x1={px1} y1={py1} x2={px2} y2={py2} stroke={stroke} strokeOpacity={op} strokeWidth={0.5}/>;
  };

  if (fam === 'act') {
    // Classic 2×4 lay-in grid.
    for (let x = Math.ceil(minX / 2) * 2; x < maxX; x += 2) out.push(line(x, minY, x, maxY, shade(color, 0.72), 0.3, `gx${x}`));
    for (let y = Math.ceil(minY / 4) * 4; y < maxY; y += 4) out.push(line(minX, y, maxX, y, shade(color, 0.72), 0.3, `gy${y}`));
  } else if (fam === 'corrugated') {
    const step = 0.6;
    const cols = Math.floor((maxX - minX) / step);
    if (cols <= 120) for (let c = 1; c < cols; c++) {
      const x = minX + c * step;
      out.push(line(x, minY, x, maxY, c % 2 ? shade(color, 0.8) : shade(color, 1.12), 0.3, `cr${c}`));
    }
  } else if (fam === 'woodgrain' || fam === 'planks') {
    const step = Math.max(0.45, (maxY - minY) / 40);
    for (let y = minY + step; y < maxY; y += step) out.push(line(minX, y, maxX, y, shade(color, 0.7), 0.25, `wp${y.toFixed(1)}`));
  } else if (fam === 'fabric') {
    const step = Math.max(0.8, (maxY - minY) / 12);
    for (let y = minY + step; y < maxY; y += step) out.push(line(minX, y, maxX, y, shade(color, 0.85), 0.1, `fb${y.toFixed(1)}`));
  }
  return out;
}

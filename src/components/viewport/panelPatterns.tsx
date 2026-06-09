// =====================================================================
// Acoustic-panel surface patterns
// ---------------------------------------------------------------------
// Each acoustic product has a distinctive surface texture — fabric weave
// (GIK, Primacoustic, ATS, ELiTE), foam pyramids (Auralex Studiofoam),
// QRD diffuser block grid (GIK Q7d, RPG QRD), skyline (Auralex T-Fusor,
// RPG Skyline, RPG BAD), wood slats (GIK Alpha, RPG QRD-734), wave wood
// (Vicoustic), or cylindrical (Real Traps MondoTrap).
//
// Each renderer takes the panel's 4 corners (in the order: bottom-left,
// bottom-right, top-right, top-left from the wall's normal-facing side)
// and a `pp(points)` helper that projects a list of world-space points
// to SVG path-coordinate string. Returns SVG nodes to overlay on the
// flat polygon that PanelGlyph already draws as the base color.
// =====================================================================

import React from 'react';

type Vec3 = [number, number, number];

/** Bilinear interpolation across a panel's 4 corners.
 *  u runs 0..1 along the bottom edge (left→right);
 *  v runs 0..1 along the left edge (bottom→top). */
function panelUV(corners: Vec3[], u: number, v: number): Vec3 {
  const [bl, br, tr, tl] = corners;
  const bx = bl[0] + u * (br[0] - bl[0]);
  const by = bl[1] + u * (br[1] - bl[1]);
  const bz = bl[2] + u * (br[2] - bl[2]);
  const tx = tl[0] + u * (tr[0] - tl[0]);
  const ty = tl[1] + u * (tr[1] - tl[1]);
  const tz = tl[2] + u * (tr[2] - tl[2]);
  return [
    bx + v * (tx - bx),
    by + v * (ty - by),
    bz + v * (tz - bz),
  ];
}

/** Multiply a hex color by a factor (with clamp). */
function shade(hex: string, factor: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  r = Math.max(0, Math.min(255, Math.round(r * factor)));
  g = Math.max(0, Math.min(255, Math.round(g * factor)));
  b = Math.max(0, Math.min(255, Math.round(b * factor)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------
// Pattern: fabric (default — most absorber panels)
// ---------------------------------------------------------------------
// Plain fabric panel — just a subtle horizontal weave hint via a few
// faint cross-bars. The base polygon already provides the color.
function renderFabricPattern(
  corners: Vec3[],
  pp: (pts: Vec3[]) => string,
  color: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // 6 faint horizontal seam lines — looks like fabric weave from a distance
  for (let i = 1; i < 6; i++) {
    const v = i / 6;
    out.push(
      <polyline
        key={`fab-${i}`}
        points={pp([panelUV(corners, 0.04, v), panelUV(corners, 0.96, v)])}
        fill="none"
        stroke={shade(color, 0.85)}
        strokeWidth={0.20}
        strokeOpacity={0.45}
        pointerEvents="none"
      />,
    );
  }
  // Frame — thin outline to suggest the edge bezel
  out.push(
    <polygon
      key="fab-frame"
      points={pp([
        panelUV(corners, 0.025, 0.025),
        panelUV(corners, 0.975, 0.025),
        panelUV(corners, 0.975, 0.975),
        panelUV(corners, 0.025, 0.975),
      ])}
      fill="none"
      stroke={shade(color, 0.65)}
      strokeWidth={0.30}
      pointerEvents="none"
    />,
  );
  return out;
}

// ---------------------------------------------------------------------
// Pattern: foam-wedge (Auralex Studiofoam, LENRD bass trap)
// ---------------------------------------------------------------------
// Repeating diagonal pyramid pattern — the iconic "studio foam" look.
// Each pyramid is rendered as 4 triangle quadrants with shading that
// suggests 3D pyramid relief.
function renderFoamWedgePattern(
  corners: Vec3[],
  pp: (pts: Vec3[]) => string,
  color: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const cols = 8;
  const rows = 6;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const u0 = i / cols, u1 = (i + 1) / cols;
      const v0 = j / rows, v1 = (j + 1) / rows;
      const uM = (u0 + u1) / 2, vM = (v0 + v1) / 2;
      const center = panelUV(corners, uM, vM);
      const c00 = panelUV(corners, u0, v0);
      const c10 = panelUV(corners, u1, v0);
      const c11 = panelUV(corners, u1, v1);
      const c01 = panelUV(corners, u0, v1);
      // Four triangle quadrants with directional shading — top-left
      // brightest, bottom-right darkest, suggesting an upper-left light
      // hitting each pyramid.
      const tris: [Vec3[], number][] = [
        [[center, c00, c10], 1.20],   // top  (looking from camera) — bright
        [[center, c10, c11], 0.65],   // right — dim
        [[center, c11, c01], 0.45],   // bottom — darkest
        [[center, c01, c00], 1.05],   // left — slightly bright
      ];
      for (let q = 0; q < 4; q++) {
        const [pts, factor] = tris[q];
        out.push(
          <polygon
            key={`fw-${i}-${j}-${q}`}
            points={pp(pts)}
            fill={shade(color, factor)}
            stroke="rgba(0,0,0,.30)"
            strokeWidth={0.10}
            pointerEvents="none"
          />,
        );
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Pattern: qrd (GIK Q7d, RPG QRD-734)
// ---------------------------------------------------------------------
// Quadratic-residue diffuser — 7×7 grid of "wells" of varying depth.
// We use the actual QRD-7 sequence (residues of i² mod 7) to drive
// shading per cell, so the pattern reads as a real QRD on the wall.
const QRD7 = [0, 1, 4, 2, 2, 4, 1];   // a² mod 7 for a = 0..6

function renderQrdPattern(
  corners: Vec3[],
  pp: (pts: Vec3[]) => string,
  color: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const cols = 7, rows = 7;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      // Combine row + column residue → 2D depth
      const depth = (QRD7[i] + QRD7[j]) % 7;   // 0..6 — 0 is shallowest, 6 is deepest
      // Shallow wells: bright; deep wells: dark
      const factor = 1.05 - (depth / 6) * 0.65;
      const u0 = (i + 0.06) / cols;
      const u1 = (i + 0.94) / cols;
      const v0 = (j + 0.06) / rows;
      const v1 = (j + 0.94) / rows;
      out.push(
        <polygon
          key={`qrd-${i}-${j}`}
          points={pp([
            panelUV(corners, u0, v0),
            panelUV(corners, u1, v0),
            panelUV(corners, u1, v1),
            panelUV(corners, u0, v1),
          ])}
          fill={shade(color, factor)}
          stroke="rgba(0,0,0,.45)"
          strokeWidth={0.15}
          pointerEvents="none"
        />,
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Pattern: skyline (Auralex T-Fusor, RPG Skyline, RPG BAD)
// ---------------------------------------------------------------------
// Random-looking heights in a finer grid — visually similar to QRD but
// less mathematically structured. RPG's 2D Skyline uses a primitive-
// root-based pseudo-random sequence; we approximate with a deterministic
// LCG so the look is consistent and not noisy on every render.
function renderSkylinePattern(
  corners: Vec3[],
  pp: (pts: Vec3[]) => string,
  color: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const cols = 9, rows = 9;
  // Deterministic pseudo-random via prime-based seed.
  const heights: number[] = [];
  let s = 1;
  for (let k = 0; k < cols * rows; k++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    heights.push(s / 2147483648);
  }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const depth = heights[i * rows + j];
      const factor = 0.45 + depth * 0.65;
      const u0 = (i + 0.10) / cols;
      const u1 = (i + 0.90) / cols;
      const v0 = (j + 0.10) / rows;
      const v1 = (j + 0.90) / rows;
      out.push(
        <polygon
          key={`sky-${i}-${j}`}
          points={pp([
            panelUV(corners, u0, v0),
            panelUV(corners, u1, v0),
            panelUV(corners, u1, v1),
            panelUV(corners, u0, v1),
          ])}
          fill={shade(color, factor)}
          stroke="rgba(0,0,0,.40)"
          strokeWidth={0.13}
          pointerEvents="none"
        />,
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Pattern: wood-slat (GIK Alpha 1D, RPG QRD-734)
// ---------------------------------------------------------------------
// Vertical wood slats — alternating shade suggests rounded slats.
// Used by 1D diffusers and slat-faced absorber/diffuser hybrids.
function renderWoodSlatPattern(
  corners: Vec3[],
  pp: (pts: Vec3[]) => string,
  color: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const slatCount = 18;
  for (let i = 0; i < slatCount; i++) {
    const u0 = i / slatCount + 0.005;
    const u1 = (i + 1) / slatCount - 0.005;
    const factor = 0.85 + (i % 2) * 0.20;     // alternating brightness for slat-relief feel
    out.push(
      <polygon
        key={`ws-${i}`}
        points={pp([
          panelUV(corners, u0, 0.02),
          panelUV(corners, u1, 0.02),
          panelUV(corners, u1, 0.98),
          panelUV(corners, u0, 0.98),
        ])}
        fill={shade(color, factor)}
        stroke="rgba(0,0,0,.35)"
        strokeWidth={0.12}
        pointerEvents="none"
      />,
    );
  }
  return out;
}

// ---------------------------------------------------------------------
// Pattern: wave-wood (Vicoustic Wavewood, Multifuser DC2)
// ---------------------------------------------------------------------
// Horizontal sinusoidal bands suggesting the iconic curved-wood
// Vicoustic diffuser pattern. Each band is a polygon with sine-wave
// upper and lower edges.
function renderWaveWoodPattern(
  corners: Vec3[],
  pp: (pts: Vec3[]) => string,
  color: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const bands = 7;
  const samples = 28;
  const amp = 0.04;     // wave amplitude in v units
  const freq = 4;       // sine cycles across the panel width
  for (let i = 0; i < bands; i++) {
    const v0Base = i / bands;
    const v1Base = (i + 1) / bands;
    const phase = i * 0.55;
    const bandPts: Vec3[] = [];
    // Top edge of band, left to right
    for (let s = 0; s <= samples; s++) {
      const u = s / samples;
      const wave = amp * Math.sin(u * Math.PI * freq + phase);
      bandPts.push(panelUV(corners, u, Math.min(1, Math.max(0, v0Base + wave))));
    }
    // Bottom edge of band, right to left
    for (let s = samples; s >= 0; s--) {
      const u = s / samples;
      const wave = amp * Math.sin(u * Math.PI * freq + phase + 0.6);
      bandPts.push(panelUV(corners, u, Math.min(1, Math.max(0, v1Base + wave))));
    }
    const factor = 0.78 + (i % 2) * 0.30;
    out.push(
      <polygon
        key={`ww-${i}`}
        points={pp(bandPts)}
        fill={shade(color, factor)}
        stroke="rgba(0,0,0,.30)"
        strokeWidth={0.13}
        pointerEvents="none"
      />,
    );
  }
  return out;
}

// ---------------------------------------------------------------------
// Pattern: cylindrical (Real Traps MondoTrap)
// ---------------------------------------------------------------------
// Round-faced bass trap — render the panel as if it were a tall
// vertical cylinder by adding curved shading across its width
// (a vertical column of horizontal half-ellipses suggesting roundness).
function renderCylindricalPattern(
  corners: Vec3[],
  pp: (pts: Vec3[]) => string,
  color: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Vertical "highlight stripe" running down the middle to suggest a
  // glossy curved face.
  const stripes = 10;
  for (let i = 0; i < stripes; i++) {
    const u0 = i / stripes;
    const u1 = (i + 1) / stripes;
    // Radial shading: brightest in the middle, darker at edges.
    const center = (u0 + u1) / 2;
    const distFromCenter = Math.abs(center - 0.5) * 2;
    const factor = 1.20 - distFromCenter * 0.70;
    out.push(
      <polygon
        key={`cyl-${i}`}
        points={pp([
          panelUV(corners, u0, 0.04),
          panelUV(corners, u1, 0.04),
          panelUV(corners, u1, 0.96),
          panelUV(corners, u0, 0.96),
        ])}
        fill={shade(color, factor)}
        stroke="none"
        pointerEvents="none"
      />,
    );
  }
  return out;
}

// ---------------------------------------------------------------------
// Public dispatch
// ---------------------------------------------------------------------

/** Render a brand-specific surface pattern overlay on a panel face.
 *  Returns the SVG nodes to layer on top of the base polygon. */
export function renderPanelPattern(
  pattern: string | undefined,
  corners: Vec3[],
  pp: (pts: Vec3[]) => string,
  color: string,
): React.ReactNode[] {
  if (!pattern || pattern === 'fabric')   return renderFabricPattern(corners, pp, color);
  if (pattern === 'foam-wedge')           return renderFoamWedgePattern(corners, pp, color);
  if (pattern === 'qrd')                  return renderQrdPattern(corners, pp, color);
  if (pattern === 'skyline')              return renderSkylinePattern(corners, pp, color);
  if (pattern === 'wood-slat')            return renderWoodSlatPattern(corners, pp, color);
  if (pattern === 'wave-wood')            return renderWaveWoodPattern(corners, pp, color);
  if (pattern === 'cylindrical')          return renderCylindricalPattern(corners, pp, color);
  return [];
}

/** Default panel face color — fallback when the template doesn't specify one. */
export const DEFAULT_PANEL_COLOR = '#C9B79C';   // tan fabric, GIK 242 typical

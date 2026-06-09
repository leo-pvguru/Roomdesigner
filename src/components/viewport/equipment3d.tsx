// =====================================================================
// 3D shape recipes for equipment items.
// ---------------------------------------------------------------------
// Each shape recipe returns an array of `Face3` (4-point polygons in
// world-space feet). The viewport projects them through the same pp()
// helper that draws walls and truss, so they sit in the same iso/walk
// camera as everything else and depth-sort against the room geometry.
//
// Convention: a "face" is given as 4 [x, y, z] points in CCW order when
// looking at the face from outside. Per-face fill colors are returned
// in parallel so we can shade with a faux-light scheme (front lit, sides
// half-lit, top brightest).
// =====================================================================

import React from 'react';
import type { EquipmentItem } from '../../types';

export type Vec3 = [number, number, number];
export type Face3 = Vec3[];

export interface ShapeDetail {
  /** World-space polygon (closed = filled shape; open = polyline / line). */
  points: Vec3[];
  closed: boolean;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fillOpacity?: number;
  /** Depth-sort key. We default to the average of all points' depths
   *  + a small bias so details render ON TOP of their parent face. */
  depth?: number;
}

export interface Shape3D {
  /** Faces in world coordinates. */
  faces: Face3[];
  /** Depth-sort key per face — higher means "render later" (in front). The
   *  caller may sort by this before emitting SVG so we get rough painter's-
   *  algorithm correctness. */
  faceDepths: number[];
  /** Per-face fill color. Indices align with `faces`. */
  faceFills: string[];
  /** Per-face stroke color (or null for no stroke). */
  faceStrokes: (string | null)[];
  /** Optional detail overlays (woofer cones, horn cutouts, panel grids,
   *  lens rings, fader lines, etc.). Drawn AFTER faces, depth-sorted with
   *  a small forward bias so they sit on top of their parent face. */
  details?: ShapeDetail[];
}

// ---------------------------------------------------------------------
// Brand profiles
// ---------------------------------------------------------------------
//
// Every major AVL manufacturer has a recognizable visual identity —
// cabinet color, horn waveguide style, driver layout, badge color. A
// JBL VTX line-array element in person looks distinctly NOT like a
// d&b Y8 even though they're both "trapezoidal flown enclosures with
// drivers + horns". We capture each brand's signature design language
// here, then have the per-kind shape recipes read from this map so a
// JBL Pro speaker draws like a JBL and a Meyer Sound speaker draws
// like a Meyer.
//
// Colors are based on real product photography of current install
// product lines. Taper, horn style, and driver layout are
// approximations that capture the visual identity without trying to
// be a literal CAD model.
// ---------------------------------------------------------------------

export interface BrandProfile {
  /** Cabinet primary color (base of the box). */
  primary: string;
  /** Slightly brighter / different accent — used on horn surrounds,
   *  trim rings, side stripes. Optional. */
  accent?: string;
  /** Brand badge / logo color. Drawn as a small mark on the front
   *  face so the user can identify the speaker at a glance. */
  badge?: string;
  /** Cabinet front-vs-back taper. 0 = rectangular box, 0.20 = front
   *  is 20% wider than back (trapezoidal cabinet). Most line-array
   *  and install speakers are trapezoidal. */
  cabinetTaper: number;
  /** Horn waveguide style — drives how the central horn slot is drawn
   *  on the front face. */
  hornStyle: 'rectangular' | 'central-flare' | 'trapezoidal' | 'synergy' | 'none';
  /** Driver topology that determines the front-face circle pattern.
   *   • coaxial    — single central driver with tweeter dot in middle
   *   • two-way    — woofer below + tweeter on horn
   *   • dual-woofer-flanking — two woofers flanking a central horn
   *   • synergy    — full-face waveguide with multiple driver mouths */
  driverStyle: 'coaxial' | 'two-way' | 'dual-woofer-flanking' | 'synergy';
  /** When non-empty, draw a thin colored stripe across the upper
   *  back of the cabinet — a few brands use this for handle/trim
   *  delineation. */
  trimStripe?: string;
}

const BRAND_PROFILES: Record<string, BrandProfile> = {
  // L-Acoustics — sleek black cabinet, red dot logo, flush rectangular
  // waveguide, coaxial driver topology on most install boxes.
  'L-Acoustics': {
    primary: '#0F1620',
    accent: '#1F2937',
    badge: '#E63946',
    cabinetTaper: 0.06,
    hornStyle: 'rectangular',
    driverStyle: 'coaxial',
  },
  // d&b audiotechnik — black cabinet, simple white wordmark, central
  // single-flare horn (the iconic d&b "ring" waveguide), 2-way layout
  // with horn between two woofers on Y/V series line-arrays.
  'd&b audiotechnik': {
    primary: '#101418',
    accent: '#2A2F36',
    badge: '#FFFFFF',
    cabinetTaper: 0.10,
    hornStyle: 'central-flare',
    driverStyle: 'dual-woofer-flanking',
  },
  // JBL Pro — slightly lighter charcoal, JBL "loops" in red, distinctive
  // trapezoidal horn cutout on VTX series, larger taper than L-Acoustics.
  'JBL Pro': {
    primary: '#1F2937',
    accent: '#374151',
    badge: '#E63946',
    cabinetTaper: 0.14,
    hornStyle: 'trapezoidal',
    driverStyle: 'dual-woofer-flanking',
  },
  // QSC — black plastic / matte finish, silver QSC wordmark, K-series
  // has a notably tapered cabinet (much narrower at back).
  'QSC': {
    primary: '#0F1620',
    accent: '#374151',
    badge: '#9CA3AF',
    cabinetTaper: 0.20,
    hornStyle: 'rectangular',
    driverStyle: 'two-way',
  },
  // Meyer Sound — distinctive medium-gray cabinet (not black), white
  // Meyer wordmark, central waveguide, predominantly coaxial topology
  // on Ultra-X and similar install lines.
  'Meyer Sound': {
    primary: '#4B5563',
    accent: '#6B7280',
    badge: '#FFFFFF',
    cabinetTaper: 0.05,
    hornStyle: 'central-flare',
    driverStyle: 'coaxial',
  },
  // EAW — utilitarian dark gray with visible recessed handles, gray
  // EAW badge, wider rectangular horn on install boxes.
  'EAW': {
    primary: '#374151',
    accent: '#1F2937',
    badge: '#9CA3AF',
    cabinetTaper: 0.08,
    hornStyle: 'rectangular',
    driverStyle: 'two-way',
    trimStripe: '#1F2937',
  },
  // RCF — black with the iconic RCF orange logo, central-flare horn,
  // 2-way layout. HDL series has slight taper.
  'RCF': {
    primary: '#0F1620',
    accent: '#1A2530',
    badge: '#FF6B35',
    cabinetTaper: 0.10,
    hornStyle: 'central-flare',
    driverStyle: 'two-way',
  },
  // Yamaha — black DZR-style cabinet with red badge, trapezoidal horn,
  // significant taper. Yamaha install boxes (VXC ceilings) are usually white.
  'Yamaha': {
    primary: '#0F1620',
    accent: '#1F2937',
    badge: '#A21F2F',
    cabinetTaper: 0.16,
    hornStyle: 'trapezoidal',
    driverStyle: 'two-way',
  },
  // Danley — full-face Synergy Horn (the entire front IS the waveguide),
  // multiple driver mouths visible inside the horn, blue Danley badge.
  'Danley': {
    primary: '#1F2937',
    accent: '#0F1620',
    badge: '#1A4FBF',
    cabinetTaper: 0,
    hornStyle: 'synergy',
    driverStyle: 'synergy',
  },
  // Shure — wireless / IEM brand. Black 1U/half-rack with red Shure badge.
  'Shure': {
    primary: '#1F2937',
    badge: '#E63946',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Sennheiser — wireless / IEM brand. Slightly lighter charcoal, blue badge.
  'Sennheiser': {
    primary: '#0F1620',
    badge: '#0066CC',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Generic / unbranded — neutral blue install speaker.
  'Generic': {
    primary: '#1A4FBF',
    accent: '#0E2C66',
    badge: '#9CA3AF',
    cabinetTaper: 0.08,
    hornStyle: 'rectangular',
    driverStyle: 'two-way',
  },

  // ===== Video brands =====
  // Panasonic — typically white-bodied install projectors with a blue
  // Panasonic wordmark and a black lens housing.
  'Panasonic': {
    primary: '#E8E9EB',
    accent: '#1F2937',
    badge: '#0066CC',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Christie — premium event projectors, black or dark gray, silver
  // Christie badge.
  'Christie': {
    primary: '#1F2329',
    accent: '#3A3F47',
    badge: '#9CA3AF',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Epson — compact white plastic projectors with a blue accent badge.
  'Epson': {
    primary: '#F1F5F4',
    accent: '#1F2937',
    badge: '#3B82F6',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Barco — high-end event/cinema projectors, deep black with silver
  // accents and a chrome Barco badge.
  'Barco': {
    primary: '#0B0E12',
    accent: '#3A3F47',
    badge: '#D1D5DB',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // PTZOptics — small white or black box-and-dome PTZ cameras with a
  // blue accent stripe and "PTZ" badge.
  'PTZOptics': {
    primary: '#F1F5F4',
    accent: '#1F2937',
    badge: '#3B82F6',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Vaddio — install PTZ, distinctive green Vaddio accent, black/gray.
  'Vaddio': {
    primary: '#2A2F36',
    accent: '#3A3F47',
    badge: '#10B981',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Sony — pro broadcast/cinema cameras + monitors. Black with subtle
  // brushed-metal accents and the Sony wordmark.
  'Sony': {
    primary: '#1A1F26',
    accent: '#3A3F47',
    badge: '#E5E7EB',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Blackmagic Design — distinctive industrial cinema cameras.
  // Magnesium / dark-gray finish with bright orange Blackmagic badge.
  'Blackmagic Design': {
    primary: '#2A2F36',
    accent: '#3A3F47',
    badge: '#FF6B00',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Absen — LED panel manufacturer. Dark charcoal panels with silver
  // mounting frames.
  'Absen': {
    primary: '#1A1F26',
    accent: '#3A3F47',
    badge: '#D1D5DB',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // ROE Visual — premium LED, near-black with silver ROE wordmark.
  'ROE Visual': {
    primary: '#0B0E12',
    accent: '#1F2937',
    badge: '#9CA3AF',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // ADJ (American DJ) — entry/mid lighting + LED. Black with white
  // ADJ wordmark, sometimes accented with the ADJ blue.
  'ADJ': {
    primary: '#1A1F26',
    accent: '#374151',
    badge: '#3B82F6',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },

  // ===== Lighting brands =====
  // Martin — premium lighting (Harman). Distinctive yellow accent
  // stripe + black body. Yokes have a particular tapered design.
  'Martin': {
    primary: '#0B0E12',
    accent: '#FACC15',
    badge: '#FACC15',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Robe — premium lighting (Czech). Black with red Robe wordmark and
  // distinctive smoked-glass appearance on lamp lenses.
  'Robe': {
    primary: '#0B0E12',
    accent: '#1F2937',
    badge: '#E63946',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Chauvet Pro — mid-tier lighting. Black with green Chauvet accent.
  'Chauvet Pro': {
    primary: '#0B0E12',
    accent: '#1F2937',
    badge: '#10B981',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Elation — mid-premium lighting. Black with red Elation accent.
  'Elation': {
    primary: '#0B0E12',
    accent: '#1F2937',
    badge: '#EF4444',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // ETC — distinctive console + theater lighting. Steel-blue control
  // surface, gray cabinet, ETC blue badge.
  'ETC': {
    primary: '#3A4452',
    accent: '#1E3A8A',
    badge: '#1E40AF',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // MA Lighting — touring lighting consoles. Distinctive matte black
  // with crisp white labels and a small "MA" wordmark.
  'MA Lighting': {
    primary: '#0F1115',
    accent: '#1F2937',
    badge: '#F1F5F4',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // High End Systems — touring lighting (now Eos/ETC). Black with
  // distinctive cyan accent (Hog 4 colors).
  'High End Systems': {
    primary: '#0B0E12',
    accent: '#1F2937',
    badge: '#06B6D4',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Robert Juliat — followspot specialist. Distinctive gray-ish
  // metallic body with a Juliat blue badge.
  'Robert Juliat': {
    primary: '#4B5563',
    accent: '#374151',
    badge: '#1E40AF',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },

  // ===== Audio signal chain brands =====
  // DiGiCo — premium console with distinctive orange/amber accent.
  'DiGiCo': {
    primary: '#0B0E12',
    accent: '#1F2937',
    badge: '#F97316',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Avid (VENUE) — premium console with red Avid logo.
  'Avid': {
    primary: '#1A1F26',
    accent: '#374151',
    badge: '#E63946',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Allen & Heath — distinctive wood-trim end caps + matte black.
  // The wood is the brand's visual signature.
  'Allen & Heath': {
    primary: '#1A1F26',
    accent: '#92563B',     // wood end-cap color
    badge: '#E5E7EB',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Midas — Music Group / classic British console. Black with red
  // Midas badge and stylized red fader caps.
  'Midas': {
    primary: '#0B0E12',
    accent: '#1F2937',
    badge: '#E63946',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Soundcraft — Harman group. Charcoal with red Soundcraft logo.
  'Soundcraft': {
    primary: '#1A1F26',
    accent: '#374151',
    badge: '#E63946',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Crown — Harman amplifiers. Black rack with golden meter LEDs and
  // a silver/gray Crown badge.
  'Crown': {
    primary: '#1F2329',
    accent: '#374151',
    badge: '#FCD34D',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Powersoft — Italian premium amps. Distinctive blue accent strip.
  'Powersoft': {
    primary: '#0F1620',
    accent: '#0EA5E9',
    badge: '#0EA5E9',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Lab.gruppen — Swedish premium amps. Black with gold/silver accent.
  'Lab.gruppen': {
    primary: '#0F1620',
    accent: '#9CA3AF',
    badge: '#FCD34D',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Biamp — install DSP. Slate gray with a distinctive teal Biamp badge.
  'Biamp': {
    primary: '#374151',
    accent: '#1F2937',
    badge: '#0891B2',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // BSS Audio — Harman install DSP. Black with distinctive orange BSS badge.
  'BSS': {
    primary: '#1A1F26',
    accent: '#374151',
    badge: '#F97316',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Symetrix — install DSP. Charcoal with red Symetrix accent.
  'Symetrix': {
    primary: '#1A1F26',
    accent: '#374151',
    badge: '#E63946',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Whirlwind — stage box / cable specialist. Dark gray with bright
  // blue Whirlwind badge.
  'Whirlwind': {
    primary: '#374151',
    accent: '#1F2937',
    badge: '#1E40AF',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },

  // ===== Infrastructure brands =====
  // Middle Atlantic — most common install rack. Light gray with
  // distinctive black corner posts.
  'Middle Atlantic': {
    primary: '#9CA3AF',
    accent: '#374151',
    badge: '#1F2937',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // APC — server racks + UPS. Dark gray with red APC accent.
  'APC': {
    primary: '#374151',
    accent: '#1F2937',
    badge: '#E63946',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },
  // Furman — power conditioners. Black with blue Furman accent.
  'Furman': {
    primary: '#0F1620',
    accent: '#1F2937',
    badge: '#3B82F6',
    cabinetTaper: 0,
    hornStyle: 'none',
    driverStyle: 'two-way',
  },

  // GIK / Primacoustic acoustic-treatment brands kept default since
  // panel rendering is shape-agnostic (handled by PanelGlyph).
};

function brandProfile(item: EquipmentItem): BrandProfile {
  return BRAND_PROFILES[item.brand ?? 'Generic'] ?? BRAND_PROFILES.Generic;
}

// ---------------------------------------------------------------------
// Faux-lighting palette: top is brightest, front mid, sides darker.
// Each kind picks a base hue and we shade it.
// ---------------------------------------------------------------------

function shadeHex(hex: string, factor: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 0xff;
  let g = (n >> 8) & 0xff;
  let b = n & 0xff;
  r = Math.max(0, Math.min(255, Math.round(r * factor)));
  g = Math.max(0, Math.min(255, Math.round(g * factor)));
  b = Math.max(0, Math.min(255, Math.round(b * factor)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------
// Primitive: rotated box
// ---------------------------------------------------------------------

/**
 * Build the 6 faces of an axis-aligned-then-rotated box centered at (cx, cy)
 * with vertical extent [bottomZ, bottomZ + h]. `w` is the dimension along the
 * facing axis, `d` is across (left/right of facing). `rotRad` is the facing
 * direction in radians (0 = +x).
 *
 * Face order: [front, back, left, right, top, bottom]. Color fills assume
 * frontTint = base, sideTint = darker, topTint = brighter.
 */
function rotatedBoxFaces(
  cx: number, cy: number, bottomZ: number,
  w: number, d: number, h: number,
  rotRad: number,
): Face3[] {
  const c = Math.cos(rotRad), s = Math.sin(rotRad);
  const halfW = w / 2, halfD = d / 2;
  // Local corners (front/back along +x, left/right along +y, then z).
  // We name them by (front/back)(left/right)(bottom/top).
  const local = (xs: number, ys: number, zs: number): Vec3 => [
    cx + c * xs - s * ys,
    cy + s * xs + c * ys,
    bottomZ + zs,
  ];
  const FLB = local(+halfW, -halfD, 0);
  const FRB = local(+halfW, +halfD, 0);
  const BLB = local(-halfW, -halfD, 0);
  const BRB = local(-halfW, +halfD, 0);
  const FLT = local(+halfW, -halfD, h);
  const FRT = local(+halfW, +halfD, h);
  const BLT = local(-halfW, -halfD, h);
  const BRT = local(-halfW, +halfD, h);
  return [
    [FLB, FRB, FRT, FLT],   // front
    [BRB, BLB, BLT, BRT],   // back
    [BLB, FLB, FLT, BLT],   // left
    [FRB, BRB, BRT, FRT],   // right
    [FLT, FRT, BRT, BLT],   // top
    [BLB, BRB, FRB, FLB],   // bottom
  ];
}

/** Quick depth sort key — average z + dot product with camera-ish vector. */
function faceDepth(face: Face3): number {
  let sum = 0;
  for (const p of face) sum += p[0] + p[1] - p[2] * 1.5;
  return sum / face.length;
}

/**
 * Trapezoidal cabinet — front face (FW × h) is full size, back face is
 * narrower by (1 − taper) × FW. Used for line-array elements and tapered
 * install speakers (QSC K-series, JBL VTX, etc.).
 *
 * `taper` 0..0.5: 0 = rectangular box (no taper), 0.20 = back is 80% of
 *  front, 0.40 = back is 60% of front. Most modern install speakers are
 *  in the 0.05..0.20 range.
 */
function taperedBoxFaces(
  cx: number, cy: number, bottomZ: number,
  w: number, d: number, h: number,
  rotRad: number,
  taper: number,
): Face3[] {
  if (taper <= 0.001) return rotatedBoxFaces(cx, cy, bottomZ, w, d, h, rotRad);
  const c = Math.cos(rotRad), s = Math.sin(rotRad);
  // FRONT face uses the full half-d (Y dimension across the face) AND
  // is positioned at +halfW along the cabinet's facing axis.
  // BACK face is shrunk by (1 − taper) AND offset slightly so the SIDES
  // form proper trapezoids (rather than the back staying the same y range).
  const halfW = w / 2;
  const halfD_front = d / 2;
  const halfD_back  = (d / 2) * (1 - taper);
  const local = (xs: number, ys: number, zs: number): Vec3 => [
    cx + c * xs - s * ys,
    cy + s * xs + c * ys,
    bottomZ + zs,
  ];
  const FLB = local(+halfW, -halfD_front, 0);
  const FRB = local(+halfW, +halfD_front, 0);
  const BLB = local(-halfW, -halfD_back, 0);
  const BRB = local(-halfW, +halfD_back, 0);
  const FLT = local(+halfW, -halfD_front, h);
  const FRT = local(+halfW, +halfD_front, h);
  const BLT = local(-halfW, -halfD_back, h);
  const BRT = local(-halfW, +halfD_back, h);
  return [
    [FLB, FRB, FRT, FLT],   // front (full size)
    [BRB, BLB, BLT, BRT],   // back (narrower)
    [BLB, FLB, FLT, BLT],   // left (trapezoid)
    [FRB, BRB, BRT, FRT],   // right (trapezoid)
    [FLT, FRT, BRT, BLT],   // top (trapezoid)
    [BLB, BRB, FRB, FLB],   // bottom (trapezoid, dropped)
  ];
}

/** Variant of defaultBoxShape that uses a tapered cabinet. */
function taperedBoxShape(
  cx: number, cy: number, bottomZ: number,
  w: number, d: number, h: number,
  rotRad: number,
  baseHex: string,
  taper: number,
): Shape3D {
  const faces = taperedBoxFaces(cx, cy, bottomZ, w, d, h, rotRad, taper).slice(0, 5);
  return {
    faces,
    faceDepths: faces.map(faceDepth),
    faceFills: [
      shadeHex(baseHex, 1.05),    // front
      shadeHex(baseHex, 0.55),    // back
      shadeHex(baseHex, 0.7),     // left
      shadeHex(baseHex, 0.7),     // right
      shadeHex(baseHex, 1.18),    // top
    ],
    faceStrokes: faces.map(() => 'rgba(0,0,0,.40)'),
  };
}

function defaultBoxShape(
  cx: number, cy: number, bottomZ: number,
  w: number, d: number, h: number,
  rotRad: number,
  baseHex: string,
  highlightFront: boolean = false,
): Shape3D {
  const faces = rotatedBoxFaces(cx, cy, bottomZ, w, d, h, rotRad);
  // Drop the bottom face (never visible from above).
  const visible = faces.slice(0, 5);
  const fills = [
    highlightFront ? shadeHex(baseHex, 1.05) : baseHex,    // front (slightly brighter)
    shadeHex(baseHex, 0.55),                                // back
    shadeHex(baseHex, 0.7),                                 // left
    shadeHex(baseHex, 0.7),                                 // right
    shadeHex(baseHex, 1.18),                                // top (brightest)
  ];
  const strokes = visible.map(() => 'rgba(0,0,0,.40)');
  return {
    faces: visible,
    faceDepths: visible.map(faceDepth),
    faceFills: fills,
    faceStrokes: strokes,
  };
}

// ---------------------------------------------------------------------
// Primitive: vertical cylinder (segments)
// ---------------------------------------------------------------------

function cylinderShape(
  cx: number, cy: number, bottomZ: number,
  radius: number, h: number,
  rotRad: number,             // unused — cylinder is rotationally symmetric
  baseHex: string,
  segments: number = 14,
): Shape3D {
  void rotRad;
  const sides: Face3[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * 2 * Math.PI;
    const a1 = ((i + 1) / segments) * 2 * Math.PI;
    const x0 = cx + radius * Math.cos(a0);
    const y0 = cy + radius * Math.sin(a0);
    const x1 = cx + radius * Math.cos(a1);
    const y1 = cy + radius * Math.sin(a1);
    sides.push([
      [x0, y0, bottomZ],
      [x1, y1, bottomZ],
      [x1, y1, bottomZ + h],
      [x0, y0, bottomZ + h],
    ]);
  }
  // Top cap as a fan
  const top: Face3 = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    top.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a), bottomZ + h]);
  }
  const allFaces = [...sides, top];
  const fills: string[] = sides.map((_, i) => {
    // Side shade depends on angle (facing camera = brighter)
    const a = ((i + 0.5) / segments) * 2 * Math.PI;
    const facing = Math.cos(a) * 0.5 + Math.sin(a) * 0.5;     // [-1, 1]
    const factor = 0.65 + 0.4 * Math.max(0, facing);
    return shadeHex(baseHex, factor);
  });
  fills.push(shadeHex(baseHex, 1.18));   // top
  const strokes: (string | null)[] = allFaces.map(() => 'rgba(0,0,0,.30)');
  return {
    faces: allFaces,
    faceDepths: allFaces.map(faceDepth),
    faceFills: fills,
    faceStrokes: strokes,
  };
}

// ---------------------------------------------------------------------
// Detail builders
// ---------------------------------------------------------------------
//
// All detail builders work in WORLD space and live on a particular face
// (typically the speaker's "front" face). We define a face frame —
// (center, right, up, normal) — and use it to lay out details in the
// face's local coordinates, then convert back to world.

interface FaceFrame {
  center: Vec3;
  right: Vec3;     // unit vector along face's local +u (face width)
  up: Vec3;        // unit vector along face's local +v (face height)
  normal: Vec3;    // outward normal (just for biased depth sort)
  width: number;   // face extent in `right`
  height: number;  // face extent in `up`
}

/** Build a face frame from a 4-corner face given in CCW order
 *  (bottom-left, bottom-right, top-right, top-left). The "right" axis
 *  runs along the bottom edge; "up" runs along the left edge. */
function faceFrame4(corners: Face3): FaceFrame {
  const [bl, br, tr, tl] = corners;
  const cx = (bl[0] + br[0] + tr[0] + tl[0]) / 4;
  const cy = (bl[1] + br[1] + tr[1] + tl[1]) / 4;
  const cz = (bl[2] + br[2] + tr[2] + tl[2]) / 4;
  const rDx = br[0] - bl[0], rDy = br[1] - bl[1], rDz = br[2] - bl[2];
  const uDx = tl[0] - bl[0], uDy = tl[1] - bl[1], uDz = tl[2] - bl[2];
  const rLen = Math.hypot(rDx, rDy, rDz) || 1;
  const uLen = Math.hypot(uDx, uDy, uDz) || 1;
  const rx = rDx / rLen, ry = rDy / rLen, rz = rDz / rLen;
  const ux = uDx / uLen, uy = uDy / uLen, uz = uDz / uLen;
  // normal = right × up
  const nx = ry * uz - rz * uy;
  const ny = rz * ux - rx * uz;
  const nz = rx * uy - ry * ux;
  return {
    center: [cx, cy, cz],
    right: [rx, ry, rz],
    up: [ux, uy, uz],
    normal: [nx, ny, nz],
    width: rLen,
    height: uLen,
  };
}

/** Convert face-local (u, v) coordinates to world coords, with a small
 *  outward push along the normal so details don't z-fight with their
 *  parent face. u/v are normalized -1..1 from face center. */
function faceUV(frame: FaceFrame, u: number, v: number, push: number = 0.02): Vec3 {
  const cu = u * frame.width / 2;
  const cv = v * frame.height / 2;
  return [
    frame.center[0] + frame.right[0] * cu + frame.up[0] * cv + frame.normal[0] * push,
    frame.center[1] + frame.right[1] * cu + frame.up[1] * cv + frame.normal[1] * push,
    frame.center[2] + frame.right[2] * cu + frame.up[2] * cv + frame.normal[2] * push,
  ];
}

/** Build a circle of N world-space points lying in a face's plane,
 *  centered at face-local (uCenter, vCenter), with radius given as a
 *  fraction of the smaller face dimension. */
function circleOnFace(
  frame: FaceFrame,
  uCenter: number, vCenter: number,
  radiusFracOfMinDim: number,
  segments: number = 18,
): Vec3[] {
  const minDim = Math.min(frame.width, frame.height);
  const r = radiusFracOfMinDim * minDim;
  // Convert the face-local center (in u/v normalized) to world center.
  const cWorld = faceUV(frame, uCenter, vCenter, 0.02);
  const out: Vec3[] = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * 2 * Math.PI;
    const ru = Math.cos(theta) * r;
    const rv = Math.sin(theta) * r;
    out.push([
      cWorld[0] + frame.right[0] * ru + frame.up[0] * rv,
      cWorld[1] + frame.right[1] * ru + frame.up[1] * rv,
      cWorld[2] + frame.right[2] * ru + frame.up[2] * rv,
    ]);
  }
  return out;
}

/** Rectangle in face-local coords, returned as a closed 4-point world polygon. */
function rectOnFace(
  frame: FaceFrame,
  uCenter: number, vCenter: number,
  uHalf: number, vHalf: number,
): Vec3[] {
  return [
    faceUV(frame, uCenter - uHalf, vCenter - vHalf, 0.02),
    faceUV(frame, uCenter + uHalf, vCenter - vHalf, 0.02),
    faceUV(frame, uCenter + uHalf, vCenter + vHalf, 0.02),
    faceUV(frame, uCenter - uHalf, vCenter + vHalf, 0.02),
  ];
}

/** Generate grid lines on a face — horizontal AND vertical interior lines. */
function gridOnFace(
  frame: FaceFrame,
  cols: number, rows: number,
): Vec3[][] {
  const out: Vec3[][] = [];
  // Vertical interior lines: cols-1 lines at u = -1 + 2*i/cols
  for (let i = 1; i < cols; i++) {
    const u = -1 + 2 * i / cols;
    out.push([faceUV(frame, u, -1), faceUV(frame, u, +1)]);
  }
  // Horizontal interior lines
  for (let j = 1; j < rows; j++) {
    const v = -1 + 2 * j / rows;
    out.push([faceUV(frame, -1, v), faceUV(frame, +1, v)]);
  }
  return out;
}

/** Concentric ring detail — useful for ceiling speaker grilles, lens rings. */
function concentricRingsOnFace(
  frame: FaceFrame,
  uCenter: number, vCenter: number,
  outerRadiusFrac: number,
  ringCount: number,
): Vec3[][] {
  const out: Vec3[][] = [];
  for (let i = 1; i <= ringCount; i++) {
    const f = (i / ringCount) * outerRadiusFrac;
    out.push(circleOnFace(frame, uCenter, vCenter, f, 18));
  }
  return out;
}

/** Average depth of a polyline (for sort ordering). Same heuristic as
 *  faceDepth — bigger = closer to camera = render later. */
function pointsDepth(pts: Vec3[]): number {
  let s = 0;
  for (const p of pts) s += p[0] + p[1] - p[2] * 1.5;
  return s / pts.length;
}

// ---------------------------------------------------------------------
// Per-kind shape recipes
// ---------------------------------------------------------------------

/** Aim/rotation in radians used to face the shape. Speakers prefer `aim`,
 *  others prefer `rotation`. */
function facingRad(item: EquipmentItem, useAim: boolean = false): number {
  const deg = useAim ? (item.aim ?? 90) : (item.rotation ?? 0);
  return deg * Math.PI / 180;
}

/** Parse "2x18", "1x18", "18", "2x12" etc. from the speaker template's `lf`
 *  field into (driver count, driver size in inches). Returns sensible
 *  fallbacks when the field is missing. */
function parseDriverConfig(item: EquipmentItem): { count: number; sizeIn: number } {
  const lf = (item.lf ?? '').replace(/"/g, '').trim();
  // Match "NxM" first
  const dual = lf.match(/^(\d+)\s*x\s*([\d.]+)/i);
  if (dual) {
    return { count: parseInt(dual[1], 10), sizeIn: parseFloat(dual[2]) };
  }
  // "MxN" reversed (e.g. "8x2" = 8 of 2")
  const single = lf.match(/^([\d.]+)$/);
  if (single) {
    return { count: 1, sizeIn: parseFloat(single[1]) };
  }
  return { count: 1, sizeIn: 18 };
}

/** Subwoofer — brand-aware box with driver count parsed from the model's
 *  `lf` field, brand-specific cabinet color, and a port-slot configuration
 *  hinted by the brand's design style. */
export function subwooferShape(item: EquipmentItem): Shape3D {
  const profile = brandProfile(item);
  const w = item.width ?? 2.5;
  const d = item.depth ?? 2.5;
  const h = item.itemHeight ?? 2;
  const ang = facingRad(item, true);
  const shape = defaultBoxShape(item.x, item.y, item.z, w, d, h, ang, profile.primary, true);

  const front = faceFrame4(shape.faces[0]);
  const baseD = faceDepth(shape.faces[0]);
  const cfg = parseDriverConfig(item);
  const details: ShapeDetail[] = [];

  // === Driver layout — count parsed from model spec ===
  // Single driver: centered. Dual: side-by-side. Higher counts: line.
  if (cfg.count === 1) {
    // Single driver — typical for tapped horns (Danley TH-118), some
    // "single 18"" subs (L-Acoustics SB18).
    details.push({
      points: circleOnFace(front, 0, 0.10, 0.42, 24), closed: true,
      fill: '#0B0E12', stroke: 'rgba(255,255,255,.18)', strokeWidth: 0.35,
      depth: baseD + 0.5,
    });
    details.push({
      points: circleOnFace(front, 0, 0.10, 0.14, 18), closed: true,
      fill: '#1F2937', stroke: 'rgba(255,255,255,.30)', strokeWidth: 0.25,
      depth: baseD + 0.6,
    });
  } else if (cfg.count === 2) {
    // Dual drivers — typical for 2x18 (Meyer 700-HP, JBL SRX828SP),
    // 2x12 cardioid (QSC KS212c), 2x10 bandpass (d&b B6).
    // Driver size approximation: scale by sizeIn/18 (so 2x12 = smaller).
    const driverScale = Math.min(0.40, Math.max(0.20, cfg.sizeIn / 18 * 0.32));
    for (const u of [-0.45, 0.45]) {
      details.push({
        points: circleOnFace(front, u, 0.05, driverScale, 22), closed: true,
        fill: '#0B0E12', stroke: 'rgba(255,255,255,.18)', strokeWidth: 0.30,
        depth: baseD + 0.5,
      });
      details.push({
        points: circleOnFace(front, u, 0.05, driverScale * 0.32, 16), closed: true,
        fill: '#1F2937', stroke: 'rgba(255,255,255,.28)', strokeWidth: 0.22,
        depth: baseD + 0.6,
      });
    }
  } else {
    // 3+ drivers — uncommon but possible. Lay out horizontally.
    const driverScale = 0.30 / Math.sqrt(cfg.count);
    for (let i = 0; i < cfg.count; i++) {
      const u = -0.7 + (i + 0.5) * 1.4 / cfg.count;
      details.push({
        points: circleOnFace(front, u, 0.05, driverScale, 18), closed: true,
        fill: '#0B0E12', stroke: 'rgba(255,255,255,.18)', strokeWidth: 0.25,
        depth: baseD + 0.5,
      });
    }
  }

  // === Port — varies by brand design style ===
  if (item.brand === 'Danley') {
    // Tapped horn — distinctive horizontal flared port across the bottom
    details.push({
      points: rectOnFace(front, 0, -0.55, 0.65, 0.08), closed: true,
      fill: '#0B0E12', stroke: 'rgba(255,255,255,.15)', strokeWidth: 0.25,
      depth: baseD + 0.5,
    });
  } else if (cfg.count === 1) {
    // Single driver subs typically have a slot port at the bottom
    details.push({
      points: rectOnFace(front, 0, -0.55, 0.35, 0.06), closed: true,
      fill: '#0B0E12', stroke: 'rgba(255,255,255,.10)', strokeWidth: 0.20,
      depth: baseD + 0.5,
    });
  } else {
    // Dual drivers — small round port between drivers
    details.push({
      points: circleOnFace(front, 0, -0.10, 0.10, 14), closed: true,
      fill: '#0B0E12', stroke: 'rgba(255,255,255,.15)', strokeWidth: 0.20,
      depth: baseD + 0.5,
    });
  }

  // Brand badge
  if (profile.badge) {
    details.push({
      points: rectOnFace(front, 0, -0.85, 0.18, 0.04), closed: true,
      fill: profile.badge, stroke: 'rgba(255,255,255,.40)', strokeWidth: 0.15,
      depth: baseD + 0.7,
    });
  }

  return { ...shape, details };
}

/** Stage monitor — brand-aware wedge with driver topology on the slanted
 *  top face (the face that aims up at the performer). */
export function monitorShape(item: EquipmentItem): Shape3D {
  const profile = brandProfile(item);
  const w = item.width ?? 2;
  const d = item.depth ?? 1.5;
  const h = item.itemHeight ?? 1;
  const cx = item.x, cy = item.y, bz = item.z;
  const c = Math.cos(facingRad(item, true)), s = Math.sin(facingRad(item, true));
  const halfW = w / 2, halfD = d / 2;
  const local = (xs: number, ys: number, zs: number): Vec3 => [
    cx + c * xs - s * ys,
    cy + s * xs + c * ys,
    bz + zs,
  ];
  const FLB = local(+halfW, -halfD, 0);
  const FRB = local(+halfW, +halfD, 0);
  const BLB = local(-halfW, -halfD, 0);
  const BRB = local(-halfW, +halfD, 0);
  const FLT = local(+halfW, -halfD, h);
  const FRT = local(+halfW, +halfD, h);
  const BLT = local(-halfW, -halfD, h * 0.2);
  const BRT = local(-halfW, +halfD, h * 0.2);
  const faces: Face3[] = [
    [FLB, FRB, FRT, FLT],     // 0 front (tall)
    [BRB, BLB, BLT, BRT],     // 1 back (low)
    [BLB, FLB, FLT, BLT],     // 2 left (trapezoid)
    [FRB, BRB, BRT, FRT],     // 3 right (trapezoid)
    [BLT, BRT, FRT, FLT],     // 4 top — slanted, aims at performer
  ];
  const base = profile.primary;
  const fills = [
    shadeHex(base, 1.05),
    shadeHex(base, 0.55),
    shadeHex(base, 0.72),
    shadeHex(base, 0.72),
    shadeHex(base, 1.10),
  ];
  const slanted = faceFrame4(faces[4]);
  const baseDepth = faceDepth(faces[4]);
  const details: ShapeDetail[] = [];

  // Coaxial brands (L-Acoustics, Meyer) — single driver in center
  // Two-way brands — driver on one side, horn on the other (classic wedge layout)
  if (profile.driverStyle === 'coaxial') {
    details.push(
      { points: circleOnFace(slanted, 0, 0, 0.45, 22), closed: true,
        fill: '#0B0E12', stroke: 'rgba(255,255,255,.20)', strokeWidth: 0.35,
        depth: baseDepth + 0.5 },
      { points: circleOnFace(slanted, 0, 0, 0.13, 16), closed: true,
        fill: '#374151', stroke: 'rgba(255,255,255,.30)', strokeWidth: 0.20,
        depth: baseDepth + 0.6 },
    );
  } else {
    // Two-way wedge — driver on left, horn on right
    details.push(
      { points: circleOnFace(slanted, -0.30, 0, 0.40, 22), closed: true,
        fill: '#0B0E12', stroke: 'rgba(255,255,255,.18)', strokeWidth: 0.35,
        depth: baseDepth + 0.5 },
      { points: circleOnFace(slanted, -0.30, 0, 0.13, 18), closed: true,
        fill: '#1F2937', stroke: 'rgba(255,255,255,.25)', strokeWidth: 0.2,
        depth: baseDepth + 0.6 },
    );
    if (profile.hornStyle === 'central-flare') {
      details.push({
        points: circleOnFace(slanted, 0.50, 0, 0.20, 18), closed: true,
        fill: '#0B0E12', stroke: 'rgba(255,255,255,.20)', strokeWidth: 0.25,
        depth: baseDepth + 0.5,
      });
    } else {
      details.push({
        points: rectOnFace(slanted, 0.50, 0, 0.18, 0.30), closed: true,
        fill: '#0B0E12', stroke: 'rgba(255,255,255,.20)', strokeWidth: 0.25,
        depth: baseDepth + 0.5,
      });
    }
  }
  // Brand badge on the slanted face (lower edge)
  if (profile.badge) {
    details.push({
      points: rectOnFace(slanted, 0, -0.80, 0.13, 0.05), closed: true,
      fill: profile.badge, stroke: 'rgba(255,255,255,.30)', strokeWidth: 0.12,
      depth: baseDepth + 0.7,
    });
  }
  return {
    faces,
    faceDepths: faces.map(faceDepth),
    faceFills: fills,
    faceStrokes: faces.map(() => 'rgba(0,0,0,.40)'),
    details,
  };
}

/** Point-source / fill / delay speaker — brand-aware cabinet shape.
 *
 * Cabinet shape: tapered (per brand profile) — front face slightly wider
 * than back. L-Acoustics + Meyer + d&b coaxial models use a single
 * central driver; QSC + Yamaha + EAW + RCF + JBL show woofer + horn-
 * mounted tweeter; Danley shows a full-face Synergy waveguide with
 * multiple driver mouths.
 */
export function pointSpeakerShape(item: EquipmentItem): Shape3D {
  const profile = brandProfile(item);
  const w = item.width ?? 1.5;
  const d = item.depth ?? 1.2;
  const h = item.itemHeight ?? 2;
  const ang = facingRad(item, true);
  const cab = taperedBoxShape(item.x, item.y, item.z, w, d, h, ang, profile.primary, profile.cabinetTaper);

  const cabFront = faceFrame4(cab.faces[0]);
  const cabFrontDepth = faceDepth(cab.faces[0]);
  const details: ShapeDetail[] = [];

  // Driver layout depends on brand topology
  if (profile.driverStyle === 'coaxial') {
    // Single large central coaxial driver — used by L-Acoustics X-series,
    // Meyer Ultra-X, etc. Tweeter mounted in the center of the cone.
    details.push(
      { points: circleOnFace(cabFront, 0, 0, 0.50, 24), closed: true,
        fill: '#0B0E12', stroke: 'rgba(255,255,255,.20)', strokeWidth: 0.3,
        depth: cabFrontDepth + 0.5 },
      { points: circleOnFace(cabFront, 0, 0, 0.40, 22), closed: true,
        fill: '#1A1F26', stroke: 'rgba(255,255,255,.15)', strokeWidth: 0.25,
        depth: cabFrontDepth + 0.55 },
      { points: circleOnFace(cabFront, 0, 0, 0.13, 16), closed: true,
        fill: '#374151', stroke: 'rgba(255,255,255,.30)', strokeWidth: 0.20,
        depth: cabFrontDepth + 0.6 },
      { points: circleOnFace(cabFront, 0, 0, 0.06, 12), closed: true,
        fill: '#FBBF24', fillOpacity: 0.5, stroke: 'rgba(255,255,255,.40)', strokeWidth: 0.15,
        depth: cabFrontDepth + 0.7 },
    );
  } else if (profile.driverStyle === 'synergy') {
    // Danley Synergy Horn — full-face waveguide with drivers inside.
    details.push({
      points: rectOnFace(cabFront, 0, 0, 0.85, 0.85), closed: true,
      fill: '#0B0E12', stroke: 'rgba(255,255,255,.20)', strokeWidth: 0.4,
      depth: cabFrontDepth + 0.5,
    });
    // Compression driver (large center)
    details.push({
      points: circleOnFace(cabFront, 0, 0.05, 0.20, 14), closed: true,
      fill: '#1F2937', stroke: 'rgba(255,255,255,.30)', strokeWidth: 0.2,
      depth: cabFrontDepth + 0.6,
    });
    // 4 driver mouths in the corners of the synergy horn
    for (const [u, v] of [[-0.45, 0.30], [+0.45, 0.30], [-0.45, -0.30], [+0.45, -0.30]]) {
      details.push({
        points: circleOnFace(cabFront, u, v, 0.10, 14), closed: true,
        fill: '#1F2937', stroke: 'rgba(255,255,255,.25)', strokeWidth: 0.18,
        depth: cabFrontDepth + 0.6,
      });
    }
  } else {
    // Two-way: woofer on lower half + horn waveguide upper half.
    // Horn cutout shape varies by brand.
    if (profile.hornStyle === 'rectangular') {
      details.push({
        points: rectOnFace(cabFront, 0, 0.30, 0.55, 0.18), closed: true,
        fill: '#0B0E12', stroke: 'rgba(255,255,255,.20)', strokeWidth: 0.25,
        depth: cabFrontDepth + 0.5,
      });
    } else if (profile.hornStyle === 'central-flare') {
      details.push({
        points: circleOnFace(cabFront, 0, 0.30, 0.30, 18), closed: true,
        fill: '#0B0E12', stroke: 'rgba(255,255,255,.20)', strokeWidth: 0.25,
        depth: cabFrontDepth + 0.5,
      });
    } else if (profile.hornStyle === 'trapezoidal') {
      // Keystone shape — wider at top
      const wTop = 0.55, wBot = 0.30, vMid = 0.30, hHalf = 0.18;
      details.push({
        points: [
          faceUV(cabFront, -wBot, vMid - hHalf, 0.02),
          faceUV(cabFront, +wBot, vMid - hHalf, 0.02),
          faceUV(cabFront, +wTop, vMid + hHalf, 0.02),
          faceUV(cabFront, -wTop, vMid + hHalf, 0.02),
        ],
        closed: true,
        fill: '#0B0E12', stroke: 'rgba(255,255,255,.20)', strokeWidth: 0.25,
        depth: cabFrontDepth + 0.5,
      });
    }
    // Tweeter highlight on horn
    details.push({
      points: circleOnFace(cabFront, 0, 0.30, 0.08, 12), closed: true,
      fill: '#374151', stroke: 'rgba(255,255,255,.35)', strokeWidth: 0.15,
      depth: cabFrontDepth + 0.7,
    });
    // Woofer (lower portion)
    details.push({
      points: circleOnFace(cabFront, 0, -0.32, 0.34, 22), closed: true,
      fill: '#0B0E12', stroke: 'rgba(255,255,255,.18)', strokeWidth: 0.3,
      depth: cabFrontDepth + 0.5,
    });
    details.push({
      points: circleOnFace(cabFront, 0, -0.32, 0.11, 16), closed: true,
      fill: '#1F2937', stroke: 'rgba(255,255,255,.25)', strokeWidth: 0.2,
      depth: cabFrontDepth + 0.6,
    });
  }

  // Brand badge (small colored mark on lower bezel area)
  if (profile.badge) {
    details.push({
      points: rectOnFace(cabFront, 0, -0.85, 0.16, 0.04), closed: true,
      fill: profile.badge, stroke: 'rgba(255,255,255,.40)', strokeWidth: 0.15,
      depth: cabFrontDepth + 0.7,
    });
  }

  return { ...cab, details };
}

/** Line array — vertical stack of trapezoidal cabinets with cumulative
 *  splay tilt. Each cabinet is a small box; consecutive cabinets are
 *  offset by `splay` degrees so the array curves down toward the audience. */
export function lineArrayShape(item: EquipmentItem): Shape3D {
  const boxes = Math.max(1, item.boxes ?? 6);
  const splayDeg = item.splay ?? 1.5;
  const tiltStart = item.tilt ?? 0;
  const ang = facingRad(item, true);
  const cabH = item.itemHeight ? item.itemHeight / boxes : 1.2;
  const cabW = item.width ?? 2;
  const cabD = item.depth ?? 1.4;
  const fwdX = Math.cos(ang), fwdY = Math.sin(ang);
  const downX = Math.sin(ang), downY = -Math.cos(ang);   // unused — kept for clarity
  void downX; void downY;
  const allFaces: Face3[] = [];
  const allDepths: number[] = [];
  const allFills: string[] = [];
  const allStrokes: (string | null)[] = [];
  // Top of array at item.z + boxes*cabH; build downward.
  let z = item.z + boxes * cabH;
  let cx = item.x;
  let cy = item.y;
  let cumulativeTilt = -tiltStart;
  // Brand-aware: line-array cabinets are tapered, with brand-specific
  // horn waveguide and driver topology on the front face.
  const profile = brandProfile(item);
  const allDetails: ShapeDetail[] = [];
  for (let i = 0; i < boxes; i++) {
    z -= cabH;
    cumulativeTilt += splayDeg;
    const tiltRad = cumulativeTilt * Math.PI / 180;
    const fwdShift = Math.tan(tiltRad) * cabH * 0.5;
    const cabCx = cx + fwdX * fwdShift;
    const cabCy = cy + fwdY * fwdShift;
    // Tapered cabinet — most line-arrays are trapezoidal in plan view
    // (deeper at front, narrower at back). Use the brand's taper factor.
    const sub = taperedBoxShape(cabCx, cabCy, z, cabD, cabW, cabH, ang, profile.primary, profile.cabinetTaper);
    allFaces.push(...sub.faces);
    allDepths.push(...sub.faceDepths);
    allFills.push(...sub.faceFills);
    allStrokes.push(...sub.faceStrokes);

    const front = faceFrame4(sub.faces[0]);
    const baseD = faceDepth(sub.faces[0]);

    // === Horn waveguide — varies by brand ===
    // Line-array boxes are landscape (wider than tall on the front), so
    // the horn runs HORIZONTALLY across the middle in landscape brands
    // (rectangular = tall slot or central-flare = round, trapezoidal =
    // keystone). Synergy = full face.
    if (profile.hornStyle === 'rectangular') {
      // L-Acoustics / EAW / QSC — vertical-slot horn waveguide
      allDetails.push({
        points: rectOnFace(front, 0, 0, 0.16, 0.65), closed: true,
        fill: '#0B0E12', stroke: 'rgba(255,255,255,.22)', strokeWidth: 0.25,
        depth: baseD + 0.5,
      });
    } else if (profile.hornStyle === 'central-flare') {
      // d&b / Meyer / RCF — circular waveguide (the iconic d&b "ring")
      allDetails.push({
        points: circleOnFace(front, 0, 0, 0.30, 22), closed: true,
        fill: '#0B0E12', stroke: 'rgba(255,255,255,.22)', strokeWidth: 0.3,
        depth: baseD + 0.5,
      });
      allDetails.push({
        points: circleOnFace(front, 0, 0, 0.10, 14), closed: true,
        fill: '#374151', stroke: 'rgba(255,255,255,.30)', strokeWidth: 0.18,
        depth: baseD + 0.65,
      });
    } else if (profile.hornStyle === 'trapezoidal') {
      // JBL / Yamaha — keystone-shaped horn cutout
      const wTop = 0.36, wBot = 0.18, hHalf = 0.40;
      allDetails.push({
        points: [
          faceUV(front, -wBot, -hHalf, 0.02),
          faceUV(front, +wBot, -hHalf, 0.02),
          faceUV(front, +wTop, +hHalf, 0.02),
          faceUV(front, -wTop, +hHalf, 0.02),
        ],
        closed: true,
        fill: '#0B0E12', stroke: 'rgba(255,255,255,.22)', strokeWidth: 0.3,
        depth: baseD + 0.5,
      });
    }

    // === Driver topology — most line arrays are dual-woofer-flanking ===
    if (profile.driverStyle === 'dual-woofer-flanking' || profile.driverStyle === 'two-way') {
      // Two woofers — one each side of the central horn.
      // Spacing varies slightly by brand (JBL/Yamaha pull woofers further out
      // due to wider trapezoidal horn).
      const woofU = (profile.hornStyle === 'trapezoidal') ? 0.62 : 0.55;
      for (const u of [-woofU, +woofU]) {
        allDetails.push({
          points: circleOnFace(front, u, 0, 0.28, 18), closed: true,
          fill: '#0B0E12', stroke: 'rgba(255,255,255,.18)', strokeWidth: 0.25,
          depth: baseD + 0.5,
        });
        allDetails.push({
          points: circleOnFace(front, u, 0, 0.09, 14), closed: true,
          fill: '#1F2937', stroke: 'rgba(255,255,255,.25)', strokeWidth: 0.18,
          depth: baseD + 0.6,
        });
      }
    } else if (profile.driverStyle === 'coaxial') {
      // L-Acoustics Kara II is technically dual-woofer-flanking, but if the
      // brand profile says coaxial we draw a single large central driver.
      allDetails.push({
        points: circleOnFace(front, 0, 0, 0.40, 22), closed: true,
        fill: '#0B0E12', stroke: 'rgba(255,255,255,.20)', strokeWidth: 0.3,
        depth: baseD + 0.5,
      });
    }

    // Brand badge — small colored bar on the bottom bezel of EACH cabinet
    // (only on the lowest cabinet to avoid clutter).
    if (i === boxes - 1 && profile.badge) {
      allDetails.push({
        points: rectOnFace(front, 0, -0.85, 0.13, 0.05), closed: true,
        fill: profile.badge, stroke: 'rgba(255,255,255,.30)', strokeWidth: 0.12,
        depth: baseD + 0.7,
      });
    }
  }
  return { faces: allFaces, faceDepths: allDepths, faceFills: allFills, faceStrokes: allStrokes, details: allDetails };
}

/** Column speaker — brand-aware tall vertical cabinet. Driver count is
 *  parsed from the model's `lf` field (e.g. JBL CBT 100LA "8x2"" =
 *  8 drivers of 2") for accuracy. */
export function columnSpeakerShape(item: EquipmentItem): Shape3D {
  const profile = brandProfile(item);
  const w = item.width ?? 0.5;
  const d = item.depth ?? 0.5;
  const h = item.itemHeight ?? 4;
  const ang = facingRad(item, true);
  const shape = defaultBoxShape(item.x, item.y, item.z, w, d, h, ang, profile.primary, true);
  const front = faceFrame4(shape.faces[0]);
  const baseDepth = faceDepth(shape.faces[0]);
  // Parse driver config — column LF often reads "8x2" (8 of 2") so we
  // need to handle this differently than dual-woofer parsing. If the
  // first number is large (>= 4), interpret as count.
  const lf = (item.lf ?? '').replace(/"/g, '').trim();
  let driverCount = 8;
  const m = lf.match(/^(\d+)\s*x\s*([\d.]+)/i);
  if (m) {
    const n1 = parseInt(m[1], 10);
    // For columns, the format is "Nx{size}" where N is the count.
    driverCount = Math.max(4, Math.min(16, n1 >= 4 ? n1 : Math.round(h * 1.4)));
  } else {
    driverCount = Math.max(4, Math.min(12, Math.round(h * 1.4)));
  }
  const details: ShapeDetail[] = [];
  for (let i = 0; i < driverCount; i++) {
    const v = -0.92 + (i + 0.5) * 1.84 / driverCount;
    details.push({
      points: circleOnFace(front, 0, v, 0.36, 14), closed: true,
      fill: '#0B0E12', stroke: 'rgba(255,255,255,.18)', strokeWidth: 0.2,
      depth: baseDepth + 0.5,
    });
    details.push({
      points: circleOnFace(front, 0, v, 0.12, 12), closed: true,
      fill: '#1F2937', stroke: 'rgba(255,255,255,.25)', strokeWidth: 0.15,
      depth: baseDepth + 0.6,
    });
  }
  if (profile.badge) {
    details.push({
      points: rectOnFace(front, 0, -0.97, 0.18, 0.018), closed: true,
      fill: profile.badge, stroke: 'rgba(255,255,255,.30)', strokeWidth: 0.10,
      depth: baseDepth + 0.7,
    });
  }
  return { ...shape, details };
}

/** LED wall — large flat panel with a tile-grid subdivision and a faint
 *  blue-tinted "screen on" overlay so it reads as an active video surface. */
export function ledWallShape(item: EquipmentItem): Shape3D {
  const w = item.screenWidthFt ?? item.width ?? 12;
  const d = item.depth ?? 0.5;
  const h = item.screenHeightFt ?? item.itemHeight ?? 7;
  const ang = facingRad(item, false);
  // Note: in ledWallShape we pass d (depth) as the box's "w" because the
  // screen surface faces the audience along its broad dimension. So the
  // FRONT face from defaultBoxShape is the audience-facing screen.
  const shape = defaultBoxShape(item.x, item.y, item.z, d, w, h, ang, '#1E6FD9', true);
  const front = faceFrame4(shape.faces[0]);
  const baseDepth = faceDepth(shape.faces[0]);
  // Subdivision: ~1 tile per 2 ft. Cabinet edges are emphasized darker.
  const cols = Math.max(2, Math.round(w / 2));
  const rows = Math.max(2, Math.round(h / 2));
  const gridLines = gridOnFace(front, cols, rows);
  const details: ShapeDetail[] = gridLines.map(line => ({
    points: line, closed: false,
    stroke: 'rgba(0,0,0,.35)', strokeWidth: 0.25,
    depth: baseDepth + 0.5,
  }));
  // Screen-on tint — a slightly brighter blue overlay so it reads as active.
  details.push({
    points: rectOnFace(front, 0, 0, 0.99, 0.99), closed: true,
    fill: '#3B7FD9', fillOpacity: 0.20, stroke: 'none',
    depth: baseDepth + 0.4,
  });
  return { ...shape, details };
}

/** Projector — brand-aware cabinet + lens. Panasonic / Epson are white;
 *  Christie / Barco are dark. Lens housing color and badge follow brand.
 *  Larger projectors (per brightness) get bigger lens diameter. */
export function projectorShape(item: EquipmentItem): Shape3D {
  const profile = brandProfile(item);
  const w = item.width ?? 1.5;
  const d = item.depth ?? 1.2;
  const h = item.itemHeight ?? 0.6;
  const ang = facingRad(item, false);
  const cab = defaultBoxShape(item.x, item.y, item.z, w, d, h, ang, profile.primary, true);
  // Lens — bigger for higher-brightness projectors. Default scaling
  // assumes ~12k lumens at lensR = h*0.3.
  const brightness = item.brightness ?? 8000;
  const lensScale = Math.min(1.6, Math.max(0.8, brightness / 12000));
  const lensR = h * 0.32 * lensScale;
  const lensD = w * 0.18;
  const fwdX = Math.cos(ang), fwdY = Math.sin(ang);
  const lcx = item.x + fwdX * (w / 2 + lensD / 2);
  const lcy = item.y + fwdY * (w / 2 + lensD / 2);
  // Lens housing color — black on most install projectors regardless of
  // body color (white-bodied Panasonic / Epson units have black lens).
  const lensColor = '#0F0F0F';
  const lens = cylinderShape(lcx, lcy, item.z + h / 2 - lensR, lensR, lensD, ang, lensColor, 12);
  // Side vent grilles — series of horizontal slats on the right face
  const sideRight = faceFrame4(cab.faces[3]);
  const sideRightDepth = faceDepth(cab.faces[3]);
  const cabFront = faceFrame4(cab.faces[0]);
  const cabFrontDepth = faceDepth(cab.faces[0]);
  const details: ShapeDetail[] = [];
  for (let i = 0; i < 5; i++) {
    const v = -0.6 + i * 0.3;
    details.push({
      points: rectOnFace(sideRight, 0, v, 0.45, 0.05), closed: true,
      fill: '#0B0E12', stroke: 'none',
      depth: sideRightDepth + 0.4,
    });
  }
  // Lens housing ring — slight bezel around the lens visible on the front face
  details.push({
    points: circleOnFace(cabFront, 0, 0, 0.36 * lensScale, 18), closed: true,
    fill: 'none', stroke: 'rgba(0,0,0,.45)', strokeWidth: 0.3,
    depth: cabFrontDepth + 0.5,
  });
  // Brand badge — top of the cabinet on premium units, small mark.
  // For Panasonic / Epson white bodies, badge is more visible.
  const cabTop = faceFrame4(cab.faces[4]);
  const cabTopDepth = faceDepth(cab.faces[4]);
  if (profile.badge) {
    details.push({
      points: rectOnFace(cabTop, -0.4, 0, 0.10, 0.15), closed: true,
      fill: profile.badge, stroke: 'rgba(0,0,0,.35)', strokeWidth: 0.15,
      depth: cabTopDepth + 0.5,
    });
  }
  return {
    faces: [...cab.faces, ...lens.faces],
    faceDepths: [...cab.faceDepths, ...lens.faceDepths],
    faceFills: [...cab.faceFills, ...lens.faceFills],
    faceStrokes: [...cab.faceStrokes, ...lens.faceStrokes],
    details,
  };
}

/** Moving-head fixture — brand-aware yoke + lamp body. The yoke color
 *  uses the brand's primary; an accent stripe runs around the lamp body
 *  for brands that use one (Martin's yellow, Robe's smoked-black, etc.).
 *  Wash fixtures get a brand-tinted multi-emitter cluster (Aura PXL-style
 *  for Martin, Spiider-style for Robe with 18 emitters); Spot fixtures
 *  get a single lens with brand-colored hot-spot. */
export function movingHeadShape(item: EquipmentItem): Shape3D {
  const profile = brandProfile(item);
  const isSpot = item.kind === 'mh-spot';
  const ang = facingRad(item, true);
  const yokeH = 1.1;
  const yokeT = 0.14;
  const yokeSpan = 0.7;
  const lampR = 0.32;
  const lampL = 1.0;
  const c = Math.cos(ang), s = Math.sin(ang);
  // Yoke arms — primary color (brand body color)
  const arm = (sgn: number) => {
    const acx = item.x - s * (sgn * yokeSpan / 2);
    const acy = item.y + c * (sgn * yokeSpan / 2);
    return defaultBoxShape(acx, acy, item.z, yokeT, yokeT, yokeH, ang, profile.primary, true);
  };
  const yokeL = arm(-1);
  const yokeR = arm(+1);
  // Lamp body — primary color, with a thin accent ring near the front
  // bezel where the brand's accent color shows up (e.g. Martin yellow).
  const lampZ = item.z + yokeH * 0.4;
  const lamp = cylinderShape(item.x, item.y, lampZ, lampR, lampL, ang, profile.primary, 14);

  const top = faceFrame4(lamp.faces[lamp.faces.length - 1]);
  const baseDepth = faceDepth(lamp.faces[lamp.faces.length - 1]);
  const details: ShapeDetail[] = [];

  // Brand accent ring around the lens bezel — a colored hoop just inside
  // the outer rim of the lamp's top face. Most brands have a visible color
  // stripe / accent here on real fixtures.
  const accent = profile.accent ?? profile.badge ?? '#374151';
  details.push({
    points: circleOnFace(top, 0, 0, 0.95, 22), closed: true,
    fill: 'none', stroke: accent, strokeWidth: 0.45,
    depth: baseDepth + 0.4,
  });

  if (isSpot) {
    // Spot: single concentric lens with brand-tinted hot spot.
    details.push(
      // Outer dark bezel
      { points: circleOnFace(top, 0, 0, 0.88, 22), closed: true,
        fill: '#0B0E12', stroke: 'rgba(255,255,255,.25)', strokeWidth: 0.3,
        depth: baseDepth + 0.5 },
      // Lens glass
      { points: circleOnFace(top, 0, 0, 0.55, 18), closed: true,
        fill: '#1F2937', stroke: 'rgba(255,255,255,.3)', strokeWidth: 0.25,
        depth: baseDepth + 0.6 },
      // Hot-spot — brand accent color (gives the signature Robe red /
      // Martin yellow / Chauvet green tint visible on the lens)
      { points: circleOnFace(top, 0, 0, 0.20, 14), closed: true,
        fill: accent, fillOpacity: 0.7, stroke: 'rgba(255,255,255,.4)', strokeWidth: 0.2,
        depth: baseDepth + 0.7 },
    );
  } else {
    // Wash: emitter ring count varies by brand to match real product layout.
    //   Martin MAC Aura PXL — 19 emitters (1 center + 18 in 2 rings)
    //   Robe Spiider        — 19 emitters (1 + 6 + 12)
    //   Chauvet R2          — 7 emitters (Lustre / lower budget — 1 + 6)
    //   Elation Fuze Z350   — 7 emitters
    //   Generic / unknown   — 7 emitters
    const isPremiumWash =
      item.brand === 'Martin' || item.brand === 'Robe' ||
      item.brand === 'High End Systems';
    details.push({
      points: circleOnFace(top, 0, 0, 0.92, 22), closed: true,
      fill: '#1F2937', stroke: 'rgba(255,255,255,.25)', strokeWidth: 0.3,
      depth: baseDepth + 0.5,
    });
    // Center emitter
    details.push({
      points: circleOnFace(top, 0, 0, 0.13, 12), closed: true,
      fill: accent, stroke: 'rgba(255,255,255,.4)', strokeWidth: 0.15,
      depth: baseDepth + 0.7,
    });
    // Inner ring of 6 emitters
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 2 * Math.PI;
      const u = Math.cos(a) * 0.40;
      const v = Math.sin(a) * 0.40;
      details.push({
        points: circleOnFace(top, u, v, 0.10, 12), closed: true,
        fill: accent, stroke: 'rgba(255,255,255,.4)', strokeWidth: 0.13,
        depth: baseDepth + 0.7,
      });
    }
    // Premium washes get a SECOND outer ring (12 more emitters) for the
    // 19-LED Aura PXL / Spiider look.
    if (isPremiumWash) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * 2 * Math.PI + Math.PI / 12;
        const u = Math.cos(a) * 0.72;
        const v = Math.sin(a) * 0.72;
        details.push({
          points: circleOnFace(top, u, v, 0.08, 10), closed: true,
          fill: accent, stroke: 'rgba(255,255,255,.4)', strokeWidth: 0.10,
          depth: baseDepth + 0.7,
        });
      }
    }
  }

  // Brand badge — small mark on the side of the yoke arm
  if (profile.badge) {
    const yokeFront = faceFrame4(yokeL.faces[0]);
    details.push({
      points: rectOnFace(yokeFront, 0, 0.7, 0.5, 0.10), closed: true,
      fill: profile.badge, stroke: 'rgba(255,255,255,.30)', strokeWidth: 0.12,
      depth: faceDepth(yokeL.faces[0]) + 0.5,
    });
  }

  return {
    faces: [...yokeL.faces, ...yokeR.faces, ...lamp.faces],
    faceDepths: [...yokeL.faceDepths, ...yokeR.faceDepths, ...lamp.faceDepths],
    faceFills: [...yokeL.faceFills, ...yokeR.faceFills, ...lamp.faceFills],
    faceStrokes: [...yokeL.faceStrokes, ...yokeR.faceStrokes, ...lamp.faceStrokes],
    details,
  };
}

/** LED par — brand-aware can. Body color from brand profile; emitter
 *  cluster color matches brand accent. */
export function ledParShape(item: EquipmentItem): Shape3D {
  const profile = brandProfile(item);
  const r = (item.width ?? 0.7) / 2;
  const h = item.itemHeight ?? 0.7;
  // Most LED pars are matte black with a bright accent ring. Use the
  // brand's primary as the can color, and the badge color as the emitter
  // tint so the LEDs read as that brand's signature color when "lit".
  const bodyColor = profile.primary === '#1A4FBF' ? '#1A1F26' : profile.primary;
  const emitterColor = profile.badge ?? '#FB923C';
  const shape = cylinderShape(item.x, item.y, item.z, r, h, facingRad(item, true), bodyColor, 14);
  // Top face = last face (cylinderShape emits sides then top)
  const top = faceFrame4(shape.faces[shape.faces.length - 1]);
  const baseDepth = faceDepth(shape.faces[shape.faces.length - 1]);
  const details: ShapeDetail[] = [];
  // Outer ring + grid of small emitters in brand-accent color.
  details.push({
    points: circleOnFace(top, 0, 0, 0.95, 22), closed: true,
    fill: '#1F2937', stroke: 'rgba(255,255,255,.20)', strokeWidth: 0.25,
    depth: baseDepth + 0.5,
  });
  // 7 emitter cluster — emitter color reads as the brand's accent
  details.push({
    points: circleOnFace(top, 0, 0, 0.18, 12), closed: true,
    fill: emitterColor, stroke: 'rgba(255,255,255,.4)', strokeWidth: 0.15,
    depth: baseDepth + 0.7,
  });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * 2 * Math.PI;
    const u = Math.cos(a) * 0.55;
    const v = Math.sin(a) * 0.55;
    details.push({
      points: circleOnFace(top, u, v, 0.15, 10), closed: true,
      fill: emitterColor, stroke: 'rgba(255,255,255,.4)', strokeWidth: 0.12,
      depth: baseDepth + 0.7,
    });
  }
  return { ...shape, details };
}

/** Followspot — short cylindrical body with concentric lens rings on the
 *  top face (the optical end). */
export function followspotShape(item: EquipmentItem): Shape3D {
  const r = 0.45;
  const len = item.width ?? 3;
  const ang = facingRad(item, true);
  const shape = cylinderShape(item.x, item.y, item.z, r, len * 0.3, ang, '#FCD34D', 14);
  // Top face = last face emitted by cylinderShape; this represents the lens.
  const top = faceFrame4(shape.faces[shape.faces.length - 1]);
  const baseDepth = faceDepth(shape.faces[shape.faces.length - 1]);
  const details: ShapeDetail[] = [];
  // Outer optic ring
  details.push({
    points: circleOnFace(top, 0, 0, 0.92, 22), closed: true,
    fill: '#1F2937', stroke: 'rgba(255,255,255,.20)', strokeWidth: 0.3,
    depth: baseDepth + 0.5,
  });
  // Inner lens disc
  details.push({
    points: circleOnFace(top, 0, 0, 0.55, 18), closed: true,
    fill: '#FEF3C7', fillOpacity: 0.7, stroke: 'rgba(0,0,0,.25)', strokeWidth: 0.2,
    depth: baseDepth + 0.6,
  });
  // Center bright spot
  details.push({
    points: circleOnFace(top, 0, 0, 0.18, 14), closed: true,
    fill: '#FDE68A', stroke: 'rgba(255,255,255,.4)', strokeWidth: 0.15,
    depth: baseDepth + 0.7,
  });
  return { ...shape, details };
}

/** Brand-aware rack/amp unit. Cabinet color from the brand profile. Front
 *  face shows U-divider lines for rack-units, plus brand-specific touches:
 *    • Crown amps    — single golden meter LED bar (signature meter)
 *    • Powersoft     — blue accent stripe across the top
 *    • QSC amps      — silver QSC wordmark plate
 *    • L-Acoustics LA-series — distinctive single horizontal slot
 *    • Biamp / BSS / QSC DSP — small status LCD on the front
 *    • Middle Atlantic / APC infra rack — tall, more rack units
 */
export function rackShape(item: EquipmentItem): Shape3D {
  const profile = brandProfile(item);
  const w = item.width ?? 2;
  const d = item.depth ?? 2.5;
  const h = item.itemHeight ?? 6;
  // Use brand color when defined; fall back to legacy per-kind colors for
  // Generic-branded items so the user's existing rooms keep their look.
  const isGeneric = item.brand === 'Generic' || !item.brand;
  const baseHex = isGeneric ? (
    item.kind === 'amp-rack'    ? '#6366F1' :
    item.kind === 'dsp'         ? '#0EA5E9' :
    item.kind === 'dimmer-rack' ? '#65A30D' :
                                  '#475569'
  ) : profile.primary;
  const ang = facingRad(item, false);
  const shape = defaultBoxShape(item.x, item.y, item.z, w, d, h, ang, baseHex, true);
  const ruCount = Math.max(6, Math.min(20, Math.round(h * 2)));
  const front = faceFrame4(shape.faces[0]);
  const baseDepth = faceDepth(shape.faces[0]);
  const details: ShapeDetail[] = [];
  for (let i = 1; i < ruCount; i++) {
    const v = -1 + 2 * i / ruCount;
    details.push({
      points: [faceUV(front, -0.92, v, 0.02), faceUV(front, 0.92, v, 0.02)],
      closed: false,
      stroke: 'rgba(0,0,0,.35)', strokeWidth: 0.2,
      depth: baseDepth + 0.5,
    });
  }
  // Corner rack handles
  for (const u of [-0.85, 0.85]) {
    for (const v of [-0.92, 0.92]) {
      details.push({
        points: circleOnFace(front, u, v, 0.05, 8), closed: true,
        fill: '#1F2937', stroke: 'rgba(255,255,255,.2)', strokeWidth: 0.15,
        depth: baseDepth + 0.6,
      });
    }
  }
  // Brand-specific front-face accents
  if (item.brand === 'Crown') {
    // Distinctive Crown gold meter LED bar (DCi amplifiers) — 8 LED dots
    // in a horizontal row, golden color.
    for (let i = 0; i < 8; i++) {
      const u = -0.7 + i * 0.20;
      details.push({
        points: circleOnFace(front, u, 0.85, 0.018, 8), closed: true,
        fill: '#FCD34D', stroke: 'rgba(255,255,255,.4)', strokeWidth: 0.10,
        depth: baseDepth + 0.7,
      });
    }
  } else if (item.brand === 'Powersoft') {
    // Powersoft blue strip across the top
    details.push({
      points: rectOnFace(front, 0, 0.92, 0.85, 0.025), closed: true,
      fill: '#0EA5E9', stroke: 'none',
      depth: baseDepth + 0.55,
    });
  } else if (item.brand === 'QSC') {
    // QSC silver wordmark plate on the upper-third
    details.push({
      points: rectOnFace(front, 0, 0.55, 0.30, 0.05), closed: true,
      fill: '#9CA3AF', stroke: 'rgba(0,0,0,.4)', strokeWidth: 0.15,
      depth: baseDepth + 0.55,
    });
  } else if (item.brand === 'L-Acoustics') {
    // LA-series amps have a distinctive horizontal slot in the upper-front
    details.push({
      points: rectOnFace(front, 0, 0.5, 0.55, 0.06), closed: true,
      fill: '#0B0E12', stroke: 'rgba(255,255,255,.20)', strokeWidth: 0.2,
      depth: baseDepth + 0.55,
    });
  }
  // DSP units — small status LCD
  if (item.kind === 'dsp') {
    details.push({
      points: rectOnFace(front, -0.30, 0.30, 0.20, 0.10), closed: true,
      fill: '#1A2530', stroke: 'rgba(255,255,255,.30)', strokeWidth: 0.18,
      depth: baseDepth + 0.55,
    });
    // Status LED
    details.push({
      points: circleOnFace(front, 0.45, 0.30, 0.04, 10), closed: true,
      fill: '#10B981', stroke: 'rgba(255,255,255,.35)', strokeWidth: 0.12,
      depth: baseDepth + 0.55,
    });
  }
  // Brand badge — small mark on the bottom front
  if (profile.badge) {
    details.push({
      points: rectOnFace(front, 0, -0.96, 0.16, 0.03), closed: true,
      fill: profile.badge, stroke: 'rgba(255,255,255,.30)', strokeWidth: 0.12,
      depth: baseDepth + 0.7,
    });
  }
  return { ...shape, details };
}

/** Console (FOH or monitor) — brand-aware sloped surface. DiGiCo gets a
 *  steeper rake + an angled meter strip; Yamaha is flatter; Avid sprawls
 *  wider with multiple work surfaces; Allen & Heath gets visible wood-tone
 *  end caps via its accent color. */
export function consoleShape(item: EquipmentItem): Shape3D {
  const profile = brandProfile(item);
  const w = item.width ?? 5;
  const d = item.depth ?? 2.5;
  const h = item.itemHeight ?? 1.2;
  // Console body color reads "more black than blue" for most pro brands;
  // accent color is used for end caps (Allen & Heath wood) and fader
  // caps (Midas red). Generic console keeps the legacy blue.
  const baseHex =
    item.brand === 'Generic' && item.kind === 'foh-console' ? '#3B82F6' :
    item.brand === 'Generic' && item.kind === 'monitor-console' ? '#06B6D4' :
    profile.primary;
  const ang = facingRad(item, false);
  const c = Math.cos(ang), s = Math.sin(ang);
  const halfW = w / 2, halfD = d / 2;
  const local = (xs: number, ys: number, zs: number): Vec3 => [
    item.x + c * xs - s * ys,
    item.y + s * xs + c * ys,
    item.z + zs,
  ];
  const FLB = local(+halfW, -halfD, 0);
  const FRB = local(+halfW, +halfD, 0);
  const BLB = local(-halfW, -halfD, 0);
  const BRB = local(-halfW, +halfD, 0);
  const FLT = local(+halfW, -halfD, h * 0.3);
  const FRT = local(+halfW, +halfD, h * 0.3);
  const BLT = local(-halfW, -halfD, h);
  const BRT = local(-halfW, +halfD, h);
  const faces: Face3[] = [
    [FLB, FRB, FRT, FLT],     // 0 front
    [BRB, BLB, BLT, BRT],     // 1 back
    [BLB, FLB, FLT, BLT],     // 2 left
    [FRB, BRB, BRT, FRT],     // 3 right
    // Top — sloped surface with the controls. CCW from low edge to high edge.
    [FLT, FRT, BRT, BLT],     // 4 top
  ];
  // Top face is the sloped mixing surface. Add fader columns along its length.
  const top = faceFrame4(faces[4]);
  const baseDepth = faceDepth(faces[4]);
  const details: ShapeDetail[] = [];
  // Channel count scales with width: ~1 channel per 0.5 ft, capped at 32
  const channels = Math.max(8, Math.min(32, Math.round(w * 2)));
  // Master section occupies the rightmost 15%
  const channelArea = 0.78;       // -1..(-1 + 2*channelArea) of the surface
  // Brand-specific fader cap colors:
  //   Midas    — red faders (signature)
  //   Allen & Heath — wood-tone (matches end-cap accent)
  //   DiGiCo   — gray fader caps with orange highlights
  //   default  — white
  const faderCapFill =
    item.brand === 'Midas'         ? '#E63946' :
    item.brand === 'Allen & Heath' ? '#92563B' :
    item.brand === 'DiGiCo'        ? '#F97316' :
                                     '#F9FAFB';
  for (let i = 0; i < channels; i++) {
    const u = -1 + (i + 0.5) * 2 * channelArea / channels;
    // Fader slot — vertical stroke on the surface
    details.push({
      points: [faceUV(top, u, 0.45, 0.02), faceUV(top, u, -0.15, 0.02)],
      closed: false,
      stroke: 'rgba(0,0,0,.45)', strokeWidth: 0.4,
      depth: baseDepth + 0.5,
    });
    details.push({
      points: rectOnFace(top, u, 0.0, 0.012, 0.05), closed: true,
      fill: faderCapFill, stroke: 'rgba(0,0,0,.4)', strokeWidth: 0.15,
      depth: baseDepth + 0.6,
    });
  }
  // Master section dividers
  details.push({
    points: [faceUV(top, -1 + 2 * channelArea, -0.6, 0.02), faceUV(top, -1 + 2 * channelArea, 0.85, 0.02)],
    closed: false,
    stroke: 'rgba(0,0,0,.5)', strokeWidth: 0.4,
    depth: baseDepth + 0.5,
  });
  // Meter strip near back edge — brand-tinted (DiGiCo orange, default black)
  const meterFill = item.brand === 'DiGiCo' ? '#FED7AA' : '#0B0E12';
  details.push({
    points: rectOnFace(top, 0, 0.78, 0.85, 0.08), closed: true,
    fill: meterFill, stroke: 'rgba(255,255,255,.2)', strokeWidth: 0.2,
    depth: baseDepth + 0.5,
  });
  // DiGiCo: dual-screen layout — two black rectangles set into the surface
  if (item.brand === 'DiGiCo') {
    details.push({
      points: rectOnFace(top, -0.30, 0.55, 0.20, 0.12), closed: true,
      fill: '#0B0E12', stroke: 'rgba(255,255,255,.20)', strokeWidth: 0.2,
      depth: baseDepth + 0.5,
    });
    details.push({
      points: rectOnFace(top, 0.10, 0.55, 0.20, 0.12), closed: true,
      fill: '#0B0E12', stroke: 'rgba(255,255,255,.20)', strokeWidth: 0.2,
      depth: baseDepth + 0.5,
    });
  } else if (item.brand === 'Yamaha') {
    // Yamaha CL/QL: one wide central touchscreen
    details.push({
      points: rectOnFace(top, 0, 0.55, 0.40, 0.13), closed: true,
      fill: '#1A2530', stroke: 'rgba(255,255,255,.20)', strokeWidth: 0.2,
      depth: baseDepth + 0.5,
    });
  } else if (item.brand === 'Avid') {
    // Avid S6L: 3 small displays across the top
    for (const u of [-0.45, 0, +0.45]) {
      details.push({
        points: rectOnFace(top, u, 0.55, 0.13, 0.10), closed: true,
        fill: '#0B0E12', stroke: 'rgba(255,255,255,.20)', strokeWidth: 0.2,
        depth: baseDepth + 0.5,
      });
    }
  }
  // Brand badge — bottom-front edge of the front face
  if (profile.badge) {
    const consoleFront = faceFrame4(faces[0]);
    const consoleFrontDepth = faceDepth(faces[0]);
    details.push({
      points: rectOnFace(consoleFront, 0.85, 0, 0.10, 0.15), closed: true,
      fill: profile.badge, stroke: 'rgba(255,255,255,.30)', strokeWidth: 0.15,
      depth: consoleFrontDepth + 0.5,
    });
  }
  // Allen & Heath wood end caps — render the LEFT and RIGHT side faces
  // in the brand's accent (wood) color instead of the dark base color.
  const fills = [
    shadeHex(baseHex, 1.05),
    shadeHex(baseHex, 0.55),
    item.brand === 'Allen & Heath' ? shadeHex(profile.accent ?? '#92563B', 0.85) : shadeHex(baseHex, 0.72),
    item.brand === 'Allen & Heath' ? shadeHex(profile.accent ?? '#92563B', 0.85) : shadeHex(baseHex, 0.72),
    shadeHex(baseHex, 1.10),
  ];
  return {
    faces,
    faceDepths: faces.map(faceDepth),
    faceFills: fills,
    faceStrokes: faces.map(() => 'rgba(0,0,0,.40)'),
    details,
  };
}

/** Hemisphere (half-cylinder dome) — used for PTZ cameras. Approximated as
 *  a stack of progressively smaller cylinder disks. Returns the dome cap
 *  faces only (caller usually combines with a base shape). */
function hemisphereShape(
  cx: number, cy: number, baseZ: number,
  radius: number,
  baseHex: string,
  rings: number = 4,
  segments: number = 12,
): Shape3D {
  const faces: Face3[] = [];
  const fills: string[] = [];
  for (let r = 0; r < rings; r++) {
    const z0 = baseZ + radius * Math.sin((r / rings) * (Math.PI / 2));
    const z1 = baseZ + radius * Math.sin(((r + 1) / rings) * (Math.PI / 2));
    const r0 = radius * Math.cos((r / rings) * (Math.PI / 2));
    const r1 = radius * Math.cos(((r + 1) / rings) * (Math.PI / 2));
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * 2 * Math.PI;
      const a1 = ((i + 1) / segments) * 2 * Math.PI;
      const x00 = cx + r0 * Math.cos(a0);
      const y00 = cy + r0 * Math.sin(a0);
      const x10 = cx + r0 * Math.cos(a1);
      const y10 = cy + r0 * Math.sin(a1);
      const x01 = cx + r1 * Math.cos(a0);
      const y01 = cy + r1 * Math.sin(a0);
      const x11 = cx + r1 * Math.cos(a1);
      const y11 = cy + r1 * Math.sin(a1);
      faces.push([
        [x00, y00, z0], [x10, y10, z0],
        [x11, y11, z1], [x01, y01, z1],
      ]);
      const a = ((i + 0.5) / segments) * 2 * Math.PI;
      const facing = Math.cos(a) * 0.5 + Math.sin(a) * 0.5;
      const factor = 0.65 + 0.4 * Math.max(0, facing) + (r / rings) * 0.15;
      fills.push(shadeHex(baseHex, factor));
    }
  }
  return {
    faces,
    faceDepths: faces.map(faceDepth),
    faceFills: fills,
    faceStrokes: faces.map(() => 'rgba(0,0,0,.25)'),
  };
}

/** Concatenate two Shape3Ds. */
function combineShapes(...parts: Shape3D[]): Shape3D {
  const faces: Face3[] = [];
  const depths: number[] = [];
  const fills: string[] = [];
  const strokes: (string | null)[] = [];
  for (const p of parts) {
    faces.push(...p.faces);
    depths.push(...p.faceDepths);
    fills.push(...p.faceFills);
    strokes.push(...p.faceStrokes);
  }
  return { faces, faceDepths: depths, faceFills: fills, faceStrokes: strokes };
}

/** IEM transmitter — brand-aware rackmount. Shure PSM-900 has a
 *  half-rack form factor with two large rotary controls; Sennheiser
 *  EW IEM G4 is a full-rack 1U with a wide LCD and tactile buttons. */
export function iemShape(item: EquipmentItem): Shape3D {
  const profile = brandProfile(item);
  const isShure = item.brand === 'Shure';
  const w = item.width ?? 1.7;
  const d = item.depth ?? 1.0;
  const h = item.itemHeight ?? 0.5;
  const ang = facingRad(item, false);
  const body = defaultBoxShape(item.x, item.y, item.z, w, d, h, ang, profile.primary, true);
  const c = Math.cos(ang), s = Math.sin(ang);
  const antennaR = 0.04;
  const antennaH = 0.6;
  const ax1 = item.x - c * (w * 0.4) - s * (d * 0.25);
  const ay1 = item.y - s * (w * 0.4) + c * (d * 0.25);
  const ax2 = item.x - c * (w * 0.4) + s * (d * 0.25);
  const ay2 = item.y - s * (w * 0.4) - c * (d * 0.25);
  const ant1 = cylinderShape(ax1, ay1, item.z + h, antennaR, antennaH, ang, '#0B0E12', 8);
  const ant2 = cylinderShape(ax2, ay2, item.z + h, antennaR, antennaH, ang, '#0B0E12', 8);

  const front = faceFrame4(body.faces[0]);
  const baseDepth = faceDepth(body.faces[0]);
  const details: ShapeDetail[] = [];

  if (isShure) {
    // Shure PSM-900 layout: large LCD on the left, two big rotary
    // encoders on the right, antenna power LEDs at top.
    details.push(
      // LCD
      { points: rectOnFace(front, -0.40, 0.10, 0.28, 0.40), closed: true,
        fill: '#1A2530', stroke: 'rgba(255,255,255,.35)', strokeWidth: 0.2,
        depth: baseDepth + 0.5 },
      // Two rotary encoders
      { points: circleOnFace(front, 0.20, 0, 0.12, 14), closed: true,
        fill: '#1F2937', stroke: 'rgba(255,255,255,.35)', strokeWidth: 0.20,
        depth: baseDepth + 0.5 },
      { points: circleOnFace(front, 0.55, 0, 0.12, 14), closed: true,
        fill: '#1F2937', stroke: 'rgba(255,255,255,.35)', strokeWidth: 0.20,
        depth: baseDepth + 0.5 },
      // Encoder pointer dots
      { points: circleOnFace(front, 0.20, 0.10, 0.025, 8), closed: true,
        fill: '#9CA3AF', stroke: 'none', depth: baseDepth + 0.6 },
      { points: circleOnFace(front, 0.55, 0.10, 0.025, 8), closed: true,
        fill: '#9CA3AF', stroke: 'none', depth: baseDepth + 0.6 },
      // Power LED (green)
      { points: circleOnFace(front, -0.85, 0.6, 0.04, 10), closed: true,
        fill: '#10B981', stroke: 'rgba(255,255,255,.4)', strokeWidth: 0.12,
        depth: baseDepth + 0.5 },
      // RF LED (amber)
      { points: circleOnFace(front, -0.85, -0.6, 0.04, 10), closed: true,
        fill: '#F59E0B', stroke: 'rgba(255,255,255,.4)', strokeWidth: 0.12,
        depth: baseDepth + 0.5 },
    );
  } else {
    // Sennheiser EW IEM G4: wide centered LCD, button row below,
    // tactile encoder on the right.
    details.push(
      // Wide LCD
      { points: rectOnFace(front, -0.25, 0.30, 0.35, 0.18), closed: true,
        fill: '#1A4D3A', stroke: 'rgba(255,255,255,.35)', strokeWidth: 0.2,
        depth: baseDepth + 0.5 },
      // 4 buttons in a row below LCD
      ...[-0.40, -0.15, 0.10, 0.35].map((u): ShapeDetail => ({
        points: rectOnFace(front, u, -0.20, 0.07, 0.10), closed: true,
        fill: '#0F1620', stroke: 'rgba(255,255,255,.30)', strokeWidth: 0.15,
        depth: baseDepth + 0.5,
      })),
      // Right-side encoder
      { points: circleOnFace(front, 0.75, 0, 0.13, 14), closed: true,
        fill: '#1F2937', stroke: 'rgba(255,255,255,.35)', strokeWidth: 0.20,
        depth: baseDepth + 0.5 },
      { points: circleOnFace(front, 0.75, 0.10, 0.025, 8), closed: true,
        fill: '#9CA3AF', stroke: 'none', depth: baseDepth + 0.6 },
      // Power LED
      { points: circleOnFace(front, -0.88, 0.55, 0.04, 10), closed: true,
        fill: '#10B981', stroke: 'rgba(255,255,255,.4)', strokeWidth: 0.12,
        depth: baseDepth + 0.5 },
    );
  }

  // Brand badge (lower left)
  if (profile.badge) {
    details.push({
      points: rectOnFace(front, -0.85, -0.85, 0.10, 0.045), closed: true,
      fill: profile.badge, stroke: 'rgba(255,255,255,.40)', strokeWidth: 0.15,
      depth: baseDepth + 0.7,
    });
  }

  const merged = combineShapes(body, ant1, ant2);
  return { ...merged, details };
}

/** Ceiling speaker — squat disc with concentric grille rings. White on
 *  Yamaha (VXC) and JBL Control series; gray default otherwise. */
export function ceilingSpeakerShape(item: EquipmentItem): Shape3D {
  const r = (item.width ?? 0.7) / 2;
  const h = item.itemHeight ?? 0.25;
  // Most ceiling speakers are bone white in real life. Pick a brand-tinged
  // light shade per brand instead of the generic gray.
  const ceilingColor =
    item.brand === 'Yamaha'   ? '#F1F5F4' :
    item.brand === 'JBL Pro'  ? '#E5E7EB' :
    item.brand === 'QSC'      ? '#E5E7EB' :
                                '#9CA3AF';
  const shape = cylinderShape(item.x, item.y, item.z, r, h, facingRad(item, true), ceilingColor, 14);
  // The cylinder's "top" face is at z + h; for ceiling speakers we expect
  // them to be installed pointing DOWN, so the top of the cylinder is up
  // against the ceiling. Build the grille on the TOP face anyway since
  // that's the face we have a frame for. From an iso camera the user
  // sees the speaker from above, so the top-face details are visible.
  const top = faceFrame4(shape.faces[shape.faces.length - 1]);
  const baseDepth = faceDepth(shape.faces[shape.faces.length - 1]);
  const rings = concentricRingsOnFace(top, 0, 0, 0.85, 4);
  const details: ShapeDetail[] = rings.map(ring => ({
    points: ring, closed: true, fill: 'none',
    stroke: 'rgba(15,15,15,.55)', strokeWidth: 0.25,
    depth: baseDepth + 0.5,
  }));
  // Center cap dot
  details.push({
    points: circleOnFace(top, 0, 0, 0.08, 12), closed: true,
    fill: '#1F2937', stroke: 'rgba(255,255,255,.25)', strokeWidth: 0.18,
    depth: baseDepth + 0.6,
  });
  return { ...shape, details };
}

/** PTZ camera — base box + dome with a visible lens disc on the dome's
 *  forward-facing side, plus a status LED on the base. */
export function ptzCameraShape(item: EquipmentItem): Shape3D {
  const w = item.width ?? 0.6;
  const d = item.depth ?? 0.6;
  const h = item.itemHeight ?? 0.5;
  const ang = facingRad(item, false);
  const base = defaultBoxShape(item.x, item.y, item.z, w, d, h * 0.5, ang, '#7C3AED', true);
  const domeR = Math.min(w, d) * 0.45;
  const dome = hemisphereShape(item.x, item.y, item.z + h * 0.5, domeR, '#1F2937', 4, 12);
  const merged = combineShapes(base, dome);
  // Lens "puck" on the front of the dome — a small dark circle that sits
  // ~30° off vertical in the facing direction. We draw it as a circle in
  // a tilted face frame.
  const c = Math.cos(ang), s = Math.sin(ang);
  const tiltDeg = 30;
  const tiltRad = tiltDeg * Math.PI / 180;
  const lensCenter: Vec3 = [
    item.x + c * domeR * Math.sin(tiltRad) * 0.85,
    item.y + s * domeR * Math.sin(tiltRad) * 0.85,
    item.z + h * 0.5 + domeR * Math.cos(tiltRad) * 0.85,
  ];
  // Build a face frame oriented in the tilted-forward direction.
  const fwdX = c * Math.sin(tiltRad), fwdY = s * Math.sin(tiltRad), fwdZ = Math.cos(tiltRad);
  // up axis perpendicular to forward (in vertical plane) — pointing "back-up"
  const upX = -c * Math.cos(tiltRad), upY = -s * Math.cos(tiltRad), upZ = Math.sin(tiltRad);
  // right axis = up × forward (lateral)
  const rightX = upY * fwdZ - upZ * fwdY;
  const rightY = upZ * fwdX - upX * fwdZ;
  const rightZ = upX * fwdY - upY * fwdX;
  const lensFrame: FaceFrame = {
    center: lensCenter,
    right: [rightX, rightY, rightZ],
    up: [upX, upY, upZ],
    normal: [fwdX, fwdY, fwdZ],
    width: domeR * 0.7,
    height: domeR * 0.7,
  };
  const lensDepth = lensCenter[0] + lensCenter[1] - lensCenter[2] * 1.5;
  // Base front face for status LED
  const baseFront = faceFrame4(base.faces[0]);
  const baseFrontDepth = faceDepth(base.faces[0]);
  const details: ShapeDetail[] = [
    // Lens outer ring
    { points: circleOnFace(lensFrame, 0, 0, 0.45, 14), closed: true,
      fill: '#0B0E12', stroke: 'rgba(255,255,255,.20)', strokeWidth: 0.2,
      depth: lensDepth + 0.5 },
    // Lens glass
    { points: circleOnFace(lensFrame, 0, 0, 0.28, 12), closed: true,
      fill: '#1E293B', stroke: 'rgba(255,255,255,.4)', strokeWidth: 0.15,
      depth: lensDepth + 0.6 },
    // Status LED on base
    { points: circleOnFace(baseFront, 0.7, 0, 0.06, 8), closed: true,
      fill: '#10B981', stroke: 'rgba(255,255,255,.4)', strokeWidth: 0.12,
      depth: baseFrontDepth + 0.5 },
  ];
  return { ...merged, details };
}

/** Handheld camera — body + lens cylinder + lens-ring detail on the lens
 *  front + a small grip-strip texture on the body's right side. */
export function handheldCameraShape(item: EquipmentItem): Shape3D {
  const w = item.width ?? 0.6;
  const d = item.depth ?? 0.4;
  const h = item.itemHeight ?? 0.4;
  const ang = facingRad(item, false);
  const body = defaultBoxShape(item.x, item.y, item.z, w, d, h, ang, '#A855F7', true);
  const lensR = h * 0.35;
  const lensD = w * 0.35;
  const fwdX = Math.cos(ang), fwdY = Math.sin(ang);
  const lcx = item.x + fwdX * (w / 2 + lensD / 2);
  const lcy = item.y + fwdY * (w / 2 + lensD / 2);
  const lens = cylinderShape(lcx, lcy, item.z + h / 2 - lensR, lensR, lensD, ang, '#0F0F0F', 12);
  const merged = combineShapes(body, lens);
  // Lens cap detail — bright center on the lens cylinder's top face
  const lensTop = faceFrame4(lens.faces[lens.faces.length - 1]);
  const lensBaseDepth = faceDepth(lens.faces[lens.faces.length - 1]);
  // Body grip strip — small rectangles on the body's right side (faces[3])
  const sideRight = faceFrame4(body.faces[3]);
  const sideDepth = faceDepth(body.faces[3]);
  const details: ShapeDetail[] = [
    // Outer lens ring
    { points: circleOnFace(lensTop, 0, 0, 0.85, 16), closed: true,
      fill: '#1F2937', stroke: 'rgba(255,255,255,.15)', strokeWidth: 0.2,
      depth: lensBaseDepth + 0.5 },
    // Lens glass
    { points: circleOnFace(lensTop, 0, 0, 0.5, 14), closed: true,
      fill: '#0B0E12', stroke: 'rgba(255,255,255,.30)', strokeWidth: 0.18,
      depth: lensBaseDepth + 0.6 },
    // Tiny record-light dot on the body
    { points: circleOnFace(faceFrame4(body.faces[0]), 0.7, 0.6, 0.04, 8), closed: true,
      fill: '#EF4444', stroke: 'rgba(255,255,255,.4)', strokeWidth: 0.12,
      depth: faceDepth(body.faces[0]) + 0.5 },
  ];
  // Grip strip — 4 horizontal bars on the right side
  for (let i = 0; i < 4; i++) {
    const v = -0.5 + i * 0.3;
    details.push({
      points: rectOnFace(sideRight, 0, v, 0.4, 0.04), closed: true,
      fill: '#7C3AED', stroke: 'none',
      depth: sideDepth + 0.5,
    });
  }
  return { ...merged, details };
}

/** Confidence monitor — TV-on-stand with a black bezel around the active
 *  display area, a screen-content tint, and a small standby LED. */
export function confidenceMonitorShape(item: EquipmentItem): Shape3D {
  const w = item.width ?? 4;
  const d = item.depth ?? 0.4;
  const h = item.itemHeight ?? 2.5;
  const ang = facingRad(item, false);
  const screen = defaultBoxShape(item.x, item.y, item.z + 1.0, d, w, h, ang, '#10B981', true);
  const baseW = w * 0.4;
  const baseD = d * 1.5;
  const baseH = 1.0;
  const base = defaultBoxShape(item.x, item.y, item.z, baseD, baseW, baseH, ang, '#1F2937', true);
  const merged = combineShapes(base, screen);
  const front = faceFrame4(screen.faces[0]);
  const baseDepth = faceDepth(screen.faces[0]);
  const details: ShapeDetail[] = [
    // Bezel — black border inset from edges
    { points: rectOnFace(front, 0, 0, 0.92, 0.92), closed: true,
      fill: '#0B0E12', stroke: 'rgba(0,0,0,.4)', strokeWidth: 0.3,
      depth: baseDepth + 0.4 },
    // Active display area — slightly inset, with a content tint
    { points: rectOnFace(front, 0, 0.05, 0.84, 0.78), closed: true,
      fill: '#34D399', fillOpacity: 0.55, stroke: 'none',
      depth: baseDepth + 0.5 },
    // Standby LED on the bottom bezel
    { points: circleOnFace(front, 0, -0.84, 0.04, 8), closed: true,
      fill: '#10B981', stroke: 'rgba(255,255,255,.35)', strokeWidth: 0.12,
      depth: baseDepth + 0.5 },
  ];
  return { ...merged, details };
}

/** Lighting console — sloped panel like FOH/monitor consoles but yellow. */
export function lxConsoleShape(item: EquipmentItem): Shape3D {
  // Reuse the console wedge profile via consoleShape but with an LX-yellow tint.
  // We implement it inline rather than extending consoleShape's color, since
  // consoleShape already keys the color from the item's kind.
  const w = item.width ?? 4;
  const d = item.depth ?? 2;
  const h = item.itemHeight ?? 1;
  const ang = facingRad(item, false);
  const c = Math.cos(ang), s = Math.sin(ang);
  const halfW = w / 2, halfD = d / 2;
  const local = (xs: number, ys: number, zs: number): Vec3 => [
    item.x + c * xs - s * ys,
    item.y + s * xs + c * ys,
    item.z + zs,
  ];
  const FLB = local(+halfW, -halfD, 0);
  const FRB = local(+halfW, +halfD, 0);
  const BLB = local(-halfW, -halfD, 0);
  const BRB = local(-halfW, +halfD, 0);
  const FLT = local(+halfW, -halfD, h * 0.3);
  const FRT = local(+halfW, +halfD, h * 0.3);
  const BLT = local(-halfW, -halfD, h);
  const BRT = local(-halfW, +halfD, h);
  const faces: Face3[] = [
    [FLB, FRB, FRT, FLT],
    [BRB, BLB, BLT, BRT],
    [BLB, FLB, FLT, BLT],
    [FRB, BRB, BRT, FRT],
    [FLT, FRT, BRT, BLT],
  ];
  const baseHex = '#EAB308';
  return {
    faces,
    faceDepths: faces.map(faceDepth),
    faceFills: [
      shadeHex(baseHex, 1.05),
      shadeHex(baseHex, 0.55),
      shadeHex(baseHex, 0.72),
      shadeHex(baseHex, 0.72),
      shadeHex(baseHex, 1.10),
    ],
    faceStrokes: faces.map(() => 'rgba(0,0,0,.40)'),
  };
}

/** Snake / stage box — flat metal box with an array of XLR connectors on
 *  the top face. We render a 2-row × N-column grid of connector circles. */
export function snakeShape(item: EquipmentItem): Shape3D {
  const w = item.width ?? 1.5;
  const d = item.depth ?? 0.8;
  const h = item.itemHeight ?? 0.4;
  const ang = facingRad(item, false);
  const shape = defaultBoxShape(item.x, item.y, item.z, w, d, h, ang, '#94A3B8', false);
  // Top face is faces[4] (defaultBoxShape returns front, back, left, right, top)
  const top = faceFrame4(shape.faces[4]);
  const baseDepth = faceDepth(shape.faces[4]);
  // Connector count scales with width — typical stage box is 8/12/16-ch.
  const cols = Math.max(4, Math.min(16, Math.round(w * 4)));
  const rows = 2;
  const details: ShapeDetail[] = [];
  for (let r = 0; r < rows; r++) {
    const v = -0.55 + r * 0.6;
    for (let i = 0; i < cols; i++) {
      const u = -0.85 + (i + 0.5) * 1.7 / cols;
      // XLR jack: dark outer ring + 3 pin dots
      details.push({
        points: circleOnFace(top, u, v, 0.06, 12), closed: true,
        fill: '#1F2937', stroke: 'rgba(0,0,0,.5)', strokeWidth: 0.15,
        depth: baseDepth + 0.5,
      });
      details.push({
        points: circleOnFace(top, u, v, 0.025, 8), closed: true,
        fill: '#9CA3AF', stroke: 'none',
        depth: baseDepth + 0.6,
      });
    }
  }
  return { ...shape, details };
}

/** PDU — narrow power strip with a row of NEMA-style outlets visible on
 *  the front face plus a small power LED. */
export function pduShape(item: EquipmentItem): Shape3D {
  const w = item.width ?? 1.5;
  const d = item.depth ?? 0.4;
  const h = item.itemHeight ?? 0.4;
  const ang = facingRad(item, false);
  const shape = defaultBoxShape(item.x, item.y, item.z, w, d, h, ang, '#22D3EE', true);
  const front = faceFrame4(shape.faces[0]);
  const baseDepth = faceDepth(shape.faces[0]);
  const outlets = Math.max(4, Math.min(12, Math.round(w * 4)));
  const details: ShapeDetail[] = [];
  for (let i = 0; i < outlets; i++) {
    const u = -0.85 + (i + 0.5) * 1.7 / outlets;
    // Outlet face plate
    details.push({
      points: rectOnFace(front, u, 0, 0.05, 0.42), closed: true,
      fill: '#0B0E12', stroke: 'rgba(255,255,255,.15)', strokeWidth: 0.18,
      depth: baseDepth + 0.5,
    });
    // Two prong slots
    details.push({
      points: rectOnFace(front, u - 0.018, 0.05, 0.008, 0.10), closed: true,
      fill: '#9CA3AF', stroke: 'none',
      depth: baseDepth + 0.6,
    });
    details.push({
      points: rectOnFace(front, u + 0.018, 0.05, 0.008, 0.10), closed: true,
      fill: '#9CA3AF', stroke: 'none',
      depth: baseDepth + 0.6,
    });
  }
  // Power LED on the right end
  details.push({
    points: circleOnFace(front, 0.95, 0.55, 0.05, 10), closed: true,
    fill: '#10B981', stroke: 'rgba(255,255,255,.4)', strokeWidth: 0.12,
    depth: baseDepth + 0.5,
  });
  return { ...shape, details };
}

/** Breaker panel — tall wall-mount cabinet with a door outline, a small
 *  handle, and a visible row of breaker switches. */
export function breakerPanelShape(item: EquipmentItem): Shape3D {
  const w = item.width ?? 1.6;
  const d = item.depth ?? 0.5;
  const h = item.itemHeight ?? 4;
  const ang = facingRad(item, false);
  // Note: pass d as box width and w as depth — the panel's face is the
  // wide side facing the room. This matches the original shape.
  const shape = defaultBoxShape(item.x, item.y, item.z, d, w, h, ang, '#374151', true);
  const front = faceFrame4(shape.faces[0]);
  const baseDepth = faceDepth(shape.faces[0]);
  const details: ShapeDetail[] = [];
  // Door outline — inset from edges
  details.push({
    points: rectOnFace(front, 0, 0, 0.85, 0.92), closed: true,
    fill: 'none', stroke: 'rgba(0,0,0,.55)', strokeWidth: 0.4,
    depth: baseDepth + 0.5,
  });
  // Handle
  details.push({
    points: rectOnFace(front, 0.65, 0, 0.06, 0.08), closed: true,
    fill: '#1F2937', stroke: 'rgba(255,255,255,.15)', strokeWidth: 0.15,
    depth: baseDepth + 0.5,
  });
  // Breaker switch rows — 2 columns of breaker rockers
  // Rows scale with height (~2 breakers per ft)
  const breakerRows = Math.max(8, Math.min(40, Math.round(h * 4)));
  for (let r = 0; r < breakerRows; r++) {
    const v = -0.78 + (r + 0.5) * 1.56 / breakerRows;
    for (const u of [-0.42, 0.10]) {
      details.push({
        points: rectOnFace(front, u, v, 0.18, 0.014), closed: true,
        fill: '#0B0E12', stroke: 'none',
        depth: baseDepth + 0.5,
      });
      // Tiny rocker switch dot at one end
      details.push({
        points: rectOnFace(front, u + 0.13, v, 0.015, 0.018), closed: true,
        fill: '#9CA3AF', stroke: 'none',
        depth: baseDepth + 0.6,
      });
    }
  }
  return { ...shape, details };
}

// ---------------------------------------------------------------------
// Furniture / objects
// ---------------------------------------------------------------------

/** A thin upright leg box at a local offset from the item center.
 *  `along` = offset down the facing axis, `lateral` = offset across it. */
function legShape(cx: number, cy: number, ang: number, along: number, lateral: number, h: number, hex: string): Shape3D {
  const c = Math.cos(ang), s = Math.sin(ang);
  const px = cx + c * along - s * lateral;
  const py = cy + s * along + c * lateral;
  return defaultBoxShape(px, py, 0, 0.18, 0.18, h, ang, shadeHex(hex, 0.7));
}

// NOTE on conventions: in rotatedBoxFaces(w, d), the FIRST dimension runs
// ALONG the facing axis (front/back), the SECOND runs LATERAL (left/right).
// Furniture "width" (seat width, bench length, table length) is LATERAL —
// it goes in the second slot. Getting this backwards points a 10-ft pew
// at the stage instead of across it.

/** Chair — seat slab + backrest + 4 legs. Padded chairs read darker/upholstered;
 *  stacking chairs read as a hard plastic shell. */
function chairShape(item: EquipmentItem): Shape3D {
  const hex = item.panelColor ?? (item.kind === 'chair-padded' ? '#5C4033' : '#3F5564');
  const w = item.width ?? 1.6;          // seat width (lateral)
  const d = item.depth ?? 1.6;          // front-to-back (along facing)
  const ang = facingRad(item, false);
  const seatZ = 1.45;
  const seat = defaultBoxShape(item.x, item.y, seatZ, d * 0.8, w * 0.85, 0.18, ang, hex, true);
  // Backrest at the BACK of the seat: thin along facing, full width lateral.
  const c = Math.cos(ang), s = Math.sin(ang);
  const backOff = -d * 0.38;
  const bx = item.x + c * backOff;
  const by = item.y + s * backOff;
  const backH = item.kind === 'chair-padded' ? 1.5 : 1.4;
  const back = defaultBoxShape(bx, by, seatZ, 0.16, w * 0.85, backH, ang, shadeHex(hex, 1.0), true);
  const along = d * 0.34, lat = w * 0.36;
  const legHex = '#2B2B2B';
  return combineShapes(
    legShape(item.x, item.y, ang, +along, +lat, seatZ, legHex),
    legShape(item.x, item.y, ang, +along, -lat, seatZ, legHex),
    legShape(item.x, item.y, ang, -along, +lat, seatZ, legHex),
    legShape(item.x, item.y, ang, -along, -lat, seatZ, legHex),
    seat, back,
  );
}

/** Pew — long bench: seat plank + backrest + two solid end panels.
 *  The bench LENGTH runs lateral (across the facing direction). */
function pewShape(item: EquipmentItem): Shape3D {
  const hex = item.panelColor ?? '#7A5230';
  const len = item.width ?? 10;         // bench length (lateral)
  const d = item.depth ?? 1.5;          // seat depth (along facing)
  const ang = facingRad(item, false);
  const seatZ = 1.45;
  const c = Math.cos(ang), s = Math.sin(ang);
  const seat = defaultBoxShape(item.x, item.y, seatZ, d * 0.7, len, 0.18, ang, hex, true);
  const backOff = -d * 0.4;
  const bx = item.x + c * backOff, by = item.y + s * backOff;
  const back = defaultBoxShape(bx, by, seatZ, 0.18, len, 1.55, ang, shadeHex(hex, 1.02), true);
  // Solid end panels (floor → seat) at each lateral end.
  const endOff = len / 2 - 0.1;
  const e1x = item.x - s * endOff, e1y = item.y + c * endOff;
  const e2x = item.x + s * endOff, e2y = item.y - c * endOff;
  const end1 = defaultBoxShape(e1x, e1y, 0, d, 0.18, seatZ + 0.18, ang, shadeHex(hex, 0.85));
  const end2 = defaultBoxShape(e2x, e2y, 0, d, 0.18, seatZ + 0.18, ang, shadeHex(hex, 0.85));
  return combineShapes(end1, end2, seat, back);
}

/** Table — top slab + 4 legs (round tables read as a thicker square top). */
function tableShape(item: EquipmentItem): Shape3D {
  const hex = item.panelColor ?? '#9A8C7A';
  const w = item.width ?? 6;            // long side (lateral)
  const d = item.depth ?? 2.5;          // along facing
  const ang = facingRad(item, false);
  const topZ = 2.35;
  const top = defaultBoxShape(item.x, item.y, topZ, d, w, 0.14, ang, hex, true);
  const along = d * 0.4, lat = w * 0.42;
  const legHex = shadeHex(hex, 0.6);
  return combineShapes(
    legShape(item.x, item.y, ang, +along, +lat, topZ, legHex),
    legShape(item.x, item.y, ang, +along, -lat, topZ, legHex),
    legShape(item.x, item.y, ang, -along, +lat, topZ, legHex),
    legShape(item.x, item.y, ang, -along, -lat, topZ, legHex),
    top,
  );
}

/** Rug / area carpet — a very thin slab on the floor with a border band.
 *  Reads as a soft furnishing without occluding anything above it. */
function rugShape(item: EquipmentItem): Shape3D {
  const hex = item.panelColor ?? '#7A4A38';
  const w = item.width ?? 10;           // lateral
  const d = item.depth ?? 8;            // along facing
  const ang = facingRad(item, false);
  // Outer slab (the border tone) + inset field slab slightly higher.
  const border = defaultBoxShape(item.x, item.y, 0.02, d, w, 0.05, ang, shadeHex(hex, 0.7));
  const field = defaultBoxShape(item.x, item.y, 0.05, d * 0.88, w * 0.9, 0.04, ang, hex, true);
  return combineShapes(border, field);
}

/** Podium / lectern — a tapered column with a slanted reading top. */
function podiumShape(item: EquipmentItem): Shape3D {
  const hex = item.panelColor ?? '#5A3F28';
  const w = item.width ?? 2;            // lateral
  const d = item.depth ?? 1.5;          // along facing
  const ang = facingRad(item, false);
  // Body: tapered box (front face toward the audience) up to ~3.6 ft.
  const body = taperedBoxShape(item.x, item.y, 0, d * 0.8, w * 0.8, 3.6, ang, hex, 0.18);
  // Reading top — a thin slab overhanging the body.
  const top = defaultBoxShape(item.x, item.y, 3.6, d * 0.7, w, 0.12, ang, shadeHex(hex, 1.1), true);
  return combineShapes(body, top);
}

// ---------------------------------------------------------------------
// Public dispatch
// ---------------------------------------------------------------------

/**
 * Get the 3D shape for an equipment item, or null if no recipe is defined
 * for this kind (caller falls back to a flat icon).
 */
export function shape3DFor(item: EquipmentItem): Shape3D | null {
  switch (item.kind) {
    case 'speaker-line-array':  return lineArrayShape(item);
    case 'speaker-point':
    case 'speaker-fill':
    case 'speaker-delay':       return pointSpeakerShape(item);
    case 'speaker-sub':
    case 'speaker-sub-flown':   return subwooferShape(item);
    case 'speaker-monitor':     return monitorShape(item);
    case 'speaker-column':      return columnSpeakerShape(item);
    case 'speaker-iem':         return iemShape(item);
    case 'speaker-ceiling':     return ceilingSpeakerShape(item);
    case 'led-wall':            return ledWallShape(item);
    case 'projector':           return projectorShape(item);
    case 'confidence-monitor':  return confidenceMonitorShape(item);
    case 'ptz-camera':          return ptzCameraShape(item);
    case 'cam-handheld':        return handheldCameraShape(item);
    case 'mh-spot':
    case 'mh-wash':             return movingHeadShape(item);
    case 'led-par':             return ledParShape(item);
    case 'followspot':          return followspotShape(item);
    case 'lx-console':          return lxConsoleShape(item);
    case 'amp-rack':
    case 'dsp':
    case 'dimmer-rack':
    case 'rack':                return rackShape(item);
    case 'foh-console':
    case 'monitor-console':     return consoleShape(item);
    case 'snake':               return snakeShape(item);
    case 'pdu':                 return pduShape(item);
    case 'breaker-panel':       return breakerPanelShape(item);
    case 'chair-padded':
    case 'chair-stacking':      return chairShape(item);
    case 'pew':                 return pewShape(item);
    case 'table':               return tableShape(item);
    case 'podium':              return podiumShape(item);
    case 'rug':                 return rugShape(item);
    default:                    return null;
  }
}

/**
 * Render a Shape3D as SVG polygons projected via a `pp` helper. Faces are
 * sorted back-to-front (painter's algorithm) before emission so closer
 * faces overlay distant ones correctly. Details (per-kind overlay
 * features like woofer cones, panel grids, lens rings) render AFTER all
 * faces with their own depth order — typically biased forward by a small
 * amount so they sit on top of their parent face without z-fighting.
 */
export function renderShape3D(
  shape: Shape3D,
  pp: (pts: Vec3[]) => string,
  opts: { selected?: boolean; muted?: boolean } = {},
): React.ReactNode[] {
  const out: React.ReactNode[] = [];

  // ===== Faces =====
  const faceOrder = shape.faces
    .map((_, i) => i)
    .sort((a, b) => shape.faceDepths[a] - shape.faceDepths[b]);
  for (const i of faceOrder) {
    const face = shape.faces[i];
    const fill = opts.selected ? '#F5A623' : shape.faceFills[i];
    const stroke = shape.faceStrokes[i] ?? 'none';
    const opacity = opts.muted ? 0.4 : 1;
    out.push(
      <polygon key={`f-${i}`} points={pp(face)}
        fill={fill}
        fillOpacity={opacity}
        stroke={stroke}
        strokeWidth={0.45}
        strokeLinejoin="round"
      />
    );
  }

  // ===== Details =====
  // Sort by depth so far-away details paint first. Each detail's depth is
  // computed at attach time (or here as a fallback) and biased forward
  // so it lays over its parent face cleanly.
  if (shape.details && shape.details.length) {
    const enriched = shape.details.map((d, i) => ({
      idx: i,
      depth: d.depth ?? pointsDepth(d.points),
      detail: d,
    }));
    enriched.sort((a, b) => a.depth - b.depth);
    for (const { idx, detail: d } of enriched) {
      const ptsStr = pp(d.points);
      const baseOp = opts.muted ? 0.4 : 1;
      if (d.closed) {
        out.push(
          <polygon key={`d-${idx}`} points={ptsStr}
            fill={d.fill ?? 'none'}
            fillOpacity={(d.fillOpacity ?? 1) * baseOp}
            stroke={d.stroke ?? 'none'}
            strokeWidth={d.strokeWidth ?? 0.4}
            strokeLinejoin="round"
            pointerEvents="none"
          />
        );
      } else {
        out.push(
          <polyline key={`d-${idx}`} points={ptsStr}
            fill="none"
            stroke={d.stroke ?? 'rgba(0,0,0,.5)'}
            strokeWidth={d.strokeWidth ?? 0.35}
            strokeOpacity={baseOp}
            pointerEvents="none"
          />
        );
      }
    }
  }

  return out;
}

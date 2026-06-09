import type { Material, AbsorptionCoefficients } from '../types';

// Per-band absorption (α) — 125 / 250 / 500 / 1k / 2k / 4k Hz.
const a = (a125: number, a250: number, a500: number, a1k: number, a2k: number, a4k: number): AbsorptionCoefficients => ({
  125: a125, 250: a250, 500: a500, 1000: a1k, 2000: a2k, 4000: a4k,
});
// Per-band scattering (diffusion) coefficient s — same band layout. Generally
// rises with frequency (surface roughness becomes large vs wavelength).
const s = a;

/** Fallback scattering for a material that doesn't declare one — a smooth,
 *  largely specular surface with a mild HF rise. */
export const DEFAULT_SCATTERING: AbsorptionCoefficients = a(0.05, 0.06, 0.08, 0.10, 0.12, 0.14);

// =====================================================================
// Material library
// ---------------------------------------------------------------------
// α values are drawn from standard published measurement tables
// (Vorländer, ISO 354 / ASTM C423 lab data, manufacturer datasheets).
// Scattering coefficients follow typical reference values (ISO 17497):
// flat smooth ≈ 0.05–0.15, textured/masonry ≈ 0.15–0.40, modeled/slatted
// ≈ 0.30–0.60, audience/diffusers ≈ 0.50–0.80.
// =====================================================================

export const MATERIALS: Material[] = [
  // ===== Reflective / hard wall + ceiling =====
  { id: 'concrete-bare',   name: 'Concrete (rough/bare)',  category: 'wall', group: 'reflective', color: '#6B7280',
    alpha: a(0.01,0.01,0.02,0.02,0.02,0.03), scattering: s(0.10,0.11,0.12,0.13,0.14,0.15), thicknessIn: 8,
    description: 'Bare structural concrete — almost fully reflective.' },
  { id: 'concrete-sealed', name: 'Concrete (painted/sealed)', category: 'wall', group: 'reflective', color: '#7C8590',
    alpha: a(0.01,0.01,0.01,0.02,0.02,0.02), scattering: s(0.05,0.06,0.07,0.08,0.09,0.10), thicknessIn: 8,
    description: 'Sealed/painted concrete — smoother and slightly more reflective than bare.' },
  { id: 'cmu-bare',        name: 'CMU block (bare)',       category: 'wall', group: 'reflective', color: '#8A9099',
    alpha: a(0.36,0.44,0.31,0.29,0.39,0.25), scattering: s(0.20,0.24,0.28,0.32,0.34,0.36), thicknessIn: 8,
    description: 'Unpainted concrete masonry — porous, surprisingly absorptive at mids.' },
  { id: 'cmu-painted',     name: 'CMU block (painted)',    category: 'wall', group: 'reflective', color: '#B7BCC4',
    alpha: a(0.10,0.05,0.06,0.07,0.09,0.08), scattering: s(0.14,0.16,0.18,0.20,0.22,0.24), thicknessIn: 8,
    description: 'Painted block — paint seals the pores, much more reflective.' },
  { id: 'drywall',         name: 'Drywall ⅝" (gypsum)',    category: 'wall', group: 'reflective', color: '#D4D7DD',
    alpha: a(0.29,0.10,0.05,0.04,0.07,0.09), scattering: s(0.08,0.09,0.10,0.11,0.12,0.13), thicknessIn: 0.625,
    description: 'Single-layer gypsum board on studs — absorbs LF via panel resonance.' },
  { id: 'drywall-double',  name: 'Drywall (double-layer)', category: 'wall', group: 'reflective', color: '#C9CCD3',
    alpha: a(0.12,0.07,0.05,0.04,0.05,0.06), scattering: s(0.07,0.08,0.09,0.10,0.11,0.12), thicknessIn: 1.25,
    description: 'Two layers — stiffer panel, less LF absorption, more reflective overall.' },
  { id: 'plaster-lath',    name: 'Plaster on lath',        category: 'wall', group: 'reflective', color: '#DDD8CC',
    alpha: a(0.14,0.10,0.06,0.05,0.04,0.03), scattering: s(0.06,0.07,0.08,0.09,0.10,0.11), thicknessIn: 1,
    description: 'Traditional plaster — hard and reflective, slight LF give.' },
  { id: 'plaster-block',   name: 'Plaster on masonry',     category: 'wall', group: 'reflective', color: '#D2CDBF',
    alpha: a(0.02,0.02,0.03,0.04,0.05,0.05), scattering: s(0.06,0.07,0.08,0.09,0.10,0.11), thicknessIn: 1,
    description: 'Hard plaster over block — one of the most reflective wall finishes.' },
  { id: 'brick-bare',      name: 'Brick (bare)',           category: 'wall', group: 'reflective', color: '#8E5440',
    alpha: a(0.03,0.03,0.03,0.04,0.05,0.07), scattering: s(0.20,0.24,0.28,0.32,0.36,0.40), thicknessIn: 4,
    description: 'Exposed brick — reflective, but mortar joints add real scatter.' },
  { id: 'brick-painted',   name: 'Brick (painted)',        category: 'wall', group: 'reflective', color: '#A86B55',
    alpha: a(0.01,0.02,0.02,0.02,0.02,0.03), scattering: s(0.16,0.18,0.20,0.24,0.28,0.30), thicknessIn: 4,
    description: 'Painted brick — sealed pores, very reflective; joints still scatter.' },
  { id: 'marble-polished', name: 'Marble / polished stone', category: 'wall', group: 'reflective', color: '#CFCAC2',
    alpha: a(0.01,0.01,0.01,0.01,0.02,0.02), scattering: s(0.04,0.04,0.05,0.05,0.06,0.06), thicknessIn: 1,
    description: 'Polished stone — near-perfect mirror reflector.' },
  { id: 'ceramic-tile',    name: 'Ceramic tile (wall)',    category: 'wall', group: 'reflective', color: '#C3D2D8',
    alpha: a(0.01,0.01,0.01,0.02,0.02,0.02), scattering: s(0.06,0.07,0.08,0.09,0.10,0.11), thicknessIn: 0.4,
    description: 'Glazed tile — hard and reflective.' },

  // ===== Wood =====
  { id: 'wood-paneling',   name: 'Wood paneling (thin)',   category: 'wall', group: 'wood', color: '#6B4226',
    alpha: a(0.28,0.22,0.17,0.09,0.10,0.11), scattering: s(0.12,0.16,0.20,0.24,0.28,0.32), thicknessIn: 0.375,
    description: 'Thin paneling over an air gap — a panel absorber at low frequencies.' },
  { id: 'wood-paneling-heavy', name: 'Wood paneling (heavy ¾")', category: 'wall', group: 'wood', color: '#5A3A22',
    alpha: a(0.10,0.10,0.10,0.08,0.08,0.09), scattering: s(0.10,0.14,0.18,0.22,0.26,0.30), thicknessIn: 0.75,
    description: 'Solid ¾" paneling — stiff, mostly reflective with mild texture scatter.' },
  { id: 'plywood-thin',    name: 'Plywood ¼" (over air)',  category: 'wall', group: 'wood', color: '#B98A52',
    alpha: a(0.28,0.20,0.10,0.10,0.08,0.11), scattering: s(0.08,0.10,0.12,0.14,0.16,0.18), thicknessIn: 0.25,
    description: 'Thin ply over a cavity — effective low-frequency panel trap.' },
  { id: 'plywood-thick',   name: 'Plywood ¾"',             category: 'wall', group: 'wood', color: '#A0763F',
    alpha: a(0.10,0.09,0.08,0.07,0.06,0.07), scattering: s(0.07,0.09,0.11,0.13,0.15,0.17), thicknessIn: 0.75,
    description: 'Thick plywood — stiff, fairly reflective.' },
  { id: 'osb',             name: 'OSB board',              category: 'wall', group: 'wood', color: '#C2A26B',
    alpha: a(0.12,0.10,0.08,0.07,0.06,0.07), scattering: s(0.12,0.14,0.16,0.18,0.20,0.22), thicknessIn: 0.5,
    description: 'Oriented strand board — chip texture adds a little scatter.' },
  { id: 'mdf-painted',     name: 'MDF (painted)',          category: 'wall', group: 'wood', color: '#9A8C7A',
    alpha: a(0.10,0.08,0.06,0.05,0.05,0.05), scattering: s(0.05,0.06,0.07,0.08,0.09,0.10), thicknessIn: 0.75,
    description: 'Dense painted MDF — smooth and reflective.' },
  { id: 'wood-slat',       name: 'Wood slat (over absorber)', category: 'wall', group: 'wood', color: '#7A5230',
    alpha: a(0.25,0.55,0.80,0.85,0.75,0.60), scattering: s(0.30,0.40,0.50,0.55,0.58,0.60), thicknessIn: 2,
    description: 'Slatted wood over mineral-wool — absorbs broadband and scatters strongly.' },

  // ===== Glass / metal =====
  { id: 'glass-window',    name: 'Glass (window)',         category: 'wall', group: 'glass-metal', color: '#A8C7E8',
    alpha: a(0.35,0.25,0.18,0.12,0.07,0.04), scattering: s(0.04,0.04,0.05,0.05,0.06,0.06), thicknessIn: 0.25,
    description: 'Standard glazing — resonant LF absorption, reflective up high.' },
  { id: 'glass-thick',     name: 'Glass (thick/laminated)', category: 'wall', group: 'glass-metal', color: '#9BBBDD',
    alpha: a(0.18,0.06,0.04,0.03,0.02,0.02), scattering: s(0.04,0.04,0.05,0.05,0.06,0.06), thicknessIn: 0.5,
    description: 'Heavy laminated glass — stiffer, less LF give, very reflective.' },
  { id: 'metal-deck',      name: 'Metal deck (corrugated)', category: 'ceiling', group: 'glass-metal', color: '#9DA4AD',
    alpha: a(0.04,0.04,0.05,0.05,0.05,0.05), scattering: s(0.30,0.36,0.42,0.46,0.50,0.52), thicknessIn: 1.5,
    description: 'Corrugated steel deck — reflective but the ribs scatter strongly.' },
  { id: 'metal-panel',     name: 'Metal panel (flat sheet)', category: 'wall', group: 'glass-metal', color: '#AEB4BC',
    alpha: a(0.03,0.03,0.03,0.04,0.04,0.04), scattering: s(0.05,0.06,0.07,0.08,0.09,0.10), thicknessIn: 0.1,
    description: 'Flat sheet metal — hard mirror reflector.' },
  { id: 'perforated-metal', name: 'Perforated metal (over absorber)', category: 'wall', group: 'glass-metal', color: '#8F969E',
    alpha: a(0.25,0.55,0.85,0.90,0.85,0.75), scattering: s(0.12,0.14,0.16,0.18,0.20,0.22), thicknessIn: 2,
    description: 'Micro-perforated facing over fill — broadband absorber with a hard look.' },

  // ===== Absorptive / soft wall =====
  { id: 'curtain-light',   name: 'Curtain (light drape)',  category: 'wall', group: 'absorptive', color: '#9A6B62',
    alpha: a(0.04,0.06,0.11,0.18,0.30,0.35), scattering: s(0.25,0.30,0.35,0.40,0.42,0.45), thicknessIn: 0.5,
    description: 'Lightweight fabric hung flat — modest HF absorber.' },
  { id: 'curtain',         name: 'Curtain (heavy, pleated)', category: 'wall', group: 'absorptive', color: '#7B2D26',
    alpha: a(0.14,0.35,0.55,0.72,0.70,0.65), scattering: s(0.30,0.36,0.42,0.48,0.50,0.52), thicknessIn: 1,
    description: 'Heavy pleated drape with air behind — strong broadband absorber.' },
  { id: 'fabric-wrapped',  name: 'Fabric-wrapped panel wall', category: 'wall', group: 'absorptive', color: '#6E6258',
    alpha: a(0.30,0.65,0.95,0.98,0.95,0.90), scattering: s(0.10,0.12,0.14,0.16,0.18,0.20), thicknessIn: 2,
    description: 'Stretched fabric over rigid fiberglass — high broadband absorption.' },
  { id: 'cork',            name: 'Cork tiles',             category: 'wall', group: 'absorptive', color: '#B68A56',
    alpha: a(0.05,0.10,0.20,0.55,0.60,0.55), scattering: s(0.10,0.12,0.14,0.16,0.18,0.20), thicknessIn: 0.5,
    description: 'Cork — light mid/high absorber with a warm look.' },
  { id: 'mineral-wool-exposed', name: 'Mineral wool (exposed)', category: 'wall', group: 'absorptive', color: '#8C8B86',
    alpha: a(0.34,0.85,1.00,1.00,1.00,1.00), scattering: s(0.10,0.12,0.14,0.16,0.18,0.20), thicknessIn: 2,
    description: 'Exposed batt — near-total absorber above 250 Hz.' },

  // ===== Ceiling-specific =====
  { id: 'act-standard',    name: 'Acoustic ceiling tile (std)', category: 'ceiling', group: 'ceiling', color: '#E4E2DA',
    alpha: a(0.34,0.45,0.55,0.65,0.70,0.70), scattering: s(0.12,0.14,0.16,0.18,0.20,0.22), thicknessIn: 0.625,
    description: 'Mineral-fiber lay-in tile (NRC ~0.55) — the default drop ceiling.' },
  { id: 'act-high-nrc',    name: 'Acoustic ceiling tile (high-NRC)', category: 'ceiling', group: 'ceiling', color: '#EDEBE4',
    alpha: a(0.50,0.70,0.85,0.95,0.95,0.90), scattering: s(0.12,0.14,0.16,0.18,0.20,0.22), thicknessIn: 1,
    description: 'High-performance lay-in tile (NRC ~0.90).' },
  { id: 'gypsum-ceiling',  name: 'Gypsum board ceiling',   category: 'ceiling', group: 'ceiling', color: '#D9DCE1',
    alpha: a(0.29,0.10,0.05,0.04,0.07,0.09), scattering: s(0.06,0.07,0.08,0.09,0.10,0.11), thicknessIn: 0.625,
    description: 'Hard drywall ceiling — reflective, absorbs LF via panel resonance.' },
  { id: 'plaster-ceiling', name: 'Plaster ceiling',        category: 'ceiling', group: 'ceiling', color: '#DAD6C9',
    alpha: a(0.14,0.10,0.06,0.05,0.04,0.03), scattering: s(0.06,0.07,0.08,0.09,0.10,0.11), thicknessIn: 1,
    description: 'Hard plaster ceiling — very reflective.' },

  // ===== Floor =====
  { id: 'concrete-floor',  name: 'Concrete floor (sealed)', category: 'floor', group: 'floor', color: '#838A93',
    alpha: a(0.01,0.01,0.015,0.02,0.02,0.02), scattering: s(0.05,0.06,0.07,0.08,0.09,0.10), thicknessIn: 4,
    description: 'Sealed concrete slab — fully reflective floor.' },
  { id: 'wood-floor',      name: 'Hardwood floor',         category: 'floor', group: 'floor', color: '#8B5A2B',
    alpha: a(0.15,0.11,0.10,0.07,0.06,0.07), scattering: s(0.06,0.07,0.08,0.09,0.10,0.11), thicknessIn: 1,
    description: 'Wood over joists/sleepers — slight LF give, reflective up top.' },
  { id: 'wood-floor-slab', name: 'Wood on slab',           category: 'floor', group: 'floor', color: '#9A6634',
    alpha: a(0.04,0.04,0.05,0.06,0.06,0.07), scattering: s(0.05,0.06,0.07,0.08,0.09,0.10), thicknessIn: 0.75,
    description: 'Engineered wood glued to slab — harder, more reflective than floated wood.' },
  { id: 'vinyl-floor',     name: 'Vinyl / LVT',            category: 'floor', group: 'floor', color: '#A89A86',
    alpha: a(0.02,0.03,0.03,0.03,0.03,0.02), scattering: s(0.05,0.06,0.07,0.08,0.09,0.10), thicknessIn: 0.2,
    description: 'Resilient vinyl plank/tile — reflective.' },
  { id: 'ceramic-tile-floor', name: 'Ceramic tile floor',  category: 'floor', group: 'floor', color: '#BFC9CC',
    alpha: a(0.01,0.01,0.01,0.02,0.02,0.02), scattering: s(0.05,0.06,0.07,0.08,0.09,0.10), thicknessIn: 0.4,
    description: 'Glazed floor tile — hard reflector.' },
  { id: 'rubber-floor',    name: 'Rubber / sports floor',  category: 'floor', group: 'floor', color: '#5B5E63',
    alpha: a(0.04,0.04,0.08,0.12,0.10,0.10), scattering: s(0.06,0.07,0.08,0.09,0.10,0.11), thicknessIn: 0.3,
    description: 'Resilient rubber flooring — mild mid absorption.' },
  { id: 'carpet-thin',     name: 'Carpet (thin, glue-down)', category: 'floor', group: 'floor', color: '#9C7E5F',
    alpha: a(0.01,0.02,0.06,0.15,0.25,0.45), scattering: s(0.10,0.12,0.14,0.16,0.18,0.20), thicknessIn: 0.25,
    description: 'Thin commercial carpet on slab — light HF absorber.' },
  { id: 'carpet-tile',     name: 'Carpet tile',            category: 'floor', group: 'floor', color: '#8E7458',
    alpha: a(0.02,0.04,0.08,0.20,0.35,0.50), scattering: s(0.10,0.12,0.14,0.16,0.18,0.20), thicknessIn: 0.4,
    description: 'Modular carpet tile — between thin and thick broadloom.' },
  { id: 'carpet-thick',    name: 'Carpet (thick)',         category: 'floor', group: 'floor', color: '#7B5B3F',
    alpha: a(0.02,0.06,0.14,0.37,0.60,0.65), scattering: s(0.12,0.14,0.16,0.18,0.20,0.22), thicknessIn: 0.5,
    description: 'Thick cut-pile carpet — solid mid/high absorber.' },
  { id: 'carpet-on-pad',   name: 'Carpet on pad',          category: 'floor', group: 'floor', color: '#6E4F36',
    alpha: a(0.08,0.24,0.57,0.69,0.71,0.73), scattering: s(0.12,0.14,0.16,0.18,0.20,0.22), thicknessIn: 0.9,
    description: 'Carpet over thick underlay — the most absorptive common floor.' },

  // ===== Acoustic treatment (panels / traps / diffusers) =====
  { id: 'panel-1in',       name: 'Acoustic panel 1"',      category: 'panel', group: 'treatment', color: '#F5A623',
    alpha: a(0.08,0.32,0.99,0.76,0.34,0.12), scattering: s(0.10,0.12,0.14,0.16,0.18,0.20), thicknessIn: 1,
    description: 'Thin fabric-wrapped panel — mid-focused absorber.' },
  { id: 'panel-2in',       name: 'Acoustic panel 2"',      category: 'panel', group: 'treatment', color: '#D88B0F',
    alpha: a(0.20,0.55,0.89,0.99,0.99,0.99), scattering: s(0.10,0.12,0.14,0.16,0.18,0.20), thicknessIn: 2,
    description: 'Standard 2" broadband panel — workhorse treatment.' },
  { id: 'panel-4in',       name: 'Acoustic panel 4" (broadband)', category: 'panel', group: 'treatment', color: '#B8740C',
    alpha: a(0.45,0.95,1.05,1.00,1.00,0.98), scattering: s(0.10,0.12,0.14,0.16,0.18,0.20), thicknessIn: 4,
    description: 'Thick panel — extends absorption well into the low-mids.' },
  { id: 'bass-trap',       name: 'Corner bass trap',       category: 'panel', group: 'treatment', color: '#8C5A0A',
    alpha: a(0.85,0.85,0.70,0.55,0.45,0.35), scattering: s(0.10,0.11,0.12,0.13,0.14,0.15), thicknessIn: 12,
    description: 'Deep corner trap — targets low-frequency build-up.' },
  { id: 'melamine-foam',   name: 'Melamine foam 2"',       category: 'panel', group: 'treatment', color: '#D9D2C4',
    alpha: a(0.12,0.40,0.78,0.98,1.00,1.00), scattering: s(0.10,0.12,0.14,0.16,0.18,0.20), thicknessIn: 2,
    description: 'Open-cell melamine — light, high HF absorption.' },
  { id: 'ceiling-cloud',   name: 'Ceiling cloud',          category: 'panel', group: 'treatment', color: '#E0A93A',
    alpha: a(0.30,0.70,0.95,1.00,0.95,0.90), scattering: s(0.14,0.16,0.18,0.20,0.22,0.24), thicknessIn: 2,
    description: 'Horizontal absorber suspended below the ceiling — absorbs both faces.' },
  { id: 'diffuser-qrd',    name: 'QRD diffuser',           category: 'panel', group: 'treatment', color: '#9C6B2F',
    alpha: a(0.18,0.20,0.18,0.15,0.12,0.10), scattering: s(0.40,0.60,0.80,0.90,0.92,0.92), thicknessIn: 6,
    description: 'Quadratic-residue diffuser — scatters strongly, absorbs little.' },
  { id: 'diffuser-skyline', name: 'Skyline diffuser',      category: 'panel', group: 'treatment', color: '#A6783B',
    alpha: a(0.15,0.16,0.15,0.13,0.11,0.10), scattering: s(0.35,0.55,0.75,0.88,0.92,0.92), thicknessIn: 5,
    description: '2-D primitive-root diffuser — broad hemispherical scatter.' },

  // ===== Audience / seating (per-zone seating model) =====
  // Generic upholstered seat — default fallback for unzoned audience.
  { id: 'upholstered-empty',    name: 'Upholstered (empty)',    category: 'audience', group: 'audience', color: '#5C4033',
    alpha: a(0.19,0.37,0.56,0.67,0.61,0.59), scattering: s(0.50,0.55,0.60,0.65,0.68,0.70) },
  { id: 'upholstered-occupied', name: 'Upholstered (occupied)', category: 'audience', group: 'audience', color: '#3D2A1E',
    alpha: a(0.36,0.51,0.69,0.79,0.76,0.73), scattering: s(0.55,0.60,0.65,0.70,0.72,0.74) },
  { id: 'padded-chair-empty',    name: 'Padded chair (empty)',    category: 'audience', group: 'audience', color: '#5C4033',
    alpha: a(0.19,0.37,0.56,0.67,0.61,0.59), scattering: s(0.50,0.55,0.60,0.65,0.68,0.70) },
  { id: 'padded-chair-occupied', name: 'Padded chair (occupied)', category: 'audience', group: 'audience', color: '#3D2A1E',
    alpha: a(0.36,0.51,0.69,0.79,0.76,0.73), scattering: s(0.55,0.60,0.65,0.70,0.72,0.74) },
  { id: 'unpadded-chair-empty',    name: 'Unpadded chair (empty)',    category: 'audience', group: 'audience', color: '#9CA3AF',
    alpha: a(0.04,0.04,0.05,0.05,0.06,0.06), scattering: s(0.40,0.45,0.50,0.55,0.58,0.60) },
  { id: 'unpadded-chair-occupied', name: 'Unpadded chair (occupied)', category: 'audience', group: 'audience', color: '#6B7280',
    alpha: a(0.30,0.40,0.55,0.65,0.65,0.65), scattering: s(0.50,0.55,0.60,0.65,0.68,0.70) },
  { id: 'pew-padded-empty',    name: 'Padded pew (empty)',    category: 'audience', group: 'audience', color: '#7E5A3A',
    alpha: a(0.14,0.26,0.42,0.53,0.51,0.48), scattering: s(0.45,0.50,0.55,0.60,0.63,0.65) },
  { id: 'pew-padded-occupied', name: 'Padded pew (occupied)', category: 'audience', group: 'audience', color: '#5E3F22',
    alpha: a(0.30,0.42,0.58,0.68,0.66,0.62), scattering: s(0.50,0.55,0.60,0.65,0.68,0.70) },
  { id: 'pew-wood-empty',    name: 'Wood pew (empty)',    category: 'audience', group: 'audience', color: '#8B6336',
    alpha: a(0.10,0.10,0.13,0.14,0.15,0.18), scattering: s(0.35,0.40,0.45,0.50,0.53,0.55) },
  { id: 'pew-wood-occupied', name: 'Wood pew (occupied)', category: 'audience', group: 'audience', color: '#6F4D27',
    alpha: a(0.40,0.44,0.57,0.65,0.66,0.60), scattering: s(0.50,0.55,0.60,0.65,0.68,0.70) },
  { id: 'standing-audience', name: 'Standing audience',  category: 'audience', group: 'audience', color: '#3D2A1E',
    alpha: a(0.18,0.36,0.55,0.68,0.72,0.70), scattering: s(0.55,0.60,0.65,0.70,0.72,0.74) },
];

export const MATERIAL_BY_ID: Record<string, Material> = Object.fromEntries(MATERIALS.map(m => [m.id, m]));

export function getMaterial(id: string): Material {
  return MATERIAL_BY_ID[id] ?? MATERIAL_BY_ID['drywall'];
}

/** Resolve a material's scattering curve, falling back to the smooth default. */
export function getScattering(id: string): AbsorptionCoefficients {
  return MATERIAL_BY_ID[id]?.scattering ?? DEFAULT_SCATTERING;
}

/** NRC — mean of the 250/500/1k/2k absorption bands, rounded to 0.05.
 *  Uses the material's stored nrc when present, else computes it. */
export function materialNRC(m: Material): number {
  if (typeof m.nrc === 'number') return m.nrc;
  const mean = (m.alpha[250] + m.alpha[500] + m.alpha[1000] + m.alpha[2000]) / 4;
  return Math.round(mean * 20) / 20; // nearest 0.05
}

/** Materials offered for a given surface kind, matching the legacy filters:
 *  walls accept wall+panel, ceilings accept wall+ceiling+panel, floors floor. */
export function materialsForSurface(kind: 'wall' | 'floor' | 'ceiling'): Material[] {
  if (kind === 'floor') return MATERIALS.filter(m => m.category === 'floor');
  if (kind === 'ceiling') return MATERIALS.filter(m => m.category === 'wall' || m.category === 'ceiling' || m.category === 'panel');
  return MATERIALS.filter(m => m.category === 'wall' || m.category === 'panel');
}

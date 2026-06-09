import type { EquipmentTemplate } from '../types';

// Realistic equipment library with brand-named SKUs.
// Speaker entries include dispersion, max SPL, and rough sensitivity/power.

export const BRANDS = [
  // Speakers
  'L-Acoustics', 'd&b audiotechnik', 'Meyer Sound', 'JBL Pro',
  'QSC', 'EAW', 'RCF', 'Yamaha', 'Danley',
  // Wireless / IEM
  'Shure', 'Sennheiser',
  // Video
  'Panasonic', 'Christie', 'Epson', 'Barco',
  'PTZOptics', 'Vaddio', 'Sony', 'Blackmagic Design',
  'Absen', 'ROE Visual', 'ADJ',
  // Lighting
  'Martin', 'Robe', 'Chauvet Pro', 'Elation',
  'ETC', 'MA Lighting', 'High End Systems',
  'Robert Juliat',
  // Audio signal chain
  'DiGiCo', 'Avid', 'Allen & Heath', 'Midas', 'Soundcraft',
  'Crown', 'Powersoft', 'Lab.gruppen',
  'Biamp', 'BSS', 'Symetrix',
  'Whirlwind',
  // Infrastructure
  'Middle Atlantic', 'APC', 'Furman',
  // Acoustic treatment (new in this sprint)
  'GIK Acoustics', 'Primacoustic', 'Auralex',
  'RPG Acoustical', 'Vicoustic', 'ATS Acoustics', 'Real Traps',
];

export const EQUIPMENT: EquipmentTemplate[] = [
  // ===== L-Acoustics =====
  { kind: 'speaker-point',      category: 'audio-speaker', brand: 'L-Acoustics', label: 'X8',        badge: 'Coaxial',     horiz: 110, vert: 90,  maxSPL: 132, sensitivity: 99,  power: 200,  weightLb: 16.5, lf: '8"',     price: 1900 },
  { kind: 'speaker-point',      category: 'audio-speaker', brand: 'L-Acoustics', label: 'X12',       badge: 'Coaxial',     horiz: 90,  vert: 60,  maxSPL: 138, sensitivity: 102, power: 350,  weightLb: 32,   lf: '12"',    price: 3450 },
  { kind: 'speaker-line-array', category: 'audio-speaker', brand: 'L-Acoustics', label: 'Kara II',   badge: 'Line array',  horiz: 110, vert: 10,  maxSPL: 142, sensitivity: 105, power: 700,  weightLb: 56,   lf: '2x6.5"', price: 7200 },
  { kind: 'speaker-sub',        category: 'audio-speaker', brand: 'L-Acoustics', label: 'SB18',      badge: 'Sub',         horiz: 360, vert: 360, maxSPL: 138, sensitivity: 100, power: 1200, weightLb: 88,   lf: '18"',    price: 4100 },
  // ===== d&b =====
  { kind: 'speaker-point',      category: 'audio-speaker', brand: 'd&b audiotechnik', label: '8S',   badge: 'Compact',     horiz: 80,  vert: 50,  maxSPL: 130, sensitivity: 100, power: 250,  weightLb: 19,   lf: '8"',     price: 2050 },
  { kind: 'speaker-line-array', category: 'audio-speaker', brand: 'd&b audiotechnik', label: 'Y8',   badge: 'Line array',  horiz: 80,  vert: 10,  maxSPL: 138, sensitivity: 104, power: 600,  weightLb: 38,   lf: '2x8"',   price: 5400 },
  { kind: 'speaker-point',      category: 'audio-speaker', brand: 'd&b audiotechnik', label: '44S',  badge: 'Surface',     horiz: 75,  vert: 75,  maxSPL: 121, sensitivity: 95,  power: 100,  weightLb: 8.4,  lf: '4"',     price: 1680 },
  { kind: 'speaker-sub',        category: 'audio-speaker', brand: 'd&b audiotechnik', label: 'B6 Sub', badge: 'Sub',       horiz: 360, vert: 360, maxSPL: 132, sensitivity: 99,  power: 700,  weightLb: 51,   lf: '2x10"',  price: 3900 },
  // ===== Meyer =====
  { kind: 'speaker-point',      category: 'audio-speaker', brand: 'Meyer Sound', label: 'Ultra-X20', badge: 'Coaxial',     horiz: 110, vert: 50,  maxSPL: 131, sensitivity: 100, power: 320,  weightLb: 26,   lf: '6.5"x2', price: 3700 },
  { kind: 'speaker-point',      category: 'audio-speaker', brand: 'Meyer Sound', label: 'Ultra-X40', badge: 'Compact',     horiz: 110, vert: 50,  maxSPL: 134, sensitivity: 101, power: 400,  weightLb: 32,   lf: '8"',     price: 5100 },
  { kind: 'speaker-sub',        category: 'audio-speaker', brand: 'Meyer Sound', label: '700-HP Sub', badge: 'Sub',        horiz: 360, vert: 360, maxSPL: 139, sensitivity: 101, power: 1500, weightLb: 220,  lf: '2x18"',  price: 8200 },
  // ===== JBL =====
  { kind: 'speaker-line-array', category: 'audio-speaker', brand: 'JBL Pro', label: 'VTX A8',         badge: 'Line array',  horiz: 100, vert: 10,  maxSPL: 138, sensitivity: 103, power: 600,  weightLb: 53,   lf: '2x8"',   price: 4900 },
  { kind: 'speaker-column',     category: 'audio-speaker', brand: 'JBL Pro', label: 'CBT 100LA',      badge: 'Column',      horiz: 150, vert: 30,  maxSPL: 116, sensitivity: 95,  power: 200,  weightLb: 25,   lf: '8x2"',   price: 1100 },
  { kind: 'speaker-ceiling',    category: 'audio-speaker', brand: 'JBL Pro', label: 'Control 12C',    badge: 'Ceiling',     horiz: 110, vert: 110, maxSPL: 105, sensitivity: 90,  power: 60,   weightLb: 6,    lf: '5.25"',  price: 240 },
  { kind: 'speaker-sub',        category: 'audio-speaker', brand: 'JBL Pro', label: 'SRX828SP',       badge: 'Sub',         horiz: 360, vert: 360, maxSPL: 137, sensitivity: 100, power: 2000, weightLb: 121,  lf: '2x18"',  price: 2800 },
  // ===== QSC =====
  { kind: 'speaker-point',      category: 'audio-speaker', brand: 'QSC', label: 'K12.2',              badge: 'Powered',     horiz: 75,  vert: 75,  maxSPL: 132, sensitivity: 99,  power: 2000, weightLb: 39,   lf: '12"',    price: 1100 },
  { kind: 'speaker-sub',        category: 'audio-speaker', brand: 'QSC', label: 'KS212c',             badge: 'Sub',         horiz: 360, vert: 360, maxSPL: 132, sensitivity: 100, power: 3600, weightLb: 88,   lf: '2x12"',  price: 1900 },
  { kind: 'speaker-ceiling',    category: 'audio-speaker', brand: 'QSC', label: 'AD-C8T',             badge: 'Ceiling',     horiz: 90,  vert: 90,  maxSPL: 109, sensitivity: 91,  power: 100,  weightLb: 9,    lf: '8"',     price: 320 },
  // ===== EAW =====
  { kind: 'speaker-point',      category: 'audio-speaker', brand: 'EAW', label: 'MK2364',             badge: 'Install',     horiz: 60,  vert: 45,  maxSPL: 134, sensitivity: 102, power: 400,  weightLb: 79,   lf: '12"',    price: 2200 },
  { kind: 'speaker-point',      category: 'audio-speaker', brand: 'EAW', label: 'RSX12',              badge: 'Powered',     horiz: 75,  vert: 50,  maxSPL: 133, sensitivity: 100, power: 1000, weightLb: 38,   lf: '12"',    price: 1700 },
  // ===== RCF =====
  { kind: 'speaker-line-array', category: 'audio-speaker', brand: 'RCF', label: 'HDL 20-A',           badge: 'Line array',  horiz: 100, vert: 15,  maxSPL: 135, sensitivity: 102, power: 1400, weightLb: 50,   lf: '2x8"',   price: 2700 },
  { kind: 'speaker-point',      category: 'audio-speaker', brand: 'RCF', label: 'TT515-A',            badge: 'Compact',     horiz: 90,  vert: 60,  maxSPL: 130, sensitivity: 96,  power: 400,  weightLb: 31,   lf: '5"',     price: 1400 },
  // ===== Yamaha =====
  { kind: 'speaker-point',      category: 'audio-speaker', brand: 'Yamaha', label: 'DZR15',           badge: 'Powered',     horiz: 90,  vert: 60,  maxSPL: 139, sensitivity: 100, power: 2000, weightLb: 60,   lf: '15"',    price: 1750 },
  { kind: 'speaker-point',      category: 'audio-speaker', brand: 'Yamaha', label: 'DZR10',           badge: 'Powered',     horiz: 90,  vert: 60,  maxSPL: 136, sensitivity: 99,  power: 2000, weightLb: 41,   lf: '10"',    price: 1450 },
  { kind: 'speaker-ceiling',    category: 'audio-speaker', brand: 'Yamaha', label: 'VXC8W',           badge: 'Ceiling',     horiz: 110, vert: 110, maxSPL: 102, sensitivity: 89,  power: 100,  weightLb: 6.4,  lf: '8"',     price: 360 },
  // ===== Danley =====
  { kind: 'speaker-point',      category: 'audio-speaker', brand: 'Danley', label: 'SM-60F',          badge: 'Synergy',     horiz: 60,  vert: 60,  maxSPL: 137, sensitivity: 105, power: 700,  weightLb: 75,   lf: '15"',    price: 2800 },
  { kind: 'speaker-sub',        category: 'audio-speaker', brand: 'Danley', label: 'TH-118',          badge: 'Tapped Horn', horiz: 360, vert: 360, maxSPL: 142, sensitivity: 106, power: 1200, weightLb: 165,  lf: '18"',    price: 3400 },

  // ===== Stage monitors =====
  { kind: 'speaker-monitor',    category: 'audio-speaker', brand: 'd&b audiotechnik', label: 'M4 Monitor',  badge: 'Wedge',  horiz: 60,  vert: 60,  maxSPL: 132, sensitivity: 99,  power: 600,  weightLb: 38,   lf: '12"',    price: 2300 },
  { kind: 'speaker-monitor',    category: 'audio-speaker', brand: 'L-Acoustics',      label: 'X12 Wedge',   badge: 'Wedge',  horiz: 90,  vert: 60,  maxSPL: 138, sensitivity: 102, power: 350,  weightLb: 32,   lf: '12"',    price: 3450 },
  { kind: 'speaker-monitor',    category: 'audio-speaker', brand: 'QSC',              label: 'KW122 Wedge', badge: 'Wedge',  horiz: 75,  vert: 75,  maxSPL: 132, sensitivity: 99,  power: 1000, weightLb: 50,   lf: '12"',    price: 1100 },

  // ===== Delay & fills =====
  { kind: 'speaker-delay',      category: 'audio-speaker', brand: 'L-Acoustics',      label: 'X8 (delay)',  badge: 'Delay',  horiz: 110, vert: 90,  maxSPL: 132, sensitivity: 99,  power: 200,  weightLb: 16.5, lf: '8"',     price: 1900 },
  { kind: 'speaker-fill',       category: 'audio-speaker', brand: 'd&b audiotechnik', label: '44S (fill)',  badge: 'Front fill', horiz: 75, vert: 75, maxSPL: 121, sensitivity: 95,  power: 100,  weightLb: 8.4,  lf: '4"',     price: 1680 },

  // ===== IEM transmitter — RF only, no acoustic output =====
  { kind: 'speaker-iem',        category: 'audio-speaker', brand: 'Shure',            label: 'PSM 900 IEM Tx', badge: 'IEM Tx', horiz: 0, vert: 0, maxSPL: 0, sensitivity: 0, power: 0, weightLb: 4, lf: '—', price: 1100 },
  { kind: 'speaker-iem',        category: 'audio-speaker', brand: 'Sennheiser',       label: 'EW IEM G4 Tx',   badge: 'IEM Tx', horiz: 0, vert: 0, maxSPL: 0, sensitivity: 0, power: 0, weightLb: 3, lf: '—', price: 800 },

  // ===== Acoustic treatment =====
  // GIK Acoustics — most popular budget/mid AVL treatment. Standard
  // fabric-wrapped rigid-fiberglass panels in tan/charcoal/grey/black.
  { kind: 'acoustic-panel', category: 'acoustic', brand: 'GIK Acoustics', label: '242 Panel (2")',
    nrc: 1.05, defaultW: 4, defaultD: 2, price: 95, panelPattern: 'fabric', panelColor: '#C9B79C',
    alpha: { 125: 0.20, 250: 0.55, 500: 0.89, 1000: 0.99, 2000: 0.99, 4000: 0.99 } },
  { kind: 'acoustic-panel', category: 'acoustic', brand: 'GIK Acoustics', label: '244 Panel (4")',
    nrc: 1.10, defaultW: 4, defaultD: 2, price: 125, panelPattern: 'fabric', panelColor: '#3F4451',
    alpha: { 125: 0.45, 250: 0.85, 500: 0.99, 1000: 1.05, 2000: 1.05, 4000: 1.05 } },
  { kind: 'acoustic-panel', category: 'acoustic', brand: 'GIK Acoustics', label: 'ArtPanel (printed)',
    nrc: 1.05, defaultW: 4, defaultD: 2, price: 165, panelPattern: 'fabric', panelColor: '#A8836B',
    alpha: { 125: 0.20, 250: 0.55, 500: 0.89, 1000: 0.99, 2000: 0.99, 4000: 0.99 } },
  // Primacoustic — clean install fabric panels, Broadway series most common.
  { kind: 'acoustic-panel', category: 'acoustic', brand: 'Primacoustic', label: 'Broadway 2" Panel',
    nrc: 0.95, defaultW: 4, defaultD: 2, price: 78, panelPattern: 'fabric', panelColor: '#B8A691',
    alpha: { 125: 0.16, 250: 0.50, 500: 0.85, 1000: 0.95, 2000: 0.95, 4000: 0.95 } },
  { kind: 'acoustic-panel', category: 'acoustic', brand: 'Primacoustic', label: 'Cumulus Cloud',
    nrc: 0.95, defaultW: 4, defaultD: 4, price: 220, panelPattern: 'fabric', panelColor: '#B8A691',
    alpha: { 125: 0.18, 250: 0.50, 500: 0.85, 1000: 0.95, 2000: 0.95, 4000: 0.95 } },
  // Auralex — distinctive purple/charcoal foam pyramids (Studiofoam) +
  // ELiTE fabric panels.
  { kind: 'acoustic-panel', category: 'acoustic', brand: 'Auralex', label: 'Studiofoam Wedges (2")',
    nrc: 0.80, defaultW: 2, defaultD: 2, price: 60, panelPattern: 'foam-wedge', panelColor: '#3A2E54',
    alpha: { 125: 0.10, 250: 0.30, 500: 0.85, 1000: 0.95, 2000: 0.95, 4000: 0.95 } },
  { kind: 'acoustic-panel', category: 'acoustic', brand: 'Auralex', label: 'ELiTE ProPanel (2")',
    nrc: 0.95, defaultW: 4, defaultD: 2, price: 110, panelPattern: 'fabric', panelColor: '#2A2D33',
    alpha: { 125: 0.18, 250: 0.55, 500: 0.90, 1000: 0.95, 2000: 0.95, 4000: 0.95 } },
  // ATS Acoustics — budget-friendly install panels.
  { kind: 'acoustic-panel', category: 'acoustic', brand: 'ATS Acoustics', label: '24x48 Panel (2")',
    nrc: 0.95, defaultW: 4, defaultD: 2, price: 55, panelPattern: 'fabric', panelColor: '#7E6F58',
    alpha: { 125: 0.15, 250: 0.50, 500: 0.85, 1000: 0.95, 2000: 0.95, 4000: 0.95 } },
  // RPG — premium combination panels with embedded diffusion.
  { kind: 'acoustic-panel', category: 'acoustic', brand: 'RPG Acoustical', label: 'BAD Panel (Binary)',
    nrc: 0.85, defaultW: 4, defaultD: 2, price: 320, panelPattern: 'skyline', panelColor: '#1F2329',
    alpha: { 125: 0.18, 250: 0.45, 500: 0.70, 1000: 0.85, 2000: 0.90, 4000: 0.85 } },

  // Bass traps
  { kind: 'bass-trap',     category: 'acoustic', brand: 'GIK Acoustics', label: 'Soffit Bass Trap',
    nrc: 0.85, defaultW: 4, defaultD: 6, price: 240, panelPattern: 'fabric', panelColor: '#3F4451',
    alpha: { 125: 0.85, 250: 0.85, 500: 0.70, 1000: 0.55, 2000: 0.45, 4000: 0.35 } },
  { kind: 'bass-trap',     category: 'acoustic', brand: 'GIK Acoustics', label: 'Tri-Trap (corner)',
    nrc: 0.80, defaultW: 2, defaultD: 4, price: 175, panelPattern: 'fabric', panelColor: '#3F4451',
    alpha: { 125: 0.90, 250: 0.85, 500: 0.65, 1000: 0.45, 2000: 0.35, 4000: 0.30 } },
  { kind: 'bass-trap',     category: 'acoustic', brand: 'Auralex',      label: 'LENRD Bass Trap',
    nrc: 0.75, defaultW: 1, defaultD: 4, price: 110, panelPattern: 'foam-wedge', panelColor: '#3A2E54',
    alpha: { 125: 0.70, 250: 0.80, 500: 0.65, 1000: 0.50, 2000: 0.40, 4000: 0.35 } },
  { kind: 'bass-trap',     category: 'acoustic', brand: 'Real Traps',   label: 'MondoTrap (cylindrical)',
    nrc: 0.85, defaultW: 1.2, defaultD: 4, price: 290, panelPattern: 'cylindrical', panelColor: '#1A1F26',
    alpha: { 125: 0.92, 250: 0.95, 500: 0.85, 1000: 0.65, 2000: 0.45, 4000: 0.35 } },

  // Diffusers
  { kind: 'diffuser',      category: 'acoustic', brand: 'GIK Acoustics', label: 'Q7d Diffuser',
    nrc: 0.30, defaultW: 2, defaultD: 2, price: 295, panelPattern: 'qrd', panelColor: '#7A4A2A',
    alpha: { 125: 0.10, 250: 0.20, 500: 0.30, 1000: 0.35, 2000: 0.40, 4000: 0.45 } },
  { kind: 'diffuser',      category: 'acoustic', brand: 'GIK Acoustics', label: 'Alpha 1D (slat)',
    nrc: 0.55, defaultW: 4, defaultD: 2, price: 365, panelPattern: 'wood-slat', panelColor: '#7A4A2A',
    alpha: { 125: 0.30, 250: 0.55, 500: 0.65, 1000: 0.70, 2000: 0.65, 4000: 0.55 } },
  { kind: 'diffuser',      category: 'acoustic', brand: 'Auralex',      label: 'T-Fusor Skyline',
    nrc: 0.20, defaultW: 2, defaultD: 2, price: 95, panelPattern: 'skyline', panelColor: '#E5E5E0',
    alpha: { 125: 0.05, 250: 0.10, 500: 0.20, 1000: 0.25, 2000: 0.30, 4000: 0.35 } },
  { kind: 'diffuser',      category: 'acoustic', brand: 'RPG Acoustical', label: 'Diffusor 2D Skyline',
    nrc: 0.25, defaultW: 2, defaultD: 2, price: 580, panelPattern: 'skyline', panelColor: '#1F2329',
    alpha: { 125: 0.10, 250: 0.15, 500: 0.20, 1000: 0.25, 2000: 0.30, 4000: 0.35 } },
  { kind: 'diffuser',      category: 'acoustic', brand: 'RPG Acoustical', label: 'QRD 734',
    nrc: 0.30, defaultW: 2, defaultD: 2, price: 510, panelPattern: 'wood-slat', panelColor: '#5A3A20',
    alpha: { 125: 0.15, 250: 0.25, 500: 0.30, 1000: 0.35, 2000: 0.40, 4000: 0.45 } },
  { kind: 'diffuser',      category: 'acoustic', brand: 'Vicoustic',    label: 'Wavewood Diffuser',
    nrc: 0.25, defaultW: 2.6, defaultD: 1.3, price: 280, panelPattern: 'wave-wood', panelColor: '#9C6B3A',
    alpha: { 125: 0.10, 250: 0.20, 500: 0.30, 1000: 0.35, 2000: 0.30, 4000: 0.30 } },
  { kind: 'diffuser',      category: 'acoustic', brand: 'Vicoustic',    label: 'Multifuser DC2',
    nrc: 0.25, defaultW: 2, defaultD: 2, price: 195, panelPattern: 'wave-wood', panelColor: '#A8835A',
    alpha: { 125: 0.10, 250: 0.20, 500: 0.30, 1000: 0.35, 2000: 0.30, 4000: 0.30 } },

  // ===== Audio signal chain =====
  // FOH consoles
  { kind: 'foh-console',     category: 'audio-signal', brand: 'DiGiCo',          label: 'S31',              defaultW: 4.5, defaultD: 2.6, price: 24500 },
  { kind: 'foh-console',     category: 'audio-signal', brand: 'DiGiCo',          label: 'Quantum 225',      defaultW: 4.0, defaultD: 2.4, price: 38000 },
  { kind: 'foh-console',     category: 'audio-signal', brand: 'Yamaha',          label: 'CL5',              defaultW: 4.4, defaultD: 2.2, price: 22000 },
  { kind: 'foh-console',     category: 'audio-signal', brand: 'Yamaha',          label: 'QL1',              defaultW: 3.0, defaultD: 2.0, price: 13500 },
  { kind: 'foh-console',     category: 'audio-signal', brand: 'Avid',            label: 'S6L-32D',          defaultW: 5.0, defaultD: 3.0, price: 56000 },
  { kind: 'foh-console',     category: 'audio-signal', brand: 'Allen & Heath',   label: 'dLive C3500',      defaultW: 4.2, defaultD: 2.4, price: 21500 },
  { kind: 'foh-console',     category: 'audio-signal', brand: 'Midas',           label: 'PRO X',            defaultW: 5.0, defaultD: 2.6, price: 32000 },
  { kind: 'foh-console',     category: 'audio-signal', brand: 'Soundcraft',      label: 'Vi3000',           defaultW: 4.5, defaultD: 2.4, price: 21000 },
  // Monitor consoles
  { kind: 'monitor-console', category: 'audio-signal', brand: 'Yamaha',          label: 'QL1 (monitor)',    defaultW: 3.0, defaultD: 2.0, price: 13500 },
  { kind: 'monitor-console', category: 'audio-signal', brand: 'Allen & Heath',   label: 'dLive C2500',      defaultW: 3.5, defaultD: 2.3, price: 17800 },
  { kind: 'monitor-console', category: 'audio-signal', brand: 'DiGiCo',          label: 'S21 (monitor)',    defaultW: 3.2, defaultD: 2.2, price: 16800 },
  // Amplifier racks
  { kind: 'amp-rack',        category: 'audio-signal', brand: 'Crown',           label: 'DCi 4|600N',       defaultW: 2.0, defaultD: 2.5, price: 3800 },
  { kind: 'amp-rack',        category: 'audio-signal', brand: 'QSC',             label: 'CXD4.3',           defaultW: 2.0, defaultD: 2.5, price: 4400 },
  { kind: 'amp-rack',        category: 'audio-signal', brand: 'Powersoft',       label: 'Ottocanali 12K4',  defaultW: 2.0, defaultD: 2.5, price: 7800 },
  { kind: 'amp-rack',        category: 'audio-signal', brand: 'L-Acoustics',     label: 'LA4X',             defaultW: 2.0, defaultD: 2.5, price: 5200 },
  { kind: 'amp-rack',        category: 'audio-signal', brand: 'd&b audiotechnik', label: 'D40',              defaultW: 2.0, defaultD: 2.5, price: 6400 },
  // DSP / matrix
  { kind: 'dsp',             category: 'audio-signal', brand: 'Biamp',           label: 'Tesira Forté CI',  defaultW: 2.0, defaultD: 1.5, price: 4900 },
  { kind: 'dsp',             category: 'audio-signal', brand: 'QSC',             label: 'Q-SYS Core 110f',  defaultW: 2.0, defaultD: 1.5, price: 7200 },
  { kind: 'dsp',             category: 'audio-signal', brand: 'BSS',             label: 'BLU-100',          defaultW: 2.0, defaultD: 1.5, price: 3400 },
  { kind: 'dsp',             category: 'audio-signal', brand: 'Yamaha',          label: 'MTX5-D',           defaultW: 2.0, defaultD: 1.5, price: 1900 },
  // Stage boxes / snakes
  { kind: 'snake',           category: 'audio-signal', brand: 'Yamaha',          label: 'Rio3224-D',        defaultW: 2.5, defaultD: 1.0, price: 4200 },
  { kind: 'snake',           category: 'audio-signal', brand: 'Whirlwind',       label: '32x4 Stage Box',   defaultW: 2.0, defaultD: 1.0, price: 1800 },
  { kind: 'snake',           category: 'audio-signal', brand: 'Allen & Heath',   label: 'DX168',            defaultW: 2.0, defaultD: 1.0, price: 2200 },

  // ===== Video =====
  // Projectors
  { kind: 'projector',          category: 'video', brand: 'Panasonic',  label: 'PT-RZ16K',     defaultW: 2.4, defaultD: 1.8, throwRatio: 1.7, brightness: 16000, resolution: '1920×1200', price: 24000 },
  { kind: 'projector',          category: 'video', brand: 'Panasonic',  label: 'PT-RZ34K',     defaultW: 3.0, defaultD: 2.4, throwRatio: 1.7, brightness: 31000, resolution: '1920×1200', price: 60000 },
  { kind: 'projector',          category: 'video', brand: 'Christie',   label: 'M 4K15-RGB',   defaultW: 3.4, defaultD: 2.6, throwRatio: 1.5, brightness: 15000, resolution: '4096×2160', price: 95000 },
  { kind: 'projector',          category: 'video', brand: 'Epson',      label: 'Pro L1500UNL', defaultW: 2.2, defaultD: 1.6, throwRatio: 1.6, brightness: 12000, resolution: '1920×1200', price: 11500 },
  { kind: 'projector',          category: 'video', brand: 'Barco',      label: 'UDX-W22',      defaultW: 3.6, defaultD: 2.8, throwRatio: 1.5, brightness: 22000, resolution: '1920×1200', price: 105000 },
  // LED walls
  { kind: 'led-wall',           category: 'video', brand: 'Absen',      label: 'Polaris 3.9',  screenWidthFt: 16, screenHeightFt: 9, defaultW: 16, defaultD: 0.6, resolution: '3.9 mm', price: 14000 },
  { kind: 'led-wall',           category: 'video', brand: 'ROE Visual', label: 'BM4 (Black Marble)', screenWidthFt: 12, screenHeightFt: 7, defaultW: 12, defaultD: 0.5, resolution: '4 mm', price: 22000 },
  { kind: 'led-wall',           category: 'video', brand: 'ADJ',        label: 'AV6X 6mm',     screenWidthFt: 10, screenHeightFt: 6, defaultW: 10, defaultD: 0.6, resolution: '6 mm', price: 5400 },
  // PTZ cameras
  { kind: 'ptz-camera',         category: 'video', brand: 'PTZOptics',  label: 'Move 4K',           defaultW: 0.8, defaultD: 0.8, fovDeg: 70, hasPtz: true, price: 1900 },
  { kind: 'ptz-camera',         category: 'video', brand: 'Vaddio',     label: 'RoboShot 40 UHD',   defaultW: 0.7, defaultD: 0.7, fovDeg: 75, hasPtz: true, price: 6400 },
  { kind: 'ptz-camera',         category: 'video', brand: 'Panasonic',  label: 'AW-UE100',          defaultW: 0.9, defaultD: 0.9, fovDeg: 75, hasPtz: true, price: 13500 },
  { kind: 'ptz-camera',         category: 'video', brand: 'Sony',       label: 'SRG-X400',          defaultW: 0.7, defaultD: 0.8, fovDeg: 70, hasPtz: true, price: 5200 },
  // Handheld cameras
  { kind: 'cam-handheld',       category: 'video', brand: 'Sony',              label: 'FX6',              defaultW: 0.8, defaultD: 0.6, fovDeg: 60, price: 5800 },
  { kind: 'cam-handheld',       category: 'video', brand: 'Blackmagic Design', label: 'URSA Mini Pro 12K', defaultW: 0.9, defaultD: 0.7, fovDeg: 60, price: 6000 },
  { kind: 'cam-handheld',       category: 'video', brand: 'Panasonic',         label: 'AG-CX350',         defaultW: 0.9, defaultD: 0.6, fovDeg: 65, price: 4200 },
  // Confidence monitors
  { kind: 'confidence-monitor', category: 'video', brand: 'Sony',     label: '32" Pro Display', defaultW: 3.0, defaultD: 0.4, resolution: '1920×1080', price: 1200 },

  // ===== Lighting =====
  // Moving heads — spot
  { kind: 'mh-spot',     category: 'lighting', brand: 'Martin',           label: 'MAC Quantum Profile',  defaultW: 1.2, defaultD: 1.0, beamAngleDeg: 12, wattage: 470, price: 14500 },
  { kind: 'mh-spot',     category: 'lighting', brand: 'Robe',             label: 'Pointe',               defaultW: 1.0, defaultD: 0.9, beamAngleDeg: 5,  wattage: 280, price: 7800 },
  { kind: 'mh-spot',     category: 'lighting', brand: 'Chauvet Pro',      label: 'Maverick MK3 Spot',    defaultW: 1.1, defaultD: 1.0, beamAngleDeg: 14, wattage: 400, price: 8200 },
  { kind: 'mh-spot',     category: 'lighting', brand: 'Elation',          label: 'Proteus Excalibur',    defaultW: 1.3, defaultD: 1.1, beamAngleDeg: 7,  wattage: 1000, price: 17500 },
  { kind: 'mh-spot',     category: 'lighting', brand: 'High End Systems', label: 'SolaSpot Pro 1000',    defaultW: 1.1, defaultD: 1.0, beamAngleDeg: 12, wattage: 1000, price: 10500 },
  // Moving heads — wash
  { kind: 'mh-wash',     category: 'lighting', brand: 'Martin',           label: 'MAC Aura PXL',         defaultW: 1.0, defaultD: 0.9, beamAngleDeg: 35, wattage: 470, price: 9800 },
  { kind: 'mh-wash',     category: 'lighting', brand: 'Robe',             label: 'Spiider',              defaultW: 1.0, defaultD: 0.9, beamAngleDeg: 35, wattage: 600, price: 11200 },
  { kind: 'mh-wash',     category: 'lighting', brand: 'Chauvet Pro',      label: 'Rogue R2 Wash',        defaultW: 1.0, defaultD: 0.9, beamAngleDeg: 40, wattage: 350, price: 4500 },
  { kind: 'mh-wash',     category: 'lighting', brand: 'Elation',          label: 'Fuze Wash Z350',       defaultW: 1.0, defaultD: 0.9, beamAngleDeg: 40, wattage: 350, price: 4900 },
  // LED par
  { kind: 'led-par',     category: 'lighting', brand: 'Chauvet Pro',      label: 'Ovation P-56FC',       defaultW: 0.7, defaultD: 0.7, beamAngleDeg: 17, wattage: 110, price: 950 },
  { kind: 'led-par',     category: 'lighting', brand: 'ADJ',              label: 'Mega Par Profile Plus', defaultW: 0.7, defaultD: 0.7, beamAngleDeg: 25, wattage: 90,  price: 350 },
  { kind: 'led-par',     category: 'lighting', brand: 'Martin',           label: 'Rush PAR 2 RGBW',      defaultW: 0.7, defaultD: 0.7, beamAngleDeg: 22, wattage: 110, price: 1200 },
  { kind: 'led-par',     category: 'lighting', brand: 'Elation',          label: 'SixPar 200',           defaultW: 0.7, defaultD: 0.7, beamAngleDeg: 25, wattage: 90,  price: 1100 },
  // Followspots
  { kind: 'followspot',  category: 'lighting', brand: 'Robert Juliat',    label: 'Cyrano',               defaultW: 4.5, defaultD: 2.0, beamAngleDeg: 9,  wattage: 2500, price: 18500 },
  { kind: 'followspot',  category: 'lighting', brand: 'ETC',              label: 'Source Four LED Series 3', defaultW: 3.5, defaultD: 1.5, beamAngleDeg: 14, wattage: 240, price: 4800 },
  // Lighting consoles
  { kind: 'lx-console',  category: 'lighting', brand: 'ETC',              label: 'EOS Apex',             defaultW: 5.0, defaultD: 2.4, price: 35000 },
  { kind: 'lx-console',  category: 'lighting', brand: 'ETC',              label: 'Ion Xe 20',            defaultW: 3.0, defaultD: 2.0, price: 11500 },
  { kind: 'lx-console',  category: 'lighting', brand: 'MA Lighting',      label: 'grandMA3 Light',       defaultW: 4.5, defaultD: 2.3, price: 38500 },
  { kind: 'lx-console',  category: 'lighting', brand: 'High End Systems', label: 'Hog 4',                defaultW: 4.4, defaultD: 2.2, price: 26500 },
  // Dimmer racks
  { kind: 'dimmer-rack', category: 'lighting', brand: 'ETC',              label: 'Sensor3 ER96',         defaultW: 2.0, defaultD: 2.5, price: 9500 },

  // ===== Infrastructure =====
  { kind: 'rack',          category: 'infrastructure', brand: 'Middle Atlantic', label: 'SR-25',          defaultW: 2.0, defaultD: 2.5, price: 800 },
  { kind: 'rack',          category: 'infrastructure', brand: 'APC',             label: 'AR3100 Rack',    defaultW: 2.0, defaultD: 3.5, price: 1400 },
  { kind: 'pdu',           category: 'infrastructure', brand: 'Furman',          label: 'PL-Plus C',      defaultW: 1.7, defaultD: 0.5, price: 280 },
  { kind: 'pdu',           category: 'infrastructure', brand: 'APC',             label: 'AP7900 PDU',     defaultW: 1.7, defaultD: 0.4, price: 340 },
  { kind: 'breaker-panel', category: 'infrastructure', brand: 'Generic', label: 'Electrical Panel',   defaultW: 1.5, defaultD: 0.6 },
  { kind: 'cable-run',     category: 'infrastructure', brand: 'Generic', label: 'Cable Run',          defaultW: 0.5, defaultD: 0.5 },

  // ===== Rigging — truss =====
  { kind: 'truss-straight', category: 'infrastructure', brand: 'Global Truss', label: 'F34 · 12" Straight Truss',  defaultW: 1, defaultD: 1, price: 480 },
  { kind: 'truss-square',   category: 'infrastructure', brand: 'Global Truss', label: 'F34 · 12" Box Truss',       defaultW: 1, defaultD: 1, price: 560 },
  { kind: 'truss-circle',   category: 'infrastructure', brand: 'Global Truss', label: 'F34 · 12" Circle Truss',    defaultW: 1, defaultD: 1, price: 640 },

  // ===== Furniture / objects (acoustically active) =====
  // Footprint = defaultW × defaultD (ft). alpha = the seating material's
  // random-incidence absorption (per occupied floor area); the engine applies
  // it on the footprint basis. Empty/occupied is governed by the room
  // occupancy flag at sim time via the audience model; placed furniture here
  // carries its EMPTY absorption (a conservative default).
  { kind: 'chair-padded',   category: 'furniture', brand: 'Generic', label: 'Padded chair',   defaultW: 1.7, defaultD: 1.7, price: 45, panelColor: '#5C4033',
    alpha: { 125: 0.19, 250: 0.37, 500: 0.56, 1000: 0.67, 2000: 0.61, 4000: 0.59 } },
  { kind: 'chair-stacking', category: 'furniture', brand: 'Generic', label: 'Stacking chair', defaultW: 1.6, defaultD: 1.6, price: 18, panelColor: '#3F5564',
    alpha: { 125: 0.04, 250: 0.04, 500: 0.05, 1000: 0.05, 2000: 0.06, 4000: 0.06 } },
  { kind: 'pew',            category: 'furniture', brand: 'Generic', label: 'Wood pew (10 ft)', defaultW: 10, defaultD: 1.5, price: 600, panelColor: '#7A5230',
    alpha: { 125: 0.10, 250: 0.10, 500: 0.13, 1000: 0.14, 2000: 0.15, 4000: 0.18 } },
  { kind: 'pew',            category: 'furniture', brand: 'Generic', label: 'Padded pew (10 ft)', defaultW: 10, defaultD: 1.5, price: 850, panelColor: '#6E4A2C',
    alpha: { 125: 0.14, 250: 0.26, 500: 0.42, 1000: 0.53, 2000: 0.51, 4000: 0.48 } },
  { kind: 'table',          category: 'furniture', brand: 'Generic', label: 'Folding table (6 ft)', defaultW: 6, defaultD: 2.5, price: 70, panelColor: '#9A8C7A',
    alpha: { 125: 0.10, 250: 0.09, 500: 0.08, 1000: 0.07, 2000: 0.06, 4000: 0.07 } },
  { kind: 'table',          category: 'furniture', brand: 'Generic', label: 'Round table (5 ft)', defaultW: 5, defaultD: 5, price: 110, panelColor: '#8B6F52',
    alpha: { 125: 0.10, 250: 0.09, 500: 0.08, 1000: 0.07, 2000: 0.06, 4000: 0.07 } },
  { kind: 'podium',         category: 'furniture', brand: 'Generic', label: 'Lectern / podium', defaultW: 2, defaultD: 1.5, price: 250, panelColor: '#5A3F28',
    alpha: { 125: 0.10, 250: 0.10, 500: 0.10, 1000: 0.09, 2000: 0.08, 4000: 0.08 } },
  // Rugs / area carpets — floor coverings that absorb on their footprint.
  // Alpha is the carpet-on-pad curve (net effect over a hard floor is
  // slightly less; the engine treats it additively — conservative for
  // reflective floors, where rugs are actually used).
  { kind: 'rug',            category: 'furniture', brand: 'Generic', label: 'Area rug (8×10, thick)', defaultW: 10, defaultD: 8, price: 320, panelColor: '#7A4A38',
    alpha: { 125: 0.08, 250: 0.24, 500: 0.57, 1000: 0.69, 2000: 0.71, 4000: 0.73 } },
  { kind: 'rug',            category: 'furniture', brand: 'Generic', label: 'Area rug (12×15, thick)', defaultW: 15, defaultD: 12, price: 680, panelColor: '#5E4030',
    alpha: { 125: 0.08, 250: 0.24, 500: 0.57, 1000: 0.69, 2000: 0.71, 4000: 0.73 } },
  { kind: 'rug',            category: 'furniture', brand: 'Generic', label: 'Runner (3×10)', defaultW: 10, defaultD: 3, price: 110, panelColor: '#6E5644',
    alpha: { 125: 0.05, 250: 0.15, 500: 0.40, 1000: 0.55, 2000: 0.60, 4000: 0.62 } },
  { kind: 'rug',            category: 'furniture', brand: 'Generic', label: 'Stage carpet (16×12)', defaultW: 16, defaultD: 12, price: 450, panelColor: '#3A3F47',
    alpha: { 125: 0.06, 250: 0.20, 500: 0.50, 1000: 0.62, 2000: 0.65, 4000: 0.68 } },
];

export function templateById(kind: string, brand?: string, label?: string): EquipmentTemplate | undefined {
  return EQUIPMENT.find(t =>
    t.kind === kind && (!brand || t.brand === brand) && (!label || t.label === label)
  );
}

export function speakerTemplates() {
  return EQUIPMENT.filter(t => t.category === 'audio-speaker');
}
export function acousticTemplates() {
  return EQUIPMENT.filter(t => t.category === 'acoustic');
}
export function videoTemplates() {
  return EQUIPMENT.filter(t => t.category === 'video');
}
export function lightingTemplates() {
  return EQUIPMENT.filter(t => t.category === 'lighting');
}
export function audioSignalTemplates() {
  return EQUIPMENT.filter(t => t.category === 'audio-signal');
}
export function infrastructureTemplates() {
  return EQUIPMENT.filter(t => t.category === 'infrastructure');
}
export function furnitureTemplates() {
  return EQUIPMENT.filter(t => t.category === 'furniture');
}

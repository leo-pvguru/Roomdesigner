// =====================================================================
// Client proposal PDF
// ---------------------------------------------------------------------
// Generates a client-facing SALES proposal (vs. the engineering report in
// pdf.ts): branded cover, plain-language system overview with predicted
// performance, scope of work, an investment table built from the BOM with
// labor / adjustment / tax, and terms with signature lines.
//
// Loaded lazily (jsPDF is heavy) — callers `await import()` this module.
// =====================================================================

import { jsPDF } from 'jspdf';
import type {
  EquipmentItem, ProjectMeta, RoomState, RT60Result, HeatmapData,
} from '../types';
import { EQUIPMENT } from '../constants/equipmentLibrary';

export interface ProposalArgs {
  meta: ProjectMeta;
  room: RoomState;
  equipment: EquipmentItem[];
  rt60: RT60Result | null;
  sti: number | null;
  stiRating: string;
  heatmap: HeatmapData | null;
  /** Labor as a percentage of the equipment subtotal (e.g. 30). */
  laborPct: number;
  /** Equipment price adjustment in percent — positive = markup, negative = discount. */
  adjustPct: number;
  /** Sales tax percent applied to the (equipment + labor) subtotal. */
  taxPct: number;
  /** Proposal validity, in days from today. */
  validDays: number;
  /** Terms & conditions body text. */
  terms: string;
  /** Optional rasterized coverage-map exhibit (viewport snapshot). */
  heatmapImage?: { dataUrl: string; width: number; height: number } | null;
}

// Brand palette (Beacon AVL)
const ROYAL: [number, number, number] = [26, 79, 191];
const DEEP:  [number, number, number] = [20, 63, 153];
const AMBER: [number, number, number] = [245, 166, 35];
const INK:   [number, number, number] = [18, 21, 26];
const GRAY:  [number, number, number] = [110, 117, 128];

const PAGE_W = 612, PAGE_H = 792;          // letter, pt
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;

function money(n: number): string {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function priceForItem(item: EquipmentItem): number {
  const t = EQUIPMENT.find(eq =>
    eq.kind === item.kind && eq.label === item.label && (!item.brand || eq.brand === item.brand));
  return t?.price ?? 0;
}

const CATEGORY_LABEL: Record<string, string> = {
  'audio-speaker': 'Audio — Loudspeakers',
  'audio-signal':  'Audio — Signal & Control',
  'acoustic':      'Acoustic Treatment',
  'video':         'Video',
  'lighting':      'Lighting',
  'infrastructure':'Infrastructure & Rigging',
  'furniture':     'Furnishings',
};

interface BomRow { label: string; brand: string; category: string; qty: number; unit: number; total: number }

function buildRows(equipment: EquipmentItem[], adjustPct: number): BomRow[] {
  const map = new Map<string, BomRow>();
  const k = 1 + adjustPct / 100;
  for (const item of equipment) {
    if (item.category === 'reference') continue;
    const key = `${item.kind}|${item.brand ?? ''}|${item.label}`;
    const unit = Math.round(priceForItem(item) * k);
    const ex = map.get(key);
    if (ex) { ex.qty += 1; ex.total += unit; }
    else map.set(key, { label: item.label, brand: item.brand ?? 'Custom', category: item.category, qty: 1, unit, total: unit });
  }
  return Array.from(map.values()).sort((a, b) =>
    a.category !== b.category ? a.category.localeCompare(b.category) : a.label.localeCompare(b.label));
}

/** Plain-language one-liner summarizing the designed system. */
function systemNarrative(equipment: EquipmentItem[]): string {
  const speakers = equipment.filter(e => e.category === 'audio-speaker');
  const parts: string[] = [];
  const byLabel = new Map<string, number>();
  for (const s of speakers) {
    const key = `${s.brand ?? ''} ${s.label}`.trim();
    byLabel.set(key, (byLabel.get(key) ?? 0) + 1);
  }
  const top = Array.from(byLabel.entries()).slice(0, 5)
    .map(([label, qty]) => `${qty} × ${label}`);
  if (top.length) parts.push(`The audio system comprises ${top.join(', ')}.`);
  const video = equipment.filter(e => e.category === 'video').length;
  if (video) parts.push(`${video} video display/projection element${video === 1 ? '' : 's'} are included.`);
  const lighting = equipment.filter(e => e.category === 'lighting').length;
  if (lighting) parts.push(`${lighting} lighting fixture${lighting === 1 ? '' : 's'} round out the production rig.`);
  const panels = equipment.filter(e => e.category === 'acoustic').length;
  if (panels) parts.push(`${panels} acoustic treatment element${panels === 1 ? '' : 's'} control the room's reverberation.`);
  return parts.join(' ') || 'System design in progress.';
}

export function exportProposalPDF(args: ProposalArgs, filename = 'proposal.pdf') {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  let y = 0;

  const setColor = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);

  // ---------- Cover ----------
  doc.setFillColor(DEEP[0], DEEP[1], DEEP[2]);
  doc.rect(0, 0, PAGE_W, 240, 'F');
  doc.setFillColor(AMBER[0], AMBER[1], AMBER[2]);
  doc.rect(0, 240, PAGE_W, 5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text('BEACON AVL', MARGIN, 70);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(200, 215, 245);
  doc.text('Audio · Video · Lighting — Design & Integration', MARGIN, 86);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(255, 255, 255);
  doc.text('System Design Proposal', MARGIN, 160);
  doc.setFontSize(16);
  doc.setTextColor(245, 200, 120);
  doc.text(args.meta.name, MARGIN, 188);

  y = 300;
  setColor(INK);
  doc.setFontSize(11);
  const coverRow = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold'); setColor(GRAY);
    doc.text(label.toUpperCase(), MARGIN, y);
    doc.setFont('helvetica', 'normal'); setColor(INK);
    doc.text(value, MARGIN + 130, y);
    y += 22;
  };
  coverRow('Prepared for', args.meta.clientName || '—');
  coverRow('Prepared by', args.meta.consultantName || 'Beacon AVL');
  coverRow('Date', new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
  const validUntil = new Date(Date.now() + args.validDays * 86400_000);
  coverRow('Valid through', validUntil.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));

  doc.setFontSize(9);
  setColor(GRAY);
  doc.text('Prepared with Beacon Room Designer — physics-based acoustic prediction.', MARGIN, PAGE_H - 50);

  // ---------- Page 2: Overview ----------
  doc.addPage();
  y = MARGIN;

  const heading = (txt: string) => {
    doc.setFillColor(AMBER[0], AMBER[1], AMBER[2]);
    doc.rect(MARGIN, y - 2, 26, 4, 'F');
    y += 14;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); setColor(DEEP);
    doc.text(txt, MARGIN, y);
    y += 22;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); setColor(INK);
  };
  const para = (txt: string) => {
    const lines = doc.splitTextToSize(txt, CONTENT_W);
    doc.text(lines, MARGIN, y);
    y += lines.length * 14.5 + 10;
  };
  const pageBreakIf = (needed: number) => {
    if (y + needed > PAGE_H - MARGIN) { doc.addPage(); y = MARGIN; }
  };

  heading('Project Overview');
  const r = args.room;
  para(
    `${args.meta.name} is a ${r.width.toFixed(0)} × ${r.depth.toFixed(0)} ft ${r.roomType} with ` +
    `${r.height.toFixed(0)} ft ${r.ceilingShape === 'flat' ? 'ceilings' : `${r.ceilingShape} ceilings`}` +
    `${r.occupancy ? `, seating approximately ${r.occupancy}` : ''}. ` +
    `This proposal covers the design, supply, and predicted performance of the audio, video, and lighting system below. ` +
    `All performance figures come from a physics-based simulation of this specific room — its geometry, surface materials, and seating.`
  );

  heading('Designed System');
  para(systemNarrative(args.equipment));

  heading('Predicted Performance');
  const perf: Array<[string, string, string]> = [];
  // Skip the outdoor sentinel (99 s) — meaningless in a client document.
  if (args.rt60 && args.rt60.average < 90) {
    perf.push(['Reverberation (RT60)', `${args.rt60.average.toFixed(2)} s`, args.rt60.rating]);
  }
  if (args.sti != null) {
    perf.push(['Speech intelligibility (STI)', args.sti.toFixed(2), args.stiRating || '—']);
  }
  if (args.heatmap) {
    perf.push(['Average coverage', `${args.heatmap.avg.toFixed(1)} dB SPL`, `±${args.heatmap.std.toFixed(1)} dB across seating`]);
  }
  if (perf.length === 0) {
    para('Run the simulation before generating the proposal to include predicted performance.');
  } else {
    doc.setFontSize(10);
    for (const [label, value, note] of perf) {
      pageBreakIf(20);
      doc.setFont('helvetica', 'bold'); setColor(INK);
      doc.text(label, MARGIN, y);
      doc.setFont('helvetica', 'normal'); setColor(DEEP);
      doc.text(value, MARGIN + 220, y);
      setColor(GRAY);
      doc.text(note, MARGIN + 300, y);
      y += 18;
    }
    y += 10;
    doc.setFontSize(10.5); setColor(INK);
  }

  // Scope of work
  heading('Scope of Work');
  const cats = new Set(args.equipment.map(e => e.category));
  const scope: string[] = [];
  if (cats.has('audio-speaker') || cats.has('audio-signal'))
    scope.push('Supply, rig, and commission the loudspeaker system; calibrate levels, delay, and EQ to the room.');
  if (cats.has('video'))
    scope.push('Install and align video displays / projection, including signal distribution.');
  if (cats.has('lighting'))
    scope.push('Hang, circuit, and focus the lighting rig; program base looks.');
  if (cats.has('acoustic'))
    scope.push('Install acoustic treatment per the placement plan to meet the predicted reverberation target.');
  if (cats.has('infrastructure'))
    scope.push('Provide rigging, racks, and power infrastructure as itemized.');
  scope.push('Provide as-built documentation and operator orientation on completion.');
  for (const s of scope) {
    pageBreakIf(18);
    doc.setFillColor(ROYAL[0], ROYAL[1], ROYAL[2]);
    doc.circle(MARGIN + 3, y - 3.5, 2, 'F');
    const lines = doc.splitTextToSize(s, CONTENT_W - 16);
    doc.text(lines, MARGIN + 14, y);
    y += lines.length * 14 + 6;
  }
  y += 6;

  // ---------- Investment ----------
  pageBreakIf(140);
  heading('Investment');
  const rows = buildRows(args.equipment, args.adjustPct);

  const colQty = MARGIN, colItem = MARGIN + 36, colUnit = MARGIN + 360, colTotal = MARGIN + 440;
  const tableHeader = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setColor(GRAY);
    doc.text('QTY', colQty, y);
    doc.text('ITEM', colItem, y);
    doc.text('UNIT', colUnit, y, { align: 'right' } as any);
    doc.text('TOTAL', colTotal + 50, y, { align: 'right' } as any);
    y += 6;
    doc.setDrawColor(200, 204, 210);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setColor(INK);
  };

  let currentCat = '';
  tableHeader();
  for (const row of rows) {
    pageBreakIf(40);
    if (row.category !== currentCat) {
      currentCat = row.category;
      pageBreakIf(40);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); setColor(DEEP);
      doc.text(CATEGORY_LABEL[row.category] ?? row.category, MARGIN, y);
      y += 16;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setColor(INK);
    }
    doc.text(String(row.qty), colQty + 6, y);
    const label = `${row.brand !== 'Custom' ? row.brand + ' — ' : ''}${row.label}`;
    doc.text(doc.splitTextToSize(label, 300)[0], colItem, y);
    doc.text(row.unit ? money(row.unit) : '—', colUnit, y, { align: 'right' } as any);
    doc.text(row.total ? money(row.total) : '—', colTotal + 50, y, { align: 'right' } as any);
    y += 15;
  }

  const equipSubtotal = rows.reduce((s, rw) => s + rw.total, 0);
  const labor = Math.round(equipSubtotal * args.laborPct / 100);
  const taxable = equipSubtotal + labor;
  const tax = Math.round(taxable * args.taxPct / 100);
  const total = taxable + tax;

  y += 4;
  doc.setDrawColor(200, 204, 210);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 16;
  const totalRow = (label: string, value: string, bold = false, accent = false) => {
    pageBreakIf(20);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 12 : 10);
    if (accent) setColor(DEEP); else setColor(INK);
    doc.text(label, colUnit - 80, y, { align: 'right' } as any);
    doc.text(value, colTotal + 50, y, { align: 'right' } as any);
    y += bold ? 22 : 17;
  };
  totalRow('Equipment subtotal', money(equipSubtotal));
  totalRow(`Installation & labor (${args.laborPct}%)`, money(labor));
  if (args.taxPct > 0) totalRow(`Tax (${args.taxPct}%)`, money(tax));
  totalRow('Total investment', money(total), true, true);

  // ---------- Exhibit: coverage map ----------
  if (args.heatmapImage?.dataUrl) {
    doc.addPage();
    y = MARGIN;
    heading('Exhibit — Predicted Coverage');
    para('SPL coverage across the seating area, predicted for the proposed system in this room.');
    const img = args.heatmapImage;
    const maxW = CONTENT_W;
    const maxH = PAGE_H - y - MARGIN - 20;
    const k2 = Math.min(maxW / img.width, maxH / img.height);
    const drawW = img.width * k2, drawH = img.height * k2;
    try {
      doc.addImage(img.dataUrl, 'PNG', MARGIN + (CONTENT_W - drawW) / 2, y, drawW, drawH);
      y += drawH + 16;
    } catch { /* image decode failed — skip the exhibit rather than abort */ }
  }

  // ---------- Terms ----------
  pageBreakIf(180);
  heading('Terms & Next Steps');
  para(args.terms);

  pageBreakIf(90);
  y += 20;
  doc.setDrawColor(120, 126, 134);
  doc.line(MARGIN, y, MARGIN + 200, y);
  doc.line(MARGIN + 260, y, MARGIN + 460, y);
  y += 12;
  doc.setFontSize(9); setColor(GRAY);
  doc.text('Client signature / date', MARGIN, y);
  doc.text(`${args.meta.consultantName || 'Beacon AVL'} / date`, MARGIN + 260, y);

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8); setColor(GRAY);
    doc.text(`Beacon AVL · ${args.meta.name} · Page ${i} of ${pages}`, PAGE_W / 2, PAGE_H - 24, { align: 'center' } as any);
  }

  doc.save(filename);
}

import { jsPDF } from 'jspdf';
import { saveAs } from 'file-saver';
import type { EquipmentItem, RoomState, RT60Result, HeatmapData, ProjectMeta, Recommendation } from '../types';
import { roomVolumeFt3, totalSurfaceAreaFt2 } from '../engine/acoustics';

interface PDFArgs {
  meta: ProjectMeta;
  room: RoomState;
  equipment: EquipmentItem[];
  rt60: RT60Result | null;
  heatmap: HeatmapData | null;
  sti: number | null;
  recommendations: Recommendation[];
  heatmapImage?: { dataUrl: string; width: number; height: number } | null;
}

/**
 * Rasterize an SVG element to a PNG data URL by serializing → blob → image → canvas.
 * Returns null on failure (e.g., tainted images).
 */
export async function captureSvgAsPng(svg: SVGSVGElement, scale = 2): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const w = svg.clientWidth || 1200;
    const h = svg.clientHeight || 800;
    const xml = new XMLSerializer().serializeToString(svg);
    const xmlnsed = xml.startsWith('<svg ') && !/xmlns=/.test(xml)
      ? xml.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
      : xml;
    // Strip <foreignObject> trees — their HTML content depends on the document
    // stylesheet which isn't available inside the standalone SVG. Without this
    // the captured PNG shows unstyled label text floating over the heatmap.
    const cleaned = xmlnsed.replace(/<foreignObject[\s\S]*?<\/foreignObject>/g, '');
    const blob = new Blob([cleaned], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const result = await new Promise<{ dataUrl: string; width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w * scale;
        canvas.height = h * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) { URL.revokeObjectURL(url); reject(); return; }
        ctx.fillStyle = '#0B0E12';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        try {
          resolve({ dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(); };
      img.src = url;
    });
    return result;
  } catch {
    return null;
  }
}

const ROYAL = '#1A4FBF';
const AMBER = '#F5A623';
const NEAR  = '#12151A';

export function exportPDF(args: PDFArgs, filename = 'beacon-avl-report.pdf') {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  // ===== Cover page =====
  doc.setFillColor(NEAR); doc.rect(0, 0, w, h, 'F');
  // Diagonal amber accent
  doc.setFillColor(AMBER); doc.rect(0, h - 6, w, 6, 'F');

  doc.setFontSize(11);
  doc.setTextColor('#9BA3AF');
  doc.text('BEACON AVL · ROOM DESIGNER REPORT', 48, 60);

  doc.setFontSize(34);
  doc.setTextColor('#FFFFFF');
  doc.text(args.meta.name, 48, 130);

  doc.setFontSize(14);
  doc.setTextColor('#9BA3AF');
  doc.text(args.meta.clientName || 'Client', 48, 156);

  // Amber rule
  doc.setFillColor(AMBER); doc.rect(48, 178, 64, 4, 'F');

  doc.setFontSize(11);
  doc.setTextColor('#FFFFFF');
  doc.text(`Consultant: ${args.meta.consultantName}`, 48, h - 130);
  doc.text(`Generated: ${new Date(args.meta.updatedAt).toLocaleString()}`, 48, h - 112);
  doc.setTextColor('#F5A623');
  doc.text('leo@beaconavl.com  ·  (347) 218-0170', 48, h - 90);
  doc.setTextColor('#9BA3AF');
  doc.text('We are a training-first AVL partner.', 48, h - 72);

  // ===== Page 2 — Room summary =====
  doc.addPage();
  drawHeader(doc, w, args.meta.name, 'Room summary');

  const volume = roomVolumeFt3(args.room);
  const surfArea = totalSurfaceAreaFt2(args.room);
  const lines = [
    ['Width × Depth × Height', `${args.room.width.toFixed(1)} × ${args.room.depth.toFixed(1)} × ${args.room.height.toFixed(1)} ft`],
    ['Ceiling shape', (() => {
      const r = args.room;
      const parts: string[] = [r.ceilingShape];
      if (r.ceilingShape !== 'flat' && r.ceilingShape !== 'coffered') {
        if (r.peakHeight) parts.push(`peak ${r.peakHeight.toFixed(1)} ft`);
        if (r.ridgeAxis) parts.push(`ridge along ${r.ridgeAxis}`);
        if (typeof r.peakOffset === 'number' && r.peakOffset !== 0.5 && (r.ceilingShape === 'vaulted' || r.ceilingShape === 'sloped')) {
          parts.push(`offset ${(r.peakOffset * 100).toFixed(0)}%`);
        }
      }
      return parts.join(' · ');
    })()],
    ['Floor area', `${(args.room.width * args.room.depth).toFixed(0)} sq ft`],
    ['Volume', `${volume.toFixed(0)} ft³`],
    ['Total surface area', `${surfArea.toFixed(0)} sq ft`],
    ['Occupancy', `${args.room.occupancy} seats`],
    ['Room type', args.room.roomType],
  ];
  let y = 110;
  doc.setFontSize(11);
  for (const [k, v] of lines) {
    doc.setTextColor('#6B7280'); doc.text(k, 48, y);
    doc.setTextColor(NEAR); doc.text(String(v), 220, y);
    y += 18;
  }

  // ===== Page 3 — Equipment list =====
  doc.addPage();
  drawHeader(doc, w, args.meta.name, 'Equipment list');

  doc.setFontSize(10);
  doc.setTextColor('#6B7280');
  const headers = ['Item', 'Brand', 'Type', 'Position', 'Notes'];
  const colXs = [48, 200, 300, 400, 500];
  headers.forEach((hdr, i) => doc.text(hdr, colXs[i], 100));
  doc.setDrawColor('#E5E7EB');
  doc.line(48, 108, w - 48, 108);

  doc.setFontSize(9);
  doc.setTextColor(NEAR);
  let row = 124;
  for (const e of args.equipment) {
    if (row > h - 60) { doc.addPage(); drawHeader(doc, w, args.meta.name, 'Equipment list (cont.)'); row = 124; }
    doc.text(truncate(e.label, 26), colXs[0], row);
    doc.text(truncate(e.brand ?? '—', 14), colXs[1], row);
    doc.text(truncate(e.kind, 14), colXs[2], row);
    doc.text(`(${e.x.toFixed(1)}, ${e.y.toFixed(1)}, ${e.z.toFixed(1)})`, colXs[3], row);
    doc.text(`${e.aim ?? ''}${e.aim != null ? '°' : ''}${e.power ? ` ${e.power}W` : ''}`, colXs[4], row);
    row += 16;
  }

  // ===== Page — Heatmap snapshot =====
  if (args.heatmapImage) {
    doc.addPage();
    drawHeader(doc, w, args.meta.name, 'Coverage heatmap');
    const margin = 48;
    const maxW = w - margin * 2;
    const maxH = h - 200;
    try {
      const ratio = args.heatmapImage.height / args.heatmapImage.width;
      // Fit within both maxW and maxH, preserving aspect
      const drawWByWidth = maxW;
      const drawHByWidth = drawWByWidth * ratio;
      let drawW: number, drawH: number;
      if (drawHByWidth <= maxH) {
        drawW = drawWByWidth; drawH = drawHByWidth;
      } else {
        drawH = maxH; drawW = drawH / ratio;
      }
      const x = (w - drawW) / 2;
      const y = 110;
      doc.addImage(args.heatmapImage.dataUrl, 'PNG', x, y, drawW, drawH);
      doc.setFontSize(10); doc.setTextColor('#6B7280');
      doc.text('Iso view of the room with the active heatmap layer at capture time.', margin, y + drawH + 16);
    } catch { /* skip on failure */ }
  }

  // ===== Page — Acoustic results =====
  doc.addPage();
  drawHeader(doc, w, args.meta.name, 'Acoustic analysis');

  if (args.rt60) {
    doc.setFontSize(13);
    doc.setTextColor(NEAR);
    doc.text('RT60 by octave band', 48, 110);
    const bx = 48, by = 130, bw = w - 96, bh = 140;
    doc.setDrawColor('#E5E7EB'); doc.rect(bx, by, bw, bh);
    const bands = Object.entries(args.rt60.byBand).sort((a, b) => Number(a[0]) - Number(b[0]));
    const colW = bw / bands.length;
    const maxRT = Math.max(...bands.map(b => b[1]), 2.5);
    for (let i = 0; i < bands.length; i++) {
      const [hz, val] = bands[i];
      const barH = (val / maxRT) * (bh - 30);
      const cx = bx + i * colW + colW / 2;
      const color = val < 1.0 ? '#2F9E5E' : val < 1.5 ? AMBER : '#C53030';
      doc.setFillColor(color);
      doc.rect(cx - 16, by + bh - 20 - barH, 32, barH, 'F');
      doc.setFontSize(8); doc.setTextColor('#6B7280');
      doc.text(`${Number(hz) >= 1000 ? `${Number(hz)/1000}kHz` : `${hz}Hz`}`, cx - 12, by + bh - 6);
      doc.setFontSize(9); doc.setTextColor(NEAR);
      doc.text(val.toFixed(2) + 's', cx - 12, by + bh - 26 - barH);
    }
    doc.setFontSize(10); doc.setTextColor('#6B7280');
    doc.text(`Average RT60: ${args.rt60.average.toFixed(2)}s — ${args.rt60.rating}`, 48, 290);
  }

  // STI + heatmap stats
  let yy = 320;
  doc.setFontSize(13); doc.setTextColor(NEAR);
  doc.text('Coverage & intelligibility', 48, yy);
  yy += 22;
  doc.setFontSize(10);
  if (args.heatmap) {
    doc.setTextColor('#6B7280'); doc.text('Avg SPL', 48, yy);
    doc.setTextColor(NEAR); doc.text(`${args.heatmap.avg.toFixed(1)} dB`, 200, yy); yy += 16;
    doc.setTextColor('#6B7280'); doc.text('Min / Max', 48, yy);
    doc.setTextColor(NEAR); doc.text(`${args.heatmap.min.toFixed(1)} / ${args.heatmap.max.toFixed(1)} dB`, 200, yy); yy += 16;
    doc.setTextColor('#6B7280'); doc.text('Variance (1σ)', 48, yy);
    doc.setTextColor(NEAR); doc.text(`±${args.heatmap.std.toFixed(1)} dB`, 200, yy); yy += 16;
  }
  if (args.sti != null) {
    doc.setTextColor('#6B7280'); doc.text('STI estimate', 48, yy);
    doc.setTextColor(NEAR); doc.text(args.sti.toFixed(2), 200, yy); yy += 22;
  }

  // Recommendations
  if (args.recommendations.length) {
    if (yy > h - 200) { doc.addPage(); drawHeader(doc, w, args.meta.name, 'Recommendations'); yy = 110; }
    doc.setFontSize(13); doc.setTextColor(NEAR);
    doc.text('Recommendations', 48, yy); yy += 18;
    doc.setFontSize(9);
    for (const r of args.recommendations) {
      if (yy > h - 80) { doc.addPage(); drawHeader(doc, w, args.meta.name, 'Recommendations (cont.)'); yy = 110; }
      const color = r.severity === 'warn' ? AMBER : r.severity === 'ok' ? '#2F9E5E' : '#2E87F5';
      doc.setFillColor(color); doc.rect(48, yy - 10, 3, 24, 'F');
      doc.setTextColor(NEAR); doc.text(r.title, 60, yy);
      doc.setTextColor('#6B7280');
      const split = doc.splitTextToSize(r.detail, w - 110);
      doc.text(split, 60, yy + 12);
      yy += 16 + split.length * 11 + 4;
    }
  }

  // Footer on each page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    if (i > 1) drawFooter(doc, w, h, i, pageCount, args.meta);
  }

  doc.save(filename);
}

function drawHeader(doc: jsPDF, w: number, project: string, section: string) {
  doc.setDrawColor('#E5E7EB');
  doc.line(48, 70, w - 48, 70);
  doc.setFontSize(9); doc.setTextColor('#6B7280');
  doc.text('BEACON AVL', 48, 56);
  doc.setTextColor(ROYAL);
  doc.text(project, w - 48, 56, { align: 'right' });
  doc.setFontSize(20); doc.setTextColor(NEAR);
  doc.text(section, 48, 92);
  doc.setFillColor(AMBER); doc.rect(48, 100, 36, 3, 'F');
}

function drawFooter(doc: jsPDF, w: number, h: number, p: number, total: number, meta: ProjectMeta) {
  doc.setFontSize(9); doc.setTextColor('#9CA3AF');
  doc.text(`leo@beaconavl.com  ·  (347) 218-0170  ·  ${meta.consultantName}`, 48, h - 30);
  doc.text(`${p} / ${total}`, w - 48, h - 30, { align: 'right' });
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

import { useMemo, useState } from 'react';
import { useStore } from '../../stores/useStore';
import { Icon } from '../Icon';
import { EQUIPMENT } from '../../constants/equipmentLibrary';

const DEFAULT_TERMS =
  'Pricing is valid for the period stated on the cover. A 50% deposit secures equipment and ' +
  'scheduling; the balance is due on substantial completion. Lead times on loudspeakers and ' +
  'video walls vary by manufacturer (typically 2–8 weeks). This proposal includes commissioning ' +
  'and operator orientation; ongoing training and service plans are available separately. ' +
  'Electrical circuits, structural backing, and conduit by others unless itemized above.';

/**
 * Client proposal options. The PDF builder itself (jsPDF) loads lazily on
 * Generate so opening this modal stays instant.
 */
export function ProposalModal() {
  const open = useStore(s => s.openModal === 'proposal');
  const setOpenModal = useStore(s => s.setOpenModal);
  const meta = useStore(s => s.meta);
  const room = useStore(s => s.room);
  const equipment = useStore(s => s.equipment);
  const rt60 = useStore(s => s.rt60);
  const sti = useStore(s => s.sti);
  const stiRating = useStore(s => s.stiRating);
  const heatmap = useStore(s => s.heatmap);
  const markProposalGenerated = useStore(s => s.markProposalGenerated);
  const setHint = useStore(s => s.setHint);

  const [laborPct, setLaborPct] = useState(30);
  const [adjustPct, setAdjustPct] = useState(0);
  const [taxPct, setTaxPct] = useState(0);
  const [validDays, setValidDays] = useState(30);
  const [terms, setTerms] = useState(DEFAULT_TERMS);
  const [includeExhibit, setIncludeExhibit] = useState(true);
  const [busy, setBusy] = useState(false);

  // Live total preview — same math as the PDF (equipment × adjust, + labor, + tax).
  const totals = useMemo(() => {
    let equip = 0;
    for (const item of equipment) {
      if (item.category === 'reference') continue;
      const t = EQUIPMENT.find(eq =>
        eq.kind === item.kind && eq.label === item.label && (!item.brand || eq.brand === item.brand));
      equip += t?.price ?? 0;
    }
    equip = Math.round(equip * (1 + adjustPct / 100));
    const labor = Math.round(equip * laborPct / 100);
    const tax = Math.round((equip + labor) * taxPct / 100);
    return { equip, labor, tax, total: equip + labor + tax };
  }, [equipment, laborPct, adjustPct, taxPct]);

  if (!open) return null;

  const money = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const slug = meta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'beacon';

  const generate = async () => {
    setBusy(true);
    try {
      const { exportProposalPDF } = await import('../../exporters/proposal');
      // Capture the live viewport as the coverage exhibit (reuses the
      // engineering report's SVG→PNG rasterizer; loads in the same lazy
      // jsPDF chunk moment, so no extra wait).
      let heatmapImage: { dataUrl: string; width: number; height: number } | null = null;
      if (includeExhibit && heatmap) {
        try {
          const { captureSvgAsPng } = await import('../../exporters/pdf');
          const svgEl = document.querySelector('.viewport-canvas svg') as SVGSVGElement | null;
          heatmapImage = svgEl ? await captureSvgAsPng(svgEl, 2) : null;
        } catch { heatmapImage = null; }
      }
      exportProposalPDF({
        meta, room, equipment, rt60, sti, stiRating, heatmap,
        laborPct, adjustPct, taxPct, validDays, terms, heatmapImage,
      }, `${slug}-proposal.pdf`);
      markProposalGenerated();
      setHint(`Proposal generated — ${money(totals.total)} total investment`);
      setOpenModal(null);
    } finally {
      setBusy(false);
    }
  };

  const numField = (label: string, value: number, set: (n: number) => void, suffix: string, min = -50, max = 200) => (
    <div className="field-row" style={{ gridTemplateColumns: '150px 1fr 40px' }}>
      <label>{label}</label>
      <input type="number" value={value} min={min} max={max}
        onChange={e => set(Math.max(min, Math.min(max, parseFloat(e.target.value) || 0)))}/>
      <span className="muted" style={{ fontSize: 12 }}>{suffix}</span>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={() => setOpenModal(null)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <div>
            <h2>Generate client proposal</h2>
            <div className="sub">Branded PDF — overview, predicted performance, scope, investment, terms.</div>
          </div>
          <button className="icon-close" onClick={() => setOpenModal(null)}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          {numField('Installation & labor', laborPct, setLaborPct, '%', 0)}
          {numField('Price adjustment', adjustPct, setAdjustPct, '%')}
          {numField('Sales tax', taxPct, setTaxPct, '%', 0)}
          {numField('Valid for', validDays, setValidDays, 'days', 1, 365)}

          <div className="field-row" style={{ gridTemplateColumns: '150px 1fr' }}>
            <label>Coverage exhibit</label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={includeExhibit} onChange={e => setIncludeExhibit(e.target.checked)}/>
              Include a snapshot of the coverage map as an exhibit page
            </label>
          </div>

          <div className="section-label" style={{ marginTop: 14 }}>Terms &amp; conditions</div>
          <textarea
            value={terms}
            onChange={e => setTerms(e.target.value)}
            rows={5}
            style={{
              width: '100%', resize: 'vertical', fontSize: 12, lineHeight: 1.5,
              background: 'var(--bg-alt)', color: 'var(--fg1)',
              border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px',
              fontFamily: 'var(--font-body)',
            }}/>

          {/* Live totals preview */}
          <div style={{
            marginTop: 14, padding: 12, borderRadius: 8,
            background: 'var(--bg-alt)', border: '1px solid var(--border)',
            display: 'flex', gap: 20, flexWrap: 'wrap',
          }}>
            <div><div className="muted" style={{ fontSize: 10.5 }}>EQUIPMENT</div><b className="tabular">{money(totals.equip)}</b></div>
            <div><div className="muted" style={{ fontSize: 10.5 }}>LABOR</div><b className="tabular">{money(totals.labor)}</b></div>
            {taxPct > 0 && <div><div className="muted" style={{ fontSize: 10.5 }}>TAX</div><b className="tabular">{money(totals.tax)}</b></div>}
            <div style={{ marginLeft: 'auto' }}>
              <div className="muted" style={{ fontSize: 10.5 }}>TOTAL INVESTMENT</div>
              <b className="tabular" style={{ fontSize: 18, color: 'var(--royal-blue)' }}>{money(totals.total)}</b>
            </div>
          </div>
          {totals.equip === 0 && (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 8, color: '#F5A623' }}>
              No priced equipment placed yet — the investment table will be empty.
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setOpenModal(null)}>Cancel</button>
          <button className="btn btn-cta" onClick={generate} disabled={busy}>
            <Icon name="download" size={14}/> {busy ? 'Generating…' : 'Generate proposal PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}

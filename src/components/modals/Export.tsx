import { useStore } from '../../stores/useStore';
import { Icon } from '../Icon';
// PDF export pulls in jspdf + html2canvas (~370 kB combined). Defer the
// import to the click handler so the Export modal itself is tiny and the
// PDF deps only load when the user actually clicks the PDF tile.
import { exportJSON, exportBavl, buildProjectFile } from '../../exporters/json';
import { exportCSV } from '../../exporters/csv';
import { exportDXF } from '../../exporters/dxf';

export function ExportModal() {
  const open = useStore(s => s.openModal === 'export');
  const setOpenModal = useStore(s => s.setOpenModal);
  const state = useStore(s => s);

  if (!open) return null;

  const file = buildProjectFile(state);

  const tiles: { name: string; sub: string; icon: string; onClick: () => void }[] = [
    { name: 'Client Proposal', sub: 'Sales-ready PDF · overview, predicted performance, scope of work, investment & terms', icon: 'bag',
      onClick: () => setOpenModal('proposal')
    },
    { name: 'PDF Report', sub: 'Beacon AVL branded · cover, equipment list, RT60, heatmap, recommendations', icon: 'download',
      onClick: async () => {
        // Lazy-load the PDF exporter on demand. jspdf + html2canvas are
        // ~370 kB combined; deferring to click means the Export modal
        // doesn't drag them in for users who only need CSV / DXF.
        const { exportPDF, captureSvgAsPng } = await import('../../exporters/pdf');
        const svgEl = document.querySelector('.viewport-canvas svg') as SVGSVGElement | null;
        const heatmapImage = svgEl ? await captureSvgAsPng(svgEl, 2) : null;
        exportPDF({
          meta: state.meta, room: state.room, equipment: state.equipment,
          rt60: state.rt60, heatmap: state.heatmap, sti: state.sti,
          recommendations: state.recommendations,
          heatmapImage,
        }, `${slugify(state.meta.name)}-report.pdf`);
      }
    },
    { name: 'DXF (AutoCAD)', sub: 'Layered DXF — walls, equipment, coverage cones, references', icon: 'cube',
      onClick: () => exportDXF(state.room, state.equipment, `${slugify(state.meta.name)}.dxf`)
    },
    { name: 'JSON (EASE-compatible)', sub: 'Full project structure for downstream tools', icon: 'share',
      onClick: () => exportJSON(file, `${slugify(state.meta.name)}.json`)
    },
    { name: 'CSV (equipment list)', sub: 'Spreadsheet-ready table with positions and specs', icon: 'panel',
      onClick: () => exportCSV(state.equipment, `${slugify(state.meta.name)}-equipment.csv`)
    },
    { name: 'Project file (.bavl)', sub: 'Round-trippable Beacon AVL project file', icon: 'save',
      onClick: () => exportBavl(file, `${slugify(state.meta.name)}.bavl`)
    },
  ];

  return (
    <div className="modal-backdrop" onClick={() => setOpenModal(null)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Export & share</h2>
            <div className="sub">Choose how to deliver this design.</div>
          </div>
          <button className="icon-close" onClick={() => setOpenModal(null)}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {tiles.map(t => (
              <button key={t.name} className="template-tile"
                onClick={() => { setOpenModal(null); t.onClick(); }}
                style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 10, flexShrink: 0,
                  background: 'rgba(26,79,191,.10)', color: '#1A4FBF',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon name={t.icon} size={22}/>
                </div>
                <div style={{ minWidth: 0 }}>
                  <h4 style={{ margin: 0 }}>{t.name}</h4>
                  <div className="specs" style={{ marginTop: 2 }}>{t.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setOpenModal(null)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'beacon-room';
}

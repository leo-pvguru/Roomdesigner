import { useRef } from 'react';
import { useStore } from '../../stores/useStore';
import { TEMPLATES } from '../../templates';
import { importProjectFile } from '../../exporters/json';
import { pickRoomScanFile, importRoomPlanFile, scanSummary } from '../../importers/roomplan';
import { Icon, BeaconLogo } from '../Icon';

export function WelcomeModal() {
  const open = useStore(s => s.openModal === 'welcome');
  const setOpenModal = useStore(s => s.setOpenModal);
  const applyTemplate = useStore(s => s.applyTemplate);
  const loadProject = useStore(s => s.loadProject);
  const applyScannedRoom = useStore(s => s.applyScannedRoom);
  const setHint = useStore(s => s.setHint);
  const fileRef = useRef<HTMLInputElement>(null);

  const onImportScan = async () => {
    const f = await pickRoomScanFile();
    if (!f) return;
    try {
      const scan = await importRoomPlanFile(f);
      applyScannedRoom(scan);
      setHint(scanSummary(scan));
    } catch (err) {
      setHint(`⚠ ${err instanceof Error ? err.message : 'Could not import that scan.'}`);
    }
  };

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={() => setOpenModal(null)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 880 }}>
        <div className="modal-header">
          <div className="row" style={{ gap: 14 }}>
            <BeaconLogo size={40}/>
            <div>
              <h2>Welcome to Room Designer</h2>
              <div className="sub">Pick a starting template, open a project, or design from scratch.</div>
            </div>
          </div>
          <button className="icon-close" onClick={() => setOpenModal(null)}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {TEMPLATES.map(t => (
              <button key={t.id} className="template-tile" onClick={() => applyTemplate(t.id)}>
                <h4>{t.name}</h4>
                <div className="specs">{t.description}</div>
                <div className="preview">
                  <svg viewBox="0 0 200 80" style={{ width: '100%', height: '100%' }}>
                    <polygon points="20,60 180,60 180,30 20,30" fill="rgba(46,135,245,.2)" stroke="rgba(46,135,245,.6)" strokeWidth="1"/>
                    <rect x="60" y="35" width="80" height="6" fill="rgba(245,166,35,.6)"/>
                    <circle cx="50" cy="42" r="3" fill="#1A4FBF"/>
                    <circle cx="150" cy="42" r="3" fill="#1A4FBF"/>
                    <circle cx="100" cy="42" r="2" fill="#F5A623"/>
                  </svg>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <input
            ref={fileRef} type="file" accept=".json,.bavl"
            style={{ display: 'none' }}
            onChange={async e => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const proj = await importProjectFile(f);
                loadProject(proj);
              } catch (err) {
                setHint(`⚠ ${err instanceof Error ? err.message : 'Could not open project file.'}`);
              }
            }}
          />
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={14}/> Open project file
          </button>
          <button className="btn btn-ghost" onClick={onImportScan}
            title="Import a phone LiDAR scan (Apple RoomPlan JSON export) as your room">
            <Icon name="iphone" size={14}/> Import room scan
          </button>
          <button className="btn btn-secondary" onClick={() => setOpenModal(null)}>Continue with current room</button>
        </div>
      </div>
    </div>
  );
}

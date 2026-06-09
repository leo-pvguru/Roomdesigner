import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../stores/useStore';
import { Icon, BeaconLogo } from '../Icon';
import { importProjectFile } from '../../exporters/json';
import { pickRoomScanFile, importRoomPlanFile, scanSummary } from '../../importers/roomplan';

export function TopBar() {
  const meta = useStore(s => s.meta);
  const isDirty = useStore(s => s.isDirty);
  const activeAppTab = useStore(s => s.activeAppTab);
  const setActiveAppTab = useStore(s => s.setActiveAppTab);
  const setOpenModal = useStore(s => s.setOpenModal);
  const setInspectorTab = useStore(s => s.setInspectorTab);
  const undo = useStore(s => s.undo);
  const redo = useStore(s => s.redo);
  const canUndo = useStore(s => s.canUndo());
  const canRedo = useStore(s => s.canRedo());
  const setPresentationMode = useStore(s => s.setPresentationMode);
  const loadProject = useStore(s => s.loadProject);
  const uiMode = useStore(s => s.uiMode);
  const setUiMode = useStore(s => s.setUiMode);
  const applyScannedRoom = useStore(s => s.applyScannedRoom);
  const setHint = useStore(s => s.setHint);

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const fileBtnRef = useRef<HTMLButtonElement | null>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const [fileMenuPos, setFileMenuPos] = useState<{ top: number; right: number } | null>(null);

  // Re-anchor the menu to the button whenever it opens or the window resizes.
  useEffect(() => {
    if (!fileMenuOpen) { setFileMenuPos(null); return; }
    const reposition = () => {
      const r = fileBtnRef.current?.getBoundingClientRect();
      if (!r) return;
      setFileMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    };
    reposition();
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [fileMenuOpen]);

  // Close the file menu on outside-click or Escape.
  useEffect(() => {
    if (!fileMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (fileBtnRef.current?.contains(t)) return;
      if (fileMenuRef.current?.contains(t)) return;
      setFileMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFileMenuOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [fileMenuOpen]);

  const onOpen = () => fileInputRef.current?.click();
  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const proj = await importProjectFile(f);
      loadProject(proj);
    } catch (err) {
      setHint(`⚠ ${err instanceof Error ? err.message : 'Could not open project file.'}`);
    } finally {
      // allow re-selecting the same file
      e.target.value = '';
    }
  };

  return (
    <div className="appbar">
      <div className="appbar-section brand-lockup">
        <BeaconLogo size={28}/>
        <span className="wordmark">BEACON AVL</span>
        <div className="appbar-divider"/>
      </div>

      <div className="appbar-section project-title">
        <div className="crumb">{meta.clientName || 'Beacon AVL'} · v{meta.version}{isDirty && ' · unsaved'}</div>
        <div className="title">
          {meta.name}
          <span className="scan-tag">Live</span>
        </div>
      </div>

      <div className="appbar-section grow" style={{ justifyContent: 'center' }}>
        <div className="tabs">
          {([
            ['design',    'Design',     'cube'],
            ['acoustics', 'Acoustics',  'heatmap'],
            ['bom',       'BOM & Quote','bag'],
            ['present',   'Present',    'presentation'],
          ] as const).map(([id, label, icon]) => (
            <button key={id}
              className={`tab ${activeAppTab === id ? 'active' : ''}`}
              onClick={() => {
                setActiveAppTab(id);
                if (id === 'present') {
                  setPresentationMode(true);
                  return;
                }
                setPresentationMode(false);
                if (id === 'acoustics') setInspectorTab('acoustics');
                else if (id === 'design') setInspectorTab('properties');
                else if (id === 'bom') setOpenModal('bom');
              }}>
              <Icon name={icon} size={14}/>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="appbar-section" style={{ gap: 8 }}>
        {/* Simple/Pro mode — progressive disclosure. Simple hides expert
            physics parameters behind defaults; Pro shows everything. */}
        <div style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--bg-alt)', borderRadius: 999 }}
          title="Simple hides advanced physics controls behind sensible defaults. Pro shows every parameter.">
          {(['simple', 'pro'] as const).map(m => (
            <button key={m} onClick={() => setUiMode(m)}
              style={{
                fontFamily: 'Montserrat', fontWeight: 700, fontSize: 10,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                padding: '3px 10px', borderRadius: 999, border: 0,
                background: uiMode === m ? 'var(--royal-blue)' : 'transparent',
                color: uiMode === m ? '#fff' : 'var(--fg2)',
                cursor: 'pointer',
              }}>{m}</button>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" title="Command palette"
          onClick={() => {
            const ev = new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true });
            window.dispatchEvent(ev);
          }}
          style={{ height: 30, padding: '0 10px', gap: 8, color: 'var(--fg2)' }}>
          <Icon name="search" size={13}/>
          <span style={{ fontSize: 12 }}>Quick actions</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, background: 'var(--bg-alt)', padding: '1px 5px', borderRadius: 3 }}>⌘K</span>
        </button>
        <button className="btn btn-ghost btn-icon" title="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
          <Icon name="undo" size={16}/>
        </button>
        <button className="btn btn-ghost btn-icon" title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}>
          <Icon name="redo" size={16}/>
        </button>
        <input
          ref={fileInputRef} type="file" accept=".json,.bavl"
          style={{ display: 'none' }} onChange={onFileChosen}/>
        <button ref={fileBtnRef}
          className="btn btn-secondary"
          onClick={() => setFileMenuOpen(o => !o)}
          title="File menu">
          File
          <Icon name="chevD" size={12}/>
        </button>
      </div>

      {fileMenuOpen && fileMenuPos && createPortal(
        <div ref={fileMenuRef}
          style={{
            position: 'fixed', top: fileMenuPos.top, right: fileMenuPos.right,
            minWidth: 200,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
            padding: 6,
            zIndex: 200,
          }}>
          <FileMenuItem icon="plus" label="New project"
            onClick={() => { setFileMenuOpen(false); setOpenModal('new-project'); }}/>
          <FileMenuItem icon="folderOpen" label="Open…" hint=".bavl, .json"
            onClick={() => { setFileMenuOpen(false); onOpen(); }}/>
          <FileMenuItem icon="iphone" label="Import room scan…" hint="RoomPlan .json"
            onClick={() => { setFileMenuOpen(false); onImportScan(); }}/>
          <FileMenuItem icon="share" label="Share"
            onClick={() => { setFileMenuOpen(false); setOpenModal('share'); }}/>
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }}/>
          <FileMenuItem icon="download" label="Export…" highlight
            onClick={() => { setFileMenuOpen(false); setOpenModal('export'); }}/>
        </div>,
        document.body
      )}
    </div>
  );
}

function FileMenuItem({ icon, label, hint, highlight, onClick }: {
  icon: string; label: string; hint?: string; highlight?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '8px 10px',
        background: 'transparent', border: 0, borderRadius: 6,
        cursor: 'pointer', textAlign: 'left',
        color: highlight ? 'var(--royal-blue)' : 'var(--fg1)',
        fontFamily: 'Open Sans', fontSize: 13,
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-alt)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
      <span style={{ width: 14 }}><Icon name={icon} size={14}/></span>
      <span style={{ flex: 1, fontWeight: highlight ? 600 : 400 }}>{label}</span>
      {hint && <span style={{ fontSize: 11, color: 'var(--fg3)' }}>{hint}</span>}
    </button>
  );
}

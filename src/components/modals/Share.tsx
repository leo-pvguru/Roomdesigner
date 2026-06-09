import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../stores/useStore';
import { Icon } from '../Icon';
import { buildProjectFile, buildShareLink } from '../../exporters/json';

export function ShareModal() {
  const open = useStore(s => s.openModal === 'share');
  const setOpenModal = useStore(s => s.setOpenModal);
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  // Track the "Copied" pulse timer so we can cancel it if the modal closes
  // (or React unmounts) before the pulse expires — otherwise setCopied fires
  // on an unmounted component and React warns.
  const copiedTimer = useRef<number | null>(null);
  // Debounce timer for share-link rebuild. The link is a base64 of the
  // entire project; rebuilding on every keystroke is expensive and useless
  // (the user only sees the result once per open). 300 ms is well under
  // human reaction time but coalesces bursts of edits.
  const rebuildTimer = useRef<number | null>(null);

  // Rebuild the share link on open, and again — debounced — on every store
  // change while the modal is open. Subscribing to the store directly (vs
  // including `state` in deps) avoids tying the modal's render cycle to
  // every store mutation in the rest of the app.
  useEffect(() => {
    if (!open) return;
    const rebuild = () => {
      const snapshot = useStore.getState();
      setLink(buildShareLink(buildProjectFile(snapshot)));
    };
    rebuild(); // immediate on open

    const unsub = useStore.subscribe(() => {
      if (rebuildTimer.current !== null) clearTimeout(rebuildTimer.current);
      rebuildTimer.current = window.setTimeout(() => {
        rebuild();
        rebuildTimer.current = null;
      }, 300);
    });

    return () => {
      unsub();
      if (rebuildTimer.current !== null) {
        clearTimeout(rebuildTimer.current);
        rebuildTimer.current = null;
      }
    };
  }, [open]);

  // Cancel any in-flight "Copied" timer when the component unmounts.
  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) {
        clearTimeout(copiedTimer.current);
        copiedTimer.current = null;
      }
    };
  }, []);

  if (!open) return null;

  const flashCopied = () => {
    setCopied(true);
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => {
      setCopied(false);
      copiedTimer.current = null;
    }, 1500);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      flashCopied();
    } catch {
      const el = document.getElementById('share-input') as HTMLInputElement | null;
      el?.select();
      document.execCommand('copy');
      flashCopied();
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpenModal(null)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <div>
            <h2>Share this design</h2>
            <div className="sub">Anyone with this link can load the design — no backend required.</div>
          </div>
          <button className="icon-close" onClick={() => setOpenModal(null)}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <div className="row" style={{ gap: 8 }}>
            <input
              id="share-input"
              className="text-input" readOnly value={link}
              style={{
                flex: 1,
                background: 'var(--bg-alt)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 12,
              }}/>
            <button className="btn btn-primary" onClick={copy}>
              <Icon name="copy" size={14}/> {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
            The link is base64-encoded directly into the URL. Long projects with many items can produce very long links.
            For large designs, prefer exporting a .bavl project file.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setOpenModal(null)}>Done</button>
        </div>
      </div>
    </div>
  );
}

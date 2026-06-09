import React from 'react';
import { BeaconLogo } from './Icon';

// Keep in sync with App.tsx — referenced here so the recovery UI can clear a
// poisoned autosave that would otherwise re-crash on every reload.
const AUTOSAVE_KEY = 'beacon.autosave.v1';

interface Props {
  children: React.ReactNode;
}
interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level error boundary. A render-time exception anywhere in the tree
 * would otherwise blank the page to white with no recovery path. This
 * catches it and shows a branded screen with two escape hatches:
 *
 *   • Reload — re-runs the app (recovers from transient/render-order bugs).
 *   • Reset & reload — also clears the autosave first, in case a corrupt
 *     autosaved project is what's crashing on restore (otherwise reload
 *     would just re-trigger the same crash in a loop).
 *
 * The raw error + component stack are shown in a collapsible block so a
 * support email can include something actionable.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface for debugging — in production this is the only breadcrumb.
    if (typeof console !== 'undefined') {
      console.error('Render crash caught by ErrorBoundary:', error, info.componentStack);
    }
  }

  private reload = () => {
    window.location.reload();
  };

  private resetAndReload = () => {
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
    // Also drop the share hash so a bad #bavl= link doesn't reload us into
    // the same crash.
    try { window.location.hash = ''; } catch { /* ignore */ }
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        position: 'fixed', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0E1116', color: '#E6E9EE',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        padding: 24,
      }}>
        <div style={{ maxWidth: 520, width: '100%', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
            <BeaconLogo size={48} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 8px', fontFamily: 'Montserrat, sans-serif' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: 'rgba(230,233,238,.7)', margin: '0 0 22px' }}>
            Room Designer hit an unexpected error and couldn't continue. Your last
            autosave is preserved — try reloading. If it keeps happening, reset
            (this clears the autosaved project) and start fresh.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 20 }}>
            <button
              onClick={this.reload}
              style={{
                padding: '10px 20px', borderRadius: 8, border: 0, cursor: 'pointer',
                background: '#1A4FBF', color: '#fff', fontWeight: 700, fontSize: 13,
                fontFamily: 'Montserrat, sans-serif',
              }}
            >
              Reload
            </button>
            <button
              onClick={this.resetAndReload}
              style={{
                padding: '10px 20px', borderRadius: 8, cursor: 'pointer',
                background: 'transparent', color: '#E6E9EE',
                border: '1px solid rgba(230,233,238,.25)', fontWeight: 600, fontSize: 13,
                fontFamily: 'Montserrat, sans-serif',
              }}
            >
              Reset &amp; reload
            </button>
          </div>
          {this.state.error && (
            <details style={{
              textAlign: 'left', background: 'rgba(255,255,255,.04)',
              border: '1px solid rgba(255,255,255,.08)', borderRadius: 8,
              padding: '10px 12px', fontSize: 12,
            }}>
              <summary style={{ cursor: 'pointer', color: 'rgba(230,233,238,.6)' }}>
                Error details
              </summary>
              <pre style={{
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                margin: '10px 0 0', color: '#F87171', fontSize: 11.5,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}>
                {this.state.error.name}: {this.state.error.message}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}

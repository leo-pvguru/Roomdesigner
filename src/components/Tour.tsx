import { useEffect, useState } from 'react';
import { useStore } from '../stores/useStore';
import { Icon } from './Icon';

const TOUR_KEY = 'beacon.tour.completed.v1';

interface Step {
  selector: string;
  title: string;
  body: string;
  side: 'right' | 'left' | 'top' | 'bottom' | 'center';
}

const STEPS: Step[] = [
  {
    selector: '.sidebar:not(.right)',
    title: 'Equipment library',
    body: 'Click an item to drop it at the room center, or drag it onto the canvas to place it exactly. Toggle "Placed" to see what you\'ve already added.',
    side: 'right',
  },
  {
    selector: '.viewport-canvas',
    title: 'The 3D room',
    body: 'Right-click drag to orbit. Hold Space + drag to pan. Wheel to zoom. The bottom-left legend toggles SPL / C50 / C80 / Time-of-arrival heatmaps.',
    side: 'top',
  },
  {
    selector: '.sidebar.right',
    title: 'Inspector',
    body: 'Properties of whatever is selected — or the room itself when nothing is. Find Compliance, Coverage zones, Speaker groups, and Scenarios in here.',
    side: 'left',
  },
  {
    selector: '.appbar',
    title: 'Quick actions — ⌘K',
    body: 'Press Cmd+K (or Ctrl+K) anywhere to find any action: switch view, place a speaker, run auto-treat, export a PDF. The keyboard is faster than the mouse.',
    side: 'bottom',
  },
];

export function Tour() {
  const [step, setStep] = useState<number | null>(null);
  const openModal = useStore(s => s.openModal);

  // Show after the welcome modal closes for the first time, and not before.
  useEffect(() => {
    if (openModal !== null) return;
    let seen = false;
    try { seen = localStorage.getItem(TOUR_KEY) === '1'; } catch { /* noop */ }
    if (!seen) {
      // Wait for layout to settle
      const t = window.setTimeout(() => setStep(0), 600);
      return () => clearTimeout(t);
    }
  }, [openModal]);

  // Esc to skip
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (step != null && e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  if (step == null) return null;
  const s = STEPS[step];
  const target = document.querySelector(s.selector) as HTMLElement | null;
  const rect = target?.getBoundingClientRect();
  const finish = () => {
    setStep(null);
    try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* noop */ }
  };
  const next = () => step < STEPS.length - 1 ? setStep(step + 1) : finish();
  const prev = () => step > 0 ? setStep(step - 1) : null;

  // Position the callout next to the highlight
  const popoverStyle: React.CSSProperties = (() => {
    if (!rect) return { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    const margin = 16;
    if (s.side === 'right')  return { position: 'fixed', top: rect.top + 24, left: rect.right + margin };
    if (s.side === 'left')   return { position: 'fixed', top: rect.top + 24, right: window.innerWidth - rect.left + margin };
    if (s.side === 'bottom') return { position: 'fixed', top: rect.bottom + margin, left: rect.left + 24 };
    if (s.side === 'top')    return { position: 'fixed', top: 100, left: '50%', transform: 'translateX(-50%)' };
    return { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  })();

  return (
    <>
      {/* Spotlight overlay — dim everything outside the highlighted region */}
      <svg style={{
        position: 'fixed', inset: 0, width: '100vw', height: '100vh',
        pointerEvents: 'none', zIndex: 199,
      }}>
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white"/>
            {rect && (
              <rect x={rect.left - 6} y={rect.top - 6}
                width={rect.width + 12} height={rect.height + 12}
                rx="12" fill="black"/>
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(18,21,26,.55)" mask="url(#tour-mask)"/>
        {rect && (
          <rect x={rect.left - 6} y={rect.top - 6}
            width={rect.width + 12} height={rect.height + 12}
            rx="12" fill="none" stroke="#F5A623" strokeWidth="2"/>
        )}
      </svg>

      <div style={{
        ...popoverStyle,
        zIndex: 201,
        width: 320,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-lg)',
        padding: 18,
        pointerEvents: 'auto',
      }}>
        <div style={{
          fontFamily: 'Montserrat', fontWeight: 700, fontSize: 10.5,
          letterSpacing: '0.14em', textTransform: 'uppercase',
          color: 'var(--royal-blue)', marginBottom: 4,
        }}>
          Tour · {step + 1} of {STEPS.length}
        </div>
        <h3 style={{
          margin: 0, fontFamily: 'Montserrat', fontWeight: 600, fontSize: 17,
          color: 'var(--fg1)', marginBottom: 8,
        }}>{s.title}</h3>
        <p style={{
          margin: 0, fontFamily: 'Open Sans', fontSize: 13,
          color: 'var(--fg2)', lineHeight: 1.5, marginBottom: 14,
        }}>{s.body}</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={finish} style={{
            background: 'transparent', border: 0, color: 'var(--fg3)',
            cursor: 'pointer', fontSize: 12, padding: '6px 0',
          }}>Skip tour</button>
          <div style={{ display: 'flex', gap: 6 }}>
            {step > 0 && (
              <button onClick={prev} className="btn btn-ghost btn-sm">Back</button>
            )}
            <button onClick={next} className="btn btn-cta btn-sm">
              {step === STEPS.length - 1 ? 'Got it' : 'Next'}
              <Icon name="chevR" size={12}/>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

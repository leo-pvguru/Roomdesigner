import { useMemo, useState } from 'react';
import { useStore } from '../../stores/useStore';
import { Icon } from '../Icon';
import { defaultTargetRT60, planTreatment, type TreatmentStrategy } from '../../engine/treatment';
import { rt60 as computeRt60Result } from '../../engine/acoustics';

/**
 * Auto-treatment options modal.
 *
 * Two knobs:
 *   • Target RT60 — slider with a sensible per-room-type default. The
 *     "Predicted" line is recomputed live as the user drags so they can
 *     see how aggressive the treatment will be before committing.
 *   • Strategy — reflections-only, RT60-only, or both. Default is "both",
 *     which places panels at first-order reflection points first, then
 *     adds ceiling clouds + corner traps until the target RT60 is met.
 *
 * The Apply button calls `autoTreatRoom(options)` which plans + commits in
 * one go. The modal closes and a status hint shows the predicted RT60 and
 * panel count. The user can still hit Cmd-Z if they're unhappy.
 */
export function AutoTreatModal() {
  const open = useStore(s => s.openModal === 'auto-treat');
  const setOpenModal = useStore(s => s.setOpenModal);
  const room = useStore(s => s.room);
  const zones = useStore(s => s.zones);
  const equipment = useStore(s => s.equipment);
  const autoTreatRoom = useStore(s => s.autoTreatRoom);
  const setHint = useStore(s => s.setHint);
  const clearTreatment = useStore(s => s.clearTreatment);

  const defaultTarget = defaultTargetRT60(room.roomType);
  const [target, setTarget] = useState(defaultTarget);
  const [strategy, setStrategy] = useState<TreatmentStrategy>('both');

  const speakers = useMemo(
    () => equipment.filter(e => e.category === 'audio-speaker'),
    [equipment],
  );
  const existingPanels = useMemo(
    () => equipment.filter(e => e.category === 'acoustic'),
    [equipment],
  );

  // Current room RT60 with whatever panels already exist — for the
  // "before" comparison.
  const currentRT60 = useMemo(() => {
    if (!open) return null;
    const r = computeRt60Result(room, existingPanels, zones, equipment, true);
    return (r.byBand[500] + r.byBand[1000]) / 2;
  }, [open, room, existingPanels, zones, equipment]);

  // Run the planner in dry-run mode (without committing) so we can show the
  // predicted RT60 + panel count for the chosen settings.
  const preview = useMemo(() => {
    if (!open) return null;
    return planTreatment(room, zones, speakers, equipment, {
      targetRT60: target,
      strategy,
    });
  }, [open, room, zones, speakers, equipment, target, strategy]);

  if (!open) return null;

  const apply = () => {
    const result = autoTreatRoom({ targetRT60: target, strategy });
    const hit = result.reachedTarget ? 'reached target' : 'best effort';
    setHint(
      `Auto-treat: +${result.panels.length} panels, RT60 ${result.predictedRT60.toFixed(2)}s (${hit})`,
    );
    setOpenModal(null);
  };

  const replace = () => {
    clearTreatment();
    // Re-run after the clear has applied. clearTreatment is sync, so this
    // is safe.
    const result = autoTreatRoom({ targetRT60: target, strategy });
    setHint(
      `Auto-treat: replaced — ${result.panels.length} panels, RT60 ${result.predictedRT60.toFixed(2)}s`,
    );
    setOpenModal(null);
  };

  const hasExisting = existingPanels.length > 0;
  const noSpeakers = speakers.length === 0;

  return (
    <div className="modal-backdrop" onClick={() => setOpenModal(null)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div>
            <h2>Auto-treat the room</h2>
            <div className="sub">
              Places acoustic panels at first-order reflection points and adds
              clouds / bass traps to hit a target RT60.
            </div>
          </div>
          <button className="icon-close" onClick={() => setOpenModal(null)}>
            <Icon name="x" size={16}/>
          </button>
        </div>
        <div className="modal-body">
          {/* ===== Target RT60 ===== */}
          <div className="section-label" style={{ marginBottom: 6 }}>Target RT60 (mid-band)</div>
          <div className="row" style={{ gap: 12, alignItems: 'center', marginBottom: 4 }}>
            <input
              type="range"
              min={0.4} max={2.5} step={0.05}
              value={target}
              onChange={e => setTarget(parseFloat(e.target.value))}
              style={{ flex: 1 }}
            />
            <span className="tabular" style={{ minWidth: 60, fontWeight: 700, fontSize: 14 }}>
              {target.toFixed(2)} s
            </span>
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            Default for {room.roomType}: {defaultTarget.toFixed(2)} s.
            {' '}Worship/sanctuary 1.4–1.8 s · multipurpose 1.0–1.4 s · speech-first ≤ 1.0 s.
          </div>

          {/* ===== Strategy ===== */}
          <div className="section-label" style={{ marginTop: 16, marginBottom: 6 }}>Strategy</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {([
              ['reflections', 'Reflections only',  'Treats only first-order reflection points off the side walls and ceiling. Good for studios + small rooms with clean speakers.'],
              ['rt60',        'RT60 target only',  'Ignores reflection geometry and adds ceiling clouds + corner bass traps until the target is met. Good when speakers are still being designed.'],
              ['both',        'Both (recommended)', 'Reflection points first, then iteratively add panels until target RT60. Best general result.'],
            ] as const).map(([id, label, blurb]) => (
              <button
                key={id}
                className="template-tile"
                onClick={() => setStrategy(id)}
                style={{
                  padding: 12,
                  textAlign: 'left',
                  borderColor: strategy === id ? 'var(--royal-blue)' : 'var(--border)',
                  boxShadow: strategy === id ? '0 0 0 2px rgba(26,79,191,.16)' : 'none',
                }}
                title={blurb}
              >
                <h4 style={{ margin: 0, fontSize: 12.5 }}>{label}</h4>
                <div className="specs" style={{ marginTop: 4, fontSize: 11 }}>{blurb}</div>
              </button>
            ))}
          </div>

          {/* ===== Live preview ===== */}
          <div style={{
            marginTop: 16,
            padding: 12,
            background: 'var(--bg-alt)',
            borderRadius: 8,
            border: '1px solid var(--border)',
          }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Current</div>
                <div className="tabular" style={{ fontSize: 18, fontWeight: 700 }}>
                  {currentRT60 != null ? `${currentRT60.toFixed(2)}s` : '—'}
                </div>
              </div>
              <Icon name="chevR" size={20} style={{ color: 'var(--fg3)', alignSelf: 'center' }}/>
              <div>
                <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Predicted after treatment</div>
                <div className="tabular" style={{
                  fontSize: 18, fontWeight: 700,
                  color: preview?.reachedTarget ? '#2F9E5E' : '#F5A623',
                }}>
                  {preview ? `${preview.predictedRT60.toFixed(2)}s` : '—'}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Panels added</div>
                <div className="tabular" style={{ fontSize: 18, fontWeight: 700 }}>
                  {preview?.panels.length ?? 0}
                </div>
              </div>
            </div>
            {preview && !preview.reachedTarget && (
              <div className="muted" style={{ fontSize: 11.5, marginTop: 8, color: '#F5A623' }}>
                Target unreachable with this room — capped at {preview.panels.length} panels.
                Consider a more absorptive ceiling material or a smaller target.
              </div>
            )}
            {noSpeakers && strategy !== 'rt60' && (
              <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                No speakers placed yet — reflection points will be skipped.
                The RT60 fitting pass still runs.
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setOpenModal(null)}>Cancel</button>
          {hasExisting && (
            <button className="btn btn-secondary" onClick={replace}>
              <Icon name="trash" size={14}/> Clear &amp; re-treat
            </button>
          )}
          <button className="btn btn-cta" onClick={apply}>
            <Icon name="panel2" size={14}/> Apply treatment
          </button>
        </div>
      </div>
    </div>
  );
}

import { useStore } from '../../stores/useStore';
import { Icon } from '../Icon';
import { speakerSPL, combinedSPL, getActiveSpeakers, applyGroupSettings } from '../../engine/acoustics';

const MS_PER_FT = 0.889;

export function SnapshotModal() {
  const open = useStore(s => s.openModal === 'snapshot');
  const setOpenModal = useStore(s => s.setOpenModal);
  const equipment = useStore(s => s.equipment);
  const groups = useStore(s => s.groups);
  const selectedId = useStore(s => s.selectedId);
  const noiseFloor = useStore(s => s.noiseFloor);

  if (!open) return null;
  const ref = selectedId ? equipment.find(e => e.id === selectedId) : null;
  if (!ref || ref.category !== 'reference') {
    return (
      <div className="modal-backdrop" onClick={() => setOpenModal(null)}>
        <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
          <div className="modal-header">
            <div><h2>Snapshot</h2></div>
            <button className="icon-close" onClick={() => setOpenModal(null)}><Icon name="x" size={16}/></button>
          </div>
          <div className="modal-body">
            <div className="muted">Select a reference point first.</div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setOpenModal(null)}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  const allSpeakers = equipment.filter(e => e.category === 'audio-speaker').map(s => applyGroupSettings(s, groups));
  const speakers = getActiveSpeakers(allSpeakers);

  // Per-speaker contributions and time-of-flight
  const contributions = speakers.map(sp => {
    const dx = ref.x - sp.x, dy = ref.y - sp.y, dz = ref.z - sp.z;
    const dFt = Math.sqrt(dx*dx + dy*dy + dz*dz);
    const tofMs = dFt / 1.125 + (sp.delayMs ?? 0);
    return { sp, dFt, tofMs, splByBand: bandSPLs(sp, ref) };
  }).sort((a, b) => a.tofMs - b.tofMs);

  // Per-band totals
  const bandKeys: ('125'|'1k'|'4k'|'broadband')[] = ['125', '1k', '4k', 'broadband'];
  const bandTotals = bandKeys.map(b => combinedSPL(contributions.map(c => c.splByBand[b]).filter(s => isFinite(s))));

  // Earliest arrival
  const earliest = contributions[0]?.tofMs ?? 0;
  const latest = contributions[contributions.length - 1]?.tofMs ?? 0;
  const haasIssue = (latest - earliest) > 30;

  // Total broadband SPL and direct/SNR estimate
  const totalBroadband = bandTotals[3];
  const snr = totalBroadband - noiseFloor;

  return (
    <div className="modal-backdrop" onClick={() => setOpenModal(null)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <div>
            <h2>{ref.label} — Snapshot</h2>
            <div className="sub">({ref.x.toFixed(1)}, {ref.y.toFixed(1)}, {ref.z.toFixed(1)} ft) · {speakers.length} active source{speakers.length !== 1 ? 's' : ''}</div>
          </div>
          <button className="icon-close" onClick={() => setOpenModal(null)}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="inspector-card">
              <h4 style={{ marginBottom: 8 }}>SPL by band</h4>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
                {bandTotals.map((v, i) => (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <span className="tabular" style={{ fontSize: 10.5, color: 'var(--fg2)' }}>{v.toFixed(1)}</span>
                    <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                      <div style={{
                        width: '100%',
                        background: 'var(--royal-blue)',
                        height: `${Math.max(2, ((v - 50) / 60) * 100)}%`,
                        borderRadius: '2px 2px 0 0',
                      }}/>
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--fg3)', fontFamily: 'Montserrat', fontWeight: 600 }}>
                      {bandKeys[i] === 'broadband' ? 'BB' : bandKeys[i]}
                    </span>
                  </div>
                ))}
              </div>
              <div className="row between" style={{ marginTop: 10, fontSize: 12, color: 'var(--fg2)' }}>
                <span>Broadband total</span>
                <strong className="tabular" style={{ color: 'var(--fg1)' }}>{totalBroadband.toFixed(1)} dB</strong>
              </div>
              <div className="row between" style={{ fontSize: 12, color: 'var(--fg2)' }}>
                <span>SNR (vs noise floor)</span>
                <strong className="tabular" style={{ color: snr >= 25 ? 'var(--success)' : snr >= 15 ? 'var(--amber-gold-700)' : '#A52A2A' }}>
                  {snr.toFixed(1)} dB
                </strong>
              </div>
            </div>

            <div className="inspector-card">
              <h4 style={{ marginBottom: 8 }}>Time-of-flight per source</h4>
              {contributions.length === 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>No active speakers.</div>
              ) : (
                <>
                  <div className="col" style={{ gap: 4, fontSize: 11.5 }}>
                    {contributions.map(c => {
                      const relMs = c.tofMs - earliest;
                      return (
                        <div key={c.sp.id} className="row between" style={{
                          padding: '4px 8px', background: 'var(--bg-alt)', borderRadius: 4,
                        }}>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.sp.label}
                          </span>
                          <span className="tabular muted" style={{ fontSize: 10.5, width: 70, textAlign: 'right' }}>
                            {c.dFt.toFixed(1)} ft
                          </span>
                          <span className="tabular" style={{ width: 70, textAlign: 'right' }}>
                            {c.tofMs.toFixed(1)} ms
                          </span>
                          <span className="tabular" style={{ width: 60, textAlign: 'right',
                            color: relMs > 30 ? '#A52A2A' : relMs > 15 ? '#B57600' : 'var(--fg2)' }}>
                            +{relMs.toFixed(1)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {haasIssue && (
                    <div style={{
                      marginTop: 10, padding: '8px 10px', borderRadius: 6,
                      background: 'rgba(245,166,35,.12)', borderLeft: '3px solid var(--amber-gold)',
                      fontSize: 11.5, color: 'var(--fg1)',
                    }}>
                      <strong>Haas warning:</strong> spread is {(latest - earliest).toFixed(1)} ms between
                      first and last arrival. Above 30 ms, late-arriving sources will pull image localization.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="inspector-card" style={{ marginTop: 14 }}>
            <h4 style={{ marginBottom: 8 }}>Per-source SPL contributions (broadband)</h4>
            <div className="col" style={{ gap: 3 }}>
              {contributions.length === 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>No active speakers.</div>
              ) : contributions.map(c => {
                const v = c.splByBand['broadband'];
                if (!isFinite(v)) return null;
                const pct = Math.max(0, Math.min(1, (v - 50) / 60));
                return (
                  <div key={c.sp.id} className="row" style={{ gap: 8, alignItems: 'center', fontSize: 11.5 }}>
                    <span style={{ width: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.sp.label}
                    </span>
                    <div style={{ flex: 1, height: 8, background: 'var(--bg-alt)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ width: `${pct * 100}%`, height: '100%', background: 'var(--royal-blue)' }}/>
                    </div>
                    <span className="tabular" style={{ width: 60, textAlign: 'right' }}>{v.toFixed(1)} dB</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setOpenModal(null)}>Close</button>
        </div>
      </div>
    </div>
  );
}

function bandSPLs(sp: any, ref: any): Record<string, number> {
  return {
    '125': speakerSPL(sp, ref, '125'),
    '1k':  speakerSPL(sp, ref, '1k'),
    '4k':  speakerSPL(sp, ref, '4k'),
    'broadband': speakerSPL(sp, ref, 'broadband'),
  };
}

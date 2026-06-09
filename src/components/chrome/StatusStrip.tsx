import { useEffect, useState } from 'react';
import { useStore } from '../../stores/useStore';
import { Icon } from '../Icon';
import { getHeatmapClient } from '../../engine/heatmapClient';

export function StatusStrip() {
  const showHeatmap = useStore(s => s.showHeatmap);
  const toggleHeatmap = useStore(s => s.toggleHeatmap);
  const useReflections = useStore(s => s.useReflections);
  const toggleReflections = useStore(s => s.toggleReflections);
  const ismMaxOrder = useStore(s => s.ismMaxOrder);
  const setIsmMaxOrder = useStore(s => s.setIsmMaxOrder);
  const useCoherentSum = useStore(s => s.useCoherentSum);
  const toggleCoherentSum = useStore(s => s.toggleCoherentSum);
  const useRayTracing = useStore(s => s.useRayTracing);
  const toggleRayTracing = useStore(s => s.toggleRayTracing);
  const rayQuality = useStore(s => s.rayQuality);
  const setRayQuality = useStore(s => s.setRayQuality);
  const useModalLF = useStore(s => s.useModalLF);
  const toggleModalLF = useStore(s => s.toggleModalLF);
  const modalFreq = useStore(s => s.modalFreq);
  const setModalFreq = useStore(s => s.setModalFreq);
  // Simple mode hides the expert pickers (ISM order, phase-aware, ray
  // quality, modal freq, ear slider) — the parent toggles stay, defaults rule.
  const isPro = useStore(s => s.uiMode === 'pro');
  const earHeightFt = useStore(s => s.earHeightFt);
  const setEarHeight = useStore(s => s.setEarHeight);
  const activeFreq = useStore(s => s.activeFreq);
  const setActiveFreq = useStore(s => s.setActiveFreq);
  const occupied = useStore(s => s.room.occupied);
  const setOccupied = useStore(s => s.setOccupied);
  const occupancy = useStore(s => s.room.occupancy);
  const equipment = useStore(s => s.equipment);
  const clearTreatment = useStore(s => s.clearTreatment);
  const setOpenModal = useStore(s => s.setOpenModal);
  const isDirty = useStore(s => s.isDirty);
  const lastAutoSaveAt = useStore(s => s.lastAutoSaveAt);
  const autoSaveFailed = useStore(s => s.autoSaveFailed);
  const [, setTick] = useState(0);
  const [simulating, setSimulating] = useState(false);

  // Tick once per second so the "Saved Xs ago" string updates
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Subscribe to the worker's running flag
  useEffect(() => {
    return getHeatmapClient().onStateChange(setSimulating);
  }, []);

  const panelCount = equipment.filter(e => e.category === 'acoustic').length;

  const savedLabel = (() => {
    if (autoSaveFailed) return 'Autosave failed — export to save';
    if (isDirty) return 'Unsaved changes';
    if (!lastAutoSaveAt) return 'Saved';
    const dt = Math.floor((Date.now() - lastAutoSaveAt) / 1000);
    if (dt < 5) return 'Auto-saved just now';
    if (dt < 60) return `Auto-saved ${dt}s ago`;
    if (dt < 3600) return `Auto-saved ${Math.floor(dt / 60)}m ago`;
    return `Auto-saved ${Math.floor(dt / 3600)}h ago`;
  })();

  return (
    <div className="vp-strip">
      <div className="row" style={{ gap: 14, alignItems: 'center' }}>
        <span style={{ fontFamily: 'Montserrat', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,.6)' }}>FREQUENCY</span>
        <div className="freq-bands">
          {([['125', '125Hz'], ['1k', '1kHz'], ['4k', '4kHz'], ['broadband', 'BB']] as const).map(([id, label]) => (
            <button key={id} className={activeFreq === id ? 'on' : ''} onClick={() => setActiveFreq(id)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="vp-strip-divider"/>

      <div className="row" style={{ gap: 10, alignItems: 'center' }}
           title="Sampling height for the heatmap plane. Zones with their own floor/ear-height override this for cells inside the zone polygon (use that for balcony, raised stage, choir loft).">
        <span style={{ fontFamily: 'Montserrat', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,.6)' }}>EAR HT</span>
        <div className="freq-bands">
          {([['Seat', 4], ['Stand', 5.5], ['Balc', 12]] as const).map(([label, ft]) => (
            <button
              key={label}
              className={Math.abs(earHeightFt - ft) < 0.05 ? 'on' : ''}
              onClick={() => setEarHeight(ft)}
              title={`${label} — ${ft.toFixed(1)} ft`}
            >{label}</button>
          ))}
        </div>
        {isPro && (
          <>
            <input
              type="range" min={3} max={20} step={0.5}
              value={earHeightFt}
              onChange={e => setEarHeight(parseFloat(e.target.value))}
              style={{ width: 80 }}
            />
            <span className="tabular" style={{ fontSize: 11, color: '#fff', minWidth: 36, textAlign: 'right' }}>
              {earHeightFt.toFixed(1)} ft
            </span>
          </>
        )}
      </div>

      <div className="vp-strip-divider"/>

      <div className="toggle-row">
        <button className={`toggle ${showHeatmap ? 'on' : ''}`} onClick={toggleHeatmap}>
          <span className="switch"/>
          <span><Icon name="heatmap" size={13} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }}/> SPL heatmap</span>
        </button>
        <button
          className={`toggle amber ${panelCount > 0 ? 'on' : ''}`}
          onClick={() => panelCount > 0 ? clearTreatment() : setOpenModal('auto-treat')}
          title={panelCount > 0
            ? `Clear ${panelCount} treatment item${panelCount === 1 ? '' : 's'}`
            : 'Open auto-treat — pick a target RT60 and strategy'}
        >
          <span className="switch"/>
          <span><Icon name="panel2" size={13} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }}/> Treatment</span>
        </button>
        <button className={`toggle ${occupied ? 'on' : ''}`} onClick={() => setOccupied(!occupied)}>
          <span className="switch"/>
          <span><Icon name="users" size={13} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }}/> Occupied ({occupancy})</span>
        </button>
        <button
          className={`toggle ${useReflections ? 'on' : ''}`}
          onClick={toggleReflections}
          title="Specular reflections (image-source method). When on, the heatmap and C50 fold in audible bounces off walls/floor/ceiling — including 2nd-order corner reflections at order 2+. RT60 also switches from Sabine to Eyring."
        >
          <span className="switch"/>
          <span><Icon name="ray" size={13} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }}/> Reflections</span>
        </button>
        {useReflections && isPro && (
          <div className="ism-order-pick" style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, color: 'rgba(255,255,255,.65)' }}>
            <span style={{ marginRight: 2 }}>Order</span>
            {([1, 2, 3] as const).map(n => (
              <button
                key={n}
                onClick={() => setIsmMaxOrder(n)}
                title={
                  n === 1 ? 'First-order only — fastest. Just direct + single bounce.' :
                  n === 2 ? 'Adds corner reflections (default). Recommended quality.' :
                  'Late early reflections. Slow on large rooms — try at low resolution first.'
                }
                style={{
                  padding: '2px 7px',
                  fontFamily: 'Montserrat',
                  fontWeight: 700,
                  borderRadius: 4,
                  border: '1px solid ' + (ismMaxOrder === n ? 'rgba(245, 166, 35, 0.7)' : 'rgba(255,255,255,.18)'),
                  background: ismMaxOrder === n ? 'rgba(245, 166, 35, 0.18)' : 'transparent',
                  color: ismMaxOrder === n ? '#F5A623' : 'rgba(255,255,255,.7)',
                  cursor: 'pointer',
                }}
              >{n}</button>
            ))}
          </div>
        )}
        {isPro && <button
          className={`toggle ${useCoherentSum ? 'on' : ''}`}
          onClick={toggleCoherentSum}
          title="Phase-aware (coherent) source summation. Reveals comb-filter nulls between coincident speakers and between direct + reflection paths. Coherence decays with frequency — strong at LF, fades to incoherent above 2 kHz. Most useful at 125 Hz for sub coverage, 1 kHz for dialogue clarity. Switches to incoherent on broadband."
        >
          <span className="switch"/>
          <span><Icon name="bolt" size={13} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }}/> Phase-aware</span>
        </button>}
        <button
          className={`toggle ${useRayTracing ? 'on' : ''}`}
          onClick={toggleRayTracing}
          title="Stochastic ray tracing for the late reverberant tail. Casts thousands of rays per speaker, builds a per-band energy decay curve, and reports T20/T30/EDT in place of Sabine/Eyring. More accurate than statistical RT60 in non-trivial rooms; feeds STI directly. Quality presets control rays-per-source (Low ≈ 1k, Medium ≈ 5k, High ≈ 20k)."
        >
          <span className="switch"/>
          <span><Icon name="ear" size={13} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }}/> Ray-trace tail</span>
        </button>
        {useRayTracing && isPro && (
          <div className="ray-quality-pick" style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, color: 'rgba(255,255,255,.65)' }}>
            <span style={{ marginRight: 2 }}>Quality</span>
            {(['low', 'medium', 'high'] as const).map(q => (
              <button
                key={q}
                onClick={() => setRayQuality(q)}
                title={
                  q === 'low'    ? 'Low — ~1k rays/source. Fastest. EDC is noisy but T30 is usually within 0.1 s of high quality.' :
                  q === 'medium' ? 'Medium — ~5k rays/source. Recommended default. ~1–3 s compute on a typical sanctuary.' :
                                   'High — ~20k rays/source. EASE-class accuracy. 5–20 s compute on large rooms.'
                }
                style={{
                  padding: '2px 7px',
                  fontFamily: 'Montserrat',
                  fontWeight: 700,
                  borderRadius: 4,
                  border: '1px solid ' + (rayQuality === q ? 'rgba(245, 166, 35, 0.7)' : 'rgba(255,255,255,.18)'),
                  background: rayQuality === q ? 'rgba(245, 166, 35, 0.18)' : 'transparent',
                  color: rayQuality === q ? '#F5A623' : 'rgba(255,255,255,.7)',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  fontSize: 10,
                  letterSpacing: '0.05em',
                }}
              >{q[0].toUpperCase()}</button>
            ))}
          </div>
        )}
        <button
          className={`toggle ${useModalLF ? 'on' : ''}`}
          onClick={toggleModalLF}
          title="Low-frequency modal engine. Computes the room's eigenmodes and a wave-accurate standing-wave field — the bass behavior (room modes, boom, sub coverage) that ray/ISM methods fundamentally can't represent. Pick the frequency to visualize; the Inspector lists the modes + warnings."
        >
          <span className="switch"/>
          <span><Icon name="ray" size={13} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }}/> Modal LF</span>
        </button>
        {useModalLF && isPro && (
          <div className="modal-freq-pick" style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, color: 'rgba(255,255,255,.65)' }}>
            <span style={{ marginRight: 2 }}>LF</span>
            {([40, 50, 63, 80, 100, 125] as const).map(f => (
              <button
                key={f}
                onClick={() => setModalFreq(f)}
                title={`Visualize the standing-wave field at ${f} Hz`}
                style={{
                  padding: '2px 6px',
                  fontFamily: 'Montserrat',
                  fontWeight: 700,
                  borderRadius: 4,
                  border: '1px solid ' + (modalFreq === f ? 'rgba(245, 166, 35, 0.7)' : 'rgba(255,255,255,.18)'),
                  background: modalFreq === f ? 'rgba(245, 166, 35, 0.18)' : 'transparent',
                  color: modalFreq === f ? '#F5A623' : 'rgba(255,255,255,.7)',
                  cursor: 'pointer',
                  fontSize: 10,
                }}
              >{f}</button>
            ))}
            <span style={{ marginLeft: 1, fontSize: 10, color: 'rgba(255,255,255,.4)' }}>Hz</span>
          </div>
        )}
      </div>

      <div className="row" style={{ marginLeft: 'auto', gap: 14, color: 'rgba(255,255,255,.65)', fontSize: 11.5 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
          color: autoSaveFailed ? '#F87171' : undefined,
          fontWeight: autoSaveFailed ? 600 : undefined }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: autoSaveFailed ? '#EF4444' : (isDirty ? '#F5A623' : '#2F9E5E'),
          }}/>
          {savedLabel}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: simulating ? '#F5A623' : '#2F9E5E',
            animation: simulating ? 'pulse 1.4s ease-in-out infinite' : undefined,
          }}/>
          {simulating ? 'Computing…' : 'Engine ready'}
        </span>
      </div>
    </div>
  );
}

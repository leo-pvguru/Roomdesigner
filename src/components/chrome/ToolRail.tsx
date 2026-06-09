import { useStore, type LayerKey } from '../../stores/useStore';
import { Icon } from '../Icon';

export function ToolRail() {
  const measureMode = useStore(s => s.measureMode);
  const setMeasureMode = useStore(s => s.setMeasureMode);
  const drawingZone = useStore(s => s.drawingZone);
  const setDrawingZone = useStore(s => s.setDrawingZone);
  const layersOpen = useStore(s => s.layersOpen);
  const setLayersOpen = useStore(s => s.setLayersOpen);
  const settingsOpen = useStore(s => s.settingsOpen);
  const setSettingsOpen = useStore(s => s.setSettingsOpen);
  const tool = useStore(s => s.tool);
  const setTool = useStore(s => s.setTool);
  const wiringMode = useStore(s => s.wiringMode);
  const setWiringMode = useStore(s => s.setWiringMode);

  // Category switching lives in the Catalog header tabs — no need to duplicate it here.
  const tools: [string, string, string, () => void, boolean][] = [
    ['select', 'cursor', 'Select / move',     () => setTool('select'), tool === 'select'],
    ['hand',   'hand',   'Pan (drag canvas)', () => setTool('hand'),   tool === 'hand'],
  ];

  return (
    <div className="rail" style={{ position: 'relative', overflow: 'visible' }}>
      {tools.map(([id, icon, title, onClick, active]) => (
        <button key={id} className={`rail-btn ${active ? 'active' : ''}`} title={title} onClick={onClick}>
          <Icon name={icon} size={18}/>
        </button>
      ))}
      <div className="rail-divider"/>
      <button
        className={`rail-btn ${measureMode ? 'active' : ''}`}
        title="Measure (click two points)"
        onClick={() => setMeasureMode(!measureMode)}>
        <Icon name="ruler" size={18}/>
      </button>
      <button
        className={`rail-btn ${drawingZone ? 'active' : ''}`}
        title="Draw coverage zone (click vertices, double-click to close)"
        onClick={() => setDrawingZone(!drawingZone)}>
        <Icon name="polygon" size={18}/>
      </button>
      <button
        className={`rail-btn ${wiringMode ? 'active' : ''}`}
        title="Wiring (click source, then destination — pick cable type from the bottom-left popover)"
        onClick={() => setWiringMode(!wiringMode)}>
        <Icon name="link" size={18}/>
      </button>
      <AnnotationRailButton/>
      <button
        className={`rail-btn ${layersOpen ? 'active' : ''}`}
        title="Layers"
        onClick={() => setLayersOpen(!layersOpen)}>
        <Icon name="layers" size={18}/>
      </button>
      <div className="rail-spacer"/>
      <button
        className={`rail-btn ${settingsOpen ? 'active' : ''}`}
        title="View settings"
        onClick={() => setSettingsOpen(!settingsOpen)}>
        <Icon name="more" size={18}/>
      </button>

      {layersOpen && <LayersPopover/>}
      {settingsOpen && <SettingsPopover/>}
    </div>
  );
}

function AnnotationRailButton() {
  const droppingAnnotation = useStore(s => s.droppingAnnotation);
  const setDroppingAnnotation = useStore(s => s.setDroppingAnnotation);
  return (
    <button className={`rail-btn ${droppingAnnotation ? 'active' : ''}`}
      title="Drop annotation pin"
      onClick={() => setDroppingAnnotation(!droppingAnnotation)}>
      <Icon name="bell" size={18}/>
    </button>
  );
}

function LayersPopover() {
  const layers = useStore(s => s.layerVisibility);
  const toggleLayer = useStore(s => s.toggleLayer);
  const setLayersOpen = useStore(s => s.setLayersOpen);

  const items: { key: LayerKey; label: string; icon: string }[] = [
    { key: 'audio-speaker',  label: 'Speakers',           icon: 'speaker' },
    { key: 'audio-signal',   label: 'Audio signal chain', icon: 'speaker' },
    { key: 'acoustic',       label: 'Acoustic treatment', icon: 'panel2' },
    { key: 'video',          label: 'Video',              icon: 'camera' },
    { key: 'lighting',       label: 'Lighting',           icon: 'light' },
    { key: 'infrastructure', label: 'Infrastructure',     icon: 'bolt' },
    { key: 'reference',      label: 'Reference points',   icon: 'microphone' },
    { key: 'pews',           label: 'Pews & seating',     icon: 'users' },
    { key: 'mesh',           label: 'Floor grid mesh',    icon: 'grid' },
    { key: 'cones',          label: 'Coverage cones',     icon: 'ray' },
    { key: 'heatmap',        label: 'SPL heatmap',        icon: 'heatmap' },
  ];

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', left: 56 + 8, bottom: 60,
        width: 240,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 60,
        padding: '10px 6px',
      }}>
      <div className="row between" style={{ padding: '4px 10px 8px', borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
        <strong style={{ fontFamily: 'Montserrat', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg1)' }}>Layers</strong>
        <button onClick={() => setLayersOpen(false)} className="icon-close" style={{ width: 22, height: 22 }}><Icon name="x" size={12}/></button>
      </div>
      {items.map(it => (
        <button
          key={it.key}
          onClick={() => toggleLayer(it.key)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            width: '100%', padding: '7px 10px',
            background: 'transparent', border: 0, borderRadius: 6,
            cursor: 'pointer', textAlign: 'left',
            color: layers[it.key] ? 'var(--fg1)' : 'var(--fg3)',
            fontFamily: 'Open Sans', fontSize: 13,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-alt)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ width: 14, opacity: layers[it.key] ? 1 : 0.3 }}>
            <Icon name={it.icon} size={14}/>
          </span>
          <span style={{ flex: 1 }}>{it.label}</span>
          <span style={{
            width: 26, height: 16, borderRadius: 999, position: 'relative',
            background: layers[it.key] ? 'var(--royal-blue)' : 'rgba(18,21,26,0.18)',
            transition: 'background 180ms',
          }}>
            <span style={{
              position: 'absolute', top: 2, left: layers[it.key] ? 12 : 2,
              width: 12, height: 12, borderRadius: '50%', background: '#fff',
              transition: 'left 180ms',
            }}/>
          </span>
        </button>
      ))}
    </div>
  );
}

function SettingsPopover() {
  const setSettingsOpen = useStore(s => s.setSettingsOpen);
  const room = useStore(s => s.room);
  const setRoom = useStore(s => s.setRoom);
  const gridSnap = useStore(s => s.gridSnap);
  const setGridSnap = useStore(s => s.setGridSnap);
  const heatmapOpacity = useStore(s => s.heatmapOpacity);
  const setHeatmapOpacity = useStore(s => s.setHeatmapOpacity);
  const noiseFloor = useStore(s => s.noiseFloor);
  const setNoiseFloor = useStore(s => s.setNoiseFloor);
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', left: 56 + 8, top: 8,
        width: 280,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 60,
        padding: '10px 12px 14px',
      }}>
      <div className="row between" style={{ padding: '4px 0 8px', borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
        <strong style={{ fontFamily: 'Montserrat', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg1)' }}>View settings</strong>
        <button onClick={() => setSettingsOpen(false)} className="icon-close" style={{ width: 22, height: 22 }}><Icon name="x" size={12}/></button>
      </div>

      <div className="field-row" style={{ gridTemplateColumns: '110px 1fr' }}>
        <label>Theme</label>
        <div style={{ display: 'flex', gap: 4, padding: 2, background: 'var(--bg-alt)', borderRadius: 999 }}>
          {(['light', 'dark'] as const).map(t => (
            <button key={t} onClick={() => setTheme(t)} style={{
              flex: 1,
              fontFamily: 'Montserrat', fontWeight: 700, fontSize: 11,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '4px 8px', borderRadius: 999, border: 0,
              background: theme === t ? 'var(--royal-blue)' : 'transparent',
              color: theme === t ? '#fff' : 'var(--fg2)',
              cursor: 'pointer',
            }}>{t}</button>
          ))}
        </div>
      </div>

      <div className="field-row" style={{ gridTemplateColumns: '110px 1fr' }}>
        <label>Units</label>
        <select
          value={room.unitSystem}
          onChange={e => setRoom({ unitSystem: e.target.value as 'imperial' | 'metric' })}>
          <option value="imperial">Imperial (ft)</option>
          <option value="metric">Metric (m)</option>
        </select>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '110px 1fr',
        alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 12.5,
      }}>
        <label style={{ color: 'var(--fg2)' }}>Grid snap</label>
        <button
          onClick={() => setGridSnap(!gridSnap)}
          style={{
            width: 30, height: 18, borderRadius: 999, position: 'relative',
            background: gridSnap ? 'var(--royal-blue)' : 'rgba(18,21,26,0.18)',
            border: 0, cursor: 'pointer', justifySelf: 'start',
          }}>
          <span style={{
            position: 'absolute', top: 2, left: gridSnap ? 14 : 2,
            width: 14, height: 14, borderRadius: '50%', background: '#fff',
            transition: 'left 180ms',
          }}/>
        </button>
      </div>

      <div className="slider-row" style={{ gridTemplateColumns: '110px 1fr 50px' }}>
        <label>Heatmap opacity</label>
        <input type="range" min="0.1" max="0.95" step="0.05" value={heatmapOpacity}
          onChange={e => setHeatmapOpacity(parseFloat(e.target.value))}/>
        <span className="val">{Math.round(heatmapOpacity * 100)}%</span>
      </div>

      <div className="slider-row" style={{ gridTemplateColumns: '110px 1fr 50px' }}>
        <label>Noise floor</label>
        <input type="range" min="20" max="60" step="1" value={noiseFloor}
          onChange={e => setNoiseFloor(parseInt(e.target.value, 10))}/>
        <span className="val">{noiseFloor} dB</span>
      </div>

      <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.45 }}>
        Tip: press <kbd style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-alt)', padding: '0 4px', borderRadius: 3 }}>F</kbd> for presentation mode,
        <kbd style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-alt)', padding: '0 4px', borderRadius: 3, marginLeft: 4 }}>R</kbd> to re-run simulation.
      </div>
    </div>
  );
}

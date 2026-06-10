/**
 * Phase C — auralization panel. Lets the client LISTEN to the room:
 * dry (anechoic) program material convolved with the predicted impulse
 * response, with an instant A/B between the design as-is and the same
 * room stripped of acoustic treatment.
 *
 * The IR comes from engine/auralize.ts (ISM early reflections + RT60-
 * matched stochastic tail). This component owns the Web Audio graph:
 *
 *   source ──┬── dryGain ───────────────────┬── master ── destination
 *            ├── treatedGain ── convolver(T) ┤
 *            └── strippedGain ── convolver(U)┘
 *
 * Mode switching just moves gain values, so A/B is glitch-free while
 * the loop keeps playing — that's the demo moment.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../stores/useStore';
import { synthesizeIR } from '../../engine/auralize';
import type { AuralizeResult } from '../../engine/auralize';

type SourceKind = 'clap' | 'pink' | 'drums' | 'upload';
type Mode = 'dry' | 'treated' | 'untreated';

// ---------------------------------------------------------------------------
// Dry source synthesis — all generated, so the app needs no bundled audio
// ---------------------------------------------------------------------------

function makeClap(actx: BaseAudioContext): AudioBuffer {
  // A hand-clap-like burst, then silence — looping gives a repeating
  // impulse so the decay tail is easy to hear. 1.6 s loop.
  const sr = actx.sampleRate;
  const buf = actx.createBuffer(1, Math.floor(sr * 1.6), sr);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < sr * 0.25; i++) {
    const t = i / sr;
    const env = Math.exp(-t / 0.02) * (t < 0.002 ? t / 0.002 : 1);
    ch[i] = (Math.random() * 2 - 1) * env;
  }
  return buf;
}

function makePinkBurst(actx: BaseAudioContext): AudioBuffer {
  // 1.0 s pink noise burst + 1.0 s silence, looped. Pink via Paul Kellet's
  // economy filter.
  const sr = actx.sampleRate;
  const buf = actx.createBuffer(1, Math.floor(sr * 2.0), sr);
  const ch = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  const nOn = Math.floor(sr * 1.0);
  for (let i = 0; i < nOn; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.0990460;
    b1 = 0.96300 * b1 + w * 0.2965164;
    b2 = 0.57000 * b2 + w * 1.0526913;
    let v = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    // 10 ms fade edges to avoid clicks
    if (i < sr * 0.01) v *= i / (sr * 0.01);
    if (i > nOn - sr * 0.01) v *= (nOn - i) / (sr * 0.01);
    ch[i] = v;
  }
  return buf;
}

function makeDrumLoop(actx: BaseAudioContext): AudioBuffer {
  // Two bars of a dry 120 BPM groove — kick, snare, hats. Entirely
  // synthesized; "anechoic studio drums" stand-in.
  const sr = actx.sampleRate;
  const barSec = 2.0;                       // 120 BPM, 4/4 → 2 s per bar
  const buf = actx.createBuffer(1, Math.floor(sr * barSec * 2), sr);
  const ch = buf.getChannelData(0);
  const add = (start: number, gen: (t: number) => number, dur: number) => {
    const s0 = Math.floor(start * sr);
    const n = Math.floor(dur * sr);
    for (let i = 0; i < n && s0 + i < ch.length; i++) ch[s0 + i] += gen(i / sr);
  };
  const kick = (t: number) => Math.sin(2 * Math.PI * (55 + 80 * Math.exp(-t / 0.03)) * t) * Math.exp(-t / 0.11) * 0.9;
  const snare = (t: number) =>
    ((Math.random() * 2 - 1) * 0.7 + Math.sin(2 * Math.PI * 185 * t) * 0.3) * Math.exp(-t / 0.055) * 0.55;
  const hat = (t: number) => {
    // crude HP: difference of two noise samples
    const n1 = Math.random() * 2 - 1, n2 = Math.random() * 2 - 1;
    return (n1 - n2) * Math.exp(-t / 0.018) * 0.22;
  };
  for (let bar = 0; bar < 2; bar++) {
    const b0 = bar * barSec;
    add(b0 + 0.0, kick, 0.3); add(b0 + 1.0, kick, 0.3);
    if (bar === 1) add(b0 + 1.75, kick, 0.25);
    add(b0 + 0.5, snare, 0.25); add(b0 + 1.5, snare, 0.25);
    for (let e = 0; e < 8; e++) add(b0 + e * 0.25, hat, 0.06);
  }
  return buf;
}

// ---------------------------------------------------------------------------

function irToBuffer(actx: BaseAudioContext, ir: AuralizeResult): AudioBuffer {
  const buf = actx.createBuffer(2, ir.left.length, ir.sampleRate);
  buf.getChannelData(0).set(ir.left);
  buf.getChannelData(1).set(ir.right);
  return buf;
}

/** Power-compensating makeup gain so dry and convolved modes sit at
 *  comparable loudness: output power ≈ input power × Σ ir². */
function irMakeupGain(ir: AuralizeResult): number {
  let e = 0;
  for (let i = 0; i < ir.left.length; i++) e += ir.left[i] * ir.left[i] + ir.right[i] * ir.right[i];
  e /= 2;
  if (e <= 0) return 1;
  return Math.min(8, 1 / Math.sqrt(e));
}

export function AuralizePanel({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState<SourceKind>('clap');
  const [mode, setMode] = useState<Mode>('treated');
  const [playing, setPlaying] = useState(false);
  const [computing, setComputing] = useState(true);
  const [stale, setStale] = useState(false);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [irInfo, setIrInfo] = useState<{ treated: AuralizeResult; untreated: AuralizeResult } | null>(null);

  const actxRef = useRef<AudioContext | null>(null);
  const graphRef = useRef<{
    srcNode: AudioBufferSourceNode | null;
    dryGain: GainNode; treatedGain: GainNode; untreatedGain: GainNode;
    convTreated: ConvolverNode; convUntreated: ConvolverNode;
    master: GainNode;
    treatedMakeup: number; untreatedMakeup: number;
  } | null>(null);
  const uploadBufRef = useRef<AudioBuffer | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const irRef = useRef<{ treated: AuralizeResult; untreated: AuralizeResult } | null>(null);

  // ===== Compute IRs (off the click path; ~50–200 ms for typical rooms) =====
  const compute = () => {
    setComputing(true);
    setStale(false);
    setTimeout(() => {
      // The convolver REQUIRES the IR buffer's sample rate to match the
      // AudioContext's hardware rate (44.1k vs 48k varies by machine), so
      // build the graph first and synthesize at its rate.
      const { actx, g } = ensureGraph();
      const st = useStore.getState();
      const base = {
        room: st.room, equipment: st.equipment, zones: st.zones, groups: st.groups,
        sampleRate: actx.sampleRate,
      };
      const treated = synthesizeIR({ ...base, includeTreatment: true });
      const untreated = synthesizeIR({ ...base, includeTreatment: false });
      if (treated && untreated) {
        irRef.current = { treated, untreated };
        setIrInfo({ treated, untreated });
        g.convTreated.buffer = irToBuffer(actx, treated);
        g.convUntreated.buffer = irToBuffer(actx, untreated);
        g.treatedMakeup = irMakeupGain(treated);
        g.untreatedMakeup = irMakeupGain(untreated);
        applyMode(modeRef.current);
      }
      setComputing(false);
    }, 30);
  };

  useEffect(() => {
    compute();
    // Design edits while the panel is open → auto-recompute (debounced)
    let pending: number | undefined;
    const unsub = useStore.subscribe((s, p) => {
      if (s.room === p.room && s.equipment === p.equipment && s.zones === p.zones) return;
      setStale(true);
      if (pending !== undefined) clearTimeout(pending);
      pending = window.setTimeout(compute, 500);
    });
    return () => {
      unsub();
      if (pending !== undefined) clearTimeout(pending);
      stop();
      actxRef.current?.close().catch(() => {});
      actxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;

  const ensureGraph = (): { actx: AudioContext; g: NonNullable<typeof graphRef.current> } => {
    let actx = actxRef.current;
    if (!actx) {
      actx = new AudioContext();
      actxRef.current = actx;
    }
    let g = graphRef.current;
    if (!g) {
      const dryGain = actx.createGain();
      const treatedGain = actx.createGain();
      const untreatedGain = actx.createGain();
      const convTreated = actx.createConvolver();
      const convUntreated = actx.createConvolver();
      const master = actx.createGain();
      master.gain.value = 0.9;
      treatedGain.connect(convTreated).connect(master);
      untreatedGain.connect(convUntreated).connect(master);
      dryGain.connect(master);
      master.connect(actx.destination);
      g = {
        srcNode: null, dryGain, treatedGain, untreatedGain,
        convTreated, convUntreated, master, treatedMakeup: 1, untreatedMakeup: 1,
      };
      const irs = irRef.current;
      if (irs) {
        g.convTreated.buffer = irToBuffer(actx, irs.treated);
        g.convUntreated.buffer = irToBuffer(actx, irs.untreated);
        g.treatedMakeup = irMakeupGain(irs.treated);
        g.untreatedMakeup = irMakeupGain(irs.untreated);
      }
      graphRef.current = g;
    }
    return { actx, g };
  };

  const applyMode = (m: Mode) => {
    const g = graphRef.current, actx = actxRef.current;
    if (!g || !actx) return;
    const t = actx.currentTime;
    const ramp = (node: GainNode, v: number) => {
      node.gain.cancelScheduledValues(t);
      node.gain.setTargetAtTime(v, t, 0.04);   // ~40 ms crossfade — click-free
    };
    ramp(g.dryGain, m === 'dry' ? 1 : 0);
    ramp(g.treatedGain, m === 'treated' ? g.treatedMakeup : 0);
    ramp(g.untreatedGain, m === 'untreated' ? g.untreatedMakeup : 0);
  };

  const sourceBuffer = (actx: AudioContext, kind: SourceKind): AudioBuffer | null => {
    switch (kind) {
      case 'clap': return makeClap(actx);
      case 'pink': return makePinkBurst(actx);
      case 'drums': return makeDrumLoop(actx);
      case 'upload': return uploadBufRef.current;
    }
  };

  const play = (kind: SourceKind = source) => {
    const { actx, g } = ensureGraph();
    actx.resume().catch(() => {});
    g.srcNode?.stop();
    const buf = sourceBuffer(actx, kind);
    if (!buf) return;
    const src = actx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(g.dryGain);
    src.connect(g.treatedGain);
    src.connect(g.untreatedGain);
    src.start();
    g.srcNode = src;
    applyMode(modeRef.current);
    setPlaying(true);
  };

  const stop = () => {
    const g = graphRef.current;
    if (g?.srcNode) { try { g.srcNode.stop(); } catch { /* already stopped */ } g.srcNode = null; }
    setPlaying(false);
  };

  const pickSource = (k: SourceKind) => {
    if (k === 'upload' && !uploadBufRef.current) { fileRef.current?.click(); return; }
    setSource(k);
    if (playing) play(k);
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const { actx } = ensureGraph();
      const data = await f.arrayBuffer();
      uploadBufRef.current = await actx.decodeAudioData(data);
      setUploadName(f.name);
      setSource('upload');
      if (playing) play('upload');
    } catch {
      setUploadName(null);
    } finally {
      e.target.value = '';
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    applyMode(m);
  };

  const chip = (active: boolean): React.CSSProperties => ({
    fontFamily: 'Montserrat', fontWeight: 600, fontSize: 11,
    padding: '5px 10px', borderRadius: 999, border: 0, cursor: 'pointer',
    background: active ? 'var(--royal-blue, #1A4FBF)' : 'rgba(255,255,255,0.08)',
    color: active ? '#fff' : 'rgba(255,255,255,0.75)',
    whiteSpace: 'nowrap',
  });

  const t = irInfo?.treated, u = irInfo?.untreated;
  const fmt = (s: number) => s >= 90 ? '—' : `${s.toFixed(2)}s`;

  return (
    <div style={{
      position: 'absolute', bottom: 76, left: '50%', transform: 'translateX(-50%)',
      zIndex: 31, width: 480, maxWidth: 'calc(100vw - 40px)',
      background: 'rgba(10,12,16,0.88)', borderRadius: 14, padding: '14px 16px',
      backdropFilter: 'blur(10px)', pointerEvents: 'auto',
      border: '1px solid rgba(255,255,255,0.08)',
      color: 'rgba(255,255,255,0.85)', fontFamily: 'Open Sans',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontFamily: 'Montserrat', fontWeight: 700, fontSize: 12.5, letterSpacing: '0.04em', flex: 1 }}>
          🔊 AURALIZATION — VIRTUAL LISTENING
        </div>
        <button onClick={() => { stop(); onClose(); }}
          style={{ background: 'transparent', border: 0, color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 15 }}>✕</button>
      </div>

      {/* Source row */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', width: 50 }}>Source</span>
        <button style={chip(source === 'clap')} onClick={() => pickSource('clap')}>👏 Clap</button>
        <button style={chip(source === 'pink')} onClick={() => pickSource('pink')}>Pink noise</button>
        <button style={chip(source === 'drums')} onClick={() => pickSource('drums')}>🥁 Drums</button>
        <button style={chip(source === 'upload')} onClick={() => pickSource('upload')}
          title="Use your own dry/studio recording (wav, mp3, m4a)">
          {uploadName ? `🎵 ${uploadName.slice(0, 14)}${uploadName.length > 14 ? '…' : ''}` : '⬆ Your audio'}
        </button>
        <input ref={fileRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={onUpload}/>
      </div>

      {/* Mode row — the A/B */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', width: 50 }}>Listen</span>
        <button style={chip(mode === 'dry')} onClick={() => switchMode('dry')}
          title="The recording with no room at all (anechoic reference)">Dry</button>
        <button style={chip(mode === 'treated')} onClick={() => switchMode('treated')}
          title="Predicted sound in this room as currently designed">In this room</button>
        <button style={chip(mode === 'untreated')} onClick={() => switchMode('untreated')}
          title="Same room with all acoustic treatment removed — the before/after">Without treatment</button>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => (playing ? stop() : play())}
          disabled={computing || (source === 'upload' && !uploadBufRef.current)}
          style={{
            fontFamily: 'Montserrat', fontWeight: 700, fontSize: 12,
            padding: '7px 18px', borderRadius: 999, border: 0,
            cursor: computing ? 'wait' : 'pointer',
            background: playing ? '#a33' : 'var(--royal-blue, #1A4FBF)', color: '#fff',
          }}>
          {playing ? '■ Stop' : '▶ Play'}
        </button>
      </div>

      {/* Readout */}
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
        {computing ? 'Computing room response…' : t && u ? (
          t.outdoor
            ? 'Open-air venue — direct sound only, no reverberant field.'
            : <>
                RT60 (mid): <b style={{ color: '#7fc97f' }}>{fmt(t.t60ByBand[1000])}</b> as designed
                {' · '}<b style={{ color: '#e0908a' }}>{fmt(u.t60ByBand[1000])}</b> untreated
                {' · '}{t.tapCount} reflections modeled
                {stale ? ' · updating…' : ''}
              </>
        ) : 'Could not compute a response for this room.'}
        <span style={{ display: 'block', marginTop: 2 }}>
          Listening from the room center at seated ear height. Headphones recommended.
        </span>
      </div>
    </div>
  );
}

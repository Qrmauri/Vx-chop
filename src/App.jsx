import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioEngine } from './hooks/useAudioEngine.js';
import { getMidiNoteForPad, useMidi } from './hooks/useMidi.js';
import { useSequencer } from './hooks/useSequencer.js';
import Sequencer from './components/Sequencer.jsx';
import { formatTime } from './utils/format.js';
import { detectPitch } from './utils/pitch.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const COLORS = [
  '#b8f05a', '#55d6be', '#ff7a66', '#52a8ff',
  '#f7c95f', '#78e8d0', '#ff9f43', '#e66b8c',
  '#a29bfe', '#fd79a8', '#00cec9', '#fdcb6e',
  '#6c5ce7', '#e17055', '#74b9ff', '#81ecec',
];

const PAD_KEYS = ['1','2','3','4','Q','W','E','R','A','S','D','F','Z','X','C','V'];
const PAD_KEYS_LOWER = ['1','2','3','4','q','w','e','r','a','s','d','f','z','x','c','v'];
const BANKS = ['A', 'B', 'C', 'D'];
const MIN_CUT = 0.03;
const SPECTRUM_BARS = 64;

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const hzToNote = (hz) => {
  if (hz <= 0) return null;
  const midi = 69 + 12 * Math.log2(hz / 440);
  const nearest = Math.round(midi);
  return {
    name: `${NOTE_NAMES[(nearest + 120) % 12]}${Math.floor(nearest / 12) - 1}`,
    cents: Math.round((midi - nearest) * 100),
  };
};

// ── Funciones puras de canvas ─────────────────────────────────────────────────

function renderWaveform(canvas, { buffer, chops, selectedId, zoom, viewStart, drag }) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const tw = Math.max(1, Math.round(rect.width * dpr));
  const th = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== tw || canvas.height !== th) {
    canvas.width = tw;
    canvas.height = th;
  }

  const w = tw / dpr;
  const h = th / dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx || w <= 0 || h <= 0) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#05100a';
  ctx.fillRect(0, 0, w, h);

  // Línea central tenue
  ctx.strokeStyle = 'rgba(0,255,136,0.1)';
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  if (!buffer || !buffer.duration) {
    ctx.fillStyle = '#163625';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('— SIN SAMPLE CARGADO —', w / 2, h / 2 + 4);
    ctx.textAlign = 'left';
    return;
  }

  const visible = buffer.duration / (zoom || 1);
  if (!Number.isFinite(visible) || visible <= 0) return;
  const visStart = Math.max(0, Math.min(viewStart || 0, buffer.duration - visible));
  const toX = (t) => Math.max(0, Math.min(w, ((t - visStart) / visible) * w));

  // Regiones de chops coloreadas
  if (Array.isArray(chops)) {
    chops.forEach((c) => {
      const x = toX(c.start);
      const cw = Math.max(1, ((c.end - c.start) / visible) * w);
      ctx.fillStyle = `${c.color || '#00cc66'}28`;
      ctx.fillRect(x, 0, cw, h);
      ctx.strokeStyle = c.color || '#00cc66';
      ctx.lineWidth = c.id === selectedId ? 2 : 1;
      ctx.strokeRect(x, 1, Math.max(1, cw), h - 2);

      // Marcadores laterales en el chop seleccionado
      if (c.id === selectedId) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 2, 0, 4, h);
        ctx.fillRect(x + cw - 2, 0, 4, h);
      }
    });
  }

  // Dibujo de ondas de audio acelerado (con sub-muestreo inteligente para evitar caídas en móviles)
  const data = buffer.getChannelData(0);
  const totalLen = data.length;
  const startSample = Math.max(0, Math.min(totalLen - 1, Math.floor((visStart / buffer.duration) * totalLen)));
  const visibleSamples = Math.floor((visible / buffer.duration) * totalLen);
  const step = Math.max(1, visibleSamples / w);
  const subStep = Math.max(1, Math.floor(step / 32)); // Limitar a máx 32 muestras por columna de píxeles

  ctx.strokeStyle = '#00cc66';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const idx = Math.min(totalLen - 1, startSample + Math.floor(x * step));
    const endIdx = Math.min(totalLen, idx + Math.ceil(step));
    let mn = 1;
    let mx = -1;
    for (let j = idx; j < endIdx; j += subStep) {
      const val = data[j];
      if (val < mn) mn = val;
      if (val > mx) mx = val;
    }
    if (mn > mx) { mn = 0; mx = 0; }
    ctx.moveTo(x, h / 2 + mn * h * 0.46);
    ctx.lineTo(x, h / 2 + mx * h * 0.46);
  }
  ctx.stroke();

  // Vista previa al arrastrar para crear un nuevo corte (dibujada después de la onda para alta visibilidad)
  if (drag && drag.mode === 'create') {
    const ps = Math.min(drag.start, drag.current);
    const pe = Math.max(drag.start, drag.current);
    const x0 = toX(ps);
    const pw = Math.max(2, toX(pe) - x0);
    ctx.fillStyle = 'rgba(0, 204, 102, 0.28)';
    ctx.fillRect(x0, 0, pw, h);
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x0, 1, pw, h - 2);
    ctx.setLineDash([]);
  }
}

function renderPlayhead(canvas, { time, buffer, zoom, viewStart }) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const tw = Math.max(1, Math.round(rect.width * dpr));
  const th = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== tw || canvas.height !== th) {
    canvas.width = tw;
    canvas.height = th;
  }
  const ctx = canvas.getContext('2d');
  const w = tw / dpr;
  const h = th / dpr;
  if (!ctx || w <= 0 || h <= 0) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (time === null || !buffer || !buffer.duration) return;

  const visible = buffer.duration / (zoom || 1);
  if (!Number.isFinite(visible) || visible <= 0) return;
  const visStart = Math.max(0, Math.min(viewStart || 0, buffer.duration - visible));
  if (time < visStart || time > visStart + visible) return;

  const x = Math.max(0, Math.min(w, ((time - visStart) / visible) * w));
  ctx.strokeStyle = '#00ff88';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, h);
  ctx.stroke();

  ctx.fillStyle = '#00ff88';
  ctx.beginPath();
  ctx.moveTo(x - 4, 0);
  ctx.lineTo(x + 4, 0);
  ctx.lineTo(x, 7);
  ctx.closePath();
  ctx.fill();
}

function renderSpectrum(canvas, analyser) {
  if (!canvas || !analyser) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const tw = Math.max(1, Math.round(rect.width * dpr));
  const th = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== tw || canvas.height !== th) {
    canvas.width = tw;
    canvas.height = th;
  }
  const ctx = canvas.getContext('2d');
  const w = tw / dpr;
  const h = th / dpr;
  if (!ctx || w <= 0 || h <= 0) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#05100a';
  ctx.fillRect(0, 0, w, h);

  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);

  const bw = w / SPECTRUM_BARS;
  for (let b = 0; b < SPECTRUM_BARS; b++) {
    const t0 = b / SPECTRUM_BARS;
    const t1 = (b + 1) / SPECTRUM_BARS;
    const si = Math.floor((data.length * t0) ** 1.6 / (data.length ** 0.6));
    const ei = Math.max(si + 1, Math.floor((data.length * t1) ** 1.6 / (data.length ** 0.6)));
    let sum = 0;
    let cnt = 0;
    for (let i = si; i < Math.min(data.length, ei); i++) {
      sum += data[i];
      cnt++;
    }
    const val = cnt ? sum / cnt : 0;
    const bh = (val / 255) * h;
    const hue = 145 - (b / SPECTRUM_BARS) * 85;
    ctx.fillStyle = `hsl(${hue}, 85%, 55%)`;
    ctx.fillRect(b * bw + 1, h - bh, Math.max(1, bw - 2), bh);
  }
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function App() {
  // Canvas refs
  const canvasRef         = useRef(null);
  const playheadCanvasRef = useRef(null);
  const spectrumCanvasRef = useRef(null);

  // DOM refs para updates a 60fps sin re-render de React
  const vuFillRef         = useRef(null);
  const noteNameRef       = useRef(null);
  const noteCentsRef      = useRef(null);
  const durationFillRef   = useRef(null);
  const currentTimeLabelRef = useRef(null);
  const totalTimeLabelRef   = useRef(null);

  // Render & Animation refs
  const drawWaveformRef   = useRef(null);
  const drawPlayheadRef   = useRef(null);
  const dragRef           = useRef(null);
  const spectrumRafRef    = useRef(null);

  // State mirror refs
  const zoomRef           = useRef(1);
  const viewStartRef      = useRef(0);
  const selectedIdRef     = useRef(null);
  const chopsRef          = useRef([]);
  const playheadTimeRef   = useRef(null);

  // Estado React
  const [chops,       setChops]      = useState([]);
  const [selectedId,  setSelectedId] = useState(null);
  const [zoom,        setZoom]       = useState(1);
  const [viewStart,   setViewStart]  = useState(0);
  const [bank,        setBank]       = useState('A');
  const [playingId,     setPlayingId]    = useState(null);
  const [playMode,      setPlayMode]     = useState('mono'); // 'mono' (choke) o 'poly'
  const [showMidiModal, setShowMidiModal] = useState(false);
  const [mobileTab,     setMobileTab]    = useState('pads'); // 'pads' | 'sampler' | 'sequencer'

  const handleSwitchTab = (tab) => {
    setMobileTab(tab);
    if (tab === 'sampler') {
      setTimeout(() => {
        drawWaveformRef.current?.();
        drawPlayheadRef.current?.();
      }, 40);
    }
  };

  // Tap tempo
  const tapsRef = useRef([]);
  const [bpm, setBpm] = useState(90);
  const [lastMidiNote, setLastMidiNote] = useState(null);

  // Motor de audio
  const audio = useAudioEngine();

  // Secuenciador de patrones multi-pista
  const sequencer = useSequencer({
    getAudioContext: () => audio.audioContextRef.current,
    getDestination: audio.getDestination,
    ensureInit: audio.ensureInit,
    chops,
    bpm: bpm || 90,
    playMode,
    playChop: audio.playChop,
  });

  // Sincronizar mirror refs
  useEffect(() => { zoomRef.current       = zoom;       }, [zoom]);
  useEffect(() => { viewStartRef.current  = viewStart;  }, [viewStart]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { chopsRef.current      = chops;      }, [chops]);

  // ── Funciones de dibujado de canvas ─────────────────────────────────────────

  const doDrawWaveform = () => renderWaveform(canvasRef.current, {
    buffer: audio.bufferRef.current,
    chops,
    selectedId,
    zoom,
    viewStart,
    drag: dragRef.current,
  });

  const doDrawPlayhead = () => renderPlayhead(playheadCanvasRef.current, {
    time: playheadTimeRef.current,
    buffer: audio.bufferRef.current,
    zoom: zoomRef.current,
    viewStart: viewStartRef.current,
  });

  drawWaveformRef.current = doDrawWaveform;
  drawPlayheadRef.current = doDrawPlayhead;

  // Redibujar waveform y playhead cuando cambien datos o la pestaña activa
  useEffect(() => {
    doDrawWaveform();
    doDrawPlayhead();
  }, [audio.buffer, chops, selectedId, zoom, viewStart, mobileTab]);

  // ResizeObserver para detectar cambios de dimensiones (rotación, cambio de pestaña, etc.)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onResize = () => {
      drawWaveformRef.current?.();
      drawPlayheadRef.current?.();
    };

    window.addEventListener('resize', onResize);

    // Observar el contenedor del canvas
    let ro = null;
    if (canvas.parentElement && window.ResizeObserver) {
      ro = new ResizeObserver(() => {
        onResize();
      });
      ro.observe(canvas.parentElement);
    }

    onResize();

    return () => {
      window.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
    };
  }, []);

  // ── Ciclo rAF continuo: spectrum + playhead + VU + pitch ─────────────────────
  useEffect(() => {
    const tick = () => {
      // Spectrum
      renderSpectrum(spectrumCanvasRef.current, audio.analyserRef.current);

      // Playhead & Duración
      const state = audio.playbackStateRef.current;
      const ctx   = audio.audioContextRef.current;
      const buf   = audio.bufferRef.current;
      const refChop = state?.chop || chopsRef.current.find((c) => c.id === selectedIdRef.current);
      const total = refChop ? refChop.end - refChop.start : (buf?.duration || 0);

      if (state && ctx) {
        const elapsed = (ctx.currentTime - state.startAudioTime) * state.rate;
        const absPos = Math.min(state.chop.end, state.chop.start + Math.max(0, elapsed));
        playheadTimeRef.current = absPos;
        drawPlayheadRef.current?.();
        const pos = absPos - state.chop.start;
        if (currentTimeLabelRef.current) currentTimeLabelRef.current.textContent = formatTime(pos);
        if (totalTimeLabelRef.current)   totalTimeLabelRef.current.textContent   = formatTime(total);
        if (durationFillRef.current)     durationFillRef.current.style.width     = `${Math.min(100, (pos / total) * 100)}%`;
      } else {
        const defaultTime = refChop ? refChop.start : null;
        if (playheadTimeRef.current !== defaultTime) {
          playheadTimeRef.current = defaultTime;
          drawPlayheadRef.current?.();
        }
        if (currentTimeLabelRef.current) currentTimeLabelRef.current.textContent = formatTime(0);
        if (totalTimeLabelRef.current)   totalTimeLabelRef.current.textContent   = formatTime(total);
        if (durationFillRef.current)     durationFillRef.current.style.width     = '0%';
      }

      // VU Meter (actualizado en tiempo real desde AudioWorklet)
      const rms = audio.rmsRef.current || 0;
      const db  = 20 * Math.log10(Math.max(0.00001, rms));
      const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
      if (vuFillRef.current) vuFillRef.current.style.width = `${pct}%`;

      // Afinador en tiempo real (desde WASM YIN)
      const pitchHz = audio.pitchHzRef.current;
      if (pitchHz > 0) {
        const note = hzToNote(pitchHz);
        if (noteNameRef.current)  noteNameRef.current.textContent  = note ? note.name : '—';
        if (noteCentsRef.current) noteCentsRef.current.textContent = note ? `${note.cents > 0 ? '+' : ''}${note.cents}¢` : '';
      }

      spectrumRafRef.current = requestAnimationFrame(tick);
    };

    spectrumRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (spectrumRafRef.current) cancelAnimationFrame(spectrumRafRef.current);
    };
  }, []);

  // ── Disparo de Pads & Modo Mono/Poly ───────────────────────────────────────

  const hitPad = useCallback((chop, velocity = 1.0) => {
    setSelectedId(chop.id);
    setPlayingId(chop.id);

    // Actualizar visualizador de nota MIDI
    const chopIdx = chops.findIndex((c) => c.id === chop.id);
    if (chopIdx >= 0) {
      setLastMidiNote(getMidiNoteForPad(chopIdx));
    }

    // Mono corta el sonido anterior; Poly permite superposición de voces
    audio.playChop(chop, { cancelSequence: playMode === 'mono', velocity });
    setTimeout(() => setPlayingId((id) => (id === chop.id ? null : id)), 350);

    // Si el secuenciador está en modo REC, grabar el golpe cuantizado al 1/16
    if (sequencer.isRecording) {
      if (chopIdx >= 0) {
        sequencer.recordHit({
          trackId: 'chops',
          chopIndex: chopIdx,
          velocity,
        });
      }
    }

    // Detectar nota instantáneamente para este corte y mostrarla en el header
    if (audio.bufferRef.current) {
      const pitchResult = detectPitch(audio.bufferRef.current, chop);
      if (pitchResult) {
        audio.pitchHzRef.current = pitchResult.frequency;
        if (noteNameRef.current)  noteNameRef.current.textContent  = pitchResult.note;
        if (noteCentsRef.current) noteCentsRef.current.textContent = `${pitchResult.cents > 0 ? '+' : ''}${pitchResult.cents}¢`;
      }
    }
  }, [audio, playMode, chops, sequencer]);

  // ── Integración Web MIDI ───────────────────────────────────────────────────
  const handleMidiNoteOn = useCallback(({ note, velocity, padIndex, bank: noteBank, globalIndex }) => {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const nName = `${noteNames[note % 12]}${Math.floor(note / 12) - 1}`;
    setLastMidiNote({ note, name: nName, label: `${nName} (#${note})` });

    let targetChop = null;
    if (globalIndex !== null && chops[globalIndex]) {
      targetChop = chops[globalIndex];
      if (noteBank && BANKS.includes(noteBank) && noteBank !== bank) {
        setBank(noteBank);
      }
    } else {
      const offset = BANKS.indexOf(bank) * 16;
      targetChop = chops[offset + padIndex];
    }

    if (targetChop) {
      hitPad(targetChop, velocity);
    }
  }, [chops, bank, hitPad]);

  const handleMidiControlChange = useCallback(({ controller, normalized }) => {
    // CC 1 (Modulation Wheel): controlar Pitch Shift de -12 a +12 semitonos
    if (controller === 1) {
      const newPitch = Math.round((normalized - 0.5) * 24);
      audio.setPitch(newPitch);
    }
  }, [audio]);

  const midi = useMidi({
    onNoteOn: handleMidiNoteOn,
    onControlChange: handleMidiControlChange,
  });

  // ── Atajos de teclado ──────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      const bankOffset = BANKS.indexOf(bank) * 16;
      const idx = PAD_KEYS_LOWER.indexOf(e.key.toLowerCase());
      if (idx < 0) return;
      const chop = chops[bankOffset + idx];
      if (!chop) return;
      e.preventDefault();
      hitPad(chop, 1.0);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [chops, bank, hitPad]);

  // ── Tap Tempo ──────────────────────────────────────────────────────────────
  const handleTap = () => {
    const now = performance.now();
    tapsRef.current = [...tapsRef.current, now].slice(-6);
    if (tapsRef.current.length >= 2) {
      const intervals = tapsRef.current.slice(1).map((t, i) => t - tapsRef.current[i]);
      const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      setBpm(Math.round(60000 / avgMs));
    }
  };

  // ── Interacciones con el Canvas (creación y redimensión) ────────────────────

  const canvasTime = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const buf = audio.bufferRef.current;
    if (!rect.width || !buf || buf.duration <= 0) return 0;
    const visible = buf.duration / (zoomRef.current || 1);
    const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.max(0, Math.min(buf.duration, viewStartRef.current + frac * visible));
  };

  const findChopAt = (t) => chops.find((c) => t >= c.start && t <= c.end);
  const findEdge   = (t) => {
    const canvas = canvasRef.current;
    const buf = audio.bufferRef.current;
    if (!canvas || !buf) return null;
    const rect = canvas.getBoundingClientRect();
    const tol = (buf.duration / (zoomRef.current || 1)) * 14 / (rect.width || 1);
    return chops.find((c) => Math.abs(t - c.start) <= tol || Math.abs(t - c.end) <= tol);
  };

  const handlePointerDown = (e) => {
    if (!audio.bufferRef.current) return;
    const t = canvasTime(e);
    const edge = findEdge(t);
    if (edge) {
      selectChop(edge.id);
      dragRef.current = {
        mode: Math.abs(t - edge.start) <= Math.abs(t - edge.end) ? 'resize-start' : 'resize-end',
        chopId: edge.id,
        start: t,
        current: t,
      };
    } else if (findChopAt(t)) {
      selectChop(findChopAt(t).id);
      dragRef.current = null;
    } else {
      dragRef.current = { mode: 'create', start: t, current: t };
      doDrawWaveform();
    }
    try {
      e.target?.setPointerCapture?.(e.pointerId);
    } catch {}
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current) return;
    const t = canvasTime(e);
    dragRef.current.current = t;
    if (dragRef.current.mode === 'create') {
      doDrawWaveform();
    } else {
      setChops((cur) => cur.map((c) => {
        if (c.id !== dragRef.current.chopId) return c;
        if (dragRef.current.mode === 'resize-start') {
          return { ...c, start: Math.max(0, Math.min(t, c.end - MIN_CUT)) };
        }
        return { ...c, end: Math.min(audio.bufferRef.current.duration, Math.max(t, c.start + MIN_CUT)) };
      }));
    }
  };

  const handlePointerUp = (e) => {
    if (e?.pointerId) {
      try {
        e.target?.releasePointerCapture?.(e.pointerId);
      } catch {}
    }
    if (!dragRef.current || !audio.bufferRef.current) {
      dragRef.current = null;
      return;
    }
    if (dragRef.current.mode !== 'create') {
      dragRef.current = null;
      return;
    }
    const s = Math.max(0, Math.min(dragRef.current.start, dragRef.current.current));
    const end = Math.min(audio.bufferRef.current.duration, Math.max(dragRef.current.start, dragRef.current.current));
    if (end - s >= MIN_CUT) {
      const chop = {
        id: crypto.randomUUID(),
        name: `Chop ${chops.length + 1}`,
        start: s,
        end,
        color: COLORS[chops.length % COLORS.length],
      };
      setChops((cur) => [...cur, chop]);
      selectChop(chop.id);
      audio.setStatus(`"${chop.name}" — ${formatTime(s)} → ${formatTime(end)}`);
    }
    dragRef.current = null;
    doDrawWaveform();
  };

  // ── Acciones de Chops ──────────────────────────────────────────────────────

  const removeChop = (id) => {
    setChops((c) => c.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const selectChop = (id) => {
    setSelectedId(id);
    const chop = chops.find((c) => c.id === id);
    if (chop && audio.bufferRef.current) {
      const result = detectPitch(audio.bufferRef.current, chop);
      if (result) {
        audio.pitchHzRef.current = result.frequency;
        if (noteNameRef.current)  noteNameRef.current.textContent  = result.note;
        if (noteCentsRef.current) noteCentsRef.current.textContent = `${result.cents > 0 ? '+' : ''}${result.cents}¢`;
      }
    }
  };

  const renameChop = (id, newName) => {
    setChops((cur) => cur.map((c) => (c.id === id ? { ...c, name: newName } : c)));
  };

  const clearAllChops = () => {
    if (!chops.length) return;
    setChops([]);
    setSelectedId(null);
    audio.setStatus('Todos los cortes eliminados.');
  };

  // Auto-Slice en 16 cortes
  const autoSlice16 = () => {
    if (!audio.bufferRef.current) return;
    const dur = audio.bufferRef.current.duration;
    const sliceLen = dur / 16;
    const offset = BANKS.indexOf(bank) * 16;
    const generated = Array.from({ length: 16 }, (_, i) => ({
      id: crypto.randomUUID(),
      name: `Chop ${offset + i + 1}`,
      start: i * sliceLen,
      end: Math.min(dur, (i + 1) * sliceLen),
      color: COLORS[i % COLORS.length],
    }));
    setChops(generated);
    setSelectedId(generated[0].id);
    audio.setStatus(`16 cortes automáticos listos en el Banco ${bank}.`);
  };

  const zoomToChop = (chop) => {
    if (!audio.bufferRef.current || !chop) return;
    const pad = Math.max(0.08, (chop.end - chop.start) * 0.35);
    const dur = Math.min(
      audio.bufferRef.current.duration,
      Math.max(chop.end - chop.start + pad * 2, audio.bufferRef.current.duration / 8)
    );
    const nz = Math.min(20, audio.bufferRef.current.duration / dur);
    setZoom(nz);
    setViewStart(Math.max(
      0,
      Math.min(
        audio.bufferRef.current.duration - audio.bufferRef.current.duration / nz,
        chop.start - (dur - (chop.end - chop.start)) / 2
      )
    ));
  };

  const detectNote = () => {
    const chop = chops.find((c) => c.id === selectedId);
    const result = detectPitch(audio.bufferRef.current, chop || null);
    if (result) {
      audio.pitchHzRef.current = result.frequency;
      if (noteNameRef.current)  noteNameRef.current.textContent  = result.note;
      if (noteCentsRef.current) noteCentsRef.current.textContent = `${result.cents > 0 ? '+' : ''}${result.cents}¢`;
      audio.setStatus(`Nota detectada: ${result.note} (${result.frequency.toFixed(1)} Hz ${result.cents > 0 ? '+' : ''}${result.cents}¢) en ${chop ? `"${chop.name}"` : 'sample'}.`);
    } else {
      if (noteNameRef.current)  noteNameRef.current.textContent  = '—';
      if (noteCentsRef.current) noteCentsRef.current.textContent = '';
      audio.setStatus('No se detectó una frecuencia tonal estable en esta sección.');
    }
  };

  const handleLoadFile = async (file) => {
    const decoded = await audio.loadFile(file);
    if (decoded) {
      setChops([]);
      setSelectedId(null);
      setZoom(1);
      setViewStart(0);
      playheadTimeRef.current = null;
      setMobileTab('sampler');
      setTimeout(() => {
        drawWaveformRef.current?.();
        drawPlayheadRef.current?.();
      }, 50);
    }
  };

  // ── Datos derivados ────────────────────────────────────────────────────────
  const bankOffset   = BANKS.indexOf(bank) * 16;
  const bankChops    = Array.from({ length: 16 }, (_, i) => chops[bankOffset + i] ?? null);
  const selectedChop = chops.find((c) => c.id === selectedId);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mpc-shell">

      {/* ── Header Superior ─────────────────────────────────────────────────── */}
      <header className="mpc-header">
        <div className="mpc-logo-group">
          <div className="mpc-logo">VX-CHOP</div>
          <span className="mpc-logo-sub">MPC SAMPLER & SLICER</span>
        </div>

        <div className="header-sep" />

        {/* BPM & Tap */}
        <div className="header-item bpm-header-item">
          <div className="header-label">BPM</div>
          <div className="header-bpm-ctrl">
            <button
              className="bpm-step-btn"
              onClick={() => setBpm((b) => Math.max(30, (Number(b) || 90) - 1))}
              title="Disminuir tempo (-1 BPM)"
            >
              −
            </button>
            <input
              type="number"
              min="30"
              max="300"
              className="header-bpm-input"
              value={bpm}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val)) setBpm(Math.max(30, Math.min(300, val)));
                else if (e.target.value === '') setBpm('');
              }}
              onBlur={() => {
                if (!bpm || Number(bpm) < 30) setBpm(90);
              }}
              title="Escribe directamente el BPM deseado (30 a 300)"
            />
            <button
              className="bpm-step-btn"
              onClick={() => setBpm((b) => Math.min(300, (Number(b) || 90) + 1))}
              title="Aumentar tempo (+1 BPM)"
            >
              +
            </button>
          </div>
        </div>
        <button className="header-tap" onClick={handleTap} title="Tap Tempo: presiona al ritmo para calcular BPM">
          TAP
        </button>

        <div className="header-sep" />

        {/* Afinador / Detección de Nota */}
        <div className="header-item">
          <div className="header-label">Nota</div>
          <div className="header-value" ref={noteNameRef}>—</div>
        </div>
        <div className="header-item" style={{ minWidth: 42 }}>
          <div className="header-label">Cents</div>
          <div className="header-value dim" ref={noteCentsRef} />
        </div>

        <div className="header-sep hide-mobile" />

        {/* Nota MIDI Activa */}
        <div className="header-item hide-mobile" style={{ minWidth: 64 }}>
          <div className="header-label">Nota MIDI</div>
          <div className="header-value" style={{ color: '#55d6be', fontSize: 12, fontWeight: 800 }}>
            {lastMidiNote ? `${lastMidiNote.name} (#${lastMidiNote.note})` : '—'}
          </div>
        </div>

        <div className="header-sep hide-mobile" />

        {/* Chop Activo */}
        <div className="header-item hide-mobile" style={{ minWidth: 90 }}>
          <div className="header-label">Seleccionado</div>
          <div className="header-value dim" style={{ fontSize: 11 }}>
            {selectedChop ? selectedChop.name : '—'}
          </div>
        </div>

        {/* VU Meter Estéreo */}
        <div className="vu-header">
          <span style={{ fontSize: 8, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>Master</span>
          <div className="vu-track-h">
            <div className="vu-fill-h" ref={vuFillRef} />
          </div>
        </div>

        <div className="header-sep" />

        {/* Indicador / Conexión MIDI */}
        <button
          className={`header-midi-btn ${midi.connected ? 'connected' : ''}`}
          onClick={() => setShowMidiModal(true)}
          title="Configuración de Controlador MIDI (Web MIDI API)"
        >
          <span className={`midi-led ${midi.connected ? 'on' : ''}`} />
          <span className="midi-text">
            {midi.connected
              ? `MIDI: ${midi.devices[0]?.name?.slice(0, 10) || 'ON'}`
              : 'MIDI: OFF'}
          </span>
        </button>
      </header>

      {/* ── Barra de Navegación de Vistas (Escritorio y Móvil) ──────────────── */}
      <nav className="mpc-mobile-nav mpc-main-nav" aria-label="Navegación de Vistas">
        <button
          className={`mpc-tab-btn ${mobileTab === 'pads' ? 'active' : ''}`}
          onClick={() => handleSwitchTab('pads')}
        >
          <span className="tab-icon">🎛️</span> PADS (16)
        </button>
        <button
          className={`mpc-tab-btn ${mobileTab === 'sampler' ? 'active' : ''}`}
          onClick={() => handleSwitchTab('sampler')}
        >
          <span className="tab-icon">〰️</span> SAMPLE & ONDA
        </button>
        <button
          className={`mpc-tab-btn ${mobileTab === 'sequencer' ? 'active' : ''}`}
          onClick={() => handleSwitchTab('sequencer')}
        >
          <span className="tab-icon">🎹</span> SECUENCIADOR (BEATS)
        </button>
      </nav>

      {/* ── Vista del Secuenciador Multi-Pista ─────────────────────────────── */}
      <div
        className="mpc-sequencer-view"
        style={{ display: mobileTab === 'sequencer' ? 'flex' : 'none' }}
      >
        <Sequencer
          sequencer={sequencer}
          bpm={bpm || 90}
          setBpm={setBpm}
          chops={chops}
          mainBuffer={audio.buffer}
          pitch={audio.pitch}
          onOpenSampleTab={() => handleSwitchTab('sampler')}
          onHitPad={() => {
            // Para Note Repeat: disparar el chop actualmente seleccionado
            const selectedChop = chops.find((c) => c.id === selectedId);
            if (selectedChop) hitPad(selectedChop, 1.0);
          }}
        />
      </div>

      {/* ── Cuerpo Principal: 2 Columnas Balanceadas ───────────────────────── */}
      <div
        className="mpc-body"
        style={{ display: mobileTab === 'sequencer' ? 'none' : '' }}
      >

        {/* ── Columna Izquierda: Rack de Control y LCD ──────────────────────── */}
        <aside className={`mpc-left ${mobileTab === 'sampler' ? 'mobile-show' : ''}`}>

          {/* Carga de audio compacta */}
          <label
            className="load-zone-strip"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleLoadFile(e.dataTransfer.files[0]); }}
          >
            <div className="load-prompt">
              <strong>{audio.fileInfo !== 'Sin sample cargado' ? audio.fileInfo : 'Cargar sample de audio'}</strong>
              <span>Arrastra un archivo WAV, MP3 u OGG o haz clic</span>
            </div>
            <span className="load-btn-pill">Cargar</span>
            <input type="file" accept="audio/*" onChange={(e) => e.target.files[0] && handleLoadFile(e.target.files[0])} />
          </label>

          {/* Pantalla LCD Waveform */}
          <div className="left-card">
            <div className="card-title-row">
              <span className="card-title">Waveform Display</span>
              <span style={{ fontSize: 9.5, color: 'var(--accent)' }}>
                {selectedChop ? `● ${selectedChop.name} (${formatTime(selectedChop.end - selectedChop.start)})` : 'Arrastra sobre la onda para cortar'}
              </span>
            </div>

            <div className="mpc-screen">
              <div className="screen-top">
                <span>{selectedChop ? selectedChop.name : 'VISTA GENERAL'}</span>
                <span>{formatTime(audio.buffer?.duration || 0)}</span>
              </div>

              <div className="screen-canvas-wrap">
                <canvas
                  ref={canvasRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                />
                <canvas ref={playheadCanvasRef} className="playhead-overlay" />
              </div>

              <div className="duration-bar">
                <span ref={currentTimeLabelRef} className="duration-current">0:00.00</span>
                <div className="duration-track">
                  <div ref={durationFillRef} className="duration-fill" />
                </div>
                <span ref={totalTimeLabelRef} className="duration-total">0:00.00</span>
              </div>

              <div className="screen-bottom">
                <span>{chops.length} cortes creados</span>
                <span>Zoom: {Math.round(zoom * 100)}%</span>
              </div>
            </div>

            {/* Controles de Zoom */}
            <div className="zoom-strip">
              <button className="mpc-btn" style={{ padding: '4px 9px' }} onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>−</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button className="mpc-btn" style={{ padding: '4px 9px' }} onClick={() => setZoom((z) => Math.min(20, z * 1.5))}>+</button>
              <button className="mpc-btn" style={{ padding: '4px 9px' }} onClick={() => { setZoom(1); setViewStart(0); }}>RST</button>
              <button
                className="mpc-btn"
                style={{ padding: '4px 9px', marginLeft: 'auto' }}
                disabled={!selectedId}
                onClick={() => zoomToChop(selectedChop)}
              >
                ⊙ Zoom al corte
              </button>
            </div>

            {/* Mini Analizador de Espectro integrado */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 7.5, color: 'var(--muted)', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 4 }}>
                Espectro en tiempo real
              </div>
              <canvas ref={spectrumCanvasRef} style={{ display: 'block', width: '100%', height: 40, borderRadius: 4, background: '#05100a' }} />
            </div>
          </div>

          {/* Matriz de Herramientas y Transporte */}
          <div className="control-grid">

            {/* Tile 1: Pitch Vinilo */}
            <div className="control-tile">
              <span className="card-title">Pitch Shift</span>
              <div className="pitch-slider-wrap">
                <input
                  type="range"
                  min="-12"
                  max="12"
                  value={audio.pitch}
                  onChange={(e) => audio.setPitch(Number(e.target.value))}
                />
                <span className="pitch-val">{audio.pitch > 0 ? `+${audio.pitch}` : audio.pitch} st</span>
              </div>
            </div>

            {/* Tile 2: Modo de Disparo (Poly / Mono Choke) */}
            <div className="control-tile">
              <span className="card-title">Modo Playback</span>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <div className="led-tag">
                  <span className={`led-dot ${playMode === 'mono' ? 'active' : ''}`} />
                  {playMode === 'mono' ? 'Mono (Choke)' : 'Poly'}
                </div>
                <button
                  className="mpc-btn"
                  style={{ padding: '4px 8px', fontSize: 9 }}
                  onClick={() => setPlayMode((m) => (m === 'mono' ? 'poly' : 'mono'))}
                >
                  {playMode === 'mono' ? 'A Poly' : 'A Mono'}
                </button>
              </div>
            </div>

            {/* Tile 3: Auto-Slice 16 Pads */}
            <div className="control-tile">
              <span className="card-title">Auto-Corte MPC</span>
              <button
                className="mpc-btn auto-slice"
                disabled={!audio.buffer}
                onClick={autoSlice16}
                style={{ marginTop: 4 }}
              >
                ⚡ Auto 16 Slices
              </button>
            </div>

            {/* Tile 4: Afinación Manual */}
            <div className="control-tile">
              <span className="card-title">Afinación</span>
              <button
                className="mpc-btn"
                disabled={!audio.buffer}
                onClick={detectNote}
                style={{ marginTop: 4 }}
              >
                ⟲ Detectar Nota
              </button>
            </div>

          </div>

          {/* Fila de Transporte Master */}
          <div className="left-card" style={{ padding: '10px 14px' }}>
            <div className="mpc-btn-row">
              <button className="mpc-btn" disabled={!chops.length} onClick={() => audio.playAll(chops)}>
                ▶ Play All
              </button>
              <button className="mpc-btn" disabled={!audio.buffer} onClick={() => { audio.stopAll(); audio.setStatus('Detenido.'); }}>
                ■ Stop
              </button>
              <button className="mpc-btn accent" disabled={!chops.length} onClick={() => audio.exportMix(chops)}>
                ⇩ Exportar WAV
              </button>
            </div>
          </div>

          {/* Gestor de Cortes (Chop Manager con edición de nombres) */}
          <div className="chop-manager">
            <div className="card-title-row">
              <span className="card-title">Cortes ({chops.length})</span>
              {chops.length > 0 && (
                <button
                  onClick={clearAllChops}
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 9, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.1em' }}
                >
                  Borrar todos
                </button>
              )}
            </div>

            {chops.length === 0 ? (
              <div className="empty-list-hint">
                No hay cortes creados.<br />
                Usa <strong>⚡ Auto 16</strong> o dibuja sobre el waveform.
              </div>
            ) : (
              <div className="chop-list-side">
                {chops.map((c) => (
                  <div
                    key={c.id}
                    className={`chop-side-item ${selectedId === c.id ? 'selected' : ''}`}
                    onClick={() => selectChop(c.id)}
                  >
                    <div className="chop-side-swatch" style={{ background: c.color }} />
                    <input
                      className="chop-side-input"
                      value={c.name}
                      onChange={(e) => renameChop(c.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      title="Haz clic para renombrar el corte"
                    />
                    <span className="chop-side-dur">{formatTime(c.end - c.start)}</span>
                    <button
                      className="chop-side-play"
                      onClick={(e) => { e.stopPropagation(); hitPad(c); }}
                      title="Escuchar corte"
                    >
                      ▶
                    </button>
                    <button
                      className="chop-side-del"
                      onClick={(e) => { e.stopPropagation(); removeChop(c.id); }}
                      title="Eliminar corte"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </aside>

        {/* ── Columna Derecha: Bancos y Matriz 4x4 de Pads ───────────────────── */}
        <main className={`mpc-right ${mobileTab === 'pads' ? 'mobile-show' : ''}`}>

          {/* Barra de Bancos y Voicing */}
          <div className="bank-bar">
            <span className="bank-label">Banco</span>
            <div className="bank-btns">
              {BANKS.map((b) => (
                <button
                  key={b}
                  className={`bank-btn ${bank === b ? 'active' : ''}`}
                  onClick={() => setBank(b)}
                >
                  {b}
                </button>
              ))}
            </div>

            {/* Selector de Voicing: Mono (Choke) vs Poly */}
            <div className="voice-mode-selector">
              <span className="voice-mode-label">MODO:</span>
              <button
                className={`voice-mode-pill ${playMode === 'mono' ? 'active-mono' : ''}`}
                onClick={() => setPlayMode('mono')}
                title="Mono (Choke): Corta el sonido anterior al pulsar un nuevo pad"
              >
                <span className="pill-dot" />
                MONO
              </button>
              <button
                className={`voice-mode-pill ${playMode === 'poly' ? 'active-poly' : ''}`}
                onClick={() => setPlayMode('poly')}
                title="Poly: Sonidos superpuestos simultáneos (acordes, polifonía)"
              >
                <span className="pill-dot" />
                POLY
              </button>
            </div>

            <span className="bank-chop-count">
              {bankChops.filter(Boolean).length} / 16 cortes asignados
            </span>
          </div>

          {/* Quick Bar para Celulares (Play / Stop / Mono-Poly / Auto-16) */}
          <div className="mobile-quick-bar">
            <button
              className="mpc-btn small"
              disabled={!chops.length}
              onClick={() => audio.playAll(chops)}
            >
              ▶ Play All
            </button>
            <button
              className="mpc-btn small"
              disabled={!audio.buffer}
              onClick={() => { audio.stopAll(); audio.setStatus('Detenido.'); }}
            >
              ■ Stop
            </button>
            <button
              className={`mpc-btn small ${playMode === 'poly' ? 'poly-active' : 'accent'}`}
              onClick={() => setPlayMode((m) => (m === 'mono' ? 'poly' : 'mono'))}
              title="Alternar modo Mono o Poly"
            >
              {playMode === 'mono' ? '● Mono' : '★ Poly'}
            </button>
            <button
              className="mpc-btn small auto-slice"
              disabled={!audio.buffer}
              onClick={autoSlice16}
              style={{ marginLeft: 'auto' }}
            >
              ⚡ Auto 16
            </button>
          </div>

          {/* Matriz 4×4 de Pads */}
          <div className="pad-grid">
            {bankChops.map((chop, i) => {
              const globalIdx = bankOffset + i;
              const isSelected = chop && chop.id === selectedId;
              const isPlaying  = chop && chop.id === playingId;
              const midiInfo   = getMidiNoteForPad(globalIdx);
              return (
                <button
                  key={i}
                  className={[
                    'mpc-pad',
                    chop      ? 'has-chop' : '',
                    isSelected ? 'selected'  : '',
                    isPlaying  ? 'playing'   : '',
                  ].join(' ')}
                  style={chop ? { '--pad-color': chop.color } : {}}
                  onClick={() => { if (chop) hitPad(chop); }}
                >
                  <span className="pad-num">{globalIdx + 1}</span>
                  <span className="pad-name-label">{chop?.name ?? '—'}</span>
                  <div className="pad-footer-row">
                    <span className="pad-midi-badge" title={`Nota MIDI: ${midiInfo.name} (${midiInfo.note})`}>
                      {midiInfo.name} <span className="pad-midi-num">#{midiInfo.note}</span>
                    </span>
                    <span className="pad-key-badge">{PAD_KEYS[i]}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Barra de Atajos de Teclado */}
          <div className="keys-hint">
            Usa el teclado físico: <kbd>1234</kbd> · <kbd>QWER</kbd> · <kbd>ASDF</kbd> · <kbd>ZXCV</kbd> para disparar los pads como en una MPC física
          </div>

        </main>
      </div>

      {/* ── Barra de Estado Inferior ────────────────────────────────────────── */}
      <footer className="mpc-status">
        <span>{audio.status}</span>
        {audio.warning && <span className="warn">⚠ {audio.warning}</span>}
      </footer>

      {/* ── Modal de Configuración MIDI ────────────────────────────────────────── */}
      {showMidiModal && (
        <div className="mpc-modal-overlay" onClick={() => setShowMidiModal(false)}>
          <div className="mpc-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <span className="modal-title-accent">⌨</span> CONTROLADOR MIDI (WEB MIDI API)
              </div>
              <button className="modal-close" onClick={() => setShowMidiModal(false)}>×</button>
            </div>

            <div className="modal-body">
              {/* Estado de conexión */}
              <div className="modal-row">
                <span className="modal-label">Estado del Hardware:</span>
                <span className={`modal-status-badge ${midi.connected ? 'online' : 'offline'}`}>
                  {midi.connected ? '● CONECTADO' : midi.status === 'unsupported' ? 'NO SOPORTADO' : '○ DESCONECTADO'}
                </span>
              </div>

              {/* Dispositivos detectados */}
              <div className="modal-section-title">Dispositivos Detectados:</div>
              {midi.devices.length > 0 ? (
                <div className="midi-device-list">
                  {midi.devices.map((dev) => (
                    <div key={dev.id} className="midi-device-item">
                      <span className="device-bullet">⚡</span>
                      <div className="device-info">
                        <div className="device-name">{dev.name}</div>
                        <div className="device-manuf">{dev.manufacturer || 'Controlador USB / Bluetooth'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="midi-empty-hint">
                  {midi.status === 'unsupported'
                    ? 'Tu navegador actual no soporta Web MIDI. Se recomienda Google Chrome, Microsoft Edge u Opera en PC o Android.'
                    : 'Conecta tu teclado o controlador MIDI por USB/Bluetooth (Akai MPK, Launchpad, Arturia, etc.) y presiona el botón de conexión.'}
                </div>
              )}

              {/* Botón de conectar / escanear */}
              {midi.supported && (
                <button
                  className="mpc-btn accent full-width"
                  style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}
                  onClick={async () => {
                    await midi.connectMidi();
                  }}
                >
                  🔄 {midi.connected ? 'Volver a escanear puertos' : 'Conectar / Permitir Dispositivos MIDI'}
                </button>
              )}

              {/* Monitor de eventos en vivo */}
              <div className="modal-section-title" style={{ marginTop: 14 }}>Monitor de Señal en Vivo:</div>
              <div className="midi-monitor">
                {midi.lastMessage || 'Esperando golpes de pads, teclas o perillas...'}
              </div>

              {/* Guía de Mapeo MPC Estándar */}
              <div className="modal-section-title" style={{ marginTop: 14 }}>Mapeo MPC Estándar:</div>
              <div className="midi-map-grid">
                <div className="map-item"><strong>Banco A:</strong> Notas 36 a 51 (C1 a D#2)</div>
                <div className="map-item"><strong>Banco B:</strong> Notas 52 a 67 (E2 a G3)</div>
                <div className="map-item"><strong>Banco C:</strong> Notas 68 a 83</div>
                <div className="map-item"><strong>Banco D:</strong> Notas 84 a 99</div>
                <div className="map-item"><strong>Velocity:</strong> Sensibilidad dinámica al golpe</div>
                <div className="map-item"><strong>Mod Wheel (CC 1):</strong> Pitch Shift (-12 a +12 st)</div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioEngine } from './hooks/useAudioEngine.js';
import YouTubePlayer from './components/YouTubePlayer.jsx';
import { useSequencer } from './hooks/useSequencer.js';
import Sequencer from './components/Sequencer.jsx';
import { useMidi } from './hooks/useMidi.js';
import MpcHeader from './components/MpcHeader.jsx';
import WaveformDisplay from './components/WaveformDisplay.jsx';
import QLinkPanel from './components/QLinkPanel.jsx';
import RackFxPanel from './components/RackFxPanel.jsx';
import SelectedPadPanel from './components/SelectedPadPanel.jsx';
import PadMatrix from './components/PadMatrix.jsx';
import { formatTime } from './utils/format.js';
import { detectPitch } from './utils/pitch.js';
import { exportChopsKitAsZip } from './utils/exportKitZip.js';
import { exportProjectToJson, importProjectFromJson } from './utils/projectStorage.js';
import { extractAudioFilesFromDataTransfer, combineAudioFilesIntoKit } from './utils/folderDrop.js';
import { loadCachedSample, saveCachedSample, clearCachedSample } from './utils/audioStorage.js';
import { audioBufferToWavArrayBuffer } from './utils/export.js';
import { detectTransients } from './utils/transientDetector.js';
import {
  IconBolt,
  IconDice,
  IconPlay,
  IconStop,
  IconTape,
  IconRecord,
  IconUndo,
  IconRedo,
  IconShuffle,
  IconVideo,
  IconList,
  IconTrash,
  IconCross,
} from './components/Icons.jsx';

// ── Constantes ────────────────────────────────────────────────────────────────

const COLORS = [
  '#b8f05a', '#55d6be', '#ff7a66', '#52a8ff',
  '#f7c95f', '#78e8d0', '#ff9f43', '#e66b8c',
  '#a29bfe', '#fd79a8', '#00cec9', '#fdcb6e',
  '#6c5ce7', '#e17055', '#74b9ff', '#81ecec',
];

const PAD_KEYS_LOWER = ['1','2','3','4','q','w','e','r','a','s','d','f','z','x','c','v'];
const BANKS = ['A', 'B', 'C', 'D'];
const MIN_CUT = 0.03;
const SPECTRUM_BARS = 64;

function formatTimeMs(seconds) {
  if (isNaN(seconds) || seconds === null || seconds === undefined) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function findZeroCrossing(buffer, time, searchWindowSecs = 0.008) {
  if (!buffer || time <= 0) return Math.max(0, time);
  const sampleRate = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const targetSample = Math.floor(time * sampleRate);
  const halfWindow = Math.floor((searchWindowSecs * sampleRate) / 2);
  const startIdx = Math.max(0, targetSample - halfWindow);
  const endIdx = Math.min(data.length - 2, targetSample + halfWindow);

  let bestIdx = targetSample;
  let minDiff = Infinity;

  for (let i = startIdx; i <= endIdx; i++) {
    if (data[i] * data[i + 1] <= 0) {
      const diff = Math.abs(data[i]);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = i;
      }
    }
  }

  return bestIdx / sampleRate;
}

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

  if (Array.isArray(chops)) {
    chops.forEach((c) => {
      if (!c) return;
      const x = toX(c.start);
      const cw = Math.max(1, ((c.end - c.start) / visible) * w);
      ctx.fillStyle = `${c.color || '#00cc66'}28`;
      ctx.fillRect(x, 0, cw, h);
      ctx.strokeStyle = c.color || '#00cc66';
      ctx.lineWidth = c.id === selectedId ? 2 : 1;
      ctx.strokeRect(x, 1, Math.max(1, cw), h - 2);

      if (c.id === selectedId) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 2, 0, 4, h);
        ctx.fillRect(x + cw - 2, 0, 4, h);
      }
    });
  }

  const data = buffer.getChannelData(0);
  const totalLen = data.length;
  const startSample = Math.max(0, Math.min(totalLen - 1, Math.floor((visStart / buffer.duration) * totalLen)));
  const visibleSamples = Math.floor((visible / buffer.duration) * totalLen);
  const step = Math.max(1, visibleSamples / w);
  const subStep = Math.max(1, Math.floor(step / 32));

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

  const w = tw / dpr;
  const h = th / dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (time === null || time === undefined || !buffer || !buffer.duration) return;

  const visible = buffer.duration / (zoom || 1);
  const visStart = Math.max(0, Math.min(viewStart || 0, buffer.duration - visible));
  if (time < visStart || time > visStart + visible) return;

  const x = ((time - visStart) / visible) * w;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, h);
  ctx.stroke();

  ctx.fillStyle = '#00ff88';
  ctx.beginPath();
  ctx.moveTo(x - 5, 0);
  ctx.lineTo(x + 5, 0);
  ctx.lineTo(x, 8);
  ctx.closePath();
  ctx.fill();
}

function renderSpectrum(canvas, analyser) {
  if (!canvas || !analyser) return;
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
  if (!ctx) return;

  const freqData = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(freqData);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#05100a';
  ctx.fillRect(0, 0, w, h);

  const bars = SPECTRUM_BARS;
  const gap = 1.5;
  const barWidth = Math.max(1, (w - (bars - 1) * gap) / bars);
  const binStep = Math.max(1, Math.floor((freqData.length * 0.6) / bars));

  for (let i = 0; i < bars; i++) {
    const val = freqData[i * binStep] / 255;
    const barHeight = Math.max(2, val * (h - 4));
    const x = i * (barWidth + gap);
    const y = h - barHeight;

    const grad = ctx.createLinearGradient(0, y, 0, h);
    grad.addColorStop(0, '#00ff88');
    grad.addColorStop(0.7, '#00aa55');
    grad.addColorStop(1, '#003318');

    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barWidth, barHeight);
  }
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function App() {
  const canvasRef         = useRef(null);
  const playheadCanvasRef = useRef(null);
  const spectrumCanvasRef = useRef(null);
  const projectInputRef   = useRef(null);
  const mainAudioInputRef = useRef(null);

  const vuFillRef           = useRef(null);
  const noteNameRef         = useRef(null);
  const noteCentsRef        = useRef(null);
  const durationFillRef     = useRef(null);
  const currentTimeLabelRef = useRef(null);
  const totalTimeLabelRef   = useRef(null);

  const drawWaveformRef   = useRef(null);
  const drawPlayheadRef   = useRef(null);
  const dragRef           = useRef(null);
  const spectrumRafRef    = useRef(null);

  const zoomRef           = useRef(1);
  const viewStartRef      = useRef(0);
  const selectedIdRef     = useRef(null);
  const chopsRef          = useRef([]);
  const playheadTimeRef   = useRef(null);

  // Estado React
  const [chops,       setChops]      = useState([]);
  const [undoStack,   setUndoStack]  = useState([]);
  const [redoStack,   setRedoStack]  = useState([]);

  const [selectedId,  setSelectedId] = useState(null);
  const [zoom,        setZoom]       = useState(1);
  const [viewStart,   setViewStart]  = useState(0);
  const [bank,        setBank]       = useState('A');
  const [transientSensitivity, setTransientSensitivity] = useState('medium');
  const [playingId,     setPlayingId]    = useState(null);
  const [playMode,      setPlayMode]     = useState('mono');
  const [mobileTab,     setMobileTab]    = useState('pads');
  const [workspaceMode, setWorkspaceMode] = useState(() => (
    typeof window !== 'undefined' && window.innerWidth <= 860 ? 'pads' : 'studio'
  ));
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showYouTubeDrawer, setShowYouTubeDrawer] = useState(false);
  const [showChopListDrawer, setShowChopListDrawer] = useState(false);
  const ytPlayerRef     = useRef(null);
  const ytCurrentTimeRef = useRef(0);

  // Funciones Hardware MPC ONE+
  const [fullLevel,     setFullLevel]     = useState(false);
  const [sixteenLevels, setSixteenLevels] = useState(false);
  const [padMuteMode,   setPadMuteMode]   = useState(false);
  const [mutedPads,     setMutedPads]     = useState(new Set());
  const [showQLink,     setShowQLink]     = useState(false);
  const [showRackFx,    setShowRackFx]    = useState(false);
  const [isLiveChopMode, setIsLiveChopMode] = useState(false);
  const [isExportingKit, setIsExportingKit] = useState(false);
  const [autoSliceEnabled, setAutoSliceEnabled] = useState(false);
  const [selectedPadIndex, setSelectedPadIndex] = useState(0);
  const lastTappedChopRef = useRef(null);

  const tapsRef = useRef([]);
  const [bpm, setBpm] = useState(90);

  // Motor de audio
  const audio = useAudioEngine();

  // Historial Undo / Redo para Chops
  const setChopsWithHistory = useCallback((action, addToHistory = true) => {
    setChops((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      if (addToHistory && prev !== next) {
        setUndoStack((u) => [...u.slice(-30), prev]);
        setRedoStack([]);
      }
      return next;
    });
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((u) => {
      if (u.length === 0) return u;
      const previous = u[u.length - 1];
      const newUndo = u.slice(0, -1);
      setRedoStack((r) => [...r.slice(-30), chopsRef.current]);
      setChops(previous);
      if (previous.length > 0) setSelectedId(previous[0].id);
      audio.setStatus('Deshecho (Undo).');
      return newUndo;
    });
  }, [audio]);

  const handleRedo = useCallback(() => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const next = r[r.length - 1];
      const newRedo = r.slice(0, -1);
      setUndoStack((u) => [...u.slice(-30), chopsRef.current]);
      setChops(next);
      if (next.length > 0) setSelectedId(next[0].id);
      audio.setStatus('Rehecho (Redo).');
      return newRedo;
    });
  }, [audio]);

  // ── Auto-guardado y Restauración Persistente (IndexedDB + LocalStorage) ────
  const isLoadedRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        // 1. Restaurar metadatos y cortes de sesión desde LocalStorage
        const saved = localStorage.getItem('vxchop_autosave');
        if (saved) {
          const data = JSON.parse(saved);
          if (data && Array.isArray(data.chops) && data.chops.length > 0) {
            setChops(data.chops);
            if (data.selectedId) setSelectedId(data.selectedId);
            if (data.bpm) setBpm(data.bpm);
            if (typeof data.pitch === 'number') audio.setPitch(data.pitch);
            if (data.playMode) setPlayMode(data.playMode);
            if (data.bank) setBank(data.bank);
            if (data.qlinks) {
              if (data.qlinks.cutoff) audio.setCutoff(data.qlinks.cutoff);
              if (data.qlinks.resonance) audio.setResonance(data.qlinks.resonance);
              if (data.qlinks.decay) audio.setDecay(data.qlinks.decay);
              if (data.qlinks.drive !== undefined) audio.setDrive(data.qlinks.drive);
              if (data.qlinks.vinyl !== undefined) audio.setVinylCrackle(data.qlinks.vinyl);
            }
          }
        }

        // 2. Restaurar binario del sample de audio completo desde IndexedDB
        const cached = await loadCachedSample();
        if (cached && cached.arrayBuffer) {
          await audio.ensureInit();
          const ctx = audio.audioContextRef.current;
          const decoded = await ctx.decodeAudioData(cached.arrayBuffer.slice(0));
          audio.bufferRef.current = decoded;
          audio.setBuffer(decoded);
          audio.setFileInfo(cached.fileInfo || 'Sample restaurado');
          audio.setStatus(`Sesión y sample restaurados (${formatTime(decoded.duration)}).`);
          setTimeout(() => {
            drawWaveformRef.current?.();
            drawPlayheadRef.current?.();
          }, 80);
        } else if (saved) {
          audio.setStatus('Sesión anterior restaurada.');
        }
      } catch (err) {
        console.warn('Error al restaurar auto-guardado o sample:', err);
      } finally {
        isLoadedRef.current = true;
      }
    })();
  }, []);

  useEffect(() => {
    if (!isLoadedRef.current) return;
    const timer = setTimeout(() => {
      try {
        const payload = {
          timestamp: Date.now(),
          bpm,
          pitch: audio.pitch,
          playMode,
          bank,
          selectedId,
          qlinks: {
            cutoff: audio.cutoff,
            resonance: audio.resonance,
            decay: audio.decay,
            drive: audio.drive,
            vinyl: audio.vinylCrackle,
          },
          chops,
        };
        localStorage.setItem('vxchop_autosave', JSON.stringify(payload));
      } catch (err) {
        console.warn('Error en autosave:', err);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [chops, bpm, audio.pitch, playMode, bank, selectedId, audio.cutoff, audio.resonance, audio.decay, audio.drive, audio.vinylCrackle]);

  // Secuenciador
  const sequencer = useSequencer({
    getAudioContext: () => audio.audioContextRef.current,
    getDestination: audio.getDestination,
    ensureInit: audio.ensureInit,
    chops,
    bpm: bpm || 90,
    playMode,
    playChop: audio.playChop,
    onKickTrigger: audio.triggerSidechainKick,
  });

  // Mirror refs
  useEffect(() => { zoomRef.current       = zoom;       }, [zoom]);
  useEffect(() => { viewStartRef.current  = viewStart;  }, [viewStart]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { chopsRef.current      = chops;      }, [chops]);

  // Disparo de pads
  const hitPad = useCallback(async (chop, velocity = 1.0, padIdx = null) => {
    if (!chop) return;

    if (padMuteMode) {
      setMutedPads((prev) => {
        const next = new Set(prev);
        if (next.has(chop.id)) {
          next.delete(chop.id);
          audio.setStatus(`🔊 Pad reactivado: ${chop.name}`);
        } else {
          next.add(chop.id);
          audio.setStatus(`🔇 Pad silenciado (Mute): ${chop.name}`);
        }
        return next;
      });
      return;
    }

    if (mutedPads.has(chop.id)) {
      audio.setStatus(`Pad ${chop.name} está silenciado (Muted). Desactiva PAD MUTE.`);
      return;
    }

    setPlayingId(chop.id);

    let pitchOffset = 0;
    if (sixteenLevels && padIdx !== null && padIdx >= 0 && padIdx < 16) {
      pitchOffset = padIdx - 8;
    }

    if (playMode === 'mono') {
      await audio.playChop(chop, { cancelSequence: true, velocity, pitchOffset });
    } else {
      await audio.playChop(chop, { cancelSequence: false, velocity, pitchOffset });
    }

    if (chop.name && /kick|bombo/i.test(chop.name)) {
      audio.triggerSidechainKick();
    }

    if (sequencer.isRecording) {
      const padTarget = (padIdx !== null && padIdx >= 0) ? padIdx : chops.findIndex((c) => c && c.id === chop.id);
      sequencer.recordHit({
        trackId: padTarget >= 0 ? `pad-${padTarget}` : 'pad-0',
        padIndex: padTarget >= 0 ? padTarget : 0,
        chopIndex: padTarget >= 0 ? padTarget : 0,
        velocity,
      });
    }
  }, [padMuteMode, mutedPads, playMode, audio, sixteenLevels, sequencer, chops]);

  // Capturar corte al vuelo (Live Tap)
  const tapChopAtCurrentTime = useCallback((targetGlobalIndex) => {
    let nowSec = 0;
    if (ytPlayerRef.current && typeof ytPlayerRef.current.getCurrentTime === 'function' && ytPlayerRef.current.getPlayerState() === 1) {
      nowSec = ytPlayerRef.current.getCurrentTime();
    } else if (audio.isContinuousPlaying) {
      nowSec = audio.getContinuousCurrentTime();
    } else if (audio.bufferRef.current) {
      nowSec = viewStartRef.current;
    }

    if (lastTappedChopRef.current) {
      const prev = lastTappedChopRef.current;
      setChopsWithHistory((prevChops) => {
        return prevChops.map((c) => {
          if (c && c.id === prev.id) {
            return { ...c, end: Math.max(c.start + MIN_CUT, nowSec) };
          }
          return c;
        });
      });
    }

    const cleanStart = findZeroCrossing(audio.bufferRef.current, nowSec);
    const newChop = {
      id: crypto.randomUUID(),
      name: `Chop ${targetGlobalIndex + 1}`,
      start: cleanStart,
      end: cleanStart + 0.5,
      color: COLORS[targetGlobalIndex % COLORS.length],
    };

    setChopsWithHistory((prevChops) => {
      const next = [...prevChops];
      next[targetGlobalIndex] = newChop;
      return next;
    });

    setSelectedId(newChop.id);
    lastTappedChopRef.current = newChop;
    audio.setStatus(`● Live Chop ${targetGlobalIndex + 1} capturado en ${formatTimeMs(nowSec)}`);
  }, [audio, setChopsWithHistory]);

  // Web MIDI nativo
  const midi = useMidi({
    onNoteOn: ({ globalIndex, bank: midiBank, padIndex, velocity }) => {
      const targetIdx = globalIndex !== null ? globalIndex : (BANKS.indexOf(midiBank || 'A') * 16 + padIndex);
      const targetChop = chops[targetIdx];
      if (targetChop) {
        setSelectedId(targetChop.id);
        hitPad(targetChop, fullLevel ? 1.0 : velocity, padIndex);
      } else if (audio.bufferRef.current) {
        tapChopAtCurrentTime(targetIdx);
      }
    },
  });

  // Funciones de dibujado de canvas dinámico (Buffer del pad seleccionado o buffer global)
  const lastSelectedBufferRef = useRef(null);

  const doDrawWaveform = () => {
    const curChop = chopsRef.current.find((c) => c && c.id === selectedIdRef.current);
    const curBuffer = curChop?.buffer || audio.bufferRef.current;
    const isSingleChopBuffer = Boolean(curChop?.buffer);
    const chopsToDraw = isSingleChopBuffer && curChop ? [curChop] : chopsRef.current;

    renderWaveform(canvasRef.current, {
      buffer: curBuffer,
      chops: chopsToDraw,
      selectedId: selectedIdRef.current,
      zoom: zoomRef.current,
      viewStart: viewStartRef.current,
      drag: dragRef.current,
    });
  };

  const doDrawPlayhead = () => {
    const curChop = chopsRef.current.find((c) => c && c.id === selectedIdRef.current);
    const curBuffer = curChop?.buffer || audio.bufferRef.current;
    renderPlayhead(playheadCanvasRef.current, {
      time: playheadTimeRef.current,
      buffer: curBuffer,
      zoom: zoomRef.current,
      viewStart: viewStartRef.current,
    });
  };

  drawWaveformRef.current = doDrawWaveform;
  drawPlayheadRef.current = doDrawPlayhead;

  useEffect(() => {
    const curChop = chops.find((c) => c && c.id === selectedId);
    const curBuffer = curChop?.buffer || audio.buffer;
    if (curBuffer && curBuffer !== lastSelectedBufferRef.current) {
      lastSelectedBufferRef.current = curBuffer;
      setZoom(1);
      setViewStart(0);
    }
    doDrawWaveform();
    doDrawPlayhead();
  }, [audio.buffer, chops, selectedId, zoom, viewStart, mobileTab, workspaceMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onResize = () => {
      drawWaveformRef.current?.();
      drawPlayheadRef.current?.();
    };

    window.addEventListener('resize', onResize);
    let ro = null;
    if (canvas.parentElement && window.ResizeObserver) {
      ro = new ResizeObserver(() => onResize());
      ro.observe(canvas.parentElement);
    }
    onResize();

    return () => {
      window.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
    };
  }, []);

  // Prevenir cualquier desplazamiento horizontal residual (Layout Shift Guard)
  useEffect(() => {
    const resetScroll = () => {
      window.scrollTo(0, 0);
      if (document.body) document.body.scrollLeft = 0;
      if (document.documentElement) document.documentElement.scrollLeft = 0;
    };
    resetScroll();
    window.addEventListener('resize', resetScroll);
    return () => window.removeEventListener('resize', resetScroll);
  }, []);

  // Ciclo rAF continuo: spectrum + playhead + VU + pitch
  useEffect(() => {
    const tick = () => {
      renderSpectrum(spectrumCanvasRef.current, audio.analyserRef.current);

      const state = audio.playbackStateRef.current;
      const ctx   = audio.audioContextRef.current;
      const curChop = chopsRef.current.find((c) => c && c.id === selectedIdRef.current);
      const buf   = curChop?.buffer || audio.bufferRef.current;
      const refChop = state?.chop || curChop;
      const total = refChop ? refChop.end - refChop.start : (buf?.duration || 0);

      if (audio.isContinuousPlaying) {
        const curSec = audio.getContinuousCurrentTime();
        playheadTimeRef.current = curSec;
        drawPlayheadRef.current?.();
        if (currentTimeLabelRef.current) currentTimeLabelRef.current.textContent = formatTime(curSec);
        if (totalTimeLabelRef.current)   totalTimeLabelRef.current.textContent   = formatTime(buf?.duration || 0);
        if (durationFillRef.current && buf?.duration > 0) {
          durationFillRef.current.style.width = `${Math.min(100, (curSec / buf.duration) * 100)}%`;
        }
      } else if (state && ctx && refChop) {
        const elapsed = (ctx.currentTime - state.startAudioTime) * state.rate;
        const curSec  = refChop.start + Math.max(0, Math.min(refChop.end - refChop.start, elapsed));
        playheadTimeRef.current = curSec;
        drawPlayheadRef.current?.();

        const currentInChop = Math.max(0, Math.min(total, elapsed));
        if (currentTimeLabelRef.current) currentTimeLabelRef.current.textContent = formatTime(currentInChop);
        if (totalTimeLabelRef.current)   totalTimeLabelRef.current.textContent   = formatTime(total);
        if (durationFillRef.current && total > 0) {
          durationFillRef.current.style.width = `${Math.min(100, (currentInChop / total) * 100)}%`;
        }
      } else {
        if (!audio.isContinuousPlaying) {
          playheadTimeRef.current = null;
          drawPlayheadRef.current?.();
          setPlayingId(null);
        }
        if (currentTimeLabelRef.current) currentTimeLabelRef.current.textContent = '0:00.00';
        if (totalTimeLabelRef.current)   totalTimeLabelRef.current.textContent   = formatTime(total);
        if (durationFillRef.current)     durationFillRef.current.style.width     = '0%';
      }

      if (vuFillRef.current) {
        const rms = audio.rmsRef?.current ?? 0;
        const pct = Math.min(100, Math.round(Math.sqrt(rms) * 115));
        vuFillRef.current.style.width = `${pct}%`;
      }

      spectrumRafRef.current = requestAnimationFrame(tick);
    };

    spectrumRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(spectrumRafRef.current);
  }, [audio]);

  // Cargar archivo de audio local
  const handleLoadFile = useCallback(async (file, options = {}) => {
    if (!file) return;
    audio.setStatus(`Cargando ${file.name}...`);
    try {
      const decoded = await audio.loadFile(file);
      if (!decoded) return;
      setSelectedId(null);
      setZoom(1);
      setViewStart(0);
      playheadTimeRef.current = null;

      const shouldSlice = options.autoSlice !== undefined ? options.autoSlice : autoSliceEnabled;
      if (shouldSlice) {
        setBank('A');
        const dur = decoded.duration;
        const sliceLen = dur / 16;
        const generated = Array.from({ length: 16 }, (_, i) => ({
          id: crypto.randomUUID(),
          name: `Chop ${i + 1}`,
          start: i * sliceLen,
          end: Math.min(dur, (i + 1) * sliceLen),
          color: COLORS[i % COLORS.length],
        }));
        setChopsWithHistory(generated);
        setSelectedId(generated[0].id);
        audio.setStatus(`🎉 ¡${file.name} cortado en 16 chops en los pads!`);
      } else {
        // Auto-Slice desactivado: asigna este audio completo como sample al Pad #1
        const cleanName = file.name.replace(/\.[^/.]+$/, '');
        const pad1Chop = {
          id: crypto.randomUUID(),
          name: cleanName || 'Sample 1',
          start: 0,
          end: Number(decoded.duration.toFixed(4)),
          color: COLORS[0],
          buffer: decoded,
        };
        setChopsWithHistory((prev) => {
          const next = [...prev];
          next[0] = pad1Chop;
          return next;
        });
        setSelectedId(pad1Chop.id);
        audio.setStatus(`🎵 "${file.name}" listo en Pad #1. (Auto-Slice desactivado)`);
      }
      setTimeout(() => {
        drawWaveformRef.current?.();
        drawPlayheadRef.current?.();
      }, 50);
    } catch (err) {
      console.error('Error al cargar audio:', err);
    }
  }, [audio, autoSliceEnabled, setChopsWithHistory]);

  // Cargar Audio de YouTube
  const handleLoadYtIntoMpc = useCallback(async (videoId, title) => {
    if (!videoId) return;
    audio.setStatus('Descargando y decodificando audio de YouTube...');
    try {
      const res = await fetch(`/api/yt-audio?id=${encodeURIComponent(videoId)}`);
      if (!res.ok) {
        throw new Error(`El servidor respondió con status ${res.status}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      const copyBuffer = arrayBuffer.slice(0);
      await audio.ensureInit();
      const ctx = audio.audioContextRef.current;
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      audio.bufferRef.current = decoded;
      audio.setBuffer(decoded);
      const fileInfoStr = `${title || 'YouTube Audio'} · ${formatTime(decoded.duration)} · ${decoded.sampleRate} Hz · ${decoded.numberOfChannels}ch`;
      audio.setFileInfo(fileInfoStr);
      saveCachedSample(copyBuffer, fileInfoStr).catch(() => {});
      audio.setStatus('¡Audio de YouTube cargado con éxito en la MPC!');
      setChopsWithHistory([]);
      setSelectedId(null);
      setZoom(1);
      setViewStart(0);
      playheadTimeRef.current = null;
      setMobileTab('sampler');
      setTimeout(() => {
        drawWaveformRef.current?.();
        drawPlayheadRef.current?.();
      }, 50);
    } catch (err) {
      console.warn('Error al cargar audio de YouTube en MPC:', err);
      audio.setStatus('Para transferir a la onda, asegúrate de iniciar con INICIAR_VX_CHOP.bat');
      alert(
        'Para transferir el audio de YouTube a la forma de onda de la MPC:\n\n' +
        '1. Abre la aplicación con INICIAR_VX_CHOP.bat\n' +
        '2. ¡O puedes samplear directamente al compás con LIVE TAP sobre YouTube sin necesidad de descargarlo!'
      );
    }
  }, [audio, setChopsWithHistory]);

  // Captura de micrófono / pestaña
  const handleAudioCaptured = useCallback(async (audioBuffer, title = 'Muestra Grabada') => {
    if (!audioBuffer) return;
    await audio.ensureInit();
    audio.bufferRef.current = audioBuffer;
    audio.setBuffer(audioBuffer);
    const fileInfoStr = `${title} · ${formatTime(audioBuffer.duration)} · ${audioBuffer.sampleRate} Hz`;
    audio.setFileInfo(fileInfoStr);
    try {
      const wavBuf = audioBufferToWavArrayBuffer(audioBuffer);
      saveCachedSample(wavBuf, fileInfoStr).catch(() => {});
    } catch {}
    audio.setStatus(`Grabación cargada en la MPC con éxito (${formatTime(audioBuffer.duration)}).`);
    setChopsWithHistory([]);
    setSelectedId(null);
    setZoom(1);
    setViewStart(0);
    setMobileTab('sampler');
    setTimeout(() => {
      drawWaveformRef.current?.();
      drawPlayheadRef.current?.();
    }, 40);
  }, [audio, setChopsWithHistory]);

  // Atajos de teclado globales
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

      // Ctrl+Z / Ctrl+Y
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Ayuda rápida de atajos (? o F1) / Escape para cerrar
      if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        setShowShortcutsModal((v) => !v);
        return;
      }
      if (e.key === 'Escape') {
        setShowShortcutsModal(false);
      }

      // Espacio: Play / Pause del tema continuo
      if (e.code === 'Space') {
        e.preventDefault();
        if (audio.isContinuousPlaying) {
          audio.stopContinuous();
        } else {
          const curChop = chopsRef.current.find((c) => c && c.id === selectedIdRef.current);
          const targetBuf = curChop?.buffer || audio.bufferRef.current;
          if (targetBuf) {
            audio.playContinuous(viewStartRef.current, targetBuf);
          }
        }
        return;
      }

      // Supr / Backspace: Borrar chop activo
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIdRef.current) {
          e.preventDefault();
          const targetId = selectedIdRef.current;
          setChopsWithHistory((c) => c.filter((x) => x.id !== targetId));
          setSelectedId(null);
        }
        return;
      }

      // Tab: Cambiar de Banco A -> B -> C -> D
      if (e.key === 'Tab') {
        e.preventDefault();
        setBank((curr) => {
          const idx = BANKS.indexOf(curr);
          const next = e.shiftKey ? (idx - 1 + 4) % 4 : (idx + 1) % 4;
          return BANKS[next];
        });
        return;
      }

      if (e.repeat) return;

      const bankOffset = BANKS.indexOf(bank) * 16;
      const idx = PAD_KEYS_LOWER.indexOf(e.key.toLowerCase());
      if (idx < 0) return;
      const globalIdx = bankOffset + idx;
      const chop = chops[globalIdx];
      if (!chop) {
        if (audio.bufferRef.current) {
          if (isLiveChopMode && audio.isContinuousPlaying) {
            e.preventDefault();
            tapChopAtCurrentTime(globalIdx);
          } else if (chops.length === 0) {
            e.preventDefault();
            autoSlice16();
          }
        }
        return;
      }
      e.preventDefault();
      if (isLiveChopMode && audio.isContinuousPlaying && e.shiftKey) {
        tapChopAtCurrentTime(globalIdx);
        return;
      }
      hitPad(chop, fullLevel ? 1.0 : 1.0, idx);
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [chops, bank, hitPad, audio, isLiveChopMode, tapChopAtCurrentTime, handleUndo, handleRedo, setChopsWithHistory, fullLevel]);

  // Tap tempo
  const handleTap = () => {
    const now = performance.now();
    tapsRef.current = [...tapsRef.current, now].slice(-6);
    if (tapsRef.current.length >= 2) {
      const intervals = tapsRef.current.slice(1).map((t, i) => t - tapsRef.current[i]);
      const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      setBpm(Math.round(60000 / avgMs));
    }
  };

  // Interacciones con el canvas
  const canvasTime = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const curChop = chopsRef.current.find((c) => c && c.id === selectedIdRef.current);
    const buf = curChop?.buffer || audio.bufferRef.current;
    if (!rect.width || !buf || buf.duration <= 0) return 0;
    const visible = buf.duration / (zoomRef.current || 1);
    const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.max(0, Math.min(buf.duration, viewStartRef.current + frac * visible));
  };

  const handlePointerDown = (e) => {
    const curChop = chopsRef.current.find((c) => c && c.id === selectedIdRef.current);
    const buf = curChop?.buffer || audio.bufferRef.current;
    if (!buf) return;
    const t = canvasTime(e);
    const canvas = canvasRef.current;
    if (canvas) canvas.setPointerCapture(e.pointerId);

    const visible = buf.duration / zoomRef.current;
    const handleThreshold = visible * 0.025;

    const chopsToInspect = curChop?.buffer && curChop
      ? [curChop]
      : chopsRef.current;

    for (let i = chopsToInspect.length - 1; i >= 0; i--) {
      const c = chopsToInspect[i];
      if (!c) continue;
      if (Math.abs(t - c.start) < handleThreshold) {
        dragRef.current = { mode: 'resize-start', chopId: c.id, initStart: c.start };
        setSelectedId(c.id);
        return;
      }
      if (Math.abs(t - c.end) < handleThreshold) {
        dragRef.current = { mode: 'resize-end', chopId: c.id, initEnd: c.end };
        setSelectedId(c.id);
        return;
      }
    }

    const clicked = chopsToInspect.find((c) => c && t >= c.start && t <= c.end);
    if (clicked) {
      setSelectedId(clicked.id);
      dragRef.current = { mode: 'select', chopId: clicked.id };
      hitPad(clicked, 1.0);
      return;
    }

    dragRef.current = { mode: 'create', start: t, current: t };
    doDrawWaveform();
  };

  const handlePointerMove = (e) => {
    const curChop = chopsRef.current.find((c) => c && c.id === selectedIdRef.current);
    const buf = curChop?.buffer || audio.bufferRef.current;
    if (!dragRef.current || !buf) return;
    const t = canvasTime(e);
    const mode = dragRef.current.mode;

    if (mode === 'create') {
      dragRef.current.current = t;
      doDrawWaveform();
    } else if (mode === 'resize-start') {
      const chopId = dragRef.current.chopId;
      setChopsWithHistory((cur) => cur.map((c) => {
        if (!c || c.id !== chopId) return c;
        const newStart = Math.min(c.end - MIN_CUT, Math.max(0, t));
        return { ...c, start: newStart };
      }), false);
    } else if (mode === 'resize-end') {
      const chopId = dragRef.current.chopId;
      const dur = buf.duration;
      setChopsWithHistory((cur) => cur.map((c) => {
        if (!c || c.id !== chopId) return c;
        const newEnd = Math.max(c.start + MIN_CUT, Math.min(dur, t));
        return { ...c, end: newEnd };
      }), false);
    }
  };

  const handlePointerUp = () => {
    if (!dragRef.current) return;
    const { mode, start, current } = dragRef.current;
    dragRef.current = null;

    if (mode === 'create' && typeof start === 'number' && typeof current === 'number') {
      const t0 = Math.min(start, current);
      const t1 = Math.max(start, current);
      if (t1 - t0 >= MIN_CUT) {
        // Encontrar el primer slot vacío en el banco actual
        const bankOff = BANKS.indexOf(bank) * 16;
        let targetIdx = chops.length; // default: append
        for (let s = bankOff; s < bankOff + 16; s++) {
          if (!chops[s]) { targetIdx = s; break; }
        }
        const chop = {
          id: crypto.randomUUID(),
          name: `Chop ${targetIdx + 1}`,
          start: t0,
          end: t1,
          color: COLORS[targetIdx % COLORS.length],
        };
        setChopsWithHistory((cur) => {
          const next = [...cur];
          next[targetIdx] = chop;
          return next;
        });
        setSelectedId(chop.id);
        hitPad(chop, 1.0);
      }
    }
    doDrawWaveform();
  };

  // Acciones de Chops
  const removeChop = (id) => {
    setChopsWithHistory((c) => c.filter((x) => x && x.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const selectChop = (id) => {
    setSelectedId(id);
    const chop = chops.find((c) => c && c.id === id);
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
    setChopsWithHistory((cur) => cur.map((c) => (c && c.id === id ? { ...c, name: newName } : c)));
  };

  const clearAllChops = () => {
    if (!chops.some(Boolean)) return;
    setChopsWithHistory([]);
    setSelectedId(null);
    audio.setStatus('Todos los cortes eliminados.');
  };

  const autoSlice16 = () => {
    if (!audio.bufferRef.current) return;
    const dur = audio.bufferRef.current.duration;
    const sliceLen = dur / 16;
    setBank('A');
    const generated = Array.from({ length: 16 }, (_, i) => ({
      id: crypto.randomUUID(),
      name: `Chop ${i + 1}`,
      start: i * sliceLen,
      end: Math.min(dur, (i + 1) * sliceLen),
      color: COLORS[i % COLORS.length],
    }));
    setChopsWithHistory(generated);
    setSelectedId(generated[0].id);
    audio.setStatus(`16 cortes automáticos listos — cada pad tiene su propio chop.`);
  };

  const autoSliceTransients = useCallback((sens = transientSensitivity) => {
    if (!audio.bufferRef.current) {
      audio.setStatus('Carga un sample primero para detectar transitorios.');
      return;
    }
    const buf = audio.bufferRef.current;
    const slices = detectTransients(buf, { sensitivity: sens, maxChops: 16 });
    if (!slices || slices.length === 0) {
      audio.setStatus('No se encontraron transitorios suficientes. Prueba con sensibilidad Alta.');
      return;
    }
    setBank('A');
    const cleanSampleName = (audio.fileInfo || '').split('·')[0].trim().replace(/\.[^/.]+$/, '');
    const isOneShot = slices.length === 1;

    const generated = slices.map((s, i) => ({
      id: crypto.randomUUID(),
      name: isOneShot
        ? (cleanSampleName || 'Golpe 1')
        : `Hit ${i + 1}`,
      start: s.start,
      end: s.end,
      color: COLORS[i % COLORS.length],
      attack: 0.003,
      release: 0.008,
    }));
    setChopsWithHistory(generated);
    if (generated.length > 0) setSelectedId(generated[0].id);
    const labelSens = { low: 'Baja', medium: 'Media', high: 'Alta' }[sens] || sens;
    if (isOneShot) {
      audio.setStatus(`⚡ Golpe único (One-Shot): Asignado completo al Pad #1 sin fragmentar.`);
    } else {
      audio.setStatus(`⚡ ${generated.length} cortes por transitorios listos (Sensibilidad: ${labelSens}).`);
    }
  }, [audio, transientSensitivity, setChopsWithHistory]);

  const handleUpdateEnvelope = useCallback((chopId, { attack, release }) => {
    if (!chopId) return;
    setChopsWithHistory((prev) => prev.map((c) => {
      if (!c || c.id !== chopId) return c;
      return {
        ...c,
        ...(attack !== undefined ? { attack } : {}),
        ...(release !== undefined ? { release } : {}),
      };
    }), false);
  }, [setChopsWithHistory]);

  const nudgeChop = useCallback((chopId, deltaSecs) => {
    if (!audio.bufferRef.current || !chopId) return;
    const buf = audio.bufferRef.current;
    setChopsWithHistory((prevChops) => {
      return prevChops.map((c) => {
        if (!c || c.id !== chopId) return c;
        const rawNewStart = c.start + deltaSecs;
        const clampedStart = Math.max(0, Math.min(c.end - 0.03, rawNewStart));
        const cleanStart = findZeroCrossing(buf, clampedStart);
        const updated = { ...c, start: cleanStart };
        audio.playChop(updated, { cancelSequence: true });
        return updated;
      });
    });
    audio.setStatus(`Ajuste fino: ${deltaSecs > 0 ? `+${deltaSecs}` : deltaSecs}s (Zero-Crossing)`);
  }, [audio, setChopsWithHistory]);

  const randomizeChops = useCallback((count = 16) => {
    if (!audio.bufferRef.current) return;
    const dur = audio.bufferRef.current.duration;
    if (dur <= 0.4) return;

    const buf = audio.bufferRef.current;
    const offset = BANKS.indexOf(bank) * 16;
    const generated = [];
    const numSlices = Math.min(16, count);
    const sectionLen = dur / numSlices;

    for (let i = 0; i < numSlices; i++) {
      const baseStart = i * sectionLen;
      const jitter = (Math.random() - 0.15) * (sectionLen * 0.45);
      const rawStart = Math.max(0, Math.min(dur - 0.15, baseStart + jitter));
      const cleanStart = findZeroCrossing(buf, rawStart);
      const targetDuration = Math.max(0.3, Math.min(sectionLen * 1.25, 0.4 + Math.random() * 1.5));
      const rawEnd = Math.min(dur, cleanStart + targetDuration);
      const cleanEnd = findZeroCrossing(buf, rawEnd);

      generated.push({
        id: crypto.randomUUID(),
        name: `Chop ${offset + i + 1}`,
        start: cleanStart,
        end: Math.max(cleanStart + 0.05, cleanEnd),
        color: COLORS[i % COLORS.length],
      });
    }

    setChopsWithHistory(generated);
    setSelectedId(generated[0]?.id || null);
    audio.setStatus(`🎲 ${numSlices} cortes aleatorios musicales creados en Banco ${bank}.`);
  }, [audio, bank, setChopsWithHistory]);

  const shuffleChops = useCallback(() => {
    if (chops.length < 2) return;
    setChopsWithHistory((prev) => {
      const shuffled = [...prev];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    });
    audio.setStatus('🔀 Cortes reordenados aleatoriamente entre los pads.');
  }, [chops, audio, setChopsWithHistory]);

  const jumpToRandomPosition = useCallback(() => {
    if (!audio.bufferRef.current) return;
    const dur = audio.bufferRef.current.duration;
    const randomSec = Math.max(0, Math.random() * dur * 0.85);
    audio.playContinuous(randomSec);
    setViewStart(Math.max(0, Math.min(dur - dur / zoom, randomSec - (dur / zoom) * 0.2)));
    audio.setStatus(`🎯 Aguja soltada en ${formatTimeMs(randomSec)}`);
  }, [audio, zoom]);

  const handleExportKitZip = useCallback(async () => {
    if (!audio.bufferRef.current || chops.length === 0) return;
    setIsExportingKit(true);
    try {
      await exportChopsKitAsZip(audio.bufferRef.current, chops, audio.pitch, 'VxChop_Kit');
      audio.setStatus(`📦 Kit de ${chops.length} chops exportado a ZIP con éxito.`);
    } catch (err) {
      console.error('Error al exportar kit ZIP:', err);
      audio.setStatus('Error al generar archivo ZIP.');
    } finally {
      setIsExportingKit(false);
    }
  }, [audio, chops]);

  const clearSingleChop = useCallback((id) => {
    if (!id) return;
    setChopsWithHistory((prev) => prev.map((c) => (c?.id === id ? null : c)));
    if (selectedId === id) setSelectedId(null);
    audio.setStatus('Pad vaciado. Listo para asignar un nuevo sonido.');
  }, [selectedId, audio, setChopsWithHistory]);

  const zoomToChop = (chop) => {
    if (!audio.bufferRef.current || !chop) return;
    const pad = Math.max(0.08, (chop.end - chop.start) * 0.35);
    const dur = Math.min(
      audio.bufferRef.current.duration,
      Math.max(chop.end - chop.start + pad * 2, audio.bufferRef.current.duration / 8)
    );
    const newZoom = Math.min(20, Math.max(1, audio.bufferRef.current.duration / dur));
    setZoom(newZoom);
    setViewStart(Math.max(0, chop.start - pad));
  };

  const detectNote = () => {
    const chop = chops.find((c) => c && c.id === selectedId);
    if (!chop || !audio.bufferRef.current) return;
    const result = detectPitch(audio.bufferRef.current, chop);
    if (result) {
      audio.pitchHzRef.current = result.frequency;
      if (noteNameRef.current)  noteNameRef.current.textContent  = result.note;
      if (noteCentsRef.current) noteCentsRef.current.textContent = `${result.cents > 0 ? '+' : ''}${result.cents}¢`;
      audio.setStatus(`Nota detectada: ${result.note} (${result.frequency.toFixed(1)} Hz, ${result.cents}¢)`);
    } else {
      audio.setStatus('No se pudo detectar una nota clara en este fragmento.');
    }
  };

  // Guardar y Cargar Proyecto JSON (.vxchop)
  const handleSaveProject = () => {
    exportProjectToJson({
      sampleName: audio.fileInfo,
      bpm: Number(bpm) || 90,
      pitch: audio.pitch,
      playMode,
      vintageMode: audio.vintageMode,
      cutoff: audio.cutoff,
      resonance: audio.resonance,
      decay: audio.decay,
      drive: audio.drive,
      chops,
    });
    audio.setStatus('Proyecto .vxchop exportado con éxito.');
  };

  const handleImportProjectFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await importProjectFromJson(file);
      if (data.bpm) setBpm(data.bpm);
      if (typeof data.pitch === 'number') audio.setPitch(data.pitch);
      if (data.playMode) setPlayMode(data.playMode);
      if (data.vintageMode) audio.setVintageMode(data.vintageMode);
      if (data.qlinks) {
        if (data.qlinks.cutoff) audio.setCutoff(data.qlinks.cutoff);
        if (data.qlinks.resonance) audio.setResonance(data.qlinks.resonance);
        if (data.qlinks.decay) audio.setDecay(data.qlinks.decay);
        if (data.qlinks.drive !== undefined) audio.setDrive(data.qlinks.drive);
      }
      if (data.chops) {
        setChopsWithHistory(data.chops);
        if (data.chops.length > 0) setSelectedId(data.chops[0].id);
      }
      audio.setStatus(`Proyecto "${file.name}" cargado exitosamente.`);
    } catch (err) {
      alert(err.message);
    }
    e.target.value = '';
  };
  // Carga por lotes de carpetas o múltiples archivos sobre los pads
  const handleBatchDrop = useCallback(async (e) => {
    audio.setStatus('Analizando carpeta/archivos soltados...');
    try {
      const files = await extractAudioFilesFromDataTransfer(e.dataTransfer);
      if (!files || files.length === 0) {
        audio.setStatus('No se encontraron archivos de audio válidos.');
        return;
      }
      if (files.length === 1) {
        handleLoadFile(files[0]);
        return;
      }
      audio.setStatus(`Cargando y procesando ${files.length} samples para los pads...`);
      await audio.ensureInit();
      const ctx = audio.audioContextRef.current;
      const kit = await combineAudioFilesIntoKit(ctx, files, 64);
      if (!kit) {
        audio.setStatus('No se pudieron decodificar los archivos de audio.');
        return;
      }
      audio.bufferRef.current = kit.buffer;
      audio.setBuffer(kit.buffer);
      const fileInfoStr = `Drum Kit (${files.length} samples) · ${formatTime(kit.buffer.duration)}`;
      audio.setFileInfo(fileInfoStr);
      try {
        const wavBuf = audioBufferToWavArrayBuffer(kit.buffer);
        saveCachedSample(wavBuf, fileInfoStr).catch(() => {});
      } catch {}
      setChopsWithHistory(kit.chops);
      if (kit.chops.length > 0) setSelectedId(kit.chops[0].id);
      setZoom(1);
      setViewStart(0);
      audio.setStatus(`🎉 ¡Kit cargado con éxito! ${kit.chops.length} pads mapeados.`);
    } catch (err) {
      console.error('Error al procesar carpeta de samples:', err);
      audio.setStatus('Error al procesar la carpeta de audio.');
    }
  }, [audio, handleLoadFile, setChopsWithHistory]);

  // Carga directa de audio (1 tema o varios samples) desde móvil o selector de archivos
  const handleAudioFilesSelected = useCallback(async (fileList) => {
    const rawFiles = Array.from(fileList || []);
    if (!rawFiles || rawFiles.length === 0) return;
    const files = rawFiles.filter((f) => {
      const name = (f.name || '').toLowerCase();
      return (
        f.type?.startsWith('audio/') ||
        name.endsWith('.mp3') ||
        name.endsWith('.wav') ||
        name.endsWith('.ogg') ||
        name.endsWith('.m4a') ||
        name.endsWith('.aac') ||
        name.endsWith('.flac') ||
        name.endsWith('.aif') ||
        name.endsWith('.aiff')
      );
    });
    if (files.length === 0) {
      audio.setStatus('Elige un archivo de audio válido (MP3, WAV, M4A, etc.)');
      return;
    }
    if (files.length === 1) {
      await handleLoadFile(files[0], { autoSlice: autoSliceEnabled });
    } else {
      audio.setStatus(`Cargando ${files.length} samples para los pads...`);
      try {
        await audio.ensureInit();
        const ctx = audio.audioContextRef.current;
        const kit = await combineAudioFilesIntoKit(ctx, files, 64);
        if (!kit) {
          audio.setStatus('No se pudieron decodificar los archivos de audio.');
          return;
        }
        setBank('A');
        audio.bufferRef.current = kit.buffer;
        audio.setBuffer(kit.buffer);
        const fileInfoStr = `Kit (${files.length} samples) · ${formatTime(kit.buffer.duration)}`;
        audio.setFileInfo(fileInfoStr);
        try {
          const wavBuf = audioBufferToWavArrayBuffer(kit.buffer);
          saveCachedSample(wavBuf, fileInfoStr).catch(() => {});
        } catch {}
        setChopsWithHistory(kit.chops);
        if (kit.chops.length > 0) setSelectedId(kit.chops[0].id);
        setZoom(1);
        setViewStart(0);
        audio.setStatus(`🎉 ¡Kit cargado! ${kit.chops.length} pads — cada uno con un sonido único.`);
      } catch (err) {
        console.error('Error al procesar archivos de audio:', err);
        audio.setStatus('Error al cargar samples.');
      }
    }
  }, [audio, autoSliceEnabled, handleLoadFile, setChopsWithHistory]);

  // Asignar archivo(s) de sonido directamente a uno o varios pads específicos
  const handleAssignSoundToPad = useCallback(async (fileList, targetGlobalIdx = 0) => {
    const rawFiles = Array.from(fileList || []);
    if (!rawFiles.length) return;
    audio.setStatus(`Cargando sample para el Pad #${targetGlobalIdx + 1}...`);
    try {
      await audio.ensureInit();
      const ctx = audio.audioContextRef.current;
      const decodedList = [];
      for (const file of rawFiles) {
        try {
          const arrayBuf = await file.arrayBuffer();
          const decoded = await ctx.decodeAudioData(arrayBuf);
          decodedList.push({ file, decoded });
        } catch (err) {
          console.warn(`Error al decodificar ${file.name}:`, err);
        }
      }

      if (decodedList.length === 0) {
        audio.setStatus('Formato de audio no compatible o dañado.');
        return;
      }

      if (!audio.bufferRef.current && decodedList[0]) {
        audio.bufferRef.current = decodedList[0].decoded;
        audio.setBuffer(decodedList[0].decoded);
        audio.setFileInfo(`${decodedList[0].file.name}`);
      }

      let firstChop = null;
      setChopsWithHistory((prevChops) => {
        const next = [...prevChops];
        decodedList.forEach(({ file, decoded }, offset) => {
          const slot = targetGlobalIdx + offset;
          const cleanName = file.name.replace(/\.[^/.]+$/, '');
          const newChop = {
            id: crypto.randomUUID(),
            name: cleanName || `Pad ${slot + 1}`,
            start: 0,
            end: Number(decoded.duration.toFixed(4)),
            color: COLORS[slot % COLORS.length],
            buffer: decoded,
          };
          next[slot] = newChop;
          if (offset === 0) firstChop = newChop;
        });
        return next;
      });

      if (firstChop) {
        setSelectedId(firstChop.id);
        hitPad(firstChop, 1.0);
      }

      audio.setStatus(
        decodedList.length === 1
          ? `✅ Pad #${targetGlobalIdx + 1} listo: "${decodedList[0].file.name}"`
          : `✅ ${decodedList.length} pads cargados a partir del Pad #${targetGlobalIdx + 1}`
      );
    } catch (err) {
      console.error('Error al asignar sonido al pad:', err);
      audio.setStatus('Error al cargar archivo en el pad.');
    }
  }, [audio, hitPad, setChopsWithHistory]);

  const handleNewProject = () => {
    if (chops.length > 0 && !window.confirm('¿Deseas iniciar un nuevo proyecto? Se limpiarán los cortes actuales.')) {
      return;
    }
    setChopsWithHistory([]);
    setSelectedId(null);
    audio.stopAll();
    localStorage.removeItem('vxchop_autosave');
    clearCachedSample().catch(() => {});
    audio.setStatus('Nuevo proyecto iniciado.');
  };

  const handleRemoveSample = useCallback(() => {
    audio.stopAll();
    audio.stopContinuous();
    audio.bufferRef.current = null;
    audio.setBuffer(null);
    audio.setFileInfo('Sin sample cargado');
    setChopsWithHistory([]);
    setSelectedId(null);
    setZoom(1);
    setViewStart(0);
    clearCachedSample().catch(() => {});
    localStorage.removeItem('vxchop_autosave');
    audio.setStatus('Sample eliminado. Carga un nuevo archivo de audio.');
    setTimeout(() => {
      drawWaveformRef.current?.();
      drawPlayheadRef.current?.();
    }, 20);
  }, [audio, setChopsWithHistory]);

  // Alternar Modo Reverse en el chop seleccionado
  const toggleChopReverse = useCallback((chopId) => {
    if (!chopId) return;
    setChopsWithHistory((prev) =>
      prev.map((c) => {
        if (c && c.id === chopId) {
          const nextRev = !c.reverse;
          audio.setStatus(`Modo Reverse ${nextRev ? 'ACTIVADO' : 'DESACTIVADO'} para "${c.name}".`);
          return { ...c, reverse: nextRev };
        }
        return c;
      })
    );
  }, [setChopsWithHistory, audio]);

  // Grabar Master en vivo y cargar como sample activo (Live Resampling)
  const handleToggleMasterRecord = async () => {
    if (audio.isMasterRecording) {
      const res = await audio.stopMasterRecord();
      if (res && res.decoded) {
        // Auto-cortar 16 rebanadas para tocar de inmediato en la botonera
        const dur = res.decoded.duration;
        const sliceLen = dur / 16;
        const offset = BANKS.indexOf(bank) * 16;
        const generated = Array.from({ length: 16 }, (_, i) => ({
          id: crypto.randomUUID(),
          name: `Resample ${offset + i + 1}`,
          start: i * sliceLen,
          end: Math.min(dur, (i + 1) * sliceLen),
          color: COLORS[i % COLORS.length],
        }));
        setChopsWithHistory(generated);
        if (generated.length > 0) setSelectedId(generated[0].id);
        setZoom(1);
        setViewStart(0);
        playheadTimeRef.current = null;
        setMobileTab('sampler');
        setTimeout(() => {
          drawWaveformRef.current?.();
          drawPlayheadRef.current?.();
        }, 60);
      }
    } else {
      await audio.startMasterRecord();
    }
  };

  const handleSwitchTab = (tab) => {
    setMobileTab(tab);
    if (tab === 'sampler') {
      setWorkspaceMode('waveform');
      setTimeout(() => {
        drawWaveformRef.current?.();
        drawPlayheadRef.current?.();
      }, 50);
    } else if (tab === 'pads') {
      setWorkspaceMode('pads');
    } else if (tab === 'sequencer') {
      setWorkspaceMode('sequencer');
    }
  };

  const handleSwitchWorkspace = (mode) => {
    setWorkspaceMode(mode);
    if (mode === 'studio') {
      setMobileTab('sampler');
    } else if (mode === 'waveform') {
      setMobileTab('sampler');
    } else if (mode === 'pads') {
      setMobileTab('pads');
    } else if (mode === 'sequencer') {
      setMobileTab('sequencer');
    }

    if (mode === 'studio' || mode === 'waveform' || mode === 'sampler') {
      setTimeout(() => {
        drawWaveformRef.current?.();
        drawPlayheadRef.current?.();
      }, 50);
    }
  };

  // Datos derivados
  const bankOffset   = BANKS.indexOf(bank) * 16;
  const bankChops    = Array.from({ length: 16 }, (_, i) => chops[bankOffset + i] ?? null);
  const selectedChop = chops.find((c) => c && c.id === selectedId);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mpc-shell">

      {/* Header Superior Modular con Session Bar y Carga de Audio */}
      <MpcHeader
        bpm={bpm}
        setBpm={setBpm}
        handleTap={handleTap}
        noteNameRef={noteNameRef}
        noteCentsRef={noteCentsRef}
        selectedChop={selectedChop}
        vuFillRef={vuFillRef}
        midi={midi}
        vintageMode={audio.vintageMode}
        onOpenShortcuts={() => setShowShortcutsModal(true)}
        fileInfo={audio.fileInfo}
        onTriggerLoadAudio={() => mainAudioInputRef.current?.click()}
        onRemoveSample={handleRemoveSample}
        audioBuffer={audio.buffer}
        onNewProject={handleNewProject}
        onSaveProject={handleSaveProject}
        onImportProject={handleImportProjectFile}
        onExportKitZip={handleExportKitZip}
        isExportingKit={isExportingKit}
        canExportKit={Boolean(audio.buffer && chops.filter(Boolean).length > 0)}
        onExportWav={() => audio.exportMix(chops)}
        canExportWav={Boolean(chops.filter(Boolean).length > 0)}
        projectInputRef={projectInputRef}
        onCycleVintageMode={() => {
          const modes = ['modern', 'mpc60', 'sp1200', 's950'];
          const next = modes[(modes.indexOf(audio.vintageMode) + 1) % modes.length];
          audio.setVintageMode(next);
          const labels = {
            modern: 'MODERN STUDIO (24-bit / 44.1kHz Transparente)',
            mpc60: 'AKAI MPC-60 (12-bit / 40kHz Punchy)',
            sp1200: 'E-MU SP-1200 (12-bit / 26kHz Aliasing & SSM2044)',
            s950: 'AKAI S950 (12-bit / 19.2kHz Crunchy Filter)',
          };
          audio.setStatus(`Motor DAC: ${labels[next] || next}`);
        }}
      />

      {/* Input invisible para carga general de audio desde el Header */}
      <input
        ref={mainAudioInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.aif,.aiff"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.length) {
            handleAudioFilesSelected(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* Barra de Navegación de Vistas y Modos de Trabajo */}
      <nav className="mpc-main-nav" aria-label="Espacio de Trabajo">
        <div className="workspace-tabs-group">
          <button
            type="button"
            className={`mpc-tab-btn hide-mobile ${workspaceMode === 'studio' ? 'active' : ''}`}
            onClick={() => handleSwitchWorkspace('studio')}
            title="Vista Estudio: Onda y Pads simultáneos (Modo clásico recomendado para pantallas grandes)"
          >
            <span className="tab-icon">🎛️</span>
            <span className="tab-label">ESTUDIO</span>
            <span className="tab-pill hide-mobile">SPLIT</span>
          </button>
          <button
            type="button"
            className={`mpc-tab-btn ${workspaceMode === 'pads' ? 'active' : ''}`}
            onClick={() => handleSwitchWorkspace('pads')}
            title="Pads de percusión: ideal para tocar en vivo o finger drumming"
          >
            <span className="tab-icon">🥁</span>
            <span className="tab-label">PADS</span>
            <span className="tab-pill hide-mobile">16 PADS</span>
          </button>
          <button
            type="button"
            className={`mpc-tab-btn ${workspaceMode === 'waveform' ? 'active' : ''}`}
            onClick={() => handleSwitchWorkspace('waveform')}
            title="Editor de Onda: máxima visibilidad y zoom de precisión"
          >
            <span className="tab-icon">〰️</span>
            <span className="tab-label">ONDA</span>
            <span className="tab-pill hide-mobile">EDITOR</span>
          </button>
          <button
            type="button"
            className={`mpc-tab-btn ${workspaceMode === 'sequencer' ? 'active' : ''}`}
            onClick={() => handleSwitchWorkspace('sequencer')}
            title="Secuenciador de patrones de batería y ritmos"
          >
            <span className="tab-icon">🎹</span>
            <span className="tab-label">BEATS</span>
            <span className="tab-pill hide-mobile">SEQ</span>
          </button>
        </div>
      </nav>

      {/* Vista del Secuenciador */}
      <div
        className="mpc-sequencer-view"
        style={{ display: (workspaceMode === 'sequencer' || mobileTab === 'sequencer') ? 'flex' : 'none' }}
      >
        <Sequencer
          sequencer={sequencer}
          bpm={bpm || 90}
          setBpm={setBpm}
          chops={chops}
          mainBuffer={audio.buffer}
          pitch={audio.pitch}
          onOpenSampleTab={() => handleSwitchWorkspace('waveform')}
          onHitPad={(targetChop) => {
            if (targetChop) {
              const idx = chops.indexOf(targetChop);
              hitPad(targetChop, 1.0, idx >= 0 ? idx : null);
            } else {
              const sc = chops.find((c) => c.id === selectedId);
              if (sc) hitPad(sc, 1.0);
            }
          }}
        />
      </div>

      {/* Cuerpo Principal: Modern DAW Layout (Serato / Ableton Style) */}
      <div
        className={`mpc-body mode-${workspaceMode}`}
        style={{ display: (workspaceMode === 'sequencer' || mobileTab === 'sequencer') ? 'none' : '' }}
      >
        {/* Sección Superior: Waveform Hero & Slicing Tools */}
        <section className={`mpc-studio-top ${workspaceMode === 'pads' ? 'hidden-desktop' : ''} ${mobileTab === 'sampler' ? 'mobile-show' : ''}`}>
          
          {/* Drawer / Desplegable de YouTube (Crate Digging) */}
          {showYouTubeDrawer && (
            <div className="youtube-drawer-panel">
              <div className="drawer-header">
                <span className="drawer-title">
                  <IconVideo size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                  YOUTUBE SAMPLER & CRATE DIGGER
                </span>
                <button
                  type="button"
                  className="drawer-close-btn"
                  onClick={() => setShowYouTubeDrawer(false)}
                >
                  <IconCross size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Cerrar
                </button>
              </div>
              <YouTubePlayer
                onPlayerReady={(player) => { ytPlayerRef.current = player; }}
                onTimeUpdate={(currentTime) => { ytCurrentTimeRef.current = currentTime; }}
                onLoadIntoMpc={handleLoadYtIntoMpc}
                onAudioCaptured={handleAudioCaptured}
                isLiveChopActive={isLiveChopMode}
                onToggleLiveChop={() => setIsLiveChopMode((v) => !v)}
                onRandomJump={(sec) => {
                  ytCurrentTimeRef.current = sec;
                  audio.setStatus(`🎯 Aguja soltada en YouTube: ${formatTimeMs(sec)}`);
                }}
              />
            </div>
          )}

          {/* Waveform Display Hero */}
          <WaveformDisplay
            canvasRef={canvasRef}
            playheadCanvasRef={playheadCanvasRef}
            spectrumCanvasRef={spectrumCanvasRef}
            currentTimeLabelRef={currentTimeLabelRef}
            totalTimeLabelRef={totalTimeLabelRef}
            durationFillRef={durationFillRef}
            audioDuration={audio.buffer?.duration}
            chopsCount={chops.length}
            selectedChop={selectedChop}
            zoom={zoom}
            setZoom={setZoom}
            setViewStart={setViewStart}
            zoomToChop={zoomToChop}
            handlePointerDown={handlePointerDown}
            handlePointerMove={handlePointerMove}
            handlePointerUp={handlePointerUp}
            hasAudio={Boolean(audio.buffer)}
            onTriggerLoadAudio={() => mainAudioInputRef.current?.click()}
            onBatchDrop={handleBatchDrop}
          />

          {/* Barra Unificada de Slicing, Transporte y Utilidades — Consola Hardware */}
          <div className="unified-slicing-bar">
            {/* Cluster 1: Slicing */}
            <div className="slicing-cluster cluster-slice">
              <span className="cluster-tag">CORTES</span>
              <div className="cluster-inner">
                {/* Auto 16 Clásico */}
                <button
                  type="button"
                  className="mpc-btn small auto-slice"
                  disabled={!audio.buffer}
                  onClick={autoSlice16}
                  title="⚡ Auto 16: Divide el tema en 16 cortes matemáticos iguales"
                >
                  <IconBolt size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Auto 16
                </button>

                {/* Auto-Chop Inteligente por Transitorios / Picos */}
                <div className="transient-slice-capsule">
                  <button
                    type="button"
                    className="mpc-btn small transient-slice-btn"
                    disabled={!audio.buffer}
                    onClick={() => autoSliceTransients(transientSensitivity)}
                    title="⚡ TRANSITORIOS: Corta automáticamente en los ataques de bombos, cajas o acordes"
                  >
                    <IconBolt size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Transitorios
                  </button>
                  <select
                    className="transient-sens-select"
                    value={transientSensitivity}
                    onChange={(e) => {
                      const next = e.target.value;
                      setTransientSensitivity(next);
                      if (audio.buffer) autoSliceTransients(next);
                    }}
                    title="Sensibilidad de detección de transitorios"
                    disabled={!audio.buffer}
                  >
                    <option value="low">Baja</option>
                    <option value="medium">Media</option>
                    <option value="high">Alta</option>
                  </select>
                </div>

                <button
                  type="button"
                  className="mpc-btn small"
                  disabled={!audio.buffer}
                  onClick={() => randomizeChops(16)}
                  title="🎲 Random: Genera 16 cortes aleatorios musicales"
                >
                  <IconDice size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Random
                </button>
              </div>
            </div>

            {/* Cluster 2: Transporte & Reproducción */}
            <div className="slicing-cluster cluster-transport">
              <span className="cluster-tag">TRANSPORTE</span>
              <div className="cluster-inner">
                <button
                  type="button"
                  className={`mpc-btn small continuous-play-btn ${audio.isContinuousPlaying ? 'active-green' : ''}`}
                  disabled={!selectedChop?.buffer && !audio.buffer}
                  onClick={() => {
                    if (audio.isContinuousPlaying) audio.stopContinuous();
                    else {
                      const targetBuf = selectedChop?.buffer || audio.buffer;
                      if (targetBuf) audio.playContinuous(viewStart, targetBuf);
                    }
                  }}
                  title="Reproduce el tema continuo para escuchar y cortar al ritmo (Barra espaciadora)"
                >
                  {audio.isContinuousPlaying ? (
                    <>
                      <IconStop size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                      Detener
                    </>
                  ) : (
                    <>
                      <IconPlay size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                      Continuo
                    </>
                  )}
                </button>

                {/* Botón Momentáneo Tape Stop / Vinyl Brake */}
                <button
                  type="button"
                  className={`mpc-btn small tape-stop-btn ${audio.isTapeStopping ? 'tape-stopping-active' : ''}`}
                  disabled={!audio.buffer}
                  onMouseDown={() => audio.triggerTapeStop(0.85)}
                  onMouseUp={() => audio.releaseTapeStop()}
                  onMouseLeave={() => {
                    if (audio.isTapeStopping) audio.releaseTapeStop();
                  }}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    audio.triggerTapeStop(0.85);
                  }}
                  onTouchEnd={() => audio.releaseTapeStop()}
                  title="TAPE STOP: Mantén presionado para desacelerar la cinta/vinilo en vivo"
                >
                  <IconTape size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  {audio.isTapeStopping ? 'BRAKE...' : 'Tape Stop'}
                </button>
              </div>
            </div>

            {/* Cluster 3: Acciones en Vivo */}
            <div className="slicing-cluster cluster-live">
              <span className="cluster-tag">EN VIVO</span>
              <div className="cluster-inner">
                <button
                  type="button"
                  className={`mpc-btn small live-tap-btn ${isLiveChopMode ? 'active-red-pulse' : ''}`}
                  disabled={!audio.buffer}
                  onClick={() => setIsLiveChopMode((v) => !v)}
                  title="Live Tap: captura el punto exacto al tocar pads vacíos"
                >
                  <span className="live-tap-led" />
                  {isLiveChopMode ? (
                    <>
                      <IconRecord size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                      REC VIVO
                    </>
                  ) : (
                    <>
                      <IconRecord size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                      Live Tap
                    </>
                  )}
                </button>

                <button
                  type="button"
                  className="mpc-btn small"
                  disabled={!audio.buffer}
                  onClick={jumpToRandomPosition}
                  title="JUMP / DIG: Suelta la aguja en un punto aleatorio del disco"
                >
                  🎯 Dig
                </button>

                <button
                  type="button"
                  className={`mpc-btn small ${audio.isMasterRecording ? 'active-red-pulse' : ''}`}
                  onClick={handleToggleMasterRecord}
                  title="REC MASTER: Graba en vivo y carga como sample activo"
                  style={audio.isMasterRecording ? { background: '#ff3b30', color: '#fff', fontWeight: 'bold' } : {}}
                >
                  {audio.isMasterRecording ? (
                    <>
                      <IconStop size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                      STOP REC
                    </>
                  ) : (
                    <>
                      <IconRecord size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                      REC MASTER
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Cluster 4: Historial & Utilidades */}
            <div className="slicing-cluster cluster-history">
              <span className="cluster-tag">HISTORIAL</span>
              <div className="cluster-inner">
                <button
                  type="button"
                  className="mpc-btn small icon-btn"
                  onClick={handleUndo}
                  disabled={undoStack.length === 0}
                  title="Deshacer (Ctrl+Z)"
                >
                  <IconUndo size={13} />
                </button>
                <button
                  type="button"
                  className="mpc-btn small icon-btn"
                  onClick={handleRedo}
                  disabled={redoStack.length === 0}
                  title="Rehacer (Ctrl+Y)"
                >
                  <IconRedo size={13} />
                </button>
                {chops.length >= 2 && (
                  <button
                    type="button"
                    className="mpc-btn small"
                    onClick={shuffleChops}
                    title="🔀 Mezclar el orden de los cortes en los pads"
                  >
                    <IconShuffle size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Shuffle
                  </button>
                )}
                <button
                  type="button"
                  className="mpc-btn small"
                  disabled={!audio.buffer}
                  onClick={detectNote}
                  title="Detección de nota y tonalidad fundamental"
                >
                  ⟲ Nota
                </button>
              </div>
            </div>

            {/* Cluster 5: Paneles Secundarios */}
            <div className="slicing-cluster cluster-drawers">
              <span className="cluster-tag">PANELES</span>
              <div className="cluster-inner">
                <button
                  type="button"
                  className={`mpc-btn small ${showYouTubeDrawer ? 'active-amber' : ''}`}
                  onClick={() => setShowYouTubeDrawer((v) => !v)}
                  title="Buscador y sampleador de YouTube"
                >
                  <IconVideo size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  YouTube
                </button>

                <button
                  type="button"
                  className={`mpc-btn small ${showChopListDrawer ? 'active-cyan' : ''}`}
                  onClick={() => setShowChopListDrawer((v) => !v)}
                  title="Abrir o cerrar la lista detallada de cortes"
                >
                  <IconList size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Cortes ({chops.length})
                </button>

                {chops.length > 0 && (
                  <button
                    type="button"
                    className="mpc-btn small danger"
                    onClick={clearAllChops}
                    title="Borrar todos los cortes"
                  >
                    <IconTrash size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Borrar
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Drawer / Desplegable de la Lista de Cortes (si se activa) */}
          {showChopListDrawer && (
            <div className="chop-list-drawer-panel">
              <div className="drawer-header">
                <span className="drawer-title">
                  <IconList size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                  LISTA DETALLADA DE CORTES ({chops.filter(Boolean).length})
                </span>
                <button
                  type="button"
                  className="drawer-close-btn"
                  onClick={() => setShowChopListDrawer(false)}
                >
                  <IconCross size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Cerrar
                </button>
              </div>
              <div className="chop-list-side">
                {chops.filter(Boolean).map((c) => (
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
                      title="Haz clic para renombrar"
                    />
                    <span className="chop-side-dur">{formatTime(c.end - c.start)}</span>
                    <button
                      type="button"
                      className="chop-side-play"
                      onClick={(e) => { e.stopPropagation(); hitPad(c); }}
                      title="Escuchar"
                    >
                      ▶
                    </button>
                    <button
                      type="button"
                      className="chop-side-del"
                      onClick={(e) => { e.stopPropagation(); removeChop(c.id); }}
                      title="Eliminar"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Sección Inferior: Deck de Inspector + Matriz 4x4 de Pads */}
        <section className={`mpc-studio-bottom ${workspaceMode === 'waveform' ? 'hidden-desktop' : ''} ${mobileTab === 'pads' ? 'mobile-show' : ''}`}>
          
          {/* Panel Q-Link (si está activo) */}
          {showQLink && <QLinkPanel audio={audio} />}

          {/* Panel Rack FX Analógico (si está activo) */}
          {showRackFx && <RackFxPanel audio={audio} onClose={() => setShowRackFx(false)} />}

          {/* Inspector Deck del Pad Seleccionado */}
          <SelectedPadPanel
            selectedChop={selectedChop}
            isContinuousPlaying={audio.isContinuousPlaying}
            formatTimeMs={formatTimeMs}
            nudgeChop={nudgeChop}
            hitPad={hitPad}
            clearSingleChop={clearSingleChop}
            onToggleReverse={toggleChopReverse}
            onAssignSound={handleAssignSoundToPad}
            onUpdateEnvelope={handleUpdateEnvelope}
            selectedPadIndex={selectedPadIndex}
          />

          {/* Matriz 4x4 de Pads con sus controles integrados */}
          <PadMatrix
            bank={bank}
            setBank={setBank}
            playMode={playMode}
            setPlayMode={setPlayMode}
            fullLevel={fullLevel}
            setFullLevel={setFullLevel}
            sixteenLevels={sixteenLevels}
            setSixteenLevels={setSixteenLevels}
            padMuteMode={padMuteMode}
            setPadMuteMode={setPadMuteMode}
            mutedPads={mutedPads}
            showQLink={showQLink}
            setShowQLink={setShowQLink}
            showRackFx={showRackFx}
            setShowRackFx={setShowRackFx}
            chops={chops}
            bankChops={bankChops}
            bankOffset={bankOffset}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            selectedChop={selectedChop}
            playingId={playingId}
            formatTimeMs={formatTimeMs}
            hitPad={hitPad}
            tapChopAtCurrentTime={tapChopAtCurrentTime}
            isLiveChopMode={isLiveChopMode}
            isContinuousPlaying={audio.isContinuousPlaying}
            hasAudioBuffer={Boolean(audio.buffer || chops.some((c) => c?.buffer))}
            playAll={audio.playAll}
            stopAll={() => { audio.stopAll(); audio.setStatus('Detenido.'); }}
            autoSlice16={autoSlice16}
            onBatchDrop={handleBatchDrop}
            onFilesSelected={handleAudioFilesSelected}
            fileInfo={audio.fileInfo}
            autoSliceEnabled={autoSliceEnabled}
            setAutoSliceEnabled={setAutoSliceEnabled}
            onAssignPad={handleAssignSoundToPad}
            selectedPadIndex={selectedPadIndex}
            setSelectedPadIndex={setSelectedPadIndex}
          />
        </section>
      </div>

      {/* Footer de Estado */}
      <footer className="mpc-status">
        <div className="status-left">
          <span className="status-led" />
          <span className="status-msg">{audio.status}</span>
        </div>
        <div className="status-right">
          <button
            type="button"
            className="status-shortcut-hint"
            onClick={() => setShowShortcutsModal(true)}
            title="Abrir panel de atajos de teclado (?)"
          >
            ⌨️ Atajos de teclado <kbd>?</kbd>
          </button>
        </div>
      </footer>

      {/* Modal / Popover de Atajos de Teclado y Ayuda de Producción */}
      {showShortcutsModal && (
        <div className="shortcuts-modal-backdrop" onClick={() => setShowShortcutsModal(false)}>
          <div className="shortcuts-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="shortcuts-modal-header">
              <div className="shortcuts-modal-title">
                <span className="modal-icon">⌨️</span>
                <div>
                  <strong>Guía Rápida & Atajos de Teclado</strong>
                  <span>VX-CHOP Beatmaking Workflow</span>
                </div>
              </div>
              <button
                type="button"
                className="shortcuts-modal-close"
                onClick={() => setShowShortcutsModal(false)}
                title="Cerrar ayuda (Esc)"
              >
                ✕
              </button>
            </div>

            <div className="shortcuts-modal-body">
              <div className="shortcuts-section">
                <h4>🥁 Disparar Pads 4x4</h4>
                <div className="shortcuts-grid">
                  <div className="shortcut-row">
                    <div className="key-group"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd></div>
                    <span>Fila 1 (Pads 1 al 4)</span>
                  </div>
                  <div className="shortcut-row">
                    <div className="key-group"><kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd></div>
                    <span>Fila 2 (Pads 5 al 8)</span>
                  </div>
                  <div className="shortcut-row">
                    <div className="key-group"><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd></div>
                    <span>Fila 3 (Pads 9 al 12)</span>
                  </div>
                  <div className="shortcut-row">
                    <div className="key-group"><kbd>Z</kbd><kbd>X</kbd><kbd>C</kbd><kbd>V</kbd></div>
                    <span>Fila 4 (Pads 13 al 16)</span>
                  </div>
                </div>
              </div>

              <div className="shortcuts-section">
                <h4>🎛️ Control & Transporte</h4>
                <div className="shortcuts-grid">
                  <div className="shortcut-row">
                    <kbd>Espacio</kbd>
                    <span>Play / Pausa reproducción continua del disco</span>
                  </div>
                  <div className="shortcut-row">
                    <kbd>Tab</kbd>
                    <span>Alternar Bancos de Pads (A ➔ B ➔ C ➔ D)</span>
                  </div>
                  <div className="shortcut-row">
                    <div className="key-group"><kbd>Ctrl</kbd> + <kbd>Z</kbd></div>
                    <span>Deshacer último corte o edición</span>
                  </div>
                  <div className="shortcut-row">
                    <div className="key-group"><kbd>Ctrl</kbd> + <kbd>Y</kbd></div>
                    <span>Rehacer corte</span>
                  </div>
                  <div className="shortcut-row">
                    <div className="key-group"><kbd>Supr</kbd> / <kbd>Backspace</kbd></div>
                    <span>Vaciar o borrar pad seleccionado</span>
                  </div>
                  <div className="shortcut-row">
                    <kbd>?</kbd>
                    <span>Abrir / Cerrar esta ventana de atajos</span>
                  </div>
                </div>
              </div>

              <div className="shortcuts-section tips-section">
                <h4>💡 Tips para Productores</h4>
                <ul className="shortcuts-tips">
                  <li><strong>Live Tap Chop:</strong> Activa el botón rojo "🔴 LIVE TAP", dale a Play al disco continuo y toca las teclas de los pads vacíos al compás del ritmo para capturar cortes al vuelo.</li>
                  <li><strong>Arrastrar Carpetas:</strong> Arrastra una carpeta de sonidos WAV/MP3 desde tu ordenador directamente sobre la matriz de pads para asignarlos en lote.</li>
                  <li><strong>Afinación Cromática:</strong> Presiona <em>16 LEVELS</em> para tocar el chop seleccionado en una escala melódica de 16 semitonos.</li>
                </ul>
              </div>
            </div>

            <div className="shortcuts-modal-footer">
              <button
                type="button"
                className="mpc-btn accent"
                onClick={() => setShowShortcutsModal(false)}
              >
                ¡Entendido! Volver a Crear
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

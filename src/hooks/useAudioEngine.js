import { useCallback, useEffect, useRef, useState } from 'react';
import { formatTime } from '../utils/format.js';
import { exportToWav } from '../utils/export.js';

/**
 * Motor de audio VX-CHOP 2.0 con AudioWorklet + WASM.
 *
 * Cadena de señal:
 *   BufferSource → GainNode → AudioWorkletNode → AnalyserNode → destination
 *
 * El worklet corre en el hilo de audio dedicado:
 *   - Calcula RMS en cada bloque (128 muestras ~3ms)
 *   - Detecta pitch via WASM (YIN) cada ~500ms
 *   - Pasa el audio sin modificar (pass-through)
 *
 * Expone rmsRef y pitchHzRef para que los componentes los lean en rAF
 * sin causar re-renders de React.
 */
export function useAudioEngine() {
  // ── Refs del motor ───────────────────────────────────────────────────────────
  const audioContextRef   = useRef(null);
  const analyserRef       = useRef(null);
  const workletNodeRef    = useRef(null);
  const bufferRef         = useRef(null);
  const activeVoicesRef   = useRef(new Map()); // Map<id, { source, gain, chop }>
  const playbackTimersRef = useRef([]);
  const playbackStateRef  = useRef(null);
  const pitchRef          = useRef(0);  // semitonos de pitch (para setTimeout callbacks)
  const playbackIdRef     = useRef(0);  // ID incremental para evitar colisiones en onended
  const initPromiseRef    = useRef(null);

  // ── Refs de análisis (actualizados por el worklet a 60fps, sin re-renders) ───
  const rmsRef      = useRef(0);
  const pitchHzRef  = useRef(-1);

  // ── Estado React ─────────────────────────────────────────────────────────────
  const [fileInfo, setFileInfo] = useState('Sin sample cargado');
  const [status,   setStatus]   = useState('Listo.');
  const [warning,  setWarning]  = useState('');
  const [buffer,   setBuffer]   = useState(null);
  const [pitch,    setPitch]    = useState(0);

  useEffect(() => { pitchRef.current = pitch; }, [pitch]);

  // ── Cleanup al desmontar ─────────────────────────────────────────────────────
  useEffect(() => () => {
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  // ── Inicialización del AudioContext + Worklet + WASM (lazy, una sola vez) ────
  const ensureInit = useCallback(async () => {
    // Si ya está inicializado, solo reanudar si estaba suspendido
    if (audioContextRef.current) {
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      return;
    }

    // Evitar inicialización paralela
    if (initPromiseRef.current) return initPromiseRef.current;

    initPromiseRef.current = (async () => {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();

      // Nodo analizador de espectro
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.82;
      analyserRef.current = analyser;

      // ── Intentar cargar AudioWorklet + WASM ──────────────────────────────────
      try {
        const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
        const workletUrl = `${base}/vxchop-worklet.js`;
        const wasmUrl = `${base}/dsp.wasm`;

        await ctx.audioWorklet.addModule(workletUrl);

        const worklet = new AudioWorkletNode(ctx, 'vxchop-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [ctx.destination.channelCount || 2],
        });

        // Escuchar mensajes del worklet (RMS + pitch)
        worklet.port.onmessage = ({ data }) => {
          if (data.type === 'rms')   rmsRef.current     = data.value;
          if (data.type === 'pitch') pitchHzRef.current = data.frequency;
        };

        // Intentar enviar WASM al worklet
        try {
          const resp = await fetch(wasmUrl);
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            worklet.port.postMessage({ type: 'wasm', buffer: buf }, [buf]);
          }
        } catch {
          console.info('[VxChop] WASM no disponible — pitch detection en modo JS');
        }

        // Cadena: worklet → analyser → destination
        worklet.connect(analyser);
        workletNodeRef.current = worklet;
      } catch (err) {
        console.warn('[VxChop] AudioWorklet no disponible, usando modo directo:', err);
      }

      // Analyser siempre conectado a destination (con o sin worklet)
      analyser.connect(ctx.destination);
      audioContextRef.current = ctx;
      initPromiseRef.current = null;
    })();

    return initPromiseRef.current;
  }, []);

  // ── stopAll ──────────────────────────────────────────────────────────────────
  const stopAll = useCallback(() => {
    // Detener todas las voces activas en paralelo
    activeVoicesRef.current.forEach((voice) => {
      try { voice.source.stop(); } catch { /* ya detenido */ }
    });
    activeVoicesRef.current.clear();

    playbackTimersRef.current.forEach((t) => window.clearTimeout(t));
    playbackTimersRef.current = [];
    playbackStateRef.current = null;
    // Limpiar RMS al detener
    rmsRef.current = 0;
  }, []);

  // ── playChop ─────────────────────────────────────────────────────────────────
  /**
   * Reproduce un chop con:
   *  - Fade in/out anti-click via GainNode
   *  - Soporte de velocity (volumen dinámico de 0.05 a 1.0)
   *  - Modo Mono (corta voces anteriores) o Poly (voces simultáneas)
   *  - Pitch shift vía playbackRate
   *  - Señal pasa por AudioWorkletNode → RMS y pitch se actualizan en tiempo real
   */
  const playChop = useCallback(async (chop, { cancelSequence = true, velocity = 1.0 } = {}) => {
    if (!bufferRef.current) return;
    if (cancelSequence) stopAll();

    await ensureInit();
    const ctx = audioContextRef.current;
    const rate = 2 ** (pitchRef.current / 12);
    const chopDuration = chop.end - chop.start;
    const playDuration = chopDuration / rate;
    const fadeSecs = Math.min(0.005, chopDuration * 0.05);

    // Curva dinámica de velocity estilo MPC
    const safeVel = Math.max(0.05, Math.min(1.0, Number(velocity) || 1.0));
    const targetGain = Math.min(1.0, safeVel ** 1.3);

    const source = ctx.createBufferSource();
    source.buffer = bufferRef.current;
    source.playbackRate.value = rate;

    // GainNode para fade anti-click y volumen de velocity
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(targetGain, now + fadeSecs);
    if (playDuration > fadeSecs * 2.1) {
      gain.gain.setValueAtTime(targetGain, now + playDuration - fadeSecs);
      gain.gain.linearRampToValueAtTime(0, now + playDuration);
    }

    // Conectar al worklet (si existe) o directo al analyser
    source.connect(gain);
    gain.connect(workletNodeRef.current ?? analyserRef.current ?? ctx.destination);

    const pId = ++playbackIdRef.current;
    const voice = { id: pId, source, gain, chop };
    activeVoicesRef.current.set(pId, voice);

    source.start(now, chop.start, chopDuration);
    playbackStateRef.current = { chop, startAudioTime: now, rate, id: pId };

    source.onended = () => {
      activeVoicesRef.current.delete(pId);
      if (activeVoicesRef.current.size === 0) {
        rmsRef.current = 0;
      }
      if (playbackStateRef.current?.id === pId) {
        // Si hay otras voces aún sonando, mostrar el último chop activo
        const remaining = Array.from(activeVoicesRef.current.values());
        if (remaining.length > 0) {
          const lastVoice = remaining[remaining.length - 1];
          playbackStateRef.current = {
            chop: lastVoice.chop,
            startAudioTime: now,
            rate,
            id: lastVoice.id,
          };
        } else {
          playbackStateRef.current = null;
        }
      }
    };

    setStatus(`Reproduciendo "${chop.name}"...`);
  }, [ensureInit, stopAll]);

  // ── playAll ──────────────────────────────────────────────────────────────────
  const playAll = useCallback(async (chops) => {
    stopAll();
    await ensureInit();
    let delay = 0;
    chops.forEach((chop) => {
      const timer = window.setTimeout(
        () => playChop(chop, { cancelSequence: false }),
        delay,
      );
      playbackTimersRef.current.push(timer);
      delay += (chop.end - chop.start) / (2 ** (pitchRef.current / 12)) * 1000;
    });
  }, [ensureInit, playChop, stopAll]);

  // ── loadFile ─────────────────────────────────────────────────────────────────
  const loadFile = useCallback(async (file) => {
    setStatus('Decodificando audio...');
    setWarning('');
    try {
      await ensureInit();
      const ctx = audioContextRef.current;
      const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
      bufferRef.current = decoded;
      setBuffer(decoded);
      setFileInfo(
        `${file.name} · ${formatTime(decoded.duration)} · ${decoded.sampleRate} Hz · ${decoded.numberOfChannels}ch`,
      );
      if (decoded.duration > 600) {
        setWarning('Sample largo: visualización simplificada para mantener fluidez.');
      }
      setStatus('Sample cargado. Dibuja sobre el waveform para crear un chop.');
      playbackStateRef.current = null;
      rmsRef.current = 0;
      pitchHzRef.current = -1;
      return decoded;
    } catch (err) {
      console.error(err);
      setStatus('Error al leer el archivo.');
      setWarning('Formato no soportado o archivo dañado.');
      return null;
    }
  }, [ensureInit]);

  // ── exportMix ────────────────────────────────────────────────────────────────
  const exportMix = useCallback((chops) => {
    if (!bufferRef.current || !chops.length) return;
    exportToWav(bufferRef.current, chops, pitchRef.current);
    setStatus('WAV exportado correctamente.');
  }, []);

  /**
   * Retorna el nodo de entrada de la cadena de señal principal:
   *   workletNode → analyser → destination
   * Todos los sonidos (pads Y secuenciador) deben conectarse aquí
   * para que el VU meter y el pitch detector los procesen.
   */
  const getDestination = useCallback(() => {
    return workletNodeRef.current ?? analyserRef.current ?? audioContextRef.current?.destination ?? null;
  }, []);

  return {
    // Refs expuestas (lectura directa, sin re-renders)
    audioContextRef,
    analyserRef,
    bufferRef,
    playbackStateRef,
    rmsRef,
    pitchHzRef,
    // Estado React
    fileInfo,
    status,
    setStatus,
    warning,
    buffer,
    pitch,
    setPitch,
    // Acciones
    loadFile,
    ensureInit,
    playChop,
    playAll,
    stopAll,
    exportMix,
    getDestination,
  };
}

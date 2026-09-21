import { useCallback, useEffect, useRef, useState } from 'react';
import { formatTime } from '../utils/format.js';
import { exportToWav } from '../utils/export.js';
import { saveCachedSample } from '../utils/audioStorage.js';

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
// ── Curva de Saturación Analógica Suave (Tape / Tube) ────────────────────────
function makeTapeSaturationCurve(amount = 0) {
  if (amount <= 0.5) return null; // 0% = Bypass total transparente
  const k = (amount / 100) * 3.5;
  const n_samples = 4096;
  const curve = new Float32Array(n_samples);
  const maxNorm = Math.tanh(1 + k * 0.6);
  for (let i = 0; i < n_samples; ++i) {
    const x = (i * 2) / n_samples - 1;
    // Saturación analógica tanh suave normalizada a 1.0 (cero clipping digital)
    curve[i] = Math.tanh(x * (1 + k * 0.6)) / maxNorm;
  }
  return curve;
}

// ── Generador de Buffer Invertido (Mode Reverse por Pad) ─────────────────────
function makeReverseBuffer(ctx, sourceBuffer, startSec, endSec) {
  const sr = sourceBuffer.sampleRate;
  const startSample = Math.max(0, Math.floor(startSec * sr));
  const endSample = Math.min(sourceBuffer.length, Math.floor(endSec * sr));
  const length = Math.max(1, endSample - startSample);
  const channels = sourceBuffer.numberOfChannels;
  const revBuf = ctx.createBuffer(channels, length, sr);

  for (let c = 0; c < channels; c++) {
    const srcData = sourceBuffer.getChannelData(c);
    const destData = revBuf.getChannelData(c);
    for (let i = 0; i < length; i++) {
      destData[i] = srcData[endSample - 1 - i];
    }
  }
  return revBuf;
}

// ── Generador Procedural de Ruido de Vinilo (Crackle & Dust) ────────────────
function makeVinylNoiseBuffer(ctx, durationSec = 6.0) {
  const sr = ctx.sampleRate;
  const length = Math.floor(sr * durationSec);
  const buffer = ctx.createBuffer(2, length, sr);

  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      // Ruido rosa analógico (zumbido de superficie y soplido de aguja)
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      const hiss = (b0 + b1 + b2 + white * 0.5362) * 0.035;

      // Chasquidos y motas de polvo aleatorias
      let pop = 0;
      if (Math.random() < 0.0006) {
        const amp = (Math.random() ** 3) * 0.75;
        pop = (Math.random() > 0.5 ? 1 : -1) * amp;
      }

      data[i] = hiss + pop;
    }
  }
  return buffer;
}

export function useAudioEngine() {
  // ── Refs del motor ───────────────────────────────────────────────────────────
  const audioContextRef   = useRef(null);
  const analyserRef       = useRef(null);
  const workletNodeRef    = useRef(null);
  const filterNodeRef     = useRef(null);
  const tapeNodeRef       = useRef(null);
  const masterGainRef     = useRef(null);
  const limiterNodeRef    = useRef(null);
  const bufferRef         = useRef(null);
  const activeVoicesRef   = useRef(new Map()); // Map<id, { source, gain, chop }>
  const playbackTimersRef = useRef([]);
  const playbackStateRef  = useRef(null);
  const pitchRef          = useRef(0);  // semitonos de pitch (para setTimeout callbacks)
  const decayRef          = useRef(1.0);
  const playbackIdRef     = useRef(0);  // ID incremental para evitar colisiones en onended
  const initPromiseRef    = useRef(null);

  // ── Refs de análisis (actualizados por el worklet a 60fps, sin re-renders) ───
  const rmsRef      = useRef(0);
  const pitchHzRef  = useRef(-1);

  // ── Reproducción continua de audio completo (Live Tap to Chop & Vinyl) ──────
  const continuousSourceRef    = useRef(null);
  const continuousStartTimeRef = useRef(0);
  const continuousOffsetRef    = useRef(0);
  const [isContinuousPlaying, setIsContinuousPlaying] = useState(false);

  // ── Generador de Vinilo y Live Resampling Master ───────────────────────────
  const vinylSourceNodeRef = useRef(null);
  const vinylGainNodeRef   = useRef(null);
  const mediaStreamDestRef = useRef(null);
  const mediaRecorderRef   = useRef(null);
  const recordedChunksRef  = useRef([]);
  const [isMasterRecording, setIsMasterRecording] = useState(false);
  const [vinylCrackle, setVinylCrackle] = useState(0); // 0% a 100%
  const vinylCrackleRef    = useRef(0);

  // ── Estado React ─────────────────────────────────────────────────────────────
  const [fileInfo, setFileInfo] = useState('Sin sample cargado');
  const [status,   setStatus]   = useState('Listo.');
  const [warning,  setWarning]  = useState('');
  const [buffer,   setBuffer]   = useState(null);
  const [pitch,    setPitch]    = useState(0);

  // Q-LINK Controls (Cutoff, Resonance, Decay, Tape Drive)
  const [cutoff,    setCutoff]    = useState(20000); // 20Hz a 20000Hz
  const [resonance, setResonance] = useState(1.0);   // Q 0.1 a 18.0
  const [decay,     setDecay]     = useState(1.0);   // 0.2x a 2.0x
  const [drive,     setDrive]     = useState(0);     // 0% limpio por defecto (sin distorsión)

  const [vintageMode, setVintageMode] = useState('modern'); // 'modern' | 'mpc60' | 'sp1200'
  const vintageModeRef = useRef('modern');

  useEffect(() => { pitchRef.current = pitch; }, [pitch]);
  useEffect(() => { decayRef.current = decay; }, [decay]);
  useEffect(() => { vinylCrackleRef.current = vinylCrackle; }, [vinylCrackle]);
  useEffect(() => {
    vintageModeRef.current = vintageMode;
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({
        type: 'setVintageMode',
        mode: vintageMode,
      });
    }
  }, [vintageMode]);

  useEffect(() => {
    if (vinylGainNodeRef.current && audioContextRef.current) {
      const now = audioContextRef.current.currentTime;
      const targetGain = (vinylCrackle / 100) * 0.35;
      vinylGainNodeRef.current.gain.setTargetAtTime(targetGain, now, 0.03);
    }
  }, [vinylCrackle]);

  useEffect(() => {
    if (filterNodeRef.current && audioContextRef.current) {
      const now = audioContextRef.current.currentTime;
      filterNodeRef.current.frequency.setTargetAtTime(Math.max(20, Math.min(20000, cutoff)), now, 0.02);
    }
  }, [cutoff]);

  useEffect(() => {
    if (filterNodeRef.current && audioContextRef.current) {
      const now = audioContextRef.current.currentTime;
      filterNodeRef.current.Q.setTargetAtTime(Math.max(0.1, Math.min(18, resonance)), now, 0.02);
    }
  }, [resonance]);

  useEffect(() => {
    if (tapeNodeRef.current) {
      tapeNodeRef.current.curve = makeTapeSaturationCurve(drive);
    }
  }, [drive]);

  // ── Auto-arranque de baja latencia y reconexión al ganar foco ───────────────
  useEffect(() => {
    const handleWakeAudio = () => {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
    };
    window.addEventListener('focus', handleWakeAudio);
    window.addEventListener('pointerdown', handleWakeAudio, { once: true });
    window.addEventListener('keydown', handleWakeAudio, { once: true });
    return () => {
      window.removeEventListener('focus', handleWakeAudio);
    };
  }, []);

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
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtxClass({
        latencyHint: 'interactive',
      });

      // Nodo analizador de espectro
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.82;
      analyserRef.current = analyser;

      // Nodo Filtro Analógico MPC (BiquadFilterNode Lowpass)
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoff, ctx.currentTime);
      filter.Q.setValueAtTime(resonance, ctx.currentTime);
      filterNodeRef.current = filter;

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

        // Cadena: worklet → filter → analyser → destination
        worklet.port.postMessage({ type: 'setVintageMode', mode: vintageModeRef.current });
        worklet.connect(filter);
        workletNodeRef.current = worklet;
      } catch (err) {
        console.warn('[VxChop] AudioWorklet no disponible, usando modo directo:', err);
      }

      // Nodo Saturador Analógico / Tape Drive (WaveShaperNode 4x oversampling)
      const tape = ctx.createWaveShaper();
      tape.curve = makeTapeSaturationCurve(drive);
      tape.oversample = '4x';
      tapeNodeRef.current = tape;

      // ── Control Maestro de Ganancia y Limitador Transparente Anti-Clipping ──
      // Headroom de 0.80 (-2dB) para prevenir saturación digital en picos
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.80, ctx.currentTime);
      masterGainRef.current = masterGain;

      // Limitador Brickwall (DynamicsCompressor rápido) para evitar distorsión de suma
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.setValueAtTime(-1.0, ctx.currentTime);
      limiter.knee.setValueAtTime(3.0, ctx.currentTime);
      limiter.ratio.setValueAtTime(20.0, ctx.currentTime);
      limiter.attack.setValueAtTime(0.002, ctx.currentTime);
      limiter.release.setValueAtTime(0.06, ctx.currentTime);
      limiterNodeRef.current = limiter;

      // Cadena limpia: filter → tape → analyser → masterGain → limiter → destination
      filter.connect(tape);
      tape.connect(analyser);
      analyser.connect(masterGain);
      masterGain.connect(limiter);
      limiter.connect(ctx.destination);

      // ── Nodo de captura para Resampling en vivo del Master ───────────────────
      try {
        const streamDest = ctx.createMediaStreamDestination();
        limiter.connect(streamDest);
        mediaStreamDestRef.current = streamDest;
      } catch (err) {
        console.warn('[VxChop] MediaStreamDestination no soportado:', err);
      }

      // ── Generador de Vinilo Analógico (Crackle & Dust) en bucle continuo ────
      const vinylGain = ctx.createGain();
      vinylGain.gain.setValueAtTime((vinylCrackleRef.current / 100) * 0.35, ctx.currentTime);
      vinylGainNodeRef.current = vinylGain;
      // Se conecta antes del filtro analógico para que CUTOFF y RESO afecten al vinilo
      vinylGain.connect(filter);

      try {
        const vinylBuffer = makeVinylNoiseBuffer(ctx, 6.0);
        const vinylSrc = ctx.createBufferSource();
        vinylSrc.buffer = vinylBuffer;
        vinylSrc.loop = true;
        vinylSrc.connect(vinylGain);
        vinylSrc.start(0);
        vinylSourceNodeRef.current = vinylSrc;
      } catch (err) {
        console.warn('[VxChop] No se pudo inicializar el generador de vinilo:', err);
      }

      audioContextRef.current = ctx;
      initPromiseRef.current = null;
    })();

    return initPromiseRef.current;
  }, [cutoff, resonance, drive]);

  // ── stopContinuous ──────────────────────────────────────────────────────────
  const stopContinuous = useCallback(() => {
    if (continuousSourceRef.current) {
      try {
        continuousSourceRef.current.stop();
        continuousSourceRef.current.disconnect();
      } catch { /* ya detenido */ }
      continuousSourceRef.current = null;
    }
    setIsContinuousPlaying(false);
  }, []);

  // ── stopAll ──────────────────────────────────────────────────────────────────
  const stopAll = useCallback(() => {
    // Detener reproducción continua si estaba activa
    stopContinuous();

    // Detener todas las voces activas con soft-choke anti-clic suave (4ms)
    const ctx = audioContextRef.current;
    const now = ctx ? ctx.currentTime : 0;
    activeVoicesRef.current.forEach((voice) => {
      try {
        if (voice.gain && ctx) {
          voice.gain.gain.cancelScheduledValues(now);
          voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
          voice.gain.gain.linearRampToValueAtTime(0, now + 0.004);
          voice.source.stop(now + 0.005);
        } else {
          voice.source.stop();
        }
      } catch { /* ya detenido */ }
    });
    activeVoicesRef.current.clear();

    playbackTimersRef.current.forEach((t) => window.clearTimeout(t));
    playbackTimersRef.current = [];
    playbackStateRef.current = null;
    // Limpiar RMS al detener
    rmsRef.current = 0;
  }, [stopContinuous]);

  // ── playChop ─────────────────────────────────────────────────────────────────
  /**
   * Reproduce un chop con:
   *  - Fade in/out anti-click via GainNode
   *  - Soporte de velocity (volumen dinámico de 0.05 a 1.0)
   *  - Modo Mono (corta voces anteriores) o Poly (voces simultáneas)
   *  - Pitch shift vía playbackRate
   *  - Señal pasa por AudioWorkletNode → RMS y pitch se actualizan en tiempo real
   */
  const playChop = useCallback(async (chop, { cancelSequence = true, velocity = 1.0, pitchOffset = 0 } = {}) => {
    const targetBuffer = chop?.buffer || bufferRef.current;
    if (!targetBuffer) return;
    if (cancelSequence) stopAll();

    await ensureInit();
    const ctx = audioContextRef.current;
    const totalPitch = pitchRef.current + (Number(pitchOffset) || 0);
    const rate = 2 ** (totalPitch / 12);
    const startSec = Math.max(0, chop?.start !== undefined ? chop.start : 0);
    const endSec = (chop?.end !== undefined && chop.end > startSec) ? chop.end : targetBuffer.duration;
    const chopDuration = Math.max(0.01, endSec - startSec);
    const effectiveDecay = decayRef.current || 1.0;
    const playDuration = Math.min(chopDuration / rate, (chopDuration / rate) * effectiveDecay);
    const fadeSecs = Math.min(0.005, playDuration * 0.08);

    // Curva dinámica de velocity estilo MPC
    const safeVel = Math.max(0.05, Math.min(1.0, Number(velocity) || 1.0));
    const targetGain = Math.min(1.0, safeVel ** 1.3);

    const source = ctx.createBufferSource();
    if (chop?.reverse) {
      source.buffer = makeReverseBuffer(ctx, targetBuffer, startSec, endSec);
    } else {
      source.buffer = targetBuffer;
    }
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

    // Conectar a la cadena principal (worklet → filter → analyser → destination)
    source.connect(gain);
    const dest = workletNodeRef.current ?? filterNodeRef.current ?? analyserRef.current ?? ctx.destination;
    gain.connect(dest);

    const pId = ++playbackIdRef.current;
    const voice = { id: pId, source, gain, chop };
    activeVoicesRef.current.set(pId, voice);

    if (chop?.reverse) {
      source.start(now, 0, playDuration * rate);
    } else {
      source.start(now, startSec, playDuration * rate);
    }
    playbackStateRef.current = { chop, startAudioTime: now, rate, id: pId };

    source.onended = () => {
      activeVoicesRef.current.delete(pId);
      try {
        source.disconnect();
        gain.disconnect();
      } catch { /* ya desconectado */ }
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

  // ── playContinuous (Reproducción corrida para Live Tap to Chop & Vinilo) ───
  const playContinuous = useCallback(async (offset = 0) => {
    if (!bufferRef.current) return;
    stopAll();
    await ensureInit();
    const ctx = audioContextRef.current;
    const rate = 2 ** (pitchRef.current / 12);
    const source = ctx.createBufferSource();
    source.buffer = bufferRef.current;
    source.playbackRate.value = rate;

    const dest = workletNodeRef.current ?? filterNodeRef.current ?? analyserRef.current ?? ctx.destination;
    source.connect(dest);

    const safeOffset = Math.max(0, Math.min(bufferRef.current.duration - 0.05, Number(offset) || 0));
    continuousSourceRef.current = source;
    continuousStartTimeRef.current = ctx.currentTime;
    continuousOffsetRef.current = safeOffset;
    setIsContinuousPlaying(true);

    source.start(ctx.currentTime, safeOffset);
    source.onended = () => {
      if (continuousSourceRef.current === source) {
        continuousSourceRef.current = null;
        setIsContinuousPlaying(false);
      }
    };
    setStatus(`Tocando sample corrido desde ${formatTime(safeOffset)}...`);
  }, [ensureInit, stopAll]);

  // ── getContinuousTime ────────────────────────────────────────────────────────
  const getContinuousTime = useCallback(() => {
    if (!continuousSourceRef.current || !audioContextRef.current) {
      return continuousOffsetRef.current;
    }
    const rate = 2 ** (pitchRef.current / 12);
    const elapsed = (audioContextRef.current.currentTime - continuousStartTimeRef.current) * rate;
    const current = continuousOffsetRef.current + elapsed;
    return Math.max(0, Math.min(bufferRef.current?.duration || 0, current));
  }, []);

  // ── loadFile ─────────────────────────────────────────────────────────────────
  const loadFile = useCallback(async (file) => {
    setStatus('Decodificando audio...');
    setWarning('');
    try {
      await ensureInit();
      const ctx = audioContextRef.current;
      const rawBuf = await file.arrayBuffer();
      const copyBuf = rawBuf.slice(0);
      const decoded = await ctx.decodeAudioData(rawBuf);
      bufferRef.current = decoded;
      setBuffer(decoded);
      const fileInfoStr = `${file.name} · ${formatTime(decoded.duration)} · ${decoded.sampleRate} Hz · ${decoded.numberOfChannels}ch`;
      setFileInfo(fileInfoStr);
      saveCachedSample(copyBuf, fileInfoStr).catch(() => {});
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

  // ── startMasterRecord & stopMasterRecord (Live Resampling) ─────────────────
  const startMasterRecord = useCallback(async () => {
    await ensureInit();
    const stream = mediaStreamDestRef.current?.stream;
    if (!stream) {
      setStatus('No se pudo conectar el canal de grabación del Master.');
      return false;
    }
    recordedChunksRef.current = [];
    const mimeType = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
      ? 'audio/webm;codecs=opus'
      : (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
    const options = mimeType ? { mimeType } : undefined;

    try {
      const mr = new MediaRecorder(stream, options);
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };
      mr.start(50);
      mediaRecorderRef.current = mr;
      setIsMasterRecording(true);
      setStatus('● GRABANDO MASTER EN VIVO (toca pads, secuencias o vinilo)...');
      return true;
    } catch (err) {
      console.error('Error al iniciar MediaRecorder:', err);
      setStatus('Error al iniciar la grabación del Master.');
      return false;
    }
  }, [ensureInit]);

  const stopMasterRecord = useCallback(async () => {
    if (!mediaRecorderRef.current || !isMasterRecording) return null;

    return new Promise((resolve) => {
      const mr = mediaRecorderRef.current;
      mr.onstop = async () => {
        setIsMasterRecording(false);
        setStatus('Procesando remuestreo del Master...');
        try {
          const blob = new Blob(recordedChunksRef.current, { type: mr.mimeType || 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          const copyBuf = arrayBuffer.slice(0);
          const ctx = audioContextRef.current;
          const decoded = await ctx.decodeAudioData(arrayBuffer);

          bufferRef.current = decoded;
          setBuffer(decoded);
          const name = `Master_Resample_${new Date().toLocaleTimeString().replace(/:/g, '-')}`;
          const fileInfoStr = `${name} · ${formatTime(decoded.duration)} · ${decoded.sampleRate} Hz`;
          setFileInfo(fileInfoStr);
          saveCachedSample(copyBuf, fileInfoStr).catch(() => {});
          setStatus(`🎉 ¡Master remuestreado (${formatTime(decoded.duration)})! Cargado como sample activo.`);
          resolve({ decoded, arrayBuffer: copyBuf, fileInfo: fileInfoStr });
        } catch (err) {
          console.error('Error al decodificar resample:', err);
          setStatus('Error al procesar el audio del master.');
          resolve(null);
        }
      };
      mr.stop();
    });
  }, [isMasterRecording]);

  // ── exportMix ────────────────────────────────────────────────────────────────
  const exportMix = useCallback((chops) => {
    if (!bufferRef.current || !chops.length) return;
    exportToWav(bufferRef.current, chops, pitchRef.current);
    setStatus('WAV exportado correctamente.');
  }, []);

  /**
   * Retorna el nodo de entrada de la cadena de señal principal:
   *   workletNode → filterNode → analyser → destination
   * Todos los sonidos (pads Y secuenciador) se conectan aquí
   * para que el filtro, el VU meter y el pitch detector los procesen.
   */
  const getDestination = useCallback(() => {
    return workletNodeRef.current ?? filterNodeRef.current ?? analyserRef.current ?? audioContextRef.current?.destination ?? null;
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
    setFileInfo,
    status,
    setStatus,
    warning,
    buffer,
    setBuffer,
    pitch,
    setPitch,
    // Q-LINK Controls
    cutoff,
    setCutoff,
    resonance,
    setResonance,
    decay,
    setDecay,
    drive,
    setDrive,
    vinylCrackle,
    setVinylCrackle,
    vintageMode,
    setVintageMode,
    // Live Resampling
    isMasterRecording,
    startMasterRecord,
    stopMasterRecord,
    // Acciones
    loadFile,
    ensureInit,
    playChop,
    playAll,
    stopAll,
    playContinuous,
    stopContinuous,
    getContinuousTime,
    isContinuousPlaying,
    exportMix,
    getDestination,
  };
}

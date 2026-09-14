import { useCallback, useEffect, useRef, useState } from 'react';
import {
  playKick,
  playSnare,
  playHiHat,
  playBass,
  playCustomSample,
} from '../utils/drumSynth.js';

const DEFAULT_STEP_COUNT = 16;
const MAX_STEPS = 64;

const INITIAL_TRACKS = [
  {
    id: 'chops',
    name: 'Sample Chops',
    color: '#55d6be',
    type: 'chop',
    volume: 0.9,
    muted: false,
    solo: false,
    customBuffer: null,
    steps: Array.from({ length: MAX_STEPS }, () => ({
      active: false,
      note: 0,
      velocity: 1.0,
      chopIndex: 0,
    })),
  },
  {
    id: 'kick',
    name: 'Bombo / Kick',
    color: '#ff7a66',
    type: 'kick',
    volume: 0.9,
    muted: false,
    solo: false,
    customBuffer: null,
    steps: Array.from({ length: MAX_STEPS }, () => ({
      active: false,
      note: 0,
      velocity: 1.0,
      chopIndex: 0,
    })),
  },
  {
    id: 'snare',
    name: 'Caja / Snare',
    color: '#f7c95f',
    type: 'snare',
    volume: 0.85,
    muted: false,
    solo: false,
    customBuffer: null,
    steps: Array.from({ length: MAX_STEPS }, () => ({
      active: false,
      note: 0,
      velocity: 1.0,
      chopIndex: 0,
    })),
  },
  {
    id: 'hihat',
    name: 'Charles / Hi-Hat',
    color: '#52a8ff',
    type: 'hihat',
    volume: 0.75,
    muted: false,
    solo: false,
    customBuffer: null,
    steps: Array.from({ length: MAX_STEPS }, () => ({
      active: false,
      note: 0,
      velocity: 1.0,
      chopIndex: 0,
    })),
  },
  {
    id: 'bass',
    name: 'Bajo / 808',
    color: '#a29bfe',
    type: 'bass',
    volume: 0.9,
    muted: false,
    solo: false,
    customBuffer: null,
    steps: Array.from({ length: DEFAULT_STEP_COUNT }, () => ({
      active: false,
      note: 0, // semitonos: 0 = C, 2 = D, etc.
      velocity: 1.0,
      chopIndex: 0,
    })),
  },
];

/**
 * Hook del Secuenciador de Patrones Multi-Pista.
 * Implementa Lookahead Web Audio Scheduler para sincronización sin jitter.
 */
export function useSequencer({ audioContext, getAudioContext, getDestination, ensureInit, chops = [], bpm = 90, playMode = 'mono', playChop } = {}) {
  const [tracks, setTracks] = useState(INITIAL_TRACKS);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepCount, setStepCountRaw] = useState(DEFAULT_STEP_COUNT);
  const [swing, setSwing] = useState(50); // 50% = recto, 54%..75% = groove MPC
  const [quantize, setQuantize] = useState(16);  // 4, 8, 16, 32 = resolución de grabación
  const [noteRepeat, setNoteRepeat] = useState(false); // Repetición de nota activa

  // Cambiar stepCount siempre reinicia el puntero para evitar pasos fuera de rango
  const setStepCount = useCallback((n) => {
    setStepCountRaw(n);
    currentStepRef.current = 0;
    setCurrentStep(0);
  }, []);

  // Helper para obtener el AudioContext activo
  const getActiveCtx = useCallback(() => {
    return (getAudioContext ? getAudioContext() : null) || audioContext;
  }, [audioContext, getAudioContext]);

  // Referencias para el bucle de audio de alta precisión
  const isPlayingRef = useRef(false);
  const isRecordingRef = useRef(false);
  const swingRef = useRef(50);
  const stepCountRef = useRef(DEFAULT_STEP_COUNT);
  const currentStepRef = useRef(0);
  const nextStepTimeRef = useRef(0);
  const loopStartAudioTimeRef = useRef(0);
  const timerIdRef = useRef(null);
  const tracksRef = useRef(tracks);
  const chopsRef = useRef(chops);
  const bpmRef = useRef(bpm);
  const playModeRef = useRef(playMode);
  const playChopRef = useRef(playChop);
  const quantizeRef = useRef(16);
  const noteRepeatRef = useRef(false);
  const noteRepeatTimerRef = useRef(null);
  const getDestinationRef = useRef(getDestination);

  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { chopsRef.current = chops; }, [chops]);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { playModeRef.current = playMode; }, [playMode]);
  useEffect(() => { playChopRef.current = playChop; }, [playChop]);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { swingRef.current = swing; }, [swing]);
  useEffect(() => { quantizeRef.current = quantize; }, [quantize]);
  useEffect(() => { noteRepeatRef.current = noteRepeat; }, [noteRepeat]);
  useEffect(() => { stepCountRef.current = stepCount; }, [stepCount]);
  useEffect(() => { getDestinationRef.current = getDestination; }, [getDestination]);

  // Duración de un paso de semicorchea (16th note) en segundos
  const getStepDuration = () => (60 / (bpmRef.current || 90)) / 4;

  // Programar notas en la ventana de audio
  const scheduleStep = useCallback((stepIdx, time) => {
    const ctx = getActiveCtx();
    if (!ctx) return;

    if (stepIdx === 0) {
      loopStartAudioTimeRef.current = time;
    }

    const currentTracks = tracksRef.current;
    const hasSolo = currentTracks.some((t) => t.solo);

    // Calcular desplazamiento de swing (Roger Linn MPC Swing en pasos impares)
    const stepDuration = getStepDuration();
    const swingOffset = (stepIdx % 2 === 1) ? ((swingRef.current - 50) / 100) * (stepDuration * 0.66) : 0;
    const actualTime = time + swingOffset;

    currentTracks.forEach((track) => {
      // Ignorar si está silenciado o si otra pista tiene Solo
      if (track.muted) return;
      if (hasSolo && !track.solo) return;

      const stepData = track.steps[stepIdx];
      if (!stepData || !stepData.active) return;

      const vel = stepData.velocity || 1.0;
      const note = stepData.note || 0;

      // Crear nodo de ganancia para el volumen de la pista.
      // Conectar a la cadena principal (worklet → analyser → destination)
      // para que el VU meter y el pitch detector capturen los sonidos del secuenciador.
      const trackGain = ctx.createGain();
      trackGain.gain.setValueAtTime(track.volume ?? 1.0, actualTime);
      const masterDest = (getDestinationRef.current?.()) ?? ctx.destination;
      trackGain.connect(masterDest);

      // Si tiene sample personalizado cargado
      if (track.customBuffer) {
        playCustomSample(ctx, trackGain, track.customBuffer, actualTime, vel, note);
        return;
      }

      // Reproducción según tipo de pista
      switch (track.type) {
        case 'kick':
          playKick(ctx, trackGain, actualTime, vel);
          break;
        case 'snare':
          playSnare(ctx, trackGain, actualTime, vel);
          break;
        case 'hihat':
          playHiHat(ctx, trackGain, actualTime, vel, false);
          break;
        case 'bass':
          playBass(ctx, trackGain, actualTime, vel, note);
          break;
        case 'chop': {
          const availableChops = chopsRef.current;
          if (availableChops.length > 0) {
            const chopIdx = (stepData.chopIndex || 0) % availableChops.length;
            const targetChop = availableChops[chopIdx];
            if (targetChop && playChopRef.current) {
              const delayMs = Math.max(0, (actualTime - ctx.currentTime) * 1000);
              setTimeout(() => {
                playChopRef.current(targetChop, {
                  cancelSequence: playModeRef.current ? playModeRef.current === 'mono' : true,
                  velocity: vel,
                });
              }, delayMs);
            }
          }
          break;
        }
        default:
          break;
      }
    });
  }, [getActiveCtx]);

  // Bucle lookahead continuo
  const schedulerTick = useCallback(() => {
    const ctx = getActiveCtx();
    if (!isPlayingRef.current || !ctx) return;

    const lookAheadSeconds = 0.1; // 100ms
    const stepDuration = getStepDuration();
    const currentStepCount = stepCountRef.current;

    while (nextStepTimeRef.current < ctx.currentTime + lookAheadSeconds) {
      const stepToSchedule = currentStepRef.current;
      scheduleStep(stepToSchedule, nextStepTimeRef.current);

      // Actualizar UI del paso actual de forma sincronizada
      const stepForUI = stepToSchedule;
      const delayUI = Math.max(0, (nextStepTimeRef.current - ctx.currentTime) * 1000);
      setTimeout(() => {
        if (isPlayingRef.current) {
          setCurrentStep(stepForUI);
        }
      }, delayUI);

      // Avanzar al siguiente paso del loop
      nextStepTimeRef.current += stepDuration;
      currentStepRef.current = (currentStepRef.current + 1) % currentStepCount;
    }

    timerIdRef.current = setTimeout(schedulerTick, 25);
  }, [getActiveCtx, scheduleStep]);

  // Controles de Transporte
  const play = useCallback(async () => {
    if (ensureInit) {
      await ensureInit();
    }
    const ctx = getActiveCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    isPlayingRef.current = true;
    setIsPlaying(true);
    const startAudioTime = ctx.currentTime + 0.05;
    nextStepTimeRef.current = startAudioTime;
    loopStartAudioTimeRef.current = startAudioTime;
    schedulerTick();
  }, [ensureInit, getActiveCtx, schedulerTick]);

  const pause = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (timerIdRef.current) {
      clearTimeout(timerIdRef.current);
      timerIdRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    pause();
    setIsRecording(false);
    isRecordingRef.current = false;
    currentStepRef.current = 0;
    setCurrentStep(0);
  }, [pause]);

  const toggleRecord = useCallback(() => {
    setIsRecording((prev) => {
      const next = !prev;
      isRecordingRef.current = next;
      // Si se activa REC y no está reproduciendo, arrancar playback
      if (next && !isPlayingRef.current) {
        play();
      }
      return next;
    });
  }, [play]);

  const recordHit = useCallback(({ trackId = 'chops', chopIndex = 0, note = 0, velocity = 1.0 } = {}) => {
    if (!isPlayingRef.current || !isRecordingRef.current) return;
    const ctx = getActiveCtx();
    if (!ctx) return;

    const stepDuration = getStepDuration();
    // Cuantización: 1/4 = cada 4 pasos, 1/8 = cada 2, 1/16 = cada paso, 1/32 = subdivisión
    const quantizeRes = quantizeRef.current || 16;
    const quantizeSteps = 16 / quantizeRes; // factores de paso
    const sc = stepCountRef.current;
    const loopDuration = stepDuration * sc;
    const now = ctx.currentTime;
    let elapsed = (now - loopStartAudioTimeRef.current) % loopDuration;
    if (elapsed < 0) elapsed += loopDuration;
    const rawStep = elapsed / stepDuration;
    // Cuantizar al grid elegido
    const gridStep = Math.round(rawStep / quantizeSteps) * quantizeSteps;
    const quantizedStep = Math.round(gridStep) % sc;

    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== trackId) return t;
        const newSteps = [...t.steps];
        newSteps[quantizedStep] = {
          active: true,
          note,
          velocity,
          chopIndex,
        };
        return { ...t, steps: newSteps };
      }),
    );
  }, [getActiveCtx]);

  // ── Modificadores de Pasos y Pistas ──────────────────────────────────────────

  const toggleStep = useCallback((trackId, stepIdx) => {
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== trackId) return t;
        const newSteps = [...t.steps];
        const cur = newSteps[stepIdx];
        newSteps[stepIdx] = { ...cur, active: !cur.active };
        return { ...t, steps: newSteps };
      }),
    );
  }, []);

  const setStepNote = useCallback((trackId, stepIdx, note) => {
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== trackId) return t;
        const newSteps = [...t.steps];
        newSteps[stepIdx] = { ...newSteps[stepIdx], note };
        return { ...t, steps: newSteps };
      }),
    );
  }, []);

  const setStepChop = useCallback((trackId, stepIdx, chopIndex) => {
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== trackId) return t;
        const newSteps = [...t.steps];
        newSteps[stepIdx] = { ...newSteps[stepIdx], chopIndex };
        return { ...t, steps: newSteps };
      }),
    );
  }, []);

  const setStepVelocity = useCallback((trackId, stepIdx, velocity) => {
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== trackId) return t;
        const newSteps = [...t.steps];
        newSteps[stepIdx] = { ...newSteps[stepIdx], velocity: Math.max(0.01, Math.min(1, velocity)) };
        return { ...t, steps: newSteps };
      }),
    );
  }, []);

  // Note Repeat: dispara el pad activo al ritmo del cuantizador mientras está activado
  const startNoteRepeat = useCallback((hitFn) => {
    if (noteRepeatTimerRef.current) return; // ya activo
    setNoteRepeat(true);
    noteRepeatRef.current = true;
    const fire = () => {
      if (!noteRepeatRef.current) return;
      if (hitFn) hitFn();
      const bpmNow = bpmRef.current || 90;
      const qRes = quantizeRef.current || 16;
      // Intervalo: un paso del tamaño de cuantización
      const interval = ((60 / bpmNow) / 4) * (16 / qRes) * 1000;
      noteRepeatTimerRef.current = setTimeout(fire, interval);
    };
    const bpmNow = bpmRef.current || 90;
    const qRes = quantizeRef.current || 16;
    const interval = ((60 / bpmNow) / 4) * (16 / qRes) * 1000;
    noteRepeatTimerRef.current = setTimeout(fire, interval);
  }, []);

  const stopNoteRepeat = useCallback(() => {
    setNoteRepeat(false);
    noteRepeatRef.current = false;
    if (noteRepeatTimerRef.current) {
      clearTimeout(noteRepeatTimerRef.current);
      noteRepeatTimerRef.current = null;
    }
  }, []);

  const toggleMute = useCallback((trackId) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)),
    );
  }, []);

  const toggleSolo = useCallback((trackId) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, solo: !t.solo } : t)),
    );
  }, []);

  const setTrackVolume = useCallback((trackId, vol) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, volume: vol } : t)),
    );
  }, []);

  const loadCustomSample = useCallback(async (trackId, file) => {
    if (!file) return;
    try {
      // Asegurar que el AudioContext esté inicializado antes de decodificar
      if (ensureInit) await ensureInit();
      const ctx = getActiveCtx();
      if (!ctx) {
        console.error('AudioContext no disponible para decodificar el sample.');
        return;
      }
      const arrayBuffer = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      setTracks((prev) =>
        prev.map((t) =>
          t.id === trackId
            ? { ...t, customBuffer: decoded, name: `${file.name.slice(0, 14)} (User)` }
            : t,
        ),
      );
    } catch (err) {
      console.error('Error al cargar sample en pista:', err);
    }
  }, [getActiveCtx, ensureInit]);

  // ── Presets de Ritmo ─────────────────────────────────────────────────────────

  const applyPreset = useCallback((presetName) => {
    setTracks((prev) => {
      const cloned = prev.map((t) => ({
        ...t,
        steps: t.steps.map((s) => ({ ...s, active: false, note: 0, chopIndex: 0 })),
      }));

      const findTrack = (id) => cloned.find((t) => t.id === id);

      if (presetName === 'boombap') {
        const kick = findTrack('kick');
        const snare = findTrack('snare');
        const hihat = findTrack('hihat');
        const bass = findTrack('bass');
        const chops = findTrack('chops');

        // Kick: 1, 11 (0-indexed: 0, 10)
        if (kick) [0, 10].forEach((i) => { if (kick.steps[i]) kick.steps[i].active = true; });
        // Snare: 5, 13 (0-indexed: 4, 12)
        if (snare) [4, 12].forEach((i) => { if (snare.steps[i]) snare.steps[i].active = true; });
        // HiHat: corcheas (0, 2, 4, 6, 8, 10, 12, 14)
        if (hihat) [0, 2, 4, 6, 8, 10, 12, 14].forEach((i) => { if (hihat.steps[i]) hihat.steps[i].active = true; });
        // Bass: notas C, Eb, F (0, 3, 5 semitonos)
        if (bass) {
          if (bass.steps[0]) { bass.steps[0].active = true; bass.steps[0].note = 0; }
          if (bass.steps[6]) { bass.steps[6].active = true; bass.steps[6].note = 3; }
          if (bass.steps[10]) { bass.steps[10].active = true; bass.steps[10].note = 5; }
        }
        // Chops: disparar pads 0, 1, 2
        if (chops) {
          if (chops.steps[0]) { chops.steps[0].active = true; chops.steps[0].chopIndex = 0; }
          if (chops.steps[8]) { chops.steps[8].active = true; chops.steps[8].chopIndex = 1; }
        }
      } else if (presetName === 'trap') {
        const kick = findTrack('kick');
        const snare = findTrack('snare');
        const hihat = findTrack('hihat');
        const bass = findTrack('bass');

        if (kick) [0, 6, 10].forEach((i) => { if (kick.steps[i]) kick.steps[i].active = true; });
        if (snare) [8].forEach((i) => { if (snare.steps[i]) snare.steps[i].active = true; });
        if (hihat) Array.from({ length: 16 }, (_, i) => i).forEach((i) => { if (hihat.steps[i]) hihat.steps[i].active = true; });
        if (bass) {
          if (bass.steps[0]) { bass.steps[0].active = true; bass.steps[0].note = 0; }
          if (bass.steps[6]) { bass.steps[6].active = true; bass.steps[6].note = -2; }
          if (bass.steps[10]) { bass.steps[10].active = true; bass.steps[10].note = 3; }
        }
      } else if (presetName === 'lofi') {
        const kick = findTrack('kick');
        const snare = findTrack('snare');
        const hihat = findTrack('hihat');
        const bass = findTrack('bass');
        const chops = findTrack('chops');

        if (kick) [0, 8, 11].forEach((i) => { if (kick.steps[i]) kick.steps[i].active = true; });
        if (snare) [4, 12].forEach((i) => { if (snare.steps[i]) snare.steps[i].active = true; });
        if (hihat) [0, 2, 4, 6, 8, 10, 12, 14].forEach((i) => { if (hihat.steps[i]) hihat.steps[i].active = true; });
        if (bass) {
          if (bass.steps[0]) { bass.steps[0].active = true; bass.steps[0].note = 0; }
          if (bass.steps[8]) { bass.steps[8].active = true; bass.steps[8].note = 2; }
        }
        if (chops) {
          [0, 4, 8, 12].forEach((step, idx) => {
            if (chops.steps[step]) {
              chops.steps[step].active = true;
              chops.steps[step].chopIndex = idx;
            }
          });
        }
      }

      return cloned;
    });
  }, []);

  const clearAll = useCallback(() => {
    setTracks((prev) =>
      prev.map((t) => ({
        ...t,
        steps: t.steps.map((s) => ({ ...s, active: false, note: 0 })),
      })),
    );
  }, []);

  // Cleanup al desmontar
  useEffect(() => () => {
    if (timerIdRef.current) {
      clearTimeout(timerIdRef.current);
    }
  }, []);

  return {
    tracks,
    isPlaying,
    isRecording,
    currentStep,
    stepCount,
    setStepCount,
    swing,
    setSwing,
    quantize,
    setQuantize,
    noteRepeat,
    startNoteRepeat,
    stopNoteRepeat,
    play,
    pause,
    stop,
    toggleRecord,
    recordHit,
    toggleStep,
    setStepNote,
    setStepChop,
    setStepVelocity,
    toggleMute,
    toggleSolo,
    setTrackVolume,
    loadCustomSample,
    applyPreset,
    clearAll,
  };
}

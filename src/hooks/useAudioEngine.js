import { useCallback, useEffect, useRef, useState } from 'react';
import { formatTime } from '../utils/format.js';
import { exportToWav, audioBufferToWavArrayBuffer } from '../utils/export.js';
import { saveCachedSample } from '../utils/audioStorage.js';
import { findZeroCrossing, snapChopToZeroCrossing } from '../utils/zeroCrossing.js';

/**
 * Motor de audio VX-CHOP 3.0 con AudioWorklet + WASM.
 *
 * Cadena de señal profesional:
 *   BufferSource → VoiceGain → [Choke & AHD Envelope]
 *   → AudioWorkletNode (Vintage DSP + RMS + Pitch YIN)
 *   → Multimode BiquadFilter (Lowpass / Highpass / Bandpass)
 *   → Tape Saturation (tanh con oversampling 4x)
 *   → Master FX Section:
 *       ├── Dry Path
 *       ├── BPM-Synced Stereo Delay (con damping cálido)
 *       └── Lofi Plate Reverb (difusión procedural analógica)
 *   → FX Sum
 *   → AnalyserNode
 *   → MasterGain (-2dB headroom)
 *   → Brickwall Limiter (DynamicsCompressor rápido anti-interpeak)
 *   ├── Destination (Altavoces / Auriculares)
 *   └── Lossless PCM Recorder (AudioWorklet 32-bit float bit-perfect)
 */

function makeTapeSaturationCurve(amount = 0) {
  if (amount <= 0.5) return null;
  const k = (amount / 100) * 3.5;
  const n_samples = 4096;
  const curve = new Float32Array(n_samples);
  const maxNorm = Math.tanh(1 + k * 0.6);
  for (let i = 0; i < n_samples; ++i) {
    const x = (i * 2) / n_samples - 1;
    curve[i] = Math.tanh(x * (1 + k * 0.6)) / maxNorm;
  }
  return curve;
}

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

function makeVinylNoiseBuffer(ctx, durationSec = 6.0) {
  const sr = ctx.sampleRate;
  const length = Math.floor(sr * durationSec);
  const buffer = ctx.createBuffer(2, length, sr);

  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      const hiss = (b0 + b1 + b2 + white * 0.5362) * 0.035;

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

function makePlateReverbImpulse(ctx, durationSec = 1.6, decayRate = 2.4) {
  const sr = ctx.sampleRate;
  const length = Math.floor(sr * durationSec);
  const impulse = ctx.createBuffer(2, length, sr);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const t = i / sr;
    const env = Math.exp(-t * decayRate);
    left[i] = (Math.random() * 2 - 1) * env;
    right[i] = (Math.random() * 2 - 1) * env;
  }
  return impulse;
}

export function useAudioEngine() {
  const audioContextRef   = useRef(null);
  const analyserRef       = useRef(null);
  const workletNodeRef    = useRef(null);
  const filterNodeRef     = useRef(null);
  const tapeNodeRef       = useRef(null);
  const masterGainRef     = useRef(null);
  const limiterNodeRef    = useRef(null);
  const bufferRef         = useRef(null);
  const activeVoicesRef   = useRef(new Map());
  const playbackTimersRef = useRef([]);
  const playbackStateRef  = useRef(null);
  const pitchRef          = useRef(0);
  const decayRef          = useRef(1.0);
  const playbackIdRef     = useRef(0);
  const initPromiseRef    = useRef(null);

  // Master FX Section Refs
  const dryGainRef        = useRef(null);
  const delayNodeRef      = useRef(null);
  const delayFeedbackRef  = useRef(null);
  const delayFilterRef    = useRef(null);
  const delayWetRef       = useRef(null);
  const reverbConvolverRef= useRef(null);
  const reverbWetRef      = useRef(null);
  const fxSumNodeRef      = useRef(null);

  // Master Lossless PCM Recording Refs
  const pcmRecorderNodeRef= useRef(null);
  const pcmChunksRef      = useRef({ left: [], right: [] });
  const mediaStreamDestRef= useRef(null);
  const mediaRecorderRef  = useRef(null);
  const recordedChunksRef = useRef([]);
  const [isMasterRecording, setIsMasterRecording] = useState(false);

  // Tape Stop / Vinyl Brake en Vivo (Estilo Roland SP-404)
  const [isTapeStopping, setIsTapeStopping] = useState(false);
  const tapeStopTimerRef = useRef(null);

  // Refs de análisis (60fps, sin re-renders)
  const rmsRef      = useRef(0);
  const pitchHzRef  = useRef(-1);

  // Reproducción continua
  const continuousSourceRef    = useRef(null);
  const continuousStartTimeRef = useRef(0);
  const continuousOffsetRef    = useRef(0);
  const [isContinuousPlaying, setIsContinuousPlaying] = useState(false);

  // Vinilo
  const vinylSourceNodeRef = useRef(null);
  const vinylGainNodeRef   = useRef(null);
  const [vinylCrackle, setVinylCrackle] = useState(0);
  const vinylCrackleRef    = useRef(0);

  // ── Rack FX: Wow & Flutter (Emulador de Cinta / Casete) ──
  const wowFlutterDelayRef  = useRef(null);  // DelayNode base ~2ms
  const wowLfoRef           = useRef(null);   // OscillatorNode ~0.5Hz wow
  const flutterLfoRef       = useRef(null);   // OscillatorNode ~6Hz flutter
  const wowLfoGainRef       = useRef(null);   // Depth gain for wow LFO
  const flutterLfoGainRef   = useRef(null);   // Depth gain for flutter LFO
  const [wowFlutter, setWowFlutter] = useState(0);
  const wowFlutterRef       = useRef(0);

  // ── Rack FX: Tape Hiss (Siseo de Cinta separado de Crackle) ──
  const hissSourceNodeRef   = useRef(null);
  const hissGainNodeRef     = useRef(null);
  const hissFilterNodeRef   = useRef(null);   // Bandpass para carácter de cinta
  const [tapeHiss, setTapeHiss] = useState(0);
  const tapeHissRef         = useRef(0);

  // ── Rack FX: Sidechain Compressor (Ducking) ──
  const sidechainGainNodeRef = useRef(null);  // GainNode insertado antes del fxSum
  const [sidechainEnabled, setSidechainEnabled] = useState(false);
  const [sidechainDepth, setSidechainDepth]     = useState(0.7);   // 0-1 cuánto duckea
  const [sidechainRelease, setSidechainRelease] = useState(150);   // ms de release
  const sidechainEnabledRef  = useRef(false);
  const sidechainDepthRef    = useRef(0.7);
  const sidechainReleaseRef  = useRef(150);

  // ── Rack FX: Juno-60 Chorus ──
  const chorusDelayLRef     = useRef(null);   // DelayNode izquierdo
  const chorusDelayRRef     = useRef(null);   // DelayNode derecho
  const chorusLfoLRef       = useRef(null);   // LFO izquierdo (seno)
  const chorusLfoRRef       = useRef(null);   // LFO derecho (coseno / cuadratura)
  const chorusLfoGainLRef   = useRef(null);
  const chorusLfoGainRRef   = useRef(null);
  const chorusDryRef        = useRef(null);
  const chorusWetRef        = useRef(null);
  const chorusSplitterRef   = useRef(null);
  const chorusMergerRef     = useRef(null);
  const [chorusMode, setChorusMode] = useState('off'); // 'off' | 'I' | 'II' | 'I+II'
  const chorusModeRef       = useRef('off');

  // Estado React Principal
  const [fileInfo, setFileInfo] = useState('Sin sample cargado');
  const [status,   setStatus]   = useState('Listo.');
  const [warning,  setWarning]  = useState('');
  const [buffer,   setBuffer]   = useState(null);
  const [pitch,    setPitch]    = useState(0);

  // Q-LINK Controls
  const [cutoff,     setCutoff]     = useState(20000);
  const [resonance,  setResonance]  = useState(1.0);
  const [decay,      setDecay]      = useState(1.0);
  const [drive,      setDrive]      = useState(0);
  const [filterType, setFilterType] = useState('lowpass');

  // Master FX Controls
  const [delayMix,   setDelayMix]   = useState(0);
  const [delayTime,  setDelayTime]  = useState(0.3);
  const [reverbMix,  setReverbMix]  = useState(0);

  // Modos Vintage DAC ('modern' | 'mpc60' | 'sp1200' | 's950')
  const [vintageMode, setVintageMode] = useState('modern');
  const vintageModeRef = useRef('modern');

  useEffect(() => { pitchRef.current = pitch; }, [pitch]);
  useEffect(() => { decayRef.current = decay; }, [decay]);
  useEffect(() => { vinylCrackleRef.current = vinylCrackle; }, [vinylCrackle]);
  useEffect(() => { wowFlutterRef.current = wowFlutter; }, [wowFlutter]);
  useEffect(() => { tapeHissRef.current = tapeHiss; }, [tapeHiss]);
  useEffect(() => { sidechainEnabledRef.current = sidechainEnabled; }, [sidechainEnabled]);
  useEffect(() => { sidechainDepthRef.current = sidechainDepth; }, [sidechainDepth]);
  useEffect(() => { sidechainReleaseRef.current = sidechainRelease; }, [sidechainRelease]);
  useEffect(() => { chorusModeRef.current = chorusMode; }, [chorusMode]);

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
    if (filterNodeRef.current && audioContextRef.current) {
      const now = audioContextRef.current.currentTime;
      filterNodeRef.current.type = filterType;
      filterNodeRef.current.frequency.setTargetAtTime(Math.max(20, Math.min(20000, cutoff)), now, 0.02);
      filterNodeRef.current.Q.setTargetAtTime(Math.max(0.1, Math.min(18, resonance)), now, 0.02);
    }
  }, [filterType, cutoff, resonance]);

  useEffect(() => {
    if (tapeNodeRef.current) {
      tapeNodeRef.current.curve = makeTapeSaturationCurve(drive);
    }
  }, [drive]);

  useEffect(() => {
    if (!audioContextRef.current) return;
    const now = audioContextRef.current.currentTime;
    if (delayNodeRef.current) {
      delayNodeRef.current.delayTime.setTargetAtTime(Math.max(0.01, Math.min(2.0, delayTime)), now, 0.03);
    }
    if (delayWetRef.current) {
      delayWetRef.current.gain.setTargetAtTime((delayMix / 100) * 0.7, now, 0.02);
    }
    if (reverbWetRef.current) {
      reverbWetRef.current.gain.setTargetAtTime((reverbMix / 100) * 0.55, now, 0.02);
    }
  }, [delayMix, delayTime, reverbMix]);

  useEffect(() => {
    if (vinylGainNodeRef.current && audioContextRef.current) {
      const now = audioContextRef.current.currentTime;
      const targetGain = (vinylCrackle / 100) * 0.35;
      vinylGainNodeRef.current.gain.setTargetAtTime(targetGain, now, 0.03);
    }
  }, [vinylCrackle]);

  // ── Rack FX: Wow & Flutter depth ──
  useEffect(() => {
    if (!audioContextRef.current) return;
    const now = audioContextRef.current.currentTime;
    const depth = (wowFlutter / 100);
    // Wow: 0-1.5ms desplazamiento a 0.5Hz
    if (wowLfoGainRef.current) {
      wowLfoGainRef.current.gain.setTargetAtTime(depth * 0.0015, now, 0.05);
    }
    // Flutter: 0-0.3ms desplazamiento a 6Hz
    if (flutterLfoGainRef.current) {
      flutterLfoGainRef.current.gain.setTargetAtTime(depth * 0.0003, now, 0.05);
    }
  }, [wowFlutter]);

  // ── Rack FX: Tape Hiss level ──
  useEffect(() => {
    if (hissGainNodeRef.current && audioContextRef.current) {
      const now = audioContextRef.current.currentTime;
      const targetGain = (tapeHiss / 100) * 0.18;
      hissGainNodeRef.current.gain.setTargetAtTime(targetGain, now, 0.03);
    }
  }, [tapeHiss]);

  // ── Rack FX: Juno-60 Chorus mode switching ──
  useEffect(() => {
    if (!audioContextRef.current) return;
    const now = audioContextRef.current.currentTime;
    // Chorus mode controls LFO rate and wet/dry mix
    // Mode I: 0.513Hz, subtle | Mode II: 0.863Hz, deeper | I+II: both
    const isActive = chorusMode !== 'off';
    if (chorusWetRef.current) {
      chorusWetRef.current.gain.setTargetAtTime(isActive ? 0.5 : 0, now, 0.03);
    }
    if (chorusDryRef.current) {
      chorusDryRef.current.gain.setTargetAtTime(1.0, now, 0.03);
    }
    if (chorusLfoLRef.current && chorusLfoRRef.current) {
      let rate = 0;
      let depth = 0;
      if (chorusMode === 'I') { rate = 0.513; depth = 0.0005; }
      else if (chorusMode === 'II') { rate = 0.863; depth = 0.0012; }
      else if (chorusMode === 'I+II') { rate = 0.513; depth = 0.0018; }
      chorusLfoLRef.current.frequency.setTargetAtTime(rate, now, 0.05);
      chorusLfoRRef.current.frequency.setTargetAtTime(rate, now, 0.05);
      if (chorusLfoGainLRef.current) {
        chorusLfoGainLRef.current.gain.setTargetAtTime(depth, now, 0.05);
      }
      if (chorusLfoGainRRef.current) {
        chorusLfoGainRRef.current.gain.setTargetAtTime(depth, now, 0.05);
      }
    }
  }, [chorusMode]);

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

  useEffect(() => () => {
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  const ensureInit = useCallback(async () => {
    if (audioContextRef.current) {
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      return;
    }

    if (initPromiseRef.current) return initPromiseRef.current;

    initPromiseRef.current = (async () => {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtxClass({ latencyHint: 'interactive' });

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.82;
      analyserRef.current = analyser;

      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(cutoff, ctx.currentTime);
      filter.Q.setValueAtTime(resonance, ctx.currentTime);
      filterNodeRef.current = filter;

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

        worklet.port.onmessage = ({ data }) => {
          if (data.type === 'rms')   rmsRef.current     = data.value;
          if (data.type === 'pitch') pitchHzRef.current = data.frequency;
        };

        try {
          const resp = await fetch(wasmUrl);
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            worklet.port.postMessage({ type: 'wasm', buffer: buf }, [buf]);
          }
        } catch {
          console.info('[VxChop] WASM no disponible — pitch detection en modo JS');
        }

        worklet.port.postMessage({ type: 'setVintageMode', mode: vintageModeRef.current });
        worklet.connect(filter);
        workletNodeRef.current = worklet;

        try {
          const pcmRecorder = new AudioWorkletNode(ctx, 'vxchop-recorder-processor');
          pcmRecorder.port.onmessage = ({ data }) => {
            if (data.type === 'chunk') {
              pcmChunksRef.current.left.push(data.left);
              pcmChunksRef.current.right.push(data.right);
            }
          };
          pcmRecorderNodeRef.current = pcmRecorder;
        } catch (err) {
          console.warn('[VxChop] PCM Recorder Worklet no inicializado:', err);
        }
      } catch (err) {
        console.warn('[VxChop] AudioWorklet no disponible, usando modo directo:', err);
      }

      const tape = ctx.createWaveShaper();
      tape.curve = makeTapeSaturationCurve(drive);
      tape.oversample = '4x';
      tapeNodeRef.current = tape;

      const fxSum = ctx.createGain();
      fxSum.gain.setValueAtTime(1.0, ctx.currentTime);
      fxSumNodeRef.current = fxSum;

      const dryGain = ctx.createGain();
      dryGain.gain.setValueAtTime(1.0, ctx.currentTime);
      dryGainRef.current = dryGain;
      tape.connect(dryGain);
      dryGain.connect(fxSum);

      const delay = ctx.createDelay(2.0);
      delay.delayTime.setValueAtTime(delayTime, ctx.currentTime);
      delayNodeRef.current = delay;

      const delayFeedback = ctx.createGain();
      delayFeedback.gain.setValueAtTime(0.38, ctx.currentTime);
      delayFeedbackRef.current = delayFeedback;

      const delayDampFilter = ctx.createBiquadFilter();
      delayDampFilter.type = 'lowpass';
      delayDampFilter.frequency.setValueAtTime(4200, ctx.currentTime);
      delayFilterRef.current = delayDampFilter;

      const delayWet = ctx.createGain();
      delayWet.gain.setValueAtTime((delayMix / 100) * 0.7, ctx.currentTime);
      delayWetRef.current = delayWet;

      tape.connect(delay);
      delay.connect(delayDampFilter);
      delayDampFilter.connect(delayFeedback);
      delayFeedback.connect(delay);
      delayDampFilter.connect(delayWet);
      delayWet.connect(fxSum);

      try {
        const reverbConvolver = ctx.createConvolver();
        reverbConvolver.buffer = makePlateReverbImpulse(ctx, 1.8, 2.5);
        reverbConvolverRef.current = reverbConvolver;

        const reverbWet = ctx.createGain();
        reverbWet.gain.setValueAtTime((reverbMix / 100) * 0.55, ctx.currentTime);
        reverbWetRef.current = reverbWet;

        tape.connect(reverbConvolver);
        reverbConvolver.connect(reverbWet);
        reverbWet.connect(fxSum);
      } catch (err) {
        console.warn('[VxChop] No se pudo inicializar convolver de reverb:', err);
      }

      // ── Rack FX: Wow & Flutter (Modulación de cinta) ──
      // Conexión base: filter → tape (siempre necesaria)
      filter.connect(tape);
      try {
        const wfDelay = ctx.createDelay(0.05);
        wfDelay.delayTime.setValueAtTime(0.002, ctx.currentTime); // base 2ms
        wowFlutterDelayRef.current = wfDelay;

        // Wow LFO: oscilación lenta ~0.5Hz (correa desgastada)
        const wowLfo = ctx.createOscillator();
        wowLfo.type = 'sine';
        wowLfo.frequency.setValueAtTime(0.5, ctx.currentTime);
        const wowDepth = ctx.createGain();
        const initWow = (wowFlutterRef.current / 100) * 0.0015;
        wowDepth.gain.setValueAtTime(initWow, ctx.currentTime);
        wowLfo.connect(wowDepth);
        wowDepth.connect(wfDelay.delayTime);
        wowLfo.start(0);
        wowLfoRef.current = wowLfo;
        wowLfoGainRef.current = wowDepth;

        // Flutter LFO: oscilación rápida ~6Hz (variación de motor)
        const flutterLfo = ctx.createOscillator();
        flutterLfo.type = 'triangle';
        flutterLfo.frequency.setValueAtTime(6.0, ctx.currentTime);
        const flutterDepth = ctx.createGain();
        const initFlutter = (wowFlutterRef.current / 100) * 0.0003;
        flutterDepth.gain.setValueAtTime(initFlutter, ctx.currentTime);
        flutterLfo.connect(flutterDepth);
        flutterDepth.connect(wfDelay.delayTime);
        flutterLfo.start(0);
        flutterLfoRef.current = flutterLfo;
        flutterLfoGainRef.current = flutterDepth;

        // Insertar wfDelay entre tape y los sends: tape → wfDelay → [dryGain, delay, reverb]
        tape.disconnect();
        filter.connect(tape);
        tape.connect(wfDelay);
        wfDelay.connect(dryGain);
        wfDelay.connect(delay);
        if (reverbConvolverRef.current) {
          wfDelay.connect(reverbConvolverRef.current);
        }
      } catch (err) {
        console.warn('[VxChop] No se pudo inicializar Wow & Flutter:', err);
        // Fallback: tape ya conectado a dryGain/delay/reverb directamente (líneas 435/455/471)
      }

      // ── Rack FX: Sidechain Compressor (Ducking) ──
      const sidechainGain = ctx.createGain();
      sidechainGain.gain.setValueAtTime(1.0, ctx.currentTime);
      sidechainGainNodeRef.current = sidechainGain;

      // ── Rack FX: Juno-60 Chorus ──
      try {
        const chorusSplitter = ctx.createChannelSplitter(2);
        const chorusMerger = ctx.createChannelMerger(2);
        chorusSplitterRef.current = chorusSplitter;
        chorusMergerRef.current = chorusMerger;

        const chorusDelayL = ctx.createDelay(0.05);
        chorusDelayL.delayTime.setValueAtTime(0.003, ctx.currentTime); // 3ms base
        chorusDelayLRef.current = chorusDelayL;

        const chorusDelayR = ctx.createDelay(0.05);
        chorusDelayR.delayTime.setValueAtTime(0.0037, ctx.currentTime); // 3.7ms base (offset)
        chorusDelayRRef.current = chorusDelayR;

        // LFOs en cuadratura (90° de fase) para espacialidad estéreo
        const chorusLfoL = ctx.createOscillator();
        chorusLfoL.type = 'sine';
        chorusLfoL.frequency.setValueAtTime(0.513, ctx.currentTime);
        const chorusLfoGainL = ctx.createGain();
        chorusLfoGainL.gain.setValueAtTime(0, ctx.currentTime); // off inicialmente
        chorusLfoL.connect(chorusLfoGainL);
        chorusLfoGainL.connect(chorusDelayL.delayTime);
        chorusLfoL.start(0);
        chorusLfoLRef.current = chorusLfoL;
        chorusLfoGainLRef.current = chorusLfoGainL;

        const chorusLfoR = ctx.createOscillator();
        chorusLfoR.type = 'sine';
        chorusLfoR.frequency.setValueAtTime(0.513, ctx.currentTime);
        // Fase de cuadratura: usar coseno (setPeriodicWave no necesario, delay de fase)
        // Aproximación: offset de 0.25 ciclos en el tiempo de inicio
        chorusLfoR.start(ctx.currentTime + (1 / 0.513) * 0.25); // 90° fase offset
        const chorusLfoGainR = ctx.createGain();
        chorusLfoGainR.gain.setValueAtTime(0, ctx.currentTime);
        chorusLfoR.connect(chorusLfoGainR);
        chorusLfoGainR.connect(chorusDelayR.delayTime);
        chorusLfoRRef.current = chorusLfoR;
        chorusLfoGainRRef.current = chorusLfoGainR;

        const chorusDry = ctx.createGain();
        chorusDry.gain.setValueAtTime(1.0, ctx.currentTime);
        chorusDryRef.current = chorusDry;

        const chorusWet = ctx.createGain();
        chorusWet.gain.setValueAtTime(0, ctx.currentTime); // off por defecto
        chorusWetRef.current = chorusWet;

        // Cadena: fxSum → sidechainGain → chorusDry → analyser (dry path)
        //                                → chorusSplitter → delayL/R → merger → chorusWet → analyser (wet path)
        fxSum.connect(sidechainGain);
        sidechainGain.connect(chorusDry);
        sidechainGain.connect(chorusSplitter);
        chorusSplitter.connect(chorusDelayL, 0);
        chorusSplitter.connect(chorusDelayR, 1);
        chorusDelayL.connect(chorusMerger, 0, 0);
        chorusDelayR.connect(chorusMerger, 0, 1);
        chorusMerger.connect(chorusWet);

        chorusDry.connect(analyser);
        chorusWet.connect(analyser);
      } catch (err) {
        console.warn('[VxChop] No se pudo inicializar Juno-60 Chorus:', err);
        // Fallback: conexión directa
        fxSum.connect(sidechainGain);
        sidechainGain.connect(analyser);
      }

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.80, ctx.currentTime);
      masterGainRef.current = masterGain;

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.setValueAtTime(-1.0, ctx.currentTime);
      limiter.knee.setValueAtTime(3.0, ctx.currentTime);
      limiter.ratio.setValueAtTime(20.0, ctx.currentTime);
      limiter.attack.setValueAtTime(0.002, ctx.currentTime);
      limiter.release.setValueAtTime(0.06, ctx.currentTime);
      limiterNodeRef.current = limiter;

      analyser.connect(masterGain);
      masterGain.connect(limiter);
      limiter.connect(ctx.destination);

      if (pcmRecorderNodeRef.current) {
        limiter.connect(pcmRecorderNodeRef.current);
      }

      try {
        const streamDest = ctx.createMediaStreamDestination();
        limiter.connect(streamDest);
        mediaStreamDestRef.current = streamDest;
      } catch { /* ok */ }

      // ── Vinyl Crackle (existente) ──
      const vinylGain = ctx.createGain();
      vinylGain.gain.setValueAtTime((vinylCrackleRef.current / 100) * 0.35, ctx.currentTime);
      vinylGainNodeRef.current = vinylGain;
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

      // ── Rack FX: Tape Hiss (Siseo de Cinta independiente) ──
      try {
        const hissFilter = ctx.createBiquadFilter();
        hissFilter.type = 'bandpass';
        hissFilter.frequency.setValueAtTime(3500, ctx.currentTime);
        hissFilter.Q.setValueAtTime(0.7, ctx.currentTime);
        hissFilterNodeRef.current = hissFilter;

        const hissGain = ctx.createGain();
        hissGain.gain.setValueAtTime((tapeHissRef.current / 100) * 0.18, ctx.currentTime);
        hissGainNodeRef.current = hissGain;

        // Generar ruido rosa filtrado para simular siseo de cinta
        const hissLength = Math.floor(ctx.sampleRate * 4.0);
        const hissBuffer = ctx.createBuffer(1, hissLength, ctx.sampleRate);
        const hissData = hissBuffer.getChannelData(0);
        let hb0 = 0, hb1 = 0, hb2 = 0;
        for (let i = 0; i < hissLength; i++) {
          const white = Math.random() * 2 - 1;
          hb0 = 0.99886 * hb0 + white * 0.0555179;
          hb1 = 0.99332 * hb1 + white * 0.0750759;
          hb2 = 0.96900 * hb2 + white * 0.1538520;
          hissData[i] = (hb0 + hb1 + hb2 + white * 0.5362) * 0.11;
        }

        const hissSrc = ctx.createBufferSource();
        hissSrc.buffer = hissBuffer;
        hissSrc.loop = true;
        hissSrc.connect(hissFilter);
        hissFilter.connect(hissGain);
        hissGain.connect(fxSum); // Se mezcla al nivel de FX sum
        hissSrc.start(0);
        hissSourceNodeRef.current = hissSrc;
      } catch (err) {
        console.warn('[VxChop] No se pudo inicializar Tape Hiss:', err);
      }

      audioContextRef.current = ctx;
      initPromiseRef.current = null;
    })();

    return initPromiseRef.current;
  }, [cutoff, resonance, drive, filterType, delayMix, delayTime, reverbMix]);

  const stopContinuous = useCallback(() => {
    if (continuousSourceRef.current) {
      try {
        continuousSourceRef.current.stop();
        continuousSourceRef.current.disconnect();
      } catch { /* ok */ }
      continuousSourceRef.current = null;
    }
    setIsContinuousPlaying(false);
  }, []);

  const stopAll = useCallback(() => {
    stopContinuous();

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
      } catch { /* ok */ }
    });
    activeVoicesRef.current.clear();

    playbackTimersRef.current.forEach((t) => window.clearTimeout(t));
    playbackTimersRef.current = [];
    playbackStateRef.current = null;
    rmsRef.current = 0;
  }, [stopContinuous]);

  const releaseChop = useCallback((chopId) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;

    activeVoicesRef.current.forEach((voice, key) => {
      if (voice.chop?.id === chopId) {
        const relSec = Math.max(0.005, Number(voice.chop?.release) || 0.04);
        try {
          voice.gain.gain.cancelScheduledValues(now);
          voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
          voice.gain.gain.linearRampToValueAtTime(0, now + relSec);
          voice.source.stop(now + relSec + 0.002);
        } catch { /* ok */ }
        activeVoicesRef.current.delete(key);
      }
    });
  }, []);

  const playChop = useCallback(async (chop, {
    cancelSequence = true,
    velocity = 1.0,
    pitchOffset = 0,
    chokeGroup = (chop?.chokeGroup !== undefined ? chop.chokeGroup : 1),
  } = {}) => {
    const targetBuffer = chop?.buffer || bufferRef.current;
    if (!targetBuffer) return;

    await ensureInit();
    const ctx = audioContextRef.current;
    const now = ctx.currentTime;

    if (cancelSequence) {
      stopAll();
    } else if (chokeGroup > 0) {
      activeVoicesRef.current.forEach((voice, key) => {
        if (voice.chokeGroup === chokeGroup) {
          try {
            voice.gain.gain.cancelScheduledValues(now);
            voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
            voice.gain.gain.linearRampToValueAtTime(0, now + 0.004);
            voice.source.stop(now + 0.005);
          } catch { /* ok */ }
          activeVoicesRef.current.delete(key);
        }
      });
    }

    const totalPitch = pitchRef.current + (Number(pitchOffset) || 0);
    const rate = 2 ** (totalPitch / 12);
    const startSec = Math.max(0, chop?.start !== undefined ? chop.start : 0);
    const endSec = (chop?.end !== undefined && chop.end > startSec) ? chop.end : targetBuffer.duration;
    const chopDuration = Math.max(0.01, endSec - startSec);
    const effectiveDecay = decayRef.current || 1.0;
    const playDuration = Math.min(chopDuration / rate, (chopDuration / rate) * effectiveDecay);

    const attackSec = Math.max(0.001, Number(chop?.attack) || 0.003);
    const releaseSec = Math.max(0.005, Number(chop?.release) || 0.04);
    const isGate = chop?.triggerMode === 'gate';

    const safeVel = Math.max(0.05, Math.min(1.0, Number(velocity) || 1.0));
    const targetGain = Math.min(1.0, safeVel ** 1.3);

    const source = ctx.createBufferSource();
    if (chop?.reverse) {
      source.buffer = makeReverseBuffer(ctx, targetBuffer, startSec, endSec);
    } else {
      source.buffer = targetBuffer;
    }
    source.playbackRate.value = rate;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(targetGain, now + attackSec);

    if (!isGate) {
      if (playDuration > attackSec + releaseSec) {
        gain.gain.setValueAtTime(targetGain, now + playDuration - releaseSec);
        gain.gain.linearRampToValueAtTime(0, now + playDuration);
      } else {
        gain.gain.linearRampToValueAtTime(0, now + playDuration);
      }
    }

    source.connect(gain);
    const dest = workletNodeRef.current ?? filterNodeRef.current ?? analyserRef.current ?? ctx.destination;
    gain.connect(dest);

    const pId = ++playbackIdRef.current;
    const voice = { id: pId, source, gain, chop, chokeGroup };
    activeVoicesRef.current.set(pId, voice);

    if (chop?.reverse) {
      source.start(now, 0, isGate ? undefined : playDuration * rate);
    } else {
      source.start(now, startSec, isGate ? undefined : playDuration * rate);
    }
    playbackStateRef.current = { chop, startAudioTime: now, rate, id: pId };

    source.onended = () => {
      activeVoicesRef.current.delete(pId);
      try {
        source.disconnect();
        gain.disconnect();
      } catch { /* ok */ }
      if (activeVoicesRef.current.size === 0) {
        rmsRef.current = 0;
      }
      if (playbackStateRef.current?.id === pId) {
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

  const playContinuous = useCallback(async (offset = 0, bufferOverride = null) => {
    const targetBuffer = bufferOverride || bufferRef.current;
    if (!targetBuffer) return;
    stopAll();
    await ensureInit();
    const ctx = audioContextRef.current;
    const rate = 2 ** (pitchRef.current / 12);
    const source = ctx.createBufferSource();
    source.buffer = targetBuffer;
    source.playbackRate.value = rate;

    const dest = workletNodeRef.current ?? filterNodeRef.current ?? analyserRef.current ?? ctx.destination;
    source.connect(dest);

    const safeOffset = Math.max(0, Math.min(targetBuffer.duration - 0.05, Number(offset) || 0));
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

  const getContinuousTime = useCallback(() => {
    if (!continuousSourceRef.current || !audioContextRef.current) {
      return continuousOffsetRef.current;
    }
    const rate = 2 ** (pitchRef.current / 12);
    const elapsed = (audioContextRef.current.currentTime - continuousStartTimeRef.current) * rate;
    const current = continuousOffsetRef.current + elapsed;
    const dur = continuousSourceRef.current.buffer?.duration || bufferRef.current?.duration || 0;
    return Math.max(0, Math.min(dur, current));
  }, []);

  // ── triggerTapeStop & releaseTapeStop (Efecto Roland SP-404 / Vinilo en Vivo) ──
  const triggerTapeStop = useCallback((durationSec = 0.85) => {
    setIsTapeStopping(true);
    setStatus('📼 TAPE STOP / VINYL BRAKE...');

    const ctx = audioContextRef.current;
    if (!ctx) return;
    if (tapeStopTimerRef.current) {
      window.clearTimeout(tapeStopTimerRef.current);
      tapeStopTimerRef.current = null;
    }

    const now = ctx.currentTime;
    const dur = Math.max(0.2, Number(durationSec) || 0.85);

    const sourcesToBrake = [];
    if (continuousSourceRef.current) {
      sourcesToBrake.push(continuousSourceRef.current);
    }
    activeVoicesRef.current.forEach((v) => {
      if (v.source) sourcesToBrake.push(v.source);
      if (v.gain) {
        try {
          v.gain.gain.cancelScheduledValues(now);
          v.gain.gain.setValueAtTime(v.gain.gain.value, now);
          v.gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        } catch { /* ignore */ }
      }
    });

    sourcesToBrake.forEach((src) => {
      try {
        const curRate = src.playbackRate.value || 1.0;
        src.playbackRate.cancelScheduledValues(now);
        src.playbackRate.setValueAtTime(curRate, now);
        src.playbackRate.exponentialRampToValueAtTime(0.005, now + dur);
      } catch { /* ignore */ }
    });

    tapeStopTimerRef.current = window.setTimeout(() => {
      stopAll();
      setIsTapeStopping(false);
      setStatus('Cinta detenida.');
    }, dur * 1000);
  }, [stopAll]);

  const releaseTapeStop = useCallback(() => {
    if (tapeStopTimerRef.current) {
      window.clearTimeout(tapeStopTimerRef.current);
      tapeStopTimerRef.current = null;
    }
    const ctx = audioContextRef.current;
    if (ctx) {
      const now = ctx.currentTime;
      const normalRate = 2 ** (pitchRef.current / 12);
      if (continuousSourceRef.current) {
        try {
          continuousSourceRef.current.playbackRate.cancelScheduledValues(now);
          continuousSourceRef.current.playbackRate.setValueAtTime(continuousSourceRef.current.playbackRate.value, now);
          continuousSourceRef.current.playbackRate.exponentialRampToValueAtTime(normalRate, now + 0.3);
        } catch { /* ignore */ }
      }
      activeVoicesRef.current.forEach((v) => {
        if (v.source) {
          try {
            v.source.playbackRate.cancelScheduledValues(now);
            v.source.playbackRate.setValueAtTime(v.source.playbackRate.value, now);
            v.source.playbackRate.exponentialRampToValueAtTime(normalRate, now + 0.3);
          } catch { /* ignore */ }
        }
        if (v.gain) {
          try {
            v.gain.gain.cancelScheduledValues(now);
            v.gain.gain.setValueAtTime(v.gain.gain.value, now);
            v.gain.gain.linearRampToValueAtTime(1.0, now + 0.2);
          } catch { /* ignore */ }
        }
      });
    }
    setIsTapeStopping(false);
  }, []);

  // ── Rack FX: Disparador de Sidechain / Ducking (Golpe de Bombo) ──
  const triggerSidechainKick = useCallback((timeOrDepth, depthOverride, releaseMsOverride) => {
    if (!sidechainEnabledRef.current || !sidechainGainNodeRef.current || !audioContextRef.current) return;
    const ctx = audioContextRef.current;
    let targetTime = ctx.currentTime;
    let depth = sidechainDepthRef.current;
    let releaseMs = sidechainReleaseRef.current;

    // Si el primer parámetro es un tiempo de AudioContext en el futuro (> 1.0 y > ctx.currentTime - 1)
    if (typeof timeOrDepth === 'number' && timeOrDepth > 1.0) {
      targetTime = timeOrDepth;
      if (typeof depthOverride === 'number') depth = depthOverride;
      if (typeof releaseMsOverride === 'number') releaseMs = releaseMsOverride;
    } else if (typeof timeOrDepth === 'number') {
      depth = timeOrDepth;
      if (typeof depthOverride === 'number') releaseMs = depthOverride;
    }

    const duckedGain = Math.max(0.02, 1.0 - depth);
    const releaseSec = releaseMs / 1000;
    const attackSec = 0.005; // 5ms attack rápido libre de clics

    try {
      const g = sidechainGainNodeRef.current.gain;
      g.cancelScheduledValues(targetTime);
      g.setValueAtTime(1.0, targetTime);
      g.linearRampToValueAtTime(duckedGain, targetTime + attackSec);
      g.exponentialRampToValueAtTime(1.0, targetTime + attackSec + Math.max(0.04, releaseSec));
    } catch { /* ok */ }
  }, []);

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

  const startMasterRecord = useCallback(async () => {
    await ensureInit();
    pcmChunksRef.current = { left: [], right: [] };

    if (pcmRecorderNodeRef.current) {
      pcmRecorderNodeRef.current.port.postMessage({ type: 'start' });
      setIsMasterRecording(true);
      setStatus('● GRABANDO MASTER LOSSLESS PCM (32-bit Float bit-perfect)...');
      return true;
    }

    const stream = mediaStreamDestRef.current?.stream;
    if (stream) {
      recordedChunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mr.start(50);
      mediaRecorderRef.current = mr;
      setIsMasterRecording(true);
      setStatus('● GRABANDO MASTER EN VIVO...');
      return true;
    }

    setStatus('No se pudo inicializar la grabación del Master.');
    return false;
  }, [ensureInit]);

  const stopMasterRecord = useCallback(async () => {
    if (!isMasterRecording) return null;
    const ctx = audioContextRef.current;
    if (!ctx) return null;

    setIsMasterRecording(false);
    setStatus('Procesando remuestreo del Master sin pérdidas...');

    if (pcmRecorderNodeRef.current) {
      return new Promise((resolve) => {
        const handleStopped = async (event) => {
          if (event.data?.type === 'stopped') {
            pcmRecorderNodeRef.current.port.removeEventListener('message', handleStopped);

            const chunksL = pcmChunksRef.current.left;
            const chunksR = pcmChunksRef.current.right;
            const totalSamples = chunksL.reduce((sum, c) => sum + c.length, 0);

            if (totalSamples === 0) {
              setStatus('Grabación vacía.');
              resolve(null);
              return;
            }

            const decoded = ctx.createBuffer(2, totalSamples, ctx.sampleRate);
            const outL = decoded.getChannelData(0);
            const outR = decoded.getChannelData(1);

            let offset = 0;
            for (let i = 0; i < chunksL.length; i++) {
              outL.set(chunksL[i], offset);
              outR.set(chunksR[i], offset);
              offset += chunksL[i].length;
            }

            bufferRef.current = decoded;
            setBuffer(decoded);
            const name = `Master_Lossless_${new Date().toLocaleTimeString().replace(/:/g, '-')}`;
            const fileInfoStr = `${name} · ${formatTime(decoded.duration)} · 32-bit PCM`;
            setFileInfo(fileInfoStr);

            try {
              const wavBytes = audioBufferToWavArrayBuffer(decoded);
              saveCachedSample(wavBytes, fileInfoStr).catch(() => {});
            } catch { /* ok */ }

            setStatus(`🎉 ¡Master remuestreado 100% Lossless (${formatTime(decoded.duration)})! Asignado como sample.`);
            resolve({ decoded, fileInfo: fileInfoStr });
          }
        };

        pcmRecorderNodeRef.current.port.addEventListener('message', handleStopped);
        pcmRecorderNodeRef.current.port.postMessage({ type: 'stop' });
      });
    }

    if (mediaRecorderRef.current) {
      return new Promise((resolve) => {
        const mr = mediaRecorderRef.current;
        mr.onstop = async () => {
          try {
            const blob = new Blob(recordedChunksRef.current, { type: mr.mimeType || 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();
            const copyBuf = arrayBuffer.slice(0);
            const decoded = await ctx.decodeAudioData(arrayBuffer);

            bufferRef.current = decoded;
            setBuffer(decoded);
            const name = `Master_Resample_${new Date().toLocaleTimeString().replace(/:/g, '-')}`;
            const fileInfoStr = `${name} · ${formatTime(decoded.duration)} · ${decoded.sampleRate} Hz`;
            setFileInfo(fileInfoStr);
            saveCachedSample(copyBuf, fileInfoStr).catch(() => {});
            setStatus(`🎉 Master remuestreado (${formatTime(decoded.duration)}).`);
            resolve({ decoded, fileInfo: fileInfoStr });
          } catch (err) {
            console.error('Error fallback resample:', err);
            resolve(null);
          }
        };
        mr.stop();
      });
    }

    return null;
  }, [isMasterRecording]);

  const exportMix = useCallback((chops) => {
    if (!bufferRef.current || !chops.length) return;
    exportToWav(bufferRef.current, chops, pitchRef.current);
    setStatus('WAV exportado correctamente.');
  }, []);

  const getDestination = useCallback(() => {
    return workletNodeRef.current ?? filterNodeRef.current ?? analyserRef.current ?? audioContextRef.current?.destination ?? null;
  }, []);

  return {
    audioContextRef,
    analyserRef,
    bufferRef,
    playbackStateRef,
    rmsRef,
    pitchHzRef,
    fileInfo,
    setFileInfo,
    status,
    setStatus,
    warning,
    buffer,
    setBuffer,
    pitch,
    setPitch,
    cutoff,
    setCutoff,
    resonance,
    setResonance,
    decay,
    setDecay,
    drive,
    setDrive,
    filterType,
    setFilterType,
    delayMix,
    setDelayMix,
    delayTime,
    setDelayTime,
    reverbMix,
    setReverbMix,
    vinylCrackle,
    setVinylCrackle,
    // ── Rack FX Analógicos Vintage ──
    wowFlutter,
    setWowFlutter,
    tapeHiss,
    setTapeHiss,
    sidechainEnabled,
    setSidechainEnabled,
    sidechainDepth,
    setSidechainDepth,
    sidechainRelease,
    setSidechainRelease,
    triggerSidechainKick,
    chorusMode,
    setChorusMode,
    // ── Fin Rack FX ──
    vintageMode,
    setVintageMode,
    isMasterRecording,
    startMasterRecord,
    stopMasterRecord,
    isTapeStopping,
    triggerTapeStop,
    releaseTapeStop,
    loadFile,
    ensureInit,
    playChop,
    releaseChop,
    playAll,
    stopAll,
    playContinuous,
    stopContinuous,
    getContinuousTime,
    isContinuousPlaying,
    exportMix,
    getDestination,
    findZeroCrossing: (timeSec) => findZeroCrossing(bufferRef.current, timeSec),
    snapChopToZeroCrossing: (chop) => snapChopToZeroCrossing(chop, bufferRef.current),
  };
}

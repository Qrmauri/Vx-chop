// ── VX-CHOP AudioWorklet Processor 3.0 (High Performance & Vintage DSP) ────────
//
// Corre en el hilo de audio dedicado del navegador (prioridad máxima).
// Recibe muestras en bloques de 128 samples, calcula RMS a 60fps,
// detecta pitch usando WASM (YIN) y procesa emulación de DACs Vintage:
//   - Modern (32-bit float puro transparente)
//   - MPC-60 (12-bit / 40kHz linear DAC, Roger Linn 1988)
//   - SP-1200 (12-bit / 26.04kHz con aliasing crunch y filtro SSM2044, Dave Rossum 1985)
//   - S950 (12-bit / 19.2kHz con filtro analógico Butterworth de 6 polos, Akai 1988)
//
// Comunicación con el hilo principal via this.port.postMessage():
//   { type: 'rms',   value: 0.0..1.0 }    — nivel de energía (agrupado a ~60fps)
//   { type: 'pitch', frequency: Hz }       — frecuencia fundamental (~500ms)

const ANALYSIS_BUFFER_SIZE = 4096;

class VxChopProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // ── Buffer de acumulación para análisis de pitch ─────────────────────────
    this._analysisBuffer = new Float32Array(ANALYSIS_BUFFER_SIZE);
    this._analysisIndex = 0;
    this._samplesSincePitch = 0;

    // ── Módulo WASM ──────────────────────────────────────────────────────────
    this._wasm = null;
    this._wasmInputView = null;

    // ── Optimización RMS a 60 fps (Throttling) ────────────────────────────────
    this._rmsSumSq = 0;
    this._rmsSampleCount = 0;
    this._rmsIntervalSamples = Math.max(128, Math.floor(sampleRate / 60));

    // ── Modo Vintage Sampler ('modern' | 'mpc60' | 'sp1200' | 's950') ─────────
    this._vintageMode = 'modern';

    // Estados de Sample & Hold (Downsampling para emulación vintage)
    this._phaseL = 0;
    this._phaseR = 0;
    this._holdL = 0;
    this._holdR = 0;

    // Estados de filtros IIR analógicos (MPC / SP-1200 SSM2044)
    this._filterL1 = 0;
    this._filterL2 = 0;
    this._filterR1 = 0;
    this._filterR2 = 0;

    // Estados de filtro de 6 polos Butterworth (Akai S950: 3 etapas biquad en cascada)
    this._s950_hpL1 = 0; this._s950_bpL1 = 0; this._s950_lpL1 = 0;
    this._s950_hpL2 = 0; this._s950_bpL2 = 0; this._s950_lpL2 = 0;
    this._s950_hpL3 = 0; this._s950_bpL3 = 0; this._s950_lpL3 = 0;

    this._s950_hpR1 = 0; this._s950_bpR1 = 0; this._s950_lpR1 = 0;
    this._s950_hpR2 = 0; this._s950_bpR2 = 0; this._s950_lpR2 = 0;
    this._s950_hpR3 = 0; this._s950_bpR3 = 0; this._s950_lpR3 = 0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'wasm') {
        this._initWasm(data.buffer);
      } else if (data.type === 'setVintageMode') {
        this._vintageMode = data.mode || 'modern';
      }
    };
  }

  async _initWasm(buffer) {
    try {
      const { instance } = await WebAssembly.instantiate(buffer);
      this._wasm = instance.exports;
      const ptr = this._wasm.getInputPtr();
      this._wasmInputView = new Float32Array(
        this._wasm.memory.buffer,
        ptr,
        ANALYSIS_BUFFER_SIZE,
      );
    } catch (err) {
      console.warn('[VxChop Worklet] WASM init failed:', err);
    }
  }

  /**
   * Corre exactamente cada 128 muestras en el hilo de audio.
   * Sin asignaciones de heap para garantizar 0% GC stutter.
   */
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0]) return true;

    const inputL = input[0];
    const inputR = input[1] || input[0];
    const len = inputL.length;

    const outL = output ? output[0] : null;
    const outR = output ? (output[1] || output[0]) : null;

    const mode = this._vintageMode;
    const sr = sampleRate;

    // ── PROCESAMIENTO VINTAGE SAMPLER DSP ──────────────────────────────────
    if (mode === 'modern' || !outL) {
      // Modo Moderno: 24/32-bit Floating Point limpio y transparente
      if (outL) outL.set(inputL);
      if (outR) outR.set(inputR);
    } else if (mode === 'mpc60') {
      // ── MPC-60 (Roger Linn, 1988) ─────────────────────────────────────────
      // • 12-bit linear DAC quantization (4096 pasos)
      // • Frecuencia nativa ~40,000 Hz con aliasing suave
      // • Salida analógica con pegada cálida y filtro de reconstrucción a 18kHz
      const targetRate = 40000;
      const stepPhase = targetRate / sr;
      const quantStep = 1 / 2048; // 12-bit
      const filterCoeff = Math.min(1.0, (2 * Math.PI * 18000) / sr);

      for (let i = 0; i < len; i++) {
        this._phaseL += stepPhase;
        if (this._phaseL >= 1.0) {
          this._phaseL -= 1.0;
          let sL = inputL[i];
          sL = Math.round(sL / quantStep) * quantStep;
          this._holdL = Math.tanh(sL * 1.05) * 0.98;
        }

        this._phaseR += stepPhase;
        if (this._phaseR >= 1.0) {
          this._phaseR -= 1.0;
          let sR = inputR[i];
          sR = Math.round(sR / quantStep) * quantStep;
          this._holdR = Math.tanh(sR * 1.05) * 0.98;
        }

        this._filterL1 += filterCoeff * (this._holdL - this._filterL1);
        this._filterR1 += filterCoeff * (this._holdR - this._filterR1);

        outL[i] = this._filterL1;
        if (outR) outR[i] = this._filterR1;
      }
    } else if (mode === 'sp1200') {
      // ── E-mu SP-1200 (Dave Rossum, 1985) ─────────────────────────────────
      // • Frecuencia legendaria de 26.04 kHz (26,040 Hz) sin interpolación
      // • Genera el auténtico "ring" de aliasing crujiente al transponer
      // • Cuantización 12-bit no lineal
      // • Filtro SSM2044 analógico con resonancia sutil
      const targetRate = 26040;
      const stepPhase = targetRate / sr;
      const quantStep = 1 / 2048; // 12-bit
      const fc = Math.min(0.48, (2 * Math.PI * 11500) / sr);
      const q = 0.35;

      for (let i = 0; i < len; i++) {
        this._phaseL += stepPhase;
        if (this._phaseL >= 1.0) {
          this._phaseL -= 1.0;
          let sL = inputL[i];
          sL = Math.round(sL / quantStep) * quantStep;
          this._holdL = Math.tanh(sL * 1.12) * 0.95;
        }

        this._phaseR += stepPhase;
        if (this._phaseR >= 1.0) {
          this._phaseR -= 1.0;
          let sR = inputR[i];
          sR = Math.round(sR / quantStep) * quantStep;
          this._holdR = Math.tanh(sR * 1.12) * 0.95;
        }

        this._filterL1 += fc * (this._holdL - this._filterL1 - q * this._filterL2);
        this._filterL2 += fc * this._filterL1;

        this._filterR1 += fc * (this._holdR - this._filterR1 - q * this._filterR2);
        this._filterR2 += fc * this._filterR1;

        outL[i] = this._filterL2;
        if (outR) outR[i] = this._filterR2;
      }
    } else if (mode === 's950') {
      // ── Akai S950 (1988) ──────────────────────────────────────────────────
      // • Frecuencia de muestreo dorada: 19,200 Hz
      // • Cuantización 12-bit lineal con compresión suave de entrada
      // • Filtro de reconstrucción analógico Butterworth de 6 polos a ~8.8kHz
      //   (3 etapas de segundo orden en cascada: Q = 0.5176, 0.7071, 1.9319)
      const targetRate = 19200;
      const stepPhase = targetRate / sr;
      const quantStep = 1 / 2048; // 12-bit
      const f = Math.min(0.45, 2 * Math.sin((Math.PI * 8800) / sr));

      // Coeficientes de amortiguamiento para 6 polos Butterworth (1 / Q)
      const d1 = 1.93185; // Q ≈ 0.5176
      const d2 = 1.41421; // Q ≈ 0.7071
      const d3 = 0.51764; // Q ≈ 1.9319

      for (let i = 0; i < len; i++) {
        this._phaseL += stepPhase;
        if (this._phaseL >= 1.0) {
          this._phaseL -= 1.0;
          let sL = inputL[i];
          sL = Math.round(sL / quantStep) * quantStep;
          // Calidez del preamp analógico del S950
          this._holdL = Math.tanh(sL * 1.08) * 0.96;
        }

        this._phaseR += stepPhase;
        if (this._phaseR >= 1.0) {
          this._phaseR -= 1.0;
          let sR = inputR[i];
          sR = Math.round(sR / quantStep) * quantStep;
          this._holdR = Math.tanh(sR * 1.08) * 0.96;
        }

        // Canal Izquierdo: Cascada de 3 etapas de 2 polos (6 polos total)
        // Etapa 1
        this._s950_hpL1 = this._holdL - d1 * this._s950_bpL1 - this._s950_lpL1;
        this._s950_bpL1 += f * this._s950_hpL1;
        this._s950_lpL1 += f * this._s950_bpL1;
        // Etapa 2
        this._s950_hpL2 = this._s950_lpL1 - d2 * this._s950_bpL2 - this._s950_lpL2;
        this._s950_bpL2 += f * this._s950_hpL2;
        this._s950_lpL2 += f * this._s950_bpL2;
        // Etapa 3
        this._s950_hpL3 = this._s950_lpL2 - d3 * this._s950_bpL3 - this._s950_lpL3;
        this._s950_bpL3 += f * this._s950_hpL3;
        this._s950_lpL3 += f * this._s950_bpL3;

        // Canal Derecho
        this._s950_hpR1 = this._holdR - d1 * this._s950_bpR1 - this._s950_lpR1;
        this._s950_bpR1 += f * this._s950_hpR1;
        this._s950_lpR1 += f * this._s950_bpR1;

        this._s950_hpR2 = this._s950_lpR1 - d2 * this._s950_bpR2 - this._s950_lpR2;
        this._s950_bpR2 += f * this._s950_hpR2;
        this._s950_lpR2 += f * this._s950_bpR2;

        this._s950_hpR3 = this._s950_lpR2 - d3 * this._s950_bpR3 - this._s950_lpR3;
        this._s950_bpR3 += f * this._s950_hpR3;
        this._s950_lpR3 += f * this._s950_bpR3;

        outL[i] = this._s950_lpL3;
        if (outR) outR[i] = this._s950_lpR3;
      }
    }

    // ── TELEMETRÍA RMS OPTIMIZADA A 60 FPS ──────────────────────────────────
    const activeOutL = outL || inputL;
    const activeOutR = outR || inputR;
    for (let i = 0; i < len; i++) {
      const s = (activeOutL[i] + activeOutR[i]) * 0.5;
      this._rmsSumSq += s * s;
    }
    this._rmsSampleCount += len;

    if (this._rmsSampleCount >= this._rmsIntervalSamples) {
      const rmsValue = Math.sqrt(this._rmsSumSq / this._rmsSampleCount);
      this.port.postMessage({ type: 'rms', value: rmsValue });
      this._rmsSumSq = 0;
      this._rmsSampleCount = 0;
    }

    // ── ACUMULACIÓN PARA DETECCIÓN DE PITCH (WASM YIN) ──────────────────────
    let blockRms = 0;
    for (let i = 0; i < len; i++) {
      const s = (inputL[i] + inputR[i]) * 0.5;
      blockRms += s * s;
    }
    blockRms = Math.sqrt(blockRms / len);

    if (blockRms > 0.008) {
      for (let i = 0; i < len; i++) {
        this._analysisBuffer[this._analysisIndex] = (inputL[i] + inputR[i]) * 0.5;
        this._analysisIndex = (this._analysisIndex + 1) % ANALYSIS_BUFFER_SIZE;
      }
      this._samplesSincePitch += len;

      if (this._samplesSincePitch >= 2048 && this._wasm && this._wasmInputView) {
        this._samplesSincePitch = 0;
        const head = this._analysisIndex;
        this._wasmInputView.set(this._analysisBuffer.subarray(head), 0);
        this._wasmInputView.set(this._analysisBuffer.subarray(0, head), ANALYSIS_BUFFER_SIZE - head);

        const frequency = this._wasm.yin(ANALYSIS_BUFFER_SIZE, sampleRate);
        if (frequency > 40 && frequency < 4000) {
          this.port.postMessage({ type: 'pitch', frequency });
        }
      }
    } else {
      this._samplesSincePitch = 0;
    }

    return true;
  }
}

// ── VX-CHOP Master Lossless PCM Recorder Processor ───────────────────────────
// Captura directa bit-perfect a 32-bit Float sin compresión ni pérdidas.
class VxChopRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._isRecording = false;
    this._chunkSize = 4096;
    this._bufL = new Float32Array(this._chunkSize);
    this._bufR = new Float32Array(this._chunkSize);
    this._bufIdx = 0;

    this.port.onmessage = (e) => {
      const data = e.data;
      if (!data) return;
      if (data.type === 'start') {
        this._isRecording = true;
        this._bufIdx = 0;
      } else if (data.type === 'stop') {
        if (this._isRecording && this._bufIdx > 0) {
          const left = this._bufL.slice(0, this._bufIdx);
          const right = this._bufR.slice(0, this._bufIdx);
          this.port.postMessage({ type: 'chunk', left, right }, [left.buffer, right.buffer]);
        }
        this._isRecording = false;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  process(inputs) {
    if (!this._isRecording) return true;
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const inL = input[0];
    const inR = input[1] || input[0];
    const len = inL.length;

    for (let i = 0; i < len; i++) {
      this._bufL[this._bufIdx] = inL[i];
      this._bufR[this._bufIdx] = inR[i];
      this._bufIdx++;

      if (this._bufIdx >= this._chunkSize) {
        const left = new Float32Array(this._bufL);
        const right = new Float32Array(this._bufR);
        this.port.postMessage({ type: 'chunk', left, right }, [left.buffer, right.buffer]);
        this._bufIdx = 0;
      }
    }

    return true;
  }
}

registerProcessor('vxchop-processor', VxChopProcessor);
registerProcessor('vxchop-recorder-processor', VxChopRecorderProcessor);

// ── VX-CHOP AudioWorklet Processor ────────────────────────────────────────────
//
// Corre en el hilo de audio dedicado del navegador (prioridad máxima).
// Recibe muestras en bloques de 128 samples, calcula RMS y detecta pitch
// usando el módulo WASM (YIN algorithm).
//
// Comunicación con el hilo principal via this.port.postMessage():
//   { type: 'rms',   value: 0.0..1.0 }    — nivel de energía (cada bloque)
//   { type: 'pitch', frequency: Hz }       — frecuencia fundamental (~500ms)

const ANALYSIS_BUFFER_SIZE = 4096;
const PITCH_INTERVAL_SAMPLES = 22050; // ~500ms a 44100Hz

class VxChopProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Buffer de acumulación para análisis de pitch
    this._analysisBuffer = new Float32Array(ANALYSIS_BUFFER_SIZE);
    this._analysisIndex = 0;
    this._samplesSincePitch = 0;

    // Módulo WASM (se envía desde el hilo principal)
    this._wasm = null;
    this._wasmInputView = null;

    this.port.onmessage = (event) => {
      if (event.data.type === 'wasm') {
        this._initWasm(event.data.buffer);
      }
    };
  }

  async _initWasm(buffer) {
    try {
      const { instance } = await WebAssembly.instantiate(buffer);
      this._wasm = instance.exports;
      // Crear vista tipada directa sobre la memoria WASM
      const ptr = this._wasm.getInputPtr();
      this._wasmInputView = new Float32Array(
        this._wasm.memory.buffer,
        ptr,
        ANALYSIS_BUFFER_SIZE,
      );
    } catch (err) {
      // WASM no disponible; el pitch se desactiva, el RMS sigue funcionando
      console.warn('[VxChop Worklet] WASM init failed:', err);
    }
  }

  /**
   * Corre exactamente cada 128 muestras, en el hilo de audio.
   * DEBE ser síncrono y sin asignaciones de heap para no causar GC stutter.
   */
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0]) return true;

    const inputL = input[0];
    // Si la entrada es estéreo usar canal 1; si es mono duplicar canal 0 a ambos parlantes
    const inputR = input[1] || input[0];

    // ── Pass-through estéreo: parlante izquierdo y derecho ──────────────────
    if (output) {
      if (output[0]) output[0].set(inputL);
      if (output[1]) output[1].set(inputR);
    }

    // ── RMS (enviado en cada bloque ~3ms a 44100Hz) ─────────────────────────
    let sumSq = 0;
    const len = inputL.length;
    for (let i = 0; i < len; i++) {
      const s = (inputL[i] + inputR[i]) * 0.5;
      sumSq += s * s;
    }
    const rmsValue = Math.sqrt(sumSq / len);
    this.port.postMessage({ type: 'rms', value: rmsValue });

    // ── Acumulación para detección de pitch (buffer circular) ──────────────
    if (rmsValue > 0.008) {
      for (let i = 0; i < len; i++) {
        this._analysisBuffer[this._analysisIndex] = (inputL[i] + inputR[i]) * 0.5;
        this._analysisIndex = (this._analysisIndex + 1) % ANALYSIS_BUFFER_SIZE;
      }
      this._samplesSincePitch += len;

      // Cada ~2048 muestras (~46ms a 44100Hz): ejecutar YIN en WASM
      if (this._samplesSincePitch >= 2048 && this._wasm && this._wasmInputView) {
        this._samplesSincePitch = 0;

        // Copiar el buffer circular en orden cronológico lineal a la memoria WASM
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

    return true; // mantener el procesador activo
  }
}

registerProcessor('vxchop-processor', VxChopProcessor);

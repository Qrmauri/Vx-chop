// ── VX-CHOP DSP Module (AssemblyScript → WebAssembly) ─────────────────────────
//
// Implementa el algoritmo YIN para detección de pitch fundamental.
// Se compila a WASM y se carga desde el AudioWorkletProcessor.
//
// Uso desde JS:
//   const ptr = getInputPtr();
//   new Float32Array(memory.buffer, ptr, BUFFER_SIZE).set(samples);
//   const hz = yin(validSamples, sampleRate);

// Tamaño del buffer (4096 muestras ≈ 93 ms a 44100 Hz)
const BUFFER_SIZE: i32 = 4096;
const HALF: i32 = BUFFER_SIZE / 2;

// Buffers en memoria WASM (asignados al inicio del heap)
const inputBuf  = new Float32Array(BUFFER_SIZE);  // muestras de entrada
const diffBuf   = new Float32Array(HALF);          // función de diferencia
const cmndBuf   = new Float32Array(HALF);          // CMNDF normalizada

/**
 * Devuelve el puntero al buffer de entrada.
 * JavaScript escribe las muestras aquí antes de llamar a yin().
 */
export function getInputPtr(): usize {
  return inputBuf.dataStart;
}

/**
 * Algoritmo YIN con interpolación parabólica.
 * Las muestras deben estar escritas en inputBuf antes de llamar.
 *
 * @param length     — número de muestras válidas en inputBuf (≤ BUFFER_SIZE)
 * @param sampleRate — frecuencia de muestreo en Hz
 * @returns frecuencia fundamental en Hz, o -1 si no se detectó
 */
export function yin(length: i32, sampleRate: f32): f32 {
  const halfLen: i32 = length >> 1;
  if (halfLen < 8) return -1.0;

  // ── Paso 1: Función de diferencia ────────────────────────────────────────────
  // d(τ) = Σ_{t=0}^{N/2} (x[t] − x[t+τ])²
  diffBuf[0] = 0.0;
  for (let tau: i32 = 1; tau < halfLen; tau++) {
    let d: f32 = 0.0;
    for (let t: i32 = 0; t < halfLen; t++) {
      const delta: f32 = inputBuf[t] - inputBuf[t + tau];
      d += delta * delta;
    }
    diffBuf[tau] = d;
  }

  // ── Paso 2: CMNDF (diferencia normalizada acumulada) ─────────────────────────
  // ĉ(τ) = d(τ) * τ / Σ_{j=1}^{τ} d(j)
  cmndBuf[0] = 1.0;
  let runSum: f32 = 0.0;
  for (let tau: i32 = 1; tau < halfLen; tau++) {
    runSum += diffBuf[tau];
    cmndBuf[tau] = runSum > 0.0 ? diffBuf[tau] * f32(tau) / runSum : 1.0;
  }

  // ── Paso 3: Umbral absoluto ───────────────────────────────────────────────────
  // Primer mínimo local por debajo del umbral de confianza
  const threshold: f32 = 0.15;
  let bestTau: i32 = -1;

  let tau: i32 = 2;
  while (tau < halfLen - 1) {
    if (cmndBuf[tau] < threshold) {
      // Bajar hasta el mínimo local
      while (tau + 1 < halfLen - 1 && cmndBuf[tau + 1] < cmndBuf[tau]) tau++;
      bestTau = tau;
      break;
    }
    tau++;
  }

  // Si no se encontró mínimo bajo el umbral, buscar el mínimo global
  if (bestTau < 0) {
    let globalMin: f32 = 1.0;
    for (let i: i32 = 2; i < halfLen - 1; i++) {
      if (cmndBuf[i] < globalMin) { globalMin = cmndBuf[i]; bestTau = i; }
    }
    // Rechazar si la confianza es muy baja (sonido no tonal)
    if (globalMin > 0.45) return -1.0;
  }

  if (bestTau < 2 || bestTau >= halfLen - 1) return -1.0;

  // ── Paso 4: Interpolación parabólica para precisión sub-muestra ───────────────
  const vPrev: f32 = cmndBuf[bestTau - 1];
  const vCurr: f32 = cmndBuf[bestTau];
  const vNext: f32 = cmndBuf[bestTau + 1];
  const denom: f32 = 2.0 * vCurr - vPrev - vNext;
  const refined: f32 = denom != 0.0
    ? f32(bestTau) + 0.5 * (vNext - vPrev) / denom
    : f32(bestTau);

  if (refined < 2.0) return -1.0;

  return sampleRate / refined;
}

/**
 * Calcula el RMS (nivel de energía) de las primeras `length` muestras en inputBuf.
 * @returns valor RMS [0.0, 1.0+]
 */
export function rms(length: i32): f32 {
  if (length <= 0) return 0.0;
  let sum: f32 = 0.0;
  for (let i: i32 = 0; i < length; i++) {
    sum += inputBuf[i] * inputBuf[i];
  }
  return Mathf.sqrt(sum / f32(length));
}

/**
 * transientDetector.js
 * Algoritmo avanzado de detección de transitorios musicales para VX-CHOP.
 * Detecta ataques de bombo, caja, percusión, acordes y transitorios de voz
 * utilizando cálculo de derivada de energía de alta frecuencia y umbral dinámico adaptativo.
 */

export function findZeroCrossing(buffer, time, searchWindowSecs = 0.008) {
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

/**
 * Detecta puntos de transitorios en un AudioBuffer.
 *
 * @param {AudioBuffer} audioBuffer 
 * @param {Object} options
 * @param {'low'|'medium'|'high'} [options.sensitivity='medium'] Sensibilidad de detección
 * @param {number} [options.maxChops=16] Número máximo de cortes a generar
 * @param {number} [options.minSliceSecs] Duración mínima entre cortes en segundos
 * @returns {Array<{ start: number, end: number, prominence: number }>}
 */
export function detectTransients(audioBuffer, options = {}) {
  if (!audioBuffer) return [];

  const {
    sensitivity = 'medium',
    maxChops = 16,
    minSliceSecs: userMinSlice,
  } = options;

  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const totalSamples = audioBuffer.length;
  const duration = audioBuffer.duration;

  if (duration < 0.1) return [];

  // Parámetros según sensibilidad
  const params = {
    low:    { thresholdMultiplier: 2.5, minSpacingSecs: 0.16, minRelEnergy: 0.035 },
    medium: { thresholdMultiplier: 1.6, minSpacingSecs: 0.11, minRelEnergy: 0.015 },
    high:   { thresholdMultiplier: 1.15, minSpacingSecs: 0.07, minRelEnergy: 0.006 },
  }[sensitivity] || { thresholdMultiplier: 1.6, minSpacingSecs: 0.11, minRelEnergy: 0.015 };

  const minSpacingSecs = userMinSlice !== undefined ? userMinSlice : params.minSpacingSecs;

  // Extraer señal mono normalizada
  const channelData0 = audioBuffer.getChannelData(0);
  const channelData1 = numChannels > 1 ? audioBuffer.getChannelData(1) : null;

  // Tamaño de ventana y salto para análisis (hopSize ~5.8ms a 44.1kHz)
  const frameSize = 512;
  const hopSize = 256;
  const numFrames = Math.floor((totalSamples - frameSize) / hopSize);

  if (numFrames < 4) return [];

  // 1. Calcular curva de energía con pre-énfasis de alta frecuencia (resalta transitorios percusivos)
  const energyCurve = new Float32Array(numFrames);
  let maxEnergy = 0;

  for (let f = 0; f < numFrames; f++) {
    const offset = f * hopSize;
    let sumSq = 0;
    let prevVal = 0;

    for (let i = 0; i < frameSize; i++) {
      let val = channelData0[offset + i];
      if (channelData1) {
        val = (val + channelData1[offset + i]) * 0.5;
      }
      // Filtro de pre-énfasis: y[n] = x[n] - 0.92 * x[n-1]
      const diff = val - 0.92 * prevVal;
      prevVal = val;
      sumSq += diff * diff;
    }

    const rms = Math.sqrt(sumSq / frameSize);
    energyCurve[f] = rms;
    if (rms > maxEnergy) maxEnergy = rms;
  }

  if (maxEnergy < 1e-5) return [];

  // 2. Función de Detección de Novedad (Spectral Flux / Energy Derivative)
  const novelty = new Float32Array(numFrames);
  for (let f = 1; f < numFrames; f++) {
    const delta = energyCurve[f] - energyCurve[f - 1];
    novelty[f] = delta > 0 ? delta : 0; // Half-wave rectification
  }

  // 3. Umbral adaptativo móvil (Moving Average Window de ~200ms)
  const windowFrames = Math.max(3, Math.round((0.2 * sampleRate) / hopSize));
  const halfWin = Math.floor(windowFrames / 2);
  const minEnergyGate = maxEnergy * params.minRelEnergy;

  const rawCandidates = [];

  for (let f = 2; f < numFrames - 2; f++) {
    if (energyCurve[f] < minEnergyGate) continue;

    // Calcular media local
    let sum = 0;
    let count = 0;
    const startW = Math.max(0, f - halfWin);
    const endW = Math.min(numFrames - 1, f + halfWin);
    for (let w = startW; w <= endW; w++) {
      sum += novelty[w];
      count++;
    }
    const localMean = count > 0 ? sum / count : 0;
    const adaptiveThreshold = localMean * params.thresholdMultiplier + (maxEnergy * 0.008);

    // Detección de picos locales
    if (
      novelty[f] > adaptiveThreshold &&
      novelty[f] > novelty[f - 1] &&
      novelty[f] >= novelty[f + 1]
    ) {
      const timeSec = (f * hopSize) / sampleRate;
      const prominence = novelty[f] / (adaptiveThreshold || 1);
      rawCandidates.push({ timeSec, prominence, energy: energyCurve[f] });
    }
  }

  // Asegurar que el inicio (tiempo 0) sea el primer corte
  const onsets = [0];

  // 4. Filtrado por distancia mínima (Evitar agrupamiento excesivo)
  // Ordenar candidatos por prominencia para priorizar los golpes más fuertes
  const sortedByProminence = [...rawCandidates].sort((a, b) => b.prominence - a.prominence);
  const selectedOnsets = [];

  for (const cand of sortedByProminence) {
    if (cand.timeSec < 0.04) continue; // Evitar duplicar el inicio
    if (cand.timeSec > duration - 0.05) continue; // Evitar el final exacto

    // Verificar que esté lo suficientemente separado de los ya aceptados
    const tooClose = selectedOnsets.some(
      (accepted) => Math.abs(accepted.timeSec - cand.timeSec) < minSpacingSecs
    );

    if (!tooClose) {
      selectedOnsets.push(cand);
      if (selectedOnsets.length >= maxChops - 1) break;
    }
  }

  // Ordenar cronológicamente
  selectedOnsets.sort((a, b) => a.timeSec - b.timeSec);

  // Alinear cada punto al cruce por cero para eliminar clics
  for (const cand of selectedOnsets) {
    const cleanTime = findZeroCrossing(audioBuffer, cand.timeSec, 0.012);
    // Asegurar que no esté demasiado cerca del punto anterior
    if (cleanTime - onsets[onsets.length - 1] >= minSpacingSecs * 0.7) {
      onsets.push(cleanTime);
    }
  }

  // Si solo hay 1 inicio (sample one-shot de bombo, caja, etc.), devolver 1 solo corte completo
  if (onsets.length <= 1) {
    return [{
      start: 0,
      end: duration,
      prominence: 2.0,
    }];
  }

  // Construir rebanadas finales con inicio y fin de cada transitorio real detectado
  const slices = [];
  for (let i = 0; i < onsets.length; i++) {
    const start = onsets[i];
    const end = i < onsets.length - 1 ? onsets[i + 1] : duration;
    if (end > start + 0.02) {
      slices.push({
        start,
        end,
        prominence: i === 0 ? 2.0 : (selectedOnsets[i - 1]?.prominence || 1.0),
      });
    }
  }

  return slices.slice(0, maxChops);
}

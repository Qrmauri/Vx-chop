/**
 * Módulo de Detección y Auto-Alineación de Cruce por Cero (Zero-Crossing)
 * para eliminación absoluta de clicks y pops en edición y reproducción de samples.
 */

/**
 * Encuentra el punto de cruce por cero más cercano a un tiempo objetivo en un AudioBuffer.
 * Analiza ambos canales (si es estéreo) o canal 0.
 *
 * @param {AudioBuffer} buffer - Buffer de audio
 * @param {number} timeSec - Tiempo en segundos objetivo
 * @param {number} searchWindowSecs - Ventana de búsqueda (por defecto 10ms)
 * @returns {number} Tiempo en segundos alineado al cruce por cero
 */
export function findZeroCrossing(buffer, timeSec, searchWindowSecs = 0.01) {
  if (!buffer || typeof timeSec !== 'number' || isNaN(timeSec) || timeSec <= 0) {
    return Math.max(0, timeSec || 0);
  }

  const sampleRate = buffer.sampleRate;
  const targetSample = Math.floor(timeSec * sampleRate);
  const halfWindow = Math.floor((searchWindowSecs * sampleRate) / 2);
  const dataL = buffer.getChannelData(0);
  const dataR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;

  const startIdx = Math.max(0, targetSample - halfWindow);
  const endIdx = Math.min(dataL.length - 2, targetSample + halfWindow);

  let bestIdx = targetSample;
  let minEnergy = Infinity;

  // 1. Primer intento: buscar cambio de signo estricto (cruce exacto)
  for (let i = startIdx; i <= endIdx; i++) {
    const crossL = dataL[i] * dataL[i + 1] <= 0;
    const crossR = dataR ? dataR[i] * dataR[i + 1] <= 0 : true;

    if (crossL && crossR) {
      // Si ambos cruzan, ponderar por la amplitud mínima absoluta
      const energy = Math.abs(dataL[i]) + (dataR ? Math.abs(dataR[i]) : 0);
      const distFromTarget = Math.abs(i - targetSample) / sampleRate;
      const score = energy + distFromTarget * 0.01;
      if (score < minEnergy) {
        minEnergy = score;
        bestIdx = i;
      }
    }
  }

  // 2. Segundo intento: si no hubo cruce simultáneo, buscar cruce en canal izquierdo
  if (minEnergy === Infinity) {
    for (let i = startIdx; i <= endIdx; i++) {
      if (dataL[i] * dataL[i + 1] <= 0) {
        const energy = Math.abs(dataL[i]);
        if (energy < minEnergy) {
          minEnergy = energy;
          bestIdx = i;
        }
      }
    }
  }

  // 3. Fallback: punto de mínima amplitud absoluta en la ventana
  if (minEnergy === Infinity) {
    for (let i = startIdx; i <= endIdx; i++) {
      const energy = Math.abs(dataL[i]) + (dataR ? Math.abs(dataR[i]) : 0);
      if (energy < minEnergy) {
        minEnergy = energy;
        bestIdx = i;
      }
    }
  }

  return bestIdx / sampleRate;
}

/**
 * Auto-ajusta los límites de un corte (chop) al cruce por cero más cercano.
 * @param {Object} chop - Objeto del chop { start, end, ... }
 * @param {AudioBuffer} buffer - Buffer de audio original
 * @returns {Object} Chop con start y end alineados a zero-crossing
 */
export function snapChopToZeroCrossing(chop, buffer) {
  if (!chop || !buffer) return chop;

  const newStart = findZeroCrossing(buffer, chop.start, 0.012);
  let newEnd = chop.end;
  if (typeof chop.end === 'number' && chop.end > newStart) {
    newEnd = findZeroCrossing(buffer, chop.end, 0.012);
    // Garantizar duración mínima
    if (newEnd <= newStart + 0.02) {
      newEnd = Math.min(buffer.duration, newStart + 0.03);
    }
  }

  return {
    ...chop,
    start: Number(newStart.toFixed(6)),
    end: Number(newEnd.toFixed(6)),
  };
}

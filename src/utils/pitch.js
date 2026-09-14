const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Detección de pitch de alta precisión mediante algoritmo YIN completo
 * con CMNDF (Cumulative Mean Normalized Difference Function) e interpolación parabólica.
 *
 * @param {AudioBuffer} audioBuffer
 * @param {{ start: number, end: number } | null} chop — null = todo el buffer
 * @returns {{ frequency: number, note: string, cents: number } | null}
 */
export const detectPitch = (audioBuffer, chop) => {
  if (!audioBuffer) return null;

  const sampleRate = audioBuffer.sampleRate;
  const start = chop ? Math.floor(chop.start * sampleRate) : 0;
  const end = chop
    ? Math.min(audioBuffer.length, Math.ceil(chop.end * sampleRate))
    : audioBuffer.length;
  const totalSamples = end - start;
  if (totalSamples < 256) return null;

  const source = audioBuffer.getChannelData(0);

  // Buscar la ventana de mayor energía en el primer tercio del sonido para evitar ataques mudos
  const searchLimit = Math.min(totalSamples, Math.floor(sampleRate * 0.4));
  let bestOffset = 0;
  let maxLocalEnergy = 0;
  const winStep = Math.max(64, Math.floor(sampleRate / 100));

  for (let offset = 0; offset + 512 <= searchLimit; offset += winStep) {
    let localEnergy = 0;
    for (let i = 0; i < 512; i += 8) {
      const v = source[start + offset + i];
      localEnergy += v * v;
    }
    if (localEnergy > maxLocalEnergy) {
      maxLocalEnergy = localEnergy;
      bestOffset = offset;
    }
  }

  // Tomar una ventana de 2048 muestras a partir de la mejor zona
  const windowSize = Math.min(2048, totalSamples);
  const sampleStart = Math.min(start + bestOffset, end - windowSize);
  const samples = new Float32Array(windowSize);
  for (let i = 0; i < windowSize; i++) {
    samples[i] = source[sampleStart + i];
  }

  // Normalizar y restar media
  const mean = samples.reduce((s, v) => s + v, 0) / windowSize;
  let energy = 0;
  for (let i = 0; i < windowSize; i++) {
    samples[i] -= mean;
    energy += samples[i] * samples[i];
  }
  if (!energy || energy / windowSize < 0.000005) return null;

  // Lags para rango musical entre 40 Hz y 2000 Hz
  const minLag = Math.max(2, Math.floor(sampleRate / 2000));
  const maxLag = Math.min(Math.floor(windowSize / 2), Math.floor(sampleRate / 40));

  // Función de diferencia YIN: d(τ) = Σ (x[t] - x[t+τ])²
  const halfLen = Math.floor(windowSize / 2);
  const diff = new Float32Array(maxLag + 1);
  diff[0] = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    let d = 0;
    for (let t = 0; t < halfLen; t++) {
      const delta = samples[t] - samples[t + tau];
      d += delta * delta;
    }
    diff[tau] = d;
  }

  // CMNDF: d'(τ) = d(τ) / ((1/τ) * Σ_{j=1}^τ d(j))
  const cmndf = new Float32Array(maxLag + 1);
  cmndf[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    runningSum += diff[tau];
    cmndf[tau] = runningSum > 0 ? (diff[tau] * tau) / runningSum : 1;
  }

  // Encontrar el primer mínimo local por debajo del umbral absoluto (0.20)
  const threshold = 0.20;
  let bestTau = -1;
  for (let tau = minLag; tau < maxLag; tau++) {
    if (cmndf[tau] < threshold) {
      while (tau + 1 < maxLag && cmndf[tau + 1] < cmndf[tau]) {
        tau++;
      }
      bestTau = tau;
      break;
    }
  }

  // Si no se encontró por debajo del umbral, buscar el mínimo global si es suficientemente armónico
  if (bestTau === -1) {
    let globalMin = 1.0;
    for (let tau = minLag; tau < maxLag; tau++) {
      if (cmndf[tau] < globalMin) {
        globalMin = cmndf[tau];
        bestTau = tau;
      }
    }
    if (globalMin > 0.45) return null;
  }

  if (bestTau <= 1 || bestTau >= maxLag) return null;

  // Interpolación parabólica sub-muestra del mínimo para precisión en cents
  const s0 = cmndf[bestTau - 1];
  const s1 = cmndf[bestTau];
  const s2 = cmndf[bestTau + 1];
  const denom = 2 * s1 - s0 - s2;
  const refinedTau = denom !== 0 ? bestTau + (0.5 * (s2 - s0)) / denom : bestTau;

  const frequency = sampleRate / refinedTau;
  if (frequency < 40 || frequency > 3500) return null;

  const midi = 69 + 12 * Math.log2(frequency / 440);
  const nearestMidi = Math.round(midi);

  return {
    frequency,
    note: `${NOTE_NAMES[(nearestMidi + 120) % 12]}${Math.floor(nearestMidi / 12) - 1}`,
    cents: Math.round((midi - nearestMidi) * 100),
  };
};

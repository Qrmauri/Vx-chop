/**
 * Generador y sintetizador nativo de batería y bajo para Web Audio API.
 * Proporciona sonidos analógicos / 808 con pegada instantánea sin necesidad
 * de descargar archivos externos.
 */

// Buffer de ruido blanco compartido para Snare y Hi-Hat
let sharedNoiseBuffer = null;

function getNoiseBuffer(ctx) {
  if (sharedNoiseBuffer && sharedNoiseBuffer.sampleRate === ctx.sampleRate) {
    return sharedNoiseBuffer;
  }
  const bufferSize = ctx.sampleRate * 2; // 2 segundos de ruido
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  sharedNoiseBuffer = buffer;
  return buffer;
}

/**
 * Bombo analógico con caída de tono rápida (Punchy 808 / Boom Bap Kick)
 */
export function playKick(ctx, destination, time = ctx.currentTime, velocity = 1.0) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  const baseFreq = 150;
  const endFreq = 40;
  const decay = 0.35;
  const velGain = Math.max(0.05, Math.min(1.0, velocity)) * 1.1;

  osc.frequency.setValueAtTime(baseFreq, time);
  osc.frequency.exponentialRampToValueAtTime(endFreq, time + 0.08);

  gain.gain.setValueAtTime(velGain, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

  osc.connect(gain);
  gain.connect(destination);

  osc.start(time);
  osc.stop(time + decay);
}

/**
 * Caja crujiente estilo MPC (Tono corporal + ráfaga de ruido)
 */
export function playSnare(ctx, destination, time = ctx.currentTime, velocity = 1.0) {
  const velGain = Math.max(0.05, Math.min(1.0, velocity));

  // 1. Tono acústico del parche
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(220, time);
  osc.frequency.exponentialRampToValueAtTime(100, time + 0.07);
  oscGain.gain.setValueAtTime(velGain * 0.7, time);
  oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
  osc.connect(oscGain);
  oscGain.connect(destination);
  osc.start(time);
  osc.stop(time + 0.12);

  // 2. Ráfaga de ruido filtrado (bordonera)
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(1200, time);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(velGain * 0.8, time);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);

  noiseSource.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(destination);

  noiseSource.start(time);
  noiseSource.stop(time + 0.25);
}

/**
 * Charles / Hi-Hat metálico (cerrado o abierto)
 */
export function playHiHat(ctx, destination, time = ctx.currentTime, velocity = 1.0, open = false) {
  const velGain = Math.max(0.05, Math.min(1.0, velocity));
  const decay = open ? 0.35 : 0.06;

  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(8500, time);
  filter.Q.setValueAtTime(4.0, time);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(velGain * 0.65, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(destination);

  noise.start(time);
  noise.stop(time + decay + 0.02);
}

/**
 * Bajo 808 / Sub-Bass con tono musical ajustable (semitonos respecto a C1 = 32.7Hz)
 */
export function playBass(ctx, destination, time = ctx.currentTime, velocity = 1.0, semitones = 0) {
  const velGain = Math.max(0.05, Math.min(1.0, velocity));
  const baseFreq = 32.703; // C1
  const freq = baseFreq * (2 ** ((semitones + 12) / 12)); // C2 base para claridad
  const decay = 0.45;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, time);

  // Ataque anti-clic suave y decay sostenido
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(velGain * 0.95, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

  osc.connect(gain);
  gain.connect(destination);

  osc.start(time);
  osc.stop(time + decay);
}

/**
 * Reproduce un AudioBuffer personalizado cargado por el usuario
 */
export function playCustomSample(ctx, destination, buffer, time = ctx.currentTime, velocity = 1.0, semitones = 0) {
  if (!buffer) return;
  const velGain = Math.max(0.05, Math.min(1.0, velocity));
  const rate = 2 ** (semitones / 12);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.setValueAtTime(rate, time);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(velGain, time);

  source.connect(gain);
  gain.connect(destination);

  source.start(time);
}

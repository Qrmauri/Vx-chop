/**
 * Exporta los chops como un WAV PCM de 16 bits.
 *
 * Mejoras respecto a la versión original:
 *  - Interpolación lineal al cambiar pitch (elimina aliasing audible)
 *  - Fade in/out de 5 ms en cada chop (evita clics entre cortes)
 *
 * @param {AudioBuffer} source
 * @param {Array<{ start: number, end: number }>} chops
 * @param {number} pitchSemitones  — semitonos de pitch shift (-12..+12)
 */
export function exportToWav(source, chops, pitchSemitones = 0) {
  const validChops = (chops || []).filter(Boolean);
  if (validChops.length === 0) return;

  const rate = 2 ** ((pitchSemitones || 0) / 12);
  const sampleRate = source?.sampleRate || validChops[0]?.buffer?.sampleRate || 44100;
  const targetChannels = 2; // Siempre exportar en estéreo para evitar reproducción en un solo parlante

  const totalFrames = validChops.reduce((sum, chop) => {
    const s = chop.buffer || source;
    const startSec = Math.max(0, chop.start !== undefined ? chop.start : 0);
    const endSec = (chop.end !== undefined && chop.end > startSec) ? chop.end : (s ? s.duration : 0);
    return sum + Math.max(1, Math.round(((endSec - startSec) * sampleRate) / rate));
  }, 0);

  const output = Array.from({ length: targetChannels }, () => new Float32Array(totalFrames));
  const FADE_SECS = 0.005;

  let cursor = 0;
  validChops.forEach((chop) => {
    const s = chop.buffer || source;
    if (!s) return;
    const numChannels = s.numberOfChannels;
    const channelData = Array.from(
      { length: numChannels },
      (_, ch) => s.getChannelData(ch),
    );

    const startSec = Math.max(0, chop.start !== undefined ? chop.start : 0);
    const endSec = (chop.end !== undefined && chop.end > startSec) ? chop.end : s.duration;
    const length = Math.max(1, Math.round(((endSec - startSec) * sampleRate) / rate));
    const fade = Math.min(Math.floor(sampleRate * FADE_SECS), Math.floor(length / 2));
    const fromSample = startSec * s.sampleRate;

    for (let frame = 0; frame < length; frame++) {
      const exactIndex = fromSample + frame * rate;
      const i0 = Math.floor(exactIndex);
      const i1 = Math.min(s.length - 1, i0 + 1);
      const frac = exactIndex - i0;

      let envelope = 1;
      if (frame < fade) envelope = frame / fade;
      else if (frame >= length - fade) envelope = (length - 1 - frame) / Math.max(1, fade);

      for (let ch = 0; ch < targetChannels; ch++) {
        const srcCh = channelData[Math.min(ch, numChannels - 1)];
        const sample = (srcCh[i0] ?? 0) * (1 - frac) + (srcCh[i1] ?? 0) * frac;
        output[ch][cursor + frame] = sample * envelope;
      }
    }

    cursor += length;
  });

  // ── Escribir cabecera RIFF/WAVE + datos PCM 16-bit ───────────────────────────
  const bytes = new ArrayBuffer(44 + totalFrames * targetChannels * 2);
  const view = new DataView(bytes);

  const writeStr = (offset, str) =>
    [...str].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));

  writeStr(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);                                  // tamaño chunk fmt
  view.setUint16(20, 1, true);                                   // PCM
  view.setUint16(22, targetChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * targetChannels * 2, true);   // byte rate
  view.setUint16(32, targetChannels * 2, true);                // block align
  view.setUint16(34, 16, true);                                  // bits/sample
  writeStr(36, 'data');
  view.setUint32(40, totalFrames * targetChannels * 2, true);

  let offset = 44;
  for (let frame = 0; frame < totalFrames; frame++) {
    for (let ch = 0; ch < targetChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, output[ch][frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'vxchop-export.wav';
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Convierte un AudioBuffer directamente a un ArrayBuffer con formato WAV RIFF 16-bit PCM.
 * Útil para persistencia en IndexedDB o descargas binarias.
 *
 * @param {AudioBuffer} buffer
 * @returns {ArrayBuffer}
 */
export function audioBufferToWavArrayBuffer(buffer) {
  const numberOfChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const targetChannels = Math.min(2, numberOfChannels);
  const bytes = new ArrayBuffer(44 + length * targetChannels * 2);
  const view = new DataView(bytes);

  const writeStr = (offset, str) =>
    [...str].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));

  writeStr(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, targetChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * targetChannels * 2, true);
  view.setUint16(32, targetChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, length * targetChannels * 2, true);

  const channelData = [];
  for (let c = 0; c < targetChannels; c++) {
    channelData.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < targetChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return bytes;
}

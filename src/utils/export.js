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
export function exportToWav(source, chops, pitchSemitones) {
  const rate = 2 ** (pitchSemitones / 12);
  const { sampleRate, numberOfChannels } = source;

  // Pre-leer los datos de cada canal para evitar llamadas repetidas a getChannelData
  const channelData = Array.from(
    { length: numberOfChannels },
    (_, ch) => source.getChannelData(ch),
  );

  const totalFrames = chops.reduce(
    (sum, chop) => sum + Math.max(1, Math.round((chop.end - chop.start) * sampleRate / rate)),
    0,
  );

  const output = Array.from({ length: numberOfChannels }, () => new Float32Array(totalFrames));

  // 5 ms de fade (o la mitad del chop si es muy corto)
  const FADE_SECS = 0.005;

  let cursor = 0;
  chops.forEach((chop) => {
    const fromSample = chop.start * sampleRate;
    const length = Math.max(1, Math.round((chop.end - chop.start) * sampleRate / rate));
    const fade = Math.min(Math.floor(sampleRate * FADE_SECS), Math.floor(length / 2));

    for (let frame = 0; frame < length; frame++) {
      // ── Interpolación lineal (elimina aliasing vs nearest-neighbor) ──────────
      const exactIndex = fromSample + frame * rate;
      const i0 = Math.floor(exactIndex);
      const i1 = Math.min(source.length - 1, i0 + 1);
      const frac = exactIndex - i0;

      // ── Envolvente de fade in/out para evitar clics entre chops ──────────────
      let envelope = 1;
      if (frame < fade) envelope = frame / fade;
      else if (frame >= length - fade) envelope = (length - 1 - frame) / Math.max(1, fade);

      for (let ch = 0; ch < numberOfChannels; ch++) {
        const src = channelData[Math.min(ch, channelData.length - 1)];
        const sample = (src[i0] ?? 0) * (1 - frac) + (src[i1] ?? 0) * frac;
        output[ch][cursor + frame] = sample * envelope;
      }
    }

    cursor += length;
  });

  // ── Escribir cabecera RIFF/WAVE + datos PCM 16-bit ───────────────────────────
  const bytes = new ArrayBuffer(44 + totalFrames * numberOfChannels * 2);
  const view = new DataView(bytes);

  const writeStr = (offset, str) =>
    [...str].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));

  writeStr(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);                                  // tamaño chunk fmt
  view.setUint16(20, 1, true);                                   // PCM
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numberOfChannels * 2, true);   // byte rate
  view.setUint16(32, numberOfChannels * 2, true);                // block align
  view.setUint16(34, 16, true);                                  // bits/sample
  writeStr(36, 'data');
  view.setUint32(40, totalFrames * numberOfChannels * 2, true);

  let offset = 44;
  for (let frame = 0; frame < totalFrames; frame++) {
    for (let ch = 0; ch < numberOfChannels; ch++) {
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

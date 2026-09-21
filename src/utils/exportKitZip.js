/**
 * exportKitZip.js
 * Genera y descarga un archivo .ZIP conteniendo cada Chop como un archivo .WAV independiente.
 * Implementación pura en JavaScript sin dependencias externas (método ZIP Store estándar).
 */

// Tabla CRC32 precalculada
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function computeCRC32(uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < uint8Array.length; i++) {
    crc = CRC_TABLE[(crc ^ uint8Array[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Codifica un chop individual en formato WAV PCM 16-bit
 */
function encodeChopToWav(source, chop, pitchSemitones = 0) {
  const rate = 2 ** (pitchSemitones / 12);
  const { sampleRate, numberOfChannels } = source;

  const channelData = Array.from(
    { length: numberOfChannels },
    (_, ch) => source.getChannelData(ch),
  );

  const startSec = Math.max(0, chop.start !== undefined ? chop.start : 0);
  const endSec = (chop.end !== undefined && chop.end > startSec) ? chop.end : source.duration;
  const totalFrames = Math.max(1, Math.round(((endSec - startSec) * sampleRate) / rate));
  const targetChannels = 2; // Siempre estéreo para evitar sonido en un solo canal/parlante
  const output = Array.from({ length: targetChannels }, () => new Float32Array(totalFrames));

  const FADE_SECS = 0.005;
  const fromSample = startSec * sampleRate;
  const fade = Math.min(Math.floor(sampleRate * FADE_SECS), Math.floor(totalFrames / 2));

  for (let frame = 0; frame < totalFrames; frame++) {
    const exactIndex = fromSample + frame * rate;
    const i0 = Math.floor(exactIndex);
    const i1 = Math.min(source.length - 1, i0 + 1);
    const frac = exactIndex - i0;

    let envelope = 1;
    if (frame < fade) envelope = frame / fade;
    else if (frame >= totalFrames - fade) envelope = (totalFrames - 1 - frame) / Math.max(1, fade);

    for (let ch = 0; ch < targetChannels; ch++) {
      const src = channelData[Math.min(ch, numberOfChannels - 1)];
      const sample = (src[i0] ?? 0) * (1 - frac) + (src[i1] ?? 0) * frac;
      output[ch][frame] = sample * envelope;
    }
  }

  const bytes = new ArrayBuffer(44 + totalFrames * targetChannels * 2);
  const view = new DataView(bytes);

  const writeStr = (offset, str) =>
    [...str].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));

  writeStr(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, targetChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * targetChannels * 2, true);
  view.setUint16(32, targetChannels * 2, true);
  view.setUint16(34, 16, true);
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

  return new Uint8Array(bytes);
}

/**
 * Empaqueta una lista de archivos en un ArrayBuffer ZIP (método STORE)
 * @param {Array<{ name: string, data: Uint8Array }>} files
 */
function buildZip(files) {
  const encoder = new TextEncoder();
  const fileEntries = [];

  let offset = 0;
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = computeCRC32(file.data);
    fileEntries.push({
      file,
      nameBytes,
      crc,
      localHeaderOffset: offset,
    });
    // Tamaño local header = 30 + nombre + data
    offset += 30 + nameBytes.length + file.data.length;
  }

  const centralDirStartOffset = offset;
  let centralDirSize = 0;

  for (const entry of fileEntries) {
    // Central directory header = 46 + nombre
    centralDirSize += 46 + entry.nameBytes.length;
  }

  const eocdSize = 22;
  const totalZipSize = offset + centralDirSize + eocdSize;
  const zipBuffer = new ArrayBuffer(totalZipSize);
  const view = new DataView(zipBuffer);
  const out = new Uint8Array(zipBuffer);

  let cursor = 0;

  // 1. Escribir Local File Headers y datos
  for (const entry of fileEntries) {
    view.setUint32(cursor, 0x04034b50, true); // Local header signature
    view.setUint16(cursor + 4, 10, true);     // Version needed
    view.setUint16(cursor + 6, 0, true);      // Flags
    view.setUint16(cursor + 8, 0, true);      // Compression: 0 (Store)
    view.setUint16(cursor + 10, 0, true);     // Mod time
    view.setUint16(cursor + 12, 0, true);     // Mod date
    view.setUint32(cursor + 14, entry.crc, true); // CRC-32
    view.setUint32(cursor + 18, entry.file.data.length, true); // Comp size
    view.setUint32(cursor + 22, entry.file.data.length, true); // Uncomp size
    view.setUint16(cursor + 26, entry.nameBytes.length, true); // Name len
    view.setUint16(cursor + 28, 0, true);     // Extra field len

    cursor += 30;
    out.set(entry.nameBytes, cursor);
    cursor += entry.nameBytes.length;

    out.set(entry.file.data, cursor);
    cursor += entry.file.data.length;
  }

  // 2. Escribir Central Directory Headers
  for (const entry of fileEntries) {
    view.setUint32(cursor, 0x02014b50, true); // Central directory signature
    view.setUint16(cursor + 4, 20, true);     // Version made by
    view.setUint16(cursor + 6, 10, true);     // Version needed
    view.setUint16(cursor + 8, 0, true);      // Flags
    view.setUint16(cursor + 10, 0, true);     // Compression: 0
    view.setUint16(cursor + 12, 0, true);     // Mod time
    view.setUint16(cursor + 14, 0, true);     // Mod date
    view.setUint32(cursor + 16, entry.crc, true);
    view.setUint32(cursor + 20, entry.file.data.length, true);
    view.setUint32(cursor + 24, entry.file.data.length, true);
    view.setUint16(cursor + 28, entry.nameBytes.length, true);
    view.setUint16(cursor + 30, 0, true);     // Extra field length
    view.setUint16(cursor + 32, 0, true);     // Comment length
    view.setUint16(cursor + 34, 0, true);     // Disk number start
    view.setUint16(cursor + 36, 0, true);     // Internal file attributes
    view.setUint32(cursor + 38, 0, true);     // External file attributes
    view.setUint32(cursor + 42, entry.localHeaderOffset, true); // Local header offset

    cursor += 46;
    out.set(entry.nameBytes, cursor);
    cursor += entry.nameBytes.length;
  }

  // 3. Escribir End of Central Directory Record (EOCD)
  view.setUint32(cursor, 0x06054b50, true); // EOCD signature
  view.setUint16(cursor + 4, 0, true);      // Disk number
  view.setUint16(cursor + 6, 0, true);      // Disk with central dir
  view.setUint16(cursor + 8, fileEntries.length, true);  // Entries this disk
  view.setUint16(cursor + 10, fileEntries.length, true); // Total entries
  view.setUint32(cursor + 12, centralDirSize, true);     // Size of central dir
  view.setUint32(cursor + 16, centralDirStartOffset, true); // Offset of central dir
  view.setUint16(cursor + 20, 0, true);     // Comment length

  return zipBuffer;
}

/**
 * Exporta todos los chops activos como un kit comprimido en archivo .ZIP
 */
export async function exportChopsKitAsZip(source, chops, pitchSemitones = 0, kitName = 'VxChop_Kit') {
  const activeChops = (chops || []).filter(Boolean);
  if (activeChops.length === 0) {
    throw new Error('No hay sample o chops para exportar.');
  }

  const files = activeChops.map((chop, i) => {
    const padNum = String(i + 1).padStart(2, '0');
    const safeName = (chop.name || `Pad_${padNum}`).replace(/[^a-zA-Z0-9_\-]/g, '_');
    const filename = `${padNum}_${safeName}.wav`;
    const targetSource = chop.buffer || source;
    if (!targetSource) {
      throw new Error(`El corte ${chop.name} no cuenta con datos de audio.`);
    }
    const wavBytes = encodeChopToWav(targetSource, chop, pitchSemitones);
    return { name: filename, data: wavBytes };
  });

  const zipBytes = buildZip(files);
  const blob = new Blob([zipBytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${kitName}.zip`;
  link.click();
  URL.revokeObjectURL(url);
}

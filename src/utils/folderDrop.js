/**
 * folderDrop.js
 * Utilidad para leer carpetas completas y múltiples archivos de audio mediante Drag and Drop
 * y combinarlos automáticamente en un kit de pads MPC.
 */

export async function extractAudioFilesFromDataTransfer(dataTransfer) {
  const items = dataTransfer.items;
  const files = [];

  const readEntry = async (entry) => {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      if (file && (file.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|m4a|aac)$/i.test(file.name))) {
        files.push(file);
      }
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const readBatch = () =>
        new Promise((resolve, reject) => {
          dirReader.readEntries(resolve, reject);
        });

      let entries = await readBatch();
      while (entries.length > 0) {
        for (const child of entries) {
          await readEntry(child);
        }
        entries = await readBatch();
      }
    }
  };

  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.webkitGetAsEntry) {
        const entry = item.webkitGetAsEntry();
        if (entry) await readEntry(entry);
      } else {
        const f = item.getAsFile();
        if (f && (f.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|m4a|aac)$/i.test(f.name))) {
          files.push(f);
        }
      }
    }
  } else if (dataTransfer.files) {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      const f = dataTransfer.files[i];
      if (f.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|m4a|aac)$/i.test(f.name)) {
        files.push(f);
      }
    }
  }

  // Ordenar alfabéticamente para preservar el orden numérico típico de drum kits (01_kick, 02_snare, etc.)
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  return files;
}

export async function combineAudioFilesIntoKit(audioContext, files, maxSamples = 64) {
  const selectedFiles = files.slice(0, maxSamples);
  const decodedBuffers = [];
  const names = [];

  for (const file of selectedFiles) {
    try {
      const arrayBuf = await file.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(arrayBuf);
      decodedBuffers.push(decoded);
      names.push(file.name.replace(/\.[^/.]+$/, ''));
    } catch (err) {
      console.warn(`Error al decodificar ${file.name}:`, err);
    }
  }

  if (decodedBuffers.length === 0) return null;

  const sampleRate = decodedBuffers[0].sampleRate;
  const numChannels = 2;
  const silencePadSecs = 0.04;
  const silenceFrames = Math.floor(sampleRate * silencePadSecs);

  let totalFrames = 0;
  for (const buf of decodedBuffers) {
    totalFrames += buf.length + silenceFrames;
  }

  const combined = audioContext.createBuffer(numChannels, totalFrames, sampleRate);
  const leftOut = combined.getChannelData(0);
  const rightOut = combined.getChannelData(1);

  const chops = [];
  const COLORS = [
    '#b8f05a', '#55d6be', '#ff7a66', '#52a8ff',
    '#f7c95f', '#78e8d0', '#ff9f43', '#e66b8c',
    '#a29bfe', '#fd79a8', '#00cec9', '#fdcb6e',
    '#6c5ce7', '#e17055', '#74b9ff', '#81ecec',
  ];

  let currentFrame = 0;
  for (let i = 0; i < decodedBuffers.length; i++) {
    const buf = decodedBuffers[i];
    const srcL = buf.getChannelData(0);
    const srcR = buf.numberOfChannels > 1 ? buf.getChannelData(1) : srcL;

    const startSec = currentFrame / sampleRate;
    const endSec = (currentFrame + buf.length) / sampleRate;

    leftOut.set(srcL, currentFrame);
    rightOut.set(srcR, currentFrame);

    chops.push({
      id: crypto.randomUUID(),
      name: names[i] || `Sample ${i + 1}`,
      start: Number(startSec.toFixed(4)),
      end: Number(endSec.toFixed(4)),
      color: COLORS[i % COLORS.length],
    });

    currentFrame += buf.length + silenceFrames;
  }

  return { buffer: combined, chops };
}

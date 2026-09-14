import {
  playKick,
  playSnare,
  playHiHat,
  playBass,
  playCustomSample,
} from './drumSynth.js';

/**
 * Convierte un AudioBuffer de Web Audio en un Blob de archivo WAV PCM 16-bit.
 */
function audioBufferToWavBlob(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // Cabecera RIFF / WAVE
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  // Sub-chunk 'fmt '
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);            // Chunk size
  view.setUint16(20, 1, true);             // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);            // Bits per sample

  // Sub-chunk 'data'
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Escribir muestras intercaladas (Interleaved PCM 16-bit)
  const channelData = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch));
  }

  // Buscar pico máximo de la señal estéreo para normalizar
  let maxPeak = 0;
  for (let ch = 0; ch < numChannels; ch++) {
    const data = channelData[ch];
    for (let i = 0; i < numFrames; i++) {
      const abs = Math.abs(data[i]);
      if (abs > maxPeak) maxPeak = abs;
    }
  }

  // Factor de normalización inteligente:
  // Si superó 1.0 (clipping), atenúa a 0.96 (-0.3dB).
  // Si quedó bajo (ej. 0.4), lo amplifica hasta 0.96 sin sobrepasar.
  const targetPeak = 0.965; // ~ -0.3 dBFS True Peak
  const normGain = maxPeak > 0.01 ? Math.min(2.5, targetPeak / maxPeak) : 1.0;

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = channelData[ch][i] * normGain;
      // Clamping de seguridad -1.0 a 1.0
      sample = Math.max(-1, Math.min(1, sample));
      // Escalar a 16-bit signed integer (-32768 a 32767)
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Renderiza y descarga el beat completo del secuenciador en un archivo WAV estéreo.
 */
export async function exportFullBeatToWav({
  tracks = [],
  chops = [],
  mainBuffer = null,
  pitchSemitones = 0,
  bpm = 90,
  stepCount = 16,
  swing = 50,
  repeatBars = 4,
  applyMastering = true,
}) {
  const sampleRate = 44100;
  const stepDuration = (60 / (bpm || 90)) / 4;
  const loopDuration = stepDuration * stepCount;
  const musicDuration = loopDuration * repeatBars;
  const tailDuration = 1.5; // Cola de decay / release
  const totalSeconds = musicDuration + tailDuration;

  const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
    2,
    Math.max(1, Math.round(totalSeconds * sampleRate)),
    sampleRate,
  );

  let masterIn;
  if (applyMastering) {
    const comp = offlineCtx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-14, 0); // -14 dB
    comp.knee.setValueAtTime(6, 0);
    comp.ratio.setValueAtTime(3.5, 0); // Compresión musical MPC
    comp.attack.setValueAtTime(0.003, 0); // 3ms rápido
    comp.release.setValueAtTime(0.15, 0); // 150ms release
    comp.connect(offlineCtx.destination);
    masterIn = comp;
  } else {
    masterIn = offlineCtx.destination;
  }

  const masterGain = offlineCtx.createGain();
  masterGain.gain.setValueAtTime(0.95, 0);

  // Fade-out suave al final de la música en los últimos compases
  const fadeOutStart = Math.max(0, musicDuration - 0.8);
  masterGain.gain.setValueAtTime(0.95, fadeOutStart);
  masterGain.gain.linearRampToValueAtTime(0, musicDuration + tailDuration * 0.9);
  masterGain.connect(masterIn);

  const hasSolo = tracks.some((t) => t.solo);
  const rate = 2 ** (pitchSemitones / 12);

  // Renderizar cada vuelta del loop
  for (let bar = 0; bar < repeatBars; bar++) {
    const barStartTime = bar * loopDuration;

    for (let stepIdx = 0; stepIdx < stepCount; stepIdx++) {
      const swingOffset = (stepIdx % 2 === 1) ? ((swing - 50) / 100) * (stepDuration * 0.66) : 0;
      const stepTime = barStartTime + (stepIdx * stepDuration) + swingOffset;

      tracks.forEach((track) => {
        if (track.muted) return;
        if (hasSolo && !track.solo) return;

        const stepData = track.steps[stepIdx];
        if (!stepData || !stepData.active) return;

        const vel = stepData.velocity || 1.0;
        const note = stepData.note || 0;

        const trackGain = offlineCtx.createGain();
        trackGain.gain.setValueAtTime(track.volume ?? 1.0, stepTime);
        trackGain.connect(masterGain);

        // Si tiene sample personalizado
        if (track.customBuffer) {
          playCustomSample(offlineCtx, trackGain, track.customBuffer, stepTime, vel, note);
          return;
        }

        switch (track.type) {
          case 'kick':
            playKick(offlineCtx, trackGain, stepTime, vel);
            break;
          case 'snare':
            playSnare(offlineCtx, trackGain, stepTime, vel);
            break;
          case 'hihat':
            playHiHat(offlineCtx, trackGain, stepTime, vel, false);
            break;
          case 'bass':
            playBass(offlineCtx, trackGain, stepTime, vel, note);
            break;
          case 'chop': {
            if (mainBuffer && chops.length > 0) {
              const chopIdx = (stepData.chopIndex || 0) % chops.length;
              const chop = chops[chopIdx];
              if (chop) {
                const chopDuration = chop.end - chop.start;
                const source = offlineCtx.createBufferSource();
                source.buffer = mainBuffer;
                source.playbackRate.setValueAtTime(rate, stepTime);

                // Calcular si hay un corte posterior para cortar este sample (Choke)
                let nextChopTime = null;
                for (let fStep = stepIdx + 1; fStep < stepCount; fStep++) {
                  if (track.steps[fStep]?.active) {
                    const fSwing = (fStep % 2 === 1) ? ((swing - 50) / 100) * (stepDuration * 0.66) : 0;
                    nextChopTime = barStartTime + (fStep * stepDuration) + fSwing;
                    break;
                  }
                }
                if (!nextChopTime && bar < repeatBars - 1) {
                  for (let fStep = 0; fStep < stepCount; fStep++) {
                    if (track.steps[fStep]?.active) {
                      const fSwing = (fStep % 2 === 1) ? ((swing - 50) / 100) * (stepDuration * 0.66) : 0;
                      nextChopTime = (bar + 1) * loopDuration + (fStep * stepDuration) + fSwing;
                      break;
                    }
                  }
                }

                const maxPlayTime = nextChopTime ? Math.max(0.015, nextChopTime - stepTime) : (chopDuration / rate);
                const playDur = Math.min(chopDuration / rate, maxPlayTime);

                const chopGain = offlineCtx.createGain();
                const fadeSecs = Math.min(0.004, playDur * 0.1);

                chopGain.gain.setValueAtTime(0, stepTime);
                chopGain.gain.linearRampToValueAtTime(vel, stepTime + fadeSecs);
                chopGain.gain.setValueAtTime(vel, stepTime + playDur - fadeSecs);
                chopGain.gain.linearRampToValueAtTime(0, stepTime + playDur);

                source.connect(chopGain);
                chopGain.connect(trackGain);
                source.start(stepTime, chop.start, playDur * rate);
                source.stop(stepTime + playDur + 0.005);
              }
            }
            break;
          }
          default:
            break;
        }
      });
    }
  }

  // Renderizado Offline acelerado por hardware
  const renderedBuffer = await offlineCtx.startRendering();

  // Codificar y descargar
  const wavBlob = audioBufferToWavBlob(renderedBuffer);
  const downloadUrl = URL.createObjectURL(wavBlob);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = `VX-CHOP_Beat_${bpm}BPM_${repeatBars}Bars.wav`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  setTimeout(() => URL.revokeObjectURL(downloadUrl), 4000);
  return true;
}

import { useEffect, useRef, useState } from 'react';

const COLORS = ['#b8f05a', '#55d6be', '#ff7a66', '#52a8ff', '#f7c95f', '#78e8d0', '#ff9f43', '#e66b8c'];
const PAD_KEYS = ['1', '2', '3', '4', 'q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v'];
const MIN_CUT = 0.03;

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return '0:00.00';
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const detectPitch = (audioBuffer, chop) => {
  if (!audioBuffer) return null;
  const sampleRate = audioBuffer.sampleRate;
  const start = chop ? Math.floor(chop.start * sampleRate) : 0;
  const end = chop ? Math.min(audioBuffer.length, Math.ceil(chop.end * sampleRate)) : audioBuffer.length;
  const source = audioBuffer.getChannelData(0);
  const maxSamples = Math.min(end - start, Math.floor(sampleRate * 1.5));
  const step = Math.max(1, Math.floor((end - start) / maxSamples));
  const samples = new Float32Array(Math.floor((end - start) / step));
  for (let index = 0; index < samples.length; index += 1) samples[index] = source[start + index * step];
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  let energy = 0;
  for (let index = 0; index < samples.length; index += 1) { samples[index] -= mean; energy += samples[index] ** 2; }
  if (!energy || energy / samples.length < 0.00001) return null;
  const minLag = Math.max(2, Math.floor(sampleRate / step / 1000));
  const maxLag = Math.min(samples.length - 2, Math.floor(sampleRate / step / 50));
  let bestLag = 0;
  let bestCorrelation = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    for (let index = 0; index < samples.length - lag; index += 1) correlation += samples[index] * samples[index + lag];
    correlation /= energy;
    if (correlation > bestCorrelation) { bestCorrelation = correlation; bestLag = lag; }
  }
  if (!bestLag || bestCorrelation < 0.12) return null;
  const frequency = sampleRate / (step * bestLag);
  const midi = 69 + 12 * Math.log2(frequency / 440);
  const nearestMidi = Math.round(midi);
  return { frequency, note: `${NOTE_NAMES[(nearestMidi + 120) % 12]}${Math.floor(nearestMidi / 12) - 1}`, cents: Math.round((midi - nearestMidi) * 100) };
};

function NoteDetector({ buffer, result, onDetect }) {
  return <section className="panel note-panel"><div><h2>Detector de notas</h2><p className="note-help">Analiza el chop seleccionado o todo el sample.</p></div><button className="btn primary" disabled={!buffer} onClick={onDetect}>Detectar nota</button>{result ? <div className="note-result"><strong>{result.note}</strong><span>{result.frequency.toFixed(2)} Hz</span><span className={Math.abs(result.cents) <= 5 ? 'in-tune' : ''}>{result.cents > 0 ? '+' : ''}{result.cents} cents</span></div> : <div className="note-empty">Sin análisis todavía</div>}</section>;
}

function App() {
  const canvasRef = useRef(null);
  const audioContextRef = useRef(null);
  const bufferRef = useRef(null);
  const activeSourceRef = useRef(null);
  const playbackTimersRef = useRef([]);
  const dragRef = useRef(null);
  const [fileInfo, setFileInfo] = useState('Sin sample cargado');
  const [status, setStatus] = useState('Listo.');
  const [warning, setWarning] = useState('');
  const [buffer, setBuffer] = useState(null);
  const [chops, setChops] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [pitch, setPitch] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [viewStart, setViewStart] = useState(0);
  const [noteResult, setNoteResult] = useState(null);

  const getAudioContext = () => {
    if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume();
    return audioContextRef.current;
  };

  const stopAll = () => {
    if (activeSourceRef.current) {
      try { activeSourceRef.current.stop(); } catch {}
      activeSourceRef.current = null;
    }
    playbackTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    playbackTimersRef.current = [];
  };

  const loadFile = async (file) => {
    try {
      setStatus('Decodificando audio...');
      const context = getAudioContext();
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      bufferRef.current = decoded;
      setBuffer(decoded);
      setChops([]);
      setSelectedId(null);
      setZoom(1);
      setViewStart(0);
      setNoteResult(null);
      stopAll();
      setFileInfo(`${file.name} · ${formatTime(decoded.duration)} · ${decoded.sampleRate} Hz · ${decoded.numberOfChannels}ch`);
      setWarning(decoded.duration > 600 ? 'Sample largo: la vista se simplifica para mantener fluidez.' : '');
      setStatus('Sample cargado. Arrastra sobre el waveform para crear un corte.');
    } catch (error) {
      console.error(error);
      setStatus('Error al leer el archivo.');
      setWarning('Formato no soportado o archivo dañado.');
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      drawWaveform();
    };
    window.addEventListener('resize', resize);
    resize();
    return () => window.removeEventListener('resize', resize);
  });

  useEffect(() => {
    drawWaveform();
  }, [buffer, chops, selectedId, zoom, viewStart]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.repeat || ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      const index = PAD_KEYS.indexOf(event.key.toLowerCase());
      if (index < 0 || !chops[index]) return;
      event.preventDefault();
      playChop(chops[index]);
      setSelectedId(chops[index].id);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [chops, pitch]);

  const drawWaveform = () => {
    const canvas = canvasRef.current;
    const currentBuffer = bufferRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.width / ratio;
    const height = canvas.height / ratio;
    const context = canvas.getContext('2d');
    if (!context || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = '#0c1210';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(124,247,201,.16)';
    context.beginPath(); context.moveTo(0, height / 2); context.lineTo(width, height / 2); context.stroke();
    if (!currentBuffer) {
      context.fillStyle = '#3a4a44'; context.font = '12px monospace'; context.fillText('- sin señal -', width / 2 - 36, height / 2 + 4); return;
    }
    const visible = currentBuffer.duration / zoom;
    if (!Number.isFinite(visible) || visible <= 0) return;
    const visibleStart = Math.min(viewStart, Math.max(0, currentBuffer.duration - visible));
    const data = currentBuffer.getChannelData(0);
    const start = Math.floor((visibleStart / currentBuffer.duration) * data.length);
    const step = Math.max(1, Math.floor((data.length * visible / currentBuffer.duration) / width));
    const timeToX = (time) => ((time - visibleStart) / visible) * width;
    chops.forEach((chop) => {
      const x = timeToX(chop.start);
      const chopWidth = (chop.end - chop.start) / visible * width;
      context.fillStyle = `${chop.color}35`; context.fillRect(x, 0, chopWidth, height);
      context.strokeStyle = chop.color; context.lineWidth = chop.id === selectedId ? 2 : 1; context.strokeRect(x, 1, Math.max(1, chopWidth), height - 2);
      if (chop.id === selectedId) {
        context.fillStyle = '#ffffff';
        context.fillRect(x - 2, 0, 4, height);
        context.fillRect(x + chopWidth - 2, 0, 4, height);
      }
    });
    if (dragRef.current?.mode === 'create') {
      const previewStart = Math.min(dragRef.current.start, dragRef.current.current);
      const previewWidth = Math.abs(dragRef.current.current - dragRef.current.start) / visible * width;
      context.fillStyle = 'rgba(184,240,90,.18)'; context.fillRect(timeToX(previewStart), 0, previewWidth, height);
      context.strokeStyle = '#b8f05a'; context.setLineDash([5, 4]); context.strokeRect(timeToX(previewStart), 1, Math.max(1, previewWidth), height - 2); context.setLineDash([]);
    }
    context.strokeStyle = '#7cf7c9'; context.beginPath();
    for (let x = 0; x < width; x += 1) {
      const index = Math.min(data.length - 1, start + Math.floor(x * step));
      let min = 1; let max = -1;
      for (let j = index; j < Math.min(data.length, index + step); j += 1) { min = Math.min(min, data[j]); max = Math.max(max, data[j]); }
      context.moveTo(x, height / 2 + min * height * .46); context.lineTo(x, height / 2 + max * height * .46);
    }
    context.stroke();
  };

  const canvasTime = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const visible = bufferRef.current?.duration / zoom || 0;
    if (!rect.width || !Number.isFinite(visible) || visible <= 0) return 0;
    return Math.max(0, Math.min(bufferRef.current?.duration || 0, viewStart + ((event.clientX - rect.left) / rect.width) * visible));
  };

  const findChopAtTime = (time) => chops.find((chop) => time >= chop.start && time <= chop.end);
  const findEdge = (time) => {
    const tolerance = (bufferRef.current?.duration / zoom || 0) * 10 / (canvasRef.current?.getBoundingClientRect().width || 1);
    return chops.find((chop) => Math.abs(time - chop.start) <= tolerance || Math.abs(time - chop.end) <= tolerance);
  };

  const handlePointerDown = (event) => {
    if (!bufferRef.current) return;
    const time = canvasTime(event);
    const edgeChop = findEdge(time);
    if (edgeChop) {
      setSelectedId(edgeChop.id);
      dragRef.current = { mode: Math.abs(time - edgeChop.start) <= Math.abs(time - edgeChop.end) ? 'resize-start' : 'resize-end', chopId: edgeChop.id, start: time, current: time };
    } else if (findChopAtTime(time)) {
      setSelectedId(findChopAtTime(time).id);
      dragRef.current = null;
    } else {
      dragRef.current = { mode: 'create', start: time, current: time };
    }
    canvasRef.current.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event) => {
    if (!dragRef.current) return;
    const time = canvasTime(event);
    dragRef.current.current = time;
    if (dragRef.current.mode === 'create') drawWaveform();
    else setChops((current) => current.map((chop) => {
      if (chop.id !== dragRef.current.chopId) return chop;
      if (dragRef.current.mode === 'resize-start') return { ...chop, start: Math.max(0, Math.min(time, chop.end - MIN_CUT)) };
      return { ...chop, end: Math.min(bufferRef.current.duration, Math.max(time, chop.start + MIN_CUT)) };
    }));
  };

  const handlePointerUp = () => {
    if (!dragRef.current || !bufferRef.current) return;
    if (dragRef.current.mode !== 'create') { dragRef.current = null; return; }
    const start = Math.max(0, Math.min(dragRef.current.start, dragRef.current.current));
    const end = Math.min(bufferRef.current.duration, Math.max(dragRef.current.start, dragRef.current.current));
    if (end - start >= MIN_CUT) {
      const chop = { id: crypto.randomUUID(), name: `Corte ${chops.length + 1}`, start, end, color: COLORS[chops.length % COLORS.length] };
      setChops((current) => [...current, chop]); setSelectedId(chop.id); setStatus(`"${chop.name}" creado (${formatTime(start)} -> ${formatTime(end)}).`);
    }
    dragRef.current = null;
  };

  const playChop = (chop, { cancelSequence = true } = {}) => {
    if (!bufferRef.current) return;
    if (cancelSequence) stopAll();
    const context = getAudioContext(); const source = context.createBufferSource();
    source.buffer = bufferRef.current; source.playbackRate.value = 2 ** (pitch / 12); source.connect(context.destination);
    source.start(0, chop.start, chop.end - chop.start); activeSourceRef.current = source;
    source.onended = () => { if (activeSourceRef.current === source) activeSourceRef.current = null; };
    setStatus(`Reproduciendo "${chop.name}"...`);
  };

  const playAll = () => {
    stopAll();
    let delay = 0;
    chops.forEach((chop) => {
      const timer = window.setTimeout(() => playChop(chop, { cancelSequence: false }), delay);
      playbackTimersRef.current.push(timer);
      delay += ((chop.end - chop.start) / (2 ** (pitch / 12))) * 1000;
    });
  };

  const removeChop = (id) => { setChops((current) => current.filter((chop) => chop.id !== id)); if (selectedId === id) setSelectedId(null); };
  const renameChop = (id, name) => setChops((current) => current.map((chop) => chop.id === id ? { ...chop, name } : chop));
  const exportMix = () => {
    if (!bufferRef.current || !chops.length) return;
    const source = bufferRef.current;
    const rate = 2 ** (pitch / 12);
    const totalFrames = chops.reduce((sum, chop) => sum + Math.max(1, Math.round((chop.end - chop.start) * source.sampleRate / rate)), 0);
    const channels = Array.from({ length: source.numberOfChannels }, () => new Float32Array(totalFrames));
    let cursor = 0;
    chops.forEach((chop) => {
      const from = Math.round(chop.start * source.sampleRate);
      const length = Math.max(1, Math.round((chop.end - chop.start) * source.sampleRate / rate));
      for (let frame = 0; frame < length; frame += 1) {
        const sourceFrame = Math.min(source.length - 1, from + Math.floor(frame * rate));
        channels.forEach((channel, index) => { channel[cursor + frame] = source.getChannelData(Math.min(index, source.numberOfChannels - 1))[sourceFrame]; });
      }
      cursor += length;
    });
    const bytes = new ArrayBuffer(44 + totalFrames * source.numberOfChannels * 2);
    const view = new DataView(bytes);
    const write = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    write(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, source.numberOfChannels, true); view.setUint32(24, source.sampleRate, true); view.setUint32(28, source.sampleRate * source.numberOfChannels * 2, true); view.setUint16(32, source.numberOfChannels * 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, totalFrames * source.numberOfChannels * 2, true);
    let offset = 44;
    for (let frame = 0; frame < totalFrames; frame += 1) channels.forEach((channel) => { const sample = Math.max(-1, Math.min(1, channel[frame])); view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); offset += 2; });
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })); link.download = 'vxchop-export.wav'; link.click(); URL.revokeObjectURL(link.href); setStatus('WAV exportado correctamente.');
  };

  const zoomToChop = (chop) => {
    if (!bufferRef.current || !chop) return;
    const padding = Math.max(0.08, (chop.end - chop.start) * 0.35);
    const targetDuration = Math.min(bufferRef.current.duration, Math.max(chop.end - chop.start + padding * 2, bufferRef.current.duration / 8));
    const nextZoom = Math.min(20, bufferRef.current.duration / targetDuration);
    setZoom(nextZoom);
    setViewStart(Math.max(0, Math.min(bufferRef.current.duration - bufferRef.current.duration / nextZoom, chop.start - (targetDuration - (chop.end - chop.start)) / 2)));
    setSelectedId(chop.id);
    setStatus(`Vista enfocada en "${chop.name}".`);
  };

  const resetZoom = () => { setZoom(1); setViewStart(0); };

  const detectSelectedNote = () => {
    const selectedChop = chops.find((chop) => chop.id === selectedId);
    const result = detectPitch(bufferRef.current, selectedChop);
    setNoteResult(result);
    setStatus(result ? `Nota detectada: ${result.note}.` : 'No se pudo detectar una nota estable.');
  };

  return <main className="rack"><NoteDetector buffer={buffer} result={noteResult} onDetect={detectSelectedNote} /><section className="zoom-selected"><span>{selectedId ? `Seleccionado: ${chops.find((chop) => chop.id === selectedId)?.name || 'chop'}` : 'Selecciona un chop para editarlo'}</span><button className="btn small" disabled={!selectedId} onClick={() => zoomToChop(chops.find((chop) => chop.id === selectedId))}>Zoom al corte</button></section>
    <header className="faceplate"><div className="brand"><h1><span className={`led ${buffer ? 'on' : ''}`} />VX-CHOP</h1><span>SAMPLE SLICER / PITCH ENGINE · REACT</span></div><span className="file-info">{fileInfo}</span></header>
    <label className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files[0]) loadFile(event.dataTransfer.files[0]); }}>
      <p><strong>Arrastra un archivo de audio aquí</strong> (WAV, MP3, OGG)</p><p>o haz clic para seleccionar un archivo</p><input type="file" accept="audio/*" onChange={(event) => event.target.files[0] && loadFile(event.target.files[0])} />
    </label>
    <section className="main-grid"><div className="panel"><h2><span className={`led ${buffer ? 'on' : ''}`} />Waveform</h2><div className="zoom-controls"><button className="btn small icon" onClick={() => setZoom((value) => Math.max(1, value / 1.5))}>-</button><span>{Math.round(zoom * 100)}%</span><button className="btn small icon" onClick={() => setZoom((value) => Math.min(20, value * 1.5))}>+</button><button className="btn small" onClick={() => setZoom(1)}>Reset</button></div><div className="screen-wrap"><canvas ref={canvasRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} /></div><p className="screen-hint">Clic y arrastra para crear cortes. Los pads responden a <kbd>1234 / qwer / asdf / zxcv</kbd>.</p><div className="transport"><button className="btn" disabled={!chops.length} onClick={playAll}>▶ Reproducir todo</button><button className="btn" disabled={!buffer} onClick={() => { stopAll(); setStatus('Detenido.'); }}>■ Stop</button><button className="btn primary" disabled={!chops.length} onClick={exportMix}>⇩ Exportar WAV</button><div className="pitch-block"><label>Pitch estilo vinilo</label><div className="pitch-row"><input type="range" min="-12" max="12" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} /><span className="pitch-value">{pitch > 0 ? '+' : ''}{pitch} st</span></div></div></div></div>
      <div className="panel"><h2>Chops <span className="count">{chops.length ? `(${chops.length})` : ''}</span></h2>{chops.length ? <ul className="chop-list">{chops.map((chop, index) => <li className={`chop-item ${selectedId === chop.id ? 'selected' : ''}`} key={chop.id} onClick={() => setSelectedId(chop.id)}><span className="chop-index">{index + 1}</span><span className="chop-swatch" style={{ background: chop.color }} /><input className="chop-name" value={chop.name} onChange={(event) => renameChop(chop.id, event.target.value)} onClick={(event) => event.stopPropagation()} /><span className="chop-time">{formatTime(chop.end - chop.start)}</span><span className="chop-actions"><button className="btn small icon" onClick={(event) => { event.stopPropagation(); playChop(chop); }}>▶</button><button className="btn small icon danger" onClick={(event) => { event.stopPropagation(); removeChop(chop.id); }}>x</button></span></li>)}</ul> : <div className="empty-hint">Todavía no hay chops.<br />Carga un sample y dibuja una selección.</div>}</div></section>
    <section className="panel pad-panel"><h2>Pads <span className="subheading">Dispara chops con clic o teclado</span></h2>{chops.length ? <div className="pad-grid">{chops.map((chop, index) => <button className={`pad ${selectedId === chop.id ? 'selected' : ''}`} style={{ '--pad-color': chop.color }} key={chop.id} onClick={() => { setSelectedId(chop.id); playChop(chop); }}><span className="pad-key">{(PAD_KEYS[index] || index + 1).toUpperCase()}</span><span className="pad-name">{chop.name}</span></button>)}</div> : <div className="empty-hint">Los pads se llenan automáticamente con los cortes.</div>}</section>
    <footer className="status"><span>{status}</span><span className="warn">{warning}</span></footer>
  </main>;
}

export default App;
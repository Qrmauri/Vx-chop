import React, { useState, useRef } from 'react';

const PAD_KEYS = ['1', '2', '3', '4', 'Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V'];
const BANKS = ['A', 'B', 'C', 'D'];

const SIXTEEN_LEVELS_OFFSETS = [
  { st: -8, note: 'E' },
  { st: -7, note: 'F' },
  { st: -6, note: 'F#' },
  { st: -5, note: 'G' },
  { st: -4, note: 'G#' },
  { st: -3, note: 'A' },
  { st: -2, note: 'A#' },
  { st: -1, note: 'B' },
  { st: 0,  note: 'C (Root)' },
  { st: 1,  note: 'C#' },
  { st: 2,  note: 'D' },
  { st: 3,  note: 'D#' },
  { st: 4,  note: 'E' },
  { st: 5,  note: 'F' },
  { st: 6,  note: 'F#' },
  { st: 7,  note: 'G' },
];

const MPC_ROW_COLORS = [
  '#ff3b30', // Fila 1: Bombo / Kick
  '#ff9500', // Fila 2: Caja / Snare
  '#00e5ff', // Fila 3: Hi-Hats
  '#af52de', // Fila 4: Chops
];

export default function PadMatrix({
  fullLevel,
  setFullLevel,
  sixteenLevels,
  setSixteenLevels,
  padMuteMode,
  setPadMuteMode,
  mutedPads,
  showQLink,
  setShowQLink,
  bank,
  setBank,
  playMode,
  setPlayMode,
  chops,
  bankChops,
  bankOffset,
  selectedId,
  setSelectedId,
  selectedChop,
  playingId,
  formatTimeMs,
  hitPad,
  tapChopAtCurrentTime,
  isLiveChopMode,
  isContinuousPlaying,
  hasAudioBuffer,
  playAll,
  stopAll,
  autoSlice16,
  onBatchDrop,
  onFilesSelected,
  fileInfo,
  autoSliceEnabled = false,
  setAutoSliceEnabled,
  onAssignPad,
  selectedPadIndex = 0,
  setSelectedPadIndex,
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const padFileInputRef = useRef(null);
  const [targetPadIndex, setTargetPadIndex] = useState(0);

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      if (onFilesSelected) {
        onFilesSelected(e.target.files);
      }
      e.target.value = '';
    }
  };

  const handlePadFileInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      if (onAssignPad) {
        onAssignPad(e.target.files, targetPadIndex);
      }
      e.target.value = '';
    }
  };
  return (
    <>
      {/* Barra de Funciones Hardware MPC ONE+ */}
      <div className="mpc-hardware-bar">
        <button
          className={`mpc-hw-btn ${fullLevel ? 'active-red' : ''}`}
          onClick={() => setFullLevel((v) => !v)}
          title="FULL LEVEL: Fija la fuerza de todos los golpes al 100% (127)"
        >
          <span className="hw-led" />
          FULL LEVEL
        </button>
        <button
          className={`mpc-hw-btn ${sixteenLevels ? 'active-amber' : ''}`}
          onClick={() => setSixteenLevels((v) => !v)}
          title="16 LEVELS: Distribuye el sample seleccionado en 16 afinaciones cromáticas (-8 a +7 semitonos)"
        >
          <span className="hw-led" />
          16 LEVELS
        </button>
        <button
          className={`mpc-hw-btn ${padMuteMode ? 'active-purple' : ''}`}
          onClick={() => setPadMuteMode((v) => !v)}
          title="PAD MUTE: Modo en vivo para silenciar o reactivar pads tocándolos"
        >
          <span className="hw-led" />
          PAD MUTE {mutedPads.size > 0 ? `(${mutedPads.size})` : ''}
        </button>
        <button
          className={`mpc-hw-btn qlink-toggle ${showQLink ? 'active-cyan' : ''}`}
          onClick={() => setShowQLink((v) => !v)}
          title="Q-LINK: Muestra u oculta las perillas maestras de Filtro, Reso, Pitch, Decay y Drive"
        >
          <span className="hw-led" />
          Q-LINK
        </button>
      </div>

      {/* Barra de Bancos y Voicing */}
      <div className="bank-bar">
        <span className="bank-label">Banco</span>
        <div className="bank-btns">
          {BANKS.map((b) => (
            <button
              key={b}
              className={`bank-btn ${bank === b ? 'active' : ''}`}
              onClick={() => setBank(b)}
            >
              {b}
            </button>
          ))}
        </div>

        {/* Selector de Voicing: Mono (Choke) vs Poly */}
        <div className="voice-mode-selector">
          <span className="voice-mode-label">MODO:</span>
          <button
            className={`voice-mode-pill ${playMode === 'mono' ? 'active-mono' : ''}`}
            onClick={() => setPlayMode('mono')}
            title="Mono (Choke): Corta el sonido anterior al pulsar un nuevo pad"
          >
            <span className="pill-dot" />
            MONO
          </button>
          <button
            className={`voice-mode-pill ${playMode === 'poly' ? 'active-poly' : ''}`}
            onClick={() => setPlayMode('poly')}
            title="Poly: Sonidos superpuestos simultáneos (acordes, polifonía)"
          >
            <span className="pill-dot" />
            POLY
          </button>
        </div>

        <span className="bank-chop-count">
          {bankChops.filter(Boolean).length} / 16 cortes asignados
        </span>
      </div>

      {/* Quick Bar para Celulares */}
      <div className="mobile-quick-bar">
        <button
          type="button"
          className="mpc-btn small upload-quick-btn"
          onClick={() => {
            setTargetPadIndex(0);
            padFileInputRef.current?.click();
          }}
          title="Subir archivo de audio o samples desde el celular"
        >
          📁 Subir
        </button>
        <button
          className="mpc-btn small"
          disabled={!chops.filter(Boolean).length}
          onClick={() => playAll(chops.filter(Boolean))}
        >
          ▶ Play All
        </button>
        <button
          className="mpc-btn small"
          disabled={!hasAudioBuffer && !chops.filter(Boolean).length}
          onClick={stopAll}
        >
          ■ Stop
        </button>
        <button
          className={`mpc-btn small ${playMode === 'poly' ? 'poly-active' : 'accent'}`}
          onClick={() => setPlayMode((m) => (m === 'mono' ? 'poly' : 'mono'))}
          title="Alternar modo Mono o Poly"
        >
          {playMode === 'mono' ? '● Mono' : '★ Poly'}
        </button>
        <button
          type="button"
          className={`mpc-btn small ${autoSliceEnabled ? 'active-green' : ''}`}
          onClick={() => setAutoSliceEnabled?.((v) => !v)}
          title="Activar o desactivar Auto-Slice automático"
        >
          ⚡ Auto-Slice: {autoSliceEnabled ? 'ON' : 'OFF'}
        </button>
        <button
          className="mpc-btn small auto-slice"
          disabled={!hasAudioBuffer}
          onClick={autoSlice16}
          title="Cortar el audio en 16 rebanadas iguales"
          style={{ marginLeft: 'auto' }}
        >
          ✂ Cortar 16
        </button>
      </div>

      {/* Input general para subidas de lote */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.aif,.aiff"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {/* Input de archivo invisible para asignar sonidos a pads individuales */}
      <input
        ref={padFileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.aif,.aiff"
        multiple
        style={{ display: 'none' }}
        onChange={handlePadFileInputChange}
      />

      {/* Banner destacado para subir audio desde celular cuando no hay sample */}
      {!hasAudioBuffer && chops.filter(Boolean).length === 0 ? (
        <div
          className="mobile-upload-banner"
          onClick={() => {
            setTargetPadIndex(0);
            padFileInputRef.current?.click();
          }}
          role="button"
          tabIndex={0}
        >
          <div className="upload-banner-content">
            <span className="upload-banner-icon">📁</span>
            <div className="upload-banner-info">
              <span className="upload-banner-title">Subir audio o sonidos</span>
              <span className="upload-banner-sub">
                {autoSliceEnabled
                  ? 'Auto-Slice ON: Divide el tema en 16 cortes'
                  : 'Auto-Slice OFF: Cada pad acepta su propio sonido'}
              </span>
            </div>
          </div>
          <button type="button" className="upload-banner-btn" tabIndex={-1}>
            Elegir audio
          </button>
        </div>
      ) : (
        <div className="mobile-loaded-bar">
          <span className="loaded-sample-name" title={fileInfo}>
            🎵 {fileInfo && fileInfo !== 'Sin sample cargado' ? fileInfo : `${chops.filter(Boolean).length} sonidos en pads`}
          </span>
          <button
            type="button"
            className="change-sample-btn"
            onClick={() => {
              setTargetPadIndex(0);
              padFileInputRef.current?.click();
            }}
          >
            📂 Cargar sonido
          </button>
        </div>
      )}

      {/* Matriz 4×4 de Pads con Iluminación RGB MPC ONE+ y Soporte de Carpeta Drag & Drop */}
      <div
        className={`pad-grid ${isDragOver ? 'drop-target-active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          if (onBatchDrop) onBatchDrop(e);
        }}
        title="Puedes arrastrar y soltar carpetas de samples de batería o múltiples WAVs directamente aquí"
      >
        {isDragOver && (
          <div className="pad-drop-overlay">
            <span className="drop-icon">📥</span>
            <strong>Suelta tus samples aquí</strong>
            <small>Carga WAVs o carpetas completas a los pads</small>
          </div>
        )}
        {Array.from({ length: 16 }, (_, i) => {
          const globalIdx = bankOffset + i;
          const originalChop = bankChops[i];
          const activeChop = sixteenLevels ? (selectedChop || originalChop || chops[0]) : originalChop;
          const isSelected = !sixteenLevels && originalChop && originalChop.id === selectedId;
          const isPlaying  = activeChop && activeChop.id === playingId;
          const isMuted    = activeChop && mutedPads.has(activeChop.id);
          const rowColor   = MPC_ROW_COLORS[Math.floor(i / 4)];
          const sixteenLevel = sixteenLevels ? SIXTEEN_LEVELS_OFFSETS[i] : null;

          return (
            <button
              key={i}
              type="button"
              className={[
                'mpc-pad',
                activeChop      ? 'has-chop' : 'is-empty',
                isSelected      ? 'selected'  : '',
                isPlaying       ? 'playing'   : '',
                isMuted         ? 'pad-muted' : '',
                sixteenLevels   ? 'sixteen-level-pad' : '',
              ].join(' ')}
              style={{
                '--pad-row-color': rowColor,
                ...(activeChop ? { '--pad-color': activeChop.color } : {}),
              }}
              onClick={() => {
                setSelectedId(activeChop ? activeChop.id : null);
                if (setSelectedPadIndex) setSelectedPadIndex(globalIdx);

                if (padMuteMode && activeChop) {
                  return;
                }
                if (activeChop) {
                  if (isLiveChopMode && isContinuousPlaying) {
                    tapChopAtCurrentTime(globalIdx);
                  } else {
                    hitPad(activeChop, fullLevel ? 1.0 : 1.0, i);
                  }
                } else {
                  // Pad vacío:
                  if (autoSliceEnabled && hasAudioBuffer) {
                    // Si el usuario tiene Auto-Slice activo, reparte automáticamente
                    autoSlice16();
                  } else {
                    // Si Auto-Slice está desactivado: asignar sonido a este pad específico
                    setTargetPadIndex(globalIdx);
                    padFileInputRef.current?.click();
                  }
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer?.files?.length && onAssignPad) {
                  onAssignPad(e.dataTransfer.files, globalIdx);
                }
              }}
            >
              {/* Fila superior: Tecla física + # Pad */}
              <div className="pad-top-meta">
                <span className="pad-key-badge-large">{PAD_KEYS[i]}</span>
                {originalChop?.reverse && (
                  <span
                    className="pad-rev-badge"
                    title="Modo Reverse activo en este pad"
                  >
                    ⮌ REV
                  </span>
                )}
                <span className="pad-num-badge">#{globalIdx + 1}</span>
              </div>

              {/* Centro: Nombre o Estado */}
              {sixteenLevels ? (
                <div className="pad-16level-meta">
                  <span className="pad-16level-note">{sixteenLevel.note}</span>
                  <span className="pad-16level-st">
                    {sixteenLevel.st >= 0 ? `+${sixteenLevel.st}` : sixteenLevel.st}st
                  </span>
                </div>
              ) : (
                <span className="pad-name-label">
                  {isMuted ? '🔇 MUTED' : (originalChop ? originalChop.name : '+ ASIGNAR')}
                </span>
              )}

              {/* Fila inferior: Minutaje exacto milimétrico */}
              <div className="pad-time-row">
                <span className="pad-timestamp-mono">
                  {originalChop ? formatTimeMs(originalChop.start) : '--:--.---'}
                </span>
                {originalChop && (
                  <span className="pad-dur-chip">
                    {(originalChop.end - originalChop.start).toFixed(2)}s
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Barra de Atajos de Teclado */}
      <div className="keys-hint">
        Atajos: <kbd>1-4 / Q-R / A-F / Z-V</kbd> Disparar pads · <kbd>Espacio</kbd> Play/Pausa disco · <kbd>Tab</kbd> Bancos · <kbd>Supr</kbd> Borrar chop · <kbd>Ctrl+Z / Y</kbd> Deshacer/Rehacer
      </div>
    </>
  );
}

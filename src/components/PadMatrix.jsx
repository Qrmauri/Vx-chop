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
  '#ff3b30', // Fila 1: Kick / Bombo
  '#ff9500', // Fila 2: Snare / Caja
  '#00e5ff', // Fila 3: Hi-Hats
  '#af52de', // Fila 4: Chops / Melodía
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
  showRackFx,
  setShowRackFx,
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
    <div className="pad-section-container">
      {/* Barra de Control de Pads (Hardware + Bancos + Voicing) */}
      <div className="pad-control-toolbar">
        {/* Bancos A / B / C / D */}
        <div className="pad-bank-group">
          <span className="deck-group-label">BANCO</span>
          <div className="bank-pill-group">
            {BANKS.map((b) => (
              <button
                key={b}
                type="button"
                className={`bank-pill ${bank === b ? 'active' : ''}`}
                onClick={() => setBank(b)}
                title={`Banco ${b} (Pads ${BANKS.indexOf(b) * 16 + 1} al ${BANKS.indexOf(b) * 16 + 16})`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>

        {/* Voicing: MONO (Choke) vs POLY */}
        <div className="pad-voice-group">
          <span className="deck-group-label">MODO</span>
          <div className="voice-toggle-group">
            <button
              type="button"
              className={`voice-btn ${playMode === 'mono' ? 'active-mono' : ''}`}
              onClick={() => setPlayMode('mono')}
              title="Mono (Choke): Corta el chop anterior al tocar un nuevo pad"
            >
              <span className="voice-dot" /> MONO
            </button>
            <button
              type="button"
              className={`voice-btn ${playMode === 'poly' ? 'active-poly' : ''}`}
              onClick={() => setPlayMode('poly')}
              title="Poly: Sonidos superpuestos simultáneos (acordes)"
            >
              <span className="voice-dot" /> POLY
            </button>
          </div>
        </div>

        {/* Botones Hardware de Performance */}
        <div className="pad-hw-group">
          <button
            type="button"
            className={`hw-toggle-btn ${fullLevel ? 'active-red' : ''}`}
            onClick={() => setFullLevel((v) => !v)}
            title="FULL LEVEL: Fija la fuerza al 100% (127)"
          >
            <span className="hw-dot" /> FULL LEVEL
          </button>

          <button
            type="button"
            className={`hw-toggle-btn ${sixteenLevels ? 'active-amber' : ''}`}
            onClick={() => setSixteenLevels((v) => !v)}
            title="16 LEVELS: Escala cromática de 16 notas del chop seleccionado"
          >
            <span className="hw-dot" /> 16 LEVELS
          </button>

          <button
            type="button"
            className={`hw-toggle-btn ${padMuteMode ? 'active-purple' : ''}`}
            onClick={() => setPadMuteMode((v) => !v)}
            title="PAD MUTE: Silencia o reactiva pads tocándolos"
          >
            <span className="hw-dot" /> PAD MUTE {mutedPads.size > 0 ? `(${mutedPads.size})` : ''}
          </button>

          <button
            type="button"
            className={`hw-toggle-btn ${showQLink ? 'active-cyan' : ''}`}
            onClick={() => setShowQLink((v) => !v)}
            title="Q-LINK: Muestra u oculta las perillas maestras de Filtro, Reso, Pitch y Drive"
          >
            <span className="hw-dot" /> Q-LINK FX
          </button>

          <button
            type="button"
            className={`hw-toggle-btn ${showRackFx ? 'active-vintage' : ''}`}
            onClick={() => setShowRackFx?.((v) => !v)}
            title="RACK FX: Módulo de Efectos Analógicos (Vinilo, Cassette Wow/Flutter, Sidechain Ducking, Juno-60 Chorus)"
          >
            <span className="hw-dot" /> RACK FX
          </button>
        </div>

        {/* Contador de cortes */}
        <div className="pad-status-counter">
          <span>{bankChops.filter(Boolean).length} / 16 cortes</span>
        </div>
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

      {/* Matriz 4×4 de Pads Espaciosa y Cómoda */}
      <div
        className={`pad-grid modern-grid ${isDragOver ? 'drop-target-active' : ''}`}
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
        title="Arrastra y suelta muestras WAV o carpetas directamente sobre los pads"
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
          const activeChop = sixteenLevels ? (selectedChop || originalChop || chops.find(Boolean)) : originalChop;
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
                    autoSlice16();
                  } else {
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
              {/* Retroiluminación LED & Superficie de Silicona */}
              <div className="pad-led-halo" />
              <div className="pad-silicone-surface" />

              {/* Barra superior del Pad: Tecla de acceso rápido + Número + Reverse */}
              <div className="pad-top-meta">
                <span className="pad-key-badge">{PAD_KEYS[i]}</span>
                {originalChop?.reverse && (
                  <span className="pad-rev-badge" title="Reverse activo">⮌ REV</span>
                )}
                <span className="pad-num-badge">#{String(globalIdx + 1).padStart(2, '0')}</span>
              </div>

              {/* Centro: Nombre o Nota */}
              {sixteenLevels ? (
                <div className="pad-16level-meta">
                  <span className="pad-16level-note">{sixteenLevel.note}</span>
                  <span className="pad-16level-st">
                    {sixteenLevel.st >= 0 ? `+${sixteenLevel.st}` : sixteenLevel.st}st
                  </span>
                </div>
              ) : (
                <div className="pad-center-body">
                  {activeChop ? (
                    <span className="pad-name-label">
                      {isMuted ? '🔇 MUTED' : (originalChop?.name || `CHOP ${globalIdx + 1}`)}
                    </span>
                  ) : (
                    <div className="pad-empty-cue">
                      <span className="pad-empty-plus">+</span>
                      <span className="pad-empty-text">ASIGNAR</span>
                    </div>
                  )}
                </div>
              )}

              {/* Fila inferior: Tiempo exacto */}
              <div className="pad-time-row">
                <span className="pad-timestamp-mono">
                  {originalChop ? formatTimeMs(originalChop.start) : '--:--.---'}
                </span>
                {originalChop ? (
                  <span className="pad-dur-chip">
                    {(originalChop.end - originalChop.start).toFixed(2)}s
                  </span>
                ) : (
                  <span className="pad-empty-bank-tag">B{bank}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Guía rápida de atajos de teclado sutil */}
      <div className="keys-hint">
        Atajos: <kbd>1-4 / Q-R / A-F / Z-V</kbd> Disparar pads · <kbd>Espacio</kbd> Continuo · <kbd>Tab</kbd> Bancos · <kbd>Supr</kbd> Borrar pad · <kbd>Ctrl+Z / Y</kbd> Deshacer/Rehacer
      </div>
    </div>
  );
}

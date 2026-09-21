import React from 'react';

export default function SelectedPadPanel({
  selectedChop,
  isContinuousPlaying,
  formatTimeMs,
  nudgeChop,
  hitPad,
  clearSingleChop,
  onToggleReverse,
  onAssignSound,
  selectedPadIndex = 0,
}) {
  return (
    <div className={`selected-pad-panel ${selectedChop ? 'has-selection' : 'no-selection'}`}>
      <div className="sp-header">
        <div className="sp-title-box">
          <div className="sp-vinyl-badge" style={{ borderColor: selectedChop?.color || 'var(--border)' }}>
            <span
              className={`sp-mini-vinyl ${isContinuousPlaying ? 'spinning' : ''}`}
              style={{ background: selectedChop?.color || 'var(--accent)' }}
            />
          </div>
          <div className="sp-text-group">
            <span className="sp-label">
              PAD #{Number(selectedPadIndex) + 1} {selectedChop ? 'ACTIVO' : '(VACÍO)'}
            </span>
            <div className="sp-name-row">
              <span className="sp-name">
                {selectedChop ? selectedChop.name : 'Ningún pad activo'}
              </span>
              {selectedChop?.reverse && (
                <span className="sp-rev-chip">⮌ REVERSE</span>
              )}
            </div>
          </div>
        </div>
        <div className="sp-time-display">
          <div className="sp-time-col">
            <span className="sp-time-tag">INICIO</span>
            <span className="sp-time-main">
              {selectedChop ? formatTimeMs(selectedChop.start) : '--:--.---'}
            </span>
          </div>
          {selectedChop && (
            <div className="sp-time-col">
              <span className="sp-time-tag">DURACIÓN</span>
              <span className="sp-time-sub">
                {formatTimeMs(selectedChop.end - selectedChop.start)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="sp-controls-row">
        <div className="sp-nudge-group">
          <span className="sp-nudge-tag">AJUSTE INICIO (NUDGE):</span>
          <div className="sp-nudge-btns">
            <button
              className="sp-nudge-btn step-large"
              disabled={!selectedChop}
              onClick={() => nudgeChop(selectedChop.id, -1.0)}
              title="Atrasar 1 segundo (-1s)"
            >
              -1s
            </button>
            <button
              className="sp-nudge-btn step-mid"
              disabled={!selectedChop}
              onClick={() => nudgeChop(selectedChop.id, -0.1)}
              title="Atrasar 100 milisegundos (-0.1s)"
            >
              -100ms
            </button>
            <button
              className="sp-nudge-btn step-fine"
              disabled={!selectedChop}
              onClick={() => nudgeChop(selectedChop.id, -0.01)}
              title="Atrasar 10 milisegundos (Ajuste Fino)"
            >
              -10ms
            </button>
            <button
              className="sp-nudge-btn step-fine"
              disabled={!selectedChop}
              onClick={() => nudgeChop(selectedChop.id, +0.01)}
              title="Adelantar 10 milisegundos (Ajuste Fino)"
            >
              +10ms
            </button>
            <button
              className="sp-nudge-btn step-mid"
              disabled={!selectedChop}
              onClick={() => nudgeChop(selectedChop.id, +0.1)}
              title="Adelantar 100 milisegundos (+0.1s)"
            >
              +100ms
            </button>
            <button
              className="sp-nudge-btn step-large"
              disabled={!selectedChop}
              onClick={() => nudgeChop(selectedChop.id, +1.0)}
              title="Adelantar 1 segundo (+1s)"
            >
              +1s
            </button>
          </div>
        </div>

        <div className="sp-actions-group">
          <label
            className="sp-action-btn file-assign-btn"
            title="Cargar o cambiar sonido de este pad específico"
          >
            📁 {selectedChop ? 'CAMBIAR' : 'ASIGNAR'}
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.aif,.aiff"
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files?.length && onAssignSound) {
                  onAssignSound(e.target.files, selectedPadIndex ?? 0);
                  e.target.value = '';
                }
              }}
            />
          </label>
          <button
            className={`sp-action-btn ${selectedChop?.reverse ? 'active-rev' : ''}`}
            disabled={!selectedChop}
            onClick={() => selectedChop && onToggleReverse && onToggleReverse(selectedChop.id)}
            title="Invertir dirección de reproducción de este corte"
          >
            ⮌ {selectedChop?.reverse ? 'REV ON' : 'REVERSE'}
          </button>
          <button
            className="sp-action-btn audition"
            disabled={!selectedChop}
            onClick={() => selectedChop && hitPad(selectedChop, 1.0)}
            title="Escuchar sonido del pad seleccionado"
          >
            ▶ OÍR PAD
          </button>
          <button
            className="sp-action-btn danger"
            disabled={!selectedChop}
            onClick={() => selectedChop && clearSingleChop(selectedChop.id)}
            title="Vaciar pad para asignar otro sonido"
          >
            ✕ VACIAR
          </button>
        </div>
      </div>
    </div>
  );
}

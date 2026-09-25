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
  onUpdateChop,
  onSnapZero,
}) {
  const currentChoke = selectedChop?.chokeGroup !== undefined ? selectedChop.chokeGroup : 1;
  const currentMode = selectedChop?.triggerMode || 'one-shot';
  const attackMs = Math.round((selectedChop?.attack ?? 0.003) * 1000);
  const releaseMs = Math.round((selectedChop?.release ?? 0.04) * 1000);

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
              {selectedChop && (
                <span className="sp-choke-chip">
                  {currentChoke > 0 ? `CHOKE G${currentChoke}` : 'POLY'}
                </span>
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

      {/* Controles de Choke Group, Modo Gate/One-Shot y Envolvente */}
      {selectedChop && (
        <div className="sp-engine-row">
          {/* Selector de Choke Group */}
          <div className="sp-param-group">
            <span className="sp-param-label">CHOKE GROUP:</span>
            <div className="sp-choke-pills" role="group" aria-label="Grupo de corte">
              {[
                { label: 'OFF', val: 0, title: 'Poly libre (no corta otros pads)' },
                { label: 'G1', val: 1, title: 'Grupo 1 (corta pads en G1)' },
                { label: 'G2', val: 2, title: 'Grupo 2 (corta pads en G2)' },
                { label: 'G3', val: 3, title: 'Grupo 3 (corta pads en G3)' },
                { label: 'G4', val: 4, title: 'Grupo 4 (corta pads en G4)' },
              ].map((cg) => (
                <button
                  key={cg.val}
                  type="button"
                  className={`sp-choke-btn ${currentChoke === cg.val ? 'active' : ''}`}
                  onClick={() => onUpdateChop && onUpdateChop(selectedChop.id, { chokeGroup: cg.val })}
                  title={cg.title}
                >
                  {cg.label}
                </button>
              ))}
            </div>
          </div>

          {/* Selector de Modo One-Shot / Gate */}
          <div className="sp-param-group">
            <span className="sp-param-label">DISPARO:</span>
            <div className="sp-mode-toggle" role="group">
              <button
                type="button"
                className={`sp-mode-btn ${currentMode === 'one-shot' ? 'active' : ''}`}
                onClick={() => onUpdateChop && onUpdateChop(selectedChop.id, { triggerMode: 'one-shot' })}
                title="One-Shot: Suena completo al presionar el pad"
              >
                ONE-SHOT
              </button>
              <button
                type="button"
                className={`sp-mode-btn ${currentMode === 'gate' ? 'active' : ''}`}
                onClick={() => onUpdateChop && onUpdateChop(selectedChop.id, { triggerMode: 'gate' })}
                title="Gate: Suena únicamente mientras se mantenga pulsado el pad/tecla"
              >
                GATE
              </button>
            </div>
          </div>

          {/* Sliders de Envolvente Attack & Release */}
          <div className="sp-env-group">
            <div className="sp-env-field">
              <span className="sp-env-tag">ATK: <strong>{attackMs}ms</strong></span>
              <input
                type="range"
                min="1"
                max="200"
                step="1"
                className="sp-env-slider"
                value={attackMs}
                onChange={(e) => onUpdateChop && onUpdateChop(selectedChop.id, { attack: Number(e.target.value) / 1000 })}
                title="Ataque suave para eliminar transientes abruptos o clicks"
              />
            </div>
            <div className="sp-env-field">
              <span className="sp-env-tag">REL: <strong>{releaseMs}ms</strong></span>
              <input
                type="range"
                min="5"
                max="1000"
                step="5"
                className="sp-env-slider"
                value={releaseMs}
                onChange={(e) => onUpdateChop && onUpdateChop(selectedChop.id, { release: Number(e.target.value) / 1000 })}
                title="Release: Cola de caída suave al soltar el pad o cortar la voz"
              />
            </div>
          </div>
        </div>
      )}

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
          <button
            className="sp-action-btn zero-snap-btn"
            disabled={!selectedChop}
            onClick={() => selectedChop && onSnapZero && onSnapZero(selectedChop.id)}
            title="Alinear automáticamente inicio y fin al cruce por cero más cercano (Anti-Clicks)"
          >
            ⚡ SNAP ZERO
          </button>
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

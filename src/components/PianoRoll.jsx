import React, { useState, useRef } from 'react';

// Escala cromática de 2 octavas (de B3 a C2, orden descendente para piano roll)
const BASS_PITCH_ROWS = [
  { val: 11, note: 'B3', isBlack: false },
  { val: 10, note: 'A#3', isBlack: true },
  { val: 9,  note: 'A3', isBlack: false },
  { val: 8,  note: 'G#3', isBlack: true },
  { val: 7,  note: 'G3', isBlack: false },
  { val: 6,  note: 'F#3', isBlack: true },
  { val: 5,  note: 'F3', isBlack: false },
  { val: 4,  note: 'E3', isBlack: false },
  { val: 3,  note: 'D#3', isBlack: true },
  { val: 2,  note: 'D3', isBlack: false },
  { val: 1,  note: 'C#3', isBlack: true },
  { val: 0,  note: 'C3 (Root)', isBlack: false, isRoot: true },
  { val: -1, note: 'B2', isBlack: false },
  { val: -2, note: 'A#2', isBlack: true },
  { val: -3, note: 'A2', isBlack: false },
  { val: -4, note: 'G#2', isBlack: true },
  { val: -5, note: 'G2', isBlack: false },
  { val: -6, note: 'F#2', isBlack: true },
  { val: -7, note: 'F2', isBlack: false },
  { val: -8, note: 'E2', isBlack: false },
  { val: -9, note: 'D#2', isBlack: true },
  { val: -10, note: 'D2', isBlack: false },
  { val: -11, note: 'C#2', isBlack: true },
  { val: -12, note: 'C2', isBlack: false, isRoot: true },
];

export default function PianoRoll({
  tracks = [],
  selectedTrackId = 'bass',
  onSelectTrack,
  currentStep = 0,
  stepCount = 16,
  isPlaying = false,
  toggleStep,
  setStepNote,
  setStepChop,
  setStepVelocity,
  transposeTrack,
  clearTrack,
  chops = [],
  onPreviewNote,
}) {
  const [tool, setTool] = useState('pencil'); // 'pencil' | 'eraser'
  const gridContainerRef = useRef(null);

  const activeTrack = tracks.find((t) => t.id === selectedTrackId) || tracks.find((t) => t.type === 'bass') || tracks[0];
  const isChopTrack = activeTrack?.type === 'chop';

  // Generar filas según el tipo de pista:
  // Si es chops: filas P16 down to P1
  // Si es bajo/otros: filas cromáticas BASS_PITCH_ROWS
  const rows = isChopTrack
    ? Array.from({ length: Math.max(8, Math.min(16, chops.length || 16)) }, (_, i) => {
        const total = Math.max(8, Math.min(16, chops.length || 16));
        const chopIdx = total - 1 - i;
        const chop = chops[chopIdx];
        return {
          val: chopIdx,
          chopIdx,
          note: `P${chopIdx + 1}${chop ? ` ${chop.name.slice(0, 8)}` : ''}`,
          isBlack: false,
          color: chop?.color,
        };
      })
    : BASS_PITCH_ROWS;

  const handleCellClick = (rowVal, stepIdx) => {
    if (!activeTrack) return;
    const step = activeTrack.steps[stepIdx];

    if (tool === 'eraser') {
      // Borrar nota si está activa
      if (step?.active) {
        toggleStep(activeTrack.id, stepIdx);
      }
      return;
    }

    // Herramienta Lápiz:
    if (isChopTrack) {
      if (step?.active && step.chopIndex === rowVal) {
        toggleStep(activeTrack.id, stepIdx);
      } else {
        if (!step?.active) toggleStep(activeTrack.id, stepIdx);
        setStepChop(activeTrack.id, stepIdx, rowVal);
        if (onPreviewNote) onPreviewNote(activeTrack, rowVal);
      }
    } else {
      if (step?.active && (step.note ?? 0) === rowVal) {
        toggleStep(activeTrack.id, stepIdx);
      } else {
        if (!step?.active) toggleStep(activeTrack.id, stepIdx);
        setStepNote(activeTrack.id, stepIdx, rowVal);
        if (onPreviewNote) onPreviewNote(activeTrack, rowVal);
      }
    }
  };

  const handleKeyClick = (rowVal) => {
    if (onPreviewNote && activeTrack) {
      onPreviewNote(activeTrack, rowVal);
    }
  };

  return (
    <div className="piano-roll-root">
      {/* ── Barra Superior de Herramientas del Piano Roll ───────────────── */}
      <div className="piano-roll-toolbar">
        <div className="pr-track-selector-group">
          <span className="pr-label">PISTA:</span>
          <select
            className="pr-track-select"
            value={activeTrack?.id}
            onChange={(e) => onSelectTrack && onSelectTrack(e.target.value)}
          >
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.type.toUpperCase()})
              </option>
            ))}
          </select>
        </div>

        {/* Herramientas de Dibujo (Lápiz vs Borrador) */}
        <div className="pr-tools-group">
          <button
            className={`pr-tool-btn ${tool === 'pencil' ? 'active' : ''}`}
            onClick={() => setTool('pencil')}
            title="Herramienta Lápiz: Haz clic en la cuadrícula para pintar notas"
          >
            ✏️ Lápiz
          </button>
          <button
            className={`pr-tool-btn ${tool === 'eraser' ? 'active' : ''}`}
            onClick={() => setTool('eraser')}
            title="Herramienta Borrador: Haz clic en una nota para eliminarla"
          >
            🧹 Borrador
          </button>
        </div>

        {/* Acciones de Edición Rápida */}
        <div className="pr-actions-group">
          {!isChopTrack && (
            <>
              <button
                className="pr-action-btn"
                onClick={() => transposeTrack && transposeTrack(activeTrack.id, 1)}
                title="Subir un semitono (+1)"
              >
                ♯ +1 Semitono
              </button>
              <button
                className="pr-action-btn"
                onClick={() => transposeTrack && transposeTrack(activeTrack.id, -1)}
                title="Bajar un semitono (-1)"
              >
                ♭ -1 Semitono
              </button>
              <button
                className="pr-action-btn"
                onClick={() => transposeTrack && transposeTrack(activeTrack.id, 12)}
                title="Subir una octava completa (+12)"
              >
                ▲ +Octava
              </button>
              <button
                className="pr-action-btn"
                onClick={() => transposeTrack && transposeTrack(activeTrack.id, -12)}
                title="Bajar una octava completa (-12)"
              >
                ▼ -Octava
              </button>
            </>
          )}
          <button
            className="pr-action-btn danger"
            onClick={() => clearTrack && clearTrack(activeTrack.id)}
            title="Limpiar todas las notas de esta pista"
          >
            🗑️ Limpiar Melodía
          </button>
        </div>
      </div>

      {/* ── Matriz del Piano Roll (Teclado + Cuadrícula de Notas) ───────── */}
      <div className="piano-roll-workspace" ref={gridContainerRef}>
        {/* Cabecera de Compases Horizontales */}
        <div className="pr-steps-header">
          <div className="pr-keyboard-spacer" />
          <div className="pr-steps-ruler" style={{ gridTemplateColumns: `repeat(${stepCount}, 1fr)` }}>
            {Array.from({ length: stepCount }, (_, i) => {
              const isBeat = i % 4 === 0;
              const isPlayhead = currentStep === i && isPlaying;
              return (
                <div
                  key={i}
                  className={`pr-ruler-cell ${isBeat ? 'beat-marker' : ''} ${isPlayhead ? 'playhead' : ''}`}
                >
                  {isBeat ? `${Math.floor(i / 4) + 1}.${(i % 4) + 1}` : `${i + 1}`}
                </div>
              );
            })}
          </div>
        </div>

        {/* Filas del Piano Roll */}
        <div className="pr-grid-body">
          {rows.map((row) => {
            return (
              <div key={row.val} className={`pr-row ${row.isBlack ? 'black-key-row' : ''} ${row.isRoot ? 'root-row' : ''}`}>
                {/* Tecla del Piano Lateral */}
                <button
                  type="button"
                  className={`pr-piano-key ${row.isBlack ? 'black-key' : 'white-key'} ${row.isRoot ? 'root-key' : ''}`}
                  onClick={() => handleKeyClick(row.val)}
                  title={`Tocar tecla ${row.note} para escuchar`}
                >
                  <span className="pr-key-label">{row.note}</span>
                </button>

                {/* Celdas de Pasos en esta fila de afinación */}
                <div className="pr-row-cells" style={{ gridTemplateColumns: `repeat(${stepCount}, 1fr)` }}>
                  {Array.from({ length: stepCount }, (_, sIdx) => {
                    const step = activeTrack?.steps[sIdx];
                    const isPlayhead = currentStep === sIdx && isPlaying;
                    const isBeat = sIdx % 4 === 0;

                    // Comprobar si este paso tiene una nota en ESTA fila exacta
                    let isNoteHere = false;
                    if (step?.active) {
                      if (isChopTrack) {
                        isNoteHere = (step.chopIndex ?? 0) === row.val;
                      } else {
                        isNoteHere = (step.note ?? 0) === row.val;
                      }
                    }

                    return (
                      <div
                        key={sIdx}
                        className={[
                          'pr-cell',
                          isBeat ? 'beat-divider' : '',
                          isPlayhead ? 'playhead-col' : '',
                          isNoteHere ? 'has-note' : '',
                        ].join(' ')}
                        onClick={() => handleCellClick(row.val, sIdx)}
                        title={`Paso ${sIdx + 1} - ${row.note}`}
                      >
                        {isNoteHere && (
                          <div
                            className="pr-note-block"
                            style={{
                              backgroundColor: row.color || activeTrack?.color || 'var(--accent)',
                            }}
                          >
                            <span className="pr-note-text">{row.note}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

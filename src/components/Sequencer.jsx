import { useRef, useState } from 'react';
import { exportFullBeatToWav } from '../utils/exportBeat.js';
import PianoRoll from './PianoRoll.jsx';
import { playBass } from '../utils/drumSynth.js';

const SEMITONE_NOTES = [
  { val: -12, label: 'C-1' }, { val: -11, label: 'C#-1' }, { val: -10, label: 'D-1' },
  { val: -9, label: 'D#-1' }, { val: -8, label: 'E-1' },   { val: -7, label: 'F-1' },
  { val: -6, label: 'F#-1' }, { val: -5, label: 'G-1' },   { val: -4, label: 'G#-1' },
  { val: -3, label: 'A-1' },  { val: -2, label: 'A#-1' },  { val: -1, label: 'B-1' },
  { val: 0, label: 'C' },     { val: 1, label: 'C#' },     { val: 2, label: 'D' },
  { val: 3, label: 'D#' },    { val: 4, label: 'E' },      { val: 5, label: 'F' },
  { val: 6, label: 'F#' },    { val: 7, label: 'G' },      { val: 8, label: 'G#' },
  { val: 9, label: 'A' },     { val: 10, label: 'A#' },    { val: 11, label: 'B' },
  { val: 12, label: 'C+1' },
];

export default function Sequencer({
  sequencer,
  bpm = 90,
  setBpm,
  chops = [],
  mainBuffer = null,
  pitch = 0,
  onOpenSampleTab,
  onHitPad,   // función para Note Repeat: dispara el pad activo
}) {
  const {
    tracks,
    isPlaying,
    isRecording,
    currentStep,
    stepCount,
    setStepCount,
    swing,
    setSwing,
    quantize,
    setQuantize,
    noteRepeat,
    startNoteRepeat,
    stopNoteRepeat,
    play,
    stop,
    toggleRecord,
    recordHit,
    toggleStep,
    setStepNote,
    setStepChop,
    setStepVelocity,
    toggleMute,
    toggleSolo,
    setTrackVolume,
    loadCustomSample,
    applyPreset,
    clearAll,
    clearTrack,
    duplicatePattern,
    transposeTrack,
    nudgeTrack,
    getActiveCtx,
    getDestination,
  } = sequencer;

  // Estado para el popover de edición de notas/chops/velocity y exportación
  const [viewMode, setViewMode] = useState('tracks'); // 'tracks' | 'pianoroll'
  const [editingStep, setEditingStep] = useState(null); // { trackId, stepIdx, type }
  const [isExporting, setIsExporting] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportBars, setExportBars] = useState(4); // 2, 4, 8, 16, 32 loops
  const [exportMastering, setExportMastering] = useState(true);
  const [velocityEdit, setVelocityEdit] = useState(null); // { trackId, stepIdx }
  const [selectedTrackId, setSelectedTrackId] = useState('bass');
  const [showVelocityLane, setShowVelocityLane] = useState(true);
  const fileInputRef = useRef({});

  // Preescucha de notas para el Piano Roll
  const handlePreviewNote = (track, noteVal) => {
    try {
      const ctx = getActiveCtx ? getActiveCtx() : null;
      if (!ctx) return;
      const dest = getDestination ? getDestination() : ctx.destination;
      if (track.type === 'bass') {
        playBass(ctx, dest, ctx.currentTime, 1.0, noteVal);
      } else if (track.type === 'chop') {
        if (onHitPad && chops[noteVal]) {
          onHitPad(chops[noteVal]);
        }
      }
    } catch (err) {
      console.warn('Error en preescucha de nota:', err);
    }
  };

  const handleExportBeat = async () => {
    setIsExporting(true);
    try {
      await exportFullBeatToWav({
        tracks,
        chops,
        mainBuffer,
        pitchSemitones: pitch,
        bpm,
        stepCount,
        swing,
        repeatBars: exportBars,
        applyMastering: exportMastering,
      });
      setShowExportModal(false);
    } catch (err) {
      console.error('Error al exportar beat:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleStepClick = (track, stepIdx, e) => {
    // Si la tecla Shift está presionada o es clic derecho en un paso activo de bajo/chops: abrir editor
    if (track.steps[stepIdx].active && (track.type === 'bass' || track.type === 'chop')) {
      if (e.shiftKey || e.altKey) {
        setEditingStep({ trackId: track.id, stepIdx, type: track.type });
        return;
      }
    }
    toggleStep(track.id, stepIdx);
  };

  const handleStepContextMenu = (track, stepIdx, e) => {
    e.preventDefault();
    if (!track.steps[stepIdx].active) {
      toggleStep(track.id, stepIdx);
    }
    // Abrir editor de nota/chop para bass/chop, o editar solo velocity para otros
    setEditingStep({ trackId: track.id, stepIdx, type: track.type });
  };

  return (
    <div className="sequencer-container">

      {/* ── Barra Superior del Secuenciador ──────────────────────────────── */}
      <div className="seq-toolbar">
        <div className="seq-transport-group">
          <button
            className={`mpc-btn ${isPlaying ? 'accent' : 'primary'}`}
            onClick={isPlaying ? stop : play}
          >
            {isPlaying ? '■ DETENER' : '▶ REPRODUCIR'}
          </button>

          {/* Botón de Grabación en Vivo (REC) */}
          <button
            className={`mpc-btn seq-rec-btn ${isRecording ? 'recording' : ''}`}
            onClick={toggleRecord}
            title="Grabar en vivo tocando los pads o teclas con cuantización al 1/16"
          >
            <span className={`rec-dot ${isRecording ? 'pulse' : ''}`} />
            REC
          </button>

          {/* Note Repeat – mantener presionado para repetir el pad al ritmo */}
          <button
            className={`mpc-btn seq-note-repeat-btn ${noteRepeat ? 'active' : ''}`}
            title={`Note Repeat: repite el pad activo cada 1/${quantize} mientras está activo`}
            onMouseDown={() => startNoteRepeat(onHitPad)}
            onMouseUp={stopNoteRepeat}
            onMouseLeave={stopNoteRepeat}
            onTouchStart={(e) => { e.preventDefault(); startNoteRepeat(onHitPad); }}
            onTouchEnd={stopNoteRepeat}
          >
            <span className="repeat-icon">↻</span> NOTE REPEAT
          </button>

          {/* Selector de Swing MPC */}
          <div className="seq-swing-group">
            <span className="seq-step-label">SWING</span>
            <select
              className="seq-swing-select"
              value={swing}
              onChange={(e) => setSwing(Number(e.target.value))}
              title="Groove / Swing estilo MPC"
            >
              <option value={50}>50% Recto</option>
              <option value={54}>54% Leve</option>
              <option value={58}>58% Lofi</option>
              <option value={62}>62% MPC</option>
              <option value={66}>66% Shuffle</option>
              <option value={71}>71% Dilla</option>
            </select>
          </div>

          {/* Selector de Cuantización */}
          <div className="seq-swing-group">
            <span className="seq-step-label">QUANTIZE</span>
            <select
              className="seq-swing-select"
              value={quantize}
              onChange={(e) => setQuantize(Number(e.target.value))}
              title="Resolución de cuantización para grabación en vivo y Note Repeat"
            >
              <option value={4}>1/4 Negra</option>
              <option value={8}>1/8 Corchea</option>
              <option value={16}>1/16 Semi</option>
              <option value={32}>1/32 Fusa</option>
            </select>
          </div>

          <div className="seq-step-display">
            <span className="seq-step-label">PASO</span>
            <span className="seq-step-num">{currentStep + 1} / {stepCount}</span>
          </div>
          <div className="seq-step-display seq-tempo-display">
            <span className="seq-step-label">TEMPO</span>
            <div className="seq-bpm-ctrl">
              <button
                className="seq-bpm-btn"
                onClick={() => setBpm?.((b) => Math.max(30, (Number(b) || 90) - 1))}
                title="Disminuir tempo (-1 BPM)"
              >
                −
              </button>
              <input
                type="number"
                min="30"
                max="300"
                className="seq-bpm-input"
                value={bpm}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) setBpm?.(Math.max(30, Math.min(300, val)));
                  else if (e.target.value === '') setBpm?.('');
                }}
                onBlur={() => {
                  if (!bpm || Number(bpm) < 30) setBpm?.(90);
                }}
                title="Escribe directamente el BPM deseado (30 a 300)"
              />
              <button
                className="seq-bpm-btn"
                onClick={() => setBpm?.((b) => Math.min(300, (Number(b) || 90) + 1))}
                title="Aumentar tempo (+1 BPM)"
              >
                +
              </button>
            </div>
          </div>
        </div>

        <div className="seq-presets-group">
          <span className="seq-presets-label hide-mobile">PRESETS:</span>
          <button className="seq-preset-btn" onClick={() => applyPreset('boombap')}>
            ⚡ Boom Bap
          </button>
          <button className="seq-preset-btn" onClick={() => applyPreset('lofi')}>
            ☕ Lofi
          </button>
          <button className="seq-preset-btn" onClick={() => applyPreset('trap')}>
            🔥 Trap 808
          </button>
          <button className="seq-preset-btn clear" onClick={clearAll} title="Limpiar patrón">
            🗑️ Limpiar
          </button>
        </div>

        <div className="seq-actions-group">
          <div className="seq-length-group">
            <button
              className={`seq-len-btn ${stepCount === 16 ? 'active' : ''}`}
              onClick={() => setStepCount(16)}
              title="16 pasos (1 compás)"
            >
              16
            </button>
            <button
              className={`seq-len-btn ${stepCount === 32 ? 'active' : ''}`}
              onClick={() => setStepCount(32)}
              title="32 pasos (2 compases)"
            >
              32
            </button>
            <button
              className={`seq-len-btn ${stepCount === 64 ? 'active' : ''}`}
              onClick={() => setStepCount(64)}
              title="64 pasos (4 compases)"
            >
              64
            </button>
          </div>

          {/* Exportar Beat Completo en WAV */}
          <button
            className="mpc-btn accent seq-export-btn"
            disabled={isExporting}
            onClick={() => setShowExportModal(true)}
            title="Configurar duración, mastering y exportar beat a WAV estéreo"
          >
            {isExporting ? '⏳ Renderizando...' : '⇩ Exportar Beat (WAV)'}
          </button>
        </div>
      </div>


      {/* Selector de Modo: Pistas vs Piano Roll */}
      <div className="seq-view-selector-bar">
        <button
          type="button"
          className={`seq-view-tab-btn ${viewMode === 'tracks' ? 'active' : ''}`}
          onClick={() => setViewMode('tracks')}
        >
          🥁 VISTA DE PISTAS (DRUM GRID)
        </button>
        <button
          type="button"
          className={`seq-view-tab-btn ${viewMode === 'pianoroll' ? 'active' : ''}`}
          onClick={() => setViewMode('pianoroll')}
        >
          🎹 PIANO ROLL (DIBUJAR NOTAS MIDI)
        </button>
      </div>

      {viewMode === 'pianoroll' ? (
        <PianoRoll
          tracks={tracks}
          selectedTrackId={selectedTrackId}
          onSelectTrack={setSelectedTrackId}
          currentStep={currentStep}
          stepCount={stepCount}
          isPlaying={isPlaying}
          toggleStep={toggleStep}
          setStepNote={setStepNote}
          setStepChop={setStepChop}
          setStepVelocity={setStepVelocity}
          transposeTrack={transposeTrack}
          clearTrack={clearTrack}
          chops={chops}
          onPreviewNote={handlePreviewNote}
        />
      ) : (
        /* ── Matriz de Pistas y Pasos ─────────────────────────────────────── */
        <div className="seq-grid-wrap" style={{ '--seq-cols': stepCount }}>

        {/* Marcador de compases superiores (1, 2, 3, 4) */}
        <div className="seq-beats-header">
          <div className="seq-track-header-spacer" />
          <div className="seq-steps-header" style={{ gridTemplateColumns: `repeat(${stepCount}, 1fr)` }}>
            {Array.from({ length: stepCount }, (_, i) => (
              <div
                key={i}
                className={`seq-header-col ${i % 4 === 0 ? 'beat-start' : ''} ${currentStep === i ? 'playhead-active' : ''}`}
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>


        {/* Lista de Pistas */}
        <div className="seq-tracks-list">
          {tracks.map((track) => (
            <div key={track.id} className="seq-track-row">

              {/* Encabezado y controles de la Pista */}
              <div className="seq-track-info" style={{ '--track-color': track.color }}>
                <div className="seq-track-tag" style={{ background: track.color }} />
                <div className="seq-track-meta">
                  <div className="seq-track-name" title={track.name}>
                    {track.name}
                  </div>
                  {track.type === 'chop' && chops.length === 0 && (
                    <button className="seq-hint-btn" onClick={onOpenSampleTab}>
                      + Cargar sample
                    </button>
                  )}
                </div>

                <div className="seq-track-controls">
                  {/* Botón Silenciar (Mute) */}
                  <button
                    className={`seq-mini-btn mute ${track.muted ? 'active' : ''}`}
                    onClick={() => toggleMute(track.id)}
                    title="Silenciar pista"
                  >
                    M
                  </button>

                  {/* Botón Solo */}
                  <button
                    className={`seq-mini-btn solo ${track.solo ? 'active' : ''}`}
                    onClick={() => toggleSolo(track.id)}
                    title="Solo pista"
                  >
                    S
                  </button>

                  {/* Carga de Sample Personalizado */}
                  <label className="seq-mini-btn upload" title="Cargar tu propio sample de audio">
                    📁
                    <input
                      type="file"
                      accept="audio/*"
                      style={{ display: 'none' }}
                      ref={(el) => { fileInputRef.current[track.id] = el; }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) loadCustomSample(track.id, file);
                      }}
                    />
                  </label>
                </div>
              </div>

              {/* Botones de Pasos de la Pista */}
              <div className="seq-steps-row" style={{ gridTemplateColumns: `repeat(${stepCount}, 1fr)` }}>
                {track.steps.slice(0, stepCount).map((step, idx) => {
                  const isPlayhead = currentStep === idx && isPlaying;
                  const isBeatStart = idx % 4 === 0;

                  // Etiqueta visual para pasos con nota o chop
                  let noteLabel = null;
                  if (step.active) {
                    if (track.type === 'bass') {
                      const noteObj = SEMITONE_NOTES.find((n) => n.val === step.note);
                      noteLabel = noteObj ? noteObj.label : `${step.note}`;
                    } else if (track.type === 'chop') {
                      noteLabel = `P${(step.chopIndex ?? 0) + 1}`;
                    }
                  }

                  return (
                    <button
                      key={idx}
                      className={[
                        'seq-step-btn',
                        isBeatStart ? 'beat-divider' : '',
                        step.active ? 'active' : '',
                        isPlayhead ? 'playhead' : '',
                      ].join(' ')}
                      style={step.active ? { '--step-color': track.color } : {}}
                      onClick={(e) => handleStepClick(track, idx, e)}
                      onContextMenu={(e) => handleStepContextMenu(track, idx, e)}
                      title={`Paso ${idx + 1}${step.active ? ` | vel: ${Math.round((step.velocity ?? 1) * 100)}% | Clic derecho para editar` : ''}`}
                    >
                      <span className="seq-step-inner" />
                      {/* Barra de velocity en la parte inferior del botón */}
                      {step.active && (
                        <span
                          className="seq-vel-bar"
                          style={{ height: `${Math.round((step.velocity ?? 1) * 100)}%` }}
                        />
                      )}
                      {noteLabel && <span className="seq-step-badge">{noteLabel}</span>}
                    </button>
                  );
                })}
              </div>

            </div>
          ))}
        </div>

        {/* ── Carril Inferior de Velocity (Inspirado en Pantalla Táctil MPC ONE) ────── */}
        {showVelocityLane && (
          <div className="seq-vel-lane">
            <div className="seq-vel-lane-header">
              <div className="seq-vel-lane-title">
                <span className="vel-icon">🎚</span> VELOCITY
              </div>
              <select
                className="seq-vel-track-select"
                value={selectedTrackId}
                onChange={(e) => setSelectedTrackId(e.target.value)}
                title="Seleccionar pista para ver y editar velocity"
              >
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <div className="seq-vel-lane-grid" style={{ gridTemplateColumns: `repeat(${stepCount}, 1fr)` }}>
              {(() => {
                const curTrack = tracks.find((t) => t.id === selectedTrackId) || tracks[0];
                return curTrack.steps.slice(0, stepCount).map((step, idx) => {
                  const isPlayhead = currentStep === idx && isPlaying;
                  const pct = step.active ? Math.round((step.velocity || 1.0) * 100) : 0;

                  return (
                    <div
                      key={idx}
                      className={`seq-vel-col ${step.active ? 'active' : ''} ${isPlayhead ? 'playhead' : ''}`}
                      title={step.active ? `Paso #${idx + 1}: ${pct}% Velocity (Clic para editar)` : `Paso #${idx + 1}: Inactivo`}
                      onClick={() => {
                        if (step.active) {
                          setEditingStep({ trackId: curTrack.id, stepIdx: idx, type: curTrack.type });
                        } else {
                          toggleStep(curTrack.id, idx);
                        }
                      }}
                    >
                      <div
                        className="seq-vel-stem"
                        style={{
                          height: `${pct}%`,
                          backgroundColor: curTrack.color || 'var(--accent)',
                        }}
                      />
                      <span className="seq-vel-label">
                        {step.active ? `${pct}` : ''}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* ── Barra de Herramientas Estilo Pantalla MPC ONE ───────────────── */}
        <div className="seq-screen-tools">
          <div className="seq-screen-counter">
            <span className="seq-counter-label">BAR : BEAT : TICK</span>
            <span className="seq-counter-val">
              {Math.floor(currentStep / 4) + 1} : {(currentStep % 4) + 1} : 0
            </span>
          </div>

          <div className="seq-screen-buttons">
            <button
              className={`seq-screen-btn ${showVelocityLane ? 'active' : ''}`}
              onClick={() => setShowVelocityLane((v) => !v)}
              title="Mostrar / Ocultar carril inferior de Velocity"
            >
              {showVelocityLane ? '▼ VELOCITY' : '▲ VELOCITY'}
            </button>
            <button
              className="seq-screen-btn accent"
              onClick={duplicatePattern}
              title="DOUBLE: Duplica el patrón (16 -> 32 compases, o 32 -> 64)"
            >
              2X DOUBLE
            </button>
            <button
              className="seq-screen-btn"
              onClick={() => nudgeTrack(selectedTrackId, -1)}
              title="NUDGE ◀: Desplaza las notas de la pista hacia la izquierda (micro-groove)"
            >
              ◀ NUDGE
            </button>
            <button
              className="seq-screen-btn"
              onClick={() => nudgeTrack(selectedTrackId, 1)}
              title="NUDGE ▶: Desplaza las notas de la pista hacia la derecha (micro-groove)"
            >
              NUDGE ▶
            </button>
            <button
              className="seq-screen-btn"
              onClick={() => transposeTrack(selectedTrackId, -1)}
              title="TRANS -1: Baja un semitono la pista seleccionada"
            >
              ♭ TRANS -1
            </button>
            <button
              className="seq-screen-btn"
              onClick={() => transposeTrack(selectedTrackId, 1)}
              title="TRANS +1: Sube un semitono la pista seleccionada"
            >
              ♯ TRANS +1
            </button>
            <button
              className="seq-screen-btn danger"
              onClick={() => clearTrack(selectedTrackId)}
              title="Limpiar notas de la pista seleccionada"
            >
              🗑️ Limpiar Pista
            </button>
          </div>
        </div>

      </div>
      )}

      {/* ── Pie con Atajos y Guía ────────────────────────────────────────── */}
      <div className="seq-footer-hint">
        💡 <strong>Tip:</strong> Haz clic derecho en cualquier paso activo para editar nota, slice o <strong>velocity</strong>. Mantén <strong>NOTE REPEAT</strong> para repetir al tempo. Usa <strong>DOUBLE</strong> para duplicar de 16 a 32 compases.
      </div>



      {/* ── Modal / Popover de Edición de Nota / Slice / Velocity ───────── */}
      {editingStep && (() => {
        const editTrack = tracks.find((t) => t.id === editingStep.trackId);
        const editStepData = editTrack?.steps[editingStep.stepIdx];
        const currentVel = editStepData?.velocity ?? 1.0;
        return (
          <div className="mpc-modal-overlay" onClick={() => setEditingStep(null)}>
            <div className="mpc-modal-card seq-note-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">
                  {editingStep.type === 'bass' ? '🎵 EDITAR PASO – BAJO / 808' :
                   editingStep.type === 'chop' ? '🔪 EDITAR PASO – SAMPLE CHOP' :
                   `🥁 EDITAR PASO – ${editingStep.trackId.toUpperCase()}`}
                </div>
                <button className="modal-close" onClick={() => setEditingStep(null)}>×</button>
              </div>

              <div className="modal-body">
                <div className="modal-row">
                  <span>Pista: <strong>{editingStep.trackId}</strong></span>
                  <span>Paso: <strong>#{editingStep.stepIdx + 1}</strong></span>
                </div>

                {/* ── Velocity Slider (siempre visible) ── */}
                <div className="vel-editor">
                  <div className="modal-section-title" style={{ marginBottom: 6 }}>
                    🎚 Velocity: <strong>{Math.round(currentVel * 100)}%</strong>
                  </div>
                  <div className="vel-slider-row">
                    <span className="vel-label">pp</span>
                    <input
                      type="range"
                      min="1" max="100"
                      value={Math.round(currentVel * 100)}
                      className="vel-slider"
                      onChange={(e) => {
                        setStepVelocity(editingStep.trackId, editingStep.stepIdx, Number(e.target.value) / 100);
                      }}
                    />
                    <span className="vel-label">ff</span>
                  </div>
                  {/* Botones de velocity rápida */}
                  <div className="vel-quick-btns">
                    {[25, 50, 75, 100].map((v) => (
                      <button
                        key={v}
                        className={`vel-quick-btn ${Math.round(currentVel * 100) === v ? 'selected' : ''}`}
                        onClick={() => setStepVelocity(editingStep.trackId, editingStep.stepIdx, v / 100)}
                      >
                        {v}%
                      </button>
                    ))}
                  </div>
                </div>

                {editingStep.type === 'bass' && (
                  <div>
                    <div className="modal-section-title" style={{ marginTop: 12, marginBottom: 8 }}>
                      Selecciona el tono musical (Cromático):
                    </div>
                    <div className="note-selector-grid">
                      {SEMITONE_NOTES.map(({ val, label }) => {
                        const currentVal = editStepData?.note ?? 0;
                        const isSelected = currentVal === val;

                        return (
                          <button
                            key={val}
                            className={`note-pill ${isSelected ? 'selected' : ''}`}
                            onClick={() => {
                              setStepNote(editingStep.trackId, editingStep.stepIdx, val);
                              setEditingStep(null);
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {editingStep.type === 'chop' && (
                  <div>
                    <div className="modal-section-title" style={{ marginTop: 12, marginBottom: 8 }}>
                      Selecciona qué corte/pad disparar en este paso:
                    </div>
                    {chops.length > 0 ? (
                      <div className="chop-selector-grid">
                        {chops.map((chop, cIdx) => {
                          const currentVal = editStepData?.chopIndex ?? 0;
                          const isSelected = currentVal === cIdx;

                          return (
                            <button
                              key={chop.id}
                              className={`chop-pill ${isSelected ? 'selected' : ''}`}
                              style={{ '--chop-color': chop.color }}
                              onClick={() => {
                                setStepChop(editingStep.trackId, editingStep.stepIdx, cIdx);
                                setEditingStep(null);
                              }}
                            >
                              <span className="chop-num">P{cIdx + 1}</span>
                              <span className="chop-title">{chop.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="midi-empty-hint">
                        No hay cortes creados todavía. Ve a la pestaña de Sample y realiza cortes en la forma de onda.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Modal de Exportación de Beat Completo ───────────────────────── */}
      {showExportModal && (() => {
        const stepDur = (60 / (bpm || 90)) / 4;
        const loopDur = stepDur * stepCount;
        const totalEstSecs = Math.round(loopDur * exportBars);
        const mins = Math.floor(totalEstSecs / 60);
        const secs = totalEstSecs % 60;
        const durationFormatted = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

        return (
          <div className="mpc-modal-overlay" onClick={() => !isExporting && setShowExportModal(false)}>
            <div className="mpc-modal-card seq-export-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">
                  💾 EXPORTAR BEAT (WAV ESTÉREO)
                </div>
                {!isExporting && (
                  <button className="modal-close" onClick={() => setShowExportModal(false)}>×</button>
                )}
              </div>

              <div className="modal-body">
                {/* Resumen de Tempo y Configuración */}
                <div className="export-summary-box">
                  <div className="export-stat">
                    <span className="export-stat-label">TEMPO</span>
                    <span className="export-stat-val">{bpm} BPM</span>
                  </div>
                  <div className="export-stat">
                    <span className="export-stat-label">PASOS / VUELTA</span>
                    <span className="export-stat-val">{stepCount}</span>
                  </div>
                  <div className="export-stat highlight">
                    <span className="export-stat-label">DURACIÓN ESTIMADA</span>
                    <span className="export-stat-val">{durationFormatted}</span>
                  </div>
                </div>

                {/* Selección de Duración / Vueltas */}
                <div className="modal-section-title" style={{ marginTop: 12, marginBottom: 6 }}>
                  ⏱️ Duración / Repeticiones del Beat:
                </div>
                <div className="export-bars-grid">
                  {[
                    { bars: 2, label: '2 Loops', desc: `~${Math.round(loopDur * 2)}s · Sample corto` },
                    { bars: 4, label: '4 Loops', desc: `~${Math.round(loopDur * 4)}s · Frase estándar` },
                    { bars: 8, label: '8 Loops', desc: `~${Math.round(loopDur * 8)}s · Intro + Verso` },
                    { bars: 16, label: '16 Loops', desc: `~${Math.round(loopDur * 16)}s · Beat completo` },
                    { bars: 32, label: '32 Loops', desc: `~${Math.round(loopDur * 32)}s · Instrumental largo` },
                  ].map((item) => (
                    <button
                      key={item.bars}
                      type="button"
                      disabled={isExporting}
                      className={`export-bar-btn ${exportBars === item.bars ? 'selected' : ''}`}
                      onClick={() => setExportBars(item.bars)}
                    >
                      <span className="export-bar-title">{item.label}</span>
                      <span className="export-bar-desc">{item.desc}</span>
                    </button>
                  ))}
                </div>

                {/* Opción de Mastering Analógico MPC */}
                <label className="export-mastering-toggle" style={{ marginTop: 14 }}>
                  <input
                    type="checkbox"
                    checked={exportMastering}
                    disabled={isExporting}
                    onChange={(e) => setExportMastering(e.target.checked)}
                  />
                  <div className="export-mastering-info">
                    <span className="export-mastering-title">
                      🎛️ Mastering MPC + Normalización Inteligente (-0.3 dB True Peak)
                    </span>
                    <span className="export-mastering-desc">
                      Compresión musical suave y protección anti-clipping para que el audio suene con máxima pegada y balance estéreo en ambos parlantes.
                    </span>
                  </div>
                </label>

                {/* Botones de Acción */}
                <div className="export-actions-row" style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="mpc-btn"
                    disabled={isExporting}
                    onClick={() => setShowExportModal(false)}
                    style={{ flex: 1 }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="mpc-btn accent"
                    disabled={isExporting}
                    onClick={handleExportBeat}
                    style={{ flex: 2, padding: '10px 14px', fontSize: 12 }}
                  >
                    {isExporting ? '⏳ Renderizando beat estéreo...' : '⇩ Renderizar y Descargar WAV'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}

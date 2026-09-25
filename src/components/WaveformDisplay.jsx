import React from 'react';
import { formatTime } from '../utils/format.js';

export default function WaveformDisplay({
  canvasRef,
  playheadCanvasRef,
  spectrumCanvasRef,
  currentTimeLabelRef,
  totalTimeLabelRef,
  durationFillRef,
  audioDuration,
  chopsCount,
  selectedChop,
  zoom,
  setZoom,
  setViewStart,
  zoomToChop,
  handlePointerDown,
  handlePointerMove,
  handlePointerUp,
  hasAudio = false,
  onTriggerLoadAudio,
  onBatchDrop,
}) {
  return (
    <div className="left-card waveform-compact-card">
      {/* Barra de Título & Zoom Integrada */}
      <div className="card-title-row waveform-header-row">
        <div className="waveform-title-group">
          <span className="card-title">FORMA DE ONDA</span>
          <span className="waveform-selected-tag">
            {selectedChop
              ? `● ${selectedChop.name} (${formatTime(selectedChop.end - selectedChop.start)})`
              : hasAudio
              ? `${chopsCount} cortes · Arrastra sobre la onda para cortar`
              : 'Esperando audio para muestrear'}
          </span>
        </div>

        {/* Controles de Zoom en línea */}
        <div className="zoom-steppers-inline">
          <button
            type="button"
            className="mpc-btn zoom-btn"
            disabled={!hasAudio}
            onClick={() => setZoom((z) => Math.max(1, z / 1.5))}
            title="Alejar zoom (-)"
          >
            −
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="mpc-btn zoom-btn"
            disabled={!hasAudio}
            onClick={() => setZoom((z) => Math.min(20, z * 1.5))}
            title="Acercar zoom (+)"
          >
            +
          </button>
          <button
            type="button"
            className="mpc-btn zoom-btn rst"
            disabled={!hasAudio}
            onClick={() => { setZoom(1); setViewStart(0); }}
            title="Restablecer vista completa (100%)"
          >
            100%
          </button>
          <button
            type="button"
            className="mpc-btn zoom-focus-btn"
            disabled={!selectedChop}
            onClick={() => selectedChop && zoomToChop(selectedChop)}
            title="Enfocar en el corte seleccionado"
          >
            ⊙ Enfocar
          </button>
        </div>
      </div>

      {/* Pantalla LCD de la Onda */}
      <div className="mpc-screen">
        <div
          className="screen-canvas-wrap"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (onBatchDrop) onBatchDrop(e);
          }}
        >
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          <canvas ref={playheadCanvasRef} className="playhead-overlay" />

          {/* Hero State táctil cuando no hay audio cargado */}
          {!hasAudio && (
            <div
              className="waveform-hero-empty"
              onClick={onTriggerLoadAudio}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onTriggerLoadAudio?.();
              }}
              title="Haz clic o arrastra un archivo de audio para comenzar a cortar"
            >
              <div className="hero-oscilloscope-grid" />
              <div className="waveform-hero-content">
                <div className="hero-wave-icon">
                  <svg viewBox="0 0 160 36" className="hero-wave-svg" fill="none">
                    <path
                      d="M 4 18 Q 20 18, 30 18 T 42 7 T 50 29 T 58 4 T 66 32 T 74 12 T 80 24 T 88 1 T 96 35 T 104 14 T 112 22 T 120 9 T 128 27 T 138 18 L 156 18"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <div className="waveform-hero-title">ARRASTRA TU SAMPLE AQUÍ</div>
                <div className="waveform-hero-sub">
                  WAV · MP3 · FLAC · OGG · AIFF · 32-bit Float
                </div>
                <button
                  type="button"
                  className="waveform-hero-cta"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onTriggerLoadAudio) onTriggerLoadAudio();
                  }}
                >
                  <span className="hero-cta-icon">📂</span> Explorar y Cargar Audio
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Barra de Progreso y Tiempo Serato */}
        <div className="duration-bar">
          <span ref={currentTimeLabelRef} className="duration-current">0:00.00</span>
          <div className="duration-track">
            <div ref={durationFillRef} className="duration-fill" />
          </div>
          <span ref={totalTimeLabelRef} className="duration-total">{formatTime(audioDuration || 0)}</span>
        </div>

        {/* Mini Analizador de Espectro Integrado */}
        <div className="spectrum-integrated-wrap">
          <canvas
            ref={spectrumCanvasRef}
            className="spectrum-integrated-canvas"
          />
        </div>
      </div>
    </div>
  );
}

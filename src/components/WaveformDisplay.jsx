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
}) {
  return (
    <div className="left-card">
      <div className="card-title-row">
        <span className="card-title">Waveform Display</span>
        <span style={{ fontSize: 9.5, color: 'var(--accent)' }}>
          {selectedChop
            ? `● ${selectedChop.name} (${formatTime(selectedChop.end - selectedChop.start)})`
            : 'Arrastra sobre la onda para cortar'}
        </span>
      </div>

      <div className="mpc-screen">
        <div className="screen-top">
          <span>{selectedChop ? selectedChop.name : 'VISTA GENERAL'}</span>
          <span>{formatTime(audioDuration || 0)}</span>
        </div>

        <div className="screen-canvas-wrap">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          <canvas ref={playheadCanvasRef} className="playhead-overlay" />
        </div>

        <div className="duration-bar">
          <span ref={currentTimeLabelRef} className="duration-current">0:00.00</span>
          <div className="duration-track">
            <div ref={durationFillRef} className="duration-fill" />
          </div>
          <span ref={totalTimeLabelRef} className="duration-total">0:00.00</span>
        </div>

        <div className="screen-bottom">
          <span>{chopsCount} cortes creados</span>
          <span>Zoom: {Math.round(zoom * 100)}%</span>
        </div>
      </div>

      {/* Controles de Zoom */}
      <div className="zoom-strip">
        <div className="zoom-steppers">
          <button
            type="button"
            className="mpc-btn zoom-btn"
            onClick={() => setZoom((z) => Math.max(1, z / 1.5))}
            title="Alejar zoom (-)"
          >
            −
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="mpc-btn zoom-btn"
            onClick={() => setZoom((z) => Math.min(20, z * 1.5))}
            title="Acercar zoom (+)"
          >
            +
          </button>
          <button
            type="button"
            className="mpc-btn zoom-btn rst"
            onClick={() => { setZoom(1); setViewStart(0); }}
            title="Restablecer zoom a vista completa (100%)"
          >
            100%
          </button>
        </div>
        <button
          type="button"
          className="mpc-btn zoom-focus-btn"
          disabled={!selectedChop}
          onClick={() => selectedChop && zoomToChop(selectedChop)}
          title="Enfocar forma de onda en el corte seleccionado"
        >
          ⊙ Enfocar corte
        </button>
      </div>

      {/* Mini Analizador de Espectro integrado */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 7.5, color: 'var(--muted)', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 4 }}>
          Espectro en tiempo real
        </div>
        <canvas
          ref={spectrumCanvasRef}
          style={{ display: 'block', width: '100%', height: 40, borderRadius: 4, background: '#05100a' }}
        />
      </div>
    </div>
  );
}

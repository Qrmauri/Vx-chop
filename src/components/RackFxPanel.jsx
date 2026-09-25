import React from 'react';

/**
 * RackFxPanel - Módulo de Efectos Analógicos Vintage estilo Rack 19"
 *
 * Incluye:
 * 1. Emulador de Vinilo & Cassette (SP-404 / RC-20): Crackle, Hiss, Wow & Flutter
 * 2. Compresor Sidechain ("Ducking"): Bombeo automático sobre chops con los bombos
 * 3. Chorus Analógico Roland Juno-60: Espacialidad estéreo BBD con modos I, II y I+II
 */
export default function RackFxPanel({ audio, onClose }) {
  const {
    vinylCrackle,
    setVinylCrackle,
    wowFlutter,
    setWowFlutter,
    tapeHiss,
    setTapeHiss,
    sidechainEnabled,
    setSidechainEnabled,
    sidechainDepth,
    setSidechainDepth,
    sidechainRelease,
    setSidechainRelease,
    triggerSidechainKick,
    chorusMode,
    setChorusMode,
  } = audio;

  const handleTestDuck = () => {
    if (triggerSidechainKick) {
      triggerSidechainKick();
      audio.setStatus?.('💥 Sidechain Ducking probado.');
    }
  };

  return (
    <div className="rack-fx-container" role="region" aria-label="Efectos Analógicos Rack FX">
      {/* Cabecera del Rack 19" con tornillos y medidor */}
      <div className="rack-fx-header">
        <div className="rack-screw rack-screw-tl" />
        <div className="rack-screw rack-screw-tr" />
        <div className="rack-fx-title-group">
          <div className="rack-led-power" />
          <span className="rack-main-title">ANALOG VINTAGE RACK FX</span>
          <span className="rack-subtitle">EMULACIÓN SP-404 · RC-20 · SIDECHAIN DUCKER · JUNO-60 BBD</span>
        </div>
        {onClose && (
          <button
            type="button"
            className="rack-close-btn"
            onClick={onClose}
            title="Cerrar Rack FX"
          >
            ✕
          </button>
        )}
      </div>

      <div className="rack-fx-modules">
        {/* ── MÓDULO 1: VINILO & CASSETTE ── */}
        <div className="rack-module module-tape-vinyl">
          <div className="module-header">
            <span className="module-title">📼 VINYL & CASSETTE (RC-20 / SP-404)</span>
            <span className={`module-badge ${(vinylCrackle > 0 || tapeHiss > 0 || wowFlutter > 0) ? 'active' : ''}`}>
              {(vinylCrackle > 0 || tapeHiss > 0 || wowFlutter > 0) ? 'ACTIVO' : 'BYPASS'}
            </span>
          </div>

          <div className="module-controls">
            {/* Crackle */}
            <div className="rack-ctrl-col">
              <label className="rack-ctrl-label" htmlFor="ctrl-crackle">CRACKLE</label>
              <div className="rack-val-pill">{vinylCrackle}%</div>
              <input
                id="ctrl-crackle"
                type="range"
                min="0"
                max="100"
                step="1"
                className="rack-slider"
                value={vinylCrackle}
                onChange={(e) => setVinylCrackle(Number(e.target.value))}
                title="Chasquidos de aguja y microsurcos de vinilo"
              />
              <span className="rack-ctrl-hint">Aguja</span>
            </div>

            {/* Tape Hiss */}
            <div className="rack-ctrl-col">
              <label className="rack-ctrl-label" htmlFor="ctrl-hiss">TAPE HISS</label>
              <div className="rack-val-pill">{tapeHiss}%</div>
              <input
                id="ctrl-hiss"
                type="range"
                min="0"
                max="100"
                step="1"
                className="rack-slider"
                value={tapeHiss}
                onChange={(e) => setTapeHiss(Number(e.target.value))}
                title="Siseo y ruido de fondo de cinta magnética tipo cassette"
              />
              <span className="rack-ctrl-hint">Cinta</span>
            </div>

            {/* Wow & Flutter */}
            <div className="rack-ctrl-col">
              <label className="rack-ctrl-label" htmlFor="ctrl-wow">WOW & FLUTTER</label>
              <div className="rack-val-pill">{wowFlutter}%</div>
              <input
                id="ctrl-wow"
                type="range"
                min="0"
                max="100"
                step="1"
                className="rack-slider"
                value={wowFlutter}
                onChange={(e) => setWowFlutter(Number(e.target.value))}
                title="Micro-variaciones de tono por correa desgastada (0.5Hz Wow + 6Hz Flutter)"
              />
              <span className="rack-ctrl-hint">Correa</span>
            </div>
          </div>
        </div>

        {/* ── MÓDULO 2: COMPRESOR SIDECHAIN DUCKER ── */}
        <div className="rack-module module-sidechain">
          <div className="module-header">
            <span className="module-title">🥁 SIDECHAIN COMPRESSOR (DUCKING)</span>
            <button
              type="button"
              className={`module-switch-btn ${sidechainEnabled ? 'enabled' : ''}`}
              onClick={() => setSidechainEnabled((v) => !v)}
              title="Activar/desactivar efecto de bombeo (ducking) con el bombo"
            >
              <span className="switch-led" />
              {sidechainEnabled ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="module-controls">
            {/* Profundidad (Ducking Depth) */}
            <div className="rack-ctrl-col">
              <label className="rack-ctrl-label" htmlFor="ctrl-sc-depth">DEPTH</label>
              <div className="rack-val-pill">{Math.round(sidechainDepth * 100)}%</div>
              <input
                id="ctrl-sc-depth"
                type="range"
                min="0.1"
                max="0.95"
                step="0.05"
                className="rack-slider"
                value={sidechainDepth}
                disabled={!sidechainEnabled}
                onChange={(e) => setSidechainDepth(Number(e.target.value))}
                title="Cuánto baja el volumen del chop al recibir el golpe de bombo"
              />
              <span className="rack-ctrl-hint">Atenuación</span>
            </div>

            {/* Tiempo de Recuperación (Release) */}
            <div className="rack-ctrl-col">
              <label className="rack-ctrl-label" htmlFor="ctrl-sc-release">RELEASE</label>
              <div className="rack-val-pill">{sidechainRelease} ms</div>
              <input
                id="ctrl-sc-release"
                type="range"
                min="50"
                max="500"
                step="10"
                className="rack-slider"
                value={sidechainRelease}
                disabled={!sidechainEnabled}
                onChange={(e) => setSidechainRelease(Number(e.target.value))}
                title="Velocidad con la que el sonido vuelve a su volumen normal"
              />
              <span className="rack-ctrl-hint">Recuperación</span>
            </div>

            {/* Botón de Test Manual */}
            <div className="rack-ctrl-col test-duck-col">
              <label className="rack-ctrl-label">DISPARO</label>
              <button
                type="button"
                className="rack-test-duck-btn"
                onClick={handleTestDuck}
                disabled={!sidechainEnabled}
                title="Prueba manual del ducking sin necesidad de reproducir el secuenciador"
              >
                💥 PROBAR DUCK
              </button>
              <span className="rack-ctrl-hint">Auto con Kick</span>
            </div>
          </div>
        </div>

        {/* ── MÓDULO 3: JUNO-60 ANALOG CHORUS ── */}
        <div className="rack-module module-juno">
          <div className="module-header">
            <span className="module-title">🎹 JUNO-60 STEREO CHORUS (BBD)</span>
            <span className={`module-badge ${chorusMode !== 'off' ? 'active' : ''}`}>
              {chorusMode !== 'off' ? `MODO ${chorusMode}` : 'BYPASS'}
            </span>
          </div>

          <div className="juno-buttons-row">
            <button
              type="button"
              className={`juno-btn ${chorusMode === 'off' ? 'active' : ''}`}
              onClick={() => setChorusMode('off')}
              title="Chorus apagado (señal directa estéreo)"
            >
              <span className="juno-btn-top">OFF</span>
              <span className="juno-btn-lamp" />
            </button>

            <button
              type="button"
              className={`juno-btn ${chorusMode === 'I' ? 'active' : ''}`}
              onClick={() => setChorusMode('I')}
              title="Modo I: Chorus sutil a 0.5Hz, ideal para pads y guitarras cálidas"
            >
              <span className="juno-btn-top">MODO I</span>
              <span className="juno-btn-lamp" />
            </button>

            <button
              type="button"
              className={`juno-btn ${chorusMode === 'II' ? 'active' : ''}`}
              onClick={() => setChorusMode('II')}
              title="Modo II: Modulación profunda a 0.86Hz con rica espacialidad estéreo"
            >
              <span className="juno-btn-top">MODO II</span>
              <span className="juno-btn-lamp" />
            </button>

            <button
              type="button"
              className={`juno-btn ${chorusMode === 'I+II' ? 'active' : ''}`}
              onClick={() => setChorusMode('I+II')}
              title="Modo I+II: El mítico efecto secreto Roland con vibrato estéreo rápido"
            >
              <span className="juno-btn-top">I + II</span>
              <span className="juno-btn-lamp" />
            </button>
          </div>

          <div className="juno-legend">
            Líneas de retardo en cuadratura (90° fase estéreo) · Emulación Bucket-Brigade MN3009
          </div>
        </div>
      </div>

      <div className="rack-screw rack-screw-bl" />
      <div className="rack-screw rack-screw-br" />
    </div>
  );
}

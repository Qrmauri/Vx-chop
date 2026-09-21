import React from 'react';

export default function QLinkPanel({ audio }) {
  const vintageMode = audio.vintageMode || 'modern';

  const selectVintageMode = (mode) => {
    audio.setVintageMode(mode);
    const names = {
      modern: 'MODERN STUDIO (24-bit / 44.1kHz Transparente)',
      mpc60: 'AKAI MPC-60 (12-bit / 40kHz Punchy)',
      sp1200: 'E-MU SP-1200 (12-bit / 26kHz Aliasing & SSM2044)',
    };
    audio.setStatus(`Motor DAC: ${names[mode] || mode}`);
  };

  return (
    <div className="qlink-container">
      {/* Barra de cabecera con selector de Motor Vintage DAC */}
      <div className="qlink-header-bar">
        <div className="qlink-title-group">
          <span className="qlink-main-title">Q-LINK MASTER & VINTAGE DAC</span>
          <span className="qlink-sub-tag">MODELADO ANALÓGICO EN TIEMPO REAL</span>
        </div>

        <div className="vintage-dac-selector" role="group" aria-label="Selector de Motor DAC Vintage">
          <button
            type="button"
            className={`vintage-btn ${vintageMode === 'modern' ? 'active-modern' : ''}`}
            onClick={() => selectVintageMode('modern')}
            title="Modo Moderno: 24-bit / 32-bit float puro, máxima fidelidad y dinámica"
          >
            <span className="v-led led-modern" />
            <span className="v-label">MODERN</span>
            <span className="v-spec">24b Clean</span>
          </button>

          <button
            type="button"
            className={`vintage-btn ${vintageMode === 'mpc60' ? 'active-mpc60' : ''}`}
            onClick={() => selectVintageMode('mpc60')}
            title="Akai MPC-60: Cuantización 12-bit lineal a 40kHz con medios gruesos y calidez de transformador"
          >
            <span className="v-led led-mpc60" />
            <span className="v-label">MPC-60</span>
            <span className="v-spec">12b · 40k</span>
          </button>

          <button
            type="button"
            className={`vintage-btn ${vintageMode === 'sp1200' ? 'active-sp1200' : ''}`}
            onClick={() => selectVintageMode('sp1200')}
            title="E-mu SP-1200: Frecuencia de 26.04kHz con aliasing crunch, 12-bit y emulación del filtro dinámico SSM2044"
          >
            <span className="v-led led-sp1200" />
            <span className="v-label">SP-1200</span>
            <span className="v-spec">12b · 26k</span>
          </button>
        </div>
      </div>

      {/* Tira de Perillas / Faders Q-Link */}
      <div className="qlink-strip">
        <div className="qlink-knob-box">
          <div className="qlink-label-row">
            <span className="qlink-label">Q1 CUTOFF</span>
            <span className="qlink-val">
              {audio.cutoff >= 1000 ? `${(audio.cutoff / 1000).toFixed(1)}k` : `${Math.round(audio.cutoff)}`} Hz
            </span>
          </div>
          <input
            type="range"
            min="40"
            max="20000"
            step="20"
            className="qlink-slider"
            value={audio.cutoff}
            onChange={(e) => audio.setCutoff(Number(e.target.value))}
            title="Filtro paso-bajo Cutoff: atenúa frecuencias agudas"
          />
        </div>

        <div className="qlink-knob-box">
          <div className="qlink-label-row">
            <span className="qlink-label">Q2 RESO</span>
            <span className="qlink-val">Q {audio.resonance.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="16"
            step="0.1"
            className="qlink-slider"
            value={audio.resonance}
            onChange={(e) => audio.setResonance(Number(e.target.value))}
            title="Resonancia del filtro analógico MPC"
          />
        </div>

        <div className="qlink-knob-box">
          <div className="qlink-label-row">
            <span className="qlink-label">Q3 TUNE</span>
            <span className="qlink-val">{audio.pitch > 0 ? `+${audio.pitch}` : audio.pitch} st</span>
          </div>
          <input
            type="range"
            min="-12"
            max="12"
            step="1"
            className="qlink-slider"
            value={audio.pitch}
            onChange={(e) => audio.setPitch(Number(e.target.value))}
            title="Afinación Pitch Master (semitonos de transporte)"
          />
        </div>

        <div className="qlink-knob-box">
          <div className="qlink-label-row">
            <span className="qlink-label">Q4 DECAY</span>
            <span className="qlink-val">{audio.decay.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min="0.2"
            max="2.0"
            step="0.1"
            className="qlink-slider"
            value={audio.decay}
            onChange={(e) => audio.setDecay(Number(e.target.value))}
            title="Envolvente Decay: acorta o alarga la caída de los chops"
          />
        </div>

        <div className="qlink-knob-box">
          <div className="qlink-label-row">
            <span className="qlink-label">Q5 DRIVE</span>
            <span className="qlink-val">{audio.drive}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            className="qlink-slider"
            value={audio.drive}
            onChange={(e) => audio.setDrive(Number(e.target.value))}
            title="Saturación analógica Tape Drive (calidez de cinta y pegada sin aspereza)"
          />
        </div>

        <div className="qlink-knob-box">
          <div className="qlink-label-row">
            <span className="qlink-label">Q6 VINYL</span>
            <span className="qlink-val">{audio.vinylCrackle || 0}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            className="qlink-slider"
            value={audio.vinylCrackle || 0}
            onChange={(e) => audio.setVinylCrackle(Number(e.target.value))}
            title="Simulador de Vinilo Analógico: Soplido de aguja, polvo y chasquidos (Crackle & Dust)"
          />
        </div>
      </div>
    </div>
  );
}

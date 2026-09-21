import React, { useEffect, useState } from 'react';

export default function MpcHeader({
  bpm,
  setBpm,
  handleTap,
  noteNameRef,
  noteCentsRef,
  selectedChop,
  vuFillRef,
  midi,
  vintageMode = 'modern',
  onCycleVintageMode,
  onOpenShortcuts,
}) {
  const [isTauri, setIsTauri] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
      setIsTauri(true);
    }
  }, []);

  const handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      getCurrentWindow().minimize();
    } catch (err) {
      console.warn('Tauri minimize error:', err);
    }
  };

  const handleToggleMaximize = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      getCurrentWindow().toggleMaximize();
    } catch (err) {
      console.warn('Tauri maximize error:', err);
    }
  };

  const handleClose = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      getCurrentWindow().close();
    } catch (err) {
      console.warn('Tauri close error:', err);
    }
  };

  return (
    <header className="mpc-header" data-tauri-drag-region>
      <div className="mpc-logo-group" data-tauri-drag-region>
        <div className="mpc-logo">VX-CHOP</div>
        <span className="mpc-logo-sub">MPC SAMPLER & SLICER</span>
      </div>

      <div className="header-sep" />

      {/* BPM & Tap */}
      <div className="header-item bpm-header-item">
        <div className="header-label">BPM</div>
        <div className="header-bpm-ctrl">
          <button
            className="bpm-step-btn"
            onClick={() => setBpm((b) => Math.max(30, (Number(b) || 90) - 1))}
            title="Disminuir tempo (-1 BPM)"
          >
            −
          </button>
          <input
            type="number"
            min="30"
            max="300"
            className="header-bpm-input"
            value={bpm}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!isNaN(val)) setBpm(Math.max(30, Math.min(300, val)));
              else if (e.target.value === '') setBpm('');
            }}
            onBlur={() => {
              if (!bpm || Number(bpm) < 30) setBpm(90);
            }}
            title="Escribe directamente el BPM deseado (30 a 300)"
          />
          <button
            className="bpm-step-btn"
            onClick={() => setBpm((b) => Math.min(300, (Number(b) || 90) + 1))}
            title="Aumentar tempo (+1 BPM)"
          >
            +
          </button>
        </div>
      </div>
      <button className="header-tap" onClick={handleTap} title="Tap Tempo: presiona al ritmo para calcular BPM">
        TAP
      </button>

      <div className="header-sep" />

      {/* Afinador / Detección de Nota */}
      <div className="header-item">
        <div className="header-label">Nota</div>
        <div className="header-value" ref={noteNameRef}>—</div>
      </div>
      <div className="header-item" style={{ minWidth: 42 }}>
        <div className="header-label">Cents</div>
        <div className="header-value dim" ref={noteCentsRef} />
      </div>

      <div className="header-sep hide-mobile" />

      {/* Chop Activo */}
      <div className="header-item hide-mobile" style={{ minWidth: 90 }}>
        <div className="header-label">Seleccionado</div>
        <div className="header-value dim" style={{ fontSize: 11 }}>
          {selectedChop ? selectedChop.name : '—'}
        </div>
      </div>

      <div className="header-sep hide-mobile" />

      {/* DAC Vintage Engine Selector Rápido */}
      <div className="header-item hide-mobile">
        <div className="header-label">DAC ENGINE</div>
        <button
          type="button"
          className={`header-vintage-badge mode-${vintageMode || 'modern'}`}
          onClick={onCycleVintageMode}
          title="Motor DAC Vintage: Clic para alternar entre Modern (24b) ➔ MPC-60 (12b 40k) ➔ SP-1200 (12b 26k)"
        >
          <span className="badge-led" />
          <span className="badge-text">
            {vintageMode === 'mpc60' ? 'MPC-60 12b' : vintageMode === 'sp1200' ? 'SP-1200 26k' : 'MODERN 24b'}
          </span>
        </button>
      </div>

      <div className="header-sep hide-mobile" />

      {/* Estado MIDI */}
      <div className="header-item hide-mobile">
        <div className="header-label">MIDI USB</div>
        <div
          className="header-value"
          style={{
            fontSize: 10,
            cursor: 'pointer',
            color: midi?.connected ? 'var(--accent)' : 'var(--muted)',
          }}
          onClick={() => midi?.connectMidi?.()}
          title={
            midi?.connected
              ? `Controlador conectado: ${midi.devices.map((d) => d.name).join(', ')}`
              : 'Haz clic para conectar o buscar controlador MIDI USB'
          }
        >
          {midi?.connected ? `● ${midi.devices[0]?.name?.slice(0, 10) || 'CONECTADO'}` : '○ DESCONECTADO'}
        </div>
      </div>

      {/* VU Meter Estéreo */}
      <div className="vu-header">
        <span style={{ fontSize: 8, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
          Master
        </span>
        <div className="vu-track-h">
          <div className="vu-fill-h" ref={vuFillRef} />
        </div>
      </div>

      {/* Botón de Atajos y Ayuda */}
      {onOpenShortcuts && (
        <button
          type="button"
          className="header-shortcuts-btn"
          onClick={onOpenShortcuts}
          title="Ver atajos de teclado y trucos de producción (o presiona ?)"
        >
          ⌨️ <span className="hide-mobile">Atajos</span>
        </button>
      )}

      {/* Controles de Ventana de Escritorio (Solo visibles en Tauri) */}
      {isTauri && (
        <div className="tauri-window-controls" style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
          <button
            className="mpc-btn small"
            style={{ padding: '2px 8px', fontSize: 11, background: 'var(--surface-2)' }}
            onClick={handleMinimize}
            title="Minimizar ventana"
          >
            —
          </button>
          <button
            className="mpc-btn small"
            style={{ padding: '2px 8px', fontSize: 11, background: 'var(--surface-2)' }}
            onClick={handleToggleMaximize}
            title="Maximizar / Restaurar"
          >
            □
          </button>
          <button
            className="mpc-btn small danger"
            style={{ padding: '2px 8px', fontSize: 11 }}
            onClick={handleClose}
            title="Cerrar aplicación"
          >
            ✕
          </button>
        </div>
      )}
    </header>
  );
}

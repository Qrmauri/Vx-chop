import React, { useEffect, useState } from 'react';
import {
  IconMusic,
  IconFolder,
  IconCross,
  IconPlus,
  IconSave,
  IconZip,
  IconDownload,
} from './Icons';

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
  fileInfo,
  onTriggerLoadAudio,
  audioBuffer,
  onRemoveSample,
  onNewProject,
  onSaveProject,
  onImportProject,
  onExportKitZip,
  isExportingKit,
  canExportKit,
  onExportWav,
  canExportWav,
  projectInputRef,
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

  const hasLoadedSample = Boolean(fileInfo && fileInfo !== 'Sin sample cargado');

  return (
    <header className="mpc-header" data-tauri-drag-region>
      {/* Logo & Marca */}
      <div className="mpc-logo-group" data-tauri-drag-region>
        <div className="mpc-logo">VX-CHOP</div>
        <span className="mpc-logo-sub">MODERN DAW SAMPLER</span>
      </div>

      <div className="header-sep" />

      {/* Pill de Carga de Audio Rápida */}
      <div className="header-sample-pill-wrap">
        <button
          type="button"
          className={`header-sample-pill ${hasLoadedSample ? 'has-sample' : 'empty'}`}
          onClick={onTriggerLoadAudio}
          title={hasLoadedSample ? `Sample activo: ${fileInfo}. Haz clic para cambiarlo.` : 'Haz clic para cargar un archivo de audio (WAV, MP3, OGG, FLAC)'}
        >
          <span className="pill-icon">{hasLoadedSample ? <IconMusic size={13} /> : <IconFolder size={13} />}</span>
          <span className="pill-text" title={fileInfo}>
            {hasLoadedSample ? fileInfo : 'Cargar Audio / Sample'}
          </span>
          <span className="pill-action-tag">{hasLoadedSample ? 'CAMBIAR' : 'ABRIR'}</span>
        </button>

        {hasLoadedSample && onRemoveSample && (
          <button
            type="button"
            className="header-sample-remove-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm('¿Deseas quitar y borrar el sample de audio actual?')) {
                onRemoveSample();
              }
            }}
            title="Quitar y descargar el sample actual"
          >
            <IconCross size={11} />
          </button>
        )}
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

      <div className="header-sep hide-mobile" />

      {/* Afinador / Detección de Nota */}
      <div className="header-item hide-mobile">
        <div className="header-label">Nota</div>
        <div className="header-value" ref={noteNameRef}>—</div>
      </div>
      <div className="header-item hide-mobile" style={{ minWidth: 42 }}>
        <div className="header-label">Cents</div>
        <div className="header-value dim" ref={noteCentsRef} />
      </div>

      <div className="header-sep hide-mobile" />

      {/* DAC Vintage Engine Selector */}
      <div className="header-item hide-mobile">
        <div className="header-label">DAC ENGINE</div>
        <button
          type="button"
          className={`header-vintage-badge mode-${vintageMode || 'modern'}`}
          onClick={onCycleVintageMode}
          title="Motor DAC Vintage: Alterna entre Modern (24b) ➔ MPC-60 (12b 40k) ➔ SP-1200 (12b 26k) ➔ S950 (12b 19k)"
        >
          <span className="badge-led" />
          <span className="badge-text">
            {vintageMode === 'mpc60'
              ? 'MPC-60 12b'
              : vintageMode === 'sp1200'
              ? 'SP-1200 26k'
              : vintageMode === 's950'
              ? 'S950 19k'
              : 'MODERN 24b'}
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
          {midi?.connected ? `● ${midi.devices[0]?.name?.slice(0, 10) || 'CONECTADO'}` : '○ MIDI OFF'}
        </div>
      </div>

      <div className="header-sep hide-mobile" />

      {/* Sesión & Exportación (DAW Toolbar) */}
      <div className="header-session-group hide-mobile">
        {onNewProject && (
          <button
            type="button"
            className="header-tool-btn"
            onClick={onNewProject}
            title="Nuevo proyecto vacío"
          >
            <IconPlus size={12} />
            <span>Nuevo</span>
          </button>
        )}
        {onSaveProject && (
          <button
            type="button"
            className="header-tool-btn"
            onClick={onSaveProject}
            title="Guardar sesión (.vxchop)"
          >
            <IconSave size={12} />
            <span>Guardar</span>
          </button>
        )}
        {onImportProject && (
          <label
            className="header-tool-btn"
            style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
            title="Cargar sesión (.vxchop o .json)"
          >
            <IconFolder size={12} />
            <span>Cargar</span>
            <input
              ref={projectInputRef}
              type="file"
              accept=".vxchop,.json"
              style={{ display: 'none' }}
              onChange={onImportProject}
            />
          </label>
        )}
        {onExportKitZip && (
          <button
            type="button"
            className="header-tool-btn kit-btn"
            disabled={!canExportKit || isExportingKit}
            onClick={onExportKitZip}
            title="Descargar ZIP con los WAVs independientes para cualquier DAW o MPC"
          >
            {isExportingKit ? '⏳' : <IconZip size={12} />}
            <span>Kit ZIP</span>
          </button>
        )}
        {onExportWav && (
          <button
            type="button"
            className="header-tool-btn accent"
            disabled={!canExportWav}
            onClick={onExportWav}
            title="Exportar mezcla completa en WAV"
          >
            <IconDownload size={12} />
            <span>WAV</span>
          </button>
        )}
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

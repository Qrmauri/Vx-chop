/**
 * Controles de transporte: play, stop, export y pitch slider.
 * @param {{
 *   chops: Array,
 *   buffer: AudioBuffer|null,
 *   pitch: number,
 *   onPlayAll: () => void,
 *   onStop: () => void,
 *   onExport: () => void,
 *   onPitchChange: (semitones: number) => void,
 * }} props
 */
export default function Transport({ chops, buffer, pitch, onPlayAll, onStop, onExport, onPitchChange }) {
  return (
    <div className="transport">
      <button className="btn" disabled={!chops.length} onClick={onPlayAll}>
        ▶ Reproducir todo
      </button>
      <button className="btn" disabled={!buffer} onClick={onStop}>
        ■ Stop
      </button>
      <button className="btn primary" disabled={!chops.length} onClick={onExport}>
        ⇩ Exportar WAV
      </button>

      <div className="pitch-block">
        <label>Pitch estilo vinilo</label>
        <div className="pitch-row">
          <input
            type="range"
            min="-12"
            max="12"
            value={pitch}
            onChange={(e) => onPitchChange(Number(e.target.value))}
          />
          <span className="pitch-value">
            {pitch > 0 ? '+' : ''}{pitch} st
          </span>
        </div>
      </div>
    </div>
  );
}

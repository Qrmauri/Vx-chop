/**
 * Panel de detección de nota musical.
 * @param {{ buffer: AudioBuffer|null, result: object|null, onDetect: () => void }} props
 */
export default function NoteDetector({ buffer, result, onDetect }) {
  return (
    <section className="panel note-panel">
      <div>
        <h2>Detector de notas</h2>
        <p className="note-help">Analiza el chop seleccionado o todo el sample.</p>
      </div>

      <button className="btn primary" disabled={!buffer} onClick={onDetect}>
        Detectar nota
      </button>

      {result ? (
        <div className="note-result">
          <strong>{result.note}</strong>
          <span>{result.frequency.toFixed(2)} Hz</span>
          <span className={Math.abs(result.cents) <= 5 ? 'in-tune' : ''}>
            {result.cents > 0 ? '+' : ''}{result.cents} cents
          </span>
        </div>
      ) : (
        <div className="note-empty">Sin análisis todavía</div>
      )}
    </section>
  );
}

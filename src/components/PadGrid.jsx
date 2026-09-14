const PAD_KEYS = ['1', '2', '3', '4', 'Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V'];

/**
 * Grid de pads que dispara chops con clic o teclado.
 * @param {{
 *   chops: Array,
 *   selectedId: string|null,
 *   onSelect: (id: string) => void,
 *   onPlay: (chop: object) => void,
 * }} props
 */
export default function PadGrid({ chops, selectedId, onSelect, onPlay }) {
  if (!chops.length) {
    return (
      <div className="empty-hint">Los pads se llenan automáticamente con los cortes.</div>
    );
  }

  return (
    <div className="pad-grid">
      {chops.map((chop, index) => (
        <button
          key={chop.id}
          className={`pad ${selectedId === chop.id ? 'selected' : ''}`}
          style={{ '--pad-color': chop.color }}
          onClick={() => { onSelect(chop.id); onPlay(chop); }}
        >
          <span className="pad-key">{PAD_KEYS[index] ?? index + 1}</span>
          <span className="pad-name">{chop.name}</span>
        </button>
      ))}
    </div>
  );
}

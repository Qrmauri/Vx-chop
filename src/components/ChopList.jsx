import { formatTime } from '../utils/format.js';

/**
 * Lista de chops con nombre editable, tiempo y acciones.
 * @param {{
 *   chops: Array,
 *   selectedId: string|null,
 *   onSelect: (id: string) => void,
 *   onPlay: (chop: object) => void,
 *   onRemove: (id: string) => void,
 *   onRename: (id: string, name: string) => void,
 * }} props
 */
export default function ChopList({ chops, selectedId, onSelect, onPlay, onRemove, onRename }) {
  if (!chops.length) {
    return (
      <div className="empty-hint">
        Todavía no hay chops.<br />
        Carga un sample y dibuja una selección.
      </div>
    );
  }

  return (
    <ul className="chop-list">
      {chops.map((chop, index) => (
        <li
          key={chop.id}
          className={`chop-item ${selectedId === chop.id ? 'selected' : ''}`}
          onClick={() => onSelect(chop.id)}
        >
          <span className="chop-index">{index + 1}</span>
          <span className="chop-swatch" style={{ background: chop.color }} />
          <input
            className="chop-name"
            value={chop.name}
            onChange={(e) => onRename(chop.id, e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="chop-time">{formatTime(chop.end - chop.start)}</span>
          <span className="chop-actions">
            <button
              className="btn small icon"
              onClick={(e) => { e.stopPropagation(); onPlay(chop); }}
            >
              ▶
            </button>
            <button
              className="btn small icon danger"
              onClick={(e) => { e.stopPropagation(); onRemove(chop.id); }}
            >
              x
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

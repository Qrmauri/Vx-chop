/** Formatea segundos como M:SS.ss (ej. 1:23.45) */
export const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return '0:00.00';
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
};

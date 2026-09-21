/**
 * projectStorage.js
 * Funciones de exportación e importación del proyecto / sesión completa de VX-CHOP en formato JSON (.vxchop).
 */

/**
 * Exporta el estado actual de la sesión como un archivo descargable .vxchop
 */
export function exportProjectToJson({
  sampleName = 'Sin sample',
  bpm = 90,
  pitch = 0,
  playMode = 'mono',
  cutoff = 20000,
  resonance = 1.0,
  decay = 1.0,
  drive = 0,
  vintageMode = 'modern',
  chops = [],
  sequencerTracks = null,
}) {
  const projectData = {
    app: 'VX-CHOP MPC',
    version: '2.5',
    date: new Date().toISOString(),
    session: {
      sampleName,
      bpm,
      pitch,
      playMode,
      vintageMode,
      qlinks: {
        cutoff,
        resonance,
        decay,
        drive,
      },
      chops: (chops || []).filter(Boolean).map((c) => ({
        id: c.id,
        name: c.name,
        start: Number((c.start || 0).toFixed(4)),
        end: Number((c.end || 0).toFixed(4)),
        color: c.color,
        reverse: Boolean(c.reverse),
      })),
      sequencer: sequencerTracks ? {
        stepCount: sequencerTracks.stepCount,
        tracks: sequencerTracks.tracks,
      } : null,
    },
  };

  const jsonStr = JSON.stringify(projectData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const safeName = (sampleName || 'vxchop-project')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .toLowerCase();

  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeName}.vxchop`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Lee y valida un archivo .vxchop o .json seleccionado por el usuario
 */
export function importProjectFromJson(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No se seleccionó ningún archivo'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (!parsed || (!parsed.session && !parsed.chops)) {
          throw new Error('Formato de proyecto VX-CHOP no válido');
        }

        const session = parsed.session || parsed;
        const validChops = Array.isArray(session.chops)
          ? session.chops
              .filter((c) => c && typeof c.start === 'number' && typeof c.end === 'number' && c.end > c.start)
              .map((c, idx) => ({
                id: c.id || `chop-${Date.now()}-${idx}`,
                name: c.name || `Chop ${idx + 1}`,
                start: c.start,
                end: c.end,
                color: c.color || '#55d6be',
                reverse: Boolean(c.reverse),
              }))
          : [];

        resolve({
          sampleName: session.sampleName || 'Proyecto importado',
          bpm: typeof session.bpm === 'number' ? session.bpm : 90,
          pitch: typeof session.pitch === 'number' ? session.pitch : 0,
          playMode: session.playMode === 'poly' ? 'poly' : 'mono',
          vintageMode: ['modern', 'mpc60', 'sp1200'].includes(session.vintageMode) ? session.vintageMode : 'modern',
          qlinks: session.qlinks || {
            cutoff: 20000,
            resonance: 1.0,
            decay: 1.0,
            drive: 0,
          },
          chops: validChops,
          sequencer: session.sequencer || null,
        });
      } catch (err) {
        reject(new Error(`Error al leer archivo de proyecto: ${err.message}`));
      }
    };
    reader.onerror = () => reject(new Error('Error al leer el archivo'));
    reader.readAsText(file);
  });
}

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import AudioCapturer from './AudioCapturer.jsx';
import {
  CRATE_GENRES,
  CURATED_YOUTUBE_SAMPLES,
  SAMPLE_SEARCH_SUGGESTIONS,
} from '../utils/sampleCrates.js';

/**
 * Extrae el ID de un video de YouTube desde URLs completas, acortadas o IDs directos.
 */
export function extractYouTubeId(urlOrId) {
  if (!urlOrId) return null;
  const str = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) {
    return str;
  }
  const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
  const match = str.match(regExp);
  return match ? match[1] : null;
}

export default function YouTubePlayer({
  onTimeUpdate,
  onPlayerReady,
  onLoadIntoMpc,
  onAudioCaptured,
  isLiveChopActive,
  onToggleLiveChop,
  onRandomJump,
  activeVideoId = '40JmEj0_aVM', // Bob James - Angela (Theme from Taxi) - 100% embeddable
}) {
  const [inputUrl, setInputUrl] = useState('');
  const [currentVideoId, setCurrentVideoId] = useState(activeVideoId);
  const [videoTitle, setVideoTitle] = useState('Bob James - Angela (Theme from Taxi)');
  const [isPlaying, setIsPlaying] = useState(false);
  const [showVideoFrame, setShowVideoFrame] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [hasEmbedError, setHasEmbedError] = useState(false);

  // ── Empaquetado de YouTube (Colapsado / Expandido) ──────────────────────────
  const [isCollapsed, setIsCollapsed] = useState(true);

  // ── Estados de Búsqueda Avanzada y Crate Digging ───────────────────────────
  const [selectedGenre, setSelectedGenre] = useState('all');
  const [showCrateRack, setShowCrateRack] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchFeedback, setSearchFeedback] = useState('');
  const [showResultsDrawer, setShowResultsDrawer] = useState(false);

  const playerRef = useRef(null);
  const containerIdRef = useRef(`yt-iframe-${Math.random().toString(36).substring(2, 9)}`);
  const timePollerRef = useRef(null);

  // Filtrar muestras según el género seleccionado
  const filteredCrate = useMemo(() => {
    if (selectedGenre === 'all') return CURATED_YOUTUBE_SAMPLES;
    return CURATED_YOUTUBE_SAMPLES.filter((s) => s.genre === selectedGenre);
  }, [selectedGenre]);

  // Inicializar YouTube IFrame API
  useEffect(() => {
    let isMounted = true;
    setHasEmbedError(false);

    const initPlayer = () => {
      if (!window.YT || !window.YT.Player) return;
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch {}
      }

      playerRef.current = new window.YT.Player(containerIdRef.current, {
        height: '100%',
        width: '100%',
        videoId: currentVideoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: (e) => {
            if (!isMounted) return;
            try {
              const d = e.target.getDuration();
              setDuration(d || 0);
              const data = e.target.getVideoData();
              if (data && data.title) setVideoTitle(data.title);
            } catch {}
            if (onPlayerReady) onPlayerReady(e.target);
          },
          onStateChange: (e) => {
            if (!isMounted) return;
            const playing = e.data === 1;
            setIsPlaying(playing);
            if (playing) {
              try {
                const d = e.target.getDuration();
                if (d) setDuration(d);
                const data = e.target.getVideoData();
                if (data && data.title) setVideoTitle(data.title);
              } catch {}
            }
          },
          onError: (e) => {
            if (!isMounted) return;
            console.warn('[YouTube API] Error en el reproductor:', e.data);
            setHasEmbedError(true);
          },
        },
      });
    };

    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

      const prevOnReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (prevOnReady) prevOnReady();
        if (isMounted) initPlayer();
      };
    } else {
      initPlayer();
    }

    return () => {
      isMounted = false;
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
    };
  }, [currentVideoId]);

  // Polling continuo de tiempo mientras reproduce
  useEffect(() => {
    if (isPlaying) {
      timePollerRef.current = setInterval(() => {
        if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
          try {
            const t = playerRef.current.getCurrentTime();
            setCurrentTime(t);
            if (onTimeUpdate) onTimeUpdate(t);
          } catch {}
        }
      }, 100);
    } else {
      if (timePollerRef.current) clearInterval(timePollerRef.current);
    }
    return () => {
      if (timePollerRef.current) clearInterval(timePollerRef.current);
    };
  }, [isPlaying, onTimeUpdate]);

  // Cargar una muestra seleccionada del cajón o resultados
  const handleSelectSample = (sample) => {
    setCurrentVideoId(sample.id);
    setVideoTitle(sample.title);
    setShowResultsDrawer(false);
    setShowCrateRack(false);
    setInputUrl('');
    setHasEmbedError(false);
  };

  // Buscar en el catálogo local y en YouTube Online vía server.py
  const handleSearchOrLoad = async (overrideQuery = null) => {
    const query = (overrideQuery !== null ? overrideQuery : inputUrl).trim();
    if (!query) return;

    // 1. Si es URL o ID directo de YouTube, cargar al instante
    const directId = extractYouTubeId(query);
    if (directId) {
      setCurrentVideoId(directId);
      setVideoTitle(`Cargando video (${directId})...`);
      setInputUrl('');
      setShowResultsDrawer(false);
      setHasEmbedError(false);
      return;
    }

    // 2. Búsqueda profunda: Catálogo local + Endpoint de YouTube
    setIsSearching(true);
    setShowResultsDrawer(true);
    setSearchFeedback(`Buscando gemas para "${query}"...`);

    let combinedResults = [];

    // A. Filtrar en catálogo curado interno
    const qLower = query.toLowerCase();
    const curatedMatches = CURATED_YOUTUBE_SAMPLES.filter(
      (s) =>
        s.title.toLowerCase().includes(qLower) ||
        s.artist.toLowerCase().includes(qLower) ||
        s.vibe.toLowerCase().includes(qLower) ||
        s.genreLabel.toLowerCase().includes(qLower)
    ).map((s) => ({ ...s, source: 'curated' }));
    combinedResults.push(...curatedMatches);

    // B. Intentar consultar endpoint online de YouTube (/api/yt-search de server.py)
    try {
      const resp = await fetch(`/api/yt-search?q=${encodeURIComponent(query)}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.results && Array.isArray(data.results)) {
          const onlineResults = data.results.map((r) => ({
            id: r.id,
            title: r.title,
            artist: r.uploader || 'YouTube Artist',
            genreLabel: 'YouTube Online',
            vibe: `Duración: ${r.duration || 'N/A'}`,
            source: 'online',
          }));
          const existingIds = new Set(combinedResults.map((r) => r.id));
          const uniqueOnline = onlineResults.filter((r) => !existingIds.has(r.id));
          combinedResults = [...combinedResults, ...uniqueOnline];
        }
      }
    } catch {
      // Si el servidor python no está corriendo, funciona con el catálogo curado
    } finally {
      setIsSearching(false);
      setSearchResults(combinedResults);
      if (combinedResults.length === 0) {
        setSearchFeedback(`No se encontraron resultados para "${query}". Prueba con otra palabra clave.`);
      } else {
        setSearchFeedback(`${combinedResults.length} gemas encontradas para samplear:`);
      }
    }
  };

  // Crate Digging aleatorio con filtro de género
  const handleRandomCrate = () => {
    const pool = filteredCrate.filter((s) => s.id !== currentVideoId);
    const chosen = pool[Math.floor(Math.random() * pool.length)] || filteredCrate[0];
    if (!chosen) return;
    setCurrentVideoId(chosen.id);
    setVideoTitle(chosen.title);
    setInputUrl('');
    setHasEmbedError(false);
  };

  const handlePlayToggle = () => {
    if (!playerRef.current) return;
    try {
      if (isPlaying) playerRef.current.pauseVideo();
      else playerRef.current.playVideo();
    } catch {}
  };

  const handleJump = () => {
    if (!playerRef.current || !duration) return;
    try {
      const randomSec = Math.max(0, Math.random() * (duration * 0.85));
      playerRef.current.seekTo(randomSec, true);
      playerRef.current.playVideo();
      if (onRandomJump) onRandomJump(randomSec);
    } catch {}
  };

  const handleMpcRip = async () => {
    if (!currentVideoId || !onLoadIntoMpc) return;
    setIsLoadingAudio(true);
    try {
      await onLoadIntoMpc(currentVideoId, videoTitle);
    } finally {
      setIsLoadingAudio(false);
    }
  };

  const formatSec = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // MODO EMPAQUETADO: Barra compacta de hardware rack (solo 36px de alto)
  // ══════════════════════════════════════════════════════════════════════════════
  if (isCollapsed) {
    return (
      <div className="yt-docked-bar">
        {/* Iframe oculto en background para mantener vivo el audio / Live Tap */}
        <div className="yt-hidden-player-host" style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}>
          <div id={containerIdRef.current} />
        </div>

        <div className="yt-docked-left">
          <div className="yt-docked-badge">
            <span className={`yt-mini-led ${isPlaying ? 'playing' : ''}`} />
            <span>YOUTUBE DIGGER</span>
          </div>

          <div className="yt-docked-track" title={videoTitle}>
            <span className="yt-dock-vinyl">💿</span>
            <span className="yt-dock-name">{videoTitle}</span>
            <span className="yt-dock-time">
              {formatSec(currentTime)} / {formatSec(duration)}
            </span>
          </div>
        </div>

        <div className="yt-docked-right">
          <button
            type="button"
            className={`mpc-btn small ${isPlaying ? 'accent playing-pulse' : ''}`}
            onClick={handlePlayToggle}
            title={isPlaying ? 'Pausar reproducción' : 'Reproducir video'}
          >
            {isPlaying ? '■ Pausa' : '▶ Play'}
          </button>

          <button
            type="button"
            className="mpc-btn small"
            onClick={handleJump}
            title="Soltar la aguja al azar en el tema"
          >
            🎯 Jump
          </button>

          <button
            type="button"
            className={`mpc-btn small live-tap-btn ${isLiveChopActive ? 'active-red-pulse' : ''}`}
            onClick={onToggleLiveChop}
            title="Capturar corte al compás al pulsar pads vacíos"
          >
            <span className="live-tap-led" />
            {isLiveChopActive ? '● REC' : '🔴 LIVE TAP'}
          </button>

          <button
            type="button"
            className="mpc-btn small hybrid-load-btn"
            onClick={handleMpcRip}
            disabled={isLoadingAudio}
            title="Extraer y transferir audio a la forma de onda de la MPC"
          >
            {isLoadingAudio ? '⏳...' : '⚡ Cargar en MPC'}
          </button>

          <button
            type="button"
            className="mpc-btn small expand-toggle-btn"
            onClick={() => setIsCollapsed(false)}
            title="Desplegar buscador, vinilos por género y video completo"
          >
            ▾ ABRIR CAJÓN
          </button>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // MODO EXPANDIDO: Inspector de Crate Digging y Búsqueda Completa
  // ══════════════════════════════════════════════════════════════════════════════
  return (
    <div className="youtube-sampler-panel">
      {/* ── Cabecera con botón de empaquetar ─────────────────────────────────── */}
      <div className="yt-header-bar">
        <div className="yt-brand">
          <span className="yt-badge">CRATE DIGGER & YOUTUBE</span>
          <span className="yt-sub">BÚSQUEDA DE VINILOS Y SAMPLEO AL VUELO</span>
        </div>
        <button
          type="button"
          className="mpc-btn small empaquetar-btn"
          onClick={() => setIsCollapsed(true)}
          title="Empaquetar YouTube en una barra delgada para ganar espacio en la forma de onda"
        >
          ▴ EMPAQUETAR YOUTUBE
        </button>
      </div>

      {/* ── Pestañas de Géneros de Vinilo ───────────────────────────────────── */}
      <div className="yt-genre-tabs">
        <span className="yt-genre-label">GÉNEROS:</span>
        <div className="yt-genre-list">
          {CRATE_GENRES.map((g) => (
            <button
              key={g.id}
              className={`yt-genre-pill ${selectedGenre === g.id ? 'active' : ''}`}
              onClick={() => {
                setSelectedGenre(g.id);
                setShowCrateRack(true);
              }}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Barra de Búsqueda y Crate Digging ───────────────────────────────── */}
      <div className="yt-search-bar">
        <div className="yt-crate-badge">
          <span className="crate-icon">▶</span>
          <span>CRATE DIGGER</span>
        </div>
        <input
          type="text"
          className="yt-input"
          placeholder="Busca gemas (ej: rare soul, soul jazz, ambient, cortex) o pega enlace..."
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearchOrLoad()}
        />
        <button
          className="mpc-btn small accent"
          onClick={() => handleSearchOrLoad()}
          disabled={isSearching}
          title="Buscar en el catálogo y en YouTube"
        >
          {isSearching ? '⏳ Buscando...' : '🔍 Buscar'}
        </button>
        <button
          className="mpc-btn small random-sample-btn"
          onClick={handleRandomCrate}
          title={`🎲 Cargar una gema sorpresa al azar de ${CRATE_GENRES.find((g) => g.id === selectedGenre)?.label}`}
        >
          🎲 Digging Al Azar
        </button>
        <button
          className={`mpc-btn small crate-toggle-btn ${showCrateRack ? 'active-amber' : ''}`}
          onClick={() => setShowCrateRack((v) => !v)}
          title="Abrir estante de vinilos para ver todas las canciones del género"
        >
          🗃️ Cajón ({filteredCrate.length})
        </button>
      </div>

      {/* ── Etiquetas de Sugerencias Rápidas ─────────────────────────────────── */}
      <div className="yt-quick-tags-bar">
        <span className="yt-quick-label">SUGERENCIAS:</span>
        <div className="yt-quick-tags">
          {SAMPLE_SEARCH_SUGGESTIONS.slice(0, 5).map((sug, i) => (
            <button
              key={i}
              className="yt-quick-tag-btn"
              onClick={() => {
                setInputUrl(sug);
                handleSearchOrLoad(sug);
              }}
            >
              #{sug}
            </button>
          ))}
        </div>
      </div>

      {/* ── Cajón Visual de Vinilos (Desplegable) ─────────────────────────────── */}
      {showCrateRack && (
        <div className="yt-crate-rack">
          <div className="yt-rack-header">
            <span>VINILOS EN "{CRATE_GENRES.find((g) => g.id === selectedGenre)?.label}":</span>
            <button className="yt-rack-close" onClick={() => setShowCrateRack(false)}>✕ Cerrar</button>
          </div>
          <div className="yt-rack-list">
            {filteredCrate.map((track) => (
              <div
                key={track.id}
                className={`yt-rack-item ${currentVideoId === track.id ? 'active-track' : ''}`}
                onClick={() => handleSelectSample(track)}
              >
                <div className="yt-vinyl-icon">💿</div>
                <div className="yt-rack-info">
                  <div className="yt-rack-title">{track.title}</div>
                  <div className="yt-rack-vibe">
                    <span className="yt-vibe-badge">{track.genreLabel}</span>
                    <span className="yt-vibe-text">{track.vibe}</span>
                  </div>
                </div>
                <button className="mpc-btn small" onClick={(e) => { e.stopPropagation(); handleSelectSample(track); }}>
                  ▶ Cargar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Panel de Resultados de Búsqueda (Desplegable) ─────────────────────── */}
      {showResultsDrawer && (
        <div className="yt-search-results-drawer">
          <div className="yt-results-header">
            <span className="yt-results-title">{searchFeedback}</span>
            <button className="yt-rack-close" onClick={() => setShowResultsDrawer(false)}>✕ Cerrar</button>
          </div>
          <div className="yt-results-list">
            {searchResults.map((item) => (
              <div
                key={item.id}
                className="yt-result-card"
                onClick={() => handleSelectSample(item)}
              >
                <div className="yt-result-badge">{item.source === 'curated' ? '💎 JOYA CURADA' : '🌐 YOUTUBE'}</div>
                <div className="yt-result-title">{item.title}</div>
                <div className="yt-result-meta">{item.artist} · {item.vibe}</div>
                <button
                  className="mpc-btn small accent"
                  onClick={(e) => { e.stopPropagation(); handleSelectSample(item); }}
                >
                  ▶ Samplear
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Contenedor del Reproductor y Metadata ────────────────────────────── */}
      <div className="yt-player-body">
        <div className={`yt-video-wrap ${showVideoFrame ? 'visible' : 'hidden'}`}>
          <div id={containerIdRef.current} className="yt-iframe-el" />

          {/* Overlay amigable si YouTube bloquea la reproducción en iframe */}
          {hasEmbedError && (
            <div className="yt-embed-error-overlay">
              <div className="yt-error-badge">⚠️ Incrustación Restringida</div>
              <div className="yt-error-text">
                YouTube bloqueó el reproductor de video para esta pista por copyright.
              </div>
              <div className="yt-error-actions">
                <button
                  className="mpc-btn small accent"
                  onClick={handleMpcRip}
                  disabled={isLoadingAudio}
                  title="Descarga el stream de audio directo sin depender del iframe"
                >
                  {isLoadingAudio ? '⏳ Extrayendo...' : '⚡ Extraer Audio Directo (yt-dlp)'}
                </button>
                <button className="mpc-btn small" onClick={handleRandomCrate} title="Cargar otra pista del catálogo">
                  🎲 Probar Otra Gema
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Panel de Controles y Acciones Híbridas */}
        <div className="yt-controls-col">
          <div className="yt-meta-row">
            <span className="yt-title" title={videoTitle}>{videoTitle}</span>
            <span className="yt-timestamp">
              {formatSec(currentTime)} / {formatSec(duration)}
            </span>
          </div>

          <div className="yt-actions-row">
            <button
              className={`mpc-btn small ${isPlaying ? 'accent playing-pulse' : ''}`}
              onClick={handlePlayToggle}
              title={isPlaying ? 'Pausar video' : 'Reproducir video'}
            >
              {isPlaying ? '■ Pausar' : '▶ Play'}
            </button>

            <button
              className="mpc-btn small"
              onClick={handleJump}
              title="JUMP: Salto de aguja aleatorio en el video"
            >
              🎯 JUMP / DIG
            </button>

            <button
              className={`mpc-btn small live-tap-btn ${isLiveChopActive ? 'active-red-pulse' : ''}`}
              onClick={onToggleLiveChop}
              title="Modo Live Tap: Al tocar pads vacíos mientras suena YouTube, captura el corte al vuelo"
            >
              <span className="live-tap-led" />
              {isLiveChopActive ? '● REC CHOP' : '🔴 LIVE TAP'}
            </button>

            <button
              className="mpc-btn small"
              onClick={() => setShowVideoFrame((v) => !v)}
              title="Mostrar u ocultar marco del video"
            >
              {showVideoFrame ? '👁 Ocultar Video' : '👁 Ver Video'}
            </button>
          </div>

          {/* Botón Híbrido: Cargar en el Motor MPC */}
          <div className="yt-hybrid-strip">
            <button
              className="mpc-btn small hybrid-load-btn"
              onClick={handleMpcRip}
              disabled={isLoadingAudio}
              title="Transfiere el audio de YouTube directamente a la forma de onda (waveform) de la MPC para aplicar filtros, pitch shift y exportar en WAV"
            >
              {isLoadingAudio ? '⏳ Cargando en MPC...' : '⚡ Cargar en MPC (Onda & Filtros)'}
            </button>
            <span className="yt-hint">
              💡 Corta al vuelo con <strong>LIVE TAP</strong> o usa <strong>Cargar en MPC</strong> para transferir la onda.
            </span>
          </div>
        </div>
      </div>

      {/* Captador de Audio en Vivo (Pestaña / YouTube / Micrófono) */}
      <AudioCapturer
        onAudioCaptured={onAudioCaptured}
        onAutoPlayYouTube={() => {
          if (!isPlaying && playerRef.current && typeof playerRef.current.playVideo === 'function') {
            try { playerRef.current.playVideo(); } catch {}
          }
        }}
      />
    </div>
  );
}

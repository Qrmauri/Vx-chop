import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * AudioCapturer - Muestreador / Grabador de Audio en Vivo
 * Captura audio digital en tiempo real de YouTube / Pestañas del navegador o Micrófono / Interfaz,
 * y lo envía directamente como AudioBuffer a la MPC para cortar y afinar.
 */
export default function AudioCapturer({ onAudioCaptured, onAutoPlayYouTube }) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [sourceType, setSourceType] = useState('tab'); // 'tab' | 'mic'
  const [vuLevel, setVuLevel] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const rafIdRef = useRef(null);

  // Limpieza al desmontar
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  const updateVu = useCallback(() => {
    if (!analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    const avg = sum / data.length;
    // Escalar nivel para el vúmetro (0 a 100)
    const level = Math.min(100, Math.round((avg / 128) * 100));
    setVuLevel(level);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      rafIdRef.current = requestAnimationFrame(updateVu);
    }
  }, []);

  const startRecording = async (type = 'tab') => {
    setSourceType(type);
    setStatusMsg('');
    chunksRef.current = [];

    try {
      let stream = null;

      if (type === 'tab') {
        // Capturar audio digital de pestaña del navegador / YouTube
        if (!navigator.mediaDevices?.getDisplayMedia) {
          alert('Tu navegador no soporta captura de pestañas (getDisplayMedia). Usa Chrome, Edge o graba por Micrófono.');
          return;
        }

        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          systemAudio: 'include',
        });

        // Verificar que el usuario haya seleccionado compartir audio
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
          // Detener pistas de video
          stream.getTracks().forEach((t) => t.stop());
          alert(
            '⚠️ No se detectó audio:\n\n' +
            'Al elegir la ventana o pestaña en el navegador, asegúrate de marcar la casilla "Compartir audio de la pestaña".'
          );
          return;
        }

        // Apagar la pista de video inmediatamente para ahorrar memoria (solo necesitamos audio)
        stream.getVideoTracks().forEach((vt) => vt.stop());
      } else {
        // Capturar desde Micrófono o Entrada de Línea
        if (!navigator.mediaDevices?.getUserMedia) {
          alert('Tu navegador no soporta getUserMedia para micrófono.');
          return;
        }

        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      }

      streamRef.current = stream;

      // Si el stream se cierra externamente (ej: usuario presiona "Dejar de compartir" en la barra de Chrome)
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onended = () => {
          stopRecording();
        };
      }

      // Conectar analizador de VU en vivo
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContextClass();
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }
      audioContextRef.current = ctx;

      const audioStream = new MediaStream([audioTrack]);
      const sourceNode = ctx.createMediaStreamSource(audioStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      sourceNode.connect(analyser);
      analyserRef.current = analyser;

      // Configurar MediaRecorder únicamente con la pista de audio puro
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : (MediaRecorder.isTypeSupported('audio/ogg') ? 'audio/ogg' : '');
      }

      const recorder = mimeType
        ? new MediaRecorder(audioStream, { mimeType })
        : new MediaRecorder(audioStream);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
        setVuLevel(0);

        // Cerrar el contexto de audio del VU meter para evitar fugas de memoria
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(() => {});
          audioContextRef.current = null;
        }

        if (chunksRef.current.length === 0) {
          setIsRecording(false);
          return;
        }

        setStatusMsg('⏳ Procesando audio capturado...');
        try {
          const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          const decodeCtx = new AudioContextClass();
          const decoded = await decodeCtx.decodeAudioData(arrayBuffer);
          decodeCtx.close().catch(() => {});

          if (onAudioCaptured) {
            const title = type === 'tab' ? 'Muestra YouTube en Vivo' : 'Muestra Mic/Línea';
            onAudioCaptured(decoded, title);
          }
          setStatusMsg('¡Muestra grabada y cargada en la MPC!');
          setTimeout(() => setStatusMsg(''), 4000);
        } catch (err) {
          console.error('[AudioCapturer] Error al decodificar grabación:', err);
          setStatusMsg('Error al procesar audio grabado');
        } finally {
          setIsRecording(false);
          setRecordDuration(0);
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
          }
        }
      };

      recorder.start(100);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordDuration(0);

      // Si se proporcionó callback para reproducir YouTube, dispararlo
      if (onAutoPlayYouTube) {
        try { onAutoPlayYouTube(); } catch {}
      }

      // Contador de segundos
      const startTime = performance.now();
      timerRef.current = setInterval(() => {
        const elapsed = (performance.now() - startTime) / 1000;
        setRecordDuration(elapsed);
      }, 100);

      // Iniciar VU meter loop
      rafIdRef.current = requestAnimationFrame(updateVu);

    } catch (err) {
      console.warn('[AudioCapturer] Permiso denegado o error de captura:', err);
      if (err.name !== 'NotAllowedError') {
        alert('Error al acceder al audio: ' + err.message);
      }
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const formatTimer = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`;
  };

  return (
    <div className="audio-capturer-box">
      <div className="capturer-header">
        <div className="capturer-badge">
          <span className={`rec-indicator-dot ${isRecording ? 'recording' : ''}`} />
          <span>CAPTADOR EN VIVO (LIVE SAMPLER)</span>
        </div>
        {isRecording && (
          <div className="capturer-time-pill">
            REC: {formatTimer(recordDuration)}
          </div>
        )}
      </div>

      <div className="capturer-body">
        {!isRecording ? (
          <div className="capturer-btn-group">
            <button
              className="mpc-btn small rec-main-btn"
              onClick={() => startRecording('tab')}
              title="Graba digitalmente el audio de YouTube o de cualquier pestaña del navegador"
            >
              <span className="rec-btn-circle" />
              Grabar Audio YouTube
            </button>

            <button
              className="mpc-btn small rec-alt-btn"
              onClick={() => startRecording('mic')}
              title="Graba desde tu micrófono, tocadiscos o interfaz de audio conectada a tu PC"
            >
              🎤 Mic / Entrada
            </button>
          </div>
        ) : (
          <div className="capturer-recording-controls">
            <div className="capturer-vu-wrap" title="Nivel de audio en vivo">
              <div
                className="capturer-vu-bar"
                style={{ width: `${vuLevel}%` }}
              />
            </div>

            <button
              className="mpc-btn small stop-rec-btn"
              onClick={stopRecording}
              title="Finalizar grabación y cargar inmediatamente en la MPC"
            >
              ⏹ DETENER Y CARGAR EN MPC
            </button>
          </div>
        )}

        {statusMsg && <div className="capturer-status-msg">{statusMsg}</div>}
      </div>

      <div className="capturer-hint">
        💡 <em>Grabar Audio YouTube</em> captura digitalmente en estéreo sin servidores. Recuerda marcar <strong>"Compartir audio"</strong> en la ventana del navegador.
      </div>
    </div>
  );
}

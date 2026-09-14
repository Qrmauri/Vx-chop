import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Mapeo de notas MPC estándar (General MIDI Drum Map):
 * - Bank A: Notas 36 a 51 (C1 a D#2)
 * - Bank B: Notas 52 a 67 (E2 a G3)
 * - Bank C: Notas 68 a 83
 * - Bank D: Notas 84 a 99
 */
export function midiNoteToChopInfo(noteNumber) {
  if (noteNumber >= 36 && noteNumber <= 99) {
    const globalIndex = noteNumber - 36;
    const bankIndex = Math.floor(globalIndex / 16);
    const padIndex = globalIndex % 16;
    const banks = ['A', 'B', 'C', 'D'];
    return {
      globalIndex,
      bank: banks[bankIndex] || 'A',
      padIndex, // 0 a 15
    };
  }
  // Para teclados que tocan fuera del rango 36-99: mapear al banco activo por módulo
  return {
    globalIndex: null,
    bank: null,
    padIndex: Math.abs(noteNumber) % 16,
  };
}

/**
 * Devuelve la nota MIDI (número y nombre cromático) para un pad específico según el estándar MPC.
 * Bank A: 36..51 (C1 a D#2)
 * Bank B: 52..67 (E2 a G3)
 * Bank C: 68..83
 * Bank D: 84..99
 */
export function getMidiNoteForPad(globalPadIndex) {
  const noteNumber = 36 + Math.max(0, globalPadIndex);
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const name = noteNames[noteNumber % 12];
  const octave = Math.floor(noteNumber / 12) - 1;
  return {
    note: noteNumber,
    name: `${name}${octave}`,
    label: `${name}${octave} (#${noteNumber})`,
  };
}

/**
 * Hook para Web MIDI API nativa.
 * Soporta conexión automática, hot-plug de dispositivos USB/Bluetooth,
 * mensajes Note-On con velocity, Note-Off y mensajes de control (CC).
 */
export function useMidi({ onNoteOn, onNoteOff, onControlChange } = {}) {
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState('idle'); // 'idle' | 'connecting' | 'connected' | 'error' | 'unsupported'
  const [devices, setDevices] = useState([]);
  const [lastMessage, setLastMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const midiAccessRef = useRef(null);
  const onNoteOnRef = useRef(onNoteOn);
  const onNoteOffRef = useRef(onNoteOff);
  const onControlChangeRef = useRef(onControlChange);

  useEffect(() => { onNoteOnRef.current = onNoteOn; }, [onNoteOn]);
  useEffect(() => { onNoteOffRef.current = onNoteOff; }, [onNoteOff]);
  useEffect(() => { onControlChangeRef.current = onControlChange; }, [onControlChange]);

  const updateDeviceList = useCallback((access) => {
    if (!access) {
      setDevices([]);
      return;
    }
    const list = [];
    access.inputs.forEach((input) => {
      list.push({
        id: input.id,
        name: input.name || 'Dispositivo MIDI',
        manufacturer: input.manufacturer || 'Desconocido',
        state: input.state,
      });
    });
    setDevices(list);
  }, []);

  const handleMidiMessage = useCallback((event) => {
    const [statusByte, data1, data2] = event.data;
    const command = statusByte >> 4;
    const channel = (statusByte & 0xf) + 1;

    // 0x9 = Note On (canal 1-16)
    if (command === 0x9) {
      const note = data1;
      const velocity = data2;
      if (velocity > 0) {
        const info = midiNoteToChopInfo(note);
        setLastMessage(`Note On #${note} (Vel ${velocity})`);
        if (onNoteOnRef.current) {
          onNoteOnRef.current({
            note,
            velocity: velocity / 127, // Normalizado 0.0 - 1.0
            velocityRaw: velocity,
            channel,
            ...info,
          });
        }
      } else {
        // Velocity 0 equivale a Note Off según estándar MIDI
        setLastMessage(`Note Off #${note}`);
        if (onNoteOffRef.current) {
          onNoteOffRef.current({ note, channel });
        }
      }
      return;
    }

    // 0x8 = Note Off
    if (command === 0x8) {
      const note = data1;
      setLastMessage(`Note Off #${note}`);
      if (onNoteOffRef.current) {
        onNoteOffRef.current({ note, channel });
      }
      return;
    }

    // 0xB = Control Change (CC)
    if (command === 0xb) {
      const controller = data1;
      const value = data2;
      setLastMessage(`CC #${controller} = ${value}`);
      if (onControlChangeRef.current) {
        onControlChangeRef.current({
          controller,
          value,
          normalized: value / 127,
          channel,
        });
      }
    }
  }, []);

  const setupInputs = useCallback((access) => {
    if (!access) return;
    access.inputs.forEach((input) => {
      input.onmidimessage = handleMidiMessage;
    });

    access.onstatechange = (e) => {
      updateDeviceList(access);
      if (e.port.type === 'input') {
        if (e.port.state === 'connected') {
          e.port.onmidimessage = handleMidiMessage;
          setLastMessage(`Conectado: ${e.port.name}`);
        }
      }
    };
  }, [handleMidiMessage, updateDeviceList]);

  const connectMidi = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      setSupported(false);
      setStatus('unsupported');
      setErrorMsg('Web MIDI no está soportado en este navegador.');
      return false;
    }

    setSupported(true);
    setStatus('connecting');
    setErrorMsg('');

    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      midiAccessRef.current = access;
      setupInputs(access);
      updateDeviceList(access);
      setStatus('connected');
      return true;
    } catch (err) {
      console.warn('[VxChop MIDI] Error de acceso:', err);
      setStatus('error');
      setErrorMsg(err.message || 'Permiso MIDI denegado por el usuario.');
      return false;
    }
  }, [setupInputs, updateDeviceList]);

  // Intentar autodetección si el navegador lo permite
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.requestMIDIAccess) {
      setSupported(true);
      navigator.requestMIDIAccess({ sysex: false })
        .then((access) => {
          midiAccessRef.current = access;
          setupInputs(access);
          updateDeviceList(access);
          setStatus('connected');
        })
        .catch(() => {
          setStatus('idle');
        });
    } else {
      setSupported(false);
      setStatus('unsupported');
    }

    return () => {
      if (midiAccessRef.current) {
        midiAccessRef.current.inputs.forEach((input) => {
          input.onmidimessage = null;
        });
        midiAccessRef.current.onstatechange = null;
      }
    };
  }, [setupInputs, updateDeviceList]);

  return {
    supported,
    status,
    connected: status === 'connected' && devices.length > 0,
    devices,
    lastMessage,
    errorMsg,
    connectMidi,
  };
}

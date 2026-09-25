use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use base64::prelude::*;

pub struct SendStream(pub Option<cpal::Stream>);
unsafe impl Send for SendStream {}
unsafe impl Sync for SendStream {}

impl Default for SendStream {
    fn default() -> Self {
        SendStream(None)
    }
}

#[derive(Default)]
pub struct CaptureState {
    pub is_recording: Arc<AtomicBool>,
    pub samples: Arc<Mutex<Vec<f32>>>,
    pub stream: Arc<Mutex<SendStream>>,
    pub sample_rate: Arc<Mutex<u32>>,
    pub channels: Arc<Mutex<u16>>,
}

#[tauri::command]
fn is_wasapi_available() -> bool {
    #[cfg(target_os = "windows")]
    {
        true
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[tauri::command]
fn start_wasapi_capture(state: tauri::State<'_, CaptureState>) -> Result<String, String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "No se encontró dispositivo de audio de salida predeterminado en Windows.".to_string())?;

    let default_config = device
        .default_output_config()
        .map_err(|e| format!("Error al obtener configuración del dispositivo: {}", e))?;

    let sample_rate = default_config.sample_rate().0;
    let channels = default_config.channels();

    *state.sample_rate.lock().unwrap() = sample_rate;
    *state.channels.lock().unwrap() = channels;

    let samples = Arc::clone(&state.samples);
    {
        let mut s = samples.lock().unwrap();
        s.clear();
    }

    let is_recording = Arc::clone(&state.is_recording);
    is_recording.store(true, Ordering::SeqCst);

    let err_fn = |err| eprintln!("Error en stream WASAPI: {}", err);
    let stream_config: cpal::StreamConfig = default_config.clone().into();

    let stream = match default_config.sample_format() {
        cpal::SampleFormat::F32 => {
            let samples_clone = Arc::clone(&samples);
            let is_rec = Arc::clone(&is_recording);
            device.build_input_stream(
                &stream_config,
                move |data: &[f32], _| {
                    if is_rec.load(Ordering::SeqCst) {
                        if let Ok(mut buf) = samples_clone.lock() {
                            buf.extend_from_slice(data);
                        }
                    }
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let samples_clone = Arc::clone(&samples);
            let is_rec = Arc::clone(&is_recording);
            device.build_input_stream(
                &stream_config,
                move |data: &[i16], _| {
                    if is_rec.load(Ordering::SeqCst) {
                        if let Ok(mut buf) = samples_clone.lock() {
                            for &s in data {
                                buf.push(s as f32 / i16::MAX as f32);
                            }
                        }
                    }
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let samples_clone = Arc::clone(&samples);
            let is_rec = Arc::clone(&is_recording);
            device.build_input_stream(
                &stream_config,
                move |data: &[u16], _| {
                    if is_rec.load(Ordering::SeqCst) {
                        if let Ok(mut buf) = samples_clone.lock() {
                            for &s in data {
                                buf.push((s as f32 / u16::MAX as f32) * 2.0 - 1.0);
                            }
                        }
                    }
                },
                err_fn,
                None,
            )
        }
        _ => return Err("Formato de muestra no soportado".to_string()),
    }
    .map_err(|e| format!("Error al crear stream de captura WASAPI loopback: {}", e))?;

    stream.play().map_err(|e| format!("Error al iniciar stream: {}", e))?;

    *state.stream.lock().unwrap() = SendStream(Some(stream));

    Ok("Captura WASAPI iniciada con éxito".to_string())
}

#[tauri::command]
fn stop_wasapi_capture(state: tauri::State<'_, CaptureState>) -> Result<String, String> {
    state.is_recording.store(false, Ordering::SeqCst);

    // Detener stream
    let mut stream_guard = state.stream.lock().unwrap();
    if let Some(stream) = stream_guard.0.take() {
        drop(stream);
    }

    let samples = state.samples.lock().unwrap();
    if samples.is_empty() {
        return Err("No se capturaron muestras de audio".to_string());
    }

    let sample_rate = *state.sample_rate.lock().unwrap();
    let channels = *state.channels.lock().unwrap();

    // Codificar a WAV 32-bit Float en memoria usando hound
    let mut cursor = std::io::Cursor::new(Vec::new());
    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };

    let mut writer = hound::WavWriter::new(&mut cursor, spec)
        .map_err(|e| format!("Error al crear WavWriter: {}", e))?;

    for &sample in samples.iter() {
        writer
            .write_sample(sample)
            .map_err(|e| format!("Error al escribir muestra: {}", e))?;
    }

    writer
        .finalize()
        .map_err(|e| format!("Error al finalizar WAV: {}", e))?;

    let wav_bytes = cursor.into_inner();
    let b64 = BASE64_STANDARD.encode(&wav_bytes);

    Ok(b64)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CaptureState::default())
        .invoke_handler(tauri::generate_handler![
            is_wasapi_available,
            start_wasapi_capture,
            stop_wasapi_capture
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

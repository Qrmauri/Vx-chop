/**
 * audioStorage.js
 * Almacenamiento persistente de muestras de audio de gran tamaño utilizando IndexedDB nativo.
 * A diferencia de localStorage (limitado a ~5MB de texto), IndexedDB permite almacenar cientos
 * de megabytes de audio binario (WAV, MP3, etc.) de forma instantánea y persistente en disco.
 */

const DB_NAME = 'vxchop_audio_db';
const DB_VERSION = 1;
const STORE_NAME = 'audio_samples';
const SAMPLE_KEY = 'active_sample';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no está disponible en este entorno.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Guarda el archivo o ArrayBuffer de audio activo en IndexedDB
 */
export async function saveCachedSample(arrayBuffer, fileInfo = 'Sample activo') {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const record = {
        id: SAMPLE_KEY,
        buffer: arrayBuffer,
        fileInfo,
        updatedAt: Date.now(),
      };

      const putRequest = store.put(record);
      putRequest.onsuccess = () => resolve(true);
      putRequest.onerror = () => reject(putRequest.error);
    });
  } catch (err) {
    console.warn('[AudioStorage] Error al guardar muestra en caché:', err);
    return false;
  }
}

/**
 * Recupera el último audio guardado en disco
 */
export async function loadCachedSample() {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const getRequest = store.get(SAMPLE_KEY);

      getRequest.onsuccess = () => {
        const res = getRequest.result;
        if (res && res.buffer) {
          resolve({
            arrayBuffer: res.buffer,
            fileInfo: res.fileInfo || 'Sample restaurado',
            updatedAt: res.updatedAt,
          });
        } else {
          resolve(null);
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  } catch (err) {
    console.warn('[AudioStorage] Error al cargar muestra desde caché:', err);
    return null;
  }
}

/**
 * Limpia el audio guardado (cuando el usuario hace clic en "Nuevo Proyecto")
 */
export async function clearCachedSample() {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const delRequest = store.delete(SAMPLE_KEY);

      delRequest.onsuccess = () => resolve(true);
      delRequest.onerror = () => reject(delRequest.error);
    });
  } catch (err) {
    console.warn('[AudioStorage] Error al limpiar muestra en caché:', err);
    return false;
  }
}

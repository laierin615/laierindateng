/**
 * Per-page voice recordings, kept only on this device (IndexedDB).
 * Every call is wrapped so a browser without MediaRecorder / IndexedDB
 * degrades to "recording unavailable" instead of breaking the app.
 */

const DB_NAME = 'dateng-practice';
const STORE = 'recordings';

/** @returns {Promise<IDBDatabase>} */
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('無法開啟錄音資料庫'));
  });
}

/**
 * Run one IndexedDB request inside a transaction.
 * @param {'readonly' | 'readwrite'} mode
 * @param {(store: IDBObjectStore) => IDBRequest} action
 */
async function withStore(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('錄音資料庫讀寫失敗'));
  });
}

/** @returns {boolean} */
export function recordingSupported() {
  return typeof window !== 'undefined' && 'MediaRecorder' in window && !!navigator.mediaDevices?.getUserMedia && 'indexedDB' in window;
}

/**
 * @param {string} key e.g. "page-8" or "qa-Q1"
 * @returns {Promise<{blob: Blob, seconds: number, at: number} | undefined>}
 */
export async function loadRecording(key) {
  try {
    return await withStore('readonly', (store) => store.get(key));
  } catch (error) {
    console.warn('讀取錄音失敗', error);
    return undefined;
  }
}

/** @param {string} key @param {{blob: Blob, seconds: number, at: number}} value */
export async function saveRecording(key, value) {
  await withStore('readwrite', (store) => store.put(value, key));
}

/** @param {string} key */
export async function deleteRecording(key) {
  await withStore('readwrite', (store) => store.delete(key));
}

export async function clearRecordings() {
  await withStore('readwrite', (store) => store.clear());
}

/** Pick a container the current browser can actually record. */
function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) ?? '';
}

/**
 * Start recording from the microphone.
 * @returns {Promise<{stop: () => Promise<{blob: Blob, seconds: number}>}>}
 */
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  const startedAt = performance.now();
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.start();
  return {
    stop: () => new Promise((resolve, reject) => {
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        resolve({ blob: new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }), seconds: (performance.now() - startedAt) / 1000 });
      };
      recorder.onerror = (event) => reject(event.error ?? new Error('錄音中斷'));
      recorder.stop();
    }),
  };
}

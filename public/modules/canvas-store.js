const storageKey = 'youyu-image-canvas-v1';
const imageDbName = 'youyu-image-canvas-assets';
const imageStoreName = 'images';
const largeDataUrlThreshold = 320_000;
export const maxCanvasNodes = 200;

let imageDbPromise = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function isLargeDataUrl(src) {
  return String(src || '').startsWith('data:') && String(src || '').length > largeDataUrlThreshold;
}

function openImageDb() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  if (imageDbPromise) return imageDbPromise;
  imageDbPromise = new Promise((resolve) => {
    const request = window.indexedDB.open(imageDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(imageStoreName)) db.createObjectStore(imageStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return imageDbPromise;
}

export async function putCanvasAsset(key, src) {
  const db = await openImageDb();
  if (!db) return false;
  return new Promise((resolve) => {
    const tx = db.transaction(imageStoreName, 'readwrite');
    tx.objectStore(imageStoreName).put(src, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

export async function getCanvasAsset(key) {
  const db = await openImageDb();
  if (!db) return '';
  return new Promise((resolve) => {
    const tx = db.transaction(imageStoreName, 'readonly');
    const request = tx.objectStore(imageStoreName).get(key);
    request.onsuccess = () => resolve(String(request.result || ''));
    request.onerror = () => resolve('');
  });
}

export async function deleteCanvasAsset(key) {
  const db = await openImageDb();
  if (!db) return;
  await new Promise((resolve) => {
    const tx = db.transaction(imageStoreName, 'readwrite');
    tx.objectStore(imageStoreName).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

function serializeNode(node) {
  const next = { ...node, kind: node.kind || 'image' };
  if (next.imageRef) next.src = '';
  return next;
}

function normalizeNode(node) {
  return { ...node, kind: node?.kind || 'image' };
}

export async function readCanvasState(defaultState) {
  const fallback = {
    nodes: [],
    viewport: { ...defaultState.viewport }
  };
  try {
    const raw = window.localStorage?.getItem(storageKey);
    if (!raw) return fallback;
    const data = JSON.parse(raw);
    const nodes = Array.isArray(data.nodes)
      ? data.nodes.slice(0, maxCanvasNodes).map(normalizeNode)
      : [];
    const viewport = data.viewport
      ? {
          x: Number(data.viewport.x || 0),
          y: Number(data.viewport.y || 0),
          scale: clamp(Number(data.viewport.scale || defaultState.viewport.scale), 0.25, 2.4)
        }
      : fallback.viewport;
    return { nodes, viewport };
  } catch {
    return fallback;
  }
}

export function writeCanvasState({ nodes, viewport }) {
  window.localStorage?.setItem(storageKey, JSON.stringify({
    nodes: nodes.map(serializeNode),
    viewport
  }));
}

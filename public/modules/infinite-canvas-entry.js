let modulePromise = null;
let latestOptions = {};
let entryInitialized = false;

function loadInfiniteCanvas() {
  if (!modulePromise) modulePromise = import('./infinite-canvas.js');
  return modulePromise;
}

export function initInfiniteCanvas(options = {}) {
  latestOptions = { ...latestOptions, ...options };
  if (entryInitialized) return;
  entryInitialized = true;
  const openButton = document.getElementById('openCanvasBtn');
  openButton?.addEventListener('click', () => {
    openInfiniteCanvas();
  });
}

export async function openInfiniteCanvas(options = {}) {
  latestOptions = { ...latestOptions, ...options };
  const mod = await loadInfiniteCanvas();
  mod.initInfiniteCanvas(latestOptions);
  return mod.openInfiniteCanvas();
}

export async function closeInfiniteCanvas(options = {}) {
  latestOptions = { ...latestOptions, ...options };
  const mod = await loadInfiniteCanvas();
  mod.initInfiniteCanvas(latestOptions);
  return mod.closeInfiniteCanvas();
}

export async function addImageToCanvas(payload = {}, options = {}) {
  latestOptions = { ...latestOptions, ...options };
  const mod = await loadInfiniteCanvas();
  mod.initInfiniteCanvas(latestOptions);
  return mod.addImageToCanvas(payload);
}

export async function addVideoToCanvas(payload = {}, options = {}) {
  latestOptions = { ...latestOptions, ...options };
  const mod = await loadInfiniteCanvas();
  mod.initInfiniteCanvas(latestOptions);
  return mod.addVideoToCanvas(payload);
}

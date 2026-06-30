export function createDebouncer(delay = 260) {
  let timer = 0;
  const run = (task, nextDelay = delay) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = 0;
      task();
    }, nextDelay);
    return timer;
  };
  run.cancel = () => {
    window.clearTimeout(timer);
    timer = 0;
  };
  return run;
}

export function scheduleIdle(task, timeout = 800) {
  if (typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(task, { timeout });
  }
  return window.setTimeout(() => task({ didTimeout: true, timeRemaining: () => 0 }), Math.min(timeout, 120));
}

export function cancelIdle(handle) {
  if (!handle) return;
  if (typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(handle);
    return;
  }
  window.clearTimeout(handle);
}

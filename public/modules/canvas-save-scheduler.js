import { cancelIdle, scheduleIdle } from './scheduler.js';

export function createCanvasSaveScheduler({ save, onError = () => {} } = {}) {
  let saveTimer = 0;
  let saveIdleHandle = 0;

  const runSave = () => {
    saveIdleHandle = 0;
    try {
      save?.();
    } catch (error) {
      onError(error);
    }
  };

  const cancelPendingSave = () => {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    if (saveIdleHandle) {
      cancelIdle(saveIdleHandle);
      saveIdleHandle = 0;
    }
  };

  const saveNow = () => {
    cancelPendingSave();
    runSave();
  };

  const scheduleSave = () => {
    cancelPendingSave();
    saveTimer = window.setTimeout(() => {
      saveTimer = 0;
      saveIdleHandle = scheduleIdle(runSave, 800);
    }, 160);
  };

  return {
    saveNow,
    scheduleSave,
    cancelPendingSave
  };
}

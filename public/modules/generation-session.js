import { $ } from './dom.js';

let activeGenerationSeq = 0;

export function beginGenerationActivity() {
  activeGenerationSeq += 1;
  document.body.classList.add('generating-active');
  return activeGenerationSeq;
}

export function isCurrentGenerationActivity(submitSeq) {
  return submitSeq === activeGenerationSeq;
}

export function finishGenerationActivity(submitSeq) {
  if (isCurrentGenerationActivity(submitSeq)) {
    document.body.classList.remove('generating-active');
  }
}

export function isGenerateButtonLocked() {
  return $('generateBtn')?.dataset.submitLocked === 'true';
}

export function lockGenerateButtonForSession(submitSeq, { setStatus = () => {} } = {}) {
  const button = $('generateBtn');
  if (!button) return null;
  const label = button.querySelector('span');
  button.disabled = true;
  button.dataset.submitLocked = 'true';
  button.dataset.submitSeq = String(submitSeq);
  if (label) label.textContent = '生成中';
  const unlockTimer = window.setTimeout(() => {
    if (button.dataset.submitLocked === 'true' && button.dataset.submitSeq === String(submitSeq)) {
      button.disabled = false;
      button.dataset.submitLocked = 'false';
      if (label) label.textContent = '生成图片';
      setStatus('上一张还在生成，你可以继续提交下一张。');
    }
  }, 1800);
  return { button, label, unlockTimer };
}

export function unlockGenerateButtonForSession(submitSeq, lockState = null) {
  if (!lockState?.button) return;
  window.clearTimeout(lockState.unlockTimer);
  const { button, label } = lockState;
  if (button.dataset.submitSeq === String(submitSeq)) {
    button.disabled = false;
    button.dataset.submitLocked = 'false';
    if (label) label.textContent = '生成图片';
  }
}

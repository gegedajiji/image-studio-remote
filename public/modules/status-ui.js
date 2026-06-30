import { $ } from './dom.js';

export function setStatus(text, isError = false) {
  const node = $('status');
  if (!node) return;
  node.textContent = text || '';
  node.classList.toggle('error-text', Boolean(isError));
}

export function setInlineStatus(id, text, isError = false) {
  const node = $(id);
  if (!node) return;
  node.textContent = text || '';
  node.classList.toggle('error-text', Boolean(isError));
}

export function setAuthStatus(text, isError = false) {
  const node = $('authStatus');
  if (!node) return;
  node.textContent = text || '';
  node.classList.toggle('error-text', Boolean(isError));
}

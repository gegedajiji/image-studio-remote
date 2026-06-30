export const $ = (id) => document.getElementById(id);

export function scrollIntoViewSafe(element, options = {}) {
  if (!element) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  element.scrollIntoView({ ...options, behavior: reduced ? 'auto' : (options.behavior || 'smooth') });
}

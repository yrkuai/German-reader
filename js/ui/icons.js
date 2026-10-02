const PATHS = {
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none"/>',
  first: '<path d="M4.5 6v12"/><path d="M12.5 6.5 6.5 12l6 5.5z" fill="currentColor"/><path d="M19.5 6.5 13.5 12l6 5.5z" fill="currentColor"/>',
  prev: '<path d="M6.5 6v12"/><path d="M18 6.5 9.5 12l8.5 5.5z" fill="currentColor"/>',
  next: '<path d="M17.5 6v12"/><path d="M6 6.5 14.5 12 6 17.5z" fill="currentColor"/>',
  repeat: '<path d="m17 2 3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="m7 22-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  translate: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  // 填滿版垃圾桶
  trash: '<path d="M9 3.5A1.5 1.5 0 0 1 10.5 2h3A1.5 1.5 0 0 1 15 3.5V4h5a1 1 0 1 1 0 2H4a1 1 0 0 1 0-2h5z" fill="currentColor" stroke="none"/><path fill-rule="evenodd" d="M5.5 7.5h13l-1 12.7A2 2 0 0 1 15.5 22h-7a2 2 0 0 1-2-1.8zM9.75 10.5a.75.75 0 0 0-.75.75v6.5a.75.75 0 0 0 1.5 0v-6.5a.75.75 0 0 0-.75-.75zm4.5 0a.75.75 0 0 0-.75.75v6.5a.75.75 0 0 0 1.5 0v-6.5a.75.75 0 0 0-.75-.75z" fill="currentColor" stroke="none"/>',
  speaker: '<path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
};

export function icon(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
  return span;
}

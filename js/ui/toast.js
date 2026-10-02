import { h } from './dom.js';

const DURATION_MS = 2500;

// 畫面上方短暫出現的提示，幾秒後自動消失
export function showToast(text) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('is-shown'));
  setTimeout(() => {
    el.classList.remove('is-shown');
    setTimeout(() => el.remove(), 250);
  }, DURATION_MS);
}

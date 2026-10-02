import { h } from './dom.js';

const DURATION_MS = 2500;

// 畫面上方短暫出現的提示，幾秒後自動消失
// action：{ label, onClick, duration } 會在提示裡放一個按鈕（例如「復原」）
export function showToast(text, action) {
  document.querySelector('.toast')?.remove();

  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.remove('is-shown');
    setTimeout(() => el.remove(), 250);
  };

  const el = h('div', { class: action ? 'toast has-action' : 'toast', role: 'status' },
    h('span', { class: 'toast-text' }, text),
    action
      ? h('button', {
        class: 'toast-action', type: 'button',
        onclick: () => { dismiss(); action.onClick(); },
      }, action.label)
      : null,
  );
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('is-shown'));
  timer = setTimeout(dismiss, action?.duration ?? DURATION_MS);
  return dismiss;
}

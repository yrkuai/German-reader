import { h } from './dom.js';
import { icon } from './icons.js';

// 從畫面下方滑出的單字抽屜。點遮罩、按關閉、按 Esc 或往下滑都會關閉。
// 回傳 close()。
// grammar：名詞的冠詞／複數或動詞原形（沒有就不顯示）
export function openWordSheet({ word, grammar, meaning, onSpeak, onClose }) {
  const previousFocus = document.activeElement;

  const closeBtn = h('button', { class: 'sheet-close', type: 'button', 'aria-label': '關閉' }, '×');
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': `單字 ${word}` },
    h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' },
      h('span', { class: 'sheet-word', lang: 'de' }, word),
      h('button', { class: 'ctrl sheet-speak', type: 'button', 'aria-label': '再唸一次', onclick: onSpeak }, icon('speaker')),
      closeBtn,
    ),
    grammar ? h('p', { class: 'sheet-grammar' }, grammar) : null,
    meaning
      ? h('p', { class: 'sheet-meaning' }, meaning)
      : h('p', { class: 'sheet-meaning is-empty' }, '沒有翻譯資料。先匯入這篇文章的翻譯，就能看到單字的意思。'),
  );
  const backdrop = h('div', { class: 'sheet-backdrop' }, panel);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.classList.remove('is-open');
    setTimeout(() => backdrop.remove(), 200);
    previousFocus?.focus?.({ preventScroll: true });
    onClose?.();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  // 往下滑關閉
  let startY = null;
  panel.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    const dy = Math.max(0, e.touches[0].clientY - startY);
    panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  panel.addEventListener('touchend', (e) => {
    if (startY == null) return;
    const dy = e.changedTouches[0].clientY - startY;
    startY = null;
    panel.style.transform = '';
    if (dy > 80) close();
  });

  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('is-open'));
  closeBtn.focus({ preventScroll: true });
  return close;
}

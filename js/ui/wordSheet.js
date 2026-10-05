import { h } from './dom.js';
import { icon } from './icons.js';

// 從畫面下方滑出的單字抽屜。點遮罩、按關閉、按 Esc 或往下滑都會關閉。
// 回傳 close()。
// grammar：名詞的冠詞／複數或動詞原形（沒有就不顯示）
// mark：{ marked, onToggle } 顯示 ☆／★ 按鈕；onToggle() 回傳切換後是否已標記
// example：單字本用，顯示出處句子（片段陣列 [{ text, hit }]，hit 的字加粗）
export function openWordSheet({ word, grammar, meaning, onSpeak, onClose, mark, example }) {
  const previousFocus = document.activeElement;

  const closeBtn = h('button', { class: 'sheet-close', type: 'button', 'aria-label': '關閉' }, '×');

  // ☆ 標記：按下只切換圖示，不顯示提示
  let starBtn = null;
  if (mark) {
    starBtn = h('button', { class: 'sheet-close sheet-star', type: 'button' });
    const showStar = (marked) => {
      starBtn.replaceChildren(icon(marked ? 'star-filled' : 'star'));
      starBtn.setAttribute('aria-pressed', String(marked));
      starBtn.setAttribute('aria-label', marked ? '從單字本移除' : '加入單字本');
    };
    starBtn.addEventListener('click', () => showStar(mark.onToggle()));
    showStar(mark.marked);
  }

  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': `單字 ${word}` },
    h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-tools' },
      starBtn,
      h('button', { class: 'ctrl sheet-speak', type: 'button', 'aria-label': '再唸一次', onclick: onSpeak }, icon('speaker')),
      closeBtn,
    ),
    // 單字自己佔一整行；長單字照德文規則斷字
    h('p', { class: 'sheet-word', lang: 'de' }, word),
    grammar ? h('p', { class: 'sheet-grammar' }, grammar) : null,
    meaning
      ? h('p', { class: 'sheet-meaning' }, meaning)
      : h('p', { class: 'sheet-meaning is-empty' }, '沒有翻譯資料。先匯入這篇文章的翻譯，就能看到單字的意思。'),
    example
      ? h('div', { class: 'sheet-example' },
        h('p', { class: 'sheet-example-de', lang: 'de' }, example.parts.map((p) => (p.hit ? h('b', {}, p.text) : p.text))),
        example.zh ? h('p', { class: 'sheet-example-zh' }, example.zh) : null,
      )
      : null,
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

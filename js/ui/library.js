import { h } from './dom.js';
import { listArticles, saveArticle, createArticle, deleteArticle } from '../storage.js';
import { createSwipeGroup } from './swipe.js';
import { icon } from './icons.js';
import { showToast } from './toast.js';
import { splitSentences } from '../segmenter.js';

export function renderLibrary(view, ctx) {
  ctx.setBar('German Reader', null, { settings: true, words: true });

  const articles = listArticles().sort((a, b) => b.createdAt - a.createdAt);

  view.append(
    h('div', { class: 'page-head' },
      h('h1', { class: 'page-title' }, '我的文章'),
      h('a', { class: 'btn btn-primary btn-icon-text', href: '#/new' }, icon('plus'), '新增'),
    ),
  );

  if (!articles.length) {
    view.append(
      h('div', { class: 'empty spotlight' },
        h('p', {}, '還沒有文章。'),
        h('p', { class: 'muted' }, '貼上一篇德語文章，就可以一句一句練習。'),
        h('a', { class: 'btn btn-primary', href: '#/new' }, '貼上第一篇文章'),
      ),
    );
    return;
  }

  // 往左滑露出刪除按鈕；刪除後顯示「復原」
  const swipe = createSwipeGroup();
  const list = h('ul', { class: 'article-list' });

  // 重新整理列表，但保留捲動位置
  const rerender = () => {
    const y = window.scrollY;
    ctx.navigate('#/');
    window.scrollTo(0, y);
  };

  function remove(article, li) {
    deleteArticle(article.id);
    li.style.height = `${li.offsetHeight}px`;
    requestAnimationFrame(() => li.classList.add('is-removing'));
    setTimeout(() => {
      li.remove();
      if (!list.children.length) rerender();
    }, 220);
    showToast(`已刪除「${truncate(article.title, 16)}」`, {
      label: '復原',
      duration: 5000,
      onClick: () => {
        saveArticle(article);
        rerender();
      },
    });
  }

  for (const a of articles) {
    const translated = a.sentences.filter((s) => s.zh).length;
    const status = translated === 0
      ? '未翻譯'
      : translated === a.sentences.length ? '已翻譯' : `已翻譯 ${translated}/${a.sentences.length}`;
    const content = h('a', { class: 'article-item', href: `#/read/${encodeURIComponent(a.id)}` },
      h('span', { class: 'article-title' }, a.title),
      h('span', { class: 'article-meta' }, `${a.sentences.length} 句 · ${status} · ${formatDate(a.createdAt)}`),
    );
    const action = h('button', { class: 'swipe-delete', type: 'button', 'aria-label': `刪除「${a.title}」` }, icon('trash'));
    const li = h('li', { class: 'swipe-row' }, action, content);
    action.addEventListener('click', () => remove(a, li));
    swipe.attach(li, content, action);
    list.append(li);
  }

  view.append(list);
  return () => swipe.destroy();
}

export function renderNewArticle(view, ctx) {
  ctx.setBar('新增文章', '#/');

  const titleInput = h('input', {
    class: 'input', type: 'text', placeholder: '標題（可留空，自動使用第一句）', 'aria-label': '標題',
  });
  const textInput = h('textarea', {
    class: 'input textarea', rows: 12, lang: 'de', spellcheck: false,
    placeholder: '在這裡貼上德語文章…', 'aria-label': '德語文章',
  });
  const splitBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, '分句');
  textInput.addEventListener('input', () => { splitBtn.disabled = !textInput.value.trim(); });

  const step1 = h('section', { class: 'stack' },
    titleInput, textInput,
    h('div', { class: 'actions' }, splitBtn),
  );

  const linesInput = h('textarea', { class: 'input textarea lines', rows: 14, lang: 'de', spellcheck: false, 'aria-label': '分句結果' });
  const countLabel = h('p', { class: 'muted' });
  const errorLabel = h('p', { class: 'error', hidden: true });
  const backBtn = h('button', { class: 'btn', type: 'button' }, '返回修改');
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button' }, '儲存');

  const step2 = h('section', { class: 'stack', hidden: true },
    countLabel,
    h('p', { class: 'hint' }, '一行一句（長句子會自動折行顯示，以按 Enter 的換行為準）。分錯的地方可以直接修改：把兩行接成一行，或在句子中間按 Enter 斷開。'),
    linesInput,
    errorLabel,
    h('div', { class: 'actions' }, backBtn, saveBtn),
  );

  const currentLines = () => linesInput.value.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const updateCount = () => { countLabel.textContent = `共 ${currentLines().length} 句`; };
  linesInput.addEventListener('input', updateCount);

  splitBtn.addEventListener('click', () => {
    linesInput.value = splitSentences(textInput.value).join('\n');
    updateCount();
    step1.hidden = true;
    step2.hidden = false;
    linesInput.focus();
  });

  backBtn.addEventListener('click', () => {
    step2.hidden = true;
    step1.hidden = false;
  });

  saveBtn.addEventListener('click', () => {
    const lines = currentLines();
    if (!lines.length) {
      errorLabel.textContent = '沒有任何句子。';
      errorLabel.hidden = false;
      return;
    }
    const title = titleInput.value.trim() || truncate(lines[0], 40);
    const article = createArticle(title, lines);
    if (!saveArticle(article)) {
      errorLabel.textContent = '無法存到瀏覽器（可能是無痕模式或空間已滿）。這篇文章只會保留到關閉網頁為止。';
      errorLabel.hidden = false;
    }
    ctx.navigate(`#/read/${encodeURIComponent(article.id)}`);
  });

  view.append(step1, step2);
  textInput.focus();
}

// 2026/10/02
function formatDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

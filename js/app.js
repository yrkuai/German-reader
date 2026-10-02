import { renderLibrary, renderNewArticle } from './ui/library.js';
import { renderReader } from './ui/reader.js';
import { renderSettings } from './ui/settings.js';
import { renderTranslate } from './ui/translate.js';
import { applyTheme, applyDeSize } from './theme.js';
import { loadSettings } from './storage.js';

const view = document.getElementById('view');
const backLink = document.getElementById('bar-back');
const barTitle = document.getElementById('bar-title');
const settingsLink = document.getElementById('bar-settings');
const barActions = document.getElementById('bar-actions');

let cleanup = null;
let flash = null;
let currentHash = null;
let previousHash = '#/';

const ctx = {
  setBar(title, backHref, { settings = false } = {}) {
    barTitle.textContent = title;
    document.title = backHref ? `${title} · German Reader` : 'German Reader';
    backLink.hidden = !backHref;
    if (backHref) backLink.href = backHref;
    settingsLink.hidden = !settings;
    barActions.replaceChildren();
  },
  // 在標題列右側放畫面專用的按鈕（換畫面時會清掉）
  addBarAction(el) {
    barActions.append(el);
  },
  navigate(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  },
  // 設定頁的返回鍵回到進來之前的畫面
  previousHash: () => previousHash,
  // 換畫面後要顯示的一次性提示（例如匯入成功）
  setFlash(text) { flash = text; },
  takeFlash() {
    const text = flash;
    flash = null;
    return text;
  },
};

// 路由：#/ 文章列表、#/new 新增文章、#/read/<id> 閱讀、#/translate/<id> 取得翻譯、#/settings 設定
function route() {
  const hash = location.hash || '#/';
  if (currentHash && currentHash !== hash && !currentHash.startsWith('#/settings')) previousHash = currentHash;
  currentHash = hash;

  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  view.replaceChildren();
  window.scrollTo(0, 0);

  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'new') cleanup = renderNewArticle(view, ctx);
  else if (parts[0] === 'settings') cleanup = renderSettings(view, ctx);
  else if (parts[0] === 'translate' && parts[1]) cleanup = renderTranslate(view, decodeURIComponent(parts[1]), ctx);
  else if (parts[0] === 'read' && parts[1]) cleanup = renderReader(view, decodeURIComponent(parts[1]), ctx);
  else cleanup = renderLibrary(view, ctx);
}

applyTheme(loadSettings().theme);
applyDeSize(loadSettings().deSize);
window.addEventListener('hashchange', route);
route();

// 離線使用：註冊 Service Worker（只在 https 或 localhost 有效）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
// 請瀏覽器不要在空間不足時自動清掉文章
navigator.storage?.persist?.().catch(() => {});

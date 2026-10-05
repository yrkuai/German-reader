import { renderLibrary, renderNewArticle } from './ui/library.js';
import { renderReader } from './ui/reader.js';
import { renderSettings } from './ui/settings.js';
import { renderTranslate } from './ui/translate.js';
import { renderPair } from './ui/sync.js';
import { renderWords } from './ui/words.js';
import { renderFlashcards, renderCloze } from './ui/review.js';
import { renderVerbs, renderNewVerbs } from './ui/verbs.js';
import { renderVerbPractice, renderVerbMix } from './ui/verbPractice.js';
import { startSync } from './sync.js';
import { applyTheme, applyDeSize } from './theme.js';
import { loadSettings } from './storage.js';

const view = document.getElementById('view');
const backLink = document.getElementById('bar-back');
const barTitle = document.getElementById('bar-title');
const settingsLink = document.getElementById('bar-settings');
const wordsLink = document.getElementById('bar-words');
const verbsLink = document.getElementById('bar-verbs');
const barActions = document.getElementById('bar-actions');

let cleanup = null;
let flash = null;
let currentHash = null;
let previousHash = '#/';

const ctx = {
  setBar(title, backHref, { settings = false, words = false, verbs = false } = {}) {
    barTitle.textContent = title;
    document.title = backHref ? `${title} · German Reader` : 'German Reader';
    backLink.hidden = !backHref;
    if (backHref) backLink.href = backHref;
    settingsLink.hidden = !settings;
    wordsLink.hidden = !words;
    verbsLink.hidden = !verbs;
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

// 路由：#/ 文章列表、#/new 新增文章、#/read/<id> 閱讀、#/translate/<id> 取得翻譯、#/settings 設定、
// #/pair/<配對碼> 掃 QR code 設定同步、#/words 單字本、#/review/flash 閃卡、#/review/cloze 例句填空、
// #/verbs 動詞、#/verbs/new 新增動詞、#/verbs/more 增加例句、#/verbs/practice/<key> 單一動詞練習、#/verbs/mix 總練習
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
  else if (parts[0] === 'pair') cleanup = renderPair(view, parts[1] || '', ctx);
  else if (parts[0] === 'words') cleanup = renderWords(view, ctx);
  else if (parts[0] === 'review' && parts[1] === 'flash') cleanup = renderFlashcards(view, ctx);
  else if (parts[0] === 'review' && parts[1] === 'cloze') cleanup = renderCloze(view, ctx);
  else if (parts[0] === 'verbs' && parts[1] === 'new') cleanup = renderNewVerbs(view, ctx, 'new');
  else if (parts[0] === 'verbs' && parts[1] === 'more') cleanup = renderNewVerbs(view, ctx, 'more');
  else if (parts[0] === 'verbs' && parts[1] === 'mix') cleanup = renderVerbMix(view, ctx);
  else if (parts[0] === 'verbs' && parts[1] === 'practice' && parts[2]) cleanup = renderVerbPractice(view, decodeURIComponent(parts[2]), ctx);
  else if (parts[0] === 'verbs') cleanup = renderVerbs(view, ctx);
  else cleanup = renderLibrary(view, ctx);
}

// iPhone 的 Safari 會忽略 viewport 的 user-scalable=no，另外擋掉雙指縮放手勢
document.addEventListener('gesturestart', (e) => e.preventDefault());

applyTheme(loadSettings().theme);
applyDeSize(loadSettings().deSize);
window.addEventListener('hashchange', route);
route();

// 同步（沒設定時什麼都不做）。同步後本機資料有變，而且正在看文章列表，就重新整理列表；
// 其他畫面不打斷，下次進到列表就會看到
startSync(() => {
  const hash = location.hash || '#/';
  if (hash !== '#/' && hash !== '#') return;
  const y = window.scrollY;
  route();
  window.scrollTo(0, y);
});

// 離線使用：註冊 Service Worker（只在 https 或 localhost 有效）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
// 請瀏覽器不要在空間不足時自動清掉文章
navigator.storage?.persist?.().catch(() => {});

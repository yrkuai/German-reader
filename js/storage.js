// localStorage 讀寫。所有 key 都加上 gr: 前綴，
// 避免和同一個 <帳號>.github.io 底下的其他專案衝突。

const PREFIX = 'gr:';
const ARTICLES_KEY = 'articles';
const SETTINGS_KEY = 'settings';
const DELETED_KEY = 'deleted';   // 刪除紀錄 { id: 刪除時間 }，同步時讓另一台裝置也刪掉
const SYNC_KEY = 'sync';         // 同步設定 { token, gistId, lastSyncAt }，只存在這台裝置

const DELETED_KEEP_MS = 90 * 24 * 60 * 60 * 1000;

const SETTINGS_VERSION = 4;

export const DEFAULT_SETTINGS = {
  voiceURI: null,
  rate: 1.0,          // 語速倍率，選項見 speech.js 的 RATES
  theme: 'auto',      // 'auto' 跟著裝置 | 'light' | 'dark'
  deSize: 'm',        // 文章中德文句子的字級 's' | 'm' | 'l'
  pauseMs: 1200,
  showZh: true,
};

// localStorage 不能用時（無痕模式、被封鎖）退回記憶體，至少這次瀏覽還能用
const memory = new Map();

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return memory.has(key) ? memory.get(key) : fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    memory.set(key, value);
    return false;
  }
}

// 本機文章有變動時通知（同步用）。kind：'content' 內容變動 | 'progress' 只有閱讀進度
const listeners = new Set();

export function onArticlesChanged(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(kind) {
  for (const cb of listeners) cb(kind);
}

export function listArticles() {
  const articles = read(ARTICLES_KEY, []);
  return Array.isArray(articles) ? articles : [];
}

export function getArticle(id) {
  return listArticles().find((a) => a.id === id) || null;
}

// 回傳 false 代表沒有成功寫進 localStorage（例如容量已滿）
export function saveArticle(article) {
  article.updatedAt = Date.now();
  const articles = listArticles();
  const i = articles.findIndex((a) => a.id === article.id);
  if (i >= 0) articles[i] = article;
  else articles.push(article);
  // 「復原」刪除時，把刪除紀錄拿掉
  const deleted = getDeleted();
  if (article.id in deleted) {
    delete deleted[article.id];
    write(DELETED_KEY, deleted);
  }
  const ok = write(ARTICLES_KEY, articles);
  notify('content');
  return ok;
}

export function deleteArticle(id) {
  const deleted = getDeleted();
  deleted[id] = Date.now();
  write(DELETED_KEY, deleted);
  const ok = write(ARTICLES_KEY, listArticles().filter((a) => a.id !== id));
  notify('content');
  return ok;
}

// 只更新閱讀進度和 readAt，不動 updatedAt，
// 這樣在手機上閱讀不會蓋掉電腦上剛匯入的翻譯
export function setLastIndex(id, index) {
  const articles = listArticles();
  const article = articles.find((a) => a.id === id);
  if (!article || article.lastIndex === index) return;
  article.lastIndex = index;
  article.readAt = Date.now();
  write(ARTICLES_KEY, articles);
  notify('progress');
}

export function createArticle(title, sentences) {
  const now = Date.now();
  return {
    id: 'a_' + now.toString(36) + Math.random().toString(36).slice(2, 6),
    title,
    createdAt: now,
    updatedAt: now,
    readAt: now,
    lastIndex: 0,
    sentences: sentences.map((de) => ({ de, zh: null, words: null })),
  };
}

// 刪除紀錄，超過 90 天的清掉
export function getDeleted() {
  const deleted = read(DELETED_KEY, {});
  if (!deleted || typeof deleted !== 'object' || Array.isArray(deleted)) return {};
  const cutoff = Date.now() - DELETED_KEEP_MS;
  return Object.fromEntries(Object.entries(deleted).filter(([, t]) => t >= cutoff));
}

// 同步後一次寫回所有文章和刪除紀錄（不觸發變動通知，避免又排一次同步）
export function replaceAll(articles, deleted) {
  write(DELETED_KEY, deleted);
  return write(ARTICLES_KEY, articles);
}

export function loadSync() {
  const sync = read(SYNC_KEY, null);
  return sync && sync.token && sync.gistId ? sync : null;
}

export function saveSync(sync) {
  return write(SYNC_KEY, sync);
}

export function clearSync() {
  try { localStorage.removeItem(PREFIX + SYNC_KEY); } catch { /* 退回記憶體時 */ }
  memory.delete(SYNC_KEY);
}

export function loadSettings() {
  const stored = read(SETTINGS_KEY, {});
  // v1 的預設停頓是 1.5 秒，換語速時會被一起存下來；升級時改成新的預設 1.2 秒
  if (!stored.v && stored.pauseMs === 1500) stored.pauseMs = DEFAULT_SETTINGS.pauseMs;
  // v4 起語速改存倍率數字（原本是母語／一般／學習者），升級時一律改為新預設 1.0
  if ((stored.v || 1) < 4) stored.rate = DEFAULT_SETTINGS.rate;
  const { v, speed, ...settings } = stored;
  return { ...DEFAULT_SETTINGS, ...settings };
}

export function saveSettings(settings) {
  return write(SETTINGS_KEY, { ...settings, v: SETTINGS_VERSION });
}

import { refreshVocab } from './vocab.js';

// localStorage 讀寫。所有 key 都加上 gr: 前綴，
// 避免和同一個 <帳號>.github.io 底下的其他專案衝突。

const PREFIX = 'gr:';
const ARTICLES_KEY = 'articles';
const SETTINGS_KEY = 'settings';
const DELETED_KEY = 'deleted';   // 刪除紀錄 { id: 刪除時間 }，同步時讓另一台裝置也刪掉
const SYNC_KEY = 'sync';         // 同步設定 { token, gistId, lastSyncAt }，只存在這台裝置
const VOCAB_KEY = 'vocab';                // 單字本 { key: Entry }，格式見 PLAN-vocab.md
const VOCAB_DELETED_KEY = 'vocabDeleted'; // 單字的刪除紀錄 { key: 刪除時間 }

const DELETED_KEEP_MS = 90 * 24 * 60 * 60 * 1000;

const SETTINGS_VERSION = 4;

export const DEFAULT_SETTINGS = {
  voiceURI: null,
  rate: 1.0,          // 語速倍率，選項見 speech.js 的 RATES
  theme: 'auto',      // 'auto' 跟著裝置 | 'light' | 'dark'
  deSize: 'm',        // 文章中德文句子的字級 's' | 'm' | 'l'
  pauseMs: 1200,
  showZh: true,
  vocabScope: 'all',  // 單字本的練習範圍 'all' 全部 | 'weak' 只練不熟的
  flashDir: 'de',     // 閃卡方向 'de' 德→中 | 'zh' 中→德
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

// 本機文章或單字本有變動時通知（同步用）。kind：'content' 內容變動 | 'progress' 只有閱讀或練習進度
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
function readDeleted(key) {
  const deleted = read(key, {});
  if (!deleted || typeof deleted !== 'object' || Array.isArray(deleted)) return {};
  const cutoff = Date.now() - DELETED_KEEP_MS;
  return Object.fromEntries(Object.entries(deleted).filter(([, t]) => t >= cutoff));
}

export function getDeleted() {
  return readDeleted(DELETED_KEY);
}

// 同步後一次寫回所有資料（不觸發變動通知，避免又排一次同步）
export function replaceAll(articles, deleted, vocab, vocabDeleted) {
  write(DELETED_KEY, deleted);
  if (vocab) write(VOCAB_KEY, vocab);
  if (vocabDeleted) write(VOCAB_DELETED_KEY, vocabDeleted);
  return write(ARTICLES_KEY, articles);
}

// ---------- 單字本 ----------

export function loadVocab() {
  const vocab = read(VOCAB_KEY, {});
  return vocab && typeof vocab === 'object' && !Array.isArray(vocab) ? vocab : {};
}

export function getVocabDeleted() {
  return readDeleted(VOCAB_DELETED_KEY);
}

function writeVocab(vocab, kind) {
  const ok = write(VOCAB_KEY, vocab);
  notify(kind);
  return ok;
}

function setVocabDeleted(keys, add) {
  const deleted = getVocabDeleted();
  for (const key of keys) {
    if (add) deleted[key] = Date.now();
    else delete deleted[key];
  }
  write(VOCAB_DELETED_KEY, deleted);
}

// 標記單字。已經有同一個 key 時，加上這個寫法和出處
// word：{ key, display, form, source: { articleId, index, de, zh, form } }
export function markWord({ key, display, form, source }) {
  const vocab = loadVocab();
  const now = Date.now();
  const entry = vocab[key] || { key, display, forms: [], sources: [], weak: false, createdAt: now, reviewedAt: 0 };
  entry.display = display;
  if (!entry.forms.includes(form.toLowerCase())) entry.forms.push(form.toLowerCase());
  if (!entry.sources.some((s) => s.articleId === source.articleId && s.index === source.index)) entry.sources.push(source);
  entry.updatedAt = now;
  vocab[key] = entry;
  setVocabDeleted([key], false);
  return writeVocab(vocab, 'content');
}

// 從單字本移除；回傳被移除的資料（給「復原」用）
export function unmarkWord(key) {
  const vocab = loadVocab();
  const entry = vocab[key];
  if (!entry) return null;
  delete vocab[key];
  setVocabDeleted([key], true);
  writeVocab(vocab, 'content');
  return entry;
}

export function restoreWord(entry) {
  const vocab = loadVocab();
  vocab[entry.key] = { ...entry, updatedAt: Date.now() };
  setVocabDeleted([entry.key], false);
  return writeVocab(vocab, 'content');
}

// 練習結果：答錯或「忘了」標成不熟，答對或「記得」取消不熟
export function setWeak(key, weak) {
  const vocab = loadVocab();
  const entry = vocab[key];
  if (!entry) return;
  entry.weak = weak;
  entry.reviewedAt = Date.now();
  writeVocab(vocab, 'progress');
}

// 查單字出處的句子用：(articleId, index) → 句子物件，文章已刪除時回傳 null
export function sentenceLookup() {
  const byId = new Map(listArticles().map((a) => [a.id, a]));
  return (articleId, index) => byId.get(articleId)?.sentences[index] ?? null;
}

// 文章補上翻譯後，重新整理單字本（同一個原形合併成一筆），回傳最新的單字本。
// 被合併掉的舊 key 留下刪除紀錄，同步時另一台裝置也會合併
export function refreshStoredVocab() {
  const { vocab, removed, changed } = refreshVocab(loadVocab(), sentenceLookup());
  if (changed) {
    if (removed.length) setVocabDeleted(removed, true);
    writeVocab(vocab, 'content');
  }
  return vocab;
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

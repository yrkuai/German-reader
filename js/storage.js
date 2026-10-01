// localStorage 讀寫。所有 key 都加上 gr: 前綴，
// 避免和同一個 <帳號>.github.io 底下的其他專案衝突。

const PREFIX = 'gr:';
const ARTICLES_KEY = 'articles';
const SETTINGS_KEY = 'settings';

const SETTINGS_VERSION = 3;

export const DEFAULT_SETTINGS = {
  voiceURI: null,
  speed: 'native',
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

export function listArticles() {
  const articles = read(ARTICLES_KEY, []);
  return Array.isArray(articles) ? articles : [];
}

export function getArticle(id) {
  return listArticles().find((a) => a.id === id) || null;
}

// 回傳 false 代表沒有成功寫進 localStorage（例如容量已滿）
export function saveArticle(article) {
  const articles = listArticles();
  const i = articles.findIndex((a) => a.id === article.id);
  if (i >= 0) articles[i] = article;
  else articles.push(article);
  return write(ARTICLES_KEY, articles);
}

export function deleteArticle(id) {
  return write(ARTICLES_KEY, listArticles().filter((a) => a.id !== id));
}

export function setLastIndex(id, index) {
  const article = getArticle(id);
  if (!article || article.lastIndex === index) return;
  article.lastIndex = index;
  saveArticle(article);
}

export function createArticle(title, sentences) {
  const now = Date.now();
  return {
    id: 'a_' + now.toString(36) + Math.random().toString(36).slice(2, 6),
    title,
    createdAt: now,
    lastIndex: 0,
    sentences: sentences.map((de) => ({ de, zh: null, words: null })),
  };
}

export function loadSettings() {
  const stored = read(SETTINGS_KEY, {});
  // v1 的預設停頓是 1.5 秒，換語速時會被一起存下來；升級時改成新的預設 1.2 秒
  if (!stored.v && stored.pauseMs === 1500) stored.pauseMs = DEFAULT_SETTINGS.pauseMs;
  // v3 起預設語速改為母語；升級時把舊的預設「一般」改過來
  if ((stored.v || 1) < 3 && stored.speed === 'normal') stored.speed = DEFAULT_SETTINGS.speed;
  const { v, ...settings } = stored;
  return { ...DEFAULT_SETTINGS, ...settings };
}

export function saveSettings(settings) {
  return write(SETTINGS_KEY, { ...settings, v: SETTINGS_VERSION });
}

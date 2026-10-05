// 用 GitHub Secret Gist 同步電腦和手機的文章。
// 沒有設定同步（gr:sync 沒有 token）時什麼都不做，也不會發出任何網路請求。

import {
  listArticles, getDeleted, loadVocab, getVocabDeleted, replaceAll, onArticlesChanged, loadSync, saveSync,
} from './storage.js';
import { mergeEntries, normalizeEntry } from './vocab.js';

const API = 'https://api.github.com';
export const GIST_FILE = 'german-reader-sync.json';
const DATA_VERSION = 2; // v2 加入單字本（vocab、vocabDeleted）；讀到 v1 時單字本當作空的
const DELETED_KEEP_MS = 90 * 24 * 60 * 60 * 1000;
const CONTENT_DELAY_MS = 3000;    // 新增、翻譯、刪除後幾秒同步
const PROGRESS_DELAY_MS = 15000;  // 只有閱讀進度變動時，等久一點，播放時不用每句都上傳
const KEEPALIVE_MAX_BYTES = 60000; // fetch keepalive 的內容上限是 64KB

export const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=German%20Reader';

// ---------- 合併（純函式） ----------

const updatedAt = (a) => a.updatedAt ?? a.createdAt ?? 0;
const readAt = (a) => a.readAt ?? a.createdAt ?? 0;

const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);

function normalize(data) {
  const articles = Array.isArray(data?.articles) ? data.articles : [];
  const deleted = isMap(data?.deleted) ? data.deleted : {};
  const vocab = isMap(data?.vocab) ? data.vocab : {};
  const vocabDeleted = isMap(data?.vocabDeleted) ? data.vocabDeleted : {};
  return { articles, deleted, vocab, vocabDeleted };
}

const sortKeys = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1)));

// 排好順序再轉成字串，用來判斷兩份資料是否相同
function canonical({ articles, deleted, vocab, vocabDeleted }) {
  const sorted = [...articles].sort((a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : 1));
  return JSON.stringify({ articles: sorted, deleted: sortKeys(deleted), vocab: sortKeys(vocab), vocabDeleted: sortKeys(vocabDeleted) });
}

// 兩邊的刪除紀錄聯集，同一個 key 取較新的時間，超過 90 天的清掉
function mergeTombstones(a, b, cutoff) {
  const result = {};
  for (const [id, t] of [...Object.entries(a), ...Object.entries(b)]) {
    if (typeof t === 'number' && t >= cutoff && !(result[id] >= t)) result[id] = t;
  }
  return result;
}

// 單字本以 key 為單位合併；刪除紀錄的時間 ≥ 單字的 updatedAt 時，那個字就刪除
function mergeVocab(local, remote, cutoff) {
  const vocabDeleted = mergeTombstones(remote.vocabDeleted, local.vocabDeleted, cutoff);
  const vocab = {};
  for (const key of new Set([...Object.keys(remote.vocab), ...Object.keys(local.vocab)])) {
    const entry = mergeEntries(local.vocab[key], remote.vocab[key]);
    if (vocabDeleted[key] >= (entry.updatedAt || 0)) continue;
    delete vocabDeleted[key];
    vocab[key] = entry;
  }
  return { vocab, vocabDeleted };
}

// 以文章 id 為單位合併兩邊的資料：
// - 內容（標題、句子、翻譯）取 updatedAt 較新的一方
// - 閱讀進度取 readAt 較新的一方
// - 刪除紀錄的時間 ≥ 文章的 updatedAt 時，那篇文章就刪除
export function mergeData(localData, remoteData, now = Date.now()) {
  const local = normalize(localData);
  const remote = normalize(remoteData);

  const cutoff = now - DELETED_KEEP_MS;
  const deleted = mergeTombstones(remote.deleted, local.deleted, cutoff);

  const byId = new Map();
  for (const a of remote.articles) byId.set(a.id, { remote: a });
  for (const a of local.articles) byId.set(a.id, { ...byId.get(a.id), local: a });

  const articles = [];
  for (const [id, { local: l, remote: r }] of byId) {
    let article;
    if (l && r) {
      const content = updatedAt(r) > updatedAt(l) ? r : l;
      const progress = readAt(r) > readAt(l) ? r : l;
      article = { ...content, updatedAt: updatedAt(content), lastIndex: progress.lastIndex ?? 0, readAt: readAt(progress) };
    } else {
      const only = l || r;
      article = { ...only, updatedAt: updatedAt(only), readAt: readAt(only) };
    }
    if (deleted[id] >= article.updatedAt) continue;
    delete deleted[id]; // 刪除後又復原的文章，不需要再留刪除紀錄
    articles.push(article);
  }

  const data = { articles, deleted, ...mergeVocab(local, remote, cutoff) };
  const result = canonical(data);
  // 比較時把單字整理成相同的格式，只是順序不同不算變動
  const tidy = (d) => ({ ...d, vocab: Object.fromEntries(Object.entries(d.vocab).map(([k, e]) => [k, normalizeEntry(e)])) });
  return {
    data,
    changedLocal: result !== canonical(tidy(local)),
    changedRemote: result !== canonical(tidy(remote)),
  };
}

// ---------- 配對碼 ----------
// 配對碼 = "gr1." + base64url("gistId:token")，放在 QR code 的 #/pair/ 後面

const PAIR_PREFIX = 'gr1.';

export function encodePairCode({ token, gistId }) {
  const b64 = btoa(`${gistId}:${token}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return PAIR_PREFIX + b64;
}

// 可以貼整個網址或只貼配對碼；看不懂就回傳 null
export function decodePairCode(text) {
  const match = String(text || '').trim().match(/gr1\.([A-Za-z0-9_-]+)/);
  if (!match) return null;
  try {
    const b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    const [gistId, token] = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)).split(':');
    if (!/^[0-9a-f]{20,}$/i.test(gistId) || !token || /\s/.test(token)) return null;
    return { gistId, token };
  } catch {
    return null;
  }
}

export function pairUrl(sync) {
  return new URL(`#/pair/${encodePairCode(sync)}`, location.href.split('#')[0]).href;
}

// ---------- GitHub API ----------

export class SyncError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(token, path, { method = 'GET', body, keepalive = false } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      keepalive,
      cache: 'no-store', // 一定要拿到最新的 Gist，不用瀏覽器快取
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SyncError('無法連線到 GitHub。', 0);
  }
  if (res.status === 401) throw new SyncError('GitHub 金鑰無效或已失效，請停止同步後重新設定。', 401);
  if (res.status === 403 || res.status === 404) {
    throw new SyncError(path.startsWith('/gists/')
      ? '找不到同步用的 Gist（可能已被刪除），請停止同步後重新設定。'
      : '這個金鑰沒有 gist 權限，請重新建立金鑰並勾選 gist。', res.status);
  }
  if (!res.ok) throw new SyncError(`GitHub 回應錯誤（${res.status}），請稍後再試。`, res.status);
  return res.status === 204 ? null : res.json();
}

function toContent(data) {
  return JSON.stringify({
    v: DATA_VERSION, articles: data.articles, deleted: data.deleted, vocab: data.vocab, vocabDeleted: data.vocabDeleted,
  });
}

// 找已經存在的同步 Gist；沒有就建立一個 secret gist，並上傳本機文章
export async function findOrCreateGist(token) {
  for (let page = 1; page <= 10; page++) {
    const gists = await api(token, `/gists?per_page=100&page=${page}`);
    const found = gists.find((g) => g.files && GIST_FILE in g.files);
    if (found) return found.id;
    if (gists.length < 100) break;
  }
  const created = await api(token, '/gists', {
    method: 'POST',
    body: {
      description: 'German Reader 同步資料（請勿刪除）',
      public: false,
      files: { [GIST_FILE]: { content: toContent(localData()) } },
    },
  });
  return created.id;
}

async function pull({ token, gistId }) {
  const gist = await api(token, `/gists/${gistId}`);
  const file = gist.files?.[GIST_FILE];
  if (!file) return { articles: [], deleted: {} };
  let text = file.content;
  // 檔案超過 1MB 時 API 只回傳部分內容，改抓完整的 raw 檔
  if (file.truncated) {
    const res = await fetch(file.raw_url, { cache: 'no-store' }).catch(() => null);
    if (!res?.ok) throw new SyncError('無法下載同步資料，請稍後再試。', res?.status ?? 0);
    text = await res.text();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new SyncError('同步資料格式錯誤。', 0);
  }
}

async function push({ token, gistId }, data, keepalive) {
  const body = { files: { [GIST_FILE]: { content: toContent(data) } } };
  // 離開 App 時用 keepalive，讓請求在頁面被暫停後仍能送出（有大小限制）
  const small = JSON.stringify(body).length < KEEPALIVE_MAX_BYTES;
  await api(token, `/gists/${gistId}`, { method: 'PATCH', body, keepalive: keepalive && small });
}

// ---------- 同步流程 ----------

const localData = () => ({ articles: listArticles(), deleted: getDeleted(), vocab: loadVocab(), vocabDeleted: getVocabDeleted() });

// status：{ state: 'off' | 'idle' | 'syncing' | 'error', error, lastSyncAt }
let status = { state: loadSync() ? 'idle' : 'off', error: null };
const statusListeners = new Set();

function setStatus(next) {
  status = { ...status, ...next };
  for (const cb of statusListeners) cb(status);
}

export function getSyncStatus() {
  return { ...status, lastSyncAt: loadSync()?.lastSyncAt ?? null };
}

export function onSyncStatus(cb) {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

let running = null;
let again = false;
let onLocalChanged = () => {};

// 拉下 Gist → 和本機合併 → 寫回本機 → 需要時上傳
export function syncNow({ keepalive = false } = {}) {
  if (!loadSync()) {
    setStatus({ state: 'off', error: null });
    return Promise.resolve();
  }
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    const sync = loadSync();
    setStatus({ state: 'syncing' });
    try {
      const remote = await pull(sync);
      // 拉完才讀本機，合併和寫回之間沒有 await，不會蓋掉剛好在下載時的修改
      const { data, changedLocal, changedRemote } = mergeData(localData(), remote);
      if (changedLocal) {
        replaceAll(data.articles, data.deleted, data.vocab, data.vocabDeleted);
        onLocalChanged();
      }
      if (changedRemote) await push(sync, data, keepalive);
      if (loadSync()?.gistId === sync.gistId) saveSync({ ...sync, lastSyncAt: Date.now() });
      setStatus({ state: 'idle', error: null });
    } catch (e) {
      if (!(e instanceof SyncError)) throw e;
      // 沒有網路時不顯示錯誤，等恢復網路再同步
      if (e.status === 0 && !navigator.onLine) setStatus({ state: 'idle' });
      else setStatus({ state: 'error', error: e.message });
    }
  })().finally(() => {
    running = null;
    if (again) {
      again = false;
      syncNow();
    }
  });
  return running;
}

let timer = null;

function schedule(delay) {
  if (!loadSync()) return;
  // 進度的等待時間比較長；已經排了較短的等待就不要延後
  if (timer && timer.due <= Date.now() + delay) return;
  clearTimeout(timer?.id);
  timer = { due: Date.now() + delay, id: setTimeout(() => { timer = null; syncNow(); }, delay) };
}

// 啟動時呼叫一次：註冊所有觸發同步的時機
export function startSync(onChanged) {
  onLocalChanged = onChanged;
  onArticlesChanged((kind) => schedule(kind === 'progress' ? PROGRESS_DELAY_MS : CONTENT_DELAY_MS));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncNow();
    } else if (timer) {
      // 離開或切走 App 時，把還沒上傳的修改送出去
      clearTimeout(timer.id);
      timer = null;
      syncNow({ keepalive: true });
    }
  });
  window.addEventListener('online', () => syncNow());
  syncNow();
}

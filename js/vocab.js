// 單字本的純邏輯（可在 Node 測試）：單字的 key、底線比對、補翻譯後合併、抽題。
// 讀寫 localStorage 在 storage.js；這裡只處理資料。

import { lookupWord } from './importer.js';
import { tokenize } from './segmenter.js';

// 單字的 key：有原形（名詞、動詞）用原形的小寫，否則用句中寫法的小寫
export function vocabKey(info, form) {
  return (info?.lemma || form).toLowerCase();
}

// 顯示用：名詞帶冠詞（der Tisch），動詞用原形，其他用句中寫法
export function displayOf(info, form) {
  if (info?.type === 'n') {
    const lemma = info.lemma || form;
    if (info.gender === 'pl') return `die ${lemma}`;
    return info.gender ? `${info.gender} ${lemma}` : lemma;
  }
  if (info?.type === 'v' && info.lemma) return info.lemma;
  return form;
}

// 單字本、閃卡用的文法補充：標題已經是原形（名詞帶冠詞），只補名詞的複數
export function pluralNote(info) {
  if (info?.type !== 'n') return '';
  if (info.gender === 'pl') return '只有複數';
  if (info.plural === '') return '無複數';
  return info.plural ? `複數 die ${info.plural}` : '';
}

// 閱讀畫面用：先整理成查詢表 { keys, forms: 寫法 → key }，每個單字只要查兩次
export function buildMarkIndex(vocab) {
  const keys = new Set(Object.keys(vocab));
  const forms = new Map();
  for (const [key, entry] of Object.entries(vocab)) {
    for (const f of entry.forms || []) if (!forms.has(f)) forms.set(f, key);
  }
  return { keys, forms };
}

// 有翻譯：同一個原形的各種變化形都算；沒翻譯：只比對完全相同的寫法（不分大小寫）
// 回傳單字本裡對應的 key，沒有標記就回傳 null
export function findMarked(index, info, form) {
  const key = vocabKey(info, form);
  if (index.keys.has(key)) return key;
  return index.forms.get(form.toLowerCase()) ?? null;
}

const sourceId = (s) => `${s.articleId}#${s.index}`;

// 合併兩筆同一個字的資料（同步、補翻譯後合併都用這個）
export function mergeEntries(a, b) {
  if (!a) return normalizeEntry(b);
  if (!b) return normalizeEntry(a);
  const newer = (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
  const reviewed = (b.reviewedAt || 0) > (a.reviewedAt || 0) ? b : a;
  const sources = new Map();
  for (const s of [...(a.sources || []), ...(b.sources || [])]) if (!sources.has(sourceId(s))) sources.set(sourceId(s), s);
  return normalizeEntry({
    ...newer,
    forms: [...(a.forms || []), ...(b.forms || [])],
    sources: [...sources.values()],
    weak: !!reviewed.weak,
    reviewedAt: reviewed.reviewedAt || 0,
    createdAt: Math.min(a.createdAt || Infinity, b.createdAt || Infinity),
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
  });
}

// 排好順序、去掉重複，兩邊相同的資料轉成字串後會一模一樣
export function normalizeEntry(e) {
  return {
    ...e,
    forms: [...new Set(e.forms || [])].sort(),
    sources: [...(e.sources || [])].sort((x, y) => (sourceId(x) < sourceId(y) ? -1 : sourceId(x) > sourceId(y) ? 1 : 0)),
    weak: !!e.weak,
  };
}

// 文章補上翻譯後，依最新的單字資料重新計算每個出處的 key，同一個原形合併成一筆。
// getSentence(articleId, index) → 句子物件或 null（文章已刪除）
// 回傳 { vocab, removed: [被合併掉的舊 key], changed }
export function refreshVocab(vocab, getSentence, now = Date.now()) {
  const next = {};
  const removed = [];
  let changed = false;
  for (const [key, entry] of Object.entries(vocab)) {
    // 每個出處算出自己的 key；算不出來（文章刪了、沒翻譯）就沿用原本的 key
    const groups = new Map();
    for (const s of entry.sources || []) {
      const sentence = getSentence(s.articleId, s.index);
      const info = sentence ? lookupWord(sentence.words, s.form) : null;
      const k = info?.lemma ? vocabKey(info, s.form) : key;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    if (!groups.size) groups.set(key, []);
    for (const [k, sources] of groups) {
      const part = { ...entry, key: k, sources };
      if (k !== key) {
        changed = true;
        part.forms = sources.map((s) => s.form.toLowerCase());
        part.updatedAt = now;
      }
      next[k] = next[k] ? mergeEntries(next[k], part) : part;
    }
    if (!groups.has(key)) removed.push(key);
  }
  return { vocab: changed ? next : vocab, removed, changed };
}

// 單字目前可顯示的資料：從出處的文章即時查意思；文章刪了就用標記時存的句子
// getSentence(articleId, index) → 句子物件或 null
export function describe(entry, getSentence) {
  let fallback = null;
  for (const s of entry.sources || []) {
    const sentence = getSentence(s.articleId, s.index);
    const info = sentence ? lookupWord(sentence.words, s.form) : null;
    const example = { de: sentence?.de || s.de, zh: sentence?.zh || s.zh || null, form: s.form };
    if (info) return { display: displayOf(info, s.form), meaning: info.meaning || null, info, form: s.form, example };
    fallback ??= { display: entry.display || s.form, meaning: null, info: null, form: s.form, example };
  }
  return fallback || { display: entry.display || entry.key, meaning: null, info: null, form: entry.key, example: null };
}

// 每一輪隨機抽 n 個
export function pickSession(entries, n = 20, random = Math.random) {
  const list = [...entries];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, n);
}

// 把句子切成片段，標出要強調的那個字（例句裡加粗用）
export function highlightTokens(sentence, form) {
  const target = form.toLowerCase();
  return tokenize(sentence).map((t) => ({ text: t.text, hit: t.word && t.text.toLowerCase() === target }));
}

// ---------- 例句填空 ----------

// 把句子裡那個字挖空。要填的是句中原本的寫法（ging，不是原形 gehen）
// 回傳 { before, answer, after, sentenceStart, hint } 或 null（句子裡找不到那個字）
export function makeCloze(sentence, form) {
  const tokens = tokenize(sentence);
  const target = form.toLowerCase();
  const i = tokens.findIndex((t) => t.word && t.text.toLowerCase() === target);
  if (i === -1) return null;
  const before = tokens.slice(0, i).map((t) => t.text).join('');
  const answer = tokens[i].text;
  return {
    before,
    answer,
    after: tokens.slice(i + 1).map((t) => t.text).join(''),
    // 句首（或句號、問號、驚嘆號、冒號之後）的字不算大小寫
    sentenceStart: !/\p{L}/u.test(before) || /[.!?:]["»“”'’)]*\s*$/u.test(before),
    hint: [answer[0], ...Array(answer.length - 1).fill('_')].join(' '),
  };
}

// ä→ae、ö→oe、ü→ue、ß→ss，手機沒有德文鍵盤時也能作答
const fold = (s) => s
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
  .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
  .replace(/ß/g, 'ss').replace(/ẞ/g, 'SS');

// 比對答案：前後空白和標點不算；開頭大寫的字（名詞）在句中要大寫，句首的字不算大小寫
// 回傳 'ok' | 'case'（只有大小寫錯）| 'wrong'
export function checkAnswer(input, { answer, sentenceStart }) {
  const typed = fold(String(input).trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''));
  const expected = fold(answer);
  if (!typed) return 'wrong';
  if (typed === expected) return 'ok';
  if (typed.toLowerCase() !== expected.toLowerCase()) return 'wrong';
  const caseMatters = !sentenceStart && answer[0] !== answer[0].toLowerCase();
  return caseMatters ? 'case' : 'ok';
}

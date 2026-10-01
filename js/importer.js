// 解析 AI 的回覆並合併進文章（純邏輯，可在 Node 測試）

export class ImportError extends Error {}

const TRUNCATED_HINT = '可能是回覆被截斷了，請重新產生，或請 AI「繼續」後把完整的內容貼上。';

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    // 常見的小錯誤：結尾多一個逗號、用了彎引號當 JSON 的引號
    try {
      return JSON.parse(text.replace(/,\s*([\]}])/g, '$1'));
    } catch {
      return undefined;
    }
  }
}

function extractArray(raw) {
  const text = String(raw || '').replace(/```(?:json)?/gi, '').trim();
  if (!text) throw new ImportError('沒有貼上任何內容。');

  const first = text.indexOf('[');
  const last = text.lastIndexOf(']');
  if (first !== -1 && last > first) {
    const parsed = tryParse(text.slice(first, last + 1));
    if (Array.isArray(parsed)) return parsed;
  }

  // 也接受 {"sentences": [...]} 這種外面再包一層的格式
  const objFirst = text.indexOf('{');
  const objLast = text.lastIndexOf('}');
  if (objFirst !== -1 && objLast > objFirst) {
    const parsed = tryParse(text.slice(objFirst, objLast + 1));
    if (parsed && typeof parsed === 'object') {
      const arr = Object.values(parsed).find(Array.isArray);
      if (arr) return arr;
    }
  }

  if (first === -1) throw new ImportError('找不到 JSON 資料。請確認貼上的是 AI 的回覆。');
  throw new ImportError(`JSON 格式錯誤，${TRUNCATED_HINT}`);
}

// 回傳 { items: [{ n, zh, words }], skipped: [{ index, reason }] }
export function parseResponse(raw, sentenceCount) {
  const arr = extractArray(raw);
  const byN = new Map();
  const skipped = [];

  arr.forEach((item, i) => {
    const n = Number(item?.n);
    if (!Number.isInteger(n) || n < 1 || n > sentenceCount) {
      skipped.push({ index: i + 1, reason: `句子編號不正確（${item?.n ?? '沒有編號'}）` });
      return;
    }
    const zh = typeof item.zh === 'string' ? item.zh.trim() : '';
    if (!zh) {
      skipped.push({ index: i + 1, reason: `第 ${n} 句沒有翻譯` });
      return;
    }
    let words = null;
    if (item.w && typeof item.w === 'object' && !Array.isArray(item.w)) {
      words = {};
      for (const [k, v] of Object.entries(item.w)) {
        if (typeof v === 'string' && v.trim()) words[k.trim()] = v.trim();
      }
      if (!Object.keys(words).length) words = null;
    }
    byN.set(n, { n, zh, words }); // 同一句出現兩次時以最後一次為準
  });

  if (!byN.size) {
    throw new ImportError(skipped.length ? `沒有可以匯入的句子：${skipped[0].reason}` : `資料是空的，${TRUNCATED_HINT}`);
  }
  return { items: [...byN.values()].sort((a, b) => a.n - b.n), skipped };
}

// 回傳新的 article（不改動傳入的物件）
export function mergeTranslations(article, items) {
  const sentences = article.sentences.map((s) => ({ ...s }));
  for (const { n, zh, words } of items) {
    sentences[n - 1].zh = zh;
    sentences[n - 1].words = words;
  }
  return { ...article, sentences };
}

export function untranslated(article) {
  return article.sentences.flatMap((s, i) => (s.zh ? [] : [i + 1]));
}

// [1,2,3,5,7,8] → "1–3、5、7–8"
export function formatRanges(numbers) {
  const parts = [];
  for (let i = 0; i < numbers.length; i++) {
    const start = numbers[i];
    while (numbers[i + 1] === numbers[i] + 1) i++;
    parts.push(start === numbers[i] ? `${start}` : `${start}–${numbers[i]}`);
  }
  return parts.join('、');
}

const normalizeApostrophe = (s) => s.replace(/[’‘]/g, "'");

// 先用原字形查，再忽略大小寫查
export function lookupMeaning(words, word) {
  if (!words) return null;
  if (words[word]) return words[word];
  const target = normalizeApostrophe(word).toLowerCase();
  for (const [k, v] of Object.entries(words)) {
    if (normalizeApostrophe(k).toLowerCase() === target) return v;
  }
  return null;
}

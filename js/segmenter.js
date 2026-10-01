// 分句與斷字（純邏輯，不碰 DOM，可在 Node 測試）

// 句點結尾但不是句子結尾的縮寫（全部小寫比對）
const ABBREVIATIONS = [
  'z.b.', 'z. b.', 'd.h.', 'd. h.', 'u.a.', 'u. a.', 'o.ä.', 'u.s.w.',
  'usw.', 'bzw.', 'ca.', 'dr.', 'prof.', 'nr.', 'str.', 'evtl.', 'ggf.',
  'inkl.', 'vgl.', 'bspw.', 'sog.', 'etc.', 'mio.', 'mrd.', 'tel.', 'jh.',
  'hr.', 'fr.', 'abs.', 'ff.', 'max.', 'min.', 'std.', 'geb.',
];

const MONTHS = [
  'januar', 'jänner', 'februar', 'märz', 'april', 'mai', 'juni', 'juli',
  'august', 'september', 'oktober', 'november', 'dezember',
];

// 出現在序數前面的字，例如「der 2. Weltkrieg」「am 3. Oktober」
const ORDINAL_PRECEDERS = new Set([
  'der', 'die', 'das', 'dem', 'den', 'des', 'am', 'im', 'vom', 'zum', 'zur',
  'beim', 'ab', 'bis', 'seit', 'ein', 'eine', 'einem', 'einen', 'einer',
  'jeden', 'jedem', 'jeder', 'jedes', 'mein', 'meine', 'sein', 'seine', 'ihr', 'ihre',
]);

const OPENING_PUNCT = /^[(\[„“"»«‚‘']+/;

function endsWithAbbreviation(text) {
  const lower = text.toLowerCase();
  return ABBREVIATIONS.some((abbr) => {
    if (!lower.endsWith(abbr)) return false;
    const before = lower.slice(0, lower.length - abbr.length);
    return before === '' || /[\s(\[„“"»«‚‘']$/.test(before);
  });
}

function shouldMerge(prev, next) {
  // 原文換行一律視為句子邊界
  if (/\n\s*$/.test(prev)) return false;

  const p = prev.trimEnd();
  if (endsWithAbbreviation(p)) return true;

  const ordinal = p.match(/(?:^|\s)(\S*?)\s*\d{1,3}\.$/);
  if (ordinal) {
    const n = next.trimStart();
    const firstWord = n.split(/\s+/)[0].replace(/[^\p{L}]/gu, '').toLowerCase();
    const wordBefore = p.replace(/\s*\d{1,3}\.$/, '').split(/\s+/).pop().replace(OPENING_PUNCT, '').toLowerCase();
    if (/^\p{Ll}/u.test(n)) return true;
    if (MONTHS.includes(firstWord)) return true;
    if (ORDINAL_PRECEDERS.has(wordBefore)) return true;
  }
  return false;
}

function rawSegments(text) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const seg = new Intl.Segmenter('de', { granularity: 'sentence' });
    return Array.from(seg.segment(text), (s) => s.segment);
  }
  // 舊瀏覽器的備援：在 . ! ? … （可接收尾引號）或換行處切開
  return text.match(/[^.!?…\n]+(?:[.!?…]+["“”»«'’]?\s*|\n+|$)/g) || [];
}

function clean(sentence) {
  return sentence.replace(/\s+/g, ' ').trim();
}

export function splitSentences(text) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n');
  const merged = [];
  for (const seg of rawSegments(normalized)) {
    if (merged.length && shouldMerge(merged[merged.length - 1], seg)) {
      merged[merged.length - 1] += seg;
    } else {
      merged.push(seg);
    }
  }
  return merged.map(clean).filter((s) => /[\p{L}\p{N}]/u.test(s));
}

const WORD_RE = /\p{L}+(?:[-'’]\p{L}+)*/gu;

// 把句子切成單字與非單字片段，接起來會等於原句
export function tokenize(sentence) {
  const tokens = [];
  let last = 0;
  for (const m of sentence.matchAll(WORD_RE)) {
    if (m.index > last) tokens.push({ text: sentence.slice(last, m.index), word: false });
    tokens.push({ text: m[0], word: true });
    last = m.index + m[0].length;
  }
  if (last < sentence.length) tokens.push({ text: sentence.slice(last), word: false });
  return tokens;
}

// 動詞人稱變化練習的純邏輯（可在 Node 測試）：整理輸入、提示詞、匯入檢查、挖空、比對、同步合併。
// 讀寫 localStorage 在 storage.js；格式見 PLAN-verbs.md。

import { extractArray } from './importer.js';
import { tokenize } from './segmenter.js';
import { checkAnswer } from './vocab.js';

export const PERSONS = ['ich', 'du', 'er', 'wir', 'ihr', 'sie'];
export const PERSON_LABELS = { ich: 'ich', du: 'du', er: 'er/sie/es', wir: 'wir', ihr: 'ihr', sie: 'sie/Sie' };
export const VERB_TYPES = ['規則', '換母音', '不規則'];
export const VERB_BATCH_SIZE = 10;

// 每個人稱可以當主詞的字（題目裡加粗，提醒看主詞決定變化形）
const SUBJECTS = { ich: ['ich'], du: ['du'], er: ['er', 'sie', 'es', 'man'], wir: ['wir'], ihr: ['ihr'], sie: ['sie'] };

const LETTERS = /^\p{L}+$/u;
// AI 有時會用這些字表示「沒有資料」，不要顯示成文字
const EMPTY = /^(null|none|undefined|n\/a|-|—|–)$/i;
const clean = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return EMPTY.test(s) ? '' : s;
};

export const verbKey = (v) => v.trim().toLowerCase();

// 可分動詞顯示成「stehe … auf」
export function formDisplay(verb, p) {
  const form = verb.forms[p];
  return verb.prefix ? `${form} … ${verb.prefix}` : form;
}

// ---------- 新增動詞：整理輸入 ----------

// 一行一個，也接受逗號、頓號、分號或空白分隔；去掉重複和已經建立的動詞（不分大小寫）
export function dedupeInput(text, existingKeys = new Set()) {
  const seen = new Set(existingKeys);
  const result = [];
  for (const raw of String(text || '').split(/[\s,，、;；]+/)) {
    const v = raw.trim();
    if (!v || !LETTERS.test(v)) continue;
    const key = verbKey(v);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(v);
  }
  return result;
}

export function makeVerbBatches(verbs, size = VERB_BATCH_SIZE) {
  const batches = [];
  for (let i = 0; i < verbs.length; i += size) batches.push(verbs.slice(i, i + size));
  return batches;
}

export function buildVerbPrompt(verbs) {
  return `你是德語老師。我是剛開始學德語的學生，母語是繁體中文，還沒學過時態，現在只學「現在式」。

請為下面每個動詞提供：
1. "v"：不定式（照我給的拼法）
2. "zh"：繁體中文意思（簡短）
3. "type"：規則、換母音、不規則，三選一
4. "tip"：一句給初學者的提示，說明變化時要注意什麼（例如「du 和 er/sie/es 的 a 變成 ä」）；規則動詞可以寫「規則變化」
5. "prefix"：如果是可分動詞，填可分的前綴（例如 aufstehen 填 "auf"）；不是可分動詞填 null
6. "forms"：現在式六個人稱的變化形，key 用 ich、du、er、wir、ihr、sie
   - er 代表 er/sie/es，sie 代表 sie/Sie
   - 可分動詞只寫變化的那一部分，不要寫前綴（aufstehen 的 ich 寫 "stehe"）
7. "s"：例句，每個人稱各 2 句
   - "p"：人稱（ich、du、er、wir、ihr、sie）
   - "de"：德文母語者日常真的會說的口語句子，不要課本式的造句
     - 長短不限，難度靠字彙控制：用常見的字，一句裡不常見的字最多一兩個
     - 同一個人稱的 2 句：1 句是簡短的口語反應或問句，1 句是比較完整的日常句子
     - 情境要分散，輪流用：朋友聊天、家裡、工作、餐廳或購物、傳訊息
     - 可以自然地用語氣詞（doch、mal、ja、halt、eben…）
     - 動詞要寫完整的標準形，不要縮寫（寫 habe 不寫 hab，寫 gibt es 不寫 gibt's）
     - 一定要寫出主詞，不要省略
   - "zh"：自然口語的繁體中文翻譯（台灣用語），不要逐字翻
   - 句子裡必須用到這個人稱的變化形，而且是這個動詞本身在變化（不要寫成 muss/will + 不定式）；er 可以用 er、sie、es 或名字當主詞，sie 可以用 sie（他們）或 Sie（您）
   - 可分動詞的前綴要照德文語序放在句尾；不要把可分動詞放在 weil、dass 等子句裡（前綴會黏回去）

規則：
- 只用現在式，不要用其他時態
- 只回傳 JSON 陣列，不要任何其他文字，不要用 Markdown

格式範例：
[
  {
    "v": "fahren",
    "zh": "搭乘、開車",
    "type": "換母音",
    "tip": "du 和 er/sie/es 的 a 變成 ä",
    "prefix": null,
    "forms": { "ich": "fahre", "du": "fährst", "er": "fährt", "wir": "fahren", "ihr": "fahrt", "sie": "fahren" },
    "s": [
      { "p": "ich", "de": "Ich fahre schnell zum Supermarkt.", "zh": "我去一下超市。" },
      { "p": "du", "de": "Fährst du mich kurz zum Bahnhof?", "zh": "你可以載我去一下車站嗎？" }
    ]
  },
  {
    "v": "aufstehen",
    "zh": "起床",
    "type": "不規則",
    "tip": "可分動詞：stehen 變化，auf 放在句尾",
    "prefix": "auf",
    "forms": { "ich": "stehe", "du": "stehst", "er": "steht", "wir": "stehen", "ihr": "steht", "sie": "stehen" },
    "s": [
      { "p": "ich", "de": "Morgen stehe ich mal nicht so früh auf.", "zh": "明天我不要那麼早起了。" }
    ]
  }
]

動詞：
${verbs.join('\n')}`;
}

// ---------- 匯入檢查 ----------

// 找出句子裡的變化形（和可分動詞的前綴）是第幾個片段；找不到回傳 null
function locate(tokens, form, prefix) {
  const target = form.toLowerCase();
  const i = tokens.findIndex((t) => t.word && t.text.toLowerCase() === target);
  if (i === -1) return null;
  if (!prefix) return { form: i, prefix: -1 };
  // 前綴在變化形後面，取最後一個（句尾）
  let j = -1;
  for (let k = tokens.length - 1; k > i; k--) {
    if (tokens[k].word && tokens[k].text.toLowerCase() === prefix) { j = k; break; }
  }
  return j === -1 ? null : { form: i, prefix: j };
}

export function sentenceHasForm(de, form, prefix) {
  return !!locate(tokenize(de), form, prefix);
}

const sameSentence = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// 解析一個動詞的例句；不合格的列進 skipped
function parseSentences(list, verb, skipped, existing = []) {
  const result = [];
  for (const s of Array.isArray(list) ? list : []) {
    const p = clean(s?.p).toLowerCase();
    const de = clean(s?.de);
    if (!PERSONS.includes(p)) {
      skipped.push({ label: verb.v, reason: `有一句例句的人稱不正確（${clean(s?.p) || '沒有人稱'}）` });
      continue;
    }
    if (!de) continue;
    if (!sentenceHasForm(de, verb.forms[p], verb.prefix)) {
      skipped.push({ label: verb.v, reason: `${PERSON_LABELS[p]} 的例句「${de}」沒有出現 ${formDisplay(verb, p)}` });
      continue;
    }
    if ([...existing, ...result].some((x) => sameSentence(x.de, de))) continue;
    result.push({ p, de, zh: clean(s?.zh) || null });
  }
  return result;
}

// 解析「新增動詞」的回覆。已經存在的動詞直接略過（不列進 skipped）
// 回傳 { verbs: [Verb], skipped: [{ label, reason }] }；格式錯誤時丟出 ImportError
export function parseVerbs(raw, existingKeys = new Set(), now = Date.now()) {
  const arr = extractArray(raw);
  const seen = new Set(existingKeys);
  const verbs = [];
  const skipped = [];
  for (const item of arr) {
    const v = clean(item?.v);
    if (!v || !LETTERS.test(v)) {
      skipped.push({ label: v || '（沒有動詞）', reason: '不是一個動詞' });
      continue;
    }
    const key = verbKey(v);
    if (seen.has(key)) continue;

    const forms = {};
    const missing = PERSONS.filter((p) => {
      const f = clean(item?.forms?.[p]);
      if (!LETTERS.test(f)) return true;
      forms[p] = f;
      return false;
    });
    if (missing.length) {
      skipped.push({ label: v, reason: `缺少 ${missing.map((p) => PERSON_LABELS[p]).join('、')} 的變化形` });
      continue;
    }

    const prefix = clean(item?.prefix).toLowerCase();
    const type = clean(item?.type);
    const verb = {
      key,
      v,
      zh: clean(item?.zh),
      type: VERB_TYPES.includes(type) ? type : '',
      tip: clean(item?.tip),
      prefix: LETTERS.test(prefix) ? prefix : null,
      tense: 'present',
      forms,
      sentences: [],
      weak: {},
      createdAt: now,
      updatedAt: now,
    };
    verb.sentences = parseSentences(item?.s, verb, skipped);
    seen.add(key);
    verbs.push(verb);
  }
  return { verbs, skipped };
}

// ---------- 題目 ----------

// 把句子裡的動詞（可分動詞連前綴）挖空。
// 回傳 { segments: [{ text } | { blank: 0|1 }], answers: [變化形, 前綴?], sentenceStart, subject: 片段位置 }
export function makeVerbCloze(de, form, prefix, p) {
  const tokens = tokenize(de);
  const at = locate(tokens, form, prefix);
  if (!at) return null;
  const segments = [];
  let subject = -1;
  const subjects = SUBJECTS[p] || [];
  tokens.forEach((t, k) => {
    if (k === at.form) segments.push({ blank: 0 });
    else if (k === at.prefix) segments.push({ blank: 1 });
    else {
      if (subject === -1 && t.word && subjects.includes(t.text.toLowerCase())) subject = segments.length;
      segments.push({ text: t.text });
    }
  });
  const before = tokens.slice(0, at.form).map((t) => t.text).join('');
  return {
    segments,
    answers: prefix ? [tokens[at.form].text, tokens[at.prefix].text] : [tokens[at.form].text],
    sentenceStart: !/\p{L}/u.test(before) || /[.!?:]["»“”'’)]*\s*$/u.test(before),
    subject,
  };
}

// 沒有例句的人稱：題目只有主詞，例如「du ______」（可分動詞「ich ___ ___」）
export function pronounCloze(verb, p) {
  const segments = [{ text: `${PERSON_LABELS[p]} ` }, { blank: 0 }];
  if (verb.prefix) segments.push({ text: ' ' }, { blank: 1 });
  return {
    segments,
    answers: verb.prefix ? [verb.forms[p], verb.prefix] : [verb.forms[p]],
    sentenceStart: false,
    subject: 0,
  };
}

// 比對答案。inputs：每個空格的輸入；可分動詞在第一格打「stehe auf」也算對
// 回傳 'ok' | 'case'（只有大小寫錯）| 'wrong'
export function checkVerbAnswer(inputs, cloze) {
  let values = inputs.map((x) => String(x ?? '').trim());
  if (cloze.answers.length === 2 && !values[1]) {
    const parts = values[0].split(/\s*(?:…|\.\.\.|\s)\s*/).filter(Boolean);
    if (parts.length === 2) values = parts;
  }
  const results = cloze.answers.map((answer, i) =>
    checkAnswer(values[i] || '', { answer, sentenceStart: i === 0 && cloze.sentenceStart }));
  if (results.every((r) => r === 'ok')) return 'ok';
  return results.includes('wrong') ? 'wrong' : 'case';
}

// 例句裡強調動詞（可分動詞連前綴）
export function highlightVerb(de, form, prefix) {
  const tokens = tokenize(de);
  const at = locate(tokens, form, prefix);
  return tokens.map((t, k) => ({ text: t.text, hit: !!at && (k === at.form || k === at.prefix) }));
}

// 換母音的動詞：標出變化形裡和字根不同的字母，例如 f[ä]hrst、s[ie]hst
// 回傳 [{ text, hit }]
export function markStemChange(verb, p) {
  const form = verb.forms[p];
  if (verb.type !== '換母音') return [{ text: form, hit: false }];
  const inf = verb.prefix && verb.v.toLowerCase().startsWith(verb.prefix) ? verb.v.slice(verb.prefix.length) : verb.v;
  const stem = inf.toLowerCase().replace(/e?n$/, '');
  const parts = [];
  for (let i = 0; i < form.length; i++) {
    const hit = i < stem.length && form[i].toLowerCase() !== stem[i];
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += form[i];
    else parts.push({ text: form[i], hit });
  }
  return parts;
}

// ---------- 同步合併 ----------

const sentenceSort = (a, b) => (a.de.toLowerCase() < b.de.toLowerCase() ? -1 : a.de.toLowerCase() > b.de.toLowerCase() ? 1 : 0);

// 排好順序，兩邊相同的資料轉成字串後會一模一樣
export function normalizeVerb(v) {
  return { ...v, sentences: [...(v.sentences || [])].sort(sentenceSort), weak: { ...(v.weak || {}) } };
}

// 同一個動詞兩邊都有時合併：例句取聯集；變化形等內容取 updatedAt 較新的；不熟每個人稱各取較新的
export function mergeVerbs(a, b) {
  if (!a) return normalizeVerb(b);
  if (!b) return normalizeVerb(a);
  const newer = (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
  const sentences = [];
  for (const s of [...(a.sentences || []), ...(b.sentences || [])]) {
    if (!sentences.some((x) => sameSentence(x.de, s.de))) sentences.push(s);
  }
  const weak = {};
  for (const p of PERSONS) {
    const x = a.weak?.[p];
    const y = b.weak?.[p];
    const pick = !x ? y : !y ? x : (y.at || 0) > (x.at || 0) ? y : x;
    if (pick) weak[p] = pick;
  }
  return normalizeVerb({
    ...newer,
    sentences,
    weak,
    createdAt: Math.min(a.createdAt || Infinity, b.createdAt || Infinity),
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
  });
}

export const hasWeak = (verb) => PERSONS.some((p) => verb.weak?.[p]?.weak);

// ---------- 增加例句 ----------

export function buildMorePrompt(verbs) {
  const blocks = verbs.map((v) => [
    `${v.v}（${PERSONS.map((p) => `${p}: ${formDisplay(v, p)}`).join('、')}）`,
    ...(v.sentences.length ? v.sentences.map((s) => `  - ${s.de}`) : ['  （目前沒有例句）']),
  ].join('\n'));
  return `你是德語老師。我是剛開始學德語的學生，母語是繁體中文，現在只學「現在式」。

請為下面每個動詞，每個人稱（ich、du、er、wir、ihr、sie）各再給 2 句新的例句。
- 不可以和「現有例句」重複，也不要只換一個字
- 德文母語者日常真的會說的口語句子，不要課本式的造句
- 長短不限，難度靠字彙控制：用常見的字，一句裡不常見的字最多一兩個
- 同一個人稱的 2 句：1 句是簡短的口語反應或問句，1 句是比較完整的日常句子
- 情境要分散，輪流用：朋友聊天、家裡、工作、餐廳或購物、傳訊息
- 可以自然地用語氣詞（doch、mal、ja、halt、eben…）
- 動詞要寫完整的標準形，不要縮寫（寫 habe 不寫 hab，寫 gibt es 不寫 gibt's）
- 一定要寫出主詞，不要省略
- 中文翻譯要自然口語（台灣用語），不要逐字翻
- 句子裡必須用到這個人稱的變化形，而且是這個動詞本身在變化（不要寫成 muss/will + 不定式）；er 可以用 er、sie、es 或名字當主詞，sie 可以用 sie（他們）或 Sie（您）
- 可分動詞的前綴要照德文語序放在句尾；不要把可分動詞放在 weil、dass 等子句裡（前綴會黏回去）
- 只用現在式
- 只回傳 JSON 陣列，不要任何其他文字，不要用 Markdown

格式：
[
  { "v": "fahren", "s": [ { "p": "ich", "de": "...", "zh": "..." } ] }
]

動詞與現有例句：
${blocks.join('\n\n')}`;
}

// 解析「增加例句」的回覆：只接受已經建立的動詞，和現有例句相同的略過
// 回傳 { updates: [{ key, sentences: [新例句] }], skipped }
export function parseMoreSentences(raw, verbs) {
  const arr = extractArray(raw);
  const updates = [];
  const skipped = [];
  for (const item of arr) {
    const v = clean(item?.v);
    const verb = v ? verbs[verbKey(v)] : null;
    if (!verb) {
      skipped.push({ label: v || '（沒有動詞）', reason: '不是已經建立的動詞' });
      continue;
    }
    const existing = [...verb.sentences, ...(updates.find((u) => u.key === verb.key)?.sentences || [])];
    const sentences = parseSentences(item?.s, verb, skipped, existing);
    if (!sentences.length) continue;
    const update = updates.find((u) => u.key === verb.key);
    if (update) update.sentences.push(...sentences);
    else updates.push({ key: verb.key, sentences });
  }
  return { updates, skipped };
}

// ---------- 總練習 ----------

export const MIX_SIZES = [10, 20, 30];

function shuffle(list, random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 從勾選的動詞出題：「動詞＋人稱」不重複；不熟的優先；其餘依人稱輪流抽，讓六個人稱平均
// 回傳 [{ key, p }]，最多 n 題（組合不足時全部出）
export function pickCombos(verbs, n, random = Math.random) {
  const all = verbs.flatMap((v) => PERSONS.map((p) => ({ key: v.key, p, weak: !!v.weak?.[p]?.weak })));
  const picked = shuffle(all.filter((c) => c.weak), random).slice(0, n);
  const byPerson = new Map(PERSONS.map((p) => [p, shuffle(all.filter((c) => !c.weak && c.p === p), random)]));
  const order = shuffle(PERSONS, random);
  while (picked.length < n && [...byPerson.values()].some((list) => list.length)) {
    // 依人稱輪流抽；先抽目前題數最少的人稱
    const counts = Object.fromEntries(PERSONS.map((p) => [p, picked.filter((c) => c.p === p).length]));
    const p = order.filter((x) => byPerson.get(x).length).sort((a, b) => counts[a] - counts[b])[0];
    picked.push(byPerson.get(p).shift());
  }
  return shuffle(picked, random).map(({ key, p }) => ({ key, p }));
}

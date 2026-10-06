import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  vocabKey, displayOf, buildMarkIndex, findMarked, mergeEntries, refreshVocab, describe, pickSession, highlightTokens, pluralNote, makeCloze, checkAnswer, createRound,
  dayKey, addDays, nextSrs, pickDaily,
} from '../js/vocab.js';
import { lookupWord } from '../js/importer.js';

const gehen = { m: '去', t: 'v', l: 'gehen' };
const tisch = { m: '桌子', t: 'n', l: 'Tisch', g: 'der', pl: 'Tische' };

test('單字的 key：有原形用原形小寫，否則用句中寫法小寫', () => {
  assert.equal(vocabKey(lookupWord({ ging: gehen }, 'ging'), 'ging'), 'gehen');
  assert.equal(vocabKey(lookupWord({ Tische: tisch }, 'Tische'), 'Tische'), 'tisch');
  assert.equal(vocabKey(lookupWord({ schnell: '快' }, 'schnell'), 'schnell'), 'schnell');
  assert.equal(vocabKey(null, 'Haus'), 'haus');
});

test('顯示：名詞帶冠詞、動詞用原形、其他用句中寫法', () => {
  assert.equal(displayOf(lookupWord({ Tische: tisch }, 'Tische'), 'Tische'), 'der Tisch');
  assert.equal(displayOf({ type: 'n', lemma: 'Leute', gender: 'pl' }, 'Leute'), 'die Leute');
  assert.equal(displayOf(lookupWord({ ging: gehen }, 'ging'), 'ging'), 'gehen');
  assert.equal(displayOf(null, 'schnell'), 'schnell');
});

test('底線：有翻譯時同原形的變化形都算；沒翻譯時只比對相同寫法', () => {
  const index = buildMarkIndex({ gehen: { key: 'gehen', forms: ['ging'] } });
  // 有翻譯的句子
  assert.equal(findMarked(index, { lemma: 'gehen', type: 'v' }, 'geht'), 'gehen');
  // 沒翻譯的句子：只認得標記時的寫法，不分大小寫
  assert.equal(findMarked(index, null, 'Ging'), 'gehen');
  assert.equal(findMarked(index, null, 'geht'), null);
  assert.equal(findMarked(index, null, 'Haus'), null);
});

test('合併同一個字：寫法和出處取聯集、不熟看較新的練習結果', () => {
  const a = { key: 'gehen', display: 'gehen', forms: ['ging'], sources: [{ articleId: 'x', index: 0, form: 'ging' }], weak: true, reviewedAt: 100, createdAt: 10, updatedAt: 50 };
  const b = { key: 'gehen', display: 'gehen', forms: ['geht', 'ging'], sources: [{ articleId: 'y', index: 2, form: 'geht' }, { articleId: 'x', index: 0, form: 'ging' }], weak: false, reviewedAt: 200, createdAt: 20, updatedAt: 60 };
  const m = mergeEntries(a, b);
  assert.deepEqual(m.forms, ['geht', 'ging']);
  assert.equal(m.sources.length, 2);
  assert.equal(m.weak, false);
  assert.equal(m.reviewedAt, 200);
  assert.equal(m.createdAt, 10);
  assert.equal(m.updatedAt, 60);
  // 順序不同，合併結果一樣
  assert.deepEqual(mergeEntries(b, a), m);
});

test('補上翻譯後：句中寫法的 key 合併到原形', () => {
  const sentences = {
    'a#0': { de: 'Ich ging nach Hause.', words: { ging: gehen } },
    'b#1': { de: 'Er geht.', words: { geht: gehen } },
  };
  const get = (id, i) => sentences[`${id}#${i}`] ?? null;
  const vocab = {
    ging: { key: 'ging', display: 'ging', forms: ['ging'], sources: [{ articleId: 'a', index: 0, form: 'ging' }], weak: true, reviewedAt: 5, createdAt: 1, updatedAt: 1 },
    gehen: { key: 'gehen', display: 'gehen', forms: ['geht'], sources: [{ articleId: 'b', index: 1, form: 'geht' }], weak: false, reviewedAt: 3, createdAt: 2, updatedAt: 2 },
  };
  const { vocab: next, removed, changed } = refreshVocab(vocab, get, 100);
  assert.equal(changed, true);
  assert.deepEqual(removed, ['ging']);
  assert.deepEqual(Object.keys(next), ['gehen']);
  assert.deepEqual(next.gehen.forms, ['geht', 'ging']);
  assert.equal(next.gehen.sources.length, 2);
  assert.equal(next.gehen.weak, true); // ging 的練習結果比較新
});

test('沒有變化時不重寫；文章刪除後保留原本的 key', () => {
  const vocab = { haus: { key: 'haus', forms: ['haus'], sources: [{ articleId: 'gone', index: 0, form: 'Haus' }] } };
  const r = refreshVocab(vocab, () => null);
  assert.equal(r.changed, false);
  assert.equal(r.vocab, vocab);
});

test('describe：從文章即時查意思；文章刪除後用快照的句子', () => {
  const entry = { key: 'gehen', display: 'ging', sources: [{ articleId: 'a', index: 0, form: 'ging', de: 'Ich ging.', zh: '我走了。' }] };
  const live = describe(entry, () => ({ de: 'Ich ging.', zh: '我走了。', words: { ging: gehen } }));
  assert.equal(live.display, 'gehen');
  assert.equal(live.meaning, '去');
  assert.equal(live.example.zh, '我走了。');
  const gone = describe(entry, () => null);
  assert.equal(gone.meaning, null);
  assert.equal(gone.display, 'ging');
  assert.equal(gone.example.de, 'Ich ging.');
});

test('每一輪最多抽 20 個，不重複', () => {
  const entries = Array.from({ length: 30 }, (_, i) => ({ key: `w${i}` }));
  const picked = pickSession(entries, 20);
  assert.equal(picked.length, 20);
  assert.equal(new Set(picked.map((e) => e.key)).size, 20);
  assert.equal(pickSession(entries.slice(0, 5), 20).length, 5);
});

test('例句中強調那個字（不分大小寫）', () => {
  const parts = highlightTokens('Ging er? Ich ging.', 'ging');
  assert.deepEqual(parts.filter((p) => p.hit).map((p) => p.text), ['Ging', 'ging']);
  assert.equal(parts.map((p) => p.text).join(''), 'Ging er? Ich ging.');
});

test('單字本的文法補充：只補名詞的複數', () => {
  assert.equal(pluralNote(lookupWord({ Tische: tisch }, 'Tische')), '複數 die Tische');
  assert.equal(pluralNote({ type: 'n', lemma: 'Milch', gender: 'die', plural: '' }), '無複數');
  assert.equal(pluralNote({ type: 'n', lemma: 'Leute', gender: 'pl' }), '只有複數');
  assert.equal(pluralNote(lookupWord({ ging: gehen }, 'ging')), '');
  assert.equal(pluralNote(null), '');
});

test('例句填空：挖空句中原本的寫法，給字首提示', () => {
  const c = makeCloze('Ich ging nach Hause.', 'ging');
  assert.equal(c.before, 'Ich ');
  assert.equal(c.answer, 'ging');
  assert.equal(c.after, ' nach Hause.');
  assert.equal(c.hint, 'g _ _ _');
  assert.equal(c.sentenceStart, false);
  assert.equal(makeCloze('Ich ging.', 'gehen'), null);
});

test('例句填空：判斷句首（包含句號之後）', () => {
  assert.equal(makeCloze('Haus ist groß.', 'haus').sentenceStart, true);
  assert.equal(makeCloze('Ich ging. Die Häuser sind alt.', 'die').sentenceStart, true);
  assert.equal(makeCloze('„Ja", sagte er.', 'ja').sentenceStart, true);
  assert.equal(makeCloze('Das Haus ist groß.', 'haus').sentenceStart, false);
});

test('比對答案：變音、ß、標點、大小寫', () => {
  const ging = { answer: 'ging', sentenceStart: false };
  assert.equal(checkAnswer('ging', ging), 'ok');
  assert.equal(checkAnswer('  ging. ', ging), 'ok');
  assert.equal(checkAnswer('Ging', ging), 'ok');      // 不是名詞，大小寫不算
  assert.equal(checkAnswer('gieng', ging), 'wrong');
  assert.equal(checkAnswer('', ging), 'wrong');

  const muede = { answer: 'müde', sentenceStart: false };
  assert.equal(checkAnswer('muede', muede), 'ok');
  assert.equal(checkAnswer('müde', muede), 'ok');
  assert.equal(checkAnswer('mude', muede), 'wrong');

  assert.equal(checkAnswer('Strasse', { answer: 'Straße', sentenceStart: false }), 'ok');
  assert.equal(checkAnswer('Haeuser', { answer: 'Häuser', sentenceStart: false }), 'ok');

  // 名詞在句中要大寫；句首不算
  assert.equal(checkAnswer('haus', { answer: 'Haus', sentenceStart: false }), 'case');
  assert.equal(checkAnswer('das', { answer: 'Das', sentenceStart: true }), 'ok');
});

test('一輪練習：答錯放回最後，全部答對才結束，第一次的結果決定不熟', () => {
  const round = createRound(['A', 'B', 'C']);
  assert.equal(round.remaining, 3);
  assert.equal(round.current, 'A');
  assert.equal(round.answer(true), true);   // A 第一次就對
  assert.equal(round.answer(false), true);  // B 第一次錯 → 放到最後
  assert.equal(round.current, 'C');
  assert.equal(round.answer(true), true);   // C
  assert.equal(round.current, 'B');         // 回頭再問 B
  assert.equal(round.answer(false), false); // 還是錯，不是第一次
  assert.equal(round.current, 'B');
  assert.equal(round.answer(true), false);
  assert.equal(round.done, true);
  assert.equal(round.current, null);
  assert.equal(round.firstTryCorrect(), 2);
  assert.deepEqual(round.firstTryWrong(), ['B']);
});

// ---------- 閃卡排程 ----------
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

test('日期：當地時間 0 點換日，加天數可跨月', () => {
  assert.equal(dayKey(at(2026, 10, 6, 0)), '2026-10-06');
  assert.equal(dayKey(at(2026, 10, 6, 23)), '2026-10-06');
  assert.equal(addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('排程：答對間隔 1 → 3 → 7 → 14 → 30 天，最長 30；答錯歸零、明天再考', () => {
  const now = at(2026, 10, 6);
  let srs;
  const dues = [];
  for (let i = 0; i < 6; i++) {
    srs = nextSrs(srs, true, now);
    dues.push([srs.interval, srs.due]);
  }
  assert.deepEqual(dues, [
    [1, '2026-10-07'], [3, '2026-10-09'], [7, '2026-10-13'], [14, '2026-10-20'], [30, '2026-11-05'], [30, '2026-11-05'],
  ]);
  srs = nextSrs(srs, false, now);
  assert.deepEqual(srs, { interval: 0, due: '2026-10-07', on: '2026-10-06', at: now });
  assert.equal(nextSrs(srs, true, now).interval, 1);
});

test('今天的閃卡：先到期的（越早越先），再補新卡（不熟先、再由舊到新），扣掉今天做過的', () => {
  const now = at(2026, 10, 6);
  const e = (key, extra) => ({ key, createdAt: 0, ...extra });
  const entries = [
    e('later', { srs: { interval: 3, due: '2026-10-07', on: '2026-10-04', at: 0 } }),
    e('due', { srs: { interval: 3, due: '2026-10-06', on: '2026-10-03', at: 0 } }),
    e('overdue', { srs: { interval: 1, due: '2026-10-01', on: '2026-09-30', at: 0 } }),
    e('newOld', { createdAt: 1 }),
    e('newWeak', { createdAt: 5, weak: true }),
    e('newYoung', { createdAt: 9 }),
  ];
  assert.deepEqual(pickDaily(entries, now, 12).map((x) => x.key), ['overdue', 'due', 'newWeak', 'newOld', 'newYoung']);
  assert.deepEqual(pickDaily(entries, now, 3).map((x) => x.key), ['overdue', 'due', 'newWeak']);
  // 今天已經作答 2 張：只剩 1 張額度
  const done = [...entries, e('a', { srs: { interval: 1, due: '2026-10-07', on: '2026-10-06', at: now } }),
    e('b', { srs: { interval: 0, due: '2026-10-07', on: '2026-10-06', at: now } })];
  assert.deepEqual(pickDaily(done, now, 3).map((x) => x.key), ['overdue']);
  assert.deepEqual(pickDaily(done, now, 2), []);
});

test('合併：排程取較晚作答的一方，和 reviewedAt 無關', () => {
  const base = { key: 'gehen', forms: [], sources: [], createdAt: 1, updatedAt: 1 };
  const a = { ...base, reviewedAt: 50, srs: { interval: 3, due: '2026-10-09', on: '2026-10-06', at: 10 } };
  const b = { ...base, reviewedAt: 20, srs: { interval: 7, due: '2026-10-14', on: '2026-10-07', at: 20 } };
  assert.equal(mergeEntries(a, b).srs.interval, 7);
  assert.equal(mergeEntries(b, a).srs.interval, 7);
  assert.equal(mergeEntries({ ...base }, b).srs.interval, 7);
  assert.equal(mergeEntries({ ...base }, { ...base }).srs, undefined);
});

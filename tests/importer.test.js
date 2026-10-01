import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseResponse, mergeTranslations, untranslated, formatRanges, lookupMeaning, ImportError,
} from '../js/importer.js';
import { makeBatches, buildPrompt } from '../js/prompt.js';

const article = {
  id: 'a1', title: 't', createdAt: 0, lastIndex: 0,
  sentences: [
    { de: 'Ich rufe dich an.', zh: null, words: null },
    { de: 'Das ist gut.', zh: null, words: null },
    { de: 'Wir gehen.', zh: null, words: null },
  ],
};

const good = '[{"n":1,"zh":"我打電話給你。","w":{"Ich":"我","rufe":"打電話(anrufen)","an":"(anrufen)"}},{"n":2,"zh":"這很好。","w":{"Das":"這"}}]';

test('正常的 JSON', () => {
  const { items, skipped } = parseResponse(good, 3);
  assert.equal(items.length, 2);
  assert.equal(items[0].words.rufe, '打電話(anrufen)');
  assert.deepEqual(skipped, []);
});

test('包在 ```json 裡、前後有多餘的說明文字', () => {
  const raw = '好的，以下是結果：\n```json\n' + good + '\n```\n希望有幫助！';
  assert.equal(parseResponse(raw, 3).items.length, 2);
});

test('結尾多餘的逗號', () => {
  const raw = '[{"n":1,"zh":"一","w":{"Ich":"我",}},]';
  assert.equal(parseResponse(raw, 3).items[0].zh, '一');
});

test('外面再包一層物件', () => {
  assert.equal(parseResponse('{"sentences":' + good + '}', 3).items.length, 2);
});

test('被截斷的 JSON 會給出清楚的錯誤', () => {
  assert.throws(() => parseResponse(good.slice(0, 60), 3), (e) => e instanceof ImportError && /截斷/.test(e.message));
  assert.throws(() => parseResponse('', 3), ImportError);
  assert.throws(() => parseResponse('沒有任何資料', 3), (e) => /找不到 JSON/.test(e.message));
});

test('編號超出範圍或缺少翻譯的項目會被跳過，其他照常匯入', () => {
  const raw = '[{"n":1,"zh":"一"},{"n":9,"zh":"九"},{"n":2,"zh":""},{"zh":"沒有編號"}]';
  const { items, skipped } = parseResponse(raw, 3);
  assert.deepEqual(items.map((i) => i.n), [1]);
  assert.equal(skipped.length, 3);
});

test('全部都不合格時丟出錯誤', () => {
  assert.throws(() => parseResponse('[{"n":9,"zh":"九"}]', 3), ImportError);
});

test('合併：不改動原物件、重複匯入會覆蓋', () => {
  const first = mergeTranslations(article, parseResponse(good, 3).items);
  assert.equal(article.sentences[0].zh, null);
  assert.equal(first.sentences[0].zh, '我打電話給你。');
  const second = mergeTranslations(first, parseResponse('[{"n":1,"zh":"新的翻譯"}]', 3).items);
  assert.equal(second.sentences[0].zh, '新的翻譯');
  assert.equal(second.sentences[0].words, null);
  assert.equal(second.sentences[1].zh, '這很好。');
  assert.deepEqual(untranslated(second), [3]);
});

test('分批合併，順序不影響結果', () => {
  const big = { ...article, sentences: Array.from({ length: 65 }, (_, i) => ({ de: `S${i + 1}.`, zh: null, words: null })) };
  const batch = (s, e) => JSON.stringify(Array.from({ length: e - s + 1 }, (_, i) => ({ n: s + i, zh: `句${s + i}` })));
  let a = mergeTranslations(big, parseResponse(batch(31, 60), 65).items);
  a = mergeTranslations(a, parseResponse(batch(1, 30), 65).items);
  assert.equal(formatRanges(untranslated(a)), '61–65');
});

test('formatRanges', () => {
  assert.equal(formatRanges([1, 2, 3, 5, 7, 8]), '1–3、5、7–8');
  assert.equal(formatRanges([]), '');
});

test('lookupMeaning：原字形、忽略大小寫、撇號', () => {
  const words = { Ich: '我', "geht's": '還好嗎' };
  assert.equal(lookupMeaning(words, 'Ich'), '我');
  assert.equal(lookupMeaning(words, 'ich'), '我');
  assert.equal(lookupMeaning(words, 'geht’s'), '還好嗎');
  assert.equal(lookupMeaning(words, 'du'), null);
  assert.equal(lookupMeaning(null, 'Ich'), null);
});

test('makeBatches 與 buildPrompt', () => {
  assert.deepEqual(makeBatches(65), [{ start: 1, end: 30 }, { start: 31, end: 60 }, { start: 61, end: 65 }]);
  assert.deepEqual(makeBatches(0), []);
  const prompt = buildPrompt(article.sentences, 2, 3);
  assert.match(prompt, /2\. Das ist gut\.\n3\. Wir gehen\.$/);
  assert.doesNotMatch(prompt, /Ich rufe/);
});

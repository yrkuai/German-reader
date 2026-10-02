import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeData, encodePairCode, decodePairCode } from '../js/sync.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function article(id, { createdAt = NOW - 10 * DAY, updatedAt, readAt, lastIndex = 0, zh = null } = {}) {
  return {
    id, title: `T ${id}`, createdAt, lastIndex,
    ...(updatedAt != null ? { updatedAt } : {}),
    ...(readAt != null ? { readAt } : {}),
    sentences: [{ de: 'Hallo.', zh, words: null }],
  };
}

const ids = (data) => data.articles.map((a) => a.id).sort();

test('只有一邊新增文章：兩邊都會有', () => {
  const local = { articles: [article('a', { updatedAt: NOW - DAY })], deleted: {} };
  const remote = { articles: [article('b', { updatedAt: NOW - DAY })], deleted: {} };
  const { data, changedLocal, changedRemote } = mergeData(local, remote, NOW);
  assert.deepEqual(ids(data), ['a', 'b']);
  assert.equal(changedLocal, true);
  assert.equal(changedRemote, true);
});

test('兩邊相同時不需要寫回也不需要上傳', () => {
  const a = article('a', { updatedAt: NOW - DAY, readAt: NOW - DAY });
  const { changedLocal, changedRemote } = mergeData(
    { articles: [a], deleted: {} },
    { v: 1, articles: [structuredClone(a)], deleted: {} },
    NOW,
  );
  assert.equal(changedLocal, false);
  assert.equal(changedRemote, false);
});

test('一邊匯入翻譯、另一邊閱讀：翻譯和進度都保留', () => {
  // 電腦匯入翻譯（內容較新），手機在閱讀（進度較新）
  const pc = article('a', { updatedAt: NOW - 2 * 60000, readAt: NOW - DAY, lastIndex: 0, zh: '你好。' });
  const phone = article('a', { updatedAt: NOW - DAY, readAt: NOW - 60000, lastIndex: 7 });
  const { data } = mergeData({ articles: [pc], deleted: {} }, { articles: [phone], deleted: {} }, NOW);
  const [merged] = data.articles;
  assert.equal(merged.sentences[0].zh, '你好。');
  assert.equal(merged.lastIndex, 7);
  assert.equal(merged.updatedAt, NOW - 2 * 60000);
  assert.equal(merged.readAt, NOW - 60000);
});

test('刪除後另一邊仍有舊版文章：刪除', () => {
  const local = { articles: [], deleted: { a: NOW - 60000 } };
  const remote = { articles: [article('a', { updatedAt: NOW - DAY })], deleted: {} };
  const { data, changedLocal, changedRemote } = mergeData(local, remote, NOW);
  assert.deepEqual(ids(data), []);
  assert.deepEqual(data.deleted, { a: NOW - 60000 });
  assert.equal(changedLocal, false);
  assert.equal(changedRemote, true);
});

test('只讀進度不會讓已刪除的文章復活', () => {
  // 另一邊在刪除之後才讀（readAt 較新），但內容沒變，仍應刪除
  const local = { articles: [], deleted: { a: NOW - 60000 } };
  const remote = { articles: [article('a', { updatedAt: NOW - DAY, readAt: NOW - 1000, lastIndex: 3 })], deleted: {} };
  assert.deepEqual(ids(mergeData(local, remote, NOW).data), []);
});

test('「復原」刪除：文章保留，刪除紀錄移除', () => {
  // 遠端還留著刪除紀錄，本機在刪除後按了復原（updatedAt 比刪除時間新）
  const local = { articles: [article('a', { updatedAt: NOW - 1000 })], deleted: {} };
  const remote = { articles: [], deleted: { a: NOW - 5000 } };
  const { data } = mergeData(local, remote, NOW);
  assert.deepEqual(ids(data), ['a']);
  assert.deepEqual(data.deleted, {});
});

test('舊文章沒有時間欄位：用 createdAt 當預設值', () => {
  const old = article('a', { createdAt: NOW - 30 * DAY, lastIndex: 4 });
  const { data, changedLocal } = mergeData({ articles: [old], deleted: {} }, { articles: [], deleted: {} }, NOW);
  assert.equal(data.articles[0].updatedAt, NOW - 30 * DAY);
  assert.equal(data.articles[0].readAt, NOW - 30 * DAY);
  assert.equal(data.articles[0].lastIndex, 4);
  assert.equal(changedLocal, true); // 補上欄位後寫回本機
});

test('超過 90 天的刪除紀錄會清掉；同一個 id 取較新的時間', () => {
  const local = { articles: [], deleted: { old: NOW - 91 * DAY, x: NOW - 2 * DAY } };
  const remote = { articles: [], deleted: { x: NOW - DAY, y: NOW - 3 * DAY } };
  const { data } = mergeData(local, remote, NOW);
  assert.deepEqual(data.deleted, { x: NOW - DAY, y: NOW - 3 * DAY });
});

test('遠端是空的 Gist（或格式不對）時，上傳本機文章', () => {
  const local = { articles: [article('a', { updatedAt: NOW, readAt: NOW })], deleted: {} };
  for (const remote of [{}, null, { articles: 'x' }]) {
    const { data, changedLocal, changedRemote } = mergeData(local, remote, NOW);
    assert.deepEqual(ids(data), ['a']);
    assert.equal(changedLocal, false);
    assert.equal(changedRemote, true);
  }
});

test('配對碼可以編碼再解回來，也接受整個網址', () => {
  const sync = { gistId: 'aa5a315d61ae9438b18d', token: 'ghp_ABCdef123_xyz' };
  const code = encodePairCode(sync);
  assert.match(code, /^gr1\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodePairCode(code), sync);
  assert.deepEqual(decodePairCode(`https://yrkuai.github.io/German-reader/#/pair/${code}\n`), sync);
});

test('看不懂的配對碼回傳 null', () => {
  for (const text of ['', 'ghp_abc', 'gr1.', 'gr1.!!!', 'gr1.' + btoa('not-hex:tok')]) {
    assert.equal(decodePairCode(text), null, text);
  }
});

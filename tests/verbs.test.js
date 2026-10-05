import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERSONS, dedupeInput, makeVerbBatches, buildVerbPrompt, parseVerbs, makeVerbCloze, pronounCloze, checkVerbAnswer,
  highlightVerb, markStemChange, mergeVerbs, formDisplay, hasWeak, buildMorePrompt, parseMoreSentences, pickCombos,
} from '../js/verbs.js';
import { ImportError } from '../js/importer.js';

const FAHREN = {
  v: 'fahren', zh: '搭乘、開車', type: '換母音', tip: 'a 變成 ä', prefix: null,
  forms: { ich: 'fahre', du: 'fährst', er: 'fährt', wir: 'fahren', ihr: 'fahrt', sie: 'fahren' },
  s: [
    { p: 'ich', de: 'Ich fahre heute nach Berlin.', zh: '我今天去柏林。' },
    { p: 'du', de: 'Fährst du mit dem Bus?', zh: '你搭公車嗎？' },
  ],
};
const AUFSTEHEN = {
  v: 'aufstehen', zh: '起床', type: '不規則', tip: '可分動詞', prefix: 'auf',
  forms: { ich: 'stehe', du: 'stehst', er: 'steht', wir: 'stehen', ihr: 'steht', sie: 'stehen' },
  s: [{ p: 'ich', de: 'Ich stehe um sieben Uhr auf.', zh: '我七點起床。' }],
};

test('輸入整理：去掉重複和已經建立的動詞，不分大小寫', () => {
  assert.deepEqual(dedupeInput('fahren, sein\nFahren  gehen、sein', new Set(['gehen'])), ['fahren', 'sein']);
  assert.deepEqual(dedupeInput('  \n,, '), []);
  assert.deepEqual(dedupeInput('fahren 123 sein!'), ['fahren']); // 不是字母的略過
});

test('分批：每批最多 10 個', () => {
  const verbs = Array.from({ length: 23 }, (_, i) => `v${i}`);
  assert.deepEqual(makeVerbBatches(verbs).map((b) => b.length), [10, 10, 3]);
});

test('提示詞包含所有動詞', () => {
  const prompt = buildVerbPrompt(['fahren', 'sein']);
  assert.match(prompt, /動詞：\nfahren\nsein$/);
  assert.match(prompt, /只用現在式/);
});

test('匯入：一般動詞與可分動詞', () => {
  const { verbs, skipped } = parseVerbs('```json\n' + JSON.stringify([FAHREN, AUFSTEHEN]) + '\n```', new Set(), 100);
  assert.deepEqual(skipped, []);
  assert.equal(verbs.length, 2);
  const [fahren, auf] = verbs;
  assert.equal(fahren.key, 'fahren');
  assert.equal(fahren.prefix, null);
  assert.equal(fahren.sentences.length, 2);
  assert.equal(fahren.createdAt, 100);
  assert.equal(auf.prefix, 'auf');
  assert.equal(formDisplay(auf, 'ich'), 'stehe … auf');
  assert.equal(auf.sentences.length, 1);
});

test('匯入：已經存在的動詞直接略過，不列進跳過清單', () => {
  const { verbs, skipped } = parseVerbs(JSON.stringify([FAHREN, AUFSTEHEN, { ...FAHREN, v: 'Fahren' }]), new Set(['aufstehen']));
  assert.deepEqual(verbs.map((v) => v.key), ['fahren']);
  assert.deepEqual(skipped, []);
});

test('匯入：缺少變化形的動詞整個跳過', () => {
  const bad = { ...FAHREN, forms: { ...FAHREN.forms, du: null, ihr: '' } };
  const { verbs, skipped } = parseVerbs(JSON.stringify([bad]));
  assert.equal(verbs.length, 0);
  assert.match(skipped[0].reason, /缺少 du、ihr 的變化形/);
});

test('匯入："null" 之類的字當作沒有資料，不會變成文字', () => {
  const item = { ...FAHREN, zh: 'null', tip: 'None', type: '-', prefix: 'null', s: [{ p: 'ich', de: 'Ich fahre.', zh: 'null' }] };
  const [verb] = parseVerbs(JSON.stringify([item])).verbs;
  assert.equal(verb.zh, '');
  assert.equal(verb.tip, '');
  assert.equal(verb.type, '');
  assert.equal(verb.prefix, null);
  assert.equal(verb.sentences[0].zh, null);
});

test('匯入：例句沒有出現變化形、人稱錯誤、重複的例句都跳過', () => {
  const item = {
    ...FAHREN,
    s: [
      { p: 'du', de: 'Du fahrst nach Hause.', zh: '' },    // 寫錯：應該是 fährst
      { p: 'xx', de: 'Ich fahre.', zh: '' },
      { p: 'ich', de: 'Ich fahre.', zh: '' },
      { p: 'ich', de: 'ich fahre. ', zh: '' },            // 和上一句相同
    ],
  };
  const { verbs, skipped } = parseVerbs(JSON.stringify([item]));
  assert.equal(verbs[0].sentences.length, 1);
  assert.equal(skipped.length, 2);
  assert.match(skipped[0].reason, /du 的例句「Du fahrst nach Hause\.」沒有出現 fährst/);
  // 可分動詞的前綴沒有出現也算不合格
  const auf = parseVerbs(JSON.stringify([{ ...AUFSTEHEN, s: [{ p: 'ich', de: 'Ich stehe früh.' }] }]));
  assert.equal(auf.verbs[0].sentences.length, 0);
  assert.match(auf.skipped[0].reason, /stehe … auf/);
});

test('匯入：格式錯誤丟出 ImportError', () => {
  assert.throws(() => parseVerbs('不是 JSON'), ImportError);
});

test('挖空：一般動詞、句首、主詞位置', () => {
  const c = makeVerbCloze('Ich fahre heute nach Berlin.', 'fahre', null, 'ich');
  assert.deepEqual(c.answers, ['fahre']);
  assert.equal(c.sentenceStart, false);
  assert.deepEqual(c.segments[c.subject], { text: 'Ich' });
  const q = makeVerbCloze('Fährst du mit dem Bus?', 'fährst', null, 'du');
  assert.deepEqual(q.answers, ['Fährst']);
  assert.equal(q.sentenceStart, true);
  assert.deepEqual(q.segments[q.subject], { text: 'du' });
  assert.equal(makeVerbCloze('Ich fahre.', 'fährst', null, 'du'), null);
});

test('挖空：可分動詞挖兩個空', () => {
  const c = makeVerbCloze('Ich stehe um sieben Uhr auf.', 'stehe', 'auf', 'ich');
  assert.deepEqual(c.answers, ['stehe', 'auf']);
  assert.deepEqual(c.segments.filter((s) => 'blank' in s).map((s) => s.blank), [0, 1]);
  assert.equal(c.segments.map((s) => s.text ?? '_').join(''), 'Ich _ um sieben Uhr _.');
});

test('沒有例句的人稱：只有主詞的題目', () => {
  const verb = { forms: { er: 'fährt' }, prefix: null };
  const c = pronounCloze(verb, 'er');
  assert.equal(c.segments[0].text, 'er/sie/es ');
  assert.deepEqual(c.answers, ['fährt']);
});

test('比對答案：變音、句首大小寫、可分動詞兩格或一格', () => {
  const du = makeVerbCloze('Du fährst nach Hause.', 'fährst', null, 'du');
  assert.equal(checkVerbAnswer(['faehrst'], du), 'ok');
  assert.equal(checkVerbAnswer(['fahrst'], du), 'wrong');
  const q = makeVerbCloze('Fährst du mit dem Bus?', 'fährst', null, 'du');
  assert.equal(checkVerbAnswer(['fährst'], q), 'ok'); // 句首不算大小寫

  const auf = makeVerbCloze('Ich stehe um sieben Uhr auf.', 'stehe', 'auf', 'ich');
  assert.equal(checkVerbAnswer(['stehe', 'auf'], auf), 'ok');
  assert.equal(checkVerbAnswer(['stehe auf', ''], auf), 'ok');
  assert.equal(checkVerbAnswer(['stehe … auf', ''], auf), 'ok');
  assert.equal(checkVerbAnswer(['stehe', ''], auf), 'wrong');
  assert.equal(checkVerbAnswer(['steht', 'auf'], auf), 'wrong');
});

test('例句強調動詞（可分動詞連前綴）', () => {
  const hits = highlightVerb('Ich stehe um sieben Uhr auf.', 'stehe', 'auf').filter((t) => t.hit).map((t) => t.text);
  assert.deepEqual(hits, ['stehe', 'auf']);
});

test('換母音標色：只標和字根不同的字母', () => {
  const verb = { v: 'fahren', type: '換母音', prefix: null, forms: { du: 'fährst', ich: 'fahre' } };
  assert.deepEqual(markStemChange(verb, 'du'), [{ text: 'f', hit: false }, { text: 'ä', hit: true }, { text: 'hrst', hit: false }]);
  assert.deepEqual(markStemChange(verb, 'ich'), [{ text: 'fahre', hit: false }]);
  const sehen = { v: 'sehen', type: '換母音', prefix: null, forms: { du: 'siehst' } };
  assert.deepEqual(markStemChange(sehen, 'du').filter((x) => x.hit).map((x) => x.text), ['ie']);
  // 不是換母音的動詞不標
  assert.deepEqual(markStemChange({ ...sehen, type: '不規則' }, 'du'), [{ text: 'siehst', hit: false }]);
});

test('同步合併：例句聯集、內容取較新、不熟每個人稱各取較新', () => {
  const base = parseVerbs(JSON.stringify([FAHREN]), new Set(), 10).verbs[0];
  const a = { ...base, zh: '舊', updatedAt: 10, weak: { du: { weak: true, at: 5 }, ich: { weak: false, at: 9 } } };
  const b = {
    ...base, zh: '新', updatedAt: 20,
    sentences: [...base.sentences, { p: 'er', de: 'Er fährt schnell.', zh: null }],
    weak: { du: { weak: false, at: 8 } },
  };
  const m = mergeVerbs(a, b);
  assert.equal(m.zh, '新');
  assert.equal(m.sentences.length, 3);
  assert.equal(m.weak.du.weak, false);
  assert.equal(m.weak.ich.weak, false);
  assert.deepEqual(mergeVerbs(b, a), m);
  assert.equal(hasWeak(a), true);
  assert.equal(hasWeak(m), false);
});

test('六個人稱', () => {
  assert.deepEqual(PERSONS, ['ich', 'du', 'er', 'wir', 'ihr', 'sie']);
});

// ---------- 第二階段 ----------

test('增加例句的提示詞附上現有例句', () => {
  const [verb] = parseVerbs(JSON.stringify([FAHREN])).verbs;
  const prompt = buildMorePrompt([verb]);
  assert.match(prompt, /fahren（ich: fahre、du: fährst/);
  assert.match(prompt, / {2}- Ich fahre heute nach Berlin\./);
  const [auf] = parseVerbs(JSON.stringify([AUFSTEHEN])).verbs;
  assert.match(buildMorePrompt([auf]), /ich: stehe … auf/);
});

test('增加例句：和現有例句相同的略過、不存在的動詞跳過、例句錯誤跳過', () => {
  const [verb] = parseVerbs(JSON.stringify([FAHREN])).verbs;
  const verbs = { fahren: verb };
  const raw = JSON.stringify([
    { v: 'Fahren', s: [
      { p: 'ich', de: 'ich fahre heute nach berlin.', zh: '重複' },  // 和現有例句相同
      { p: 'er', de: 'Er fährt Rad.', zh: '他騎腳踏車。' },
      { p: 'wir', de: 'Wir fahrt weg.', zh: '錯的' },
    ] },
    { v: 'fahren', s: [{ p: 'er', de: 'Er fährt Rad.', zh: '重複' }, { p: 'ihr', de: 'Ihr fahrt los.', zh: null }] },
    { v: 'gehen', s: [{ p: 'ich', de: 'Ich gehe.', zh: null }] },
  ]);
  const { updates, skipped } = parseMoreSentences(raw, verbs);
  assert.deepEqual(updates.map((u) => [u.key, u.sentences.map((s) => s.de)]), [['fahren', ['Er fährt Rad.', 'Ihr fahrt los.']]]);
  assert.equal(skipped.length, 2);
  assert.ok(skipped.some((s) => s.label === 'gehen' && /不是已經建立的動詞/.test(s.reason)));
  assert.ok(skipped.some((s) => /wir 的例句/.test(s.reason)));
});

test('綜合練習出題：不重複、不熟優先、人稱平均、組合不足時全出', () => {
  const mk = (key, weak = {}) => ({ key, weak });
  const verbs = [mk('a', { du: { weak: true } }), mk('b'), mk('c'), mk('d'), mk('e')];
  for (let run = 0; run < 20; run++) {
    const combos = pickCombos(verbs, 20);
    assert.equal(combos.length, 20);
    assert.equal(new Set(combos.map((c) => `${c.key}:${c.p}`)).size, 20);
    assert.ok(combos.some((c) => c.key === 'a' && c.p === 'du')); // 不熟的一定在
    const counts = PERSONS.map((p) => combos.filter((c) => c.p === p).length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, String(counts));
  }
  assert.equal(pickCombos([mk('a'), mk('b')], 20).length, 12);
  assert.deepEqual(pickCombos([], 20), []);
});

import { h } from './dom.js';
import { icon } from './icons.js';
import { showSummary, translateToggle } from './review.js';
import { loadSettings, loadVerbs, setVerbWeak } from '../storage.js';
import { PERSONS, PERSON_LABELS, makeVerbCloze, pronounCloze, checkVerbAnswer, formDisplay, pickCombos } from '../verbs.js';
import { pickSession, createRound } from '../vocab.js';
import { speakOnce, cancelSpeech } from '../speech.js';
import { keepAboveKeyboard } from './keyboard.js';

// 一題：某個動詞的某個人稱。variants 是可以出題的例句（順序隨機），答錯再問時換下一句
function makeItem(verb, p) {
  const variants = pickSession(verb.sentences.filter((s) => s.p === p), Infinity).flatMap((s) => {
    const cloze = makeVerbCloze(s.de, verb.forms[p], verb.prefix, p);
    return cloze ? [{ de: s.de, zh: s.zh, cloze }] : [];
  });
  // 沒有例句的人稱：題目只有主詞
  if (!variants.length) variants.push({ de: null, zh: null, cloze: pronounCloze(verb, p) });
  return { verb, p, variants, tries: 0 };
}

// 單一動詞練習：六個人稱打亂順序，一次一題
export function renderVerbPractice(view, key, ctx) {
  const verb = loadVerbs()[key];
  if (!verb) {
    ctx.navigate('#/verbs');
    return;
  }
  const items = pickSession(PERSONS, Infinity).map((p) => makeItem(verb, p));
  return runPractice(view, ctx, {
    title: verb.v,
    items,
    againHash: `#/verbs/practice/${encodeURIComponent(key)}`,
  });
}

// 總練習：勾選的動詞混在一起，「動詞＋人稱」不重複，不熟的優先
export function renderVerbMix(view, ctx) {
  const verbs = loadVerbs();
  const mix = { all: true, keys: [], size: 20, ...loadSettings().verbMix };
  const chosen = (mix.all ? Object.values(verbs) : mix.keys.map((k) => verbs[k])).filter(Boolean);
  if (!chosen.length) {
    ctx.navigate('#/verbs');
    return;
  }
  const items = pickCombos(chosen, mix.size).map(({ key, p }) => makeItem(verbs[key], p));
  return runPractice(view, ctx, { title: '總練習', items, againHash: '#/verbs/mix' });
}

// 題目畫面（單一動詞、總練習共用）
function runPractice(view, ctx, { title, items, againHash }) {
  ctx.setBar(title, '#/verbs');
  const settings = loadSettings();
  const speak = (text) => speakOnce(text, { voiceURI: settings.voiceURI, rate: settings.rate });
  const round = createRound(items);

  // 畫面上這一題（送出後 round.current 已經換到下一個，按鈕要用這裡記下的題目）
  let item = null;
  let q = null;
  let answered = false;

  // 中文翻譯：工具列的「翻譯」按鈕開關，每次進來預設關閉
  let showZh = false;
  const zhEl = h('p', { class: 'cloze-zh' });
  const applyZh = () => { zhEl.hidden = !showZh || !q.zh; };
  const zhToggle = translateToggle((on) => { showZh = on; applyZh(); });

  const progress = h('span', { class: 'hint flash-progress' });
  const sentenceEl = h('p', { class: 'cloze-sentence', lang: 'de' });
  const hintEl = h('div', { class: 'cloze-hint verb-hint', 'aria-live': 'polite' });
  const hintBtn = h('button', {
    class: 'btn', type: 'button',
    onclick: () => {
      hintEl.replaceChildren(
        h('span', {}, q.cloze.answers.map((a) => [a[0], ...Array(a.length - 1).fill('_')].join(' ')).join('   …   ')),
        item.verb.tip ? h('span', { class: 'verb-tip' }, item.verb.tip) : null,
      );
      hintBtn.disabled = true;
      inputs[0].focus({ preventScroll: true });
    },
  }, '提示');
  const playBtn = h('button', {
    class: 'btn btn-icon-text', type: 'button', onclick: () => speak(q.de || answerText(item)),
  }, icon('speaker'), '聽整句');

  // 可分動詞兩個輸入框；一般動詞一個
  const makeInput = (label) => h('input', {
    class: 'input cloze-input', type: 'text', lang: 'de', autocomplete: 'off', autocapitalize: 'off', spellcheck: false,
    autocorrect: 'off', enterkeyhint: 'done', 'aria-label': label,
  });
  const inputs = [makeInput('動詞變化形'), makeInput('可分動詞的前綴')];
  const inputRow = h('div', { class: 'row verb-inputs' }, inputs[0], h('span', { class: 'verb-dots', 'aria-hidden': 'true' }, '…'), inputs[1]);
  const checkBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => submit() }, '確認');
  const feedback = h('div', { class: 'cloze-feedback', 'aria-live': 'polite' });
  const nextBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => next() }, '下一題');
  for (const input of inputs) {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      submit();
    });
  }

  const body = h('div', { class: 'stack' },
    h('div', { class: 'row verb-progress' }, progress),
    h('div', { class: 'cloze-card stack' }, sentenceEl, zhEl, hintEl),
    // 依透露答案的多寡排列：聽整句 → 翻譯 → 提示
    h('div', { class: 'row quiz-tools' }, playBtn, zhToggle, hintBtn),
    h('div', { class: 'row' }, inputRow, checkBtn),
    feedback,
    h('div', { class: 'actions' }, nextBtn),
  );
  view.append(body);

  // 句子：空格、主詞加粗；作答後空格填入答案
  function renderSentence(states) {
    sentenceEl.replaceChildren(...q.cloze.segments.map((seg, k) => {
      if ('blank' in seg) {
        const answer = q.cloze.answers[seg.blank];
        const state = states?.[seg.blank];
        return h('span', { class: state ? `cloze-blank is-${state}` : 'cloze-blank' },
          state ? answer : ' '.repeat(Math.max(4, answer.length)));
      }
      return k === q.cloze.subject ? h('b', { class: 'verb-subject' }, seg.text) : seg.text;
    }));
  }

  function draw() {
    item = round.current;
    q = item.variants[item.tries % item.variants.length];
    answered = false;
    progress.textContent = `剩 ${round.remaining} 個`;
    // 測試用：記下這一題的動詞和人稱（畫面上不顯示）
    sentenceEl.dataset.verb = item.verb.key;
    sentenceEl.dataset.person = item.p;
    renderSentence(null);
    sentenceEl.append(h('span', { class: 'hint verb-inf' }, `（${item.verb.v}）`));
    zhEl.textContent = q.zh || '';
    zhToggle.disabled = !q.zh;
    applyZh();
    hintEl.replaceChildren();
    hintBtn.disabled = false;
    const two = q.cloze.answers.length === 2;
    inputRow.classList.toggle('is-two', two);
    inputs[1].hidden = !two;
    for (const input of inputs) {
      input.value = '';
      input.disabled = false;
    }
    checkBtn.hidden = false;
    feedback.replaceChildren();
    nextBtn.hidden = true;
    inputs[0].focus({ preventScroll: true });
  }

  function submit() {
    if (answered || !inputs[0].value.trim()) return;
    const result = checkVerbAnswer(inputs.map((i) => i.value), q.cloze);
    const ok = result === 'ok';
    answered = true;
    // 只用第一次的作答標記不熟；答錯的放回這一輪最後面，下次換一句例句
    if (round.answer(ok)) setVerbWeak(item.verb.key, item.p, !ok);
    if (!ok) item.tries++;
    renderSentence(q.cloze.answers.map(() => (ok ? 'ok' : 'wrong')));
    sentenceEl.append(h('span', { class: 'hint verb-inf' }, `（${item.verb.v}）`));
    feedback.replaceChildren(ok
      ? h('p', { class: 'ok' }, '✓ 答對了')
      : h('div', { class: 'stack verb-wrong' },
        h('p', { class: 'error' }, result === 'case' ? '大小寫不對。' : '答錯了。', '正確答案：',
          h('b', { lang: 'de' }, formDisplay(item.verb, item.p))),
        item.verb.tip ? h('p', { class: 'verb-tip' }, item.verb.tip) : null,
      ));
    for (const input of inputs) input.disabled = true;
    checkBtn.hidden = true;
    nextBtn.hidden = false;
    nextBtn.focus({ preventScroll: true });
    // 作答後不自動唸；要聽就按工具列的「聽整句」
  }

  function next() {
    if (!round.done) draw();
    else {
      showSummary(body, ctx, round, againHash, {
        labelOf: (m) => `${m.verb.v} · ${PERSON_LABELS[m.p]} → ${formDisplay(m.verb, m.p)}`,
        back: { href: '#/verbs', label: '回到動詞本' },
      });
    }
  }

  draw();
  const releaseKeyboard = keepAboveKeyboard(view);
  return () => {
    cancelSpeech();
    releaseKeyboard();
  };
}

// 沒有例句時唸「du fährst」
function answerText(item) {
  const label = item.p === 'er' ? 'er' : item.p === 'sie' ? 'sie' : item.p;
  return `${label} ${item.verb.forms[item.p]}${item.verb.prefix ? ` ${item.verb.prefix}` : ''}`;
}

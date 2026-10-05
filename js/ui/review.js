import { h } from './dom.js';
import { icon } from './icons.js';
import { loadSettings, saveSettings, loadVocab, sentenceLookup, setWeak } from '../storage.js';
import { describe, pickSession, highlightTokens, pluralNote, makeCloze, checkAnswer } from '../vocab.js';
import { speakOnce, cancelSpeech } from '../speech.js';

const SESSION_SIZE = 20;

// 閃卡：每輪從選定範圍隨機抽 20 個。點卡片翻面，再按「忘了」或「記得」
export function renderFlashcards(view, ctx) {
  ctx.setBar('閃卡', '#/words');
  const settings = loadSettings();
  const speak = (text) => speakOnce(text, { voiceURI: settings.voiceURI, rate: settings.rate });

  const pool = practicePool(settings);
  if (!pool.length) {
    ctx.navigate('#/words');
    return;
  }
  const lookup = sentenceLookup();
  const cards = pickSession(pool, SESSION_SIZE).map((entry) => ({ entry, d: describe(entry, lookup) }));

  let i = 0;
  let flipped = false;
  let remembered = 0;

  // ---------- 方向：德→中／中→德（沒有翻譯的字一律德→中） ----------
  const dirButtons = [['de', '德 → 中'], ['zh', '中 → 德']].map(([value, label]) =>
    h('button', {
      class: 'speed', type: 'button', role: 'radio', 'data-dir': value,
      onclick: () => {
        if (settings.flashDir === value) return;
        settings.flashDir = value;
        saveSettings({ ...loadSettings(), flashDir: value });
        showDir();
        flipped = false;
        draw();
      },
    }, label),
  );
  const showDir = () => {
    for (const b of dirButtons) b.setAttribute('aria-checked', String(b.dataset.dir === settings.flashDir));
  };
  showDir();

  const progress = h('span', { class: 'hint flash-progress' });
  const card = h('button', { class: 'flashcard', type: 'button', onclick: () => { if (!flipped) flip(); } });
  const answers = h('div', { class: 'flash-answers' },
    h('button', { class: 'btn', type: 'button', onclick: () => answer(false) }, '忘了'),
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => answer(true) }, '記得'),
  );
  const body = h('div', { class: 'stack' },
    h('div', { class: 'row row-between' }, h('div', { class: 'speed-group', role: 'radiogroup', 'aria-label': '閃卡方向' }, dirButtons), progress),
    card,
    answers,
  );
  view.append(body);

  const dirOf = (c) => (settings.flashDir === 'zh' && c.d.meaning ? 'zh' : 'de');

  function draw() {
    const c = cards[i];
    const dir = dirOf(c);
    progress.textContent = `${i + 1} / ${cards.length}`;
    answers.hidden = !flipped;
    card.classList.toggle('is-flipped', flipped);
    card.setAttribute('aria-label', flipped ? '答案' : '點一下看答案');

    if (!flipped) {
      fill(card,
        dir === 'de'
          ? h('span', { class: 'flash-word', lang: 'de' }, c.d.display)
          : h('span', { class: 'flash-word flash-zh' }, c.d.meaning),
        settings.flashDir === 'zh' && dir === 'de' ? h('span', { class: 'hint' }, '這個字還沒有翻譯') : null,
        h('span', { class: 'hint flash-tap' }, '點一下看答案'),
      );
      if (dir === 'de') speak(c.d.display);
      return;
    }

    const ex = c.d.example;
    fill(card,
      h('span', { class: 'flash-word', lang: 'de' }, c.d.display),
      pluralNote(c.d.info) ? h('span', { class: 'flash-grammar' }, pluralNote(c.d.info)) : null,
      h('span', { class: c.d.meaning ? 'flash-meaning' : 'flash-meaning is-empty' }, c.d.meaning || '尚無翻譯'),
      ex
        ? h('span', { class: 'flash-example' },
          h('span', { class: 'flash-example-de', lang: 'de' }, highlightTokens(ex.de, ex.form).map((p) => (p.hit ? h('b', {}, p.text) : p.text))),
          ex.zh ? h('span', { class: 'flash-example-zh' }, ex.zh) : null,
        )
        : null,
    );
  }

  function flip() {
    const c = cards[i];
    flipped = true;
    draw();
    // 中→德：翻面時唸德文；沒有翻譯：唸整句，從句子裡理解
    if (dirOf(c) === 'zh') speak(c.d.display);
    else if (!c.d.meaning && c.d.example) speak(c.d.example.de);
    answers.querySelector('.btn-primary').focus({ preventScroll: true });
  }

  function answer(ok) {
    setWeak(cards[i].entry.key, !ok);
    if (ok) remembered++;
    i++;
    flipped = false;
    if (i < cards.length) draw();
    else finish();
  }

  function finish() {
    showSummary(body, ctx, `完成 ${cards.length} 個，記得 ${remembered} 個`, remembered < cards.length, '#/review/flash');
  }

  draw();
  return () => cancelSpeech();
}

// 換掉 el 的內容，略過 null（replaceChildren 會把 null 變成文字「null」）
function fill(el, ...children) {
  el.replaceChildren(...children.filter((c) => c != null && c !== false));
}

// 練習範圍：全部或只練不熟的
function practicePool(settings) {
  const all = Object.values(loadVocab());
  return settings.vocabScope === 'weak' ? all.filter((e) => e.weak) : all;
}

// 一輪結束的結果畫面
function showSummary(body, ctx, text, hasWeak, againHash) {
  cancelSpeech();
  body.replaceChildren(h('div', { class: 'empty flash-done' },
    h('p', {}, text),
    hasWeak ? h('p', { class: 'muted' }, '答錯或忘了的字已標成「不熟」，可以在單字本選「不熟」再練一次。') : null,
    h('div', { class: 'actions flash-done-actions' },
      h('a', { class: 'btn', href: '#/words' }, '回到單字本'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.navigate(againHash) }, '再一輪'),
    ),
  ));
}

// 例句填空：從單字的出處挑一句，把那個字挖空，打字填入
export function renderCloze(view, ctx) {
  ctx.setBar('例句填空', '#/words');
  const settings = loadSettings();
  const speak = (text) => speakOnce(text, { voiceURI: settings.voiceURI, rate: settings.rate });

  const pool = practicePool(settings);
  const lookup = sentenceLookup();
  // 每個字隨機挑一個出處；文章還在就用最新的句子和翻譯，刪了就用標記時存的
  const questions = pickSession(pool, SESSION_SIZE).flatMap((entry) => {
    for (const src of pickSession(entry.sources || [], Infinity)) {
      const sentence = lookup(src.articleId, src.index);
      const de = sentence?.de || src.de;
      const cloze = de ? makeCloze(de, src.form) : null;
      if (cloze) return [{ entry, de, zh: sentence?.zh || src.zh || null, cloze }];
    }
    return [];
  });
  if (!questions.length) {
    ctx.navigate('#/words');
    return;
  }

  let i = 0;
  let answered = false;
  let correct = 0;

  const progress = h('span', { class: 'hint flash-progress' });
  const sentenceEl = h('p', { class: 'cloze-sentence', lang: 'de' });
  const zhEl = h('p', { class: 'cloze-zh' });
  const hintEl = h('p', { class: 'cloze-hint', 'aria-live': 'polite' });
  const hintBtn = h('button', {
    class: 'btn', type: 'button',
    onclick: () => {
      hintEl.textContent = questions[i].cloze.hint;
      hintBtn.disabled = true;
      input.focus({ preventScroll: true });
    },
  }, '提示');
  const playBtn = h('button', {
    class: 'btn btn-icon-text', type: 'button', onclick: () => speak(questions[i].de),
  }, icon('speaker'), '聽整句');
  const input = h('input', {
    class: 'input cloze-input', type: 'text', lang: 'de', autocomplete: 'off', autocapitalize: 'off', spellcheck: false,
    autocorrect: 'off', enterkeyhint: 'done', 'aria-label': '填入空格的單字',
  });
  const checkBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => submit() }, '確認');
  const feedback = h('p', { class: 'cloze-feedback', 'aria-live': 'polite' });
  const nextBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => next() }, '下一題');
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    submit();
  });

  const body = h('div', { class: 'stack' },
    h('div', { class: 'row row-between' }, h('span', { class: 'hint' }, '填入句子裡原本的寫法'), progress),
    h('div', { class: 'cloze-card stack' }, sentenceEl, zhEl, hintEl),
    h('div', { class: 'row' }, playBtn, hintBtn),
    h('div', { class: 'row' }, input, checkBtn),
    feedback,
    h('div', { class: 'actions' }, nextBtn),
  );
  view.append(body);

  const blank = (content, state) => h('span', { class: state ? `cloze-blank is-${state}` : 'cloze-blank' }, content);

  function draw() {
    const q = questions[i];
    answered = false;
    progress.textContent = `${i + 1} / ${questions.length}`;
    sentenceEl.replaceChildren(q.cloze.before, blank('\u00a0'.repeat(Math.max(4, q.cloze.answer.length))), q.cloze.after);
    zhEl.textContent = q.zh || '';
    zhEl.hidden = !q.zh;
    hintEl.textContent = '';
    hintBtn.disabled = false;
    input.value = '';
    input.disabled = false;
    checkBtn.hidden = false;
    feedback.replaceChildren();
    nextBtn.hidden = true;
    input.focus({ preventScroll: true });
  }

  function submit() {
    if (answered || !input.value.trim()) return;
    const q = questions[i];
    const result = checkAnswer(input.value, q.cloze);
    const ok = result === 'ok';
    answered = true;
    if (ok) correct++;
    setWeak(q.entry.key, !ok);
    sentenceEl.replaceChildren(q.cloze.before, blank(q.cloze.answer, ok ? 'ok' : 'wrong'), q.cloze.after);
    feedback.replaceChildren(ok
      ? h('span', { class: 'ok' }, '✓ 答對了')
      : h('span', { class: 'error' },
        result === 'case' ? '名詞要大寫。' : '答錯了。', '正確答案：', h('b', { lang: 'de' }, q.cloze.answer)));
    input.disabled = true;
    checkBtn.hidden = true;
    nextBtn.hidden = false;
    nextBtn.focus({ preventScroll: true });
    // 答錯時唸出整句，聽聽正確的用法
    if (!ok) speak(q.de);
  }

  function next() {
    i++;
    if (i < questions.length) draw();
    else showSummary(body, ctx, `完成 ${questions.length} 題，答對 ${correct} 題`, correct < questions.length, '#/review/cloze');
  }

  draw();
  return () => cancelSpeech();
}

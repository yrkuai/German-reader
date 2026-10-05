import { h } from './dom.js';
import { icon } from './icons.js';
import { loadSettings, saveSettings, loadVocab, sentenceLookup, setWeak } from '../storage.js';
import { describe, pickSession, highlightTokens, pluralNote, makeCloze, checkAnswer, createRound } from '../vocab.js';
import { speakOnce, cancelSpeech } from '../speech.js';

// 一輪 10 個字；答錯或「忘了」的放回這一輪最後面，全部答對才結束
const SESSION_SIZE = 10;

// 閃卡：每輪從選定範圍隨機抽 10 個。點卡片翻面，再按「忘了」或「記得」
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
  const round = createRound(pickSession(pool, SESSION_SIZE).map((entry) => ({ entry, d: describe(entry, lookup) })));
  let flipped = false;

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
    const c = round.current;
    const dir = dirOf(c);
    progress.textContent = `剩 ${round.remaining} 個`;
    answers.hidden = !flipped;
    card.classList.toggle('is-flipped', flipped);
    card.setAttribute('aria-label', flipped ? '答案' : '點一下看答案');

    if (!flipped) {
      fill(card,
        dir === 'de'
          ? h('span', { class: 'flash-word', lang: 'de' }, c.d.display)
          : h('span', { class: 'flash-word flash-zh' }, c.d.meaning),
        settings.flashDir === 'zh' && dir === 'de' ? h('span', { class: 'hint' }, '這個字還沒有翻譯') : null,
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
    const c = round.current;
    flipped = true;
    draw();
    // 中→德：翻面時唸德文；沒有翻譯：唸整句，從句子裡理解
    if (dirOf(c) === 'zh') speak(c.d.display);
    else if (!c.d.meaning && c.d.example) speak(c.d.example.de);
    answers.querySelector('.btn-primary').focus({ preventScroll: true });
  }

  function answer(ok) {
    const { entry } = round.current;
    // 只用第一次的作答標記不熟；之後重問才記得的，還是算不熟
    if (round.answer(ok)) setWeak(entry.key, !ok);
    flipped = false;
    if (!round.done) draw();
    else showSummary(body, ctx, round, '#/review/flash');
  }

  draw();
  return () => cancelSpeech();
}

// 考題的「翻譯」按鈕：按下變深色並顯示翻譯，再按一次隱藏（例句填空、動詞練習共用）
export function translateToggle(onChange) {
  let on = false;
  const btn = h('button', {
    class: 'btn btn-icon-text', type: 'button', 'aria-pressed': 'false',
    onclick: () => {
      on = !on;
      btn.setAttribute('aria-pressed', String(on));
      onChange(on);
    },
  }, icon('translate'), '翻譯');
  return btn;
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

// 一輪結束的結果畫面：第一次就答對幾個，第一次答錯的列出來（動詞練習也共用）
// labelOf：答錯清單裡每一項顯示的文字
export function showSummary(body, ctx, round, againHash, labelOf = (m) => m.d.display) {
  cancelSpeech();
  const missed = round.firstTryWrong();
  body.replaceChildren(h('div', { class: 'empty flash-done' },
    h('p', {}, `${round.total} 個全部完成`),
    h('p', { class: 'muted' }, `第一次就答對 ${round.firstTryCorrect()} 個`),
    missed.length
      ? h('div', { class: 'flash-missed' },
        h('p', { class: 'muted' }, '第一次答錯（已標成「不熟」）：'),
        h('ul', {}, missed.map((m) => h('li', { lang: 'de' }, labelOf(m)))),
      )
      : null,
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
  // 每個字準備它所有可用的例句（順序隨機）；答錯再問時換下一句，避免只背下那一句。
  // 文章還在就用最新的句子和翻譯，刪了就用標記時存的
  const items = pickSession(pool, SESSION_SIZE).flatMap((entry) => {
    const variants = pickSession(entry.sources || [], Infinity).flatMap((src) => {
      const sentence = lookup(src.articleId, src.index);
      const de = sentence?.de || src.de;
      const cloze = de ? makeCloze(de, src.form) : null;
      return cloze ? [{ de, zh: sentence?.zh || src.zh || null, cloze }] : [];
    });
    return variants.length ? [{ entry, d: describe(entry, lookup), variants, tries: 0 }] : [];
  });
  if (!items.length) {
    ctx.navigate('#/words');
    return;
  }
  const round = createRound(items);
  // 畫面上這一題（送出後 round.current 已經換到下一個，按鈕要用這裡記下的題目）
  let item = null;
  let q = null;

  let answered = false;

  const progress = h('span', { class: 'hint flash-progress' });
  const sentenceEl = h('p', { class: 'cloze-sentence', lang: 'de' });
  const zhEl = h('p', { class: 'cloze-zh' });
  // 中文翻譯：工具列的「翻譯」按鈕開關，每次進來預設關閉
  let showZh = false;
  const applyZh = () => { zhEl.hidden = !showZh || !q.zh; };
  const zhToggle = translateToggle((on) => { showZh = on; applyZh(); });
  const hintEl = h('p', { class: 'cloze-hint', 'aria-live': 'polite' });
  const hintBtn = h('button', {
    class: 'btn', type: 'button',
    onclick: () => {
      hintEl.textContent = q.cloze.hint;
      hintBtn.disabled = true;
      input.focus({ preventScroll: true });
    },
  }, '提示');
  const playBtn = h('button', {
    class: 'btn btn-icon-text', type: 'button', onclick: () => speak(q.de),
  }, icon('speaker'), '聽整句');
  const input = h('input', {
    class: 'input cloze-input', type: 'text', lang: 'de', autocomplete: 'off', autocapitalize: 'off', spellcheck: false,
    autocorrect: 'off', enterkeyhint: 'done', 'aria-label': '填入空格的單字',
  });
  const checkBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => submit() }, '確認');
  const feedback = h('div', { class: 'cloze-feedback', 'aria-live': 'polite' });
  const nextBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => next() }, '下一題');
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    submit();
  });

  const body = h('div', { class: 'stack' },
    h('div', { class: 'row row-between' }, h('span', { class: 'hint' }, '填入句子裡原本的寫法'), progress),
    h('div', { class: 'cloze-card stack' }, sentenceEl, zhEl, hintEl),
    // 依透露答案的多寡排列：聽整句 → 翻譯 → 提示
    h('div', { class: 'row quiz-tools' }, playBtn, zhToggle, hintBtn),
    h('div', { class: 'row' }, input, checkBtn),
    feedback,
    h('div', { class: 'actions' }, nextBtn),
  );
  view.append(body);

  const blank = (content, state) => h('span', { class: state ? `cloze-blank is-${state}` : 'cloze-blank' }, content);

  function draw() {
    item = round.current;
    q = item.variants[item.tries % item.variants.length];
    answered = false;
    progress.textContent = `剩 ${round.remaining} 個`;
    sentenceEl.replaceChildren(q.cloze.before, blank('\u00a0'.repeat(Math.max(4, q.cloze.answer.length))), q.cloze.after);
    zhEl.textContent = q.zh || '';
    zhToggle.disabled = !q.zh; // 這句沒有翻譯時按鈕不能按
    applyZh();
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
    const result = checkAnswer(input.value, q.cloze);
    const ok = result === 'ok';
    answered = true;
    // 只用第一次的作答標記不熟；答錯的放回這一輪最後面，下次換一句例句
    if (round.answer(ok)) setWeak(item.entry.key, !ok);
    if (!ok) item.tries++;
    sentenceEl.replaceChildren(q.cloze.before, blank(q.cloze.answer, ok ? 'ok' : 'wrong'), q.cloze.after);
    feedback.replaceChildren(ok
      ? h('p', { class: 'ok' }, '✓ 答對了')
      : h('p', { class: 'error' },
        result === 'case' ? '名詞要大寫。' : '答錯了。', '正確答案：', h('b', { lang: 'de' }, q.cloze.answer)));
    input.disabled = true;
    checkBtn.hidden = true;
    nextBtn.hidden = false;
    nextBtn.focus({ preventScroll: true });
    // 作答後不自動唸；要聽就按工具列的「聽整句」
  }

  function next() {
    if (!round.done) draw();
    else showSummary(body, ctx, round, '#/review/cloze');
  }

  draw();
  return () => cancelSpeech();
}

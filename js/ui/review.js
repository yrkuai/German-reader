import { h } from './dom.js';
import { icon } from './icons.js';
import { loadSettings, saveSettings, loadVocab, sentenceLookup, setWeak, answerFlashcard, undoFlashcard } from '../storage.js';
import {
  describe, pickSession, pickDaily, DAILY_CARDS, highlightTokens, pluralNote, makeCloze, checkAnswer, createRound,
} from '../vocab.js';
import { speakOnce, cancelSpeech } from '../speech.js';
import { keepAboveKeyboard } from './keyboard.js';

// 例句填空一輪 10 個字；答錯或「忘了」的放回這一輪最後面，全部答對才結束
const SESSION_SIZE = 10;

// 閃卡：每天依排程出最多 12 張（pickDaily），第一次作答決定下次複習日。
// extra：今天的做完後額外練習，從全部單字隨機抽 12 張，不改排程也不改不熟標記。
// 點卡片正反面來回翻，按「忘了」「不確定」「記得」作答；不自動唸，按喇叭才唸
export function renderFlashcards(view, ctx, extra = false) {
  ctx.setBar(extra ? '閃卡練習' : '閃卡', '#/words');
  const settings = loadSettings();
  const speak = (text) => speakOnce(text, { voiceURI: settings.voiceURI, rate: settings.rate });

  const pool = Object.values(loadVocab());
  if (!pool.length) {
    ctx.navigate('#/words');
    return;
  }
  const picked = extra ? pickSession(pool, DAILY_CARDS) : pickDaily(pool);
  if (!picked.length) {
    view.append(h('div', { class: 'empty flash-done' },
      h('p', {}, '今天的閃卡都完成了'),
      h('p', { class: 'muted' }, '還想練的話可以再練一輪，不會影響複習排程。'),
      h('div', { class: 'actions flash-done-actions' },
        h('a', { class: 'btn', href: '#/words' }, '回到單字本'),
        h('a', { class: 'btn btn-primary', href: '#/review/flash/extra' }, '再練一輪'),
      ),
    ));
    return;
  }
  const lookup = sentenceLookup();
  const round = createRound(picked.map((entry) => ({ entry, d: describe(entry, lookup) })));
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
  // 復原上一次作答（可以一直往回，限這一輪）
  const undoBtn = h('button', { class: 'btn btn-ghost btn-icon-text flash-undo', type: 'button', onclick: () => undo() }, icon('undo'), '復原');
  // 卡片裡面還有喇叭按鈕，所以卡片本身不能是 <button>
  const card = h('div', {
    class: 'flashcard', role: 'button', tabindex: 0,
    onclick: () => flip(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } },
  });
  // 「不確定」和「忘了」一樣：放回這一輪最後面再考，第一次作答時標成不熟
  const answers = h('div', { class: 'flash-answers' },
    h('button', { class: 'btn', type: 'button', onclick: () => answer(false) }, '忘了'),
    h('button', { class: 'btn', type: 'button', onclick: () => answer(false) }, '不確定'),
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => answer(true) }, '記得'),
  );
  const body = h('div', { class: 'stack' },
    h('div', { class: 'row row-between' },
      h('div', { class: 'speed-group', role: 'radiogroup', 'aria-label': '閃卡方向' }, dirButtons),
      h('div', { class: 'row flash-status' }, undoBtn, progress),
    ),
    card,
    answers,
  );
  const screen = [...body.children]; // 結果頁復原時換回來
  view.append(body);

  const dirOf = (c) => (settings.flashDir === 'zh' && c.d.meaning ? 'zh' : 'de');

  // 喇叭按鈕：只唸不翻面
  const speakBtn = (text, label, cls) => h('button', {
    class: `ctrl ${cls}`, type: 'button', 'aria-label': label,
    onclick: (e) => { e.stopPropagation(); speak(text); },
    onkeydown: (e) => e.stopPropagation(),
  }, icon('speaker'));

  function draw() {
    const c = round.current;
    const dir = dirOf(c);
    progress.textContent = `${extra ? '練習 · ' : ''}剩 ${round.remaining} 個`;
    undoBtn.disabled = !round.canUndo;
    card.classList.toggle('is-flipped', flipped);
    card.setAttribute('aria-label', flipped ? '答案，點一下翻回正面' : '點一下看答案');
    // 中→德的正面只有中文，這時唸德文等於洩漏答案，所以不放喇叭
    const wordSpeak = flipped || dir === 'de' ? speakBtn(c.d.display, `唸「${c.d.display}」`, 'flash-speak') : null;

    if (!flipped) {
      fill(card,
        wordSpeak,
        dir === 'de'
          ? h('span', { class: 'flash-word', lang: 'de' }, c.d.display)
          : h('span', { class: 'flash-word flash-zh' }, c.d.meaning),
        settings.flashDir === 'zh' && dir === 'de' ? h('span', { class: 'hint' }, '這個字還沒有翻譯') : null,
      );
      return;
    }

    const ex = c.d.example;
    fill(card,
      wordSpeak,
      h('span', { class: 'flash-word', lang: 'de' }, c.d.display),
      pluralNote(c.d.info) ? h('span', { class: 'flash-grammar' }, pluralNote(c.d.info)) : null,
      h('span', { class: c.d.meaning ? 'flash-meaning' : 'flash-meaning is-empty' }, c.d.meaning || '尚無翻譯'),
      ex
        ? h('span', { class: 'flash-example' },
          h('span', { class: 'flash-example-text' },
            h('span', { class: 'flash-example-de', lang: 'de' }, highlightTokens(ex.de, ex.form).map((p) => (p.hit ? h('b', {}, p.text) : p.text))),
            ex.zh ? h('span', { class: 'flash-example-zh' }, ex.zh) : null,
          ),
          speakBtn(ex.de, '唸例句', 'flash-example-speak'),
        )
        : null,
    );
  }

  function flip() {
    flipped = !flipped;
    draw();
  }

  // 作答前的資料，復原時還原（key：round 裡的項目）
  const before = new Map();

  function answer(ok) {
    const item = round.current;
    // 只用第一次的作答標記不熟、排下次複習；之後重問才記得的，還是算不熟。額外練習不記錄
    if (round.answer(ok) && !extra) before.set(item, answerFlashcard(item.entry.key, ok));
    cancelSpeech();
    flipped = false;
    if (!round.done) draw();
    else {
      showSummary(body, ctx, round, '#/review/flash/extra', {
        missedTitle: extra ? '第一次答錯或不確定：' : '第一次答錯或不確定（已標成「不熟」）：',
        againLabel: extra ? '再練一輪' : '再練一輪（不影響排程）',
        onUndo: undo,
      });
    }
  }

  // 回到上一張，顯示正面重新作答
  function undo() {
    const last = round.undo();
    if (!last) return;
    if (last.first && before.has(last.item)) {
      undoFlashcard(last.item.entry.key, before.get(last.item));
      before.delete(last.item);
    }
    cancelSpeech();
    flipped = false;
    if (body.firstElementChild !== screen[0]) body.replaceChildren(...screen);
    draw();
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

// 例句填空的練習範圍：全部或只練不熟的（閃卡改用排程，不看這個設定）
function practicePool(settings) {
  const all = Object.values(loadVocab());
  return settings.vocabScope === 'weak' ? all.filter((e) => e.weak) : all;
}

// 一輪結束的結果畫面：第一次就答對幾個，第一次答錯的列出來（動詞練習也共用）
// labelOf：答錯清單裡每一項顯示的文字；back：「回到…」按鈕的連結與文字；missedTitle：答錯清單的標題；
// againLabel：再一輪按鈕的文字；onUndo：有的話顯示「復原」，復原最後一次作答
export function showSummary(body, ctx, round, againHash, {
  labelOf = (m) => m.d.display, back = { href: '#/words', label: '回到單字本' },
  missedTitle = '第一次答錯（已標成「不熟」）：', againLabel = '再一輪', onUndo = null,
} = {}) {
  cancelSpeech();
  const missed = round.firstTryWrong();
  body.replaceChildren(h('div', { class: 'empty flash-done' },
    h('p', {}, `${round.total} 個全部完成`),
    h('p', { class: 'muted' }, `第一次就答對 ${round.firstTryCorrect()} 個`),
    missed.length
      ? h('div', { class: 'flash-missed' },
        h('p', { class: 'muted' }, missedTitle),
        h('ul', {}, missed.map((m) => h('li', { lang: 'de' }, labelOf(m)))),
      )
      : null,
    h('div', { class: 'actions flash-done-actions' },
      onUndo ? h('button', { class: 'btn btn-ghost btn-icon-text', type: 'button', onclick: onUndo }, icon('undo'), '復原') : null,
      h('a', { class: 'btn', href: back.href }, back.label),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.navigate(againHash) }, againLabel),
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
    hintBtn.disabled = true; // 答案已經出來了，提示沒有意義
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
  const releaseKeyboard = keepAboveKeyboard(view);
  return () => {
    cancelSpeech();
    releaseKeyboard();
  };
}

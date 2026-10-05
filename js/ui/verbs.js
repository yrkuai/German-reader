import { h } from './dom.js';
import { icon } from './icons.js';
import { showToast } from './toast.js';
import { createSwipeGroup } from './swipe.js';
import { openWordSheet } from './wordSheet.js';
import {
  loadSettings, saveSettings, loadVerbs, addVerbs, addVerbSentences, removeVerb, restoreVerb,
} from '../storage.js';
import {
  PERSONS, PERSON_LABELS, MIX_SIZES, dedupeInput, makeVerbBatches, buildVerbPrompt, buildMorePrompt, parseVerbs,
  parseMoreSentences, markStemChange, highlightVerb, hasWeak,
} from '../verbs.js';
import { ImportError } from '../importer.js';
import { speakOnce, cancelSpeech } from '../speech.js';

// 變化形：換母音的字母標色；可分動詞加上「… auf」
function formNode(verb, p) {
  return h('span', { class: 'verb-form', lang: 'de' },
    markStemChange(verb, p).map((part) => (part.hit ? h('mark', { class: 'verb-change' }, part.text) : part.text)),
    verb.prefix ? ` … ${verb.prefix}` : null,
  );
}

// 動詞列表：每一列最後面有「練習」，點一列打開詳細資料
export function renderVerbs(view, ctx) {
  ctx.setBar('動詞', '#/');
  const settings = loadSettings();
  const speak = (text) => speakOnce(text, { voiceURI: settings.voiceURI, rate: settings.rate });

  // 有不熟人稱的排前面，其餘依加入時間由新到舊
  const verbs = Object.values(loadVerbs())
    .sort((a, b) => (hasWeak(b) - hasWeak(a)) || (b.createdAt - a.createdAt));

  const addLink = h('a', { class: 'btn btn-primary btn-icon-text', href: '#/verbs/new' }, icon('plus'), '新增');

  if (!verbs.length) {
    view.append(
      h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, '動詞'), addLink),
      h('div', { class: 'empty' },
        h('p', {}, '還沒有動詞。'),
        h('p', { class: 'muted' }, '按「新增」加入要練的動詞，用 ChatGPT 或 Claude 產生變化表和例句。'),
      ),
    );
    return () => cancelSpeech();
  }

  const rerender = () => {
    const y = window.scrollY;
    ctx.navigate('#/verbs');
    window.scrollTo(0, y);
  };

  const swipe = createSwipeGroup();
  const list = h('ul', { class: 'article-list' });
  let closeSheet = null;

  // 右上角「總練習」（純文字）：先在面板勾選動詞和題數，再開始
  ctx.addBarAction(h('button', {
    class: 'bar-link', type: 'button',
    onclick: () => { closeSheet = openMixSheet(verbs, ctx); },
  }, '總練習'));

  function remove(verb, li) {
    const removed = removeVerb(verb.key);
    li.style.height = `${li.offsetHeight}px`;
    requestAnimationFrame(() => li.classList.add('is-removing'));
    setTimeout(() => {
      li.remove();
      if (!list.children.length) rerender();
    }, 220);
    showToast(`已刪除「${verb.v}」`, {
      label: '復原',
      duration: 5000,
      onClick: () => {
        if (removed) restoreVerb(removed);
        rerender();
      },
    });
  }

  // 詳細資料：變化表、提示、1 句例句（從所有例句隨機挑一句）
  function open(verb) {
    speak(verb.v);
    const ex = verb.sentences.length ? verb.sentences[Math.floor(Math.random() * verb.sentences.length)] : null;
    closeSheet = openWordSheet({
      word: verb.v,
      grammar: [verb.type, verb.prefix ? '可分動詞' : ''].filter(Boolean).join(' · '),
      meaning: verb.zh || '（沒有中文意思）',
      onSpeak: () => speak(verb.v),
      extra: h('div', { class: 'verb-detail' },
        h('dl', { class: 'verb-table' },
          PERSONS.flatMap((p) => [h('dt', {}, PERSON_LABELS[p]), h('dd', {}, formNode(verb, p))]),
        ),
        verb.tip ? h('p', { class: 'verb-tip' }, verb.tip) : null,
      ),
      example: ex ? { parts: highlightVerb(ex.de, verb.forms[ex.p], verb.prefix), zh: ex.zh } : null,
      onClose: () => { closeSheet = null; },
    });
  }

  for (const verb of verbs) {
    const speakBtn = h('button', {
      class: 'ctrl word-speak', type: 'button', 'aria-label': `唸「${verb.v}」`,
      onclick: (e) => { e.stopPropagation(); speak(verb.v); },
    }, icon('speaker'));
    const practice = h('a', {
      class: 'bar-text verb-practice', href: `#/verbs/practice/${encodeURIComponent(verb.key)}`,
      onclick: (e) => e.stopPropagation(),
    }, '練習');
    const content = h('div', {
      class: 'article-item word-item', role: 'button', tabindex: 0,
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(verb); } },
    },
      speakBtn,
      h('span', { class: 'word-text' },
        h('span', { class: 'word-de', lang: 'de' },
          hasWeak(verb) ? h('span', { class: 'word-weak', 'aria-label': '有不熟的人稱' }) : null,
          verb.v,
          h('span', { class: 'verb-meta' }, [verb.zh, verb.type].filter(Boolean).join(' · ')),
        ),
        h('span', { class: 'verb-forms' },
          PERSONS.flatMap((p, i) => [i ? ' · ' : null, formNode(verb, p)]).filter(Boolean)),
      ),
      practice,
    );
    const action = h('button', { class: 'swipe-delete', type: 'button', 'aria-label': `刪除「${verb.v}」` }, icon('trash'));
    const li = h('li', { class: 'swipe-row' }, action, content);
    action.addEventListener('click', () => remove(verb, li));
    swipe.attach(li, content, action);
    // 在滑動處理之後才註冊：滑動或收回刪除鍵時，swipe 會 preventDefault，這時不打開詳細資料
    content.addEventListener('click', (e) => { if (!e.defaultPrevented) open(verb); });
    list.append(li);
  }

  view.append(
    h('div', { class: 'page-head' }, h('p', { class: 'muted' }, `${verbs.length} 個動詞`), addLink),
    list,
  );

  return () => {
    closeSheet?.();
    swipe.destroy();
    cancelSpeech();
  };
}

// 總練習的選擇面板：勾選動詞（可以全選）、題數；選擇會記住
function openMixSheet(verbs, ctx) {
  const settings = loadSettings();
  const mix = { all: true, keys: [], size: 20, ...settings.verbMix };
  const keys = new Set(mix.all ? verbs.map((v) => v.key) : mix.keys.filter((k) => verbs.some((v) => v.key === k)));
  let size = MIX_SIZES.includes(mix.size) ? mix.size : 20;

  const allBox = h('input', { type: 'checkbox', checked: keys.size === verbs.length });
  const boxes = verbs.map((v) => {
    const box = h('input', { type: 'checkbox', checked: keys.has(v.key), 'data-key': v.key });
    box.addEventListener('change', () => {
      if (box.checked) keys.add(v.key);
      else keys.delete(v.key);
      update();
    });
    return h('label', { class: 'check' }, box, h('span', { lang: 'de' }, v.v));
  });
  allBox.addEventListener('change', () => {
    for (const label of boxes) {
      const box = label.querySelector('input');
      box.checked = allBox.checked;
      if (allBox.checked) keys.add(box.dataset.key);
      else keys.delete(box.dataset.key);
    }
    update();
  });

  const sizeButtons = MIX_SIZES.map((n) => h('button', {
    class: 'speed', type: 'button', role: 'radio', 'data-size': n,
    onclick: () => { size = n; update(); },
  }, String(n)));
  const startBtn = h('button', {
    class: 'btn btn-primary', type: 'button',
    onclick: () => {
      const all = keys.size === verbs.length;
      saveSettings({ ...loadSettings(), verbMix: { all, keys: all ? [] : [...keys], size } });
      close();
      ctx.navigate('#/verbs/mix');
    },
  }, '開始練習');
  const countEl = h('span', {}); // 總題數，一般文字

  function update() {
    allBox.checked = keys.size === verbs.length;
    for (const b of sizeButtons) b.setAttribute('aria-checked', String(Number(b.dataset.size) === size));
    const combos = keys.size * PERSONS.length;
    countEl.textContent = keys.size ? `總練習 ${Math.min(size, combos)} 題` : '請至少勾選一個動詞';
    startBtn.disabled = !keys.size;
  }

  const closeBtn = h('button', { class: 'sheet-close', type: 'button', 'aria-label': '關閉' }, '×');
  const panel = h('div', { class: 'sheet mix-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '總練習' },
    h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
    h('div', { class: 'row row-between' }, h('h2', { class: 'card-title' }, '總練習'), closeBtn),
    h('label', { class: 'check check-all' }, allBox, h('span', {}, `全部（${verbs.length}）`)),
    h('div', { class: 'check-grid' }, boxes),
    h('div', { class: 'row row-between mix-size' },
      h('span', {}, '題數'),
      h('div', { class: 'speed-group', role: 'radiogroup', 'aria-label': '題數' }, sizeButtons),
    ),
    h('div', { class: 'row row-between' }, countEl, startBtn),
  );
  const backdrop = h('div', { class: 'sheet-backdrop' }, panel);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.classList.remove('is-open');
    setTimeout(() => backdrop.remove(), 200);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('is-open'));
  update();
  return close;
}

// 新增頁：上方分頁「新增動詞」「增加例句」（#/verbs/new、#/verbs/more）
// 兩個分頁都是：準備指令 → 複製 → 貼回 AI 的回覆 → 匯入
export function renderNewVerbs(view, ctx, mode = 'new') {
  ctx.setBar(mode === 'more' ? '增加例句' : '新增動詞', '#/verbs');

  const tabs = h('div', { class: 'speed-group verb-tabs', role: 'tablist' },
    [['new', '新增動詞'], ['more', '增加例句']].map(([value, label]) => h('a', {
      class: 'speed', role: 'tab', href: `#/verbs/${value}`, 'aria-selected': String(value === mode),
      'aria-checked': String(value === mode),
    }, label)));

  const batchList = h('ul', { class: 'batches' });
  const fallbackBox = h('textarea', { class: 'input textarea', rows: 8, readOnly: true, hidden: true, 'aria-label': '指令內容' });

  async function copyPrompt(text, btn) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      fallbackBox.value = text;
      fallbackBox.hidden = false;
      fallbackBox.focus();
      fallbackBox.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
    }
    btn.textContent = ok ? '已複製 ✓' : '請手動複製下方文字';
    setTimeout(() => { btn.textContent = '複製指令'; }, 2000);
  }

  // 每 10 個一批，各一顆「複製指令」；沒有可以複製的時，按鈕照樣顯示但不能按
  function showBatches(batches, labelOf, promptOf, emptyText) {
    if (!batches.length) {
      batchList.replaceChildren(h('li', { class: 'batch' },
        h('span', { class: 'batch-label muted' }, emptyText),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, '複製指令'),
      ));
      return;
    }
    batchList.replaceChildren(...batches.map((batch) => {
      const btn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => copyPrompt(promptOf(batch), btn) }, '複製指令');
      return h('li', { class: 'batch' }, h('span', { class: 'batch-label', lang: 'de' }, labelOf(batch)), btn);
    }));
  }

  // ---------- 1. 準備指令 ----------
  let refresh;
  let step1;
  if (mode === 'more') {
    // 勾選要增加例句的動詞
    const verbs = Object.values(loadVerbs()).sort((a, b) => a.v.localeCompare(b.v));
    const selected = new Set();
    const allBox = h('input', { type: 'checkbox' });
    const boxes = verbs.map((v) => {
      const box = h('input', { type: 'checkbox', 'data-key': v.key });
      box.addEventListener('change', () => {
        if (box.checked) selected.add(v.key);
        else selected.delete(v.key);
        refresh();
      });
      return h('label', { class: 'check' }, box, h('span', { lang: 'de' }, `${v.v}（${v.sentences.length} 句）`));
    });
    allBox.addEventListener('change', () => {
      for (const label of boxes) {
        const box = label.querySelector('input');
        box.checked = allBox.checked;
        if (allBox.checked) selected.add(box.dataset.key);
        else selected.delete(box.dataset.key);
      }
      refresh();
    });
    refresh = () => {
      const current = loadVerbs();
      allBox.checked = verbs.length > 0 && selected.size === verbs.length;
      // 重新讀取：匯入後提示詞要附上最新的例句
      const list = verbs.filter((v) => selected.has(v.key)).map((v) => current[v.key]).filter(Boolean);
      showBatches(makeVerbBatches(list), (b) => b.map((v) => v.v).join('、'), buildMorePrompt, '先勾選要增加例句的動詞');
    };
    step1 = h('section', { class: 'settings-section stack' },
      h('h2', { class: 'card-title' }, '1. 勾選動詞並複製指令'),
      h('p', { class: 'hint' }, '每個人稱各再加 2 句新的例句，指令會附上現有的例句，避免重複。每 10 個動詞一批，每一批都要做一次。'),
      verbs.length
        ? [h('label', { class: 'check check-all' }, allBox, h('span', {}, `全部（${verbs.length}）`)), h('div', { class: 'check-grid' }, boxes)]
        : h('p', { class: 'muted' }, '還沒有動詞，先到「新增動詞」加入。'),
      batchList,
      fallbackBox,
    );
  } else {
    const verbsInput = h('textarea', {
      class: 'input textarea', rows: 4, lang: 'de', spellcheck: false, autocapitalize: 'off',
      placeholder: '一行一個動詞，例如：\nfahren\nsein\naufstehen', 'aria-label': '要新增的動詞',
    });
    // 已經建立的動詞直接從清單拿掉，不另外提示
    refresh = () => {
      const verbs = dedupeInput(verbsInput.value, new Set(Object.keys(loadVerbs())));
      showBatches(makeVerbBatches(verbs), (b) => b.join('、'), buildVerbPrompt, '先在上面輸入動詞');
    };
    verbsInput.addEventListener('input', () => refresh());
    step1 = h('section', { class: 'settings-section stack' },
      h('h2', { class: 'card-title' }, '1. 輸入動詞並複製指令'),
      h('p', { class: 'hint' }, '一行一個，也可以用逗號或空白分隔。已經建立的動詞會自動略過；每 10 個動詞一批，每一批都要做一次。'),
      verbsInput,
      batchList,
      fallbackBox,
    );
    setTimeout(() => verbsInput.focus());
  }

  // ---------- 2. 貼回結果 ----------
  const responseInput = h('textarea', {
    class: 'input textarea', rows: 5, spellcheck: false,
    placeholder: '把 AI 的回覆整段貼在這裡…', 'aria-label': 'AI 的回覆',
  });
  const importBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, '匯入');
  const result = h('div', { class: 'result', 'aria-live': 'polite' });
  responseInput.addEventListener('input', () => { importBtn.disabled = !responseInput.value.trim(); });

  const pasteBtn = h('button', {
    class: 'btn btn-icon-text', type: 'button',
    onclick: async () => {
      result.replaceChildren();
      try {
        const text = await navigator.clipboard.readText();
        if (!text.trim()) {
          result.append(h('p', { class: 'error' }, '剪貼簿是空的，請先在 AI 那邊複製回覆內容。'));
          return;
        }
        responseInput.value = text;
        importBtn.disabled = false;
      } catch {
        result.append(h('p', { class: 'error' }, '無法讀取剪貼簿，請長按輸入框手動貼上。'));
        responseInput.focus();
      }
    },
  }, icon('paste'), '從剪貼簿貼上');

  const skippedList = (skipped) => (skipped.length
    ? h('div', { class: 'warn' },
      h('p', {}, `有 ${skipped.length} 筆資料被跳過：`),
      h('ul', {}, skipped.slice(0, 20).map((x) => h('li', {}, `${x.label}：${x.reason}`))),
    )
    : null);

  importBtn.addEventListener('click', () => {
    result.replaceChildren();
    try {
      let message;
      let changed;
      let skipped;
      if (mode === 'more') {
        const parsed = parseMoreSentences(responseInput.value, loadVerbs());
        skipped = parsed.skipped;
        const count = addVerbSentences(parsed.updates);
        changed = count > 0;
        message = changed ? `已為 ${parsed.updates.length} 個動詞增加 ${count} 句例句` : '沒有新的例句。';
      } else {
        const parsed = parseVerbs(responseInput.value, new Set(Object.keys(loadVerbs())));
        skipped = parsed.skipped;
        const added = parsed.verbs.length ? addVerbs(parsed.verbs) : 0;
        changed = added > 0;
        message = changed ? `已新增 ${added} 個動詞：${parsed.verbs.map((v) => v.v).join('、')}` : '沒有新的動詞。';
      }
      result.append(...[
        h('p', { class: changed ? 'ok' : 'muted' }, message),
        skippedList(skipped),
        changed ? h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/verbs' }, '回到動詞列表')) : null,
      ].filter(Boolean));
      if (changed) {
        responseInput.value = '';
        importBtn.disabled = true;
        refresh(); // 新增過的動詞從清單拿掉；增加例句的提示詞改附最新的例句
      }
    } catch (e) {
      if (!(e instanceof ImportError)) throw e;
      result.append(h('p', { class: 'error' }, e.message));
    }
  });

  view.append(
    tabs,
    step1,
    h('section', { class: 'settings-section stack' },
      h('div', { class: 'row row-between' }, h('h2', { class: 'card-title' }, '2. 貼回結果'), pasteBtn),
      responseInput,
      h('div', { class: 'actions' }, importBtn),
      result,
    ),
  );
  refresh();
}

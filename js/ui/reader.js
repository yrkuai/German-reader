import { h } from './dom.js';
import { icon } from './icons.js';
import {
  getArticle, deleteArticle, setLastIndex, loadSettings, saveSettings, loadVocab, markWord, unmarkWord, refreshStoredVocab,
} from '../storage.js';
import { buildMarkIndex, findMarked, vocabKey, displayOf, diffWords } from '../vocab.js';
import { tokenize } from '../segmenter.js';
import { createPlayer, RATES, formatRate, speechSupported, getGermanVoices, onVoicesChanged } from '../speech.js';
import { untranslated, formatRanges, lookupWord, grammarLine } from '../importer.js';
import { openWordSheet } from './wordSheet.js';
import { keepAboveKeyboard } from './keyboard.js';
import { showToast } from './toast.js';

export function renderReader(view, id, ctx) {
  const article = getArticle(id);
  if (!article) {
    ctx.setBar('找不到文章', '#/');
    view.append(
      h('div', { class: 'empty' },
        h('p', {}, '找不到這篇文章，可能已經被刪除。'),
        h('a', { class: 'btn', href: '#/' }, '回到文章列表'),
      ),
    );
    return;
  }

  ctx.setBar(article.title, '#/', { settings: true });

  const settings = loadSettings();
  const total = article.sentences.length;
  let shownIndex = -1;
  let shownPlaying = false;
  let dictation = false; // 聽寫模式：關閉德文、打出聽到的（不存檔，重開文章預設關閉）

  // 標記過的單字加底線（所有文章都會標出來）
  let markIndex = buildMarkIndex(refreshStoredVocab());
  const wordEls = [];
  function updateMarks() {
    markIndex = buildMarkIndex(loadVocab());
    for (const w of wordEls) w.el.classList.toggle('is-marked', !!findMarked(markIndex, w.info, w.form));
  }

  const cards = article.sentences.map((s, i) => {
    const deP = h('p', { class: 'de', lang: 'de' },
      tokenize(s.de).map((t) => {
        if (!t.word) return t.text;
        const info = lookupWord(s.words, t.text);
        const el = h('span', {
          class: findMarked(markIndex, info, t.text) ? 'w is-marked' : 'w',
          onclick: (e) => { e.stopPropagation(); openWord(el, t.text, s, i); },
        }, t.text);
        wordEls.push({ el, info, form: t.text });
        return el;
      }),
    );

    // ---------- 聽寫：德文藏起來，聽音打出整句，對答案逐字標對/錯 ----------
    const input = h('input', {
      class: 'input dictation-input', type: 'text', lang: 'de', autocomplete: 'off',
      autocapitalize: 'off', autocorrect: 'off', spellcheck: false, enterkeyhint: 'done',
      'aria-label': `第 ${i + 1} 句：打出你聽到的`,
    });
    const result = h('div', { class: 'dictation-result', 'aria-live': 'polite' });
    const checkBtn = h('button', { class: 'btn btn-primary dictation-check', type: 'button' }, '對答案');
    const retryBtn = h('button', { class: 'btn dictation-retry', type: 'button', hidden: true }, '重試');

    function check() {
      if (input.disabled) return;
      const diff = diffWords(input.value, s.de);
      const answer = h('p', { class: 'dictation-answer', lang: 'de' },
        diff.words
          .flatMap((w, k) => [k ? ' ' : null, h('span', { class: w.ok ? 'dw' : 'dw is-wrong' }, w.text)])
          .filter((x) => x != null));
      // 只在全對時給一行正向回饋；答錯就靠紅字本身，不再多一行說明文字
      result.replaceChildren(...(diff.correct ? [answer, h('p', { class: 'ok' }, '✓ 全對')] : [answer]));
      input.disabled = true;
      checkBtn.hidden = true;
      retryBtn.hidden = false;
    }
    function retry() {
      result.replaceChildren();
      input.disabled = false;
      checkBtn.hidden = false;
      retryBtn.hidden = true;
      input.focus({ preventScroll: true });
    }
    checkBtn.addEventListener('click', check);
    retryBtn.addEventListener('click', retry);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); check(); }
    });

    // 點輸入框或按鈕不要觸發整句播放（句子本身的 onclick）
    const dictationBox = h('div', { class: 'dictation-box', onclick: (e) => e.stopPropagation() },
      h('div', { class: 'row dictation-row' }, input, checkBtn, retryBtn),
      result,
    );

    return h('li', {
      class: 'sentence', 'data-index': i,
      onclick: () => (player.state.mode === 'all' ? player.goTo(i) : player.loop(i)),
    },
      h('span', { class: 'sentence-no', 'aria-hidden': 'true' }, i + 1),
      h('div', { class: 'sentence-body' }, deP, s.zh ? h('p', { class: 'zh' }, s.zh) : null, dictationBox),
    );
  });

  // ---------- 底部播放列 ----------
  const status = h('span', { class: 'player-status', 'aria-live': 'polite' });

  const speedButtons = RATES.map((rate) =>
    h('button', {
      class: 'speed', type: 'button', role: 'radio', 'data-rate': rate,
      'aria-label': `語速 ${formatRate(rate)} 倍`,
      onclick: () => {
        settings.rate = rate;
        saveSettings({ ...loadSettings(), rate });
        updateSpeedButtons();
        player.speedChanged();
      },
    }, `${formatRate(rate)}x`),
  );

  const firstBtn = h('button', { class: 'ctrl', type: 'button', 'aria-label': '回到第一句', onclick: () => player.goTo(0) }, icon('first'));
  const prevBtn = h('button', { class: 'ctrl', type: 'button', 'aria-label': '上一句', onclick: () => player.prev() }, icon('prev'));
  const nextBtn = h('button', { class: 'ctrl', type: 'button', 'aria-label': '下一句', onclick: () => player.next() }, icon('next'));
  const loopBtn = h('button', {
    class: 'ctrl ctrl-wide', type: 'button', 'aria-label': '單句重複',
    onclick: () => (player.state.mode === 'loop' ? player.stop() : player.loop()),
  }, icon('repeat'), h('span', { 'aria-hidden': 'true' }, '單句'));
  // 整篇播放中顯示暫停圖示；按下會停在目前這句，再按一次從這句繼續
  let allIcon = icon('play');
  const allBtn = h('button', {
    class: 'ctrl ctrl-wide', type: 'button', 'aria-label': '整篇播放',
    onclick: () => (player.state.mode === 'all' ? player.stop() : player.playAll()),
  }, allIcon, h('span', { 'aria-hidden': 'true' }, '整篇'));
  const stopBtn = h('button', { class: 'ctrl', type: 'button', 'aria-label': '停止', onclick: () => player.stop() }, icon('stop'));

  // 錯誤訊息另外放一行，狀態列永遠只有一行，播放列高度不會跳動
  const errorLine = h('p', { class: 'player-error', role: 'alert', hidden: true });

  const bar = h('div', { class: 'player' },
    h('div', { class: 'player-inner' },
      errorLine,
      h('div', { class: 'player-top' },
        status,
        h('div', { class: 'speed-group', role: 'radiogroup', 'aria-label': '語速' }, speedButtons),
      ),
      h('div', { class: 'player-controls' }, firstBtn, prevBtn, allBtn, loopBtn, nextBtn, stopBtn),
    ),
  );

  const notice = h('p', { class: 'notice', hidden: true });

  // ---------- 顯示／隱藏中文翻譯 ----------
  const sentenceList = h('ol', { class: 'sentences' }, cards);
  // 翻譯按鈕：填滿＝顯示翻譯，灰色＝隱藏翻譯
  const zhToggle = h('button', {
    class: 'zh-toggle', type: 'button', 'aria-label': '顯示中文翻譯',
    onclick: () => {
      settings.showZh = !settings.showZh;
      saveSettings({ ...loadSettings(), showZh: settings.showZh });
      applyZh();
    },
  }, icon('translate'));
  function applyZh() {
    sentenceList.classList.toggle('hide-zh', !settings.showZh);
    zhToggle.setAttribute('aria-pressed', String(settings.showZh));
    zhToggle.title = settings.showZh ? '隱藏中文翻譯' : '顯示中文翻譯';
  }
  ctx.addBarAction(zhToggle);
  applyZh();

  // ---------- 聽寫模式開關：關閉德文，打出聽到的 ----------
  const dictToggle = h('button', {
    class: 'zh-toggle', type: 'button',
    onclick: () => {
      dictation = !dictation;
      if (dictation) player.stop(); // 進聽寫先停掉播放，避免整篇循環干擾打字
      applyDictation();
    },
  }, icon('pencil'));
  function applyDictation() {
    sentenceList.classList.toggle('dictation', dictation);
    dictToggle.setAttribute('aria-pressed', String(dictation));
    const label = dictation ? '離開聽寫' : '聽寫：關閉德文，打出聽到的';
    dictToggle.title = label;
    dictToggle.setAttribute('aria-label', label);
  }
  ctx.addBarAction(dictToggle);
  applyDictation();

  // ---------- 點單字：中斷播放、唸單字、顯示意思；關閉後回到原本的播放 ----------
  let closeSheet = null;
  function openWord(el, word, sentence, index) {
    closeSheet?.();
    el.classList.add('is-active');
    player.speakWord(word);
    const info = lookupWord(sentence.words, word);
    closeSheet = openWordSheet({
      word,
      grammar: grammarLine(info, word),
      meaning: info?.meaning,
      onSpeak: () => player.speakWord(word),
      mark: {
        marked: !!findMarked(markIndex, info, word),
        // 回傳切換後是否已標記
        onToggle: () => {
          const key = findMarked(markIndex, info, word);
          if (key) {
            unmarkWord(key);
          } else {
            markWord({
              key: vocabKey(info, word),
              display: displayOf(info, word),
              form: word,
              source: { articleId: article.id, index, de: sentence.de, zh: sentence.zh || null, form: word },
            });
          }
          updateMarks();
          return !key;
        },
      },
      onClose: () => {
        el.classList.remove('is-active');
        closeSheet = null;
        player.resume();
      },
    });
  }

  const translateHash = `#/translate/${encodeURIComponent(article.id)}`;
  const missing = untranslated(article);
  const translateBanner = missing.length
    ? h('p', { class: 'notice notice-info' },
      missing.length === total ? '這篇還沒有中文翻譯。' : `第 ${formatRanges(missing)} 句還沒有翻譯。`,
      h('a', { href: translateHash }, '取得翻譯'))
    : null;

  const player = createPlayer({
    sentences: article.sentences,
    settings,
    startIndex: Math.min(article.lastIndex || 0, total - 1),
    onChange: render,
  });

  function render({ mode, index, error }) {
    const playing = mode !== 'idle';

    if (index !== shownIndex || playing !== shownPlaying) {
      cards[shownIndex]?.classList.remove('is-current', 'is-playing');
      cards[index].classList.add('is-current');
      cards[index].classList.toggle('is-playing', playing);
      if (index !== shownIndex && shownIndex !== -1) {
        cards[index].scrollIntoView({ block: 'nearest', behavior: playing ? 'smooth' : 'auto' });
      }
      shownIndex = index;
      shownPlaying = playing;
      setLastIndex(article.id, index);
    }

    loopBtn.classList.toggle('is-active', mode === 'loop');
    loopBtn.setAttribute('aria-pressed', String(mode === 'loop'));
    allBtn.classList.toggle('is-active', mode === 'all');
    allBtn.setAttribute('aria-pressed', String(mode === 'all'));
    const allName = mode === 'all' ? 'pause' : 'play';
    if (allIcon.dataset.name !== allName) {
      const next = icon(allName);
      next.dataset.name = allName;
      allIcon.replaceWith(next);
      allIcon = next;
      allBtn.setAttribute('aria-label', mode === 'all' ? '暫停整篇播放' : '整篇播放');
    }
    stopBtn.disabled = !playing;
    firstBtn.disabled = index === 0;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === total - 1;

    status.textContent = `第 ${index + 1} / ${total} 句`;
    errorLine.textContent = error || '';
    if (errorLine.hidden !== !error) {
      errorLine.hidden = !error;
      updatePlayerHeight();
    }
  }

  function updatePlayerHeight() {
    document.documentElement.style.setProperty('--player-h', `${bar.offsetHeight}px`);
  }

  function updateSpeedButtons() {
    for (const btn of speedButtons) {
      btn.setAttribute('aria-checked', String(Number(btn.dataset.rate) === settings.rate));
    }
  }

  function checkVoices() {
    if (!speechSupported) {
      notice.textContent = '這個瀏覽器不支援語音播放，請改用 Chrome、Edge 或 Safari。';
      notice.hidden = false;
      for (const b of [loopBtn, allBtn, ...speedButtons]) b.disabled = true;
      return;
    }
    const none = getGermanVoices().length === 0;
    notice.replaceChildren('這台裝置找不到德文語音，播放的口音可能不正確。', h('a', { href: '#/settings' }, '看設定說明'));
    notice.hidden = !none;
  }

  view.append(
    notice,
    translateBanner || '',
    sentenceList,
    h('div', { class: 'article-actions' },
      missing.length ? null : h('a', { class: 'btn btn-ghost', href: translateHash }, '重新匯入翻譯'),
      deleteControl(article, ctx),
    ),
    bar,
  );
  updatePlayerHeight();

  updateSpeedButtons();
  render(player.state);
  // 語音清單可能還沒載入；等一下再檢查，避免一打開就誤報
  const stopWatchingVoices = onVoicesChanged(checkVoices);
  const voiceCheckTimer = setTimeout(checkVoices, 1500);
  if (!speechSupported || getGermanVoices().length) checkVoices();

  if (shownIndex > 0) {
    requestAnimationFrame(() => cards[shownIndex].scrollIntoView({ block: 'center' }));
  }

  const flash = ctx.takeFlash();
  if (flash) showToast(flash);

  // 聽寫輸入框聚焦時，把它維持在鍵盤上方（手機）
  const releaseKeyboard = keepAboveKeyboard(view);

  return () => {
    closeSheet?.();
    player.destroy();
    stopWatchingVoices();
    clearTimeout(voiceCheckTimer);
    releaseKeyboard();
    document.documentElement.style.setProperty('--player-h', '0px');
  };
}

// 刪除需要二次確認，做在畫面上（不用 confirm()）
function deleteControl(article, ctx) {
  const wrap = h('div', { class: 'danger-zone' });
  const ask = () => {
    wrap.replaceChildren(
      h('span', {}, '確定要刪除這篇文章？'),
      h('button', { class: 'btn', type: 'button', onclick: idle }, '取消'),
      h('button', {
        class: 'btn btn-danger', type: 'button',
        onclick: () => { deleteArticle(article.id); ctx.navigate('#/'); },
      }, '刪除'),
    );
  };
  function idle() {
    wrap.replaceChildren(h('button', { class: 'btn btn-ghost', type: 'button', onclick: ask }, '刪除文章'));
  }
  idle();
  return wrap;
}

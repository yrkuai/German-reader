import { h } from './dom.js';
import { icon } from './icons.js';
import { getArticle, deleteArticle, setLastIndex, loadSettings, saveSettings } from '../storage.js';
import { tokenize } from '../segmenter.js';
import { createPlayer, SPEEDS, speechSupported, getGermanVoices, onVoicesChanged } from '../speech.js';
import { untranslated, formatRanges, lookupMeaning } from '../importer.js';
import { openWordSheet } from './wordSheet.js';

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

  const cards = article.sentences.map((s, i) =>
    h('li', { class: 'sentence', 'data-index': i, onclick: () => player.goTo(i) },
      h('button', {
        class: 'sentence-play', type: 'button', 'aria-label': `重複播放第 ${i + 1} 句`,
        onclick: (e) => { e.stopPropagation(); player.loop(i); },
      }, icon('repeat'), h('span', { class: 'sentence-no' }, i + 1)),
      h('div', { class: 'sentence-body' },
        h('p', { class: 'de', lang: 'de' },
          tokenize(s.de).map((t) => (t.word
            ? h('span', { class: 'w', onclick: (e) => { e.stopPropagation(); openWord(e.currentTarget, t.text, s); } }, t.text)
            : t.text)),
        ),
        s.zh ? h('p', { class: 'zh' }, s.zh) : null,
      ),
    ),
  );

  // ---------- 底部播放列 ----------
  const status = h('span', { class: 'player-status', 'aria-live': 'polite' });

  const speedButtons = Object.entries(SPEEDS).map(([key, { label, rate }]) =>
    h('button', {
      class: 'speed', type: 'button', role: 'radio', 'data-speed': key,
      'aria-label': `${label} ${rate} 倍`,
      onclick: () => {
        settings.speed = key;
        saveSettings({ ...loadSettings(), speed: key });
        updateSpeedButtons();
        player.speedChanged();
      },
    }, label, h('small', {}, `${rate}x`)),
  );

  const prevBtn = h('button', { class: 'ctrl', type: 'button', 'aria-label': '上一句', onclick: () => player.prev() }, icon('prev'));
  const nextBtn = h('button', { class: 'ctrl', type: 'button', 'aria-label': '下一句', onclick: () => player.next() }, icon('next'));
  const loopBtn = h('button', {
    class: 'ctrl ctrl-wide', type: 'button',
    onclick: () => (player.state.mode === 'loop' ? player.stop() : player.loop()),
  }, icon('repeat'), h('span', {}, '單句重複'));
  const allBtn = h('button', {
    class: 'ctrl ctrl-wide', type: 'button',
    onclick: () => (player.state.mode === 'all' ? player.stop() : player.playAll()),
  }, icon('play'), h('span', {}, '整篇播放'));
  const stopBtn = h('button', { class: 'ctrl', type: 'button', 'aria-label': '停止', onclick: () => player.stop() }, icon('stop'));

  const bar = h('div', { class: 'player' },
    h('div', { class: 'player-inner' },
      h('div', { class: 'player-top' },
        status,
        h('div', { class: 'speed-group', role: 'radiogroup', 'aria-label': '語速' }, speedButtons),
      ),
      h('div', { class: 'player-controls' }, prevBtn, loopBtn, allBtn, nextBtn, stopBtn),
    ),
  );

  const notice = h('p', { class: 'notice', hidden: true });

  // ---------- 顯示／隱藏中文翻譯 ----------
  const sentenceList = h('ol', { class: 'sentences' }, cards);
  const zhToggle = h('button', {
    class: 'zh-toggle', type: 'button', 'aria-label': '顯示中文翻譯',
    onclick: () => {
      settings.showZh = !settings.showZh;
      saveSettings({ ...loadSettings(), showZh: settings.showZh });
      applyZh();
    },
  }, '中');
  function applyZh() {
    sentenceList.classList.toggle('hide-zh', !settings.showZh);
    zhToggle.setAttribute('aria-pressed', String(settings.showZh));
    zhToggle.title = settings.showZh ? '隱藏中文翻譯' : '顯示中文翻譯';
  }
  ctx.addBarAction(zhToggle);
  applyZh();

  // ---------- 點單字：中斷播放、唸單字、顯示意思；關閉後回到原本的播放 ----------
  let closeSheet = null;
  function openWord(el, word, sentence) {
    closeSheet?.();
    el.classList.add('is-active');
    player.speakWord(word);
    closeSheet = openWordSheet({
      word,
      meaning: lookupMeaning(sentence.words, word),
      onSpeak: () => player.speakWord(word),
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

  function render({ mode, index, phase, error }) {
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
    stopBtn.disabled = !playing;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === total - 1;

    status.classList.toggle('is-error', !!error);
    if (error) status.textContent = error;
    else if (mode === 'loop') status.textContent = `第 ${index + 1} 句 · ${phase === 'pause' ? '停頓…' : '重複中'}`;
    else if (mode === 'all') status.textContent = `播放中 ${index + 1} / ${total}`;
    else status.textContent = `第 ${index + 1} / ${total} 句`;
  }

  function updateSpeedButtons() {
    for (const btn of speedButtons) {
      btn.setAttribute('aria-checked', String(btn.dataset.speed === settings.speed));
    }
  }

  function checkVoices() {
    if (!speechSupported) {
      notice.textContent = '這個瀏覽器不支援語音播放，請改用 Chrome、Edge 或 Safari。';
      notice.hidden = false;
      for (const b of [loopBtn, allBtn, ...speedButtons]) b.disabled = true;
      for (const c of cards) c.querySelector('.sentence-play').disabled = true;
      return;
    }
    const none = getGermanVoices().length === 0;
    notice.replaceChildren('這台裝置找不到德文語音，播放的口音可能不正確。', h('a', { href: '#/settings' }, '看設定說明'));
    notice.hidden = !none;
  }

  view.append(
    notice,
    translateBanner,
    sentenceList,
    h('div', { class: 'article-actions' },
      missing.length ? null : h('a', { class: 'btn btn-ghost', href: translateHash }, '重新匯入翻譯'),
      deleteControl(article, ctx),
    ),
    bar,
  );
  document.documentElement.style.setProperty('--player-h', `${bar.offsetHeight}px`);

  updateSpeedButtons();
  render(player.state);
  // 語音清單可能還沒載入；等一下再檢查，避免一打開就誤報
  const stopWatchingVoices = onVoicesChanged(checkVoices);
  const voiceCheckTimer = setTimeout(checkVoices, 1500);
  if (!speechSupported || getGermanVoices().length) checkVoices();

  if (shownIndex > 0) {
    requestAnimationFrame(() => cards[shownIndex].scrollIntoView({ block: 'center' }));
  }

  return () => {
    closeSheet?.();
    player.destroy();
    stopWatchingVoices();
    clearTimeout(voiceCheckTimer);
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

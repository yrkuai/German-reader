import { h } from './dom.js';
import { icon } from './icons.js';
import { showToast } from './toast.js';
import { createSwipeGroup } from './swipe.js';
import { openWordSheet } from './wordSheet.js';
import {
  loadSettings, saveSettings, refreshStoredVocab, sentenceLookup, unmarkWord, restoreWord,
} from '../storage.js';
import { describe, highlightTokens, pluralNote } from '../vocab.js';
import { speakOnce, cancelSpeech } from '../speech.js';

// 單字本：列出所有標記的單字，上方選練習範圍、進入閃卡
export function renderWords(view, ctx) {
  ctx.setBar('單字本', '#/');
  const settings = loadSettings();
  const speak = (text) => speakOnce(text, { voiceURI: settings.voiceURI, rate: settings.rate });

  const lookup = sentenceLookup();
  // 不熟的排前面，其餘依加入時間由新到舊
  const items = Object.values(refreshStoredVocab())
    .map((entry) => ({ entry, d: describe(entry, lookup) }))
    .sort((a, b) => (b.entry.weak - a.entry.weak) || (b.entry.createdAt - a.entry.createdAt));

  if (!items.length) {
    view.append(h('div', { class: 'empty' },
      h('p', {}, '單字本是空的。'),
      h('p', { class: 'muted' }, '在文章裡點單字，按 ☆ 就會加入單字本。'),
      h('a', { class: 'btn', href: '#/' }, '回到文章列表'),
    ));
    return () => cancelSpeech();
  }

  // 重新整理列表，但保留捲動位置
  const rerender = () => {
    const y = window.scrollY;
    ctx.navigate('#/words');
    window.scrollTo(0, y);
  };

  // ---------- 練習範圍與入口 ----------
  const weakCount = items.filter((i) => i.entry.weak).length;
  if (settings.vocabScope === 'weak' && !weakCount) settings.vocabScope = 'all';

  const flashBtn = h('a', { class: 'btn btn-primary words-start', href: '#/review/flash' }, '閃卡');
  const clozeBtn = h('a', { class: 'btn btn-primary words-start', href: '#/review/cloze' }, '例句填空');
  const scopeButtons = [['all', `全部 ${items.length}`], ['weak', `不熟 ${weakCount}`]].map(([value, label]) =>
    h('button', {
      class: 'speed', type: 'button', role: 'radio', 'data-scope': value, disabled: value === 'weak' && !weakCount,
      onclick: () => {
        settings.vocabScope = value;
        saveSettings({ ...loadSettings(), vocabScope: value });
        showScope();
      },
    }, label),
  );
  const showScope = () => {
    for (const b of scopeButtons) b.setAttribute('aria-checked', String(b.dataset.scope === settings.vocabScope));
  };
  showScope();

  // ---------- 列表：往左滑刪除，點一列打開單字抽屜 ----------
  const swipe = createSwipeGroup();
  const list = h('ul', { class: 'article-list' });
  let closeSheet = null;

  function remove(item, li) {
    const removed = unmarkWord(item.entry.key);
    li.style.height = `${li.offsetHeight}px`;
    requestAnimationFrame(() => li.classList.add('is-removing'));
    setTimeout(() => {
      li.remove();
      if (!list.children.length) rerender();
    }, 220);
    showToast(`已移除「${item.d.display}」`, {
      label: '復原',
      duration: 5000,
      onClick: () => {
        if (removed) restoreWord(removed);
        rerender();
      },
    });
  }

  function open(item) {
    const { entry, d } = item;
    speak(d.display);
    let removed = null;
    closeSheet = openWordSheet({
      word: d.display,
      grammar: pluralNote(d.info),
      meaning: d.meaning,
      example: d.example ? { parts: highlightTokens(d.example.de, d.example.form), zh: d.example.zh } : null,
      onSpeak: () => speak(d.display),
      mark: {
        marked: true,
        onToggle: () => {
          if (removed) {
            restoreWord(removed);
            removed = null;
            return true;
          }
          removed = unmarkWord(entry.key);
          return false;
        },
      },
      onClose: () => {
        closeSheet = null;
        if (removed) rerender();
      },
    });
  }

  for (const item of items) {
    const { entry, d } = item;
    const speakBtn = h('button', {
      class: 'ctrl word-speak', type: 'button', 'aria-label': `唸「${d.display}」`,
      onclick: (e) => { e.stopPropagation(); speak(d.display); },
    }, icon('speaker'));
    const content = h('div', {
      class: 'article-item word-item', role: 'button', tabindex: 0,
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(item); } },
    },
      speakBtn,
      h('span', { class: 'word-text' },
        h('span', { class: 'word-de', lang: 'de' }, entry.weak ? h('span', { class: 'word-weak', 'aria-label': '不熟' }) : null, d.display),
        h('span', { class: d.meaning ? 'word-zh' : 'word-zh is-empty' }, d.meaning || '尚無翻譯'),
      ),
    );
    const action = h('button', { class: 'swipe-delete', type: 'button', 'aria-label': `移除「${d.display}」` }, icon('trash'));
    const li = h('li', { class: 'swipe-row' }, action, content);
    action.addEventListener('click', () => remove(item, li));
    swipe.attach(li, content, action);
    // 在滑動處理之後才註冊：滑動或收回刪除鍵時，swipe 會 preventDefault，這時不打開抽屜
    content.addEventListener('click', (e) => { if (!e.defaultPrevented) open(item); });
    list.append(li);
  }

  view.append(
    h('section', { class: 'stack words-head' },
      h('div', { class: 'speed-group', role: 'radiogroup', 'aria-label': '練習範圍' }, scopeButtons),
      h('div', { class: 'row' }, flashBtn, clozeBtn),
    ),
    list,
  );

  return () => {
    closeSheet?.();
    swipe.destroy();
    cancelSpeech();
  };
}

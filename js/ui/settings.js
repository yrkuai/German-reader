import { h } from './dom.js';
import { icon } from './icons.js';
import { loadSettings, saveSettings } from '../storage.js';
import { applyTheme, applyDeSize } from '../theme.js';
import { speechSupported, getGermanVoices, onVoicesChanged, speakOnce, cancelSpeech } from '../speech.js';

const SAMPLE = 'Guten Tag! Ich lerne Deutsch, und das macht mir viel Spaß.';

export function renderSettings(view, ctx) {
  // 設定頁像一個暫時打開的視窗：沒有返回鍵，右上角用 ✕ 關閉（位置和設定圖示相同）
  ctx.setBar('設定', null);
  const close = () => ctx.navigate(ctx.previousHash());
  ctx.addBarAction(h('button', { class: 'bar-back', type: 'button', 'aria-label': '關閉設定', onclick: close }, icon('close')));
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const settings = loadSettings();
  const save = () => saveSettings(settings);

  // ---------- 語音 ----------
  const voiceSelect = h('select', { class: 'input', 'aria-label': '德文語音' });

  function populateVoices() {
    const voices = getGermanVoices();
    voiceSelect.replaceChildren(
      h('option', { value: '' }, voices.length ? `自動（${voices[0].name}）` : '自動'),
      ...voices.map((v) => h('option', { value: v.voiceURI }, `${v.name} · ${v.lang}${v.localService ? '' : ' · 需網路'}`)),
    );
    voiceSelect.value = voices.some((v) => v.voiceURI === settings.voiceURI) ? settings.voiceURI : '';
  }

  voiceSelect.addEventListener('change', () => {
    settings.voiceURI = voiceSelect.value || null;
    save();
  });

  const testBtn = h('button', {
    class: 'btn', type: 'button', disabled: !speechSupported,
    onclick: () => speakOnce(SAMPLE, { voiceURI: settings.voiceURI, rate: settings.rate }),
  }, '試聽');

  // ---------- 停頓 ----------
  const pauseLabel = h('output', { class: 'value' });
  const pauseInput = h('input', {
    class: 'range', type: 'range', min: 500, max: 5000, step: 100, value: settings.pauseMs,
    'aria-label': '單句重複的停頓秒數',
  });
  const showPause = () => { pauseLabel.textContent = `${(settings.pauseMs / 1000).toFixed(1)} 秒`; };
  pauseInput.addEventListener('input', () => {
    settings.pauseMs = Number(pauseInput.value);
    showPause();
    save();
  });
  showPause();

  // ---------- 外觀 ----------
  const themeButtons = [['auto', '自動'], ['light', '淺色'], ['dark', '深色']].map(([value, label]) =>
    h('button', {
      class: 'speed', type: 'button', role: 'radio', 'data-theme-value': value,
      onclick: () => {
        settings.theme = value;
        save();
        applyTheme(value);
        showTheme();
      },
    }, label),
  );
  const showTheme = () => {
    for (const b of themeButtons) b.setAttribute('aria-checked', String(b.dataset.themeValue === settings.theme));
  };
  showTheme();

  // ---------- 德文字級 ----------
  const sizeButtons = [['s', '小'], ['m', '中'], ['l', '大']].map(([value, label]) =>
    h('button', {
      class: 'speed', type: 'button', role: 'radio', 'data-size-value': value,
      onclick: () => {
        settings.deSize = value;
        save();
        applyDeSize(value);
        showSize();
      },
    }, label),
  );
  const showSize = () => {
    for (const b of sizeButtons) b.setAttribute('aria-checked', String(b.dataset.sizeValue === settings.deSize));
  };
  showSize();

  view.append(
    h('section', { class: 'settings-section stack' },
      h('div', { class: 'row row-between' },
        h('h2', { class: 'card-title' }, '外觀'),
        h('div', { class: 'speed-group', role: 'radiogroup', 'aria-label': '外觀' }, themeButtons),
      ),
    ),
    h('section', { class: 'settings-section stack' },
      h('div', { class: 'row row-between' },
        h('h2', { class: 'card-title' }, '德文字級'),
        h('div', { class: 'speed-group', role: 'radiogroup', 'aria-label': '德文字級' }, sizeButtons),
      ),
    ),
    h('section', { class: 'settings-section stack' },
      h('h2', { class: 'card-title' }, '德文語音'),
      speechSupported ? null : h('p', { class: 'notice' }, '這個瀏覽器不支援語音播放，請改用 Chrome、Edge 或 Safari。'),
      h('div', { class: 'row' }, voiceSelect, testBtn),
      h('p', { class: 'hint' }, '標示「需網路」的語音音質通常比較好，但沒有網路時無法使用。'),
    ),
    h('section', { class: 'settings-section stack' },
      h('div', { class: 'row row-between' }, h('h2', { class: 'card-title' }, '單句重複的停頓'), pauseLabel),
      pauseInput,
      h('p', { class: 'hint' }, '每次重複之間留一段空檔，讓你跟著唸。'),
    ),
    h('section', { class: 'settings-section stack' },
      h('h2', { class: 'card-title' }, '德文語音安裝說明'),
      h('ul', { class: 'tips' },
        h('li', {}, h('b', {}, 'Windows：'), '用 Edge 瀏覽器，選名稱有「Online (Natural)」的語音（例如 Katja、Conrad）。'),
        h('li', {}, h('b', {}, 'iPhone / iPad：'), '設定 → 輔助使用 → 朗讀內容 → 聲音 → 德文，下載「Anna（增強版）」或其他高品質語音，再回來重新整理。'),
        h('li', {}, h('b', {}, 'Android：'), '設定 → 文字轉語音 → Google 語音服務 → 安裝語音資料 → 德文。'),
      ),
    ),
  );

  populateVoices();
  const stopWatching = onVoicesChanged(populateVoices);

  return () => {
    document.removeEventListener('keydown', onKey);
    stopWatching();
    cancelSpeech();
  };
}

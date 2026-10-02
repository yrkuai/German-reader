import { h } from './dom.js';
import { icon } from './icons.js';
import { showToast } from './toast.js';
import { loadSync, saveSync, clearSync } from '../storage.js';
import {
  syncNow, findOrCreateGist, getSyncStatus, onSyncStatus,
  encodePairCode, decodePairCode, pairUrl, SyncError, TOKEN_URL,
} from '../sync.js';
import qrcode from '../vendor/qrcode.js';

// 設定頁的「同步」區塊。回傳 { el, cleanup }
export function syncSection() {
  const el = h('section', { class: 'settings-section stack' });
  let stopWatching = () => {};
  let clock = null;
  let closeMenu = () => {};
  let closeDialog = () => {};

  function draw() {
    stopWatching();
    clearInterval(clock);
    closeMenu();
    if (loadSync()) drawConnected();
    else drawSetup();
  }

  // ---------- 未設定 ----------
  function drawSetup() {
    const input = h('input', {
      class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: false,
      placeholder: '貼上 GitHub 金鑰或配對碼', 'aria-label': 'GitHub 金鑰或配對碼',
    });
    const msg = h('div', { class: 'result', 'aria-live': 'polite' });
    const connectBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, '開始同步');
    input.addEventListener('input', () => { connectBtn.disabled = !input.value.trim(); });

    // iPhone 第一次會跳出「貼上」的確認
    const pasteBtn = h('button', {
      class: 'btn btn-icon-text', type: 'button',
      onclick: async () => {
        msg.replaceChildren();
        try {
          const text = (await navigator.clipboard.readText()).trim();
          if (!text) throw new Error('empty');
          input.value = text;
          connectBtn.disabled = false;
        } catch {
          msg.append(h('p', { class: 'error' }, '無法讀取剪貼簿，請長按輸入框手動貼上。'));
          input.focus();
        }
      },
    }, icon('paste'), '貼上');

    connectBtn.addEventListener('click', async () => {
      msg.replaceChildren();
      const text = input.value.trim();
      const pair = decodePairCode(text);
      if (pair) {
        saveSync({ ...pair, lastSyncAt: null });
        draw();
        syncNow();
        showToast('✓ 已設定同步');
        return;
      }
      if (!/^[A-Za-z0-9_]{20,}$/.test(text)) {
        msg.append(h('p', { class: 'error' }, '看起來不是 GitHub 金鑰或配對碼，請重新複製。'));
        return;
      }
      connectBtn.disabled = true;
      connectBtn.textContent = '連線中…';
      try {
        const gistId = await findOrCreateGist(text);
        saveSync({ token: text, gistId, lastSyncAt: null });
        draw();
        await syncNow();
        showToast('✓ 已設定同步');
      } catch (e) {
        if (!(e instanceof SyncError)) throw e;
        msg.append(h('p', { class: 'error' }, e.message));
        connectBtn.disabled = false;
        connectBtn.textContent = '開始同步';
      }
    });

    el.replaceChildren(
      h('h2', { class: 'card-title' }, '同步'),
      h('p', { class: 'hint' }, '讓電腦和手機的文章自動同步，資料存在你自己 GitHub 帳號的 Secret Gist。不設定也可以照常使用，文章只存在這台裝置。'),
      h('ul', { class: 'tips' },
        h('li', {}, h('b', {}, '第一台裝置：'), '點下方「建立 GitHub 金鑰」，在 GitHub 按「Generate token」，把金鑰複製回來貼上。'),
        h('li', {}, h('b', {}, '其他裝置：'), '在已設定的裝置上按「⋯」→「配對裝置」掃 QR code，或貼上「配對碼」。'),
      ),
      h('div', { class: 'row' },
        h('a', { class: 'btn', href: TOKEN_URL, target: '_blank', rel: 'noopener' }, '建立 GitHub 金鑰'),
      ),
      h('div', { class: 'row' }, input, pasteBtn),
      h('div', { class: 'actions' }, connectBtn),
      msg,
    );
  }

  // ---------- 已設定 ----------
  function drawConnected() {
    const sync = loadSync();
    const statusText = h('span', { class: 'hint' });
    const error = h('p', { class: 'error', hidden: true });
    const syncBtn = h('button', { class: 'btn', type: 'button', onclick: () => syncNow() }, '立即同步');

    const showStatus = () => {
      const s = getSyncStatus();
      statusText.textContent = s.state === 'syncing' ? '同步中…' : s.lastSyncAt ? `上次同步：${formatTime(s.lastSyncAt)}` : '尚未同步';
      syncBtn.disabled = s.state === 'syncing';
      error.hidden = s.state !== 'error';
      error.textContent = s.error || '';
    };
    stopWatching = onSyncStatus(showStatus);
    clock = setInterval(showStatus, 30000);
    showStatus();

    // ⋯ 選單：配對裝置、複製配對碼、停止同步
    const menu = createMenu([
      { label: '配對裝置', onSelect: () => { closeDialog = openPairDialog(sync); } },
      {
        label: '複製配對碼',
        onSelect: async () => {
          const ok = await copyText(encodePairCode(sync));
          showToast(ok ? '✓ 已複製配對碼，只傳給自己的裝置' : '無法複製，請改用「配對裝置」掃 QR code');
        },
      },
      null, // 分隔線
      {
        label: '停止同步',
        danger: true,
        onSelect: () => {
          clearSync();
          syncNow(); // 狀態改回「未設定」
          draw();
          showToast('已停止同步，這台裝置的文章都還在', {
            label: '復原',
            duration: 5000,
            onClick: () => {
              saveSync(sync);
              draw();
              syncNow();
            },
          });
        },
      },
    ]);
    closeMenu = menu.close;

    el.replaceChildren(
      h('div', { class: 'row row-between' }, h('h2', { class: 'card-title' }, '同步'), statusText),
      error,
      h('div', { class: 'row row-between' }, syncBtn, menu.el),
    );
  }

  draw();
  return {
    el,
    cleanup: () => {
      stopWatching();
      clearInterval(clock);
      closeMenu();
      closeDialog();
    },
  };
}

// 掃 QR code 打開的配對頁：#/pair/<配對碼>
export function renderPair(view, code, ctx) {
  ctx.setBar('同步配對', '#/');
  const pair = decodePairCode(code);
  // 把金鑰從網址列和瀏覽紀錄拿掉
  history.replaceState(null, '', `${location.pathname}${location.search}#/pair`);

  if (!pair) {
    view.append(h('section', { class: 'settings-section stack' },
      h('p', { class: 'error' }, '配對碼無效或已不完整，請在另一台裝置上重新顯示 QR code。'),
      h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/' }, '回到文章列表')),
    ));
    return;
  }

  // iPhone 的 Safari 和主畫面 App 儲存是分開的：在 Safari 裡只提供複製，不存金鑰
  if (isIOSBrowserTab()) {
    const copyBtn = h('button', {
      class: 'btn btn-primary', type: 'button',
      onclick: async () => {
        const ok = await copyText(encodePairCode(pair));
        copyBtn.textContent = ok ? '已複製 ✓' : '無法複製';
        setTimeout(() => { copyBtn.textContent = '複製配對碼'; }, 2000);
      },
    }, '複製配對碼');
    view.append(h('section', { class: 'settings-section stack' },
      h('h2', { class: 'card-title' }, '在主畫面的 App 完成設定'),
      h('ol', { class: 'tips' },
        h('li', {}, '按下方「複製配對碼」。'),
        h('li', {}, '打開主畫面上的 German Reader。'),
        h('li', {}, '設定 → 同步 → 按「貼上」→「開始同步」。'),
      ),
      h('div', { class: 'actions' }, copyBtn),
    ));
    return;
  }

  saveSync({ ...pair, lastSyncAt: null });
  syncNow();
  showToast('✓ 已設定同步，正在下載文章…');
  setTimeout(() => ctx.navigate('#/'));
}

function isIOSBrowserTab() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  return ios && !standalone;
}

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

// 回傳是否複製成功
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 不支援剪貼簿 API 時，用暫時的輸入框複製
    const box = h('textarea', { style: 'position:fixed;top:0;opacity:0', readOnly: true });
    box.value = text;
    document.body.append(box);
    box.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    box.remove();
    return ok;
  }
}

// 「⋯」下拉選單。items：{ label, onSelect, danger } 或 null（分隔線）
// 點選單外面、按 Esc、選了項目都會關閉。回傳 { el, close }
function createMenu(items) {
  const trigger = h('button', {
    class: 'menu-trigger', type: 'button', 'aria-label': '更多選項',
    'aria-haspopup': 'menu', 'aria-expanded': 'false',
  }, icon('more'));
  const list = h('div', { class: 'menu', role: 'menu', hidden: true },
    items.map((item) => (item
      ? h('button', {
        class: item.danger ? 'menu-item is-danger' : 'menu-item', type: 'button', role: 'menuitem',
        onclick: () => { close(); item.onSelect(); },
      }, item.label)
      : h('div', { class: 'menu-separator', role: 'separator' }))),
  );
  const el = h('div', { class: 'menu-wrap' }, trigger, list);

  function onOutside(e) {
    if (!el.contains(e.target)) close();
  }
  function onKey(e) {
    if (e.key === 'Escape') {
      close();
      trigger.focus();
    }
  }
  function open() {
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey);
  }
  function close() {
    if (list.hidden) return;
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('keydown', onKey);
  }
  trigger.addEventListener('click', () => (list.hidden ? open() : close()));
  return { el, close };
}

// 配對用的 QR code 彈窗，置中顯示。點右上角 ×、點遮罩或按 Esc 關閉。回傳 close()
function openPairDialog(sync) {
  const previousFocus = document.activeElement;
  const closeBtn = h('button', { class: 'sheet-close', type: 'button', 'aria-label': '關閉' }, '×');
  const qr = h('div', { class: 'qr', role: 'img', 'aria-label': '配對用的 QR code' });
  qr.innerHTML = qrSvg(pairUrl(sync));
  const panel = h('div', { class: 'dialog stack', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pair-dialog-title' },
    h('div', { class: 'row row-between' }, h('h2', { class: 'card-title', id: 'pair-dialog-title' }, '配對裝置'), closeBtn),
    qr,
    h('p', { class: 'hint' }, '用手機相機掃描，掃了就會自動設定好。QR code 裡含有金鑰，不要截圖或分享給別人。'),
    h('p', { class: 'hint' }, 'iPhone：掃描後會用 Safari 打開，請在那個畫面按「複製配對碼」，再到主畫面的 German Reader → 設定 → 同步 貼上。'),
  );
  const backdrop = h('div', { class: 'dialog-backdrop' }, panel);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.classList.remove('is-open');
    setTimeout(() => backdrop.remove(), 200);
    previousFocus?.focus?.({ preventScroll: true });
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('is-open'));
  closeBtn.focus({ preventScroll: true });
  return close;
}

function formatTime(t) {
  const diff = Date.now() - t;
  if (diff < 60000) return '剛剛';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分鐘前`;
  const d = new Date(t);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === new Date().toDateString() ? `今天 ${time}` : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

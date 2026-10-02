import { h } from './dom.js';
import { getArticle, saveArticle } from '../storage.js';
import { makeBatches, buildPrompt } from '../prompt.js';
import { parseResponse, mergeTranslations, untranslated, formatRanges, ImportError } from '../importer.js';

export function renderTranslate(view, id, ctx) {
  let article = getArticle(id);
  const readerHash = `#/read/${encodeURIComponent(id)}`;
  if (!article) {
    ctx.navigate('#/');
    return;
  }
  ctx.setBar('取得翻譯', readerHash);

  const total = article.sentences.length;
  const batches = makeBatches(total);

  // ---------- 步驟 1：複製指令 ----------
  const fallbackBox = h('textarea', { class: 'input textarea', rows: 8, readOnly: true, hidden: true, 'aria-label': '指令內容' });
  const batchRows = batches.map((b) => {
    const state = h('span', { class: 'batch-state' });
    const btn = h('button', {
      class: 'btn btn-primary', type: 'button',
      onclick: () => copyPrompt(buildPrompt(article.sentences, b.start, b.end), btn),
    }, '複製指令');
    const label = batches.length === 1 ? `全部 ${total} 句` : `第 ${b.start}–${b.end} 句`;
    return { b, state, row: h('li', { class: 'batch' }, h('span', { class: 'batch-label' }, label, state), btn) };
  });

  function refreshBatchStates() {
    for (const { b, state } of batchRows) {
      const done = article.sentences.slice(b.start - 1, b.end).every((s) => s.zh);
      state.textContent = done ? ' ✓ 已匯入' : '';
    }
  }

  async function copyPrompt(text, btn) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // 不支援剪貼簿 API 時，顯示文字讓使用者自己複製
      fallbackBox.value = text;
      fallbackBox.hidden = false;
      fallbackBox.focus();
      fallbackBox.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
    }
    const original = '複製指令';
    btn.textContent = ok ? '已複製 ✓' : '請手動複製下方文字';
    setTimeout(() => { btn.textContent = original; }, 2000);
  }

  // ---------- 步驟 3：貼回結果 ----------
  const responseInput = h('textarea', {
    class: 'input textarea', rows: 8, spellcheck: false,
    placeholder: '把 AI 的回覆整段貼在這裡…', 'aria-label': 'AI 的回覆',
  });
  const importBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, '匯入');
  const result = h('div', { class: 'result', 'aria-live': 'polite' });
  responseInput.addEventListener('input', () => { importBtn.disabled = !responseInput.value.trim(); });

  importBtn.addEventListener('click', () => {
    result.replaceChildren();
    try {
      const { items, skipped } = parseResponse(responseInput.value, total);
      article = mergeTranslations(article, items);
      const saved = saveArticle(article);
      const missing = untranslated(article);

      // 全部成功：直接回到文章，在那裡顯示提示
      if (saved && !skipped.length && !missing.length) {
        ctx.setFlash(`✓ 已匯入 ${items.length} 句翻譯`);
        ctx.navigate(readerHash);
        return;
      }

      result.append(...[
        h('p', { class: 'ok' }, `已匯入 ${items.length} 句（第 ${formatRanges(items.map((i) => i.n))} 句）。`),
        skipped.length
          ? h('div', { class: 'warn' },
            h('p', {}, `有 ${skipped.length} 筆資料被跳過：`),
            h('ul', {}, skipped.slice(0, 10).map((s) => h('li', {}, `第 ${s.index} 筆：${s.reason}`))),
          )
          : null,
        saved ? null : h('p', { class: 'error' }, '無法存到瀏覽器（可能是空間已滿），翻譯只會保留到關閉網頁為止。'),
        missing.length
          ? h('p', { class: 'muted' }, `還沒有翻譯：第 ${formatRanges(missing)} 句。請複製對應批次的指令再做一次。`)
          : h('p', { class: 'ok' }, '全部句子都有翻譯了！'),
        h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: readerHash }, '回到文章')),
      ].filter(Boolean));
      responseInput.value = '';
      importBtn.disabled = true;
      refreshBatchStates();
    } catch (e) {
      if (!(e instanceof ImportError)) throw e;
      result.append(h('p', { class: 'error' }, e.message));
    }
  });

  view.append(
    h('p', { class: 'muted intro' }, '網站不會自己連線到 AI。請照下面三個步驟，在免費的 ChatGPT 或 Claude 和這裡之間複製貼上。'),
    h('section', { class: 'card stack' },
      h('h2', { class: 'card-title' }, '1. 複製指令'),
      batches.length > 1
        ? h('p', { class: 'hint' }, `文章有 ${total} 句，分成 ${batches.length} 批，避免 AI 的回覆太長被截斷。每一批都要做一次步驟 1～3，順序不拘。`)
        : null,
      h('ul', { class: 'batches' }, batchRows.map((r) => r.row)),
      fallbackBox,
    ),
    h('section', { class: 'card stack' },
      h('h2', { class: 'card-title' }, '2. 貼到 AI'),
      h('p', { class: 'hint' }, '貼上指令後送出。等它回覆完，按回覆中程式碼區塊右上角的「複製」。'),
      h('div', { class: 'row wrap' },
        h('a', { class: 'btn', href: 'https://chatgpt.com/', target: '_blank', rel: 'noopener' }, '開啟 ChatGPT ↗'),
        h('a', { class: 'btn', href: 'https://claude.ai/new', target: '_blank', rel: 'noopener' }, '開啟 Claude ↗'),
      ),
    ),
    h('section', { class: 'card stack' },
      h('h2', { class: 'card-title' }, '3. 貼回結果'),
      responseInput,
      h('div', { class: 'actions' }, importBtn),
      result,
    ),
  );

  refreshBatchStates();
}

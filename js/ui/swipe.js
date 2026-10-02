// 列表項目往左滑，露出右側的刪除按鈕（參考 iPhone 郵件 App）
// - 手指一開始主要往左右移動才算滑動；主要往上下就照常捲動
// - 滑超過按鈕寬度的一半就固定打開，否則彈回
// - 同一時間只開一個；點別的地方或捲動時收回
// - 打開時點項目本身只會收回，不會進入文章

const ACTION_WIDTH = 80;
const START_THRESHOLD = 8;

export function createSwipeGroup() {
  let openRow = null;

  const closeOpen = () => openRow?.close();
  const onOutside = (e) => {
    if (openRow && !openRow.contains(e.target)) closeOpen();
  };
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('scroll', closeOpen, { passive: true });

  function attach(row, content, action) {
    let offset = 0;
    let startX = 0;
    let startY = 0;
    let startOffset = 0;
    let state = 'idle'; // 'idle' | 'pending' | 'swiping' | 'scrolling'
    let suppressClick = false;

    const setOffset = (value, animate) => {
      offset = value;
      content.classList.toggle('is-dragging', !animate);
      content.style.transform = value ? `translateX(${value}px)` : '';
      const open = value !== 0;
      action.tabIndex = open ? 0 : -1;
      action.setAttribute('aria-hidden', String(!open));
    };

    const api = {
      contains: (node) => row.contains(node),
      close() {
        setOffset(0, true);
        if (openRow === api) openRow = null;
      },
      open() {
        if (openRow && openRow !== api) openRow.close();
        setOffset(-ACTION_WIDTH, true);
        openRow = api;
      },
    };

    content.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // 手指滑動後瀏覽器不一定會觸發 click，所以每次按下都重設
      suppressClick = false;
      startX = e.clientX;
      startY = e.clientY;
      startOffset = offset;
      state = 'pending';
    });

    content.addEventListener('pointermove', (e) => {
      if (state === 'idle' || state === 'scrolling') return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (state === 'pending') {
        if (Math.abs(dx) < START_THRESHOLD && Math.abs(dy) < START_THRESHOLD) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          state = 'scrolling';
          return;
        }
        state = 'swiping';
        if (openRow && openRow !== api) openRow.close();
        content.setPointerCapture(e.pointerId);
      }
      // 往右最多回到 0；往左超過按鈕寬度後阻力變大
      let next = startOffset + dx;
      if (next > 0) next = 0;
      if (next < -ACTION_WIDTH) next = -ACTION_WIDTH + (next + ACTION_WIDTH) / 3;
      setOffset(next, false);
    });

    const finish = () => {
      if (state === 'swiping') {
        suppressClick = true;
        if (offset < -ACTION_WIDTH / 2) api.open();
        else api.close();
      }
      state = 'idle';
    };
    content.addEventListener('pointerup', finish);
    content.addEventListener('pointercancel', finish);

    content.addEventListener('click', (e) => {
      if (suppressClick || offset !== 0) {
        e.preventDefault();
        if (!suppressClick) api.close();
      }
      suppressClick = false;
    });

    // 拖曳連結時瀏覽器預設會拖出網址，關掉
    content.addEventListener('dragstart', (e) => e.preventDefault());

    setOffset(0, true);
    return api;
  }

  function destroy() {
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('scroll', closeOpen);
  }

  return { attach, destroy };
}

// iPhone 鍵盤升起時，Safari 會自己把頁面往上推（常把輸入框推到畫面中間，標題列也被推出去）。
// 這裡在它推完之後校正：輸入框本來就露在鍵盤上方就捲回原位；被擋住才捲，而且只捲到輸入框剛好露出。
// 只有支援 visualViewport 的瀏覽器有效；桌機沒有螢幕鍵盤，算出來不用捲，不會有影響
const GAP = 12; // 輸入框和鍵盤之間留的距離

export function keepAboveKeyboard(container) {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const topbar = document.querySelector('.topbar');
  let active = null;
  let startY = 0;
  let frame = 0;
  const timers = [];

  function adjust() {
    frame = 0;
    if (!active) return;
    // innerHeight 在 iPhone 上不會因為鍵盤變小，差值就是鍵盤的高度。頁面底部補上這段空白，內容短時也捲得到
    const keyboard = Math.max(0, window.innerHeight - vv.height);
    document.body.style.paddingBottom = keyboard ? `${keyboard}px` : '';
    // 都用文件座標：輸入框底部要落在可見範圍的底部之內
    const bottom = active.getBoundingClientRect().bottom + window.scrollY + GAP;
    const target = Math.max(startY, bottom - vv.height);
    if (Math.abs(vv.pageTop - target) > 1) window.scrollTo(0, target);
    // Safari 有時是移動「可見範圍」而不是捲頁面，置頂的標題列會跟著跑出畫面，把它移回可見範圍的頂端
    if (topbar) topbar.style.transform = vv.offsetTop > 0 ? `translateY(${vv.offsetTop}px)` : '';
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(adjust); };

  function reset() {
    active = null;
    document.body.style.paddingBottom = '';
    if (topbar) topbar.style.transform = '';
  }

  const isInput = (el) => el instanceof HTMLInputElement && container.contains(el);
  function onFocusIn(e) {
    if (!isInput(e.target)) return;
    if (!active) startY = window.scrollY; // 兩個輸入框之間切換時沿用一開始的位置
    active = e.target;
    schedule();
    // 鍵盤升起的動畫結束後 Safari 可能會再捲一次，晚一點再校正
    timers.push(setTimeout(schedule, 150), setTimeout(schedule, 400));
  }
  function onFocusOut() {
    // 焦點移到另一個輸入框時不重設
    timers.push(setTimeout(() => { if (!isInput(document.activeElement)) reset(); }, 0));
  }

  container.addEventListener('focusin', onFocusIn);
  container.addEventListener('focusout', onFocusOut);
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  return () => {
    container.removeEventListener('focusin', onFocusIn);
    container.removeEventListener('focusout', onFocusOut);
    vv.removeEventListener('resize', schedule);
    vv.removeEventListener('scroll', schedule);
    cancelAnimationFrame(frame);
    timers.forEach(clearTimeout);
    reset();
  };
}

// 外觀：'auto' 跟著裝置的深色模式，'light' / 'dark' 固定
// index.html 的 <head> 另有一段小程式，在畫面出現前先套用，避免閃一下

const BAR_COLORS = { light: '#ffffff', dark: '#090909' };

// 德文字級：中是預設，不加屬性
export function applyDeSize(size) {
  const root = document.documentElement;
  if (size === 's' || size === 'l') root.dataset.deSize = size;
  else delete root.dataset.deSize;
}

export function applyTheme(theme) {
  const root = document.documentElement;
  const fixed = theme === 'light' || theme === 'dark';
  if (fixed) root.dataset.theme = theme;
  else delete root.dataset.theme;

  // 手機上方狀態列的顏色也要跟著換
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    if (meta.dataset.media === undefined) meta.dataset.media = meta.getAttribute('media') || '';
    if (fixed) {
      meta.removeAttribute('media');
      meta.content = BAR_COLORS[theme];
    } else {
      meta.setAttribute('media', meta.dataset.media);
      meta.content = meta.dataset.media.includes('dark') ? BAR_COLORS.dark : BAR_COLORS.light;
    }
  }
}

import { icon } from './icons.js';

// 建立 DOM 元素的小工具：h('button', { class: 'btn', onclick }, '文字')
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else if (value !== false) el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

// 聽整句的速度膠囊：一顆按鈕中間分隔成兩半，左半＝一般 1.0x，右半＝慢速 0.7x。
// 兩半都唸同一句，只差速度；不放整句文字。onPlay(rate) 由呼叫端負責發音。
export function speedPlayPill(onPlay) {
  const fast = h('button', {
    class: 'speed-half speed-fast', type: 'button',
    'aria-label': '一般速度播放整句',
    onclick: () => onPlay(1.0),
  }, icon('speaker'));
  const slow = h('button', {
    class: 'speed-half speed-slow', type: 'button',
    'aria-label': '慢速播放整句',
    onclick: () => onPlay(0.7),
  }, icon('speaker'), h('span', { class: 'speed-tag' }, '慢'));
  return h('div', { class: 'speed-pill', role: 'group', 'aria-label': '聽整句' }, fast, slow);
}

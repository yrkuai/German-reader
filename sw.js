// Service Worker：讓 App 可以離線打開
// 策略：網路優先（3 秒內沒回應就用快取），所以有網路時一定拿到最新版，
// 沒網路時用上次存下來的檔案。新增或改名檔案時，記得更新 APP_FILES 和 CACHE。

const CACHE = 'gr-v9';
const NETWORK_TIMEOUT_MS = 3000;

const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/segmenter.js',
  './js/storage.js',
  './js/theme.js',
  './js/speech.js',
  './js/prompt.js',
  './js/importer.js',
  './js/ui/dom.js',
  './js/ui/icons.js',
  './js/ui/library.js',
  './js/ui/reader.js',
  './js/ui/settings.js',
  './js/ui/toast.js',
  './js/ui/translate.js',
  './js/ui/wordSheet.js',
  './fonts/inter-latin-wght-normal.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gr-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // 只處理自己網站的 GET；外部連結（ChatGPT、Claude）不管
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  network.catch(() => {}); // 逾時後才失敗的請求不要變成未處理的錯誤

  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
  try {
    const response = await Promise.race([network, timeout]);
    if (response) return response;
  } catch {
    // 沒有網路，改用快取
  }

  // 網址帶 #hash 不影響比對；網頁本身都對應到 index.html
  const cached = await cache.match(request, { ignoreSearch: true })
    || (request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
  return cached || network;
}

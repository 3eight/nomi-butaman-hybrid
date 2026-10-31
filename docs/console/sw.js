/**
 * 能美豚饅 蒸し・会計・注文管理システム (v0.2)
 * Service Worker（オフライン時の画面表示用キャッシュ）
 * - ルート（/sw.js）から配信し、アプリ全体を管理範囲にする
 * - キャッシュするのは同じサイトの GET（画面ファイル）だけ。API・POST・他サイトへの通信は扱わない
 * ※仕様通り、通信切断時の競合解決および画面非表示中の通知挙動は「現場未検証(UNVERIFIED)」として扱う
 */

const CACHE_NAME = 'nomi-butaman-pwa-v03';
const ASSETS_TO_CACHE = [
  '/',
  '/public/index.html',
  '/public/styles.css',
  '/public/app.js',
  '/public/manifest.webmanifest',
  '/public/icon.svg',
  '/src/index.js',
  '/src/models.js',
  '/src/serviceCalculator.js',
  '/src/storeManager.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // GET 以外・他サイト・API はブラウザに任せる（キャッシュしない）
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // 通信できるときは常に最新を取得し、取れないときだけキャッシュを返す
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
  );
});

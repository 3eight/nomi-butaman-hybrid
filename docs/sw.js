/* 能美豚饅 蒸しHUD サービスワーカー
 * 画面ファイルを端末にキャッシュし、電波が弱い/圏外でも起動できるようにする。
 * GAS への通信（別オリジン）は扱わない。
 */
var CACHE = 'nomi-hud-v3';
var ASSETS = ['./', 'index.html', 'styles.css', 'config.js', 'core.js', 'sync.js', 'app.js', 'icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // ネットワーク優先（更新を反映）→ 失敗・3秒超過ならキャッシュ
  event.respondWith(new Promise(function (resolve) {
    var settled = false;
    var fromCache = function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('index.html'); });
    };
    var timer = setTimeout(function () {
      fromCache().then(function (hit) { if (hit && !settled) { settled = true; resolve(hit); } });
    }, 3000);
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      clearTimeout(timer);
      if (!settled) { settled = true; resolve(res); }
    }).catch(function () {
      clearTimeout(timer);
      fromCache().then(function (hit) { if (!settled) { settled = true; resolve(hit || Response.error()); } });
    });
  }));
});

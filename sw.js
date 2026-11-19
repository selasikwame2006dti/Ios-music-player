/* Tunebox offline support: keeps a copy of the app so it opens with no internet.
   Your music is never cached here — it is always read straight from your own files. */
var CACHE = 'tunebox-v6';
var ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/metadata.js',
  'icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'manifest.webmanifest'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Online: fetch the latest version (and keep a copy). Offline or very slow: use the saved copy.
// This way updates show up right away, and Tunebox still always opens without internet.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (cache) {
    var fromCache = function () {
      return cache.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || (req.mode === 'navigate' ? cache.match('index.html') : undefined);
      });
    };
    var net = fetch(req).then(function (res) {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    });
    // don't wait forever on a bad connection
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 3500); }).then(fromCache);
    return Promise.race([net.catch(fromCache), timeout.then(function (r) { return r || net; })]);
  }));
});

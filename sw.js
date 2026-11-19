/* Tunebox offline support: keeps a copy of the app so it opens with no internet.
   Your music is never cached here — it is always read straight from your own files. */
var CACHE = 'tunebox-v4';
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

// Serve from the cache straight away (instant + offline), and refresh the cache in the
// background so the next visit gets any update.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(function () {
        return hit || (req.mode === 'navigate' ? cache.match('index.html') : undefined);
      });
      return hit || net;
    });
  }));
});

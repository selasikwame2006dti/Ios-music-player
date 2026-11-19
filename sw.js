/* Tunebox offline support: keeps a copy of the app so it opens with no internet.
   Your music is never cached here — it is always read straight from your own files. */
var CACHE = 'tunebox-v9';
var ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/metadata.js',
  'js/vendor/qrcode.js', 'js/vendor/jsqr.js', 'js/vendor/peerjs.js',
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

// "Share to Tunebox" (Android): keep the shared songs, then open the app to play them.
function idbPut(key, value) {
  return new Promise(function (resolve) {
    var r = indexedDB.open('tunebox');
    r.onsuccess = function () {
      var db = r.result;
      if (!db.objectStoreNames.contains('kv')) { db.close(); resolve(false); return; }
      var tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { resolve(false); };
    };
    r.onerror = function () { resolve(false); };
  });
}
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'POST' || !/\/share-target\/?$/.test(url.pathname)) return;
  e.respondWith((async function () {
    try {
      var form = await e.request.formData();
      var files = form.getAll('audio').filter(function (f) { return f && f.size; });
      var list = await Promise.all(files.map(async function (f) {
        return { name: f.name || 'Shared song', type: f.type, blob: new Blob([await f.arrayBuffer()], { type: f.type }) };
      }));
      await idbPut('shared', list);
    } catch (err) { /* ignore */ }
    return Response.redirect('./?shared=1', 303);
  })());
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

// tapping a song notification brings Tunebox back to the front
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) return list[i].focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  }));
});

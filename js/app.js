/*
 * Tunebox — a local-files music player that runs in the browser.
 * Classic script (no modules) so it also works when opened straight from disk (file://).
 */
(function () {
  'use strict';

  var AUDIO_EXT = ['mp3', 'm4a', 'm4b', 'aac', 'mp4', 'wav', 'aif', 'aiff', 'flac', 'ogg', 'oga', 'opus', 'webm', 'caf'];
  var IMG_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
  var PALETTE = [
    ['#ff8a4c', '#e8366b'], ['#5b8cff', '#8e4dff'], ['#22c1a1', '#2a7bd6'], ['#f7b733', '#fc4a1a'],
    ['#ec6ead', '#7650c9'], ['#43cea2', '#185a9d'], ['#ff6e7f', '#bf5ae0'], ['#c79a5b', '#7a4b2a']
  ];
  var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  var ICON_NOTE = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3z"/></svg>';
  var ICON_PLAY = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5.1v13.8a1 1 0 0 0 1.5.8l10.8-6.9a1 1 0 0 0 0-1.6L9.5 4.3A1 1 0 0 0 8 5.1"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24"><rect fill="currentColor" x="6" y="5" width="4" height="14" rx="1"/><rect fill="currentColor" x="14" y="5" width="4" height="14" rx="1"/></svg>';
  var ICON_SHUFFLE = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M10.6 9.2 5.4 4 4 5.4l5.2 5.2zM14.5 4l2 2L4 18.6 5.4 20 18 7.5l2 2V4zm.3 9.4-1.4 1.4 3.1 3.1-2 2.1H20v-5.5l-2 2z"/></svg>';

  function $(id) { return document.getElementById(id); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  /* ------------------------------ state ------------------------------ */

  var state = {
    tracks: [],
    byId: new Map(),
    byPath: new Map(),
    folderImages: new Map(),   // dir path -> { file, score }
    folders: [],
    view: 'songs',             // songs | albums | artists | queue | album | artist
    parentView: 'songs',
    detail: null,              // album key or artist name for detail views
    filter: '',
    sort: { key: 'default', dir: 1 },
    list: null,                // cached ids for the current list view
    albums: null,              // cached album groups
    queue: [],
    originalQueue: [],
    qIndex: -1,
    shuffle: false,
    repeat: 'off',             // off | all | one
    current: null,
    selectedId: null
  };
  var nextId = 1;

  var settings = loadSettings();
  state.shuffle = !!settings.shuffle;
  state.repeat = settings.repeat || 'off';

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem('tunebox.settings') || '{}'); } catch (e) { return {}; }
  }
  function saveSettings() {
    settings.shuffle = state.shuffle;
    settings.repeat = state.repeat;
    settings.volume = audio.volume;
    settings.muted = audio.muted;
    try { localStorage.setItem('tunebox.settings', JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  /* ------------------------------ helpers ------------------------------ */

  function extOf(name) {
    var i = name.lastIndexOf('.');
    return i < 0 ? '' : name.slice(i + 1).toLowerCase();
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtTime(s) {
    if (!isFinite(s) || s < 0) return '0:00';
    s = Math.floor(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }
  function fmtLong(s) {
    var m = Math.round(s / 60);
    if (m < 1) return 'under a minute';
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' hr ' + (m % 60) + ' min';
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function hashIdx(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h) % PALETTE.length;
  }
  function hexRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function initials(s) {
    var w = s.replace(/^the\s+/i, '').split(/\s+/).filter(Boolean);
    return ((w[0] || '?').charAt(0) + (w[1] ? w[1].charAt(0) : '')).toUpperCase();
  }
  function cmpStr(a, b) {
    return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  }
  function sortName(s) { return s.replace(/^the\s+/i, ''); }
  function shuffleArr(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function throttle(fn, ms) {
    var t = null, pending = false;
    return function () {
      if (t) { pending = true; return; }
      fn();
      t = setTimeout(function () { t = null; if (pending) { pending = false; fn(); } }, ms);
    };
  }
  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  var toastTimer;
  function toast(msg, ms) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 3200);
  }
  function setStatus(msg) { $('scanStatus').textContent = msg || ''; }

  /* ------------------------------ library ------------------------------ */

  function cleanFileTitle(name) {
    var base = name.replace(/\.[^.]+$/, '');
    return base.replace(/^\d{1,2}[-.]\d{1,3}[\s._-]+/, '').replace(/^\d{1,3}[\s._-]+(?=\D)/, '').replace(/_/g, ' ').trim() || base;
  }

  function makeTrack(file, path, ext) {
    var parts = path.split('/');
    var name = parts[parts.length - 1];
    var dir = parts.slice(0, -1).join('/');
    var title = cleanFileTitle(name);
    var artist = parts.length >= 3 ? parts[parts.length - 3] : '';
    var album = parts.length >= 2 ? parts[parts.length - 2] : '';
    // "Artist - Title.mp3" beats guessing the artist from folder names
    if (title.indexOf(' - ') > 0) {
      artist = title.slice(0, title.indexOf(' - ')).trim();
      title = title.slice(title.indexOf(' - ') + 3).trim();
    }
    var tn = /^(\d{1,3})[\s._-]/.exec(name);
    return {
      id: nextId++,
      file: file,
      path: path,
      dir: dir,
      ext: ext,
      title: title,
      artist: artist || 'Unknown Artist',
      album: album || 'Unknown Album',
      albumArtist: '',
      track: tn ? parseInt(tn[1], 10) : 0,
      disc: 0,
      year: 0,
      duration: 0,
      tagged: false,
      broken: false,
      albumKey: ''
    };
  }

  function computeAlbumKey(t) {
    t.albumKey = t.album.toLowerCase() + '\u0001' + (t.albumArtist ? t.albumArtist.toLowerCase() : t.dir);
  }

  function imageScore(name) {
    var n = name.toLowerCase();
    if (/^(cover|folder|front)\./.test(n)) return 3;
    if (/^albumart.*large/.test(n)) return 2;
    if (/(cover|front|folder|albumart)/.test(n)) return 1;
    return 0;
  }

  function ingest(entries, rootName) {
    var added = [], skippedDrm = 0;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var fname = e.file.name;
      if (fname.charAt(0) === '.') continue; // macOS "._" resource files etc.
      var ext = extOf(fname);
      var dir = e.path.slice(0, Math.max(0, e.path.lastIndexOf('/')));
      if (IMG_EXT.indexOf(ext) >= 0) {
        var sc = imageScore(fname), prev = state.folderImages.get(dir);
        if (!prev || sc > prev.score) state.folderImages.set(dir, { file: e.file, score: sc });
        continue;
      }
      if (ext === 'm4p') { skippedDrm++; continue; }
      if (AUDIO_EXT.indexOf(ext) < 0) continue;
      if (state.byPath.has(e.path)) continue;
      var t = makeTrack(e.file, e.path, ext);
      computeAlbumKey(t);
      state.tracks.push(t);
      state.byId.set(t.id, t);
      state.byPath.set(t.path, t);
      added.push(t);
    }
    if (rootName && state.folders.indexOf(rootName) < 0) state.folders.push(rootName);
    invalidate();
    renderAll();
    if (skippedDrm) toast(plural(skippedDrm, 'copy-protected iTunes file') + ' (.m4p) skipped — browsers can’t play those.', 5000);
    if (!added.length && !skippedDrm) toast('No playable music found there.');
    if (added.length) {
      toast('Added ' + plural(added.length, 'song') + '.');
      scanTags(added);
      maybeRestoreLast();
    }
  }

  function clearLibrary() {
    stop();
    closeNowPlaying();
    state.tracks = [];
    state.byId = new Map();
    state.byPath = new Map();
    state.folderImages = new Map();
    state.folders = [];
    state.queue = [];
    state.originalQueue = [];
    state.qIndex = -1;
    state.current = null;
    coverCache.forEach(function (p) { p.then(function (c) { if (c) URL.revokeObjectURL(c.url); }); });
    coverCache = new Map();
    coverSync = new Map();
    tagQueue = [];
    durQueue = [];
    idbSet('handles', []);
    $('reopenBanner').hidden = true;
    invalidate();
    setView('songs');
    updateNowPlaying();
  }

  /* --------------------------- tags & durations --------------------------- */

  var tagQueue = [], tagRunning = 0, tagDone = 0, tagTotal = 0;
  var refreshSoon = throttle(function () { invalidate(); renderAll(true); }, 1500);

  function scanTags(tracks) {
    tagQueue = tagQueue.concat(tracks);
    tagTotal += tracks.length;
    for (var i = tagRunning; i < 3; i++) tagWorker();
  }

  async function tagWorker() {
    tagRunning++;
    while (tagQueue.length) {
      var t = tagQueue.shift();
      var m = await Meta.read(t.file, t.ext, false);
      if (m.title) t.title = m.title;
      if (m.artist) t.artist = m.artist;
      if (m.album) t.album = m.album;
      if (m.albumArtist) t.albumArtist = m.albumArtist;
      if (m.track) t.track = m.track;
      if (m.disc) t.disc = m.disc;
      if (m.year) t.year = m.year;
      t.tagged = true;
      computeAlbumKey(t);
      tagDone++;
      if (tagDone % 25 === 0 || !tagQueue.length) setStatus('Reading song info… ' + tagDone + ' / ' + tagTotal);
      refreshSoon();
      if (t === state.current) updateNowPlaying();
    }
    tagRunning--;
    if (!tagRunning) {
      setStatus(plural(state.tracks.length, 'song'));
      tagDone = tagTotal = 0;
      invalidate();
      renderAll(true);
      startDurations();
    }
  }

  // Durations need the browser to open each file, so do them one at a time in the background.
  var durQueue = [], durRunning = false;
  var probe = new Audio();
  probe.preload = 'metadata';
  probe.muted = true;
  var rowsSoon = throttle(function () { renderRows(); updateHeroMeta(); }, 1000);

  function startDurations() {
    durQueue = state.tracks.filter(function (t) { return !t.duration && !t.broken; });
    if (!durRunning) durWorker();
  }
  async function durWorker() {
    durRunning = true;
    while (durQueue.length) {
      var t = durQueue.shift();
      if (t.duration) continue;
      t.duration = await probeDuration(t.file);
      rowsSoon();
    }
    durRunning = false;
  }
  function probeDuration(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), done = false;
      function finish(d) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        probe.onloadedmetadata = probe.onerror = null;
        probe.removeAttribute('src');
        probe.load();
        URL.revokeObjectURL(url);
        resolve(isFinite(d) && d > 0 ? d : 0);
      }
      var timer = setTimeout(function () { finish(0); }, 8000);
      probe.onloadedmetadata = function () { finish(probe.duration); };
      probe.onerror = function () { finish(0); };
      probe.src = url;
    });
  }

  /* ------------------------------ covers ------------------------------ */
  // Covers are cached per album, shrunk to ~400px (keeps memory low on big libraries),
  // and sampled for a colour that tints the UI.

  var coverCache = new Map(); // albumKey -> Promise<{url, rgb}|null>
  var coverSync = new Map();  // albumKey -> {url, rgb} | null   (once resolved)
  var coverActive = 0, coverWaiting = [];

  function limited(fn) {
    return new Promise(function (resolve) {
      function run() {
        coverActive++;
        fn().then(done, function () { done(null); });
        function done(v) {
          coverActive--;
          resolve(v);
          var nx = coverWaiting.pop(); // newest first: whatever is on screen now
          if (nx) nx();
        }
      }
      if (coverActive < 2) run(); else coverWaiting.push(run);
    });
  }

  function getCover(t) {
    if (!t) return Promise.resolve(null);
    var key = t.albumKey;
    if (coverCache.has(key)) return coverCache.get(key);
    var p = limited(function () {
      return Meta.read(t.file, t.ext, true).then(function (m) {
        if (m.cover) return processCover(m.cover);
        var img = state.folderImages.get(t.dir);
        return img ? processCover(img.file) : null;
      }).then(function (c) {
        // tags present but image unreadable → try folder image
        if (!c && state.folderImages.get(t.dir)) return processCover(state.folderImages.get(t.dir).file);
        return c;
      });
    }).then(function (c) { coverSync.set(key, c || null); return c || null; });
    coverCache.set(key, p);
    return p;
  }

  function processCover(blob) {
    return new Promise(function (resolve) {
      var src = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var s = Math.min(1, 400 / Math.max(w, h, 1));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * s));
        c.height = Math.max(1, Math.round(h * s));
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        var rgb = null;
        try { rgb = pickColor(ctx.getImageData(0, 0, c.width, c.height).data); } catch (e) { /* ignore */ }
        URL.revokeObjectURL(src);
        if (s === 1 && blob.size < 200000) { resolve({ url: URL.createObjectURL(blob), rgb: rgb }); return; }
        if (!c.toBlob) { resolve({ url: c.toDataURL('image/jpeg', 0.86), rgb: rgb }); return; }
        c.toBlob(function (b) { resolve({ url: URL.createObjectURL(b || blob), rgb: rgb }); }, 'image/jpeg', 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(src); resolve(null); };
      img.src = src;
    });
  }

  // Weighted average favouring saturated, mid-bright pixels → a "vibrant" colour.
  function pickColor(d) {
    var r = 0, g = 0, b = 0, wsum = 0;
    for (var i = 0; i < d.length; i += 4 * 9) {
      var R = d[i], G = d[i + 1], B = d[i + 2];
      var mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      var v = mx / 255, sat = mx ? (mx - mn) / mx : 0;
      var w = sat * sat * (v > 0.15 ? 1 : 0.1) * (v < 0.97 ? 1 : 0.3) + 0.02;
      r += R * w; g += G * w; b += B * w; wsum += w;
    }
    if (!wsum) return null;
    return normalise([r / wsum, g / wsum, b / wsum]);
  }

  // Keep tints readable: clamp lightness and boost saturation a little.
  function normalise(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    s = Math.min(1, s * 1.25);
    l = Math.max(0.32, Math.min(0.6, l));
    return hsl(h, s, l);
  }
  function hsl(h, s, l) {
    function f(n) {
      var k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    }
    return [f(0), f(8), f(4)];
  }
  function shiftHue(rgb, deg) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return hsl((h + deg / 360 + 1) % 1, s, l);
  }

  function fallbackColors(name) {
    var p = PALETTE[hashIdx(name || '?')];
    return [hexRgb(p[0]), hexRgb(p[1])];
  }
  function placeholderStyle(name) {
    var p = PALETTE[hashIdx(name || '?')];
    return 'background-image:linear-gradient(135deg,' + p[0] + ',' + p[1] + ')';
  }
  // HTML for a cover box. `known` is the resolved cover (or undefined if still loading).
  function coverInner(known, name, text) {
    if (known && known.url) return '<img alt="" src="' + known.url + '">';
    if (known === undefined) return '';
    return '<div class="ph" style="' + placeholderStyle(name) + '">' + (text ? '<b>' + esc(text) + '</b>' : ICON_NOTE) + '</div>';
  }
  // Fill a cover element now (if known) and again when it loads.
  function paintCover(el, t, name, text) {
    var known = coverSync.has(t.albumKey) ? coverSync.get(t.albumKey) : undefined;
    var html = coverInner(known, name, text);
    if (el.__html !== html) { el.innerHTML = html; el.__html = html; } // no flicker if unchanged
    if (known === undefined) {
      getCover(t).then(function (c) {
        if (el.getAttribute('data-k') && el.getAttribute('data-k') !== t.albumKey) return;
        var h = coverInner(c, name, text);
        if (el.__html !== h) { el.innerHTML = h; el.__html = h; }
      });
    }
  }

  function setTint(rgb, rgb2) {
    var root = document.documentElement.style;
    var b = rgb2 || shiftHue(rgb, 40);
    root.setProperty('--tint', rgb.join(', '));
    root.setProperty('--tint2', b.join(', '));
    // a deep, dark third colour for the centre of the ambient glow
    root.setProperty('--tint3', b.map(function (c) { return Math.round(c * 0.3); }).join(', '));
  }
  var DEFAULT_TINT = [245, 158, 11];
  function tintForTrack(t, cb) {
    if (!t) { cb(DEFAULT_TINT, [59, 130, 246]); return; }
    getCover(t).then(function (c) {
      if (c && c.rgb) cb(c.rgb, shiftHue(c.rgb, 40));
      else { var f = fallbackColors(t.album); cb(f[0], f[1]); }
    });
  }
  function applyViewTint() {
    var t = null;
    if (state.view === 'album') {
      var al = currentAlbum();
      t = al ? al.tracks[0] : null;
    } else if (state.view === 'artist') {
      var ids = getList();
      t = ids.length ? state.byId.get(ids[0]) : null;
    } else {
      t = state.current;
    }
    var view = state.view, detail = state.detail;
    tintForTrack(t, function (a, b) {
      if (state.view === view && state.detail === detail) setTint(a, b);
    });
  }

  /* ------------------------------ lists ------------------------------ */

  function invalidate() { state.list = null; state.albums = null; }

  function matches(t, terms) {
    if (!terms.length) return true;
    var hay = (t.title + '\n' + t.artist + '\n' + t.album + '\n' + t.albumArtist).toLowerCase();
    for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) < 0) return false;
    return true;
  }
  function terms() {
    return state.filter.toLowerCase().split(/\s+/).filter(Boolean);
  }
  function artistOf(t) { return t.albumArtist || t.artist; }

  function byAlbumOrder(a, b) {
    return (a.disc || 1) - (b.disc || 1) || (a.track || 999) - (b.track || 999) || cmpStr(a.title, b.title);
  }
  function defaultOrder(a, b) {
    return cmpStr(sortName(artistOf(a)), sortName(artistOf(b))) || cmpStr(a.album, b.album) || byAlbumOrder(a, b);
  }

  function getList() {
    if (state.list) return state.list;
    var ts;
    if (state.view === 'queue') {
      ts = state.queue.slice(Math.max(0, state.qIndex)).map(function (id) { return state.byId.get(id); }).filter(Boolean);
      state.list = ts.map(function (t) { return t.id; });
      return state.list;
    }
    var tm = terms();
    ts = state.tracks.filter(function (t) {
      if (state.view === 'album' && t.albumKey !== state.detail) return false;
      if (state.view === 'artist' && artistOf(t) !== state.detail && t.artist !== state.detail) return false;
      if (state.view === 'favorites' && !isFav(t)) return false;
      return matches(t, tm);
    });

    var k = state.sort.key, d = state.sort.dir, cmp;
    if (k === 'default') {
      cmp = state.view === 'album' ? byAlbumOrder
          : state.view === 'artist' ? function (a, b) { return (b.year - a.year) || cmpStr(a.album, b.album) || byAlbumOrder(a, b); }
          : defaultOrder;
    } else if (k === 'duration') {
      cmp = function (a, b) { return d * (a.duration - b.duration) || defaultOrder(a, b); };
    } else if (k === 'num') {
      cmp = function (a, b) { return d * byAlbumOrder(a, b); };
    } else {
      cmp = function (a, b) { return d * cmpStr(a[k], b[k]) || defaultOrder(a, b); };
    }
    ts.sort(cmp);
    state.list = ts.map(function (t) { return t.id; });
    return state.list;
  }

  function getAlbums() {
    if (state.albums) return state.albums;
    var map = new Map();
    state.tracks.forEach(function (t) {
      var a = map.get(t.albumKey);
      if (!a) {
        a = { key: t.albumKey, name: t.album, artists: new Set(), albumArtist: t.albumArtist, tracks: [], year: 0, duration: 0 };
        map.set(t.albumKey, a);
      }
      a.tracks.push(t);
      a.artists.add(t.artist);
      if (t.year && !a.year) a.year = t.year;
    });
    var out = [];
    map.forEach(function (a) {
      a.artist = a.albumArtist || (a.artists.size === 1 ? a.tracks[0].artist : 'Various Artists');
      a.tracks.sort(byAlbumOrder);
      out.push(a);
    });
    out.sort(function (x, y) { return cmpStr(sortName(x.artist), sortName(y.artist)) || (x.year - y.year) || cmpStr(x.name, y.name); });
    state.albums = out;
    return out;
  }
  function currentAlbum() {
    if (state.view !== 'album') return null;
    var all = getAlbums();
    for (var i = 0; i < all.length; i++) if (all[i].key === state.detail) return all[i];
    return null;
  }

  var artistsCache = null;
  function getArtists() {
    if (artistsCache && artistsCache.n === state.tracks.length && artistsCache.albums === state.albums) return artistsCache.list;
    var map = new Map();
    state.tracks.forEach(function (t) {
      var n = artistOf(t);
      var a = map.get(n);
      if (!a) { a = { name: n, songs: 0, albums: new Set(), first: t }; map.set(n, a); }
      a.songs++;
      a.albums.add(t.albumKey);
    });
    var out = [];
    map.forEach(function (a) { out.push(a); });
    out.sort(function (x, y) { return cmpStr(sortName(x.name), sortName(y.name)); });
    artistsCache = { n: state.tracks.length, albums: getAlbums(), list: out };
    return out;
  }

  /* ------------------------------ rendering ------------------------------ */

  var VIEW_TITLES = { songs: 'Songs', albums: 'Albums', artists: 'Artists', queue: 'Up Next', favorites: 'Favourites' };
  var scroller = $('scroller');

  function isListView(v) { return v === 'songs' || v === 'queue' || v === 'album' || v === 'artist' || v === 'favorites'; }
  function rowH() { return state.view === 'album' ? 48 : 56; }

  function setView(view, detail) {
    if ((view === 'album' || view === 'artist') && state.view !== 'album' && state.view !== 'artist') state.parentView = state.view;
    if (view === 'album' && state.view === 'artist') state.parentView = 'artist:' + state.detail;
    if (view !== 'album' && view !== 'artist') state.parentView = view;
    state.view = view;
    state.detail = detail === undefined ? null : detail;
    state.sort = { key: 'default', dir: 1 };
    state.selectedId = null;
    invalidate();
    var navView = view === 'album' ? 'albums' : view === 'artist' ? 'artists' : view;
    if (view === 'album' && state.parentView.indexOf('artist') === 0) navView = 'artists';
    $$('[data-view]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === navView); });
    closeNowPlaying();
    scroller.scrollTop = 0;
    renderAll();
    applyViewTint();
  }
  function goBack() {
    var p = state.parentView || 'songs';
    if (p.indexOf('artist:') === 0) setView('artist', p.slice(7));
    else setView(p);
  }

  function renderAll(soft) {
    var has = state.tracks.length > 0;
    $('empty').hidden = has;
    $('hero').hidden = !has;
    $('btnClear').hidden = !has;
    $('countSongs').textContent = has ? state.tracks.length : '';
    $('countAlbums').textContent = has ? getAlbums().length : '';
    $('countArtists').textContent = has ? getArtists().length : '';
    $('folderList').innerHTML = state.folders.map(function (f) { return '<li title="' + esc(f) + '">' + esc(f) + '</li>'; }).join('');

    var v = state.view;
    $('songList').hidden = !has || !isListView(v);
    $('songList').classList.toggle('compact', v === 'album');
    $('albumGrid').hidden = !has || v !== 'albums';
    $('artistGrid').hidden = !has || v !== 'artists';
    $('btnBack').hidden = !(v === 'album' || v === 'artist');
    $('search').disabled = $('search2').disabled = v === 'queue';
    $('countFavs').textContent = has && favCount() ? favCount() : '';

    if (!has) { $('noResults').hidden = true; return; }
    renderHero(soft);
    if (isListView(v)) { renderHead(); renderRows(); }
    else if (v === 'albums') { if (!soft || !$('albumGrid').childElementCount) renderAlbums(); }
    else if (v === 'artists') { if (!soft || !$('artistGrid').childElementCount) renderArtists(); }
    updateNoResults();
  }

  function heroActions() {
    return '<div class="hero-actions">' +
      '<button class="play-btn" data-cmd="play-view" title="Play">' + ICON_PLAY + '</button>' +
      '<button class="btn ghost" data-cmd="shuffle-view">' + ICON_SHUFFLE + 'Shuffle</button>' +
    '</div>';
  }

  var heroKey = '';
  function renderHero(soft) {
    var v = state.view, hero = $('hero'), html, title;
    var key = v + '|' + state.detail + '|' + state.filter;
    if (v === 'album') {
      var al = currentAlbum();
      if (!al) { setView('albums'); return; }
      title = al.name;
      html = '<div class="hero-art cover" id="heroArt" data-k="' + esc(al.key) + '"></div>' +
        '<div class="hero-text"><div class="eyebrow">Album</div><h1>' + esc(al.name) + '</h1>' +
        '<div class="hero-meta" id="heroMeta"></div>' + heroActions() + '</div>';
    } else if (v === 'artist') {
      title = state.detail;
      html = '<div class="hero-art cover round" id="heroArt"></div>' +
        '<div class="hero-text"><div class="eyebrow">Artist</div><h1>' + esc(state.detail) + '</h1>' +
        '<div class="hero-meta" id="heroMeta"></div>' + heroActions() + '</div>';
    } else {
      title = VIEW_TITLES[v];
      html = '<div class="hero-text"><h1>' + title + '</h1><div class="hero-meta" id="heroMeta"></div>' +
        (v === 'songs' || v === 'favorites' ? heroActions() : '') + '</div>';
    }
    $('topTitle').textContent = title;
    if (!(soft && heroKey === key)) {
      hero.innerHTML = html;
      heroKey = key;
      var art = $('heroArt');
      if (art && v === 'album') { var a = currentAlbum(); paintCover(art, a.tracks[0], a.name); }
      if (art && v === 'artist') {
        var ids = getList(), first = ids.length ? state.byId.get(ids[0]) : null;
        if (first) paintCover(art, first, state.detail, initials(state.detail));
      }
    }
    updateHeroMeta();
  }

  function updateHeroMeta() {
    var el = $('heroMeta');
    if (!el) return;
    var v = state.view, txt = '';
    if (isListView(v)) {
      var ids = getList(), total = 0;
      for (var i = 0; i < ids.length; i++) total += state.byId.get(ids[i]).duration || 0;
      var songs = plural(ids.length, 'song') + (total ? ', ' + fmtLong(total) : '');
      if (v === 'album') {
        var al = currentAlbum();
        txt = al ? '<a data-artist="' + esc(al.artist) + '">' + esc(al.artist) + '</a>' + (al.year ? ' · ' + al.year : '') + ' · ' + songs : songs;
      } else if (v === 'artist') {
        var albums = new Set();
        ids.forEach(function (id) { albums.add(state.byId.get(id).albumKey); });
        txt = plural(albums.size, 'album') + ' · ' + songs;
      } else if (v === 'favorites' && !ids.length && !state.filter) {
        txt = 'No favourites yet. Tap the heart on the Now Playing panel (or press L) to add one.';
      } else if (v === 'queue') {
        txt = ids.length ? 'Playing from your queue · ' + songs : 'Nothing queued. Play a song to get started.';
      } else {
        txt = (state.filter ? 'Matching “' + esc(state.filter) + '” · ' : '') + songs;
      }
    } else if (v === 'albums') {
      txt = plural(getAlbums().length, 'album');
    } else if (v === 'artists') {
      txt = plural(getArtists().length, 'artist');
    }
    el.innerHTML = txt;
  }

  function updateNoResults() {
    var v = state.view, none = false;
    if (state.filter && v !== 'queue') {
      if (isListView(v)) none = !getList().length;
      else if (v === 'albums') none = !$('albumGrid').childElementCount;
      else if (v === 'artists') none = !$('artistGrid').childElementCount;
    }
    $('noResults').hidden = !none;
  }

  function renderHead() {
    Array.prototype.forEach.call($('slHead').children, function (c) {
      var k = c.getAttribute('data-sort');
      c.classList.toggle('sorted', state.sort.key === k);
      c.classList.toggle('desc', state.sort.key === k && state.sort.dir < 0);
    });
  }

  var loadVisibleCovers = debounce(function () {
    if ($('songList').hidden || state.view === 'album') return;
    var ids = getList(), range = visibleRange(ids.length), need = false;
    for (var i = range[0]; i < range[1]; i++) {
      var t = state.byId.get(ids[i]);
      if (!coverSync.has(t.albumKey)) { need = true; getCover(t).then(coversArrived); }
    }
    return need;
  }, 120);
  var coversArrived = throttle(function () { renderRows(true); }, 250);

  function visibleRange(n) {
    var spacer = $('slSpacer'), h = rowH();
    var top = scroller.scrollTop - spacer.offsetTop;
    var viewH = scroller.clientHeight || 700;
    var start = Math.max(0, Math.floor(top / h) - 6);
    var end = Math.min(n, Math.ceil((top + viewH) / h) + 6);
    return [start, Math.max(start, end)];
  }

  function renderRows(fromCovers) {
    if ($('songList').hidden) return;
    var ids = getList(), h = rowH();
    var spacer = $('slSpacer');
    spacer.style.height = (ids.length * h) + 'px';
    var range = visibleRange(ids.length);
    var albumView = state.view === 'album';
    var al = albumView ? currentAlbum() : null;
    var cur = state.current ? state.current.id : -1;
    var html = '';
    for (var i = range[0]; i < range[1]; i++) {
      var t = state.byId.get(ids[i]);
      var cls = 'row' + (t.id === cur ? ' playing' : '') + (t.id === state.selectedId ? ' sel' : '') + (t.broken ? ' broken' : '');
      var num = t.id === cur ? '<span class="eq"><i></i><i></i><i></i></span>'
              : '<span class="n">' + (albumView ? (t.track || '') : i + 1) + '</span>';
      var thumb = albumView ? '' :
        '<div class="thumb cover">' + coverInner(coverSync.has(t.albumKey) ? coverSync.get(t.albumKey) : undefined, t.album) + '</div>';
      var sub = albumView ? (al && t.artist !== al.artist ? esc(t.artist) : '') : esc(t.artist);
      html += '<div class="' + cls + '" data-i="' + i + '" style="top:' + (i * h) + 'px;height:' + h + 'px">' +
        '<div class="c-num">' + num + '<button class="rp" data-act="play" title="Play">' + ICON_PLAY + '</button></div>' +
        '<div class="c-title" title="' + esc(t.path) + '">' + thumb +
          '<div class="tt"><div class="t1">' + esc(t.title) + (isFav(t) ? HEART_SMALL : '') + '</div>' + (sub ? '<div class="t2">' + sub + '</div>' : '') + '</div></div>' +
        '<div class="c-album">' + esc(t.album) + '</div>' +
        '<div class="c-time">' + (t.duration ? fmtTime(t.duration) : '') + '</div>' +
      '</div>';
    }
    spacer.innerHTML = html;
    if (!fromCovers) loadVisibleCovers();
  }

  var coverObserver = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      coverObserver.unobserve(en.target);
      var fn = en.target.__paint;
      if (fn) fn();
    });
  }, { root: scroller, rootMargin: '400px' }) : null;

  function lazyCover(el, paint) {
    if (coverObserver) { el.__paint = paint; coverObserver.observe(el); } else paint();
  }

  function cardHtml(i, name, sub, cls) {
    return '<div class="card" data-i="' + i + '">' +
      '<div class="art-wrap"><div class="art cover ' + (cls || '') + '" data-i="' + i + '"></div>' +
      '<button class="play-btn quick" data-act="play" title="Play">' + ICON_PLAY + '</button></div>' +
      '<div class="ct" title="' + esc(name) + '">' + esc(name) + '</div>' +
      '<div class="ca">' + sub + '</div></div>';
  }

  var shownAlbums = [], shownArtists = [];

  function renderAlbums() {
    var tm = terms();
    shownAlbums = getAlbums().filter(function (a) {
      if (!tm.length) return true;
      var hay = (a.name + '\n' + a.artist).toLowerCase();
      return tm.every(function (x) { return hay.indexOf(x) >= 0; });
    });
    var grid = $('albumGrid');
    grid.innerHTML = shownAlbums.map(function (a, i) {
      return cardHtml(i, a.name, esc(a.artist) + (a.year ? ' · ' + a.year : ''));
    }).join('');
    Array.prototype.forEach.call(grid.querySelectorAll('.art'), function (el) {
      var a = shownAlbums[+el.getAttribute('data-i')];
      lazyCover(el, function () { paintCover(el, a.tracks[0], a.name); });
    });
  }

  function renderArtists() {
    var tm = terms();
    shownArtists = getArtists().filter(function (a) {
      var n = a.name.toLowerCase();
      return tm.every(function (x) { return n.indexOf(x) >= 0; });
    });
    var grid = $('artistGrid');
    grid.innerHTML = shownArtists.map(function (a, i) {
      return cardHtml(i, a.name, plural(a.albums.size, 'album') + ' · ' + plural(a.songs, 'song'));
    }).join('');
    Array.prototype.forEach.call(grid.querySelectorAll('.art'), function (el) {
      var a = shownArtists[+el.getAttribute('data-i')];
      lazyCover(el, function () { paintCover(el, a.first, a.name, initials(a.name)); });
    });
  }

  function albumIds(a) { return a.tracks.map(function (t) { return t.id; }); }
  function artistIds(name) {
    return state.tracks.filter(function (t) { return artistOf(t) === name || t.artist === name; })
      .sort(function (a, b) { return (b.year - a.year) || cmpStr(a.album, b.album) || byAlbumOrder(a, b); })
      .map(function (t) { return t.id; });
  }

  /* ------------------------------ player ------------------------------ */

  var audio = new Audio();
  audio.preload = 'auto';
  audio.volume = typeof settings.volume === 'number' ? settings.volume : 0.8;
  audio.muted = !!settings.muted;
  var currentUrl = null, errorStreak = 0, seeking = false, pendingSeek = 0;

  function loadTrack(t, autoplay, startAt) {
    if (!t) return;
    var oldUrl = currentUrl;
    currentUrl = URL.createObjectURL(t.file);
    state.current = t;
    pendingSeek = startAt || 0;
    audio.src = currentUrl;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    if (autoplay) play();
    updateNowPlaying();
    if (state.view === 'queue') { invalidate(); updateHeroMeta(); }
    renderRows();
    saveLast();
  }

  function play() {
    if (!state.current) {
      var ids = isListView(state.view) && getList().length ? getList() : defaultIds();
      if (ids.length) playIds(ids, state.shuffle ? Math.floor(Math.random() * ids.length) : 0);
      return;
    }
    ensureAudioGraph();
    if (ac && ac.state === 'suspended') ac.resume();
    var p = audio.play();
    if (p && p.catch) p.catch(function (e) { if (e && e.name === 'NotAllowedError') toast('Press play to start.'); });
  }
  function pause() { audio.pause(); }
  function toggle() { if (audio.paused) play(); else pause(); }
  function stop() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
  }

  function defaultIds() {
    return state.tracks.slice().sort(defaultOrder).map(function (t) { return t.id; });
  }

  function playIds(ids, index, forceShuffle) {
    if (!ids.length) return;
    if (forceShuffle && !state.shuffle) { state.shuffle = true; updateModes(); saveSettings(); }
    state.originalQueue = ids.slice();
    state.queue = ids.slice();
    state.qIndex = index;
    if (state.shuffle) applyShuffle();
    loadTrack(state.byId.get(state.queue[state.qIndex]), true);
  }

  function applyShuffle() {
    var cur = state.queue[state.qIndex];
    var rest = state.queue.filter(function (id, i) { return i !== state.qIndex; });
    shuffleArr(rest);
    state.queue = cur !== undefined ? [cur].concat(rest) : rest;
    state.qIndex = cur !== undefined ? 0 : -1;
  }
  function unshuffle() {
    var cur = state.queue[state.qIndex];
    state.queue = state.originalQueue.slice();
    state.qIndex = Math.max(0, state.queue.indexOf(cur));
  }

  function next(auto) {
    if (!state.queue.length) return;
    if (auto && state.repeat === 'one') { audio.currentTime = 0; play(); return; }
    var i = state.qIndex + 1;
    if (i >= state.queue.length) {
      if (state.repeat === 'all') {
        i = 0;
        if (state.shuffle) shuffleArr(state.queue);
      } else {
        if (auto) { audio.pause(); audio.currentTime = 0; }
        return;
      }
    }
    state.qIndex = i;
    loadTrack(state.byId.get(state.queue[i]), true);
  }

  function prev() {
    if (!state.current) return;
    if (audio.currentTime > 3 || (state.qIndex <= 0 && state.repeat !== 'all')) { audio.currentTime = 0; return; }
    var i = state.qIndex - 1;
    if (i < 0) i = state.queue.length - 1;
    state.qIndex = i;
    loadTrack(state.byId.get(state.queue[i]), !audio.paused);
  }

  function setPlayingClass() {
    document.body.classList.toggle('is-playing', !audio.paused);
    startViz();
  }

  audio.addEventListener('play', setPlayingClass);
  audio.addEventListener('pause', setPlayingClass);
  audio.addEventListener('playing', function () { errorStreak = 0; });
  audio.addEventListener('ended', function () { next(true); });
  audio.addEventListener('loadedmetadata', function () {
    if (pendingSeek && pendingSeek < audio.duration) audio.currentTime = pendingSeek;
    pendingSeek = 0;
    var t = state.current;
    if (t && !t.duration && isFinite(audio.duration)) { t.duration = audio.duration; renderRows(); }
    updateTime();
  });
  audio.addEventListener('timeupdate', function () { updateTime(); saveLastSoon(); });
  audio.addEventListener('volumechange', function () { updateVolume(); saveSettings(); });
  audio.addEventListener('error', function () {
    var t = state.current;
    if (!t || !audio.getAttribute('src')) return;
    t.broken = true;
    renderRows();
    errorStreak++;
    toast('Can’t play “' + t.title + '” in this browser' + (t.ext === 'aiff' || t.ext === 'aif' || t.ext === 'caf' ? ' (try Safari for AIFF/ALAC).' : '.'));
    if (errorStreak < 5) next(false); else { errorStreak = 0; pause(); }
  });

  function updateTime() {
    var d = audio.duration || (state.current && state.current.duration) || 0;
    if (!seeking) {
      var p = d ? audio.currentTime / d : 0;
      $$('.seek-range').forEach(function (r) {
        r.value = Math.round(p * 1000);
        r.style.setProperty('--p', (p * 100).toFixed(2) + '%');
      });
      $$('.t-cur').forEach(function (el) { el.textContent = fmtTime(audio.currentTime); });
    }
    $$('.t-dur').forEach(function (el) { el.textContent = fmtTime(d); });
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && d && isFinite(d)) {
      try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(audio.currentTime, d), playbackRate: audio.playbackRate }); } catch (e) { /* ignore */ }
    }
  }

  function updateVolume() {
    var v = audio.muted ? 0 : audio.volume;
    $$('.vol-range').forEach(function (r) {
      r.value = v;
      r.style.setProperty('--p', (v * 100) + '%');
    });
    $('volPct').textContent = Math.round(v * 100) + '%';
    $$('.mute-btn').forEach(function (b) { b.classList.toggle('muted', audio.muted || audio.volume === 0); });
  }

  var LOSSLESS = { flac: 1, wav: 1, aif: 1, aiff: 1, caf: 1 };
  function updateNowPlaying() {
    var t = state.current;
    var sub = t ? t.artist + ' — ' + t.album : 'Pick a song to start';
    $('npTitle').textContent = $('stTitle').textContent = t ? t.title : 'Not playing';
    $('npSub').textContent = $('stSub').textContent = sub;
    $('npvTitle').textContent = t ? t.title : '';
    $('npvSub').textContent = t ? sub : '';
    $('stFormat').textContent = t ? t.ext.toUpperCase() + (LOSSLESS[t.ext] ? ' · LOSSLESS' : '') : '';
    document.title = t ? t.title + ' · ' + t.artist : 'Tunebox';
    updateFavButtons();
    updateUpNext();

    var arts = [$('npArt'), $('npvArt'), $('stArt')];
    arts.forEach(function (el) { el.setAttribute('data-k', t ? t.albumKey : ''); });
    if (!t) { arts.forEach(function (el) { el.innerHTML = ''; }); updateTime(); return; }
    arts.forEach(function (el) { paintCover(el, t, t.album); });

    var ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
    if (ms && window.MediaMetadata) ms.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album });
    getCover(t).then(function (c) {
      if (state.current !== t) return;
      if (ms && window.MediaMetadata && c) {
        ms.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: [{ src: c.url, sizes: '400x400' }] });
      }
    });
    if (!(state.view === 'album' || state.view === 'artist')) applyViewTint();
  }

  function updateUpNext() {
    var nx = null;
    if (state.repeat === 'one') nx = state.current;
    else if (state.qIndex + 1 < state.queue.length) nx = state.byId.get(state.queue[state.qIndex + 1]);
    else if (state.repeat === 'all' && state.queue.length) nx = state.byId.get(state.queue[0]);
    $('npvNext').innerHTML = nx ? 'Up next: <b>' + esc(nx.title) + '</b> · ' + esc(nx.artist) : '';

    // the short "Up Next" list in the Now Playing panel
    var html = '', n = 0;
    for (var i = state.qIndex + 1; i < state.queue.length && n < 6; i++, n++) {
      var q = state.byId.get(state.queue[i]);
      if (!q) continue;
      html += '<button class="qrow" data-q="' + i + '">' +
        '<div class="thumb cover">' + coverInner(coverSync.has(q.albumKey) ? coverSync.get(q.albumKey) : undefined, q.album) + '</div>' +
        '<div class="tt"><div class="t1">' + esc(q.title) + '</div><div class="t2">' + esc(q.artist) + '</div></div>' +
        '<span class="qt">' + (q.duration ? fmtTime(q.duration) : '') + '</span></button>';
      if (!coverSync.has(q.albumKey)) getCover(q).then(upNextSoon);
    }
    $('stNext').innerHTML = html || '<div class="upnext-empty">' + (state.current ? 'Nothing else queued.' : 'Play something to fill your queue.') + '</div>';
  }
  var upNextSoon = throttle(function () { updateUpNext(); }, 400);

  /* ---------------- favourites ---------------- */
  var favs = {};
  try { (JSON.parse(localStorage.getItem('tunebox.favs') || '[]') || []).forEach(function (p) { favs[p] = 1; }); } catch (e) { /* ignore */ }
  var HEART_SMALL = '<svg class="heart" viewBox="0 0 24 24"><path fill="currentColor" d="m12 21.4-1.5-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.5 11.5z"/></svg>';
  function isFav(t) { return !!favs[t.path]; }
  function favCount() {
    var n = 0;
    for (var i = 0; i < state.tracks.length; i++) if (favs[state.tracks[i].path]) n++;
    return n;
  }
  function updateFavButtons() {
    var on = !!(state.current && isFav(state.current));
    $$('[data-cmd="fav"]').forEach(function (b) { b.classList.toggle('on', on); });
  }
  function toggleFav() {
    var t = state.current;
    if (!t) return;
    if (favs[t.path]) delete favs[t.path]; else favs[t.path] = 1;
    try { localStorage.setItem('tunebox.favs', JSON.stringify(Object.keys(favs))); } catch (e) { /* ignore */ }
    updateFavButtons();
    $('countFavs').textContent = favCount() || '';
    if (state.view === 'favorites') { invalidate(); renderAll(); } else renderRows();
    toast(favs[t.path] ? 'Added to Favourites' : 'Removed from Favourites', 1400);
  }

  /* ---------------- equalizer + visualizer (Web Audio) ---------------- */
  // Built on first play (browsers require a click first). Skipped on iPhone/iPad, where routing
  // audio through Web Audio can stop playback when the screen locks.
  var ac = null, eqNodes = null, analyser = null, freq = null;
  var EQ_PRESETS = {
    flat: [0, 0, 0], warm: [4, 1, -2], bass: [7, -1, 1],
    vocal: [-2, 4, 1], night: [-3, 2, -4], bright: [-1, 0, 5]
  };
  var eq = settings.eq && settings.eq.length === 3 ? settings.eq : [0, 0, 0];

  function ensureAudioGraph() {
    if (ac || IS_IOS) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ac = new AC();
      var src = ac.createMediaElementSource(audio);
      var bass = ac.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 180;
      var mid = ac.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.9;
      var treble = ac.createBiquadFilter(); treble.type = 'highshelf'; treble.frequency.value = 4200;
      analyser = ac.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;
      freq = new Uint8Array(analyser.frequencyBinCount);
      src.connect(bass); bass.connect(mid); mid.connect(treble); treble.connect(analyser); analyser.connect(ac.destination);
      eqNodes = [bass, mid, treble];
      applyEq();
    } catch (e) {
      ac = null; eqNodes = null; analyser = null;
    }
  }
  function applyEq() {
    if (!eqNodes) return;
    for (var i = 0; i < 3; i++) eqNodes[i].gain.setTargetAtTime(eq[i], ac.currentTime, 0.05);
  }
  function renderEq() {
    var ids = ['eqBass', 'eqMid', 'eqTreble'];
    ids.forEach(function (id, i) {
      var r = $(id);
      r.value = eq[i];
      r.style.setProperty('--p', ((eq[i] + 12) / 24 * 100) + '%');
      $(id + 'Val').textContent = (eq[i] > 0 ? '+' : '') + eq[i] + ' dB';
    });
    var key = '';
    Object.keys(EQ_PRESETS).forEach(function (k) { if (EQ_PRESETS[k].join() === eq.join()) key = k; });
    $$('#eqPresets button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-eq') === key); });
    $('eqNote').textContent = IS_IOS ? 'The equalizer isn’t available on iPhone / iPad.' : '';
  }
  function setEq(vals) {
    eq = vals.slice();
    settings.eq = eq;
    saveSettings();
    applyEq();
    renderEq();
  }
  function toggleEqPanel(force) {
    var p = $('eqPanel');
    var show = typeof force === 'boolean' ? force : p.hidden;
    p.hidden = !show;
    if (show) renderEq();
    $$('[data-cmd="eq"], #btnEq').forEach(function (b) { b.classList.toggle('on', show); });
  }

  var viz = $('viz'), vctx = viz.getContext('2d');
  var BARS = 32, barH = new Float32Array(BARS), vizRunning = false, vizFrame = 0, vizPhase = 0;
  function vizVisible() { return viz.offsetParent !== null && !document.hidden; }
  function startViz() {
    if (vizRunning) return;
    vizRunning = true;
    requestAnimationFrame(drawViz);
  }
  function drawViz() {
    vizFrame++;
    var playing = !audio.paused;
    if (!vizVisible()) { vizRunning = false; return; }
    if (vizFrame % 2 === 0) { // ~30 fps is plenty and halves the work on older Macs
      var w = viz.width, h = viz.height, gap = 6;
      var bw = (w - gap * (BARS - 1)) / BARS;
      vctx.clearRect(0, 0, w, h);
      var cs = getComputedStyle(document.documentElement);
      var g = vctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgb(' + cs.getPropertyValue('--tint').trim() + ')');
      g.addColorStop(1, 'rgb(' + cs.getPropertyValue('--tint2').trim() + ')');
      vctx.fillStyle = g;
      if (analyser && playing) analyser.getByteFrequencyData(freq);
      vizPhase += playing ? 0.12 : 0;
      var settled = true;
      for (var i = 0; i < BARS; i++) {
        var target = 6;
        if (playing) {
          var centre = 1 - Math.abs((i - BARS / 2) / (BARS / 2)) * 0.5;
          if (analyser) {
            var bin = Math.min(freq.length - 1, Math.floor(i / BARS * 30) + 1);
            target = Math.max(6, (freq[bin] / 255) * h * centre + (Math.sin(vizPhase + i * 0.45) * 0.5 + 0.5) * 8);
          } else {
            target = Math.max(6, (Math.sin(vizPhase + i * 0.5) * 0.5 + 0.5) * h * 0.6 * centre);
          }
        }
        barH[i] += (target - barH[i]) * 0.25;
        if (Math.abs(barH[i] - target) > 0.5) settled = false;
        var bh = Math.min(h, barH[i]);
        vctx.fillRect(i * (bw + gap), (h - bh) / 2, bw, bh);
      }
      if (!playing && settled) { vizRunning = false; return; } // stop the loop while paused
    }
    requestAnimationFrame(drawViz);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) startViz(); });

  /* ---------------- theme ---------------- */
  function applyTheme() {
    if (settings.theme) document.documentElement.setAttribute('data-theme', settings.theme);
    else document.documentElement.removeAttribute('data-theme');
  }
  function toggleTheme() {
    var cur = settings.theme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    settings.theme = cur === 'light' ? 'dark' : 'light';
    saveSettings();
    applyTheme();
    toast(settings.theme === 'light' ? 'Light mode' : 'Dark mode', 1200);
  }
  applyTheme();

  function updateModes() {
    $$('[data-cmd="shuffle"]').forEach(function (b) { b.classList.toggle('on', state.shuffle); });
    $$('[data-cmd="repeat"]').forEach(function (b) {
      b.classList.toggle('on', state.repeat !== 'off');
      b.classList.toggle('one', state.repeat === 'one');
      b.title = 'Repeat: ' + state.repeat + ' (R)';
    });
    updateUpNext();
  }

  function toggleShuffle() {
    state.shuffle = !state.shuffle;
    if (state.queue.length) { if (state.shuffle) applyShuffle(); else unshuffle(); }
    if (state.view === 'queue') { invalidate(); renderAll(); }
    updateModes();
    saveSettings();
    toast(state.shuffle ? 'Shuffle on' : 'Shuffle off', 1200);
  }
  function cycleRepeat() {
    state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
    updateModes();
    saveSettings();
    toast({ off: 'Repeat off', all: 'Repeat all', one: 'Repeat this song' }[state.repeat], 1200);
  }

  /* ---------------- Now Playing screen ---------------- */

  function openNowPlaying() {
    if (!state.current) { play(); return; }
    $('npView').hidden = false;
    tintForTrack(state.current, setTint);
  }
  function closeNowPlaying() {
    if ($('npView').hidden) return;
    $('npView').hidden = true;
    applyViewTint();
  }

  // Remember the last song + position so the next visit can resume.
  function saveLast() {
    if (!state.current) return;
    try {
      localStorage.setItem('tunebox.last', JSON.stringify({
        path: state.current.path,
        time: audio.currentTime || 0,
        queue: state.queue.map(function (id) { var t = state.byId.get(id); return t ? t.path : ''; }).slice(0, 5000)
      }));
    } catch (e) { /* ignore (quota) */ }
  }
  var saveLastSoon = throttle(saveLast, 5000);
  window.addEventListener('pagehide', saveLast);

  var restored = false;
  function maybeRestoreLast() {
    if (restored || state.current) return;
    var last;
    try { last = JSON.parse(localStorage.getItem('tunebox.last') || 'null'); } catch (e) { last = null; }
    if (!last || !state.byPath.has(last.path)) return;
    restored = true;
    var ids = (last.queue || []).map(function (p) { var t = state.byPath.get(p); return t ? t.id : null; }).filter(function (x) { return x !== null; });
    var t = state.byPath.get(last.path);
    if (ids.indexOf(t.id) < 0) ids = defaultIds();
    state.queue = ids;
    state.originalQueue = ids.slice();
    state.qIndex = ids.indexOf(t.id);
    loadTrack(t, false, last.time);
  }

  if ('mediaSession' in navigator) {
    var ms = navigator.mediaSession;
    var handlers = {
      play: play, pause: pause,
      previoustrack: prev, nexttrack: function () { next(false); },
      seekbackward: function () { audio.currentTime = Math.max(0, audio.currentTime - 10); },
      seekforward: function () { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); },
      seekto: function (d) { if (d && typeof d.seekTime === 'number') audio.currentTime = d.seekTime; }
    };
    Object.keys(handlers).forEach(function (k) {
      try { ms.setActionHandler(k, handlers[k]); } catch (e) { /* unsupported action */ }
    });
  }

  /* ------------------------------ opening files ------------------------------ */

  var hasFSA = typeof window.showDirectoryPicker === 'function';

  async function openFolder() {
    if (IS_IOS) { $('fileInput').click(); return; } // iPhone/iPad can't pick folders
    if (!hasFSA) { $('dirInput').click(); return; }
    var handle;
    try {
      handle = await window.showDirectoryPicker({ id: 'tunebox-music', startIn: 'music' });
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      try { handle = await window.showDirectoryPicker(); } catch (e2) {
        if (e2 && e2.name === 'AbortError') return;
        $('dirInput').click();
        return;
      }
    }
    await rememberHandle(handle);
    await scanHandle(handle);
  }

  async function scanHandle(handle) {
    var out = [];
    setStatus('Looking for music…');
    try {
      await walkHandle(handle, handle.name, out);
    } catch (e) {
      toast('Couldn’t read that folder: ' + (e && e.message ? e.message : e));
    }
    setStatus('');
    ingest(out, handle.name);
  }

  async function walkHandle(dir, prefix, out) {
    var subdirs = [];
    for await (var entry of dir.values()) {
      if (entry.name.charAt(0) === '.') continue;
      var path = prefix + '/' + entry.name;
      if (entry.kind === 'directory') {
        subdirs.push([entry, path]);
      } else {
        var ext = extOf(entry.name);
        if (AUDIO_EXT.indexOf(ext) < 0 && IMG_EXT.indexOf(ext) < 0 && ext !== 'm4p') continue;
        try { out.push({ file: await entry.getFile(), path: path }); } catch (e) { /* unreadable */ }
        if (out.length % 200 === 0) setStatus('Looking for music… ' + out.length + ' files');
      }
    }
    for (var i = 0; i < subdirs.length; i++) await walkHandle(subdirs[i][0], subdirs[i][1], out);
  }

  function filesFromInput(input) {
    var out = [], root = '';
    for (var i = 0; i < input.files.length; i++) {
      var f = input.files[i];
      var path = f.webkitRelativePath || f.name;
      if (!root && f.webkitRelativePath) root = path.split('/')[0];
      out.push({ file: f, path: path });
    }
    return { entries: out, root: root };
  }

  async function handleDrop(dt) {
    var roots = [];
    if (dt.items && dt.items.length && dt.items[0].webkitGetAsEntry) {
      for (var i = 0; i < dt.items.length; i++) {
        var en = dt.items[i].webkitGetAsEntry();
        if (en) roots.push(en);
      }
    }
    if (!roots.length) {
      var files = [];
      for (var j = 0; j < dt.files.length; j++) files.push({ file: dt.files[j], path: dt.files[j].name });
      ingest(files, '');
      return;
    }
    setStatus('Looking for music…');
    var out = [];
    for (var k = 0; k < roots.length; k++) await walkEntry(roots[k], '', out);
    setStatus('');
    var dirs = roots.filter(function (r) { return r.isDirectory; });
    ingest(out, dirs.length ? dirs.map(function (d) { return d.name; }).join(', ') : '');
  }

  function walkEntry(entry, prefix, out) {
    var path = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isFile) {
      return new Promise(function (res) {
        entry.file(function (f) { out.push({ file: f, path: path }); res(); }, function () { res(); });
      });
    }
    if (!entry.isDirectory) return Promise.resolve();
    var reader = entry.createReader(), all = [];
    return new Promise(function (res) {
      (function readBatch() {
        reader.readEntries(function (batch) {
          if (batch.length) { all = all.concat(batch); readBatch(); return; }
          all.reduce(function (p, child) {
            return p.then(function () { return walkEntry(child, path, out); });
          }, Promise.resolve()).then(res);
        }, function () { res(); });
      })();
    });
  }

  /* -------- remembering folders (Chrome / Edge: File System Access API) -------- */

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
      var r = indexedDB.open('tunebox', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }
  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        var q = db.transaction('kv').objectStore('kv').get(key);
        q.onsuccess = function () { resolve(q.result); };
        q.onerror = function () { resolve(undefined); };
      });
    }).catch(function () { return undefined; });
  }
  function idbSet(key, val) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = tx.onerror = function () { resolve(); };
      });
    }).catch(function () { /* ignore */ });
  }

  async function rememberHandle(h) {
    var list = (await idbGet('handles')) || [];
    for (var i = 0; i < list.length; i++) {
      try { if (await list[i].isSameEntry(h)) return; } catch (e) { /* ignore */ }
    }
    list.push(h);
    await idbSet('handles', list);
  }

  async function checkRemembered() {
    if (!hasFSA) return;
    var list = (await idbGet('handles')) || [];
    if (!list.length) return;
    var ready = [], needAsk = [];
    for (var i = 0; i < list.length; i++) {
      var perm = 'prompt';
      try { perm = await list[i].queryPermission({ mode: 'read' }); } catch (e) { /* ignore */ }
      (perm === 'granted' ? ready : needAsk).push(list[i]);
    }
    for (var j = 0; j < ready.length; j++) await scanHandle(ready[j]);
    if (needAsk.length) {
      $('reopenText').innerHTML = 'Welcome back! Reopen <b>' + needAsk.map(function (h) { return esc(h.name); }).join('</b>, <b>') + '</b> to pick up where you left off.';
      $('reopenBanner').hidden = false;
      $('empty').querySelector('h2').textContent = 'Welcome back.';
      $('btnReopen').onclick = async function () {
        $('reopenBanner').hidden = true;
        for (var k = 0; k < needAsk.length; k++) {
          var p = 'denied';
          try { p = await needAsk[k].requestPermission({ mode: 'read' }); } catch (e) { /* ignore */ }
          if (p === 'granted') await scanHandle(needAsk[k]);
          else toast('Permission not given for “' + needAsk[k].name + '”.');
        }
      };
    }
  }

  /* ------------------------------ events ------------------------------ */

  var COMMANDS = {
    'open-folder': openFolder,
    'add-files': function () { $('fileInput').click(); },
    toggle: toggle,
    next: function () { next(false); },
    prev: prev,
    shuffle: toggleShuffle,
    repeat: cycleRepeat,
    queue: function () { if (state.view === 'queue') goBack(); else setView('queue'); },
    'play-view': function () { playIds(getList(), 0); },
    'shuffle-view': function () { var ids = getList(); playIds(ids, Math.floor(Math.random() * ids.length), true); },
    fav: toggleFav,
    fullscreen: function () { if ($('npView').hidden) openNowPlaying(); else closeNowPlaying(); },
    eq: function () { toggleEqPanel(); }
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cmd]');
    if (b && COMMANDS[b.getAttribute('data-cmd')]) { COMMANDS[b.getAttribute('data-cmd')](); return; }
    var v = e.target.closest('[data-view]');
    if (v) { setView(v.getAttribute('data-view')); return; }
    var ar = e.target.closest('[data-artist]');
    if (ar) setView('artist', ar.getAttribute('data-artist'));
  });

  $('btnClear').addEventListener('click', function () {
    if (confirm('Remove all songs from Tunebox? (Your files are not touched.)')) clearLibrary();
  });
  $('btnForget').addEventListener('click', function () { idbSet('handles', []); $('reopenBanner').hidden = true; });

  $('dirInput').addEventListener('change', function () {
    var r = filesFromInput(this);
    ingest(r.entries, r.root);
    this.value = '';
  });
  $('fileInput').addEventListener('change', function () {
    ingest(filesFromInput(this).entries, '');
    this.value = '';
  });

  $('btnBack').addEventListener('click', goBack);
  $('npOpen').addEventListener('click', openNowPlaying);
  $('npClose').addEventListener('click', closeNowPlaying);
  function goToCurrentAlbum() { if (state.current) setView('album', state.current.albumKey); }
  $('npvSub').addEventListener('click', goToCurrentAlbum);
  $('stSub').addEventListener('click', goToCurrentAlbum);
  $('stNext').addEventListener('click', function (e) {
    var q = e.target.closest('.qrow');
    if (!q) return;
    state.qIndex = +q.getAttribute('data-q');
    loadTrack(state.byId.get(state.queue[state.qIndex]), true);
  });

  $('btnEq').addEventListener('click', function () { toggleEqPanel(); });
  $('eqClose').addEventListener('click', function () { toggleEqPanel(false); });
  $('eqPresets').addEventListener('click', function (e) {
    var b = e.target.closest('[data-eq]');
    if (b) setEq(EQ_PRESETS[b.getAttribute('data-eq')]);
  });
  ['eqBass', 'eqMid', 'eqTreble'].forEach(function (id, i) {
    $(id).addEventListener('input', function () {
      var v = eq.slice();
      v[i] = +this.value;
      setEq(v);
    });
  });
  $('btnTheme').addEventListener('click', toggleTheme);

  var searchTimer;
  ['search', 'search2'].forEach(function (id) { $(id).addEventListener('input', onSearch); });
  function onSearch() {
    var val = this.value;
    var other = this.id === 'search' ? $('search2') : $('search');
    other.value = val;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.filter = val.trim();
      invalidate();
      if (state.view === 'album' || state.view === 'artist' || state.view === 'queue') {
        if (state.filter) { setView('songs'); return; }
      }
      renderAll();
    }, 150);
  }

  $('slHead').addEventListener('click', function (e) {
    var c = e.target.closest('[data-sort]');
    if (!c || state.view === 'queue') return;
    var k = c.getAttribute('data-sort');
    if (state.sort.key === k) {
      if (state.sort.dir > 0) state.sort.dir = -1; else state.sort = { key: 'default', dir: 1 };
    } else {
      state.sort = { key: k, dir: 1 };
    }
    invalidate();
    renderHead();
    renderRows();
  });

  var scrollQueued = false;
  scroller.addEventListener('scroll', function () {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(function () {
      scrollQueued = false;
      $('topbar').classList.toggle('scrolled', scroller.scrollTop > 40);
      if (isListView(state.view)) renderRows();
    });
  });
  window.addEventListener('resize', throttle(function () { renderRows(); }, 100));

  function playFromRow(i) {
    if (state.view === 'queue') {
      state.qIndex = Math.max(0, state.qIndex) + i;
      loadTrack(state.byId.get(state.queue[state.qIndex]), true);
      return;
    }
    playIds(getList(), i);
  }
  var touchUI = window.matchMedia && window.matchMedia('(hover: none)').matches;
  $('slSpacer').addEventListener('click', function (e) {
    var row = e.target.closest('.row');
    if (!row) return;
    var i = +row.getAttribute('data-i');
    if (touchUI || e.target.closest('[data-act="play"]')) { playFromRow(i); return; }
    state.selectedId = getList()[i];
    // update classes in place (re-rendering here would swallow the double-click)
    Array.prototype.forEach.call($('slSpacer').children, function (r) { r.classList.toggle('sel', r === row); });
  });
  $('slSpacer').addEventListener('dblclick', function (e) {
    var row = e.target.closest('.row');
    if (row) playFromRow(+row.getAttribute('data-i'));
  });

  $('albumGrid').addEventListener('click', function (e) {
    var c = e.target.closest('.card');
    if (!c) return;
    var a = shownAlbums[+c.getAttribute('data-i')];
    if (!a) return;
    if (e.target.closest('[data-act="play"]')) playIds(albumIds(a), 0);
    else setView('album', a.key);
  });
  $('artistGrid').addEventListener('click', function (e) {
    var c = e.target.closest('.card');
    if (!c) return;
    var a = shownArtists[+c.getAttribute('data-i')];
    if (!a) return;
    if (e.target.closest('[data-act="play"]')) playIds(artistIds(a.name), 0);
    else setView('artist', a.name);
  });

  $$('.mute-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      if (audio.volume === 0) { audio.volume = 0.5; audio.muted = false; } else audio.muted = !audio.muted;
    });
  });
  $$('.vol-range').forEach(function (r) {
    r.addEventListener('input', function () {
      audio.volume = +this.value;
      audio.muted = false;
    });
  });
  $$('.seek-range').forEach(function (r) {
    r.addEventListener('input', function () {
      seeking = true;
      var d = audio.duration || 0;
      this.style.setProperty('--p', (this.value / 10) + '%');
      var txt = fmtTime(this.value / 1000 * d);
      $$('.t-cur').forEach(function (el) { el.textContent = txt; });
    });
    r.addEventListener('change', function () {
      var d = audio.duration || 0;
      if (d) audio.currentTime = this.value / 1000 * d;
      seeking = false;
    });
  });

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' && e.target.type !== 'range') {
      if (e.key === 'Escape') { e.target.value = ''; e.target.dispatchEvent(new Event('input')); e.target.blur(); }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key;
    if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); }
    else if (k === 'ArrowRight' && e.shiftKey) { e.preventDefault(); next(false); }
    else if (k === 'ArrowLeft' && e.shiftKey) { e.preventDefault(); prev(); }
    else if (k === 'ArrowRight') { e.preventDefault(); audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); }
    else if (k === 'ArrowLeft') { e.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime - 5); }
    else if (k === 'ArrowUp') { e.preventDefault(); audio.muted = false; audio.volume = Math.min(1, audio.volume + 0.05); }
    else if (k === 'ArrowDown') { e.preventDefault(); audio.volume = Math.max(0, audio.volume - 0.05); }
    else if (k === '/') { e.preventDefault(); ($('search').offsetParent ? $('search') : $('search2')).focus(); }
    else if (k === 's' || k === 'S') toggleShuffle();
    else if (k === 'r' || k === 'R') cycleRepeat();
    else if (k === 'm' || k === 'M') audio.muted = !audio.muted;
    else if (k === 'f' || k === 'F') { if ($('npView').hidden) openNowPlaying(); else closeNowPlaying(); }
    else if (k === 'l' || k === 'L') toggleFav();
    else if (k === 'e' || k === 'E') toggleEqPanel();
    else if (k === 't' || k === 'T') toggleTheme();
    else if (k === 'Escape') { closeNowPlaying(); toggleEqPanel(false); }
    else if (k === 'Enter' && state.selectedId) {
      var i = getList().indexOf(state.selectedId);
      if (i >= 0) playFromRow(i);
    }
  });

  // Drag & drop folders or files anywhere on the window
  var overlay = $('dropOverlay');
  function hasFiles(e) {
    var types = e.dataTransfer && e.dataTransfer.types;
    return types && Array.prototype.indexOf.call(types, 'Files') >= 0;
  }
  window.addEventListener('dragenter', function (e) { if (hasFiles(e)) { e.preventDefault(); overlay.hidden = false; } });
  window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
  overlay.addEventListener('dragleave', function (e) { if (e.target === overlay) overlay.hidden = true; });
  window.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    overlay.hidden = true;
    handleDrop(e.dataTransfer);
  });

  /* ------------------------------ start ------------------------------ */

  if (IS_IOS) {
    $('btnEmptyOpen').textContent = 'Choose songs';
    $('btnEmptyOpen').nextElementSibling.hidden = true;
    $('emptyHint').textContent = 'Pick songs from the Files app — select several at once. They play right here, nothing is uploaded.';
  }

  updateVolume();
  startViz();
  updateModes();
  updateNowPlaying();
  renderAll();
  checkRemembered();

  // exposed for debugging in the console
  window.Tunebox = { state: state, audio: audio };
})();

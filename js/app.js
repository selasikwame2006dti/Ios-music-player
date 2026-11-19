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
    selectedId: null,
    stage: false,              // Now Playing stage shown in the centre
    inspTab: 'queue',          // queue | lyrics
    lrcFiles: new Map(),       // "folder/name" (lower case, no extension) -> .lrc File
    lyrics: null               // { lines: [{t, text}], synced: bool } for the current track
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
    settings.volume = vol;
    settings.muted = muted;
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
      genre: '',
      bpm: 0,
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
      if (ext === 'lrc') { state.lrcFiles.set(e.path.replace(/\.[^.\/]+$/, '').toLowerCase(), e.file); continue; }
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
      loadMetaCache().then(function () {
        var need = applyCache(added);
        invalidate();
        renderAll(true);
        if (need.length) scanTags(need);
        else { setStatus(plural(state.tracks.length, 'song')); startDurations(); }
        maybeRestoreLast();
        djFill();
      });
    }
  }

  function clearLibrary() {
    stop();
    showStage(false);
    state.lrcFiles = new Map();
    state.lyrics = null;
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
      if (m.genre) t.genre = m.genre;
      if (m.bpm) t.bpm = m.bpm;
      t.tagged = true;
      computeAlbumKey(t);
      markMetaDirty(t);
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
      if (t.duration) markMetaDirty(t);
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
    if (settings.accent && settings.accent !== 'art' && ACCENTS[settings.accent]) { cb(ACCENTS[settings.accent][0], ACCENTS[settings.accent][1]); return; }
    if (!t) { cb(DEFAULT_TINT, [59, 130, 246]); return; }
    getCover(t).then(function (c) {
      if (c && c.rgb) cb(c.rgb, shiftHue(c.rgb, 40));
      else { var f = fallbackColors(t.album); cb(f[0], f[1]); }
    });
  }
  function applyViewTint() {
    var t = null;
    if (state.stage) {
      t = state.current;
    } else if (state.view === 'album') {
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

  var VIEW_TITLES = { songs: 'Songs', albums: 'Albums', artists: 'Artists', queue: 'Up Next', favorites: 'Favourites', settings: 'Settings' };
  var scroller = $('scroller');

  function isListView(v) { return v === 'songs' || v === 'queue' || v === 'album' || v === 'artist' || v === 'favorites'; }
  function rowH() { return state.view === 'album' ? 48 : 56; }

  function setView(view, detail) {
    if (view === 'playing') { showStage(true); return; }
    if (view === 'album-current') { goToCurrentAlbum(); return; }
    if ((view === 'album' || view === 'artist') && state.view !== 'album' && state.view !== 'artist') state.parentView = state.view;
    if (view === 'album' && state.view === 'artist') state.parentView = 'artist:' + state.detail;
    if (view !== 'album' && view !== 'artist') state.parentView = view;
    state.view = view;
    state.detail = detail === undefined ? null : detail;
    state.sort = { key: 'default', dir: 1 };
    state.selectedId = null;
    invalidate();
    state.stage = false;
    scroller.scrollTop = 0;
    renderAll();
    showStage(false);
  }

  function updateNavActive() {
    var view = state.view;
    var navView = view === 'album' ? 'albums' : view === 'artist' ? 'artists' : view;
    if (view === 'album' && state.parentView.indexOf('artist') === 0) navView = 'artists';
    if (state.stage) navView = 'playing';
    $$('.nav-item[data-view], .tabbar [data-view]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === navView); });
  }

  function showStage(on) {
    state.stage = !!on && !!state.current;
    $('npStage').hidden = !state.stage;
    if (!state.stage) restoreLyrics();
    updateNavActive();
    applyViewTint();
    if (!state.stage) renderRows();
  }

  function goBack() {
    var p = state.parentView || 'songs';
    if (p.indexOf('artist:') === 0) setView('artist', p.slice(7));
    else setView(p);
  }

  function renderAll(soft) {
    var has = state.tracks.length > 0;
    var isSet = state.view === 'settings';
    $('npStage').hidden = !state.stage;
    $('noFolders').hidden = state.folders.length > 0 || has;
    $('settingsView').hidden = !isSet;
    $('empty').hidden = has || isSet;
    $('hero').hidden = !has && !isSet;
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

    if (!has && !isSet) { $('noResults').hidden = true; return; }
    renderHero(soft);
    if (isSet) { if (!soft) renderSettings(); $('noResults').hidden = true; return; }
    if (isListView(v)) { renderHead(); renderRows(); }
    else if (v === 'albums') { if (!soft || !$('albumGrid').childElementCount) renderAlbums(); }
    else if (v === 'artists') { if (!soft || !$('artistGrid').childElementCount) renderArtists(); }
    updateNoResults();
  }

  function heroActions() {
    return '<div class="hero-actions">' +
      '<button class="play-btn" data-cmd="play-view" title="Play">' + ICON_PLAY + '</button>' +
      '<button class="btn ghost" data-cmd="shuffle-view">' + ICON_SHUFFLE + 'Shuffle</button>' +
      '<button class="btn ghost dj-hero" data-cmd="dj-start"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/></svg>DJ</button>' +
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
  // Two "decks" so one song can fade into the next (crossfade / DJ mode).
  // `audio` always points at the deck that is currently playing.

  var decks = [new Audio(), new Audio()];
  var active = 0;
  var audio = decks[0];
  var deckUrls = [null, null];
  var vol = typeof settings.volume === 'number' ? settings.volume : 0.8;
  var muted = !!settings.muted;
  var errorStreak = 0, seeking = false, pendingSeek = 0;
  var fade = null;          // crossfade in progress: { from, fromIdx, timer, iv }
  decks.forEach(function (d) { d.preload = 'auto'; });

  function applyVolumeToDecks() {
    decks.forEach(function (d) { if (!fade || d !== fade.from || ac) d.volume = vol; d.muted = muted; });
  }
  function setVolume(v) { vol = Math.max(0, Math.min(1, v)); muted = false; applyVolumeToDecks(); updateVolume(); saveSettings(); }
  function setMuted(m) { muted = !!m; applyVolumeToDecks(); updateVolume(); saveSettings(); }
  applyVolumeToDecks();

  function speed() { return settings.speed || 1; }
  function applyRate() {
    var r = speed(), keep = settings.preservePitch !== false;
    decks.forEach(function (d) {
      d.defaultPlaybackRate = r;
      d.playbackRate = r;
      d.preservesPitch = keep; d.webkitPreservesPitch = keep; d.mozPreservesPitch = keep;
    });
  }
  applyRate();

  // smooth gain changes on one deck (needs Web Audio; otherwise falls back to element volume)
  function rampDeck(idx, target, secs, curve) {
    if (!deckGains) return;
    var g = deckGains[idx].gain, now = ac.currentTime;
    g.cancelScheduledValues(now);
    if (!secs) { g.setValueAtTime(target, now); return; }
    var from = g.value;
    if (curve && g.setValueCurveAtTime) {
      var n = 64, arr = new Float32Array(n);
      for (var i = 0; i < n; i++) {
        var x = i / (n - 1);
        // equal-power curve keeps the loudness steady through the fade
        arr[i] = target > from ? Math.sin(x * Math.PI / 2) * target : Math.cos(x * Math.PI / 2) * from;
      }
      try { g.setValueCurveAtTime(arr, now, secs); return; } catch (e) { /* fall through */ }
    }
    g.setValueAtTime(from, now);
    g.linearRampToValueAtTime(target, now + secs);
  }

  function cancelFade() {
    if (!fade) return;
    clearTimeout(fade.timer);
    clearInterval(fade.iv);
    fade.from.pause();
    if (deckGains) rampDeck(fade.fromIdx, 1, 0);
    fade = null;
    applyVolumeToDecks();
  }

  function setDeckSource(idx, t) {
    if (deckUrls[idx]) URL.revokeObjectURL(deckUrls[idx]);
    deckUrls[idx] = URL.createObjectURL(t.file);
    decks[idx].src = deckUrls[idx];
    decks[idx].defaultPlaybackRate = speed();
  }

  function trackStarted(t, prev) {
    if (prev && prev !== t) finishStats(prev);
    beginStats(t);
    state.current = t;
    updateNowPlaying();
    loadLyrics(t);
    if (state.view === 'queue') { invalidate(); updateHeroMeta(); }
    renderRows();
    djFill();
    saveLast();
  }

  function loadTrack(t, autoplay, startAt) {
    if (!t) return;
    cancelFade();
    var prev = state.current;
    pendingSeek = startAt || 0;
    setDeckSource(active, t);
    if (deckGains) rampDeck(active, 1, 0);
    trackStarted(t, prev);
    if (autoplay) play();
  }

  // Fade the current song out while the next one fades in.
  function crossfadeTo(i, secs) {
    var t = state.byId.get(state.queue[i]);
    if (!t) return false;
    cancelFade();
    var fromIdx = active, toIdx = 1 - active, from = decks[fromIdx], to = decks[toIdx];
    var prev = state.current;
    setDeckSource(toIdx, t);
    to.volume = ac ? vol : 0;
    to.muted = muted;
    active = toIdx;
    audio = to;
    state.qIndex = i;
    pendingSeek = 0;
    if (deckGains) { rampDeck(toIdx, 0, 0); }
    var p = to.play();
    if (p && p.catch) p.catch(function () { /* ignore */ });
    if (deckGains) {
      rampDeck(fromIdx, 0, secs, true);
      rampDeck(toIdx, 1, secs, true);
    }
    fade = { from: from, fromIdx: fromIdx, iv: null, timer: null };
    if (!deckGains) { // element-volume fallback (Safari without Web Audio)
      var t0 = Date.now();
      fade.iv = setInterval(function () {
        var x = Math.min(1, (Date.now() - t0) / (secs * 1000));
        from.volume = vol * Math.cos(x * Math.PI / 2);
        to.volume = vol * Math.sin(x * Math.PI / 2);
        if (x >= 1) clearInterval(fade.iv);
      }, 60);
    }
    fade.timer = setTimeout(function () {
      from.pause();
      if (deckGains) rampDeck(fromIdx, 1, 0);
      clearInterval(fade && fade.iv);
      fade = null;
      applyVolumeToDecks();
    }, secs * 1000 + 150);
    trackStarted(t, prev);
    setPlayingClass();
    return true;
  }

  function canCrossfade() { return !!deckGains || !IS_IOS; }
  function crossfadeSecs() {
    var x = typeof settings.crossfade === 'number' ? settings.crossfade : 0;
    if (settings.dj && x < 1) x = 6; // the DJ always blends
    return canCrossfade() ? x : 0;
  }

  function play() {
    if (!state.current) {
      if (settings.dj) { startDj(); return; }
      var ids = isListView(state.view) && getList().length ? getList() : defaultIds();
      if (ids.length) playIds(ids, state.shuffle ? Math.floor(Math.random() * ids.length) : 0);
      return;
    }
    ensureAudioGraph();
    if (ac && ac.state === 'suspended') ac.resume();
    if (deckGains && settings.softPause !== false && audio.paused) { rampDeck(active, 0, 0); rampDeck(active, 1, 0.25); }
    var p = audio.play();
    if (p && p.catch) p.catch(function (e) { if (e && e.name === 'NotAllowedError') toast('Press play to start.'); });
  }
  var pauseTimer = null;
  function pause() {
    cancelFade();
    if (deckGains && settings.softPause !== false && !audio.paused) {
      rampDeck(active, 0, 0.2);
      clearTimeout(pauseTimer);
      var d = audio;
      pauseTimer = setTimeout(function () { d.pause(); rampDeck(active, 1, 0); }, 220);
      document.body.classList.remove('is-playing');
      return;
    }
    audio.pause();
  }
  function toggle() { if (audio.paused || !document.body.classList.contains('is-playing')) play(); else pause(); }
  function stop() {
    cancelFade();
    decks.forEach(function (d, i) {
      d.pause();
      d.removeAttribute('src');
      d.load();
      if (deckUrls[i]) { URL.revokeObjectURL(deckUrls[i]); deckUrls[i] = null; }
    });
  }

  function defaultIds() {
    return state.tracks.slice().sort(defaultOrder).map(function (t) { return t.id; });
  }

  function playIds(ids, index, forceShuffle) {
    if (!ids.length) return;
    if (settings.dj) { // DJ keeps your pick and builds the rest of the queue itself
      state.queue = [ids[index]];
      state.originalQueue = state.queue.slice();
      state.qIndex = 0;
      loadTrack(state.byId.get(ids[index]), true);
      return;
    }
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

  function nextIndex() {
    djFill();
    var i = state.qIndex + 1;
    if (i < state.queue.length) return i;
    if (state.repeat === 'all' && state.queue.length) {
      if (state.shuffle) shuffleArr(state.queue);
      return 0;
    }
    return -1;
  }

  function next(auto) {
    if (!state.queue.length) return;
    if (auto && state.repeat === 'one') { audio.currentTime = 0; play(); return; }
    var i = nextIndex();
    if (i < 0) {
      if (auto) { audio.pause(); audio.currentTime = 0; }
      return;
    }
    if (!auto && settings.smoothSkip !== false && crossfadeSecs() > 0 && !audio.paused) {
      if (crossfadeTo(i, 1.2)) return;
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

  function maybeAutoCrossfade() {
    var xf = crossfadeSecs();
    if (!xf || fade || seeking || state.repeat === 'one' || audio.paused) return;
    var d = audio.duration;
    if (!d || !isFinite(d) || d < xf * 2 + 4) return;
    var left = (d - audio.currentTime) / (audio.playbackRate || 1);
    if (left > xf) return;
    var i = nextIndex();
    if (i >= 0) crossfadeTo(i, Math.max(1, left));
  }

  // events from both decks; ignore anything from the deck that is fading out
  decks.forEach(function (d) {
    d.addEventListener('play', function () { if (this === audio) setPlayingClass(); });
    d.addEventListener('pause', function () { if (this === audio) setPlayingClass(); });
    d.addEventListener('playing', function () { if (this === audio) errorStreak = 0; });
    d.addEventListener('ended', function () { if (this === audio) next(true); });
    d.addEventListener('loadedmetadata', function () {
      if (this !== audio) return;
      if (pendingSeek && pendingSeek < audio.duration) audio.currentTime = pendingSeek;
      pendingSeek = 0;
      var t = state.current;
      if (t && !t.duration && isFinite(audio.duration)) { t.duration = audio.duration; markMetaDirty(t); renderRows(); }
      updateTime();
    });
    d.addEventListener('timeupdate', function () {
      if (this !== audio) return;
      updateTime(); updateLyricHighlight(); sampleStats(); maybeAutoCrossfade(); saveLastSoon();
    });
    d.addEventListener('seeked', function () { if (this === audio) { lyricIdx = -1; updateLyricHighlight(); } });
    d.addEventListener('error', function () {
      if (this !== audio) return;
      var t = state.current;
      if (!t || !audio.getAttribute('src')) return;
      t.broken = true;
      renderRows();
      errorStreak++;
      toast('Can’t play “' + t.title + '” in this browser' + (t.ext === 'aiff' || t.ext === 'aif' || t.ext === 'caf' ? ' (try Safari for AIFF/ALAC).' : '.'));
      if (errorStreak < 5) next(false); else { errorStreak = 0; pause(); }
    });
  });

  /* ---------------- listening stats (used by the DJ) ---------------- */
  var stats = {};
  try { stats = JSON.parse(localStorage.getItem('tunebox.stats') || '{}') || {}; } catch (e) { stats = {}; }
  var history = [];
  try { history = JSON.parse(localStorage.getItem('tunebox.history') || '[]') || []; } catch (e) { history = []; }
  var cur = { t: null, maxPos: 0, eSum: 0, eN: 0, lastSample: 0 };
  function stat(t) { return stats[t.path] || (stats[t.path] = { p: 0, s: 0 }); }
  function beginStats(t) {
    cur = { t: t, maxPos: 0, eSum: 0, eN: 0, lastSample: 0 };
    history.push(t.path);
    if (history.length > 300) history = history.slice(-300);
  }
  function sampleStats() {
    if (!cur.t || cur.t !== state.current) return;
    cur.maxPos = Math.max(cur.maxPos, audio.currentTime);
    var now = Date.now();
    if (analyser && now - cur.lastSample > 2000) {
      cur.lastSample = now;
      analyser.getByteFrequencyData(freq);
      var sum = 0;
      for (var i = 0; i < freq.length; i++) sum += freq[i];
      cur.eSum += sum / freq.length / 255;
      cur.eN++;
    }
  }
  function finishStats(t) {
    if (!cur.t || cur.t !== t) return;
    var s = stat(t), d = t.duration || audio.duration || 0;
    if (d && cur.maxPos < Math.min(30, d * 0.35)) s.s = (s.s || 0) + 1;      // skipped early
    else if (!d || cur.maxPos > d * 0.5) s.p = (s.p || 0) + 1;               // properly played
    if (cur.eN >= 3) s.e = Math.round((s.e ? (s.e + cur.eSum / cur.eN) / 2 : cur.eSum / cur.eN) * 1000) / 1000;
    s.l = Date.now();
    saveStatsSoon();
  }
  var saveStatsSoon = debounce(function () {
    try {
      localStorage.setItem('tunebox.stats', JSON.stringify(stats));
      localStorage.setItem('tunebox.history', JSON.stringify(history));
    } catch (e) { /* ignore quota */ }
  }, 2000);
  window.addEventListener('pagehide', function () { if (state.current) finishStats(state.current); saveStatsSoon(); });

  /* ---------------- Tunebox DJ (smart, no AI model needed) ---------------- */
  // Scores every song against what's playing: genre, artist, era, tempo, energy, your favourites,
  // what you play through vs. skip, and what was played recently. Then picks with a little randomness.
  function djPick() {
    var ref = state.byId.get(state.queue[state.queue.length - 1]) || state.current;
    if (!state.tracks.length) return null;
    var variety = typeof settings.djVariety === 'number' ? settings.djVariety : 0.5;
    var queued = new Set(state.queue.slice(Math.max(0, state.qIndex)));
    var recentN = Math.min(250, Math.floor(state.tracks.length * 0.6));
    var recent = new Set(history.slice(-recentN));
    state.queue.slice(Math.max(0, state.queue.length - recentN)).forEach(function (id) { var t = state.byId.get(id); if (t) recent.add(t.path); });
    var lastArtists = state.queue.slice(-2).map(function (id) { var t = state.byId.get(id); return t ? artistOf(t).toLowerCase() : ''; });
    var best = [];
    for (var i = 0; i < state.tracks.length; i++) {
      var c = state.tracks[i];
      if (c.broken || queued.has(c.id)) continue;
      var sc = Math.random() * (1 + variety * 4);
      if (recent.has(c.path)) sc -= 40;
      if (ref) {
        var ca = artistOf(c).toLowerCase(), ra = artistOf(ref).toLowerCase();
        if (c.genre && ref.genre) sc += c.genre.toLowerCase() === ref.genre.toLowerCase() ? 4 * (1.2 - variety) : -1 * (1 - variety);
        if (lastArtists.indexOf(ca) >= 0 && settings.djArtistGap !== false) sc -= 8;
        else if (ca === ra) sc += 1.5 * (1 - variety);
        if (c.year && ref.year) sc += 2.5 * Math.exp(-Math.abs(c.year - ref.year) / 6);
        if (c.bpm && ref.bpm) sc += 2.5 * Math.exp(-Math.abs(c.bpm - ref.bpm) / 10);
        var se = stats[c.path], re = stats[ref.path];
        if (se && re && se.e && re.e) sc += 2.5 * (1 - Math.min(1, Math.abs(se.e - re.e) * 4));
      }
      var st = stats[c.path];
      if (st) {
        sc += Math.min(2.5, Math.log(1 + (st.p || 0)) * 0.8);
        sc -= Math.min(5, (st.s || 0) * 1.3);
      } else {
        sc += variety * 1.5; // a nudge towards songs you haven't heard yet
      }
      if (settings.djFavs !== false && favs[c.path]) sc += 2;
      if (best.length < 12 || sc > best[best.length - 1].sc) {
        best.push({ t: c, sc: sc });
        best.sort(function (a, b) { return b.sc - a.sc; });
        if (best.length > 12) best.pop();
      }
    }
    if (!best.length) return null;
    // weighted pick among the best few, so the DJ doesn't become predictable
    var top = best.slice(0, 6), wsum = 0;
    top.forEach(function (b) { b.w = Math.exp((b.sc - top[0].sc) / 2); wsum += b.w; });
    var r = Math.random() * wsum;
    for (var k = 0; k < top.length; k++) { r -= top[k].w; if (r <= 0) return top[k].t.id; }
    return top[0].t.id;
  }
  function djFill() {
    if (!settings.dj || !state.tracks.length) return;
    var added = false;
    while (state.queue.length - Math.max(0, state.qIndex) - 1 < 6) {
      var id = djPick();
      if (id == null) break;
      state.queue.push(id);
      added = true;
    }
    if (added) { state.originalQueue = state.queue.slice(); updateUpNext(); }
  }
  function startDj(seed) {
    if (!state.tracks.length) { toast('Add some music first.'); return; }
    settings.dj = true;
    saveSettings();
    if (state.shuffle) { state.shuffle = false; updateModes(); }
    var s = seed || state.current;
    if (!s) {
      var favList = state.tracks.filter(isFav);
      var pool = favList.length ? favList : state.tracks;
      s = pool[Math.floor(Math.random() * pool.length)];
    }
    state.queue = [s.id];
    state.qIndex = 0;
    if (state.current === s) djFill();
    else loadTrack(s, true);
    if (audio.paused) play();
    updateDjUi();
    toast('Tunebox DJ is on — sit back.', 2200);
  }
  function stopDj() {
    settings.dj = false;
    saveSettings();
    updateDjUi();
    toast('DJ off', 1200);
  }
  function toggleDj() { if (settings.dj) stopDj(); else startDj(); }
  function updateDjUi() {
    $$('[data-cmd="dj"]').forEach(function (b) { b.classList.toggle('on', !!settings.dj); });
    document.body.classList.toggle('dj-on', !!settings.dj);
    $$('.dj-state').forEach(function (el) { el.textContent = settings.dj ? 'On' : 'Off'; });
    if (state.view === 'settings') renderSettings();
    updateUpNext();
  }

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
    var v = muted ? 0 : vol;
    $$('.vol-range').forEach(function (r) {
      r.value = v;
      r.style.setProperty('--p', (v * 100) + '%');
    });
    $('volPct').textContent = Math.round(v * 100) + '%';
    $$('.mute-btn').forEach(function (b) { b.classList.toggle('muted', muted || vol === 0); });
  }

  var LOSSLESS = { flac: 1, wav: 1, aif: 1, aiff: 1, caf: 1 };
  function updateNowPlaying() {
    var t = state.current;
    var sub = t ? t.artist + ' — ' + t.album : 'Pick a song to start';
    $('npTitle').textContent = $('stTitle').textContent = t ? t.title : 'Not playing';
    $('npvTitle').textContent = t ? t.title : '';
    $('npvSub').textContent = t ? t.artist + ' — ' + t.album : '';
    $('npSub').textContent = $('stSub').textContent = sub;
    $('stFormat').textContent = t ? t.ext.toUpperCase() + (LOSSLESS[t.ext] ? ' · LOSSLESS' : '') : '';
    document.title = t ? t.title + ' · ' + t.artist : 'Tunebox';
    updateFavButtons();
    updateUpNext();

    var arts = [$('npArt'), $('stArt'), $('npvArt')];
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
    var nx = state.qIndex + 1 < state.queue.length ? state.byId.get(state.queue[state.qIndex + 1]) : null;
    $('npvNext').innerHTML = nx ? 'Up next: <b>' + esc(nx.title) + '</b> · ' + esc(nx.artist) : '';
    var list = $('queueList');
    if (!state.queue.length || state.qIndex < 0) {
      list.innerHTML = '<div class="insp-empty">' + (state.tracks.length ? 'Play a song to fill your queue.' : 'Add some music to get started.') + '</div>';
      return;
    }
    var html = '<div class="insp-label">' + (settings.dj ? '✦ DJ picks · ' : 'Playing Next · ') + plural(state.queue.length - state.qIndex, 'Track') + '</div>';
    var end = Math.min(state.queue.length, state.qIndex + 120);
    for (var i = state.qIndex; i < end; i++) {
      var q = state.byId.get(state.queue[i]);
      if (!q) continue;
      var isCur = i === state.qIndex;
      html += '<button class="qrow' + (isCur ? ' playing' : '') + '" data-q="' + i + '">' +
        '<div class="thumb cover">' + coverInner(coverSync.has(q.albumKey) ? coverSync.get(q.albumKey) : undefined, q.album) +
          (isCur ? '<div class="on-art"><span class="eq"><i></i><i></i><i></i></span></div>' : '') + '</div>' +
        '<div class="tt"><div class="t1">' + esc(q.title) + '</div><div class="t2">' + esc(q.artist) + '</div></div>' +
        '<span class="qt">' + (q.duration ? fmtTime(q.duration) : '') + '</span></button>';
      if (!coverSync.has(q.albumKey) && i < state.qIndex + 20) getCover(q).then(upNextSoon);
    }
    if (end < state.queue.length) html += '<div class="insp-empty">+ ' + plural(state.queue.length - end, 'more song') + '</div>';
    list.innerHTML = html;
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
  var ac = null, eqNodes = null, analyser = null, freq = null, deckGains = null;
  var preampNode = null, dryNode = null, wetNode = null, limiter = null;
  var EQ_BANDS = [
    { f: 32, type: 'lowshelf', label: '32' },
    { f: 64, type: 'peaking', label: '64' },
    { f: 125, type: 'peaking', label: '125' },
    { f: 250, type: 'peaking', label: '250' },
    { f: 500, type: 'peaking', label: '500' },
    { f: 1000, type: 'peaking', label: '1K' },
    { f: 2000, type: 'peaking', label: '2K' },
    { f: 4000, type: 'peaking', label: '4K' },
    { f: 8000, type: 'peaking', label: '8K' },
    { f: 16000, type: 'highshelf', label: '16K' }
  ];
  var EQ_PRESETS = {
    flat:      { name: 'Flat',           v: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    bass:      { name: 'Bass Boost',     v: [9, 8, 6, 3, 0, -1, 0, 0, 1, 1] },
    warm:      { name: 'Warm Vinyl',     v: [4, 4, 3, 1, 0, 0, -1, -2, -3, -4] },
    vocal:     { name: 'Vocal',          v: [-3, -2, -1, 1, 4, 5, 4, 2, 0, -1] },
    rock:      { name: 'Rock',           v: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5] },
    hiphop:    { name: 'Hip-Hop',        v: [7, 6, 3, 1, -1, -1, 1, 0, 2, 3] },
    edm:       { name: 'Electronic',     v: [6, 5, 2, 0, -2, 1, 0, 2, 5, 6] },
    party:     { name: 'Loudness',       v: [6, 5, 3, 0, -1, 0, 2, 4, 5, 5] },
    night:     { name: 'Late Night',     v: [-4, -3, -1, 0, 2, 2, 1, 0, -2, -4] },
    bright:    { name: 'Bright',         v: [-2, -1, 0, 0, 0, 1, 3, 5, 6, 7] },
    laptop:    { name: 'Laptop Speakers', v: [-6, -2, 3, 4, 3, 2, 2, 3, 2, 1] },
    classical: { name: 'Classical',      v: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4] }
  };
  var VIBES = {
    normal:    { name: 'Normal',          speed: 1,    pitch: true,  reverb: 0 },
    slowed:    { name: 'Slowed + Reverb', speed: 0.85, pitch: false, reverb: 0.4 },
    chill:     { name: 'Chill',           speed: 0.93, pitch: false, reverb: 0.2 },
    spedup:    { name: 'Sped Up',         speed: 1.15, pitch: false, reverb: 0 },
    nightcore: { name: 'Nightcore',       speed: 1.25, pitch: false, reverb: 0.05 },
    hall:      { name: 'Concert Hall',    speed: 1,    pitch: true,  reverb: 0.35 }
  };
  var eq = settings.eq && settings.eq.length === EQ_BANDS.length ? settings.eq : EQ_PRESETS.flat.v.slice();

  function makeImpulse(secs, decay) {
    var rate = ac.sampleRate, len = Math.floor(rate * secs), buf = ac.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  // decks -> volume boost -> 10-band EQ -> (dry + reverb) -> limiter -> visualizer -> speakers
  function ensureAudioGraph() {
    if (ac || IS_IOS) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ac = new AC();
      preampNode = ac.createGain();
      deckGains = decks.map(function (d) {
        var src = ac.createMediaElementSource(d), g = ac.createGain();
        src.connect(g);
        g.connect(preampNode);
        return g;
      });
      eqNodes = EQ_BANDS.map(function (b) {
        var n = ac.createBiquadFilter();
        n.type = b.type;
        n.frequency.value = b.f;
        if (b.type === 'peaking') n.Q.value = 1.4;
        return n;
      });
      var node = preampNode;
      eqNodes.forEach(function (n) { node.connect(n); node = n; });
      dryNode = ac.createGain();
      wetNode = ac.createGain();
      var conv = ac.createConvolver();
      conv.buffer = makeImpulse(2.8, 2.4);
      node.connect(dryNode);
      node.connect(conv);
      conv.connect(wetNode);
      // a limiter catches peaks, so big EQ boosts get loud without crackling
      limiter = ac.createDynamicsCompressor();
      limiter.threshold.value = -1.5;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.2;
      dryNode.connect(limiter);
      wetNode.connect(limiter);
      analyser = ac.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.82;
      freq = new Uint8Array(analyser.frequencyBinCount);
      limiter.connect(analyser);
      analyser.connect(ac.destination);
      // keep audio flowing in the background: if the system pauses the audio engine, wake it again
      ac.onstatechange = function () { if (ac.state !== 'running' && !audio.paused) ac.resume(); };
      applyEq();
      applyFx();
    } catch (e) {
      ac = null; eqNodes = null; analyser = null; deckGains = null;
    }
  }
  function applyEq() {
    if (!eqNodes) return;
    for (var i = 0; i < eqNodes.length; i++) eqNodes[i].gain.setTargetAtTime(eq[i], ac.currentTime, 0.05);
  }
  function applyFx() {
    applyRate();
    if (!ac) return;
    var pre = typeof settings.preamp === 'number' ? settings.preamp : 0;
    preampNode.gain.setTargetAtTime(Math.pow(10, pre / 20), ac.currentTime, 0.05);
    var r = settings.reverb || 0;
    wetNode.gain.setTargetAtTime(r * 1.2, ac.currentTime, 0.08);
    dryNode.gain.setTargetAtTime(1 - r * 0.35, ac.currentTime, 0.08);
  }
  function buildEqBands() {
    $('eqBands').innerHTML = EQ_BANDS.map(function (b, i) {
      return '<div class="eq-band"><b id="eqv' + i + '">0</b>' +
        '<div class="eq-slot"><input type="range" class="mac-slider" data-band="' + i + '" min="-15" max="15" step="1" value="0" aria-label="' + b.label + ' Hz"></div>' +
        '<span>' + b.label + '</span></div>';
    }).join('');
    $('eqPresets').innerHTML = Object.keys(EQ_PRESETS).map(function (k) {
      return '<button data-eq="' + k + '">' + EQ_PRESETS[k].name + '</button>';
    }).join('');
    $('vibes').innerHTML = Object.keys(VIBES).map(function (k) {
      return '<button data-vibe="' + k + '">' + VIBES[k].name + '</button>';
    }).join('');
  }
  function eqPresetKey() {
    var key = '';
    Object.keys(EQ_PRESETS).forEach(function (k) { if (EQ_PRESETS[k].v.join() === eq.join()) key = k; });
    return key;
  }
  function vibeKey() {
    var key = '';
    Object.keys(VIBES).forEach(function (k) {
      var v = VIBES[k];
      if (Math.abs(speed() - v.speed) < 0.001 && (settings.preservePitch !== false) === v.pitch && Math.abs((settings.reverb || 0) - v.reverb) < 0.001) key = k;
    });
    return key;
  }
  function setFill(r, min, max) { r.style.setProperty('--p', ((r.value - min) / (max - min) * 100) + '%'); }
  function renderEq() {
    $$('#eqBands input').forEach(function (r, i) {
      r.value = eq[i];
      setFill(r, -15, 15);
      $('eqv' + i).textContent = (eq[i] > 0 ? '+' : '') + eq[i];
    });
    var key = eqPresetKey(), vk = vibeKey();
    $$('#eqPresets button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-eq') === key); });
    $$('#vibes button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-vibe') === vk); });
    var pre = $('eqPreamp'); pre.value = settings.preamp || 0; setFill(pre, -12, 12);
    $('eqPreampVal').textContent = (pre.value > 0 ? '+' : '') + pre.value + ' dB';
    var sp = $('fxSpeed'); sp.value = speed(); setFill(sp, 0.5, 1.5);
    $('fxSpeedVal').textContent = speed().toFixed(2) + '×';
    var rv = $('fxReverb'); rv.value = settings.reverb || 0; setFill(rv, 0, 0.8);
    $('fxReverbVal').textContent = Math.round((settings.reverb || 0) * 100) + '%';
    $('eqNote').textContent = IS_IOS ? 'On iPhone / iPad only speed works — the browser there doesn’t allow EQ or reverb.' : '';
  }
  function setEq(vals) {
    eq = vals.slice();
    settings.eq = eq;
    saveSettings();
    applyEq();
    renderEq();
    if (state.view === 'settings') renderSettings();
  }
  function setVibe(k) {
    var v = VIBES[k];
    settings.speed = v.speed;
    settings.preservePitch = v.pitch;
    settings.reverb = v.reverb;
    saveSettings();
    applyFx();
    renderEq();
    if (state.view === 'settings') renderSettings();
    if (k !== 'normal') toast(v.name + ' on', 1300);
  }
  function toggleEqPanel(force) {
    var p = $('eqPanel');
    var show = typeof force === 'boolean' ? force : p.hidden;
    p.hidden = !show;
    if (show) { ensureAudioGraph(); renderEq(); }
    $('btnEq').classList.toggle('on', show);
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

  function openNowPlaying() { showStage(true); }
  function closeNowPlaying() { if (state.stage) showStage(false); }

  /* ---------------- lyrics (.lrc next to the song, or embedded in its tags) ---------------- */
  function readText(file) {
    if (file.text) return file.text();
    return new Promise(function (res) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { res(''); };
      fr.readAsText(file);
    });
  }
  function parseLyrics(text) {
    var lines = [], plain = [];
    text.replace(/\r/g, '').split('\n').forEach(function (l) {
      var m = /^((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+)(.*)$/.exec(l.trim());
      if (m) {
        var txt = m[2].trim(), re = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g, tm;
        while ((tm = re.exec(m[1]))) lines.push({ t: parseInt(tm[1], 10) * 60 + parseFloat(tm[2].replace(':', '.')), text: txt });
      } else if (!/^\[[a-z]+:.*\]$/i.test(l.trim())) {
        plain.push(l.trim());           // skip [ar:…] style header tags
      }
    });
    if (lines.length) {
      lines.sort(function (a, b) { return a.t - b.t; });
      return { lines: lines.filter(function (x) { return x.text; }), synced: true };
    }
    while (plain.length && !plain[0]) plain.shift();
    return plain.length ? { lines: plain.map(function (x) { return { t: 0, text: x }; }), synced: false } : null;
  }
  function loadLyrics(t) {
    state.lyrics = null;
    lyricIdx = -1;
    renderLyrics();
    var key = t.path.replace(/\.[^.\/]+$/, '').toLowerCase();
    var lrc = state.lrcFiles.get(key);
    var p = lrc ? readText(lrc) : Meta.read(t.file, t.ext, true).then(function (m) { return m.lyrics; });
    p.then(function (txt) {
      if (state.current !== t) return;
      state.lyrics = txt ? parseLyrics(txt) : null;
      renderLyrics();
    }).catch(function () { /* no lyrics */ });
  }
  var lyricIdx = -1;
  function renderLyrics() {
    var v = $('lyricsView'), L = state.lyrics;
    if (!state.current) { v.innerHTML = '<div class="insp-empty">Play a song to see its lyrics.</div>'; return; }
    if (!L || !L.lines.length) {
      v.className = 'lyrics-box';
      v.innerHTML = '<div class="insp-empty">No lyrics found for this song.<br><br>Tip: put a <code>.lrc</code> file with the same name next to the song for synced lyrics, or add lyrics to the file’s tags.</div>';
      return;
    }
    v.className = 'lyrics-box ' + (L.synced ? 'lyrics-synced' : 'lyrics-plain');
    v.innerHTML = L.lines.map(function (l, i) {
      return l.text ? '<div class="lyric-line" data-li="' + i + '">' + esc(l.text) + '</div>' : '<div class="lyric-gap"></div>';
    }).join('');
    lyricIdx = -1;
    updateLyricHighlight();
  }
  function updateLyricHighlight() {
    var L = state.lyrics;
    if (!L || !L.synced) return;
    var t = audio.currentTime + 0.2, idx = -1;
    for (var i = 0; i < L.lines.length; i++) { if (L.lines[i].t <= t) idx = i; else break; }
    if (idx === lyricIdx) return;
    var v = $('lyricsView');
    var prev = v.querySelector('.lyric-line.active');
    if (prev) prev.classList.remove('active');
    lyricIdx = idx;
    var el = idx >= 0 ? v.querySelector('[data-li="' + idx + '"]') : null;
    if (el) {
      el.classList.add('active');
      if (!$('lyricsView').hidden && !audio.paused) {
        var top = el.offsetTop - v.clientHeight / 2 + el.clientHeight / 2;
        v.scrollTop = Math.max(0, top);
      }
    }
  }

  /* ---------------- window presets, drawers, inspector ---------------- */
  var shell = $('shell');
  function updateWidthClasses() {
    var w = window.innerWidth;
    shell.classList.toggle('w-split', w < 1100);
    shell.classList.toggle('w-compact', w <= 720);
    renderRows();
  }
  function closeDrawers() { /* no drawers in this layout */ }
  function toggleInspector() { setInspTab(state.inspTab === 'queue' ? 'lyrics' : 'queue'); }
  function applyInspectorSetting() { /* the Now Playing panel is always shown on wide windows */ }
  function restoreLyrics() {
    var lv = $('lyricsView'), home = document.querySelector('.upnext');
    if (lv.parentNode !== home) home.appendChild(lv);
    $('npvLyrics').hidden = true;
    $$('[data-cmd="np-lyrics"]').forEach(function (b) { b.classList.remove('on'); });
    setInspTab(state.inspTab);
  }
  function toggleNpLyrics() {
    var box = $('npvLyrics'), lv = $('lyricsView');
    if (!box.hidden) { restoreLyrics(); return; }
    box.appendChild(lv);
    lv.hidden = false;
    box.hidden = false;
    $$('[data-cmd="np-lyrics"]').forEach(function (b) { b.classList.add('on'); });
    lyricIdx = -1;
    updateLyricHighlight();
  }
  function setInspTab(tab) {
    state.inspTab = tab;
    $('tabQueue').classList.toggle('on', tab === 'queue');
    $('tabLyrics').classList.toggle('on', tab === 'lyrics');
    $('queueView').hidden = tab !== 'queue';
    $('lyricsView').hidden = tab !== 'lyrics';
    if (tab === 'lyrics') { lyricIdx = -1; updateLyricHighlight(); }
  }
  function showInspector(tab) { setInspTab(tab); }

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
        if (AUDIO_EXT.indexOf(ext) < 0 && IMG_EXT.indexOf(ext) < 0 && ext !== 'm4p' && ext !== 'lrc') continue;
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

  var dbPromise = null;
  function idbOpen() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
      var r = indexedDB.open('tunebox', 2);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
    dbPromise.catch(function () { dbPromise = null; });
    return dbPromise;
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
      (perm === 'granted' && settings.autoOpen !== false ? ready : needAsk).push(list[i]);
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

  /* ------------------------------ settings page ------------------------------ */

  var ACCENTS = {
    amber: [[245, 158, 11], [59, 130, 246]],
    coral: [[255, 106, 61], [232, 54, 107]],
    rose: [[236, 72, 153], [168, 85, 247]],
    violet: [[139, 92, 246], [236, 72, 153]],
    blue: [[59, 130, 246], [6, 182, 212]],
    green: [[16, 185, 129], [6, 182, 212]]
  };
  var DEFAULT_ON = ['viz', 'smoothSkip', 'softPause', 'preservePitch', 'djArtistGap', 'djFavs', 'autoOpen'];
  function isOn(key) { return DEFAULT_ON.indexOf(key) >= 0 ? settings[key] !== false : !!settings[key]; }

  function applyLook() {
    var root = document.documentElement;
    root.style.setProperty('--orb-mul', typeof settings.glow === 'number' ? settings.glow : 1);
    root.classList.toggle('reduce-motion', !!settings.reduceMotion);
    $('viz').hidden = settings.viz === false;
    applyViewTint();
  }

  function sSeg(key, opts, cur) {
    return '<div class="seg set-seg" data-set="' + key + '">' + opts.map(function (o) {
      return '<button data-val="' + o[0] + '"' + (String(cur) === String(o[0]) ? ' class="on"' : '') + '>' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  function sSwitch(key) {
    var on = isOn(key);
    return '<button class="switch' + (on ? ' on' : '') + '" data-toggle="' + key + '" role="switch" aria-checked="' + on + '" aria-label="' + key + '"><i></i></button>';
  }
  function sSlider(key, min, max, step, val, label) {
    return '<div class="set-slider"><input type="range" class="mac-slider" data-slide="' + key + '" min="' + min + '" max="' + max +
      '" step="' + step + '" value="' + val + '" style="--p:' + ((val - min) / (max - min) * 100) + '%"><b data-out="' + key + '">' + label + '</b></div>';
  }
  function sRow(title, desc, ctl, extra) {
    return '<div class="set-row' + (extra ? ' ' + extra : '') + '"><div class="set-text"><div class="set-title">' + title + '</div>' +
      (desc ? '<div class="set-desc">' + desc + '</div>' : '') + '</div><div class="set-ctl">' + ctl + '</div></div>';
  }
  function sCard(title, sub, rows) {
    return '<section class="set-card"><div class="set-card-head"><h3>' + title + '</h3>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + rows + '</section>';
  }
  function sBtn(label, attr, primary) {
    return '<button class="btn small' + (primary ? ' primary' : '') + '" ' + attr + '>' + label + '</button>';
  }

  var SLIDE_LABELS = {
    glow: function (v) { return Math.round(v * 100) + '%'; },
    crossfade: function (v) { return +v ? v + ' s' : 'Off'; },
    speed: function (v) { return (+v).toFixed(2) + '×'; },
    reverb: function (v) { return Math.round(v * 100) + '%'; },
    preamp: function (v) { return (v > 0 ? '+' : '') + v + ' dB'; },
    djVariety: function (v) { return v < 0.34 ? 'Familiar' : v < 0.67 ? 'Balanced' : 'Adventurous'; }
  };

  function offlineText() {
    if (location.protocol === 'file:') return 'You opened Tunebox from a file on your Mac, so it already works without internet.';
    if (offlineReady) return 'Ready — Tunebox will open and play your music even with no internet.';
    if (!('serviceWorker' in navigator)) return 'This browser can’t store Tunebox for offline use. Try Chrome or Safari.';
    return 'Getting ready… open Tunebox once more while online and it will work offline.';
  }

  function renderSettings() {
    var v = $('settingsView');
    if (state.view !== 'settings') return;
    var theme = settings.theme || 'auto';
    var accent = settings.accent || 'art';
    var eqName = eqPresetKey() ? EQ_PRESETS[eqPresetKey()].name : 'Custom';
    var vibe = vibeKey() ? VIBES[vibeKey()].name : 'Custom';
    var swatches = '<div class="swatches" data-set="accent">' +
      '<button data-val="art" class="sw-art' + (accent === 'art' ? ' on' : '') + '" title="From album art"></button>' +
      Object.keys(ACCENTS).map(function (k) {
        var a = ACCENTS[k];
        return '<button data-val="' + k + '"' + (accent === k ? ' class="on"' : '') + ' title="' + k + '" style="background:linear-gradient(135deg,rgb(' + a[0].join(',') + '),rgb(' + a[1].join(',') + '))"></button>';
      }).join('') + '</div>';
    var cached = metaCache ? metaCache.size : 0;

    v.innerHTML =
      sCard('Appearance', 'Make Tunebox look the way you like.',
        sRow('Theme', 'Auto follows your Mac.', sSeg('theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], theme)) +
        sRow('Accent colour', accent === 'art' ? 'Colours come from the album art.' : 'Fixed colour.', swatches) +
        sRow('Background glow', '', sSlider('glow', 0, 1.6, 0.05, typeof settings.glow === 'number' ? settings.glow : 1, SLIDE_LABELS.glow(typeof settings.glow === 'number' ? settings.glow : 1))) +
        sRow('Visualizer', 'The moving bars under the cover.', sSwitch('viz')) +
        sRow('Reduce motion', 'Fewer animations — easier on older Macs.', sSwitch('reduceMotion'))) +

      sCard('Playback', 'Fades, speed and effects.',
        sRow('Crossfade', 'Blend the end of a song into the next.' + (canCrossfade() ? '' : ' (Not available on this device.)'),
          sSlider('crossfade', 0, 12, 1, settings.crossfade || 0, SLIDE_LABELS.crossfade(settings.crossfade || 0))) +
        sRow('Smooth skips', 'Quick fade when you press next.', sSwitch('smoothSkip')) +
        sRow('Soft pause', 'Fade out/in on pause and play.', sSwitch('softPause')) +
        sRow('Vibe', vibe, '<div class="vibe-chips">' + Object.keys(VIBES).map(function (k) {
          return '<button data-vibe="' + k + '"' + (vibeKey() === k ? ' class="on"' : '') + '>' + VIBES[k].name + '</button>';
        }).join('') + '</div>', 'wide') +
        sRow('Speed', '', sSlider('speed', 0.5, 1.5, 0.01, speed(), SLIDE_LABELS.speed(speed()))) +
        sRow('Keep pitch', 'Off = slowed songs sound deeper, sped-up songs higher.', sSwitch('preservePitch')) +
        sRow('Reverb', '', sSlider('reverb', 0, 0.8, 0.01, settings.reverb || 0, SLIDE_LABELS.reverb(settings.reverb || 0))) +
        sRow('Volume boost', 'Extra loudness. A limiter stops it from crackling.', sSlider('preamp', -12, 12, 1, settings.preamp || 0, SLIDE_LABELS.preamp(settings.preamp || 0)))) +

      sCard('Equalizer', '10 bands, ±15 dB.',
        sRow('Current sound', eqName, sBtn('Open equalizer', 'data-cmd="eq"', true))) +

      sCard('Tunebox DJ', 'Plays songs that go well together, forever. No internet or AI service — it learns from what you play and skip.',
        sRow('DJ', settings.dj ? 'On — it’s picking your songs.' : 'Off', sSwitch('dj')) +
        sRow('Variety', 'Familiar sticks close to what’s playing; adventurous mixes it up.',
          sSlider('djVariety', 0, 1, 0.05, typeof settings.djVariety === 'number' ? settings.djVariety : 0.5, SLIDE_LABELS.djVariety(typeof settings.djVariety === 'number' ? settings.djVariety : 0.5))) +
        sRow('No repeat artists', 'Avoid the same artist twice in a row.', sSwitch('djArtistGap')) +
        sRow('Favour favourites', 'Hearted songs come up more.', sSwitch('djFavs')) +
        sRow('Listening history', Object.keys(stats).length + ' songs learned', sBtn('Reset', 'data-action="reset-history"'))) +

      sCard('Library', plural(state.tracks.length, 'song') + ' · ' + plural(getAlbums().length, 'album') + ' · song info saved for ' + plural(cached, 'song'),
        sRow('Open library automatically', 'Load your music folder when Tunebox starts (Chrome).', sSwitch('autoOpen')) +
        sRow('Add music', 'Folders or single songs.', sBtn('Add folder', 'data-cmd="open-folder"', true) + ' ' + sBtn('Add songs', 'data-cmd="add-files"')) +
        sRow('Rescan folders', 'Pick up new songs you’ve added.', sBtn('Rescan', 'data-action="rescan"')) +
        sRow('Saved song info', 'Makes big libraries load instantly. Clear it if tags look wrong.', sBtn('Clear', 'data-action="clear-cache"')) +
        sRow('Remove everything', 'Your music files are never touched.', sBtn('Clear library', 'data-action="clear"'))) +

      sCard('App', '',
        sRow('Works offline', offlineText(), '') +
        sRow('Install app', isStandalone() ? 'Installed — open it from your Dock or Launchpad.' : 'Opens in its own window, like a Mac app.',
          isStandalone() ? '' : sBtn('Install', 'data-action="install"', true)) +
        sRow('Keyboard shortcuts', 'Space play · ←/→ seek · Shift+←/→ skip · ↑/↓ volume · / search · S shuffle · R repeat · M mute · L favourite · E equalizer · D DJ · F now playing · I up next · T theme · , settings', '', 'wide')) +

      '<p class="set-foot">Tunebox · your music stays on your device.</p>';
  }

  function applySetting(key, val) {
    switch (key) {
      case 'theme':
        if (val === 'auto') delete settings.theme; else settings.theme = val;
        applyTheme();
        break;
      case 'dj': if (val) startDj(); else stopDj(); return;
      case 'speed': case 'preservePitch': case 'reverb': case 'preamp': applyFx(); break;
      case 'accent': case 'glow': case 'viz': case 'reduceMotion': applyLook(); break;
    }
    saveSettings();
  }

  $('settingsView').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var segEl = b.closest('[data-set]');
    if (segEl && b.hasAttribute('data-val')) {
      var key = segEl.getAttribute('data-set'), val = b.getAttribute('data-val');
      if (key !== 'theme' && key !== 'preset') settings[key] = val;
      applySetting(key, val);
      renderSettings();
      return;
    }
    if (b.hasAttribute('data-toggle')) {
      var k = b.getAttribute('data-toggle'), on = !isOn(k);
      if (k !== 'dj') settings[k] = on;
      applySetting(k, on);
      renderSettings();
      return;
    }
    if (b.hasAttribute('data-vibe')) { setVibe(b.getAttribute('data-vibe')); return; }
    var act = b.getAttribute('data-action');
    if (act === 'reset-history') {
      if (!confirm('Forget what Tunebox DJ has learned about your listening?')) return;
      stats = {}; history = []; saveStatsSoon(); renderSettings(); toast('Listening history cleared', 1500);
    } else if (act === 'rescan') {
      rescanFolders();
    } else if (act === 'clear-cache') {
      clearMetaCache().then(function () { renderSettings(); toast('Saved song info cleared', 1500); });
    } else if (act === 'clear') {
      if (confirm('Remove all songs from Tunebox? (Your files are not touched.)')) clearLibrary();
    } else if (act === 'install') {
      installApp();
    }
  });
  $('settingsView').addEventListener('input', function (e) {
    var key = e.target.getAttribute('data-slide');
    if (!key) return;
    var r = e.target, val = +r.value;
    r.style.setProperty('--p', ((val - r.min) / (r.max - r.min) * 100) + '%');
    settings[key] = val;
    var out = $('settingsView').querySelector('[data-out="' + key + '"]');
    if (out) out.textContent = SLIDE_LABELS[key](val);
    applySetting(key, val);
  });

  /* ------------------------------ saved song info (IndexedDB) ------------------------------ */
  // Tags and durations are remembered per file, so reopening a library of thousands of songs
  // is instant — only new or changed files are read again.
  var metaCache = null, metaDirty = new Set();
  function loadMetaCache() {
    if (metaCache) return Promise.resolve(metaCache);
    return idbOpen().then(function (db) {
      return new Promise(function (res) {
        var m = new Map();
        try {
          var req = db.transaction('meta').objectStore('meta').openCursor();
          req.onsuccess = function () {
            var c = req.result;
            if (c) { m.set(c.key, c.value); c.continue(); } else res(m);
          };
          req.onerror = function () { res(m); };
        } catch (e) { res(m); }
      });
    }).catch(function () { return new Map(); }).then(function (m) { metaCache = m; return m; });
  }
  var META_FIELDS = ['title', 'artist', 'album', 'albumArtist', 'track', 'disc', 'year', 'genre', 'bpm', 'duration'];
  function applyCache(tracks) {
    var need = [];
    tracks.forEach(function (t) {
      var r = metaCache && metaCache.get(t.path);
      if (r && r.sz === t.file.size && r.mt === t.file.lastModified) {
        META_FIELDS.forEach(function (f) { if (r[f] !== undefined && r[f] !== '') t[f] = r[f]; });
        t.tagged = true;
        computeAlbumKey(t);
      } else {
        need.push(t);
      }
    });
    return need;
  }
  function markMetaDirty(t) { metaDirty.add(t); flushMetaSoon(); }
  var flushMetaSoon = debounce(function () {
    if (!metaDirty.size) return;
    var list = Array.from(metaDirty);
    metaDirty = new Set();
    idbOpen().then(function (db) {
      var tx = db.transaction('meta', 'readwrite'), store = tx.objectStore('meta');
      list.forEach(function (t) {
        var r = { sz: t.file.size, mt: t.file.lastModified };
        META_FIELDS.forEach(function (f) { r[f] = t[f]; });
        store.put(r, t.path);
        if (metaCache) metaCache.set(t.path, r);
      });
    }).catch(function () { /* ignore */ });
  }, 2500);
  function clearMetaCache() {
    return idbOpen().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').clear();
        tx.oncomplete = tx.onerror = function () { res(); };
      });
    }).catch(function () {}).then(function () { metaCache = new Map(); });
  }
  async function rescanFolders() {
    if (!hasFSA) { toast('Choose your music folder again to pick up new songs.'); openFolder(); return; }
    var list = (await idbGet('handles')) || [];
    if (!list.length) { openFolder(); return; }
    for (var i = 0; i < list.length; i++) {
      var p = 'prompt';
      try { p = await list[i].queryPermission({ mode: 'read' }); } catch (e) { /* ignore */ }
      if (p !== 'granted') { try { p = await list[i].requestPermission({ mode: 'read' }); } catch (e) { /* ignore */ } }
      if (p === 'granted') await scanHandle(list[i]);
    }
  }

  /* ------------------------------ offline + install ------------------------------ */
  var deferredPrompt = null, offlineReady = false;
  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    $('btnInstall').hidden = false;
    if (state.view === 'settings') renderSettings();
  });
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    $('btnInstall').hidden = true;
    toast('Tunebox installed — find it in your Dock or Launchpad.', 3500);
  });
  function installApp() {
    if (!deferredPrompt) {
      toast(IS_IOS ? 'In Safari, tap Share → Add to Home Screen.' : 'In Chrome, click the install icon at the right of the address bar.', 4000);
      return;
    }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () { deferredPrompt = null; $('btnInstall').hidden = true; });
  }
  $('btnInstall').addEventListener('click', installApp);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      offlineReady = !!navigator.serviceWorker.controller;
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'activated') {
            if (!offlineReady) toast('Tunebox now works offline ✓', 3000);
            offlineReady = true;
            if (state.view === 'settings') renderSettings();
          }
        });
      });
    }).catch(function () { /* offline mode unavailable */ });
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
    fullscreen: function () { showStage(!state.stage); },
    'np-lyrics': function () { toggleNpLyrics(); },
    eq: function () { toggleEqPanel(); },
    dj: function () { toggleDj(); },
    'dj-start': function () { toggleDj(); if (settings.dj && window.innerWidth < 1100) showStage(true); }
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
  function goToCurrentAlbum() { if (state.current) setView('album', state.current.albumKey); }
  $('stSub').addEventListener('click', goToCurrentAlbum);
  $('queueList').addEventListener('click', function (e) {
    var q = e.target.closest('.qrow');
    if (!q) return;
    state.qIndex = +q.getAttribute('data-q');
    loadTrack(state.byId.get(state.queue[state.qIndex]), true);
  });

  $('eqClose').addEventListener('click', function () { toggleEqPanel(false); });
  $('eqPresets').addEventListener('click', function (e) {
    var b = e.target.closest('[data-eq]');
    if (b) setEq(EQ_PRESETS[b.getAttribute('data-eq')].v);
  });
  buildEqBands();
  $('eqBands').addEventListener('input', function (e) {
    var i = e.target.getAttribute('data-band');
    if (i === null) return;
    var v = eq.slice();
    v[+i] = +e.target.value;
    setEq(v);
  });
  $('vibes').addEventListener('click', function (e) {
    var b = e.target.closest('[data-vibe]');
    if (b) setVibe(b.getAttribute('data-vibe'));
  });
  $('eqReset').addEventListener('click', function () {
    settings.preamp = 0;
    setVibe('normal');
    setEq(EQ_PRESETS.flat.v);
  });
  [['eqPreamp', 'preamp'], ['fxSpeed', 'speed'], ['fxReverb', 'reverb']].forEach(function (pair) {
    $(pair[0]).addEventListener('input', function () {
      settings[pair[1]] = +this.value;
      saveSettings();
      applyFx();
      renderEq();
    });
  });
  $('lyricsView').addEventListener('click', function (e) {
    var l = e.target.closest('.lyric-line');
    if (!l || !state.lyrics || !state.lyrics.synced) return;
    audio.currentTime = state.lyrics.lines[+l.getAttribute('data-li')].t;
    if (audio.paused) play();
  });
  $('tabQueue').addEventListener('click', function () { setInspTab('queue'); });
  $('tabLyrics').addEventListener('click', function () { setInspTab('lyrics'); });
  window.addEventListener('resize', throttle(updateWidthClasses, 150));
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
      if (vol === 0) setVolume(0.5); else setMuted(!muted);
    });
  });
  $$('.vol-range').forEach(function (r) {
    r.addEventListener('input', function () {
      setVolume(+this.value);
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
    else if (k === 'ArrowUp') { e.preventDefault(); setVolume(vol + 0.05); }
    else if (k === 'ArrowDown') { e.preventDefault(); setVolume(vol - 0.05); }
    else if (k === '/') { e.preventDefault(); ($('search').offsetParent ? $('search') : $('search2')).focus(); }
    else if (k === 's' || k === 'S') toggleShuffle();
    else if (k === 'r' || k === 'R') cycleRepeat();
    else if (k === 'm' || k === 'M') setMuted(!muted);
    else if (k === 'd' || k === 'D') toggleDj();
    else if (k === 'f' || k === 'F') COMMANDS.fullscreen();
    else if (k === 'i' || k === 'I') toggleInspector();
    else if (k === ',') setView('settings');
    else if (k === 'l' || k === 'L') toggleFav();
    else if (k === 'e' || k === 'E') toggleEqPanel();
    else if (k === 't' || k === 'T') toggleTheme();
    else if (k === 'Escape') { if (!$('eqPanel').hidden) toggleEqPanel(false); else if (state.stage) showStage(false); }
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
  updateWidthClasses();
  applyLook();
  updateDjUi();
  startViz();
  updateModes();
  updateNowPlaying();
  renderAll();
  checkRemembered();

  // exposed for debugging in the console
  window.Tunebox = {
    state: state, settings: settings,
    get audio() { return audio; },
    get graph() { return !!ac; },
    get fading() { return !!fade; }
  };
})();

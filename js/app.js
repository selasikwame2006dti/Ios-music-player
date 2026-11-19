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
  var IS_ANDROID = /Android/i.test(navigator.userAgent);
  var IS_PHONE = IS_IOS || IS_ANDROID;

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
  // one shared collator: building one per comparison made sorting big libraries ~20× slower
  var collator = window.Intl && Intl.Collator ? new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }) : null;
  function cmpStr(a, b) {
    return collator ? collator.compare(a, b) : a.localeCompare(b);
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
  // Background work (reading tags, saving songs) gives way to the music and the screen:
  // on phones it runs slower while a song plays, and pauses while the app is in the background.
  function sleepMs(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function breathe() {
    var playing = typeof audio !== 'undefined' && audio && !audio.paused;
    var ms = IS_PHONE ? (playing ? 60 : 12) : (playing ? 8 : 0);
    if (document.hidden) ms = Math.max(ms, IS_PHONE ? 400 : 50);
    if (window.requestIdleCallback && !document.hidden) {
      return new Promise(function (r) { setTimeout(function () { requestIdleCallback(function () { r(); }, { timeout: 300 }); }, ms); });
    }
    return sleepMs(ms);
  }

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

  function ingest(entries, rootName, opts) {
    opts = opts || {};
    var added = [], skippedDrm = 0, relinked = [];
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
      var have = state.byPath.get(e.path);
      if (have) {
        // same song seen again (drive plugged back in, or a fresh scan): point it at the new file
        if (have.file !== e.file) { have.file = e.file; }
        if (have.offline) { have.offline = false; relinked.push(have); }
        have.broken = false;
        if (opts.seen) opts.seen.add(e.path);
        continue;
      }
      if (opts.seen) opts.seen.add(e.path);
      var t = makeTrack(e.file, e.path, ext);
      computeAlbumKey(t);
      state.tracks.push(t);
      state.byId.set(t.id, t);
      state.byPath.set(t.path, t);
      added.push(t);
    }
    if (rootName && state.folders.indexOf(rootName) < 0) state.folders.push(rootName);
    if (relinked.length) {
      // covers looked up while the drive was away came back empty; look again
      relinked.forEach(function (t) { if (coverSync.get(t.albumKey) === null) { coverCache.delete(t.albumKey); coverSync.delete(t.albumKey); } });
    }
    if (opts.root && opts.seen) dropMissing(opts.root, opts.seen);
    invalidate();
    renderAll();
    if (skippedDrm) toast(plural(skippedDrm, 'copy-protected iTunes file') + ' (.m4p) skipped — browsers can’t play those.', 5000);
    if (!added.length && !skippedDrm && !opts.quiet && !relinked.length) toast(opts.rescan ? 'No new songs.' : 'No playable music found there.');
    if (added.length) {
      toast((opts.rescan || opts.quiet ? 'Found ' + plural(added.length, 'new song') : 'Added ' + plural(added.length, 'song')) + '.');
      loadMetaCache().then(function () {
        var need = applyCache(added);
        invalidate();
        renderAll(true);
        if (need.length) scanTags(need);
        else { setStatus(plural(state.tracks.length, 'song')); startDurations(); scheduleAnalysis(3000); }
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
  var refreshSoon = throttle(function () { invalidate(); renderAll(true); }, IS_PHONE ? 4000 : 1500); // redrawing the whole library is heavy on phones

  function scanTags(tracks) {
    tagQueue = tagQueue.concat(tracks);
    tagTotal += tracks.length;
    for (var i = tagRunning; i < (IS_PHONE ? 1 : 3); i++) tagWorker();
  }

  async function tagWorker() {
    tagRunning++;
    while (tagQueue.length) {
      var t = tagQueue.shift();
      if (t.offline) { tagDone++; continue; }
      await breathe();
      var m = await Meta.read(t.file, t.ext, false);
      if (m.duration && !t.duration) t.duration = m.duration;
      if (m.title) t.title = m.title;
      if (m.artist) t.artist = m.artist;
      if (m.album) t.album = m.album;
      if (m.albumArtist) t.albumArtist = m.albumArtist;
      if (m.track) t.track = m.track;
      if (m.disc) t.disc = m.disc;
      if (m.year) t.year = m.year;
      if (m.genre) t.genre = m.genre;
      if (m.bpm) t.bpm = m.bpm;
      if (typeof m.rg === 'number') t.rg = m.rg;
      applyEdit(t);
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
      scheduleAnalysis(3000);
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
    durQueue = state.tracks.filter(function (t) { return !t.duration && !t.broken && !t.offline; });
    if (!durRunning) durWorker();
  }
  async function durWorker() {
    durRunning = true;
    while (durQueue.length) {
      if (IS_PHONE && !audio.paused) { await sleepMs(4000); continue; }
      var t = durQueue.shift();
      if (t.duration || t.offline) continue;
      await breathe();
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
      if (coverActive < (IS_PHONE ? 1 : 2)) run(); else coverWaiting.push(run);
    });
  }

  function getCover(t) {
    if (!t) return Promise.resolve(null);
    var key = t.albumKey;
    if (coverCache.has(key)) return coverCache.get(key);
    if (t.offline && !(typeof coverEdits === 'object' && coverEdits && coverEdits[key])) return Promise.resolve(null);
    var p = limited(function () {
      if (typeof coverEdits === 'object' && coverEdits && coverEdits[key]) return processCover(coverEdits[key]);
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
    if (state.view === 'playlist') {
      var plIds = playlistIds(state.detail);
      if (state.sort.key === 'default') {
        state.list = plIds.filter(function (id) { var x = state.byId.get(id); return x && matches(x, tm); });
        return state.list;
      }
      var plSet = new Set(plIds);
    }
    ts = state.tracks.filter(function (t) {
      if (state.view === 'playlist' && !plSet.has(t.id)) return false;
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

  var VIEW_TITLES = { songs: 'Songs', albums: 'Albums', artists: 'Artists', queue: 'Up Next', favorites: 'Favourites', settings: 'Settings', stats: 'Listening Stats', playlists: 'Playlists', connect: 'Connect devices', remote: 'Remote' };
  var scroller = $('scroller');

  function isListView(v) { return v === 'songs' || v === 'queue' || v === 'album' || v === 'artist' || v === 'favorites' || v === 'playlist'; }
  var DETAIL_VIEWS = { album: 1, artist: 1, playlist: 1 };
  var PAGE_VIEWS = { settings: 1, stats: 1, playlists: 1, connect: 1, remote: 1 };
  function rowH() { return state.view === 'album' ? 48 : 56; }

  function setView(view, detail) {
    if (view === 'playing') { showStage(true); return; }
    if (view === 'album-current') { goToCurrentAlbum(); return; }
    if (DETAIL_VIEWS[view] && !DETAIL_VIEWS[state.view]) state.parentView = state.view;
    if (view === 'album' && state.view === 'artist') state.parentView = 'artist:' + state.detail;
    if (!DETAIL_VIEWS[view]) state.parentView = view;
    closeMenu();
    state.view = view;
    state.detail = detail === undefined ? null : detail;
    state.sort = { key: 'default', dir: 1 };
    state.selectedId = null;
    invalidate();
    state.stage = false;
    scroller.scrollTop = 0;
    renderAll();
    showStage(false);
    renderPlaylistNav();
  }

  function updateNavActive() {
    var view = state.view;
    var navView = view === 'album' ? 'albums' : view === 'artist' ? 'artists' : view === 'playlist' ? 'playlists' : view;
    if (view === 'album' && state.parentView.indexOf('artist') === 0) navView = 'artists';
    if (state.stage) navView = 'playing';
    $$('.nav-item[data-view], .tabbar [data-view]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === navView); });
  }

  function showStage(on) {
    state.stage = !!on && !!state.current;
    $('npStage').hidden = !state.stage;
    document.body.classList.toggle('stage-on', state.stage);
    if (!state.stage) restoreLyrics();
    else { lyricIdx = -1; updateLyricHighlight(); lyricLoop(); }
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
    var isSet = !!PAGE_VIEWS[state.view];
    $('npStage').hidden = !state.stage;
    $('noFolders').hidden = state.folders.length > 0 || has;
    $('settingsView').hidden = state.view !== 'settings';
    $('statsView').hidden = state.view !== 'stats';
    $('playlistGrid').hidden = state.view !== 'playlists';
    $('connectView').hidden = state.view !== 'connect';
    $('remoteView').hidden = state.view !== 'remote';
    document.body.classList.toggle('view-remote', state.view === 'remote');
    if (state.view !== 'remote') { var rv = $('remoteView'); if (rv.firstChild) rv.innerHTML = ''; }
    $('empty').hidden = has || isSet;
    $('hero').hidden = !has && !isSet;
    $('btnClear').hidden = !has;
    $('countSongs').textContent = has ? state.tracks.length : '';
    $('countAlbums').textContent = has ? getAlbums().length : '';
    $('countArtists').textContent = has ? getArtists().length : '';
    renderFolderList();

    var v = state.view;
    $('songList').hidden = !has || !isListView(v);
    $('songList').classList.toggle('compact', v === 'album');
    $('albumGrid').hidden = !has || v !== 'albums';
    $('artistGrid').hidden = !has || v !== 'artists';
    $('btnBack').hidden = !DETAIL_VIEWS[v];
    $('search').disabled = $('search2').disabled = v === 'queue';
    $('countFavs').textContent = has && favCount() ? favCount() : '';

    if (!has && !isSet) { $('noResults').hidden = true; return; }
    renderHero(soft);
    if (isSet) {
      if (v === 'settings' && !soft) { renderSettings(); updateStorageText(); }
      if (v === 'stats' && !soft) renderStats();
      if (v === 'playlists') renderPlaylists();
      if (v === 'connect') renderConnect();
      if (v === 'remote') renderRemote();
      $('noResults').hidden = true;
      return;
    }
    if (isListView(v)) { renderHead(); renderRows(); }
    else if (v === 'albums') { if (!soft || !$('albumGrid').childElementCount) renderAlbums(); }
    else if (v === 'artists') { if (!soft || !$('artistGrid').childElementCount) renderArtists(); }
    updateNoResults();
  }

  function heroActions(extra) {
    return '<div class="hero-actions">' +
      '<button class="play-btn" data-cmd="play-view" title="Play">' + ICON_PLAY + '</button>' +
      '<button class="btn ghost" data-cmd="shuffle-view">' + ICON_SHUFFLE + 'Shuffle</button>' +
      '<button class="btn ghost dj-hero" data-cmd="dj-start"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/></svg>DJ</button>' +
      (extra || '') +
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
        '<div class="hero-meta" id="heroMeta"></div>' + heroActions('<button class="btn ghost" data-cmd="edit-album">Edit album</button>') + '</div>';
    } else if (v === 'playlist') {
      var smart = state.detail && state.detail.indexOf('smart:') === 0;
      title = playlistName(state.detail);
      html = '<div class="hero-art cover" id="heroArt"></div>' +
        '<div class="hero-text"><div class="eyebrow">' + (smart ? 'Smart playlist' : 'Playlist') + '</div><h1>' + esc(title) + '</h1>' +
        '<div class="hero-meta" id="heroMeta"></div>' +
        heroActions(smart ? '' : '<button class="btn ghost" data-cmd="pl-rename">Rename</button><button class="btn ghost" data-cmd="pl-delete">Delete</button>') + '</div>';
    } else if (v === 'artist') {
      title = state.detail;
      html = '<div class="hero-art cover round" id="heroArt"></div>' +
        '<div class="hero-text"><div class="eyebrow">Artist</div><h1>' + esc(state.detail) + '</h1>' +
        '<div class="hero-meta" id="heroMeta"></div>' + heroActions() + '</div>';
    } else {
      title = VIEW_TITLES[v];
      html = '<div class="hero-text"><h1>' + title + '</h1><div class="hero-meta" id="heroMeta"></div>' +
        (v === 'songs' || v === 'favorites' ? heroActions() : '') +
        (v === 'playlists' ? '<div class="hero-actions"><button class="btn primary" data-cmd="new-playlist">+ New playlist</button><button class="btn ghost" data-cmd="sync">Send to another device</button></div>' : '') +
        (v === 'stats' ? '<div class="hero-actions"><button class="btn ghost" data-view="playlist" data-detail="smart:most">Most Played</button><button class="btn ghost" data-view="playlist" data-detail="smart:recent">Recently Played</button></div>' : '') +
        '</div>';
    }
    $('topTitle').textContent = title;
    if (!(soft && heroKey === key)) {
      hero.innerHTML = html;
      heroKey = key;
      var art = $('heroArt');
      if (art && v === 'album') { var a = currentAlbum(); paintCover(art, a.tracks[0], a.name); }
      if (art && v === 'playlist') {
        var pids = getList(), pf = pids.length ? state.byId.get(pids[0]) : null;
        if (pf) paintCover(art, pf, pf.album); else art.innerHTML = coverInner(null, title);
      }
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
      } else if (v === 'playlist') {
        var sm = state.detail && state.detail.indexOf('smart:') === 0 ? SMART[state.detail.slice(6)] : null;
        txt = (sm ? sm.desc + ' · ' : '') + (ids.length ? songs : (sm ? 'Nothing here yet — keep listening.' : 'Empty — right-click any song and choose Add to playlist.'));
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
    } else if (v === 'playlists') {
      txt = plural(playlists.length, 'playlist') + ' · plus 4 smart playlists that update themselves';
    } else if (v === 'stats') {
      txt = 'Everything is counted on this device only.';
    } else if (v === 'connect') {
      txt = 'Use your phone as a remote, send songs, keep playlists in sync, or let friends add songs. Works over Wi-Fi, a phone hotspot, or the internet.';
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
      var cls = 'row' + (t.id === cur ? ' playing' : '') + (t.id === state.selectedId ? ' sel' : '') + (t.broken ? ' broken' : '') + (t.offline ? ' offline' : '');
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
        '<div class="c-time"><span class="tm">' + (t.duration ? fmtTime(t.duration) : '') + '</span><button class="rm" data-act="more" title="More"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4m6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4m6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4"/></svg></button></div>' +
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
    var f = typeof sleepFactor === 'number' ? sleepFactor : 1;
    if (masterGain) {
      decks.forEach(function (d) { d.volume = 1; d.muted = false; });
      masterGain.gain.setTargetAtTime(muted ? 0 : vol * f, ac.currentTime, 0.05);
      return;
    }
    decks.forEach(function (d) { if (!fade || d !== fade.from) d.volume = vol * f; d.muted = muted; });
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
  // We track each deck's level ourselves: reading gain.value right after scheduling a change
  // returns the old value, which made the incoming song fade *down* to silence (the "next song
  // plays but you can't hear it" bug).
  var deckLevel = [1, 1];
  function rampDeck(idx, target, secs, curve) {
    if (!deckGains) return;
    var g = deckGains[idx].gain, now = ac.currentTime, from = deckLevel[idx];
    deckLevel[idx] = target;
    g.cancelScheduledValues(now);
    if (!secs || from === target) { g.setValueAtTime(target, now); return; }
    if (curve && g.setValueCurveAtTime) {
      var n = 64, arr = new Float32Array(n);
      for (var i = 0; i < n; i++) {
        var x = i / (n - 1);
        // equal-power curves keep the loudness steady through the blend
        arr[i] = target > from ? from + (target - from) * Math.sin(x * Math.PI / 2)
                               : target + (from - target) * Math.cos(x * Math.PI / 2);
      }
      try { g.setValueCurveAtTime(arr, now, secs); return; } catch (e) { g.cancelScheduledValues(now); }
    }
    g.setValueAtTime(from, now);
    g.linearRampToValueAtTime(target, now + secs);
  }
  // safety net: whenever the active deck is playing and no blend is running, it must be audible
  function ensureAudible() {
    if (!deckGains || fade || pauseTimer) return;
    if (deckLevel[active] < 1 || deckGains[active].gain.value < 0.5) rampDeck(active, 1, 0.15);
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
    setTrim(idx, t);
  }

  function notifyTrack(t) {
    if (!settings.notify || !document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    var opts = { body: t.artist + ' — ' + t.album, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'tunebox-now', silent: true, renotify: false };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(function (reg) { reg.showNotification(t.title, opts); }).catch(function () {});
    } else {
      try { new Notification(t.title, opts); } catch (e) { /* not allowed here */ }
    }
  }
  function trackStarted(t, prev) {
    notifyTrack(t);
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
    if (t.offline) {
      var root = rootOf(t), path = t.path;
      if (t.offline === 'locked') {
        unlockFolder(root).then(function (ok) { var nt = ok && state.byPath.get(path); if (nt && !nt.offline) loadTrack(nt, autoplay, startAt); });
        return;
      }
      toast('“' + root + '” isn’t connected — skipping its songs.', 2200);
      var ni = nextIndex();
      if (ni >= 0 && ni !== state.qIndex) { state.qIndex = ni; loadTrack(state.byId.get(state.queue[ni]), autoplay); }
      return;
    }
    cancelFade();
    resetGapless();
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
    if (!t || t.offline) return false;
    cancelFade();
    var fromIdx = active, toIdx = 1 - active, from = decks[fromIdx], to = decks[toIdx];
    var prev = state.current;
    if (preloaded && preloaded.deck === toIdx && preloaded.id === t.id) setTrim(toIdx, t);
    else setDeckSource(toIdx, t);
    resetGapless();
    to.volume = masterGain ? 1 : 0;
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
        var sf = typeof sleepFactor === 'number' ? sleepFactor : 1;
        from.volume = vol * sf * Math.cos(x * Math.PI / 2);
        to.volume = vol * sf * Math.sin(x * Math.PI / 2);
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
    if (ac && outputChanged) restartOutput();
    else if (ac && ac.state === 'suspended') ac.resume();
    if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
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
      var di = active;
      pauseTimer = setTimeout(function () { pauseTimer = null; d.pause(); rampDeck(di, 1, 0); }, 220);
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

  function playableAt(i) { var t = state.byId.get(state.queue[i]); return !!t && !t.offline; }
  function nextIndex() {
    djFill();
    var i = state.qIndex + 1;
    while (i < state.queue.length && !playableAt(i)) i++;
    if (i < state.queue.length) return i;
    if (state.repeat === 'all' && state.queue.length) {
      if (state.shuffle) shuffleArr(state.queue);
      for (var j = 0; j < state.queue.length; j++) if (playableAt(j)) return j;
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
    if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing'; } catch (e) { /* ignore */ } }
    startViz();
  }

  function maybeAutoCrossfade() {
    var xf = crossfadeSecs();
    if (!xf || fade || seeking || state.repeat === 'one' || audio.paused || (sleep && sleep.mode === 'song')) return;
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
    d.addEventListener('playing', function () {
      if (this !== audio) return;
      errorStreak = 0;
      if (ac && ac.state === 'suspended') ac.resume();
      ensureAudible();
    });
    d.addEventListener('ended', function () {
      if (this !== audio) return;
      if (sleep && sleep.mode === 'song') { finishSleep(); return; }
      next(true);
    });
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
      updateTime(); updateLyricHighlight(); sampleStats(); listenTick(); ensureAudible(); maybeAutoCrossfade(); saveLastSoon();
    });
    d.addEventListener('seeked', function () { if (this === audio) { lyricIdx = -1; updateLyricHighlight(); } });
    ['play', 'pause', 'seeked', 'ratechange', 'loadedmetadata'].forEach(function (ev) { d.addEventListener(ev, function () { if (this === audio) lastPosState = 0; }); });
    d.addEventListener('error', function () {
      if (this !== audio) return;
      var t = state.current;
      if (!t || !audio.getAttribute('src')) return;
      var dk = this;
      checkSourceGone(t).then(function (gone) {
        if (dk !== audio || state.current !== t) return;
        if (gone) { renderRows(); next(false); return; }
        cantPlay(t);
      });
    });
  });
  function cantPlay(t) {
      t.broken = true;
      renderRows();
      errorStreak++;
      toast('Can’t play “' + t.title + '” in this browser' + (t.ext === 'aiff' || t.ext === 'aif' || t.ext === 'caf' ? ' (try Safari for AIFF/ALAC).' : '.'));
      if (errorStreak < 5) next(false); else { errorStreak = 0; pause(); }
  }

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
      if (c.broken || c.offline || queued.has(c.id)) continue;
      var sc = Math.random() * (1 + variety * 4);
      if (recent.has(c.path)) sc -= 40;
      if (ref) {
        var ca = artistOf(c).toLowerCase(), ra = artistOf(ref).toLowerCase();
        if (c.genre && ref.genre) sc += c.genre.toLowerCase() === ref.genre.toLowerCase() ? 4 * (1.2 - variety) : -1 * (1 - variety);
        if (lastArtists.indexOf(ca) >= 0 && settings.djArtistGap !== false) sc -= 8;
        else if (ca === ra) sc += 1.5 * (1 - variety);
        if (c.year && ref.year) sc += 2.5 * Math.exp(-Math.abs(c.year - ref.year) / 6);
        if (c.bpm > 0 && ref.bpm > 0) sc += 2.5 * Math.exp(-Math.abs(c.bpm - ref.bpm) / 10);
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

  var lastPosState = 0;
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
    var nowMs = Date.now();
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && d && isFinite(d) && (nowMs - lastPosState > 4000 || seeking)) {
      lastPosState = nowMs;
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
    var appArt = [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }];
    if (ms && window.MediaMetadata) { try { ms.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: appArt }); } catch (e) { /* ignore */ } }
    getCover(t).then(function (c) { return c ? coverForSession(c.url) : null; }).then(function (art) {
      if (state.current !== t || !ms || !window.MediaMetadata || !art) return;
      try { ms.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: [{ src: art, sizes: '512x512', type: 'image/jpeg' }] }); } catch (e) { /* ignore */ }
    });
    if (!(state.view === 'album' || state.view === 'artist')) applyViewTint();
  }

  // lock screens and notification shades can't always read blob: links, so hand them a small JPEG
  function coverForSession(url) {
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () {
        try {
          var cv = document.createElement('canvas'), n = Math.min(512, Math.max(img.naturalWidth, 96));
          cv.width = cv.height = n;
          cv.getContext('2d').drawImage(img, 0, 0, n, n);
          res(cv.toDataURL('image/jpeg', 0.85));
        } catch (e) { res(url); }
      };
      img.onerror = function () { res(null); };
      img.src = url;
    });
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
  function isFav(t) { return !!favs[t.path] || !!(favKeys && favKeys.size && favKeys.has(trackKey(t))); }
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
    if (typeof toggleFavFor === 'function') { toggleFavFor(t); return; }
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
  var ac = null, eqNodes = null, analyser = null, freq = null, deckGains = null, trims = null, masterGain = null, leveller = null, levelMakeup = null;
  var preampNode = null, dryNode = null, wetNode = null, limiter = null, convNode = null, eqOut = null, convOn = false;
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
    if (ac || IS_IOS || settings.webAudio === false) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      try { ac = new AC({ latencyHint: 'playback' }); } catch (e0) { ac = new AC(); }
      preampNode = ac.createGain();
      trims = [];
      deckGains = decks.map(function (d, i) {
        var src = ac.createMediaElementSource(d), tr = ac.createGain(), g = ac.createGain();
        src.connect(tr);
        tr.connect(g);
        g.connect(preampNode);
        trims[i] = tr;
        return g;
      });
      eqNodes = EQ_BANDS.map(function (b) {
        var n = ac.createBiquadFilter();
        n.type = b.type;
        n.frequency.value = b.f;
        if (b.type === 'peaking') n.Q.value = 1.4;
        return n;
      });
      // optional "smooth out loudness" compressor between the boost and the EQ
      leveller = ac.createDynamicsCompressor();
      leveller.threshold.value = -26; leveller.knee.value = 14; leveller.ratio.value = 3.5;
      leveller.attack.value = 0.01; leveller.release.value = 0.35;
      levelMakeup = ac.createGain();
      levelMakeup.gain.value = 1.7;
      leveller.connect(levelMakeup);
      levelMakeup.connect(eqNodes[0]);
      var node = eqNodes[0];
      eqNodes.slice(1).forEach(function (n) { node.connect(n); node = n; });
      routeLeveller();
      dryNode = ac.createGain();
      wetNode = ac.createGain();
      // the reverb is heavy work, so it's only wired in while it's actually turned up
      convNode = ac.createConvolver();
      convNode.buffer = makeImpulse(2.8, 2.4);
      eqOut = node;
      node.connect(dryNode);
      convNode.connect(wetNode);
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
      masterGain = ac.createGain();
      limiter.connect(analyser);
      analyser.connect(masterGain);
      masterGain.connect(ac.destination);
      // keep audio flowing in the background: if the system pauses the audio engine, wake it again
      ac.onstatechange = function () { if (ac.state !== 'running' && !audio.paused) ac.resume(); };
      watchOutput();
      applyEq();
      applyFx();
      applyVolumeToDecks();
      if (state.current) setTrim(active, state.current);
      if (settings.sinkId && ac.setSinkId) ac.setSinkId(settings.sinkId).catch(function () {});
    } catch (e) {
      ac = null; eqNodes = null; analyser = null; deckGains = null; trims = null; masterGain = null;
    }
  }
  // When headphones/Bluetooth connect or disconnect, phones move the sound to another output.
  // Restarting the audio engine there stops it from stuttering on the new output.
  var outputChanged = false, outputWatched = false, lastDeviceChange = 0;
  function watchOutput() {
    if (outputWatched || !navigator.mediaDevices || !navigator.mediaDevices.addEventListener) return;
    outputWatched = true;
    navigator.mediaDevices.addEventListener('devicechange', function () {
      outputChanged = true;
      lastDeviceChange = Date.now();
      setTimeout(function () { if (!audio.paused) restartOutput(); }, 600);
    });
  }
  function restartOutput() {
    outputChanged = false;
    if (!ac) return Promise.resolve();
    return ac.suspend().catch(function () {}).then(function () {
      return new Promise(function (r) { setTimeout(r, 120); });
    }).then(function () { return ac.resume(); }).catch(function () {});
  }
  // a stutter check: if the audio clock falls behind real time, the output is struggling
  var clockCheck = { at: 0, t: 0, bad: 0, fixes: [] };
  setInterval(function () {
    // only right after headphones/Bluetooth change: under heavy load a restart would only add glitches
    if (!ac || audio.paused || ac.state !== 'running' || Date.now() - lastDeviceChange > 90000) { clockCheck.at = 0; return; }
    var now = performance.now() / 1000, t = ac.currentTime;
    if (clockCheck.at) {
      var real = now - clockCheck.at, got = t - clockCheck.t;
      if (real > 0.5 && got < real * 0.85) clockCheck.bad++; else clockCheck.bad = 0;
      if (clockCheck.bad >= 2) {
        clockCheck.bad = 0;
        clockCheck.fixes = clockCheck.fixes.filter(function (x) { return now - x < 120; });
        clockCheck.fixes.push(now);
        restartOutput();
        if (clockCheck.fixes.length === 3) toast('Sound keeps stuttering on this device. If it continues, turn off Settings → App → Sound effects engine.', 6000);
      }
    }
    clockCheck.at = now;
    clockCheck.t = t;
  }, 1000);

  function routeLeveller() {
    if (!preampNode || !leveller) return;
    try { preampNode.disconnect(); } catch (e) { /* ignore */ }
    preampNode.connect(settings.compress ? leveller : eqNodes[0]);
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
    if (r > 0 && !convOn) { eqOut.connect(convNode); convOn = true; }
    else if (r <= 0 && convOn) { try { eqOut.disconnect(convNode); } catch (e) { /* ignore */ } convOn = false; }
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
  var vizGrad = null, vizGradAt = 0;
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
      if (vizFrame - vizGradAt > 60 || !vizGrad) {
        var cs = getComputedStyle(document.documentElement);
        vizGrad = vctx.createLinearGradient(0, 0, w, 0);
        vizGrad.addColorStop(0, 'rgb(' + cs.getPropertyValue('--tint').trim() + ')');
        vizGrad.addColorStop(1, 'rgb(' + cs.getPropertyValue('--tint2').trim() + ')');
        vizGradAt = vizFrame;
      }
      vctx.fillStyle = vizGrad;
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
  document.addEventListener('visibilitychange', function () {
    if (ac && ac.state !== 'running' && !audio.paused) ac.resume();
    if (!document.hidden) startViz();
  });

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
  // Lyrics: plain text, synced .lrc lines, or "enhanced" .lrc with a time for every word
  // ([00:12.30]<00:12.30>Hello <00:12.80>world). When a file only has line times, each word's
  // timing is estimated from the line's length so the words still light up as they're sung.
  function parseLyrics(text) {
    var lines = [], plain = [], offset = 0;
    var om = /\[offset:\s*([+-]?\d+)\s*\]/i.exec(text);
    if (om) offset = parseInt(om[1], 10) / 1000;
    var tsRe = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
    text.replace(/\r/g, '').split('\n').forEach(function (l) {
      l = l.trim();
      var m = /^((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+)(.*)$/.exec(l);
      if (m) {
        var body = m[2].trim(), tm;
        tsRe.lastIndex = 0;
        while ((tm = tsRe.exec(m[1]))) lines.push({ t: Math.max(0, parseInt(tm[1], 10) * 60 + parseFloat(tm[2].replace(':', '.')) - offset), raw: body });
      } else if (!/^\[[a-z]+:.*\]$/i.test(l)) {
        plain.push(l);           // skip [ar:…] style header tags
      }
    });
    if (!lines.length) {
      while (plain.length && !plain[0]) plain.shift();
      return plain.length ? { lines: plain.map(function (x) { return { t: 0, text: x, words: null }; }), synced: false } : null;
    }
    lines.sort(function (a, b) { return a.t - b.t; });
    // a line lasts until the next time stamp (an empty timed line marks the end of singing)
    lines.forEach(function (ln, i) { ln.end = i + 1 < lines.length ? lines[i + 1].t : ln.t + 6; });
    var out = [];
    lines.forEach(function (ln) {
      var words = [], wr = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>([^<]*)/g, wm, exact = false;
      if (/<\d{1,3}:\d{1,2}/.test(ln.raw)) {
        while ((wm = wr.exec(ln.raw))) {
          var wt = parseInt(wm[1], 10) * 60 + parseFloat(wm[2].replace(':', '.')) - offset;
          if (wm[3]) words.push({ t: wt, w: wm[3] }); else if (words.length) words[words.length - 1].stop = wt;
        }
        exact = words.length > 0;
      }
      var txt = exact ? words.map(function (w) { return w.w; }).join('').replace(/\s+/g, ' ').trim() : ln.raw.replace(/<[^>]*>/g, '').trim();
      if (!txt) return;
      if (exact) {
        words.forEach(function (w, i) { w.d = Math.max(0.08, (w.stop || (i + 1 < words.length ? words[i + 1].t : ln.end)) - w.t); });
        words = words.filter(function (w) { return w.w.trim(); });
      } else {
        words = estimateWords(txt, ln.t, ln.end);
      }
      out.push({ t: ln.t, end: ln.end, text: txt, words: words, exact: exact });
    });
    return out.length ? { lines: out, synced: true } : null;
  }
  function estimateWords(txt, t0, t1) {
    var parts = txt.split(/\s+/).filter(Boolean);
    var span = Math.max(0.6, t1 - t0);
    // most singers finish a line before the next starts; long gaps are held notes or breaks
    var sung = Math.min(span * 0.88, parts.length * 0.7 + 0.8);
    var weights = parts.map(function (w) { return w.replace(/[^\wÀ-￿]/g, '').length + 2; });
    var total = weights.reduce(function (a, b) { return a + b; }, 0), at = t0;
    return parts.map(function (w, i) {
      var d = sung * weights[i] / total, o = { t: at, d: d, w: w };
      at += d;
      return o;
    });
  }
  function loadLyrics(t) {
    state.lyrics = null;
    lyricIdx = -1;
    renderLyrics();
    var key = t.path.replace(/\.[^.\/]+$/, '').toLowerCase();
    var lrc = state.lrcFiles.get(key);
    var p = lrc ? readText(lrc) : t.offline ? Promise.resolve('') : Meta.read(t.file, t.ext, true).then(function (m) { return m.lyrics; });
    p.then(function (txt) {
      if (state.current !== t) return;
      state.lyrics = txt ? parseLyrics(txt) : null;
      renderLyrics();
      if (!state.lyrics || !state.lyrics.synced) noLocalLyrics(t);
    }).catch(function () { if (state.current === t) noLocalLyrics(t); });
  }

  var lyricIdx = -1, askedLyricsThisVisit = false;
  function wordsOn() { return settings.lyricWords !== false; }
  function lineHtml(l, i, cls) {
    var inner;
    if (l.words && wordsOn()) {
      inner = l.words.map(function (w, j) { return '<span class="lw" data-w="' + j + '">' + esc(w.w.trim()) + '</span>'; }).join(' ');
    } else inner = esc(l.text);
    return '<div class="' + cls + '" data-li="' + i + '">' + inner + '</div>';
  }
  // the same lyrics are shown in up to three places: the side panel, the live line in
  // full screen, and the big full-screen lyrics view
  function lyricBoxes() { return [$('lyricsView'), $('npvLyrics')]; }
  function renderLyrics() {
    var L = state.lyrics;
    var has = !!(L && L.lines.length);
    $('npStage').classList.toggle('has-lyrics', has);
    $('npStage').classList.toggle('lyrics-synced-on', has && L.synced);
    $('lyrExpand').hidden = !has || state.inspTab !== 'lyrics';
    // ask once whether to look up timed lyrics online (sends only song names to LRCLIB)
    $('npvAsk').hidden = !(state.current && settings.lyricsOnline === undefined && !askedLyricsThisVisit && navigator.onLine !== false && !(has && L.synced));
    lyricBoxes().forEach(function (v, n) {
      var big = n === 1;
      if (!state.current) { v.innerHTML = '<div class="insp-empty">Play a song to see its lyrics.</div>'; return; }
      if (!has) {
        v.className = big ? 'npv-lyrics' : 'lyrics-box';
        v.innerHTML = '<div class="insp-empty">No lyrics for this song.' +
          '<div class="lyr-find"><button class="btn small primary" data-lyr="online">Find lyrics online</button>' + (lyricsOnlineAuto() ? '' : '<button class="btn small" data-lyr="always">Always look online</button>') + '</div>' +
          '<small>Sends only the song’s title, artist and length to lrclib.net. Or put a <code>.lrc</code> file with the same name next to the song.</small></div>';
        return;
      }
      v.className = (big ? 'npv-lyrics' : 'lyrics-box') + (L.synced ? ' lyrics-synced' : ' lyrics-plain');
      v.innerHTML = (big ? '<div class="lyr-pad"></div>' : '') + L.lines.map(function (l, i) {
        return l.text ? lineHtml(l, i, 'lyric-line') : '<div class="lyric-gap"></div>';
      }).join('') + (big ? '<div class="lyr-pad end"></div>' : '') +
        (L.synced ? '' : '<div class="lyr-note">These lyrics aren’t timed, so they scroll with the song. <button class="link-btn" data-lyr="online">Find timed lyrics online</button></div>') +
        (L.online ? '<div class="lyr-note">Lyrics from LRCLIB</div>' : '');
    });
    renderLiveLine(-1);
    lyricIdx = -1;
    lastWordKey = '';
    updateLyricHighlight();
    lyricLoop();
  }
  // the live line in full screen: the line being sung now, with the next one underneath
  function renderLiveLine(idx) {
    var box = $('npvLive'), L = state.lyrics;
    if (!L || !L.lines.length) { box.innerHTML = ''; return; }
    if (!L.synced) { box.innerHTML = ''; box.setAttribute('data-idx', 'plain'); return; }
    var cur = idx >= 0 ? L.lines[idx] : null, nx = L.lines[idx + 1];
    var t = audio.currentTime;
    var resting = !cur || (t > cur.end - 0.05 && nx && nx.t - t > 3);
    box.innerHTML = (resting
      ? '<div class="live-cur rest"><span class="dots"><i></i><i></i><i></i></span></div>'
      : lineHtml(cur, idx, 'live-cur')) +
      (nx ? '<div class="live-next">' + esc(nx.text) + '</div>' : '<div class="live-next"></div>');
    box.setAttribute('data-idx', idx + (resting ? 'r' : ''));
  }
  function currentLineIndex(t) {
    var L = state.lyrics, lo = 0, hi = L.lines.length - 1, idx = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (L.lines[mid].t <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    return idx;
  }
  var lastWordKey = '', userScrolledAt = 0;
  function updateLyricHighlight() {
    var L = state.lyrics;
    if (!L) return;
    var boxes = lyricBoxes();
    if (!L.synced) { scrollPlain(boxes); return; }
    var t = audio.currentTime + 0.12, idx = currentLineIndex(t);
    var live = $('npvLive'), cur = idx >= 0 ? L.lines[idx] : null, nx = L.lines[idx + 1];
    var resting = !cur || (t > cur.end - 0.05 && nx && nx.t - t > 3);
    if (live.getAttribute('data-idx') !== idx + (resting ? 'r' : '')) renderLiveLine(idx);
    if (idx !== lyricIdx) {
      boxes.forEach(function (v) {
        if (!boxShown(v)) { v.__stale = true; return; }
        v.__stale = false;
        Array.prototype.slice.call(v.querySelectorAll('.lyric-line.active')).forEach(function (el) { el.classList.remove('active', 'near'); });
        Array.prototype.slice.call(v.querySelectorAll('.lyric-line.past')).forEach(function (el) { if (+el.getAttribute('data-li') >= idx) el.classList.remove('past'); });
        if (idx >= 0) {
          var el = v.querySelector('.lyric-line[data-li="' + idx + '"]');
          if (el) {
            el.classList.add('active');
            for (var p = el.previousElementSibling; p && !p.classList.contains('past'); p = p.previousElementSibling) p.classList.add('past');
            scrollToLine(v, el, v.id === 'npvLyrics' ? 0.38 : 0.42);
          }
        }
      });
      lyricIdx = idx;
      lastWordKey = '';
    }
    paintWords(boxes.concat([live]).filter(boxShown), cur, t);
  }
  function paintWords(boxes, cur, t) {
    if (!cur || !cur.words || !wordsOn()) return;
    var wi = -1, prog = 0;
    for (var i = 0; i < cur.words.length; i++) {
      var w = cur.words[i];
      if (t >= w.t) { wi = i; prog = Math.min(1, (t - w.t) / w.d); } else break;
    }
    var key = lyricIdx + ':' + wi + ':' + (prog >= 1 ? 1 : 0);
    var changed = key !== lastWordKey;
    lastWordKey = key;
    boxes.forEach(function (v) {
      var line = v.id === 'npvLive' ? v.querySelector('.live-cur') : v.querySelector('.lyric-line.active');
      if (!line) return;
      var spans = line.__spans || (line.__spans = line.querySelectorAll('.lw'));
      if (changed || line.__wi === undefined) {
        for (var j = 0; j < spans.length; j++) {
          spans[j].classList.toggle('sung', j < wi || (j === wi && prog >= 1));
          spans[j].classList.toggle('now', j === wi && prog < 1);
          if (j !== wi) spans[j].style.removeProperty('--p');
        }
        line.__wi = wi;
      }
      if (wi >= 0 && prog < 1 && spans[wi]) spans[wi].style.setProperty('--p', (prog * 100).toFixed(1) + '%');
    });
  }
  function scrollToLine(v, el, at) {
    if (v.hidden || !v.offsetParent || Date.now() - userScrolledAt < 3500) return;
    var top = el.offsetTop - v.clientHeight * at + el.clientHeight / 2;
    try { v.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); } catch (e) { v.scrollTop = Math.max(0, top); }
  }
  // untimed lyrics drift down the page as the song plays
  function scrollPlain(boxes) {
    var d = audio.duration;
    if (!d || audio.paused || Date.now() - userScrolledAt < 5000) return;
    boxes.forEach(function (v) {
      if (v.hidden || !v.offsetParent) return;
      var max = v.scrollHeight - v.clientHeight;
      if (max > 0) v.scrollTop = max * Math.min(1, Math.max(0, (audio.currentTime - 8) / (d - 20)));
    });
  }
  // smooth word fill while lyrics are on screen and music is playing
  var lyricRaf = 0;
  function lyricsVisible() {
    if (!state.lyrics || !state.lyrics.synced) return false;
    return (state.stage && (state.lyricsMode || $('npStage').classList.contains('has-lyrics'))) || (!$('lyricsView').hidden && !!$('lyricsView').offsetParent);
  }
  // ~30 updates a second is plenty for smooth word fill, and half the work of every frame
  var lyricLast = 0;
  function lyricLoop() {
    if (lyricRaf || audio.paused || !lyricsVisible() || !wordsOn()) return;
    lyricRaf = requestAnimationFrame(function step(now) {
      if (now - lyricLast >= (IS_PHONE ? 40 : 30)) { lyricLast = now; updateLyricHighlight(); }
      if (!audio.paused && lyricsVisible() && !document.hidden) lyricRaf = requestAnimationFrame(step);
      else lyricRaf = 0;
    });
  }
  function boxShown(v) { return !v.hidden && !!v.offsetParent; }
  decks.forEach(function (d) { d.addEventListener('play', function () { if (this === audio) lyricLoop(); }); });
  ['wheel', 'touchmove'].forEach(function (ev) {
    lyricBoxes().forEach(function (v) { v.addEventListener(ev, function () { userScrolledAt = Date.now(); }, { passive: true }); });
  });
  // big lyrics view on the full-screen player
  function setLyricsMode(on) {
    state.lyricsMode = !!on && !!state.current;
    $('npStage').classList.toggle('lyrics-mode', state.lyricsMode);
    $$('[data-cmd="np-lyrics"]').forEach(function (b) { b.classList.toggle('on', state.lyricsMode); });
    if (state.lyricsMode) {
      userScrolledAt = 0;
      lyricIdx = -1;
      updateLyricHighlight();
      if (!state.lyrics || !state.lyrics.synced) $('npvLyrics').scrollTop = 0;
      lyricLoop();
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
  function restoreLyrics() { setLyricsMode(false); }
  function toggleNpLyrics() {
    if (!state.stage) { showStage(true); setLyricsMode(true); return; }
    setLyricsMode(!state.lyricsMode);
  }
  function setInspTab(tab) {
    state.inspTab = tab;
    $('tabQueue').classList.toggle('on', tab === 'queue');
    $('tabLyrics').classList.toggle('on', tab === 'lyrics');
    $('queueView').hidden = tab !== 'queue';
    $('lyricsView').hidden = tab !== 'lyrics';
    $('lyrExpand').hidden = tab !== 'lyrics' || !state.lyrics;
    $('seeAllQueue').hidden = tab === 'lyrics';
    if (tab === 'lyrics') { userScrolledAt = 0; lyricIdx = -1; updateLyricHighlight(); lyricLoop(); }
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
      seekbackward: function (d) { audio.currentTime = Math.max(0, audio.currentTime - ((d && d.seekOffset) || 10)); lastPosState = 0; updateTime(); },
      seekforward: function (d) { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + ((d && d.seekOffset) || 10)); lastPosState = 0; updateTime(); },
      seekto: function (d) { if (d && typeof d.seekTime === 'number') { if (d.fastSeek && audio.fastSeek) audio.fastSeek(d.seekTime); else audio.currentTime = d.seekTime; lastPosState = 0; updateTime(); } },
      stop: function () { pause(); }
    };
    Object.keys(handlers).forEach(function (k) {
      try { ms.setActionHandler(k, handlers[k]); } catch (e) { /* unsupported action */ }
    });
  }

  /* ------------------------------ opening files ------------------------------ */

  var hasFSA = typeof window.showDirectoryPicker === 'function';

  async function openFolder() {
    if (IS_IOS) { $('fileInput').click(); return; } // iPhone can only pick songs
    if (IS_ANDROID && !window.showDirectoryPicker) { $('dirInput').click(); return; } // Android: pick a whole folder
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

  async function scanHandle(handle, opts) {
    var out = [];
    opts = opts || {};
    if (!opts.quiet) setStatus('Looking for music…');
    var complete = true;
    try {
      await walkHandle(handle, handle.name, out);
    } catch (e) {
      complete = false;
      if (!out.length) {
        // the folder is gone for now — usually a USB stick, SD card or external drive that's unplugged
        setStatus('');
        folderMissing(handle, 'missing');
        return false;
      }
      toast('Couldn’t read all of “' + handle.name + '”: ' + (e && e.message ? e.message : e));
    }
    setStatus('');
    var wasAway = folderStatus.get(handle.name);
    folderStatus.set(handle.name, { handle: handle, status: 'ok' });
    ingest(out, handle.name, { quiet: opts.quiet, rescan: opts.rescan, root: complete ? handle.name : null, seen: new Set() });
    if (wasAway && wasAway.status !== 'ok') toast('“' + handle.name + '” is connected again ✓', 2200);
    renderFolderList();
    return true;
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
      storeFiles(files);
      return;
    }
    setStatus('Looking for music…');
    var out = [];
    for (var k = 0; k < roots.length; k++) await walkEntry(roots[k], '', out);
    setStatus('');
    var dirs = roots.filter(function (r) { return r.isDirectory; });
    ingest(out, dirs.length ? dirs.map(function (d) { return d.name; }).join(', ') : '');
    if (!hasFSA || IS_PHONE) storeFiles(out);
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

  /* ---------------- folders on drives that come and go ---------------- */
  // A folder can be unavailable because its drive is unplugged ('missing'), because the browser
  // needs permission again after a restart ('locked'), or because it was picked without a way to
  // reopen it later ('removed'). Its songs stay in the library, greyed out, from the saved song info.
  var folderStatus = new Map();
  function rootOf(t) { return t.path.split('/')[0]; }
  function folderMissing(handle, why) {
    var name = handle.name || handle;
    var had = folderStatus.get(name);
    folderStatus.set(name, { handle: handle.name ? handle : (had && had.handle), status: why });
    var n = 0;
    state.tracks.forEach(function (t) { if (rootOf(t) === name && !t.offline) { t.offline = why; n++; } });
    if (state.folders.indexOf(name) < 0) state.folders.push(name);
    return loadMetaCache().then(function (m) {
      m.forEach(function (r, path) {
        if (path.indexOf(name + '/') !== 0 || state.byPath.has(path)) return;
        var ext = extOf(path);
        if (AUDIO_EXT.indexOf(ext) < 0) return;
        var f;
        try { f = new File([], path.split('/').pop()); } catch (e) { f = new Blob([]); }
        var t = makeTrack(f, path, ext);
        META_FIELDS.forEach(function (k) { if (r[k] !== undefined && r[k] !== '') t[k] = r[k]; });
        t.tagged = true;
        t.offline = why;
        computeAlbumKey(t);
        applyEdit(t);
        state.tracks.push(t);
        state.byId.set(t.id, t);
        state.byPath.set(t.path, t);
        n++;
      });
      invalidate();
      renderAll(true);
      renderFolderList();
      if (why === 'missing' && n) setStatus('“' + name + '” isn’t connected');
      return n;
    });
  }
  // songs that vanished from a folder we could fully read were deleted or moved: take them out
  function dropMissing(root, seen) {
    var gone = state.tracks.filter(function (t) { return rootOf(t) === root && !seen.has(t.path) && t !== state.current; });
    if (!gone.length) return;
    var goneIds = new Set(gone.map(function (t) { return t.id; }));
    state.tracks = state.tracks.filter(function (t) { return !goneIds.has(t.id); });
    gone.forEach(function (t) { state.byId.delete(t.id); state.byPath.delete(t.path); });
    // forget their saved song info too, so they don't come back as 'not connected' later
    gone.forEach(function (t) { if (metaCache) metaCache.delete(t.path); });
    idbOpen().then(function (db) {
      var st = db.transaction('meta', 'readwrite').objectStore('meta');
      gone.forEach(function (t) { st.delete(t.path); });
    }).catch(function () {});
    var cur = state.queue[state.qIndex];
    state.queue = state.queue.filter(function (id) { return !goneIds.has(id); });
    state.originalQueue = state.originalQueue.filter(function (id) { return !goneIds.has(id); });
    state.qIndex = Math.max(-1, state.queue.indexOf(cur));
  }
  // ask again for a folder that needs permission (must follow a click)
  async function unlockFolder(name) {
    var st = folderStatus.get(name);
    if (!st || !st.handle || !st.handle.requestPermission) return false;
    var p = 'denied';
    try { p = await st.handle.requestPermission({ mode: 'read' }); } catch (e) { /* ignore */ }
    if (p !== 'granted') { toast('Permission not given for “' + name + '”.'); return false; }
    $('reopenBanner').hidden = true;
    return scanHandle(st.handle, { quiet: true });
  }
  // a song couldn't be read: find out if its whole folder went away (drive pulled out mid-play)
  function checkSourceGone(t) {
    var f = t.file;
    if (!f || !f.size) return Promise.resolve(false);
    return readAB(f, 1).then(function () { return false; }, function () {
      var name = rootOf(t), st = folderStatus.get(name);
      folderMissing(st && st.handle ? st.handle : name, st && st.handle ? 'missing' : 'removed');
      toast('“' + name + '” was disconnected. Its songs will play again when it’s back.', 4000);
      return true;
    });
  }
  // every few seconds, see whether an unplugged drive is back
  var driveCheckBusy = false;
  async function checkDrives() {
    if (driveCheckBusy) return;
    var away = [];
    folderStatus.forEach(function (st) { if (st.status === 'missing' && st.handle && st.handle.values) away.push(st.handle); });
    if (!away.length) return;
    driveCheckBusy = true;
    for (var i = 0; i < away.length; i++) {
      var back = false;
      try { var it = away[i].values(); await it.next(); back = true; } catch (e) { back = false; }
      if (back) await scanHandle(away[i], { quiet: true });
    }
    driveCheckBusy = false;
  }
  setInterval(checkDrives, 8000);
  window.addEventListener('focus', checkDrives);
  function renderFolderList() {
    $('folderList').innerHTML = state.folders.map(function (f) {
      var st = folderStatus.get(f), s2 = st ? st.status : 'ok';
      var label = s2 === 'missing' ? 'Not connected' : s2 === 'locked' ? 'Tap to reconnect' : s2 === 'removed' ? 'Pick again to reconnect' : '';
      return '<li title="' + esc(f) + '" class="' + (s2 !== 'ok' ? 'off ' + s2 : '') + '" data-folder="' + esc(f) + '">' + esc(f) + (label ? '<small>' + label + '</small>' : '') + '</li>';
    }).join('');
  }
  $('folderList').addEventListener('click', function (e) {
    var li = e.target.closest('[data-folder]');
    if (!li) return;
    var name = li.getAttribute('data-folder'), st = folderStatus.get(name);
    if (!st || st.status === 'ok') return;
    if (st.status === 'locked') unlockFolder(name);
    else if (st.status === 'missing') { toast('Plug in the drive with “' + name + '” — Tunebox picks it up by itself.', 3000); checkDrives(); }
    else if (st.status === 'removed') $('dirInput').click();
  });

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
    needAsk.forEach(function (h) { folderMissing(h, 'locked'); });
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
  var DEFAULT_ON = ['viz', 'smoothSkip', 'softPause', 'preservePitch', 'djArtistGap', 'djFavs', 'autoOpen', 'webAudio', 'level', 'watchFolders', 'lyricWords', 'gapless'];
  // these default depending on the device
  var DEVICE_DEFAULTS = { analyze: function () { return !IS_PHONE; }, keepFiles: function () { return IS_PHONE || !hasFSA; } };
  function isOn(key) {
    if (DEVICE_DEFAULTS[key] && typeof settings[key] !== 'boolean') return DEVICE_DEFAULTS[key]();
    return DEFAULT_ON.indexOf(key) >= 0 ? settings[key] !== false : !!settings[key];
  }

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
        sRow('Gapless playback', 'No silence between songs when crossfade is off — great for live albums and mixes.', sSwitch('gapless')) +
        sRow('Play on', canSink ? (settings.sinkLabel || 'System default') : 'Use your device’s sound menu to pick a speaker.', sBtn(canSink ? 'Choose…' : 'Cast…', 'data-cmd="output"')) +
        sRow('Find missing lyrics online', 'Looks up lyrics on lrclib.net (free) when a song has none. Only the title, artist and length are sent.', sSwitch('lyricsOnline')) +
        sRow('Word-by-word lyrics', 'Light up each word as it’s sung. Exact with word-timed .lrc files; otherwise Tunebox estimates it from each line.', sSwitch('lyricWords')) +
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
        sRow('Check for new songs', hasFSA ? 'Look in your music folders for songs you’ve added.' : 'Pick your music folder again — only new songs are added.', sBtn('Check now', 'data-action="rescan"')) +
        (hasFSA ? sRow('Watch folders', 'Automatically add new songs when you come back to Tunebox (and every 10 minutes).', sSwitch('watchFolders')) : '') +
        sRow('Tidy up song info', 'Clean messy names like “track01 (Official Video) [320kbps]” and join albums split across folders.', sBtn('Tidy up…', 'data-cmd="tidy"') + (tidyBackup ? ' ' + sBtn('Undo', 'data-cmd="tidy-undo"') : '')) +
        sRow('Even out volume', 'Plays quiet and loud songs at the same level (uses ReplayGain tags, or measures each song).', sSwitch('level')) +
        sRow('Smooth loudness peaks', 'Gentle compression — great for noisy places or laptop speakers.', sSwitch('compress')) +
        sRow('Analyse songs in the background', 'Measures loudness and tempo (for the DJ), a little at a time. ' + analysedCount() + ' of ' + state.tracks.length + ' done.', sSwitch('analyze')) +
        sRow('Keep picked songs on this device', 'Songs you pick (or folders you choose on a phone) stay in Tunebox after closing. ' + (storageText || ''), sSwitch('keepFiles')) +
        sRow('Saved songs', 'Remove the copies Tunebox kept (your originals stay).', sBtn('Remove', 'data-action="clear-files"')) +
        sRow('Saved song info', 'Makes big libraries load instantly. Clear it if tags look wrong.', sBtn('Clear', 'data-action="clear-cache"')) +
        sRow('Remove everything', 'Your music files are never touched.', sBtn('Clear library', 'data-action="clear"'))) +

      sCard('App', '',
        sRow('Works offline', offlineText(), '') +
        sRow('Send to another device', 'Copy playlists, favourites and your sound to your phone or PC with a QR code or link.', sBtn('Send…', 'data-cmd="sync"', true)) +
        sRow('Backup', 'Save or restore playlists, favourites, stats and edits as a file.', sBtn('Export', 'data-action="export"') + ' ' + sBtn('Import', 'data-action="import"')) +
        sRow('Song-change notifications', 'Shows the new song when Tunebox is in the background.' + (('Notification' in window) ? '' : ' (Not supported here.)'), sSwitch('notify')) +
        sRow('Sound effects engine', 'Powers the equalizer, reverb and crossfades. Turn off if music stops when your phone locks. Takes effect after reopening.' + (IS_IOS ? ' (Always off on iPhone/iPad.)' : ''), sSwitch('webAudio')) +
        sRow('Install app', isStandalone() ? 'Installed — open it from your Dock or Launchpad.' : 'Opens in its own window, like a Mac app.',
          isStandalone() ? '' : sBtn('Install', 'data-action="install"', true)) +
        sRow('Keyboard shortcuts', 'Space play · ←/→ seek · Shift+←/→ skip · ↑/↓ volume · / search · S shuffle · R repeat · M mute · L favourite · E equalizer · D DJ · F now playing · I up next · T theme · , settings', '', 'wide')) +

      '<p class="set-foot">Tunebox · your music stays on your device.</p>';
  }

  function applySetting(key, val) {
    switch (key) {
      case 'lyricWords': renderLyrics(); break;
      case 'lyricsOnline': if (val && state.current && !state.lyrics) onlineLyricsFor(state.current); break;
      case 'gapless': resetGapless(); break;
      case 'theme':
        if (val === 'auto') delete settings.theme; else settings.theme = val;
        applyTheme();
        break;
      case 'dj': if (val) startDj(); else stopDj(); return;
      case 'speed': case 'preservePitch': case 'reverb': case 'preamp': applyFx(); break;
      case 'accent': case 'glow': case 'viz': case 'reduceMotion': applyLook(); break;
      case 'level': if (state.current) setTrim(active, state.current); break;
      case 'compress': routeLeveller(); break;
      case 'analyze': if (val) scheduleAnalysis(500); break;
      case 'notify':
        if (val && 'Notification' in window && Notification.permission !== 'granted') {
          Notification.requestPermission().then(function (perm) {
            if (perm !== 'granted') { settings.notify = false; saveSettings(); renderSettings(); toast('Notifications were blocked in the browser.'); }
            else toast('You’ll see the song when it changes.', 2000);
          });
        }
        break;
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
    } else if (act === 'clear-files') {
      if (confirm('Remove the songs Tunebox saved on this device?')) clearStoredFiles().then(function () { updateStorageText(); toast('Saved songs removed', 1500); });
    } else if (act === 'export') {
      exportBackup();
    } else if (act === 'import') {
      $('importInput').click();
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
  var META_FIELDS = ['title', 'artist', 'album', 'albumArtist', 'track', 'disc', 'year', 'genre', 'bpm', 'duration', 'rg', 'loud', 'bpmAuto'];
  function applyCache(tracks) {
    var need = [];
    tracks.forEach(function (t) {
      var r = metaCache && metaCache.get(t.path);
      if (r && r.sz === t.file.size && r.mt === t.file.lastModified) {
        META_FIELDS.forEach(function (f) { if (r[f] !== undefined && r[f] !== '') t[f] = r[f]; });
        t.tagged = true;
        computeAlbumKey(t);
        applyEdit(t);
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
  async function rescanFolders(quiet) {
    if (!hasFSA) {
      if (quiet) return;
      if (IS_IOS) { $('fileInput').click(); return; }
      toast('Pick the same folder again. Only new songs are added.', 3500);
      setTimeout(function () { $('dirInput').click(); }, 400);
      return;
    }
    var list = (await idbGet('handles')) || [];
    if (!list.length) { if (!quiet) openFolder(); return; }
    var before = state.tracks.length;
    for (var i = 0; i < list.length; i++) {
      var p = 'prompt';
      try { p = await list[i].queryPermission({ mode: 'read' }); } catch (e) { /* ignore */ }
      if (p !== 'granted' && !quiet) { try { p = await list[i].requestPermission({ mode: 'read' }); } catch (e) { /* ignore */ } }
      if (p === 'granted') await scanHandle(list[i], { quiet: true });
    }
    if (!quiet && state.tracks.length === before) toast('No new songs.', 1600);
  }
  // Watch folders: when you come back to Tunebox, quietly look for songs you've added since
  var lastWatch = Date.now();
  function watchFolders() {
    if (!hasFSA || !isOn('watchFolders') || document.hidden || !state.folders.length) return;
    if (Date.now() - lastWatch < 90000) return;
    lastWatch = Date.now();
    rescanFolders(true);
  }
  document.addEventListener('visibilitychange', watchFolders);
  window.addEventListener('focus', watchFolders);
  setInterval(function () { if (!document.hidden && Date.now() - lastWatch > 10 * 60000) { lastWatch = 0; watchFolders(); } }, 60000);

  /* ------------------------------ files opened from the OS ------------------------------ */
  if ('launchQueue' in window && window.launchQueue.setConsumer) {
    window.launchQueue.setConsumer(async function (params) {
      if (!params.files || !params.files.length) return;
      var entries = [];
      for (var i = 0; i < params.files.length; i++) {
        try { var f = await params.files[i].getFile(); entries.push({ file: f, path: 'Opened files/' + f.name }); } catch (e) { /* skip */ }
      }
      if (!entries.length) return;
      ingest(entries, 'Opened files');
      storeFiles(entries);
      var first = state.byPath.get(entries[0].path);
      if (first) playIds(entries.map(function (e) { var t = state.byPath.get(e.path); return t ? t.id : null; }).filter(function (x) { return x !== null; }), 0);
    });
  }
  // app shortcuts (right-click the Dock / taskbar icon, or long-press on Android)
  (function () {
    var q = location.search;
    if (/[?&]dj=1/.test(q)) setTimeout(function () { if (state.tracks.length) startDj(); else settings.dj = true; updateDjUi(); }, 1500);
    var vm = /[?&]view=(settings|playlists|stats)/.exec(q);
    if (vm) setTimeout(function () { setView(vm[1]); }, 50);
  })();

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

  /* =====================================================================
     Extras: menus & dialogs, playlists, sleep timer, volume levelling,
     tempo detection, listening stats, editing info, sharing & sync
     ===================================================================== */

  function lsGet(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota */ } }
  function trackKey(t) { return (t.title + '|' + artistOf(t) + '|' + t.album).toLowerCase(); }
  var keyIndex = null;
  function byKey(k) {
    if (!keyIndex || keyIndex.n !== state.tracks.length) {
      keyIndex = { n: state.tracks.length, m: new Map() };
      state.tracks.forEach(function (t) { keyIndex.m.set(trackKey(t), t); });
    }
    return keyIndex.m.get(k);
  }

  /* ---------------- dialogs ---------------- */
  var modalClose = null;
  function openModal(html, mount, cls) {
    var m = $('modal');
    m.className = 'modal glass-strong' + (cls ? ' ' + cls : '');
    m.innerHTML = html;
    $('modalBack').hidden = false;
    modalClose = null;
    m.onclick = null;
    if (mount) modalClose = mount(m) || null;
    var first = m.querySelector('input[type="text"], input:not([type]), textarea');
    if (first) setTimeout(function () { first.focus(); first.select && first.select(); }, 30);
  }
  function closeModal() {
    if ($('modalBack').hidden) return;
    $('modalBack').hidden = true;
    $('modal').innerHTML = '';
    if (typeof modalClose === 'function') modalClose();
    modalClose = null;
  }
  $('modalBack').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
  $('modal').addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeModal(); });
  function askText(title, value, okLabel, cb) {
    openModal('<h3>' + esc(title) + '</h3><input class="field" type="text" id="askInput" value="' + esc(value || '') + '" maxlength="80">' +
      '<div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="askOk">' + esc(okLabel) + '</button></div>',
      function (m) {
        function done() { var v = m.querySelector('#askInput').value.trim(); if (!v) return; closeModal(); cb(v); }
        m.querySelector('#askOk').addEventListener('click', done);
        m.querySelector('#askInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') done(); });
      });
  }

  /* ---------------- context menu ---------------- */
  var ctxTracks = [], ctxPos = { x: 0, y: 0 };
  function closeMenu() { $('ctxMenu').hidden = true; }
  function placeMenu() {
    var m = $('ctxMenu');
    m.hidden = false;
    var w = m.offsetWidth, h = m.offsetHeight;
    var x = Math.min(ctxPos.x, window.innerWidth - w - 8), y = Math.min(ctxPos.y, window.innerHeight - h - 8);
    m.style.left = Math.max(8, x) + 'px';
    m.style.top = Math.max(8, y) + 'px';
  }
  function menuItem(act, label, icon) { return '<button data-m="' + act + '">' + (icon || '') + '<span>' + label + '</span></button>'; }
  function openTrackMenu(ids, x, y) {
    ctxTracks = ids.slice();
    ctxPos = { x: x, y: y };
    var t = state.byId.get(ids[0]);
    if (!t) return;
    var many = ids.length > 1;
    var inUserPl = state.view === 'playlist' && state.detail && state.detail.indexOf('smart:') !== 0;
    $('ctxMenu').innerHTML =
      '<div class="ctx-title">' + (many ? plural(ids.length, 'song') : esc(t.title) + '<small>' + esc(t.artist) + '</small>') + '</div>' +
      menuItem('play-next', 'Play next') +
      menuItem('add-queue', 'Add to Up Next') +
      menuItem('add-pl', 'Add to playlist…') +
      (many ? '' : menuItem('fav', isFav(t) ? 'Remove from Favourites' : 'Add to Favourites')) +
      (many ? '' : menuItem('dj', 'Start DJ from this song')) +
      '<hr>' +
      (many ? '' : menuItem('album', 'Go to album') + menuItem('artist', 'Go to artist')) +
      (many ? '' : menuItem('edit', 'Edit song info…')) +
      (inUserPl ? '<hr>' + menuItem('pl-remove', 'Remove from this playlist') : '');
    placeMenu();
  }
  function openPlaylistPicker() {
    $('ctxMenu').innerHTML = '<div class="ctx-title">Add to playlist</div>' +
      menuItem('pl-new', '+ New playlist…') +
      playlists.map(function (p) { return '<button data-m="pl-add" data-pl="' + p.id + '"><span>' + esc(p.name) + '</span></button>'; }).join('');
    placeMenu();
  }
  $('ctxMenu').addEventListener('click', function (e) {
    var b = e.target.closest('[data-m]');
    if (!b) return;
    var act = b.getAttribute('data-m'), ids = ctxTracks, t = state.byId.get(ids[0]);
    if (act === 'add-pl') { openPlaylistPicker(); return; }
    closeMenu();
    if (act === 'play-next') { queueInsert(ids, true); }
    else if (act === 'add-queue') { queueInsert(ids, false); }
    else if (act === 'pl-new') { askText('New playlist', '', 'Create', function (name) { var p = createPlaylist(name); addToPlaylist(p.id, ids); }); }
    else if (act === 'pl-add') { addToPlaylist(b.getAttribute('data-pl'), ids); }
    else if (act === 'fav') { toggleFavFor(t); }
    else if (act === 'dj') { startDj(t); }
    else if (act === 'album') { setView('album', t.albumKey); }
    else if (act === 'artist') { setView('artist', artistOf(t)); }
    else if (act === 'edit') { editTracks([t]); }
    else if (act === 'pl-remove') { removeFromPlaylist(state.detail, ids); }
  });
  document.addEventListener('mousedown', function (e) { if (!$('ctxMenu').hidden && !e.target.closest('#ctxMenu')) closeMenu(); }, true);
  document.addEventListener('touchstart', function (e) { if (!$('ctxMenu').hidden && !e.target.closest('#ctxMenu')) closeMenu(); }, { passive: true, capture: true });
  scroller.addEventListener('scroll', closeMenu, { passive: true });

  function queueInsert(ids, nextUp) {
    if (!state.current) { playIds(ids, 0); return; }
    ids = ids.filter(function (id) { return id !== state.current.id; });
    if (nextUp) state.queue.splice.apply(state.queue, [state.qIndex + 1, 0].concat(ids));
    else state.queue = state.queue.concat(ids);
    state.originalQueue = state.queue.slice();
    updateUpNext();
    if (state.view === 'queue') { invalidate(); renderAll(); }
    toast(nextUp ? (ids.length > 1 ? plural(ids.length, 'song') + ' will play next' : '“' + state.byId.get(ids[0]).title + '” plays next') : 'Added to Up Next', 1600);
  }
  function toggleFavFor(t) {
    if (favs[t.path]) delete favs[t.path]; else favs[t.path] = 1;
    favKeys.delete(trackKey(t));
    if (typeof pushSyncSoon === 'function') pushSyncSoon();
    lsSet('tunebox.favs', Object.keys(favs));
    lsSet('tunebox.favKeys', Array.from(favKeys));
    updateFavButtons();
    $('countFavs').textContent = favCount() || '';
    if (state.view === 'favorites') { invalidate(); renderAll(); } else renderRows();
    toast(favs[t.path] ? 'Added to Favourites' : 'Removed from Favourites', 1300);
  }
  // favourites that arrived from another device are matched by title/artist/album
  var favKeys = new Set(lsGet('tunebox.favKeys', []));

  // right-click / "⋯" on rows
  $('slSpacer').addEventListener('contextmenu', function (e) {
    var row = e.target.closest('.row');
    if (!row) return;
    e.preventDefault();
    openTrackMenu([getList()[+row.getAttribute('data-i')]], e.clientX, e.clientY);
  });

  /* ---------------- playlists ---------------- */
  var playlists = lsGet('tunebox.playlists', []);
  var SMART = {
    recent: { name: 'Recently Played', desc: 'What you’ve listened to lately' },
    most: { name: 'Most Played', desc: 'Your all-time top songs' },
    forgotten: { name: 'Not Heard in a While', desc: 'Old favourites from more than a month ago' },
    never: { name: 'Never Played', desc: 'Songs waiting for their first listen' }
  };
  function savePlaylists() { lsSet('tunebox.playlists', playlists); if (typeof pushSyncSoon === 'function') pushSyncSoon(); renderPlaylistNav(); if (state.view === 'playlists') renderPlaylists(); }
  function getPl(id) { for (var i = 0; i < playlists.length; i++) if (playlists[i].id === id) return playlists[i]; return null; }
  function createPlaylist(name, ids) {
    var p = { id: 'pl' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), name: name, items: [], created: Date.now() };
    playlists.push(p);
    if (ids && ids.length) addToPlaylist(p.id, ids, true);
    savePlaylists();
    return p;
  }
  function addToPlaylist(id, ids, quiet) {
    var p = getPl(id);
    if (!p) return;
    var have = new Set(p.items.map(function (it) { return it.p; })), n = 0;
    ids.forEach(function (tid) {
      var t = state.byId.get(tid);
      if (t && !have.has(t.path)) { p.items.push({ p: t.path, k: trackKey(t) }); have.add(t.path); n++; }
    });
    p.updated = Date.now();
    savePlaylists();
    if (!quiet) toast(n ? 'Added ' + plural(n, 'song') + ' to “' + p.name + '”' : 'Already in “' + p.name + '”', 1800);
    if (state.view === 'playlist' && state.detail === id) { invalidate(); renderAll(); }
  }
  function removeFromPlaylist(id, ids) {
    var p = getPl(id);
    if (!p) return;
    var paths = new Set(ids.map(function (tid) { var t = state.byId.get(tid); return t ? t.path : ''; }));
    var keys = new Set(ids.map(function (tid) { var t = state.byId.get(tid); return t ? trackKey(t) : ''; }));
    p.items = p.items.filter(function (it) { return !paths.has(it.p) && !keys.has(it.k); });
    savePlaylists();
    invalidate();
    renderAll();
  }
  function resolveItem(it) { return state.byPath.get(it.p) || byKey(it.k) || null; }
  function smartIds(kind) {
    var out = [];
    if (kind === 'recent') {
      var seen = new Set();
      for (var i = history.length - 1; i >= 0 && out.length < 100; i--) {
        var t = state.byPath.get(history[i]);
        if (t && !seen.has(t.id)) { seen.add(t.id); out.push(t.id); }
      }
      return out;
    }
    var list = state.tracks.slice();
    if (kind === 'most') {
      return list.filter(function (t) { return stats[t.path] && stats[t.path].p > 0; })
        .sort(function (a, b) { return stats[b.path].p - stats[a.path].p; }).slice(0, 100).map(function (t) { return t.id; });
    }
    if (kind === 'forgotten') {
      var month = Date.now() - 30 * 864e5;
      return list.filter(function (t) { var s = stats[t.path]; return s && s.p > 0 && s.l && s.l < month; })
        .sort(function (a, b) { return stats[b.path].p - stats[a.path].p; }).slice(0, 100).map(function (t) { return t.id; });
    }
    if (kind === 'never') {
      return list.filter(function (t) { var s = stats[t.path]; return !s || !s.p; }).sort(defaultOrder).slice(0, 300).map(function (t) { return t.id; });
    }
    return out;
  }
  function playlistIds(id) {
    if (!id) return [];
    if (id.indexOf('smart:') === 0) return smartIds(id.slice(6));
    var p = getPl(id);
    if (!p) return [];
    var seen = new Set(), out = [];
    p.items.forEach(function (it) { var t = resolveItem(it); if (t && !seen.has(t.id)) { seen.add(t.id); out.push(t.id); } });
    return out;
  }
  function playlistName(id) {
    if (!id) return '';
    if (id.indexOf('smart:') === 0) return SMART[id.slice(6)] ? SMART[id.slice(6)].name : 'Playlist';
    var p = getPl(id);
    return p ? p.name : 'Playlist';
  }
  function renderPlaylistNav() {
    $('playlistNav').innerHTML = playlists.length ? playlists.map(function (p) {
      return '<button class="nav-item subtle pl-nav" data-view="playlist" data-detail="' + p.id + '">' +
        '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 5h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm14-4v6.3a3 3 0 1 0 2 2.7V11h3V9z"/></svg><span>' + esc(p.name) + '</span></button>';
    }).join('') : '<div class="sb-empty">Right-click any song → Add to playlist.</div>';
    var c = $('countPlaylists'); if (c) c.textContent = playlists.length || '';
    $$('.pl-nav').forEach(function (b) { b.classList.toggle('active', state.view === 'playlist' && state.detail === b.getAttribute('data-detail')); });
  }
  var SMART_COLORS = { recent: ['#5b8cff', '#8e4dff'], most: ['#ff8a4c', '#e8366b'], forgotten: ['#22c1a1', '#2a7bd6'], never: ['#f7b733', '#fc4a1a'] };
  function renderPlaylists() {
    var html = '<div class="card new-pl" data-act="new"><div class="art-wrap"><div class="art cover"><div class="ph" style="background:var(--glass-2)"><b>+</b></div></div></div><div class="ct">New playlist</div><div class="ca">Make your own mix</div></div>';
    Object.keys(SMART).forEach(function (k) {
      var c = SMART_COLORS[k], n = smartIds(k).length;
      html += '<div class="card" data-pl="smart:' + k + '"><div class="art-wrap"><div class="art cover"><div class="ph" style="background-image:linear-gradient(135deg,' + c[0] + ',' + c[1] + ')">' +
        '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/></svg></div></div></div>' +
        '<div class="ct">' + SMART[k].name + '</div><div class="ca">Smart · ' + plural(n, 'song') + '</div></div>';
    });
    playlists.forEach(function (p) {
      var ids = playlistIds(p.id);
      html += '<div class="card" data-pl="' + p.id + '"><div class="art-wrap"><div class="art cover" data-first="' + (ids[0] || '') + '"></div>' +
        '<button class="play-btn quick" data-act="play" title="Play">' + ICON_PLAY + '</button></div>' +
        '<div class="ct">' + esc(p.name) + '</div><div class="ca">' + plural(ids.length, 'song') + '</div></div>';
    });
    var g = $('playlistGrid');
    g.innerHTML = html;
    Array.prototype.forEach.call(g.querySelectorAll('[data-first]'), function (el) {
      var t = state.byId.get(+el.getAttribute('data-first'));
      if (t) paintCover(el, t, t.album);
      else el.innerHTML = '<div class="ph" style="' + placeholderStyle(el.parentNode.parentNode.querySelector('.ct').textContent) + '">' + ICON_NOTE + '</div>';
    });
  }
  $('playlistGrid').addEventListener('click', function (e) {
    var c = e.target.closest('.card');
    if (!c) return;
    if (c.getAttribute('data-act') === 'new') { askText('New playlist', '', 'Create', function (name) { var p = createPlaylist(name); setView('playlist', p.id); }); return; }
    var id = c.getAttribute('data-pl');
    if (e.target.closest('[data-act="play"]')) { var ids = playlistIds(id); if (ids.length) playIds(ids, 0); return; }
    setView('playlist', id);
  });

  /* ---------------- sleep timer ---------------- */
  var sleep = null, sleepFactor = 1;
  function setSleep(v) {
    if (v === 'off') { cancelSleep(); toast('Sleep timer off', 1200); return; }
    sleep = v === 'song' ? { mode: 'song' } : { mode: 'min', end: Date.now() + v * 60000 };
    updateSleepUi();
    toast(v === 'song' ? 'Music will stop after this song' : 'Music will fade out in ' + v + ' min', 2000);
  }
  function cancelSleep() { sleep = null; sleepFactor = 1; applyVolumeToDecks(); updateSleepUi(); }
  function finishSleep() {
    sleep = null;
    cancelFade();
    audio.pause();
    sleepFactor = 1;
    applyVolumeToDecks();
    updateSleepUi();
    toast('Sleep timer — goodnight 🌙', 3000);
  }
  function sleepTick() {
    if (!sleep) return;
    if (sleep.mode === 'min') {
      var left = (sleep.end - Date.now()) / 1000;
      if (left <= 0) { finishSleep(); return; }
      var f = left < 30 ? Math.max(0, left / 30) : 1;
      if (Math.abs(f - sleepFactor) > 0.01) { sleepFactor = f; applyVolumeToDecks(); }
    } else if (sleep.mode === 'song' && audio.duration && isFinite(audio.duration)) {
      var l2 = audio.duration - audio.currentTime;
      var f2 = l2 < 8 ? Math.max(0, l2 / 8) : 1;
      if (Math.abs(f2 - sleepFactor) > 0.01) { sleepFactor = f2; applyVolumeToDecks(); }
    }
    updateSleepUi();
  }
  setInterval(sleepTick, 1000);
  function updateSleepUi() {
    var pill = $('sleepPill');
    if (!sleep) { pill.hidden = true; $$('[data-cmd="sleep"]').forEach(function (b) { b.classList.remove('on'); }); return; }
    pill.hidden = false;
    pill.textContent = sleep.mode === 'song' ? '☾ end of song' : '☾ ' + Math.max(1, Math.ceil((sleep.end - Date.now()) / 60000)) + ' min';
    $$('[data-cmd="sleep"]').forEach(function (b) { b.classList.add('on'); });
  }
  function openSleepDialog() {
    var opts = [[5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], [90, '1½ hours'], ['song', 'End of this song']];
    openModal('<h3>Sleep timer</h3><p class="modal-sub">' + (sleep ? (sleep.mode === 'song' ? 'Stops after this song.' : 'Stops in ' + Math.ceil((sleep.end - Date.now()) / 60000) + ' min.') : 'Music fades out gently, then stops.') + '</p>' +
      '<div class="opt-grid">' + opts.map(function (o) { return '<button class="opt" data-sleep="' + o[0] + '">' + o[1] + '</button>'; }).join('') +
      (sleep ? '<button class="opt danger" data-sleep="off">Turn off</button>' : '') + '</div>' +
      '<div class="modal-actions"><button class="btn" data-close>Close</button></div>',
      function (m) {
        m.onclick = function (e) {
          var b = e.target.closest('[data-sleep]');
          if (!b) return;
          var v = b.getAttribute('data-sleep');
          setSleep(v === 'song' || v === 'off' ? v : +v);
          closeModal();
        };
      });
  }

  /* ---------------- volume levelling + tempo detection ---------------- */
  // Each song is measured once (in the background, a little at a time) for loudness and tempo.
  // Loudness lets quiet and loud songs play at the same level; tempo helps the DJ match songs.
  var LEVEL_TARGET = -17; // dBFS (RMS)
  function levelGainDb(t) {
    if (!t || settings.level === false) return 0;
    if (typeof t.rg === 'number') return Math.max(-12, Math.min(9, t.rg));
    if (typeof t.loud === 'number') return Math.max(-9, Math.min(6, LEVEL_TARGET - t.loud));
    return 0;
  }
  function setTrim(idx, t) {
    if (!trims) return;
    trims[idx].gain.setTargetAtTime(Math.pow(10, levelGainDb(t) / 20), ac.currentTime, 0.05);
  }
  var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  function analysisOn() { return !!OAC && (typeof settings.analyze === 'boolean' ? settings.analyze : !IS_PHONE); }
  function needsAnalysis(t) { return !t.broken && !t.offline && !t.anaFail && (typeof t.loud !== 'number' || !t.bpm); }
  var anaBusy = false, anaCursor = 0, anaDone = 0;
  function pickToAnalyse() {
    if (state.current && needsAnalysis(state.current)) return state.current;
    for (var i = state.qIndex + 1; i < Math.min(state.queue.length, state.qIndex + 8); i++) {
      var q = state.byId.get(state.queue[i]);
      if (q && needsAnalysis(q)) return q;
    }
    for (var n = 0; n < state.tracks.length; n++) {
      var t = state.tracks[(anaCursor + n) % state.tracks.length];
      if (needsAnalysis(t)) { anaCursor = (anaCursor + n + 1) % state.tracks.length; return t; }
    }
    return null;
  }
  function decodeAB(ctx, buf) {
    return new Promise(function (res, rej) {
      var p = ctx.decodeAudioData(buf, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  }
  function readAB(file, end) {
    var b = file.slice(0, end);
    if (b.arrayBuffer) return b.arrayBuffer();
    return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsArrayBuffer(b); });
  }
  async function analyseTrack(t) {
    var ctx = new OAC(1, 22050, 22050);
    var buf, data;
    try {
      buf = await readAB(t.file, Math.min(t.file.size, 6e6));
      data = await decodeAB(ctx, buf);
    } catch (e) {
      if (t.file.size <= 6e6 || t.file.size > 40e6) throw e;
      buf = await readAB(t.file, t.file.size); // e.g. M4A files keep their index at the end
      data = await decodeAB(new OAC(1, 22050, 22050), buf);
    }
    buf = null;
    var ch = data.getChannelData(0), sr = data.sampleRate;
    // loudness: average power of 0.4 s blocks, ignoring near-silence
    var block = Math.floor(sr * 0.4), sumP = 0, nP = 0;
    for (var b = 0; b + block <= ch.length; b += block) {
      var acc = 0;
      for (var i = b; i < b + block; i += 2) acc += ch[i] * ch[i];
      var pw = acc / (block / 2);
      if (pw > 1e-6) { sumP += pw; nP++; }
    }
    var loud = nP ? 10 * Math.log10(sumP / nP) : null;
    // tempo: onset strength from energy rises, then autocorrelation over 70–180 BPM
    var bpm = 0;
    var start = Math.floor(Math.min(ch.length * 0.2, sr * 30)), len = Math.min(ch.length - start, sr * 40);
    if (len > sr * 8) {
      var hop = 256, fps = sr / hop, frames = Math.floor(len / hop), env = new Float32Array(frames), prev = 0;
      for (var f = 0; f < frames; f++) {
        var e = 0, o = start + f * hop;
        for (var j = 0; j < hop; j++) { var s = ch[o + j]; e += s * s; }
        e = Math.log(1 + 1000 * e);
        env[f] = Math.max(0, e - prev);
        prev = e;
      }
      var mean = 0; for (f = 0; f < frames; f++) mean += env[f]; mean /= frames;
      for (f = 0; f < frames; f++) env[f] -= mean;
      var best = 0, bestLag = 0, minLag = Math.floor(60 * fps / 180), maxLag = Math.ceil(60 * fps / 70);
      for (var lag = minLag; lag <= maxLag; lag++) {
        var c = 0;
        for (f = 0; f + lag < frames; f++) c += env[f] * env[f + lag];
        c /= (frames - lag);
        // gentle preference for common tempos around 120
        var bp = 60 * fps / lag;
        c *= 1 - 0.15 * Math.abs(Math.log2(bp / 120));
        if (c > best) { best = c; bestLag = lag; }
      }
      if (bestLag) {
        bpm = 60 * fps / bestLag;
        while (bpm < 75) bpm *= 2;
        while (bpm > 165) bpm /= 2;
        bpm = Math.round(bpm);
      }
    }
    return { loud: loud, bpm: bpm };
  }
  function scheduleAnalysis(delay) {
    setTimeout(function () {
      if (anaBusy || !analysisOn() || !state.tracks.length) return;
      var t = pickToAnalyse();
      if (!t) return;
      anaBusy = true;
      analyseTrack(t).then(function (r) {
        if (typeof r.loud === 'number') t.loud = Math.round(r.loud * 10) / 10;
        else t.anaFail = true;
        if (!t.bpm && r.bpm) { t.bpm = r.bpm; t.bpmAuto = true; }
        if (!t.bpm) t.bpm = -1; // measured, no clear beat
        anaDone++;
        markMetaDirty(t);
        if (t === state.current) setTrim(active, t);
      }).catch(function () { t.anaFail = true; }).then(function () {
        anaBusy = false;
        scheduleAnalysis(document.hidden ? 1200 : 2500);
      });
    }, delay || 0);
  }
  function analysedCount() { return state.tracks.filter(function (t) { return typeof t.loud === 'number' && t.bpm; }).length; }

  /* ---------------- listening stats ---------------- */
  var daily = lsGet('tunebox.daily', {});
  function dayKey(d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  var lastTick = 0;
  function listenTick() {
    var now = performance.now();
    if (lastTick && !audio.paused && state.current) {
      var dt = Math.min(2, (now - lastTick) / 1000);
      var s = stat(state.current);
      s.t = (s.t || 0) + dt;
      var k = dayKey();
      daily[k] = (daily[k] || 0) + dt;
      saveDailySoon();
      saveStatsSoon();
    }
    lastTick = now;
  }
  var saveDailySoon = debounce(function () {
    var keys = Object.keys(daily).sort();
    if (keys.length > 400) keys.slice(0, keys.length - 400).forEach(function (k) { delete daily[k]; });
    lsSet('tunebox.daily', daily);
  }, 3000);
  function fmtDur(sec) {
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h ? h + ' h ' + m + ' min' : m + ' min';
  }
  function renderStats() {
    var v = $('statsView');
    var totalSec = 0, plays = 0, songs = 0;
    var byArtist = {}, byGenre = {};
    Object.keys(stats).forEach(function (p) {
      var s = stats[p];
      totalSec += s.t || 0;
      plays += s.p || 0;
      if (s.p) songs++;
      var t = state.byPath.get(p);
      if (t && s.p) {
        var a = artistOf(t);
        byArtist[a] = (byArtist[a] || 0) + s.p;
        if (t.genre) byGenre[t.genre] = (byGenre[t.genre] || 0) + s.p;
      }
    });
    var days = [], maxDay = 1;
    for (var i = 13; i >= 0; i--) {
      var d = new Date(Date.now() - i * 864e5), k = dayKey(d), val = daily[k] || 0;
      days.push({ d: d, v: val });
      if (val > maxDay) maxDay = val;
    }
    var week = days.slice(7).reduce(function (a, x) { return a + x.v; }, 0);
    var top = state.tracks.filter(function (t) { return stats[t.path] && stats[t.path].p; })
      .sort(function (a, b) { return stats[b.path].p - stats[a.path].p; }).slice(0, 10);
    var topArtists = Object.keys(byArtist).sort(function (a, b) { return byArtist[b] - byArtist[a]; }).slice(0, 8);
    var topGenres = Object.keys(byGenre).sort(function (a, b) { return byGenre[b] - byGenre[a]; }).slice(0, 6);
    var maxA = topArtists.length ? byArtist[topArtists[0]] : 1, maxG = topGenres.length ? byGenre[topGenres[0]] : 1;
    var DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    v.innerHTML =
      '<div class="stat-tiles">' +
        '<div class="tile"><b>' + fmtDur(totalSec) + '</b><span>Listened in total</span></div>' +
        '<div class="tile"><b>' + fmtDur(week) + '</b><span>This week</span></div>' +
        '<div class="tile"><b>' + plays + '</b><span>Songs played through</span></div>' +
        '<div class="tile"><b>' + songs + '</b><span>Different songs</span></div>' +
      '</div>' +
      '<section class="set-card"><div class="set-card-head"><h3>Last 14 days</h3><p>Minutes listened per day</p></div>' +
        '<div class="day-bars">' + days.map(function (x) {
          return '<div class="day"><i style="height:' + Math.max(2, Math.round(x.v / maxDay * 100)) + '%" title="' + fmtDur(x.v) + '"></i><span>' + DAYS[x.d.getDay()] + '</span></div>';
        }).join('') + '</div></section>' +
      '<div class="stat-cols">' +
        '<section class="set-card"><div class="set-card-head"><h3>Top songs</h3></div>' +
          (top.length ? top.map(function (t, n) {
            return '<button class="top-row" data-tid="' + t.id + '"><em>' + (n + 1) + '</em><div class="thumb cover">' + coverInner(coverSync.has(t.albumKey) ? coverSync.get(t.albumKey) : undefined, t.album) + '</div>' +
              '<div class="tt"><div class="t1">' + esc(t.title) + '</div><div class="t2">' + esc(t.artist) + '</div></div><span class="qt">' + plural(stats[t.path].p, 'play') + '</span></button>';
          }).join('') : '<p class="insp-empty">Play some music — your favourites will show up here.</p>') +
        '</section>' +
        '<section class="set-card"><div class="set-card-head"><h3>Top artists</h3></div>' +
          (topArtists.length ? topArtists.map(function (a) {
            return '<div class="bar-row"><span>' + esc(a) + '</span><div class="bar"><i style="width:' + Math.round(byArtist[a] / maxA * 100) + '%"></i></div><em>' + byArtist[a] + '</em></div>';
          }).join('') : '<p class="insp-empty">Nothing yet.</p>') +
          (topGenres.length ? '<div class="set-card-head"><h3>Top genres</h3></div>' + topGenres.map(function (g) {
            return '<div class="bar-row"><span>' + esc(g) + '</span><div class="bar"><i style="width:' + Math.round(byGenre[g] / maxG * 100) + '%"></i></div><em>' + byGenre[g] + '</em></div>';
          }).join('') : '') +
        '</section>' +
      '</div>';
    top.forEach(function (t) { if (!coverSync.has(t.albumKey)) getCover(t).then(statsCoversSoon); });
  }
  var statsCoversSoon = throttle(function () { if (state.view === 'stats') renderStats(); }, 800);
  $('statsView').addEventListener('click', function (e) {
    var r = e.target.closest('[data-tid]');
    if (r) { var t = state.byId.get(+r.getAttribute('data-tid')); if (t) playIds([t.id], 0); }
  });

  /* ---------------- editing song info & covers ---------------- */
  // Changes are saved inside Tunebox; your music files are never modified.
  var edits = {}, coverEdits = {};
  var editsLoaded = idbGet('edits').then(function (e) { edits = e || {}; }).then(function () {
    return idbGet('coverEdits');
  }).then(function (c) { coverEdits = c || {}; }).catch(function () {});
  var EDIT_FIELDS = ['title', 'artist', 'album', 'albumArtist', 'track', 'year', 'genre'];
  function applyEdit(t) {
    var e = edits[t.path];
    if (!e) return;
    EDIT_FIELDS.forEach(function (f) { if (e[f] !== undefined && e[f] !== '') t[f] = (f === 'track' || f === 'year') ? (+e[f] || 0) : e[f]; });
    computeAlbumKey(t);
  }
  function editTracks(list, albumMode) {
    var t = list[0], single = list.length === 1 && !albumMode;
    var f = function (name, label, val, type) {
      return '<label class="fld"><span>' + label + '</span><input class="field" name="' + name + '" ' + (type ? 'type="' + type + '"' : 'type="text"') + ' value="' + esc(val == null ? '' : val) + '"></label>';
    };
    openModal('<h3>' + (single ? 'Edit song info' : 'Edit album') + '</h3>' +
      '<p class="modal-sub">' + (single ? esc(t.path) : plural(list.length, 'song')) + ' — saved in Tunebox, your file stays untouched.</p>' +
      '<div class="edit-cover"><div class="cover" id="editCover"></div><div><button class="btn small" id="pickCover">Change cover…</button><p class="modal-sub" id="coverName"></p></div></div>' +
      '<div class="fld-grid">' +
        (single ? f('title', 'Title', t.title) + f('artist', 'Artist', t.artist) : '') +
        f('album', 'Album', t.album) + f('albumArtist', 'Album artist', t.albumArtist) +
        (single ? f('track', 'Track #', t.track || '', 'number') : '') + f('year', 'Year', t.year || '', 'number') + f('genre', 'Genre', t.genre) +
      '</div>' +
      '<div class="modal-actions"><button class="link-btn" id="editReset">Reset to file’s info</button><span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="editSave">Save</button></div>',
      function (m) {
        var newCover = null;
        paintCover(m.querySelector('#editCover'), t, t.album);
        m.querySelector('#pickCover').addEventListener('click', function () { $('coverInput').click(); });
        coverPicked = function (file) {
          newCover = file;
          m.querySelector('#coverName').textContent = file.name;
          var url = URL.createObjectURL(file);
          m.querySelector('#editCover').innerHTML = '<img alt="" src="' + url + '">';
        };
        m.querySelector('#editSave').addEventListener('click', function () {
          var vals = {};
          Array.prototype.forEach.call(m.querySelectorAll('input[name]'), function (inp) { vals[inp.name] = inp.value.trim(); });
          var oldKeys = new Set(list.map(function (x) { return x.albumKey; }));
          list.forEach(function (x) {
            var e = edits[x.path] || {};
            Object.keys(vals).forEach(function (k) { if (vals[k] !== '' || e[k] !== undefined) e[k] = vals[k]; });
            edits[x.path] = e;
            applyEdit(x);
          });
          idbSet('edits', edits);
          var finish = function () {
            oldKeys.forEach(function (k) { coverCache.delete(k); coverSync.delete(k); });
            list.forEach(function (x) { coverCache.delete(x.albumKey); coverSync.delete(x.albumKey); });
            invalidate();
            keyIndex = null;
            renderAll();
            updateNowPlaying();
            toast('Saved', 1200);
          };
          closeModal();
          if (newCover) {
            var key = list[0].albumKey;
            coverEdits[key] = newCover;
            idbSet('coverEdits', coverEdits).then(finish);
          } else finish();
        });
        m.querySelector('#editReset').addEventListener('click', function () {
          list.forEach(function (x) { delete edits[x.path]; delete coverEdits[x.albumKey]; coverCache.delete(x.albumKey); coverSync.delete(x.albumKey); x.tagged = false; });
          idbSet('edits', edits);
          idbSet('coverEdits', coverEdits);
          closeModal();
          scanTags(list);
          toast('Restored the file’s own info', 1500);
        });
        return function () { coverPicked = null; };
      }, 'wide');
  }
  var coverPicked = null;
  $('coverInput').addEventListener('change', function () {
    if (this.files[0] && coverPicked) coverPicked(this.files[0]);
    this.value = '';
  });

  /* ---------------- keeping picked songs on phones ---------------- */
  // Phones can't remember folders, so songs added with "Choose songs" can be kept in the
  // browser's storage — then they're there every time you open Tunebox, even offline.
  function keepFilesOn() { return typeof settings.keepFiles === 'boolean' ? settings.keepFiles : (IS_PHONE || !hasFSA); }
  function fdbOpen() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('tunebox-files', 1);
      r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains('files')) r.result.createObjectStore('files'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  // Songs are copied into Tunebox's storage one by one in the background (never all at once —
  // a huge single copy can use so much memory that a phone closes other apps).
  var storeQueue = [], storing = false, storeDone = 0, storeTotal = 0;
  var KEEP_RE = /\.(mp3|m4a|m4b|aac|flac|wav|aiff?|ogg|oga|opus|webm|lrc|jpe?g|png)$/i;
  function storeFiles(entries, opts) {
    if (!keepFilesOn() || !entries.length) return;
    var list = entries.filter(function (e) { return KEEP_RE.test(e.file.name); });
    if (!list.length) return;
    // asking every file for its size is slow on phones, so estimate from a sample
    var sample = list.length > 60 ? list.filter(function (e, i) { return i % Math.ceil(list.length / 40) === 0; }) : list;
    var bytes = sample.reduce(function (n, e) { return n + (e.file.size || 0); }, 0) * (list.length / sample.length);
    if (bytes > 400 * 1048576 && !(opts && opts.confirmed)) { askToStore(list, bytes); return; }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    storeQueue = storeQueue.concat(list);
    storeTotal += list.length;
    pumpStore();
  }
  function fmtBytes(n) { return n > 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : Math.round(n / 1048576) + ' MB'; }
  function askToStore(list, bytes) {
    var go = function () { storeFiles(list, { confirmed: true }); };
    var est = navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve(null);
    est.then(function (e) {
      var free = e ? (e.quota || 0) - (e.usage || 0) : Infinity;
      var fits = bytes < free * 0.85;
      openModal('<h3>Keep these songs on this phone?</h3><p class="modal-sub">' + plural(list.length, 'song') + ' (' + fmtBytes(bytes) + '). ' +
        'Keeping copies means they’re still here after you close Tunebox, even if the SD card or USB drive is removed. Copying happens slowly in the background so your phone stays smooth.' +
        (fits ? '' : '<br><br><b>There isn’t enough free space for all of them.</b> Tunebox will copy what fits.') + '</p>' +
        '<div class="modal-actions wrap"><button class="btn" data-close id="storeNo">Don’t copy — I’ll pick the folder again</button><button class="btn primary" id="storeYes">Keep copies</button></div>',
        function (m) { m.querySelector('#storeYes').onclick = function () { closeModal(); go(); }; });
    });
  }
  async function pumpStore() {
    if (storing) return;
    storing = true;
    var db;
    try { db = await fdbOpen(); } catch (e) { storing = false; return; }
    var full = false;
    while (storeQueue.length && !full) {
      var e = storeQueue.shift();
      await breathe();
      if (IS_PHONE && !audio.paused) await sleepMs(120);
      try {
        await new Promise(function (res, rej) {
          var tx = db.transaction('files', 'readwrite');
          tx.objectStore('files').put({ blob: e.file, name: e.file.name, type: e.file.type, lm: e.file.lastModified }, e.path);
          tx.oncomplete = res;
          tx.onerror = function () { rej(tx.error); };
          tx.onabort = function () { rej(tx.error); };
        });
      } catch (err) {
        if (err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''))) {
          full = true;
          toast('Phone storage is full — ' + plural(storeQueue.length + 1, 'song') + ' weren’t copied.', 4500);
        }
      }
      storeDone++;
      if (storeDone % 10 === 0 || !storeQueue.length) setStatus(storeQueue.length ? 'Saving songs on this device… ' + storeDone + ' / ' + storeTotal : '');
    }
    storeQueue = [];
    storeDone = storeTotal = 0;
    storing = false;
    if (!full) setStatus(plural(state.tracks.length, 'song'));
  }
  function loadStoredFiles() {
    return fdbOpen().then(function (db) {
      return new Promise(function (res) {
        var out = [];
        var req = db.transaction('files').objectStore('files').openCursor();
        req.onsuccess = function () {
          var c = req.result;
          if (!c) { res(out); return; }
          var v = c.value, f;
          try { f = new File([v.blob], v.name, { type: v.type, lastModified: v.lm }); } catch (e) { f = v.blob; f.name = v.name; }
          out.push({ file: f, path: c.key });
          c.continue();
        };
        req.onerror = function () { res(out); };
      });
    }).catch(function () { return []; });
  }
  function clearStoredFiles() {
    return fdbOpen().then(function (db) {
      return new Promise(function (res) { var tx = db.transaction('files', 'readwrite'); tx.objectStore('files').clear(); tx.oncomplete = tx.onerror = function () { res(); }; });
    }).catch(function () {});
  }
  var storageText = '';
  function updateStorageText() {
    if (!navigator.storage || !navigator.storage.estimate) return;
    navigator.storage.estimate().then(function (e) {
      storageText = Math.round((e.usage || 0) / 1048576) + ' MB used of about ' + Math.round((e.quota || 0) / 1073741824) + ' GB available';
      if (state.view === 'settings') renderSettings();
    });
  }

  /* ---------------- share to Tunebox (Android) ---------------- */
  function receiveShared() {
    if (!/[?&]shared=1/.test(location.search)) return;
    idbGet('shared').then(function (list) {
      list = list || [];
      if (!list.length) return;
      var entries = list.map(function (x) {
        var f;
        try { f = new File([x.blob], x.name, { type: x.type }); } catch (e) { f = x.blob; f.name = x.name; }
        return { file: f, path: 'Shared/' + x.name };
      });
      idbSet('shared', []);
      ingest(entries, 'Shared');
      storeFiles(entries);
      var ids = entries.map(function (e) { var t = state.byPath.get(e.path); return t ? t.id : null; }).filter(function (x) { return x !== null; });
      if (ids.length) playIds(ids, 0);
    });
    try { window.history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
  }

  /* ---------------- sync between devices (QR / link / backup file) ---------------- */
  function b64u(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(str) {
    var s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function pack(obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (window.CompressionStream) {
      try {
        var cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        var ab = await new Response(cs).arrayBuffer();
        return 'z' + b64u(new Uint8Array(ab));
      } catch (e) { /* fall back */ }
    }
    return 'j' + b64u(bytes);
  }
  async function unpack(str) {
    var bytes = unb64u(str.slice(1));
    if (str[0] === 'z') {
      var ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(ds).arrayBuffer());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function syncPayload(full) {
    var favList = state.tracks.filter(isFav).map(trackKey).concat(Array.from(favKeys));
    var p = {
      v: 1,
      pl: playlists.map(function (x) { return { n: x.name, k: x.items.map(function (it) { return it.k; }) }; }),
      f: Array.from(new Set(favList)),
      eq: eq,
      s: { accent: settings.accent, theme: settings.theme, crossfade: settings.crossfade, djVariety: settings.djVariety, preamp: settings.preamp, level: settings.level }
    };
    if (full) {
      p.stats = {};
      Object.keys(stats).forEach(function (path) { var t = state.byPath.get(path); if (t) p.stats[trackKey(t)] = stats[path]; });
      p.daily = daily;
      p.edits = {};
      Object.keys(edits).forEach(function (path) { var t = state.byPath.get(path); if (t) p.edits[trackKey(t)] = edits[path]; });
    }
    return p;
  }
  function applyPayload(p, quiet) {
    var nPl = 0, nFav = 0;
    (p.pl || []).forEach(function (x) {
      var mine = playlists.filter(function (y) { return y.name === x.n; })[0];
      if (!mine) { mine = { id: 'pl' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), name: x.n, items: [], created: Date.now() }; playlists.push(mine); nPl++; }
      var have = new Set(mine.items.map(function (it) { return it.k; }));
      (x.k || []).forEach(function (k) {
        if (have.has(k)) return;
        var t = byKey(k);
        mine.items.push({ p: t ? t.path : '', k: k });
        have.add(k);
      });
    });
    (p.f || []).forEach(function (k) { var t = byKey(k); if (t) { if (!favs[t.path]) { favs[t.path] = 1; nFav++; } } else if (!favKeys.has(k)) { favKeys.add(k); nFav++; } });
    if (p.eq && p.eq.length === EQ_BANDS.length) setEq(p.eq);
    if (p.s) Object.keys(p.s).forEach(function (k) { if (p.s[k] !== undefined && p.s[k] !== null) settings[k] = p.s[k]; });
    if (p.stats) Object.keys(p.stats).forEach(function (k) { var t = byKey(k); if (t && !stats[t.path]) stats[t.path] = p.stats[k]; });
    if (p.daily) Object.keys(p.daily).forEach(function (k) { daily[k] = Math.max(daily[k] || 0, p.daily[k]); });
    if (p.edits) Object.keys(p.edits).forEach(function (k) { var t = byKey(k); if (t && !edits[t.path]) { edits[t.path] = p.edits[k]; applyEdit(t); } });
    lsSet('tunebox.favs', Object.keys(favs));
    lsSet('tunebox.favKeys', Array.from(favKeys));
    lsSet('tunebox.daily', daily);
    idbSet('edits', edits);
    saveStatsSoon();
    savePlaylists();
    saveSettings();
    applyTheme();
    applyLook();
    applyFx();
    invalidate();
    renderAll();
    if (!quiet) toast('Imported ' + plural(nPl, 'playlist') + ' and ' + plural(nFav, 'favourite'), 2600);
    else if (nPl || nFav) toast('Synced ' + (nPl ? plural(nPl, 'new playlist') : plural(nFav, 'favourite')), 1600);
  }
  async function openSync() {
    var link = location.origin + location.pathname + '#sync=' + await pack(syncPayload(false));
    var qrHtml = '';
    if (window.qrcode && link.length < 2900) {
      try {
        var q = window.qrcode(0, 'L');
        q.addData(link);
        q.make();
        qrHtml = '<div class="qr">' + q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) + '</div>';
      } catch (e) { qrHtml = ''; }
    }
    if (!qrHtml) qrHtml = '<p class="modal-sub">Too many playlists for a QR code — use <b>Copy link</b> or <b>Export backup</b> instead.</p>';
    openModal('<h3>Send to another device</h3>' +
      '<p class="modal-sub">Scan with your phone’s camera to copy your <b>playlists, favourites, equalizer and look</b>. Songs aren’t sent — add the same music on the other device and Tunebox matches them up by title and artist.</p>' +
      qrHtml +
      '<div class="modal-actions wrap">' +
        '<button class="btn" id="syncCopy">Copy link</button>' +
        (navigator.share ? '<button class="btn" id="syncShare">Share…</button>' : '') +
        '<button class="btn" id="syncExport">Export backup file</button>' +
        '<button class="btn" id="syncImport">Import backup…</button>' +
        '<span class="spacer"></span><button class="btn primary" data-close>Done</button>' +
      '</div>',
      function (m) {
        m.querySelector('#syncCopy').addEventListener('click', function () {
          (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { toast('Link copied', 1400); }, function () { prompt('Copy this link:', link); });
        });
        var sh = m.querySelector('#syncShare');
        if (sh) sh.addEventListener('click', function () { navigator.share({ title: 'Tunebox playlists', url: link }).catch(function () {}); });
        m.querySelector('#syncExport').addEventListener('click', exportBackup);
        m.querySelector('#syncImport').addEventListener('click', function () { $('importInput').click(); });
      }, 'wide');
  }
  function exportBackup() {
    var data = JSON.stringify({ tunebox: 1, exported: new Date().toISOString(), data: syncPayload(true) }, null, 1);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = 'tunebox-backup-' + dayKey() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Backup saved to your downloads', 1800);
  }
  $('importInput').addEventListener('change', function () {
    var f = this.files[0];
    this.value = '';
    if (!f) return;
    readText(f).then(function (txt) {
      var j = JSON.parse(txt);
      if (!j || !j.data) throw new Error('not a Tunebox backup');
      closeModal();
      applyPayload(j.data);
    }).catch(function () { toast('That file isn’t a Tunebox backup.'); });
  });
  function receiveSync() {
    var m = /#sync=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m) return;
    try { window.history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    unpack(m[1]).then(function (p) {
      openModal('<h3>Import from another device?</h3><p class="modal-sub">' + plural((p.pl || []).length, 'playlist') + ', ' + plural((p.f || []).length, 'favourite') +
        ', equalizer and look settings. Nothing is removed — this adds to what you already have.</p>' +
        '<div class="modal-actions"><button class="btn" data-close>Not now</button><button class="btn primary" id="syncOk">Import</button></div>',
        function (mm) { mm.querySelector('#syncOk').addEventListener('click', function () { closeModal(); applyPayload(p); }); });
    }).catch(function () { toast('That sync link is broken or incomplete.'); });
  }

  /* ---------------- phone "Browse" sheet ---------------- */
  function openBrowse() {
    var items = [
      ['albums', 'Albums', 'view'], ['artists', 'Artists', 'view'], ['playlists', 'Playlists', 'view'], ['favorites', 'Favourites', 'view'],
      ['queue', 'Up Next', 'view'], ['stats', 'Listening Stats', 'view'], ['eq', 'Equalizer & Vibes', 'cmd'], ['sleep', 'Sleep timer', 'cmd'],
      ['open-folder', IS_IOS ? 'Add songs' : 'Add a music folder', 'cmd'], ['rescan', 'Check for new songs', 'cmd'], ['car', 'Car mode', 'cmd'], ['output', 'Play on… / Cast', 'cmd'], ['connect', 'Connect devices', 'view'], ['sync', 'Copy settings to another device', 'cmd'], ['add-files', 'Add songs', 'cmd']
    ].filter(function (it) { return !(IS_IOS && it[0] === 'open-folder'); });
    openModal('<h3>Browse</h3><div class="browse-list">' + items.map(function (it) {
      return '<button ' + (it[2] === 'view' ? 'data-view="' + it[0] + '"' : 'data-cmd="' + it[0] + '"') + ' data-close>' + it[1] + '<span>›</span></button>';
    }).join('') + '</div>', null, 'sheet');
  }

  /* =====================================================================
     Connect devices: phone remote, send songs, live sync, party queue.
     Devices talk directly (WebRTC, encrypted). They only need to swap a small
     "hello" once — by scanning QR codes (works offline, e.g. over a phone hotspot)
     or through a free public relay (PeerJS) when both are online.
     ===================================================================== */

  var STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  var peers = [];          // { id, pc, dc, name, role, kind, open, remoteState, files }
  var relay = null;        // { ws, id, open, onmsg }
  var hostPending = null;  // our own offer for offline pairing { pc, dc, peer }
  var remotePeer = null;   // the peer we're currently remote-controlling
  var partyOn = false;
  var syncMuted = false;

  function defaultDeviceName() {
    if (IS_IOS) return /iPad/.test(navigator.userAgent) ? 'iPad' : 'iPhone';
    if (IS_ANDROID) return 'Android phone';
    if (/Windows/.test(navigator.userAgent)) return 'Windows PC';
    if (/Mac/.test(navigator.userAgent)) return 'Mac';
    return 'Computer';
  }
  function deviceName() { return settings.deviceName || defaultDeviceName(); }
  function randId(n) {
    var a = new Uint8Array(n || 8), s = '';
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (var i = 0; i < a.length; i++) s += 'abcdefghijkmnpqrstuvwxyz23456789'[a[i] % 32];
    return s;
  }

  /* ---------------- relay (only used to say hello, via PeerJS) ---------------- */
  function loadScript(src, test) {
    if (test()) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { test() ? res() : rej(new Error('load')); };
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  function relayConnect() {
    if (relay && relay.ready && !relay.dead) return relay.ready;
    relay = { id: 'tunebox-' + randId(10), open: false, dead: false, peer: null };
    var r = relay;
    r.ready = loadScript('js/vendor/peerjs.js', function () { return !!window.Peer; }).then(function () {
      return new Promise(function (resolve, reject) {
        var pj = new window.Peer(r.id, { debug: 0, config: { iceServers: STUN } });
        r.peer = pj;
        var t = setTimeout(function () { r.dead = true; try { pj.destroy(); } catch (e) {} reject(new Error('timeout')); }, 8000);
        pj.on('open', function () { clearTimeout(t); r.open = true; resolve(r); });
        pj.on('error', function (e) {
          if (!r.open) { clearTimeout(t); r.dead = true; reject(e); return; }
          if (e && e.type === 'peer-unavailable') r.lastError = 'unavailable';
        });
        pj.on('disconnected', function () { if (!r.dead) { try { pj.reconnect(); } catch (e) {} } });
        pj.on('close', function () { r.dead = true; r.open = false; });
        pj.on('connection', onRelayConnection);
      });
    });
    r.ready.catch(function () { r.dead = true; });
    return r.ready;
  }
  // someone scanned our code (or joined the party)
  function onRelayConnection(conn) {
    var md = conn.metadata || {};
    if (md.kind === 'guest' && !partyOn) { setTimeout(function () { try { conn.close(); } catch (e) {} }, 300); toast('Someone tried to join your party, but party mode is off.'); return; }
    conn.on('open', function () { adoptConn(conn, 'answerer', md.name, md.kind === 'guest' ? 'guest' : 'device'); });
  }
  // turn a PeerJS connection into one of our peers (we use its data channel directly)
  function adoptConn(conn, side, name, kind, extra) {
    var peer = { id: randId(6), pc: conn.peerConnection, dc: null, name: name || 'Device', kind: kind, side: side, open: false, remoteState: null, incoming: null, conn: conn };
    if (extra) Object.keys(extra).forEach(function (k) { peer[k] = extra[k]; });
    peers.push(peer);
    if (peer.pc) peer.pc.addEventListener('connectionstatechange', function () { if (peer.pc.connectionState === 'failed' || peer.pc.connectionState === 'closed') dropPeer(peer); });
    attachChannel(peer, conn.dataChannel);
    if (conn.dataChannel.readyState === 'open') conn.dataChannel.onopen();
    return peer;
  }
  function relayDial(dst, name, kind, extra) {
    return relayConnect().then(function (r) {
      return new Promise(function (resolve) {
        var conn = r.peer.connect(dst, { serialization: 'raw', reliable: true, metadata: { name: kind === 'guest' ? (settings.deviceName || 'Guest') : deviceName(), kind: kind } });
        var done = false;
        var t = setTimeout(function () { if (!done) { done = true; try { conn.close(); } catch (e) {} resolve(null); } }, 10000);
        conn.on('open', function () { if (done) return; done = true; clearTimeout(t); resolve(adoptConn(conn, 'offerer', name, kind, extra)); });
        conn.on('error', function () { if (!done) { done = true; clearTimeout(t); resolve(null); } });
      });
    });
  }

  /* ---------------- WebRTC peers ---------------- */
  function newPeer(side, name, kind) {
    var pc = new RTCPeerConnection({ iceServers: navigator.onLine === false ? [] : STUN });
    var peer = { id: randId(6), pc: pc, dc: null, name: name || 'Device', kind: kind || 'device', side: side, open: false, remoteState: null, incoming: null };
    peers.push(peer);
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') dropPeer(peer);
    };
    pc.ondatachannel = function (e) { attachChannel(peer, e.channel); };
    return peer;
  }
  function waitIce(pc, ms) {
    return new Promise(function (res) {
      if (pc.iceGatheringState === 'complete') { res(); return; }
      var t = setTimeout(res, ms || 3000);
      pc.addEventListener('icegatheringstatechange', function () { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }
  async function makeOffer(peer) {
    attachChannel(peer, peer.pc.createDataChannel('tunebox', { ordered: true }));
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    await waitIce(peer.pc, 2500);
    return peer.pc.localDescription.sdp;
  }
  async function acceptOffer(peer, sdp) {
    await peer.pc.setRemoteDescription({ type: 'offer', sdp: sdp });
    await peer.pc.setLocalDescription(await peer.pc.createAnswer());
    await waitIce(peer.pc, 2500);
    return peer.pc.localDescription.sdp;
  }
  function dropPeer(peer) {
    if (peers.indexOf(peer) < 0) return;
    peers = peers.filter(function (x) { return x !== peer; });
    try { peer.dc && peer.dc.close(); } catch (e) {}
    try { peer.pc.close(); } catch (e) {}
    try { peer.conn && peer.conn.close(); } catch (e) {}
    if (remotePeer === peer) remotePeer = null;
    if (peer.open) toast(peer.name + ' disconnected', 1800);
    refreshConnectUi();
  }
  function attachChannel(peer, dc) {
    peer.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 1 << 20;
    dc.onopen = function () {
      peer.open = true;
      send(peer, { t: 'hello', name: deviceName(), kind: peer.kind === 'guest' && peer.side === 'offerer' ? 'guest' : 'device', songs: state.tracks.length, party: partyOn });
      if (peer.kind !== 'guest') pushSync(peer);
      sendState(peer);
      if (!(peer.kind === 'guest' && peer.side === 'answerer')) closeModal();
      if ((peer.kind === 'guest' && peer.side === 'offerer') || peer.autoRemote) { remotePeer = peer; setView('remote'); }
      toast('Connected to ' + peer.name, 2000);
      refreshConnectUi();
    };
    dc.onclose = function () { dropPeer(peer); };
    dc.onmessage = function (e) { onPeerMessage(peer, e.data); };
  }
  function send(peer, obj) {
    if (peer && peer.dc && peer.dc.readyState === 'open') {
      try { peer.dc.send(JSON.stringify(obj)); } catch (e) { /* channel busy */ }
    }
  }
  function devicePeers() { return peers.filter(function (p) { return p.open && p.kind !== 'guest'; }); }

  /* ---------------- packing codes for QR ---------------- */
  // SDP is squeezed (deflate + base64url) so it fits in a QR code you can scan easily
  async function packCode(obj) { return pack(obj); }
  async function unpackCode(str) { return unpack(str); }
  function joinLink(code) { return location.origin + location.pathname + '#join=' + code; }
  function qrSvg(text, cell) {
    try {
      var q = window.qrcode(0, 'L');
      q.addData(text);
      q.make();
      return q.createSvgTag({ cellSize: cell || 4, margin: 2, scalable: true });
    } catch (e) { return ''; }
  }

  /* ---------------- pairing flows ---------------- */
  // 1) This device shows a code; the other device scans it.
  async function startHosting() {
    var online = navigator.onLine !== false;
    openModal('<h3>Connect a device</h3><p class="modal-sub">Getting a code ready…</p><div class="qr-wait"></div>', null, 'wide');
    var relayOk = false;
    if (online) { try { await relayConnect(); relayOk = true; } catch (e) { relayOk = false; } }
    if (hostPending) { dropPeer(hostPending.peer); hostPending = null; }
    var peer = newPeer('offerer', 'Device', 'device');
    var sdp = await makeOffer(peer);
    hostPending = { peer: peer };
    var code = await packCode({ v: 1, o: sdp, r: relayOk ? relay.id : '', n: deviceName() });
    var link = joinLink(code);
    var svg = qrSvg(link, 3);
    openModal('<h3>Connect a device</h3>' +
      '<p class="modal-sub">On your phone or other computer, <b>scan this code with the camera</b> (or open Tunebox there → Connect → Scan). ' +
      (relayOk ? 'Works on any network.' : 'You’re offline — that’s fine on the same Wi-Fi or hotspot; you’ll scan a code back.') + '</p>' +
      (svg ? '<div class="qr big">' + svg + '</div>' : '<p class="modal-sub">This code is too long for a QR — use Copy link.</p>') +
      '<div class="modal-actions wrap">' +
        '<button class="btn" id="hostCopy">Copy link</button>' +
        (navigator.share ? '<button class="btn" id="hostShare">Share…</button>' : '') +
        '<button class="btn" id="hostScanBack">Scan their reply</button>' +
        '<button class="btn" id="hostPaste">Paste reply</button>' +
        '<span class="spacer"></span><button class="btn" data-close>Close</button>' +
      '</div>',
      function (m) {
        m.querySelector('#hostCopy').addEventListener('click', function () { copyText(link); });
        var sh = m.querySelector('#hostShare');
        if (sh) sh.addEventListener('click', function () { navigator.share({ title: 'Connect to Tunebox', url: link }).catch(function () {}); });
        m.querySelector('#hostScanBack').addEventListener('click', function () { openScanner(); });
        m.querySelector('#hostPaste').addEventListener('click', function () { askText('Paste the reply code', '', 'Connect', handleCode); });
      }, 'wide');
  }
  // 2) This device received a code (scanned, pasted or opened as a link).
  async function handleCode(text) {
    var m = /join=([A-Za-z0-9_-]+)/.exec(text) || /reply=([A-Za-z0-9_-]+)/.exec(text) || /^([zj][A-Za-z0-9_-]{20,})$/.exec(text.trim());
    if (!m) { toast('That isn’t a Tunebox code.'); return; }
    var data;
    try { data = await unpackCode(m[1]); } catch (e) { toast('That code looks broken — try again.'); return; }
    if (data.a) { // a reply to our own offline offer
      if (!hostPending) { toast('Open “Connect a device” again, then scan the reply.'); return; }
      hostPending.peer.name = data.n || 'Device';
      hostPending.peer.pc.setRemoteDescription({ type: 'answer', sdp: data.a }).catch(function () { toast('Couldn’t connect with that reply.'); });
      return;
    }
    if (data.party) { joinParty(data); return; }
    if (!data.o) { toast('That isn’t a Tunebox code.'); return; }
    openModal('<h3>Connecting to ' + esc(data.n || 'device') + '…</h3><p class="modal-sub">One moment.</p>', null);
    // Prefer the relay when it's reachable: no second scan needed.
    if (data.r && navigator.onLine !== false) {
      try {
        var p1 = await relayDial(data.r, data.n, 'device', { autoRemote: true });
        if (p1) { if (hostPending) { dropPeer(hostPending.peer); hostPending = null; } return; }
      } catch (e) { /* fall back to scanning a reply */ }
    }
    // Offline: answer their offer and show a reply code for them to scan.
    var p2 = newPeer('answerer', data.n, 'device');
    p2.autoRemote = true;
    var ans = await acceptOffer(p2, data.o);
    var reply = await packCode({ v: 1, a: ans, n: deviceName() });
    var svg = qrSvg(reply, 3);
    openModal('<h3>Almost there</h3><p class="modal-sub">On <b>' + esc(data.n || 'the other device') + '</b>, tap <b>Scan their reply</b> and point it at this code. (Or copy it and paste it there.)</p>' +
      (svg ? '<div class="qr big">' + svg + '</div>' : '') +
      '<div class="modal-actions"><button class="btn" id="replyCopy">Copy reply code</button><span class="spacer"></span><button class="btn" data-close>Close</button></div>',
      function (mm) { mm.querySelector('#replyCopy').addEventListener('click', function () { copyText(reply); }); }, 'wide');
  }
  function waitOpen(peer, ms) {
    return new Promise(function (res) {
      var t0 = Date.now();
      (function check() {
        if (peer.open) { res(true); return; }
        if (Date.now() - t0 > ms || peers.indexOf(peer) < 0) { res(false); return; }
        setTimeout(check, 200);
      })();
    });
  }
  function copyText(s) {
    (navigator.clipboard ? navigator.clipboard.writeText(s) : Promise.reject()).then(function () { toast('Copied', 1200); }, function () { prompt('Copy this:', s); });
  }

  /* ---------------- party mode ---------------- */
  async function startParty() {
    try { await relayConnect(); } catch (e) { toast('Party mode needs internet on this device (so guests can find it).', 3500); return; }
    partyOn = true;
    var code = await packCode({ v: 1, party: 1, r: relay.id, n: deviceName() });
    var link = joinLink(code);
    openModal('<h3>🎉 Party mode is on</h3><p class="modal-sub">Friends scan this to add songs to your queue from their phones — no app needed.</p>' +
      '<div class="qr big">' + qrSvg(link, 3) + '</div>' +
      '<div class="modal-actions wrap"><button class="btn" id="partyCopy">Copy link</button><button class="btn" id="partyStop">End party</button><span class="spacer"></span><button class="btn primary" data-close>Done</button></div>',
      function (m) {
        m.querySelector('#partyCopy').addEventListener('click', function () { copyText(link); });
        m.querySelector('#partyStop').addEventListener('click', function () { stopParty(); closeModal(); });
      }, 'wide');
    refreshConnectUi();
  }
  function stopParty() {
    partyOn = false;
    peers.filter(function (p) { return p.kind === 'guest'; }).forEach(function (p) { send(p, { t: 'bye' }); dropPeer(p); });
    toast('Party ended', 1400);
    refreshConnectUi();
  }
  async function joinParty(data) {
    openModal('<h3>Joining ' + esc(data.n || 'the party') + '…</h3><p class="modal-sub">One moment.</p>', null);
    try {
      var p = await relayDial(data.r, data.n, 'guest');
      if (!p) { closeModal(); toast('Couldn’t reach the party. Is party mode still on?', 3000); }
    } catch (e) { closeModal(); toast('Joining a party needs internet.', 3000); }
  }

  /* ---------------- messages ---------------- */
  var FILE_CHUNK = 64 * 1024;
  function onPeerMessage(peer, data) {
    if (typeof data !== 'string') { receiveChunk(peer, data); return; }
    var msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    var trusted = peer.kind !== 'guest';
    switch (msg.t) {
      case 'hello':
        peer.name = msg.name || peer.name;
        peer.songs = msg.songs;
        if (msg.kind === 'guest') peer.kind = 'guest';
        refreshConnectUi();
        break;
      case 'state':
        peer.remoteState = msg.s;
        if (remotePeer === peer && state.view === 'remote') renderRemote();
        break;
      case 'cmd':
        if (!trusted && !(settings.guestControl && ['toggle', 'next'].indexOf(msg.c) >= 0)) return;
        runRemoteCmd(msg);
        break;
      case 'lib':
        send(peer, { t: 'libres', q: msg.q, items: searchForRemote(msg.q || '', msg.limit || 60) });
        break;
      case 'libres':
        if (remotePeer === peer) { peer.libResults = msg.items; renderRemoteLib(); }
        break;
      case 'play':
        if (!trusted) return;
        var tp = state.byId.get(msg.id);
        if (tp) { var all = state.tracks.slice().sort(defaultOrder).map(function (x) { return x.id; }); playIds(all, all.indexOf(tp.id)); }
        break;
      case 'addq':
        var tq = state.byId.get(msg.id);
        if (!tq) return;
        queueInsert([tq.id], !!msg.next && trusted);
        if (!trusted) toast((peer.name || 'A guest') + ' added “' + tq.title + '”', 2600);
        send(peer, { t: 'ok', msg: 'Added “' + tq.title + '” to the queue' });
        break;
      case 'ok':
        toast(msg.msg, 1800);
        break;
      case 'sync':
        if (!trusted || settings.liveSync === false) return;
        syncMuted = true;
        try { applyPayload(msg.p, true); } finally { syncMuted = false; }
        break;
      case 'file-start':
        if (!trusted) return;
        peer.incoming = { id: msg.id, name: msg.name, type: msg.type, size: msg.size, got: 0, parts: [], idx: msg.idx, total: msg.total };
        updateTransfer(peer.name, msg.name, 0, msg.idx, msg.total, 'in');
        break;
      case 'file-end':
        finishIncoming(peer);
        break;
      case 'bye':
        dropPeer(peer);
        break;
    }
  }
  function runRemoteCmd(msg) {
    switch (msg.c) {
      case 'toggle': toggle(); break;
      case 'next': next(false); break;
      case 'prev': prev(); break;
      case 'seek': if (audio.duration) audio.currentTime = Math.max(0, Math.min(audio.duration, msg.v)); break;
      case 'vol': setVolume(msg.v); break;
      case 'dj': toggleDj(); break;
      case 'shuffle': toggleShuffle(); break;
      case 'fav': toggleFav(); break;
    }
    broadcastStateSoon();
  }
  function searchForRemote(q, limit) {
    var tm = q.toLowerCase().split(/\s+/).filter(Boolean);
    var out = [];
    var list = tm.length ? state.tracks : state.tracks.slice().sort(defaultOrder);
    for (var i = 0; i < list.length && out.length < limit; i++) {
      var t = list[i];
      if (tm.length && !matches(t, tm)) continue;
      out.push({ id: t.id, title: t.title, artist: t.artist, album: t.album, d: Math.round(t.duration || 0) });
    }
    return out;
  }

  /* ---------------- sharing what's playing ---------------- */
  var thumbCache = {};
  function smallCover(t) {
    if (!t) return Promise.resolve('');
    if (thumbCache[t.albumKey] !== undefined) return Promise.resolve(thumbCache[t.albumKey]);
    return getCover(t).then(function (c) {
      if (!c || !c.url) { thumbCache[t.albumKey] = ''; return ''; }
      return new Promise(function (res) {
        var img = new Image();
        img.onload = function () {
          var cv = document.createElement('canvas');
          cv.width = cv.height = 160;
          cv.getContext('2d').drawImage(img, 0, 0, 160, 160);
          var u = '';
          try { u = cv.toDataURL('image/jpeg', 0.72); } catch (e) { u = ''; }
          thumbCache[t.albumKey] = u;
          res(u);
        };
        img.onerror = function () { thumbCache[t.albumKey] = ''; res(''); };
        img.src = c.url;
      });
    });
  }
  function nowState() {
    var t = state.current;
    return {
      t: t ? { id: t.id, title: t.title, artist: t.artist, album: t.album } : null,
      pos: audio.currentTime || 0, dur: audio.duration || (t && t.duration) || 0,
      playing: !audio.paused, vol: muted ? 0 : vol, dj: !!settings.dj, shuffle: state.shuffle,
      fav: !!(t && isFav(t)), name: deviceName(), guestControl: isOn('guestControl'),
      next: state.queue.slice(state.qIndex + 1, state.qIndex + 6).map(function (id) { var x = state.byId.get(id); return x ? { title: x.title, artist: x.artist } : null; }).filter(Boolean)
    };
  }
  function sendState(peer) {
    var s = nowState();
    smallCover(state.current).then(function (cov) { s.cover = cov; send(peer, { t: 'state', s: s }); });
  }
  var broadcastStateSoon = throttle(function () { peers.forEach(function (p) { if (p.open) sendState(p); }); }, 700);
  setInterval(function () { if (peers.some(function (p) { return p.open; })) broadcastStateSoon(); }, 3000);
  ['play', 'pause', 'seeked', 'volumechange'].forEach(function (ev) { decks.forEach(function (d) { d.addEventListener(ev, function () { if (this === audio) broadcastStateSoon(); }); }); });

  /* ---------------- live sync (playlists, favourites, settings) ---------------- */
  function pushSync(peer) {
    if (settings.liveSync === false || syncMuted) return;
    var p = syncPayload(false);
    (peer ? [peer] : devicePeers()).forEach(function (x) { send(x, { t: 'sync', p: p }); });
  }
  var lastSyncSent = '';
  var pushSyncDeb = debounce(function () {
    var j = JSON.stringify(syncPayload(false));
    if (j === lastSyncSent) return;
    lastSyncSent = j;
    pushSync();
  }, 1500);
  function pushSyncSoon() { if (!syncMuted) pushSyncDeb(); }

  /* ---------------- sending songs ---------------- */
  var sendQueue = [], sending = false;
  function sendTracks(peer, list) {
    if (!peer || !peer.open) { toast('Connect a device first.'); return; }
    list.forEach(function (t) { sendQueue.push({ peer: peer, file: t.file || t, name: (t.file ? t.file.name : t.name) }); });
    toast('Sending ' + plural(list.length, 'song') + ' to ' + peer.name + '…', 2000);
    pumpSend();
  }
  async function pumpSend() {
    if (sending) return;
    sending = true;
    var total = sendQueue.length, idx = 0;
    while (sendQueue.length) {
      var job = sendQueue.shift();
      idx++;
      var dc = job.peer.dc;
      if (!dc || dc.readyState !== 'open') continue;
      var id = randId(6), f = job.file;
      send(job.peer, { t: 'file-start', id: id, name: job.name, type: f.type, size: f.size, idx: idx, total: total + sendQueue.length });
      for (var off = 0; off < f.size; off += FILE_CHUNK) {
        if (dc.readyState !== 'open') break;
        if (dc.bufferedAmount > 4 * (1 << 20)) {
          await new Promise(function (res) { dc.onbufferedamountlow = function () { dc.onbufferedamountlow = null; res(); }; });
        }
        var chunk = await readAB(f.slice(off, Math.min(f.size, off + FILE_CHUNK)));
        try { dc.send(chunk); } catch (e) { await new Promise(function (r) { setTimeout(r, 50); }); off -= FILE_CHUNK; continue; }
        if ((off / FILE_CHUNK) % 32 === 0) updateTransfer(job.peer.name, job.name, off / f.size, idx, total, 'out');
      }
      send(job.peer, { t: 'file-end', id: id });
      updateTransfer(job.peer.name, job.name, 1, idx, total, 'out');
    }
    sending = false;
    toast('Sent ✓', 1500);
  }
  function receiveChunk(peer, buf) {
    var inc = peer.incoming;
    if (!inc) return;
    inc.parts.push(buf);
    inc.got += buf.byteLength;
    if (inc.parts.length % 32 === 0) updateTransfer(peer.name, inc.name, inc.got / inc.size, inc.idx, inc.total, 'in');
  }
  var receivedBatch = [], receivedFlush = debounce(function () {
    var batch = receivedBatch;
    receivedBatch = [];
    ingest(batch, 'Received');
    storeFiles(batch);
  }, 800);
  function finishIncoming(peer) {
    var inc = peer.incoming;
    peer.incoming = null;
    if (!inc) return;
    var f;
    try { f = new File(inc.parts, inc.name, { type: inc.type }); } catch (e) { f = new Blob(inc.parts, { type: inc.type }); f.name = inc.name; }
    receivedBatch.push({ file: f, path: 'Received/' + inc.name });
    updateTransfer(peer.name, inc.name, 1, inc.idx, inc.total, 'in');
    receivedFlush();
  }
  var transfers = {};
  function updateTransfer(who, name, frac, idx, total, dir) {
    transfers[dir + who] = { who: who, name: name, frac: frac, idx: idx, total: total, dir: dir, at: Date.now() };
    if (state.view === 'connect') renderConnectTransfers();
  }
  function pickAndSend(peer) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.accept = 'audio/*,.mp3,.m4a,.flac,.wav,.ogg,.opus,.aac,.lrc';
    inp.onchange = function () { sendTracks(peer, Array.prototype.slice.call(inp.files)); };
    inp.click();
  }

  /* ---------------- QR scanner ---------------- */
  var scanStream = null;
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'js/vendor/jsqr.js';
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  async function openScanner() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      askText('Paste the code or link', '', 'Connect', handleCode);
      return;
    }
    openModal('<h3>Scan a Tunebox code</h3><p class="modal-sub">Point your camera at the QR code on the other device.</p>' +
      '<div class="scan-box"><video id="scanVideo" playsinline muted></video><div class="scan-frame"></div></div>' +
      '<div class="modal-actions"><button class="btn" id="scanPaste">Paste instead</button><span class="spacer"></span><button class="btn" data-close>Cancel</button></div>',
      function (m) {
        m.querySelector('#scanPaste').addEventListener('click', function () { closeModal(); askText('Paste the code or link', '', 'Connect', handleCode); });
        startScan(m.querySelector('#scanVideo'));
        return stopScan;
      }, 'wide');
  }
  async function startScan(video) {
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch (e) {
      closeModal();
      toast('Camera not available — paste the code instead.', 2600);
      askText('Paste the code or link', '', 'Connect', handleCode);
      return;
    }
    video.srcObject = scanStream;
    await video.play().catch(function () {});
    var detector = null;
    if ('BarcodeDetector' in window) { try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; } }
    if (!detector) { try { await loadJsQR(); } catch (e) { /* no decoder */ } }
    var cv = document.createElement('canvas'), ctx = cv.getContext('2d');
    var busy = false;
    var timer = setInterval(async function () {
      if (!scanStream) { clearInterval(timer); return; }
      if (busy || video.readyState < 2) return;
      busy = true;
      try {
        var text = '';
        if (detector) {
          var codes = await detector.detect(video);
          if (codes.length) text = codes[0].rawValue;
        } else if (window.jsQR) {
          var w = video.videoWidth, h = video.videoHeight, sc = Math.min(1, 640 / Math.max(w, h));
          cv.width = Math.round(w * sc); cv.height = Math.round(h * sc);
          ctx.drawImage(video, 0, 0, cv.width, cv.height);
          var img = ctx.getImageData(0, 0, cv.width, cv.height);
          var r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (r) text = r.data;
        }
        if (text) { clearInterval(timer); closeModal(); handleCode(text); }
      } catch (e) { /* keep trying */ }
      busy = false;
    }, 250);
  }
  function stopScan() {
    if (scanStream) { scanStream.getTracks().forEach(function (t) { t.stop(); }); scanStream = null; }
  }

  /* ---------------- Connect page ---------------- */
  function refreshConnectUi() {
    var n = peers.filter(function (p) { return p.open; }).length;
    $$('.conn-count').forEach(function (el) { el.textContent = n ? n : ''; });
    document.body.classList.toggle('has-peers', n > 0);
    if (state.view === 'connect') renderConnect();
    if (state.view === 'remote' && (!remotePeer || !remotePeer.open)) setView('connect');
  }
  function renderConnect() {
    var v = $('connectView');
    var open = peers.filter(function (p) { return p.open; });
    v.innerHTML =
      '<div class="conn-actions">' +
        '<button class="conn-big" data-cc="host"><b>Show my code</b><span>Let another device connect to this one</span></button>' +
        '<button class="conn-big" data-cc="scan"><b>Scan a code</b><span>Connect to a device showing a code</span></button>' +
        '<button class="conn-big party' + (partyOn ? ' on' : '') + '" data-cc="party"><b>' + (partyOn ? '🎉 Party is on' : 'Party mode') + '</b><span>' + (partyOn ? 'Show the code again or end it' : 'Friends add songs from their phones') + '</span></button>' +
      '</div>' +
      '<section class="set-card"><div class="set-card-head"><h3>Connected</h3><p>' + (open.length ? plural(open.length, 'device') : 'Nothing connected yet') + ' · this device is “' + esc(deviceName()) + '”</p></div>' +
        open.map(function (p) {
          var guest = p.kind === 'guest';
          return '<div class="set-row"><div class="set-text"><div class="set-title">' + esc(p.name) + (guest ? ' <em class="tag">guest</em>' : '') + '</div>' +
            '<div class="set-desc">' + (p.remoteState && p.remoteState.t ? 'Playing: ' + esc(p.remoteState.t.title) : (p.songs ? plural(p.songs, 'song') : 'Connected')) + '</div></div>' +
            '<div class="set-ctl conn-btns">' +
              (guest ? '' : sBtn('Control', 'data-cc="remote" data-p="' + p.id + '"', true) + sBtn('Send songs', 'data-cc="send" data-p="' + p.id + '"')) +
              sBtn('Disconnect', 'data-cc="drop" data-p="' + p.id + '"') +
            '</div></div>';
        }).join('') +
      '</section>' +
      '<section class="set-card"><div class="set-card-head"><h3>Transfers</h3></div><div id="connTransfers"></div></section>' +
      '<section class="set-card"><div class="set-card-head"><h3>Options</h3></div>' +
        sRow('This device’s name', esc(deviceName()), sBtn('Rename', 'data-cc="rename"')) +
        sRow('Live sync', 'Keep playlists, favourites and your sound the same on connected devices.', sSwitch('liveSync')) +
        sRow('Party guests can play / skip', 'Otherwise guests can only add songs to the queue.', sSwitch('guestControl')) +
        sRow('How it works', 'Devices connect directly and encrypted. Codes work offline over the same Wi-Fi or a phone hotspot. When online, a free relay (PeerJS) just introduces the devices — your music never goes through it.', '', 'wide') +
      '</section>';
    renderConnectTransfers();
  }
  function renderConnectTransfers() {
    var el = $('connTransfers');
    if (!el) return;
    var list = Object.keys(transfers).map(function (k) { return transfers[k]; }).filter(function (x) { return Date.now() - x.at < 10 * 60000; });
    el.innerHTML = list.length ? list.map(function (x) {
      return '<div class="bar-row"><span>' + (x.dir === 'in' ? '⬇ ' : '⬆ ') + esc(x.name) + '</span><div class="bar"><i style="width:' + Math.round(x.frac * 100) + '%"></i></div><em>' + x.idx + '/' + x.total + '</em></div>';
    }).join('') : '<p class="insp-empty">Songs you send or receive show up here.</p>';
  }
  $('connectView').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cc]');
    if (!b) {
      var tg = e.target.closest('[data-toggle]');
      if (tg) { var k = tg.getAttribute('data-toggle'); settings[k] = !isOn(k); saveSettings(); renderConnect(); if (k === 'liveSync' && settings.liveSync) pushSync(); }
      return;
    }
    var act = b.getAttribute('data-cc'), peer = peers.filter(function (x) { return x.id === b.getAttribute('data-p'); })[0];
    if (act === 'host') startHosting();
    else if (act === 'scan') openScanner();
    else if (act === 'party') { if (partyOn) startParty(); else startParty(); }
    else if (act === 'remote' && peer) { remotePeer = peer; setView('remote'); }
    else if (act === 'send' && peer) openSendDialog(peer);
    else if (act === 'drop' && peer) { send(peer, { t: 'bye' }); dropPeer(peer); }
    else if (act === 'rename') askText('Name this device', deviceName(), 'Save', function (n) { settings.deviceName = n; saveSettings(); renderConnect(); devicePeers().forEach(function (p) { send(p, { t: 'hello', name: n, songs: state.tracks.length }); }); });
  });
  function openSendDialog(peer) {
    var cur = state.current, al = cur ? getAlbums().filter(function (a) { return a.key === cur.albumKey; })[0] : null;
    openModal('<h3>Send songs to ' + esc(peer.name) + '</h3><p class="modal-sub">Songs go straight to the other device and are saved there. Nothing goes through the internet when you’re on the same Wi-Fi or hotspot.</p>' +
      '<div class="opt-grid">' +
        (cur ? '<button class="opt" data-send="song">This song<br><small>' + esc(cur.title) + '</small></button>' : '') +
        (al ? '<button class="opt" data-send="album">This album<br><small>' + plural(al.tracks.length, 'song') + '</small></button>' : '') +
        (state.view === 'playlist' || state.view === 'album' || state.view === 'favorites' ? '<button class="opt" data-send="view">Songs on this page<br><small>' + plural(getList().length, 'song') + '</small></button>' : '') +
        '<button class="opt" data-send="favs">My favourites<br><small>' + plural(state.tracks.filter(isFav).length, 'song') + '</small></button>' +
        '<button class="opt" data-send="pick">Choose files…</button>' +
      '</div><div class="modal-actions"><button class="btn" data-close>Close</button></div>',
      function (m) {
        m.onclick = function (e) {
          var b = e.target.closest('[data-send]');
          if (!b) return;
          var k = b.getAttribute('data-send'), list = [];
          if (k === 'song') list = [cur];
          else if (k === 'album') list = al.tracks;
          else if (k === 'view') list = getList().map(function (id) { return state.byId.get(id); });
          else if (k === 'favs') list = state.tracks.filter(isFav);
          else if (k === 'pick') { closeModal(); pickAndSend(peer); return; }
          closeModal();
          if (list.length) sendTracks(peer, list.filter(Boolean));
        };
      });
  }

  /* ---------------- Remote page (control another device) ---------------- */
  var remoteSearch = '';
  function rcmd(c, v) { send(remotePeer, { t: 'cmd', c: c, v: v }); }
  function renderRemote() {
    var v = $('remoteView'), p = remotePeer;
    if (!p) return;
    var s = p.remoteState || {}, t = s.t, guest = p.kind === 'guest';
    var pct = s.dur ? (s.pos / s.dur) * 100 : 0;
    if (!v.querySelector('.remote-card')) {
      v.innerHTML = '<div class="remote-card glass">' +
          '<div class="remote-art cover" id="rArt"></div>' +
          '<div class="remote-side"><div class="eyebrow" id="rWho"></div><div class="remote-title" id="rTitle"></div><div class="remote-sub" id="rSub"></div>' +
            '<div class="remote-bar"><i id="rBar"></i></div>' +
            '<div class="buttons big" id="rBtns">' +
              '<button class="icon-btn" data-rc="prev">' + '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg></button>' +
              '<button class="play-btn" data-rc="toggle" id="rPlay"></button>' +
              '<button class="icon-btn" data-rc="next"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 18l8.5-6L6 6zm10-12v12h2V6z"/></svg></button>' +
            '</div>' +
            '<div class="remote-extra" id="rExtra"><button class="chip-btn" data-rc="dj">✦ DJ</button><button class="chip-btn" data-rc="shuffle">Shuffle</button><button class="chip-btn" data-rc="fav">♥ Like</button></div>' +
            '<div class="vol-row" id="rVolRow"><span>🔈</span><input type="range" class="range" id="rVol" min="0" max="1" step="0.01"><span>🔊</span></div>' +
          '</div></div>' +
        '<div class="remote-next" id="rNext"></div>' +
        '<section class="set-card remote-lib"><div class="set-card-head"><h3>' + (guest ? 'Add a song to the party' : 'Their library') + '</h3></div>' +
          '<label class="search remote-search"><input id="rSearch" type="search" placeholder="Search ' + esc(p.name) + '’s songs" autocomplete="off"></label>' +
          '<div id="rLib"><p class="insp-empty">Loading…</p></div></section>';
      v.querySelector('#rSearch').value = remoteSearch;
      v.querySelector('#rSearch').addEventListener('input', debounce(function () { remoteSearch = v.querySelector('#rSearch').value; send(remotePeer, { t: 'lib', q: remoteSearch }); }, 250));
      v.querySelector('#rVol').addEventListener('input', function () { rcmd('vol', +this.value); });
      send(p, { t: 'lib', q: remoteSearch });
    }
    var g = guest && !(s.guestControl);
    $('rWho').textContent = (guest ? 'Party at ' : 'Controlling ') + (s.name || p.name);
    $('rTitle').textContent = t ? t.title : 'Nothing playing';
    $('rSub').textContent = t ? t.artist + ' — ' + t.album : '';
    $('rBar').style.width = pct.toFixed(1) + '%';
    $('rPlay').innerHTML = s.playing ? ICON_PAUSE : ICON_PLAY;
    $('rArt').innerHTML = s.cover ? '<img alt="" src="' + s.cover + '">' : '<div class="ph" style="' + placeholderStyle(t ? t.album : 'x') + '">' + ICON_NOTE + '</div>';
    $('rExtra').hidden = guest;
    $('rVolRow').hidden = guest;
    $('rBtns').classList.toggle('dim', g);
    if (!guest && document.activeElement !== $('rVol')) { $('rVol').value = s.vol || 0; $('rVol').style.setProperty('--p', ((s.vol || 0) * 100) + '%'); }
    $$('#rExtra [data-rc="dj"]').forEach(function (b) { b.classList.toggle('on', !!s.dj); });
    $$('#rExtra [data-rc="shuffle"]').forEach(function (b) { b.classList.toggle('on', !!s.shuffle); });
    $$('#rExtra [data-rc="fav"]').forEach(function (b) { b.classList.toggle('on', !!s.fav); });
    $('rNext').innerHTML = s.next && s.next.length ? 'Up next: ' + s.next.map(function (x) { return '<b>' + esc(x.title) + '</b>'; }).join(' · ') : '';
  }
  function renderRemoteLib() {
    var el = $('rLib'), p = remotePeer;
    if (!el || !p) return;
    var items = p.libResults || [], guest = p.kind === 'guest';
    el.innerHTML = items.length ? items.map(function (it) {
      return '<div class="rlib-row"><div class="tt"><div class="t1">' + esc(it.title) + '</div><div class="t2">' + esc(it.artist) + ' · ' + esc(it.album) + '</div></div>' +
        (guest ? '' : '<button class="btn small" data-rplay="' + it.id + '">Play</button>') +
        '<button class="btn small' + (guest ? ' primary' : '') + '" data-rq="' + it.id + '">' + (guest ? '+ Add' : 'Queue') + '</button></div>';
    }).join('') : '<p class="insp-empty">No songs found.</p>';
  }
  $('remoteView').addEventListener('click', function (e) {
    var b = e.target.closest('[data-rc]');
    if (b) { rcmd(b.getAttribute('data-rc')); return; }
    var pl = e.target.closest('[data-rplay]');
    if (pl) { send(remotePeer, { t: 'play', id: +pl.getAttribute('data-rplay') }); return; }
    var q = e.target.closest('[data-rq]');
    if (q) { send(remotePeer, { t: 'addq', id: +q.getAttribute('data-rq') }); q.textContent = '✓'; }
  });

  // incoming #join= links (scanned with the phone camera)
  function receiveJoin() {
    var m = /#join=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m) return;
    try { window.history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    handleCode('join=' + m[1]);
  }


  /* =====================================================================
     Gapless playback, choosing a speaker / casting, lyrics from the internet,
     car mode, and tidying up messy song info.
     ===================================================================== */

  /* ---------------- gapless playback ----------------
     With crossfade off, the next song is loaded on the spare deck a few seconds early
     and started the instant the current one ends — no silence between tracks. */
  var preloaded = null, gaplessTimer = null;
  function peekNextIndex() {
    var i = state.qIndex + 1;
    while (i < state.queue.length && !playableAt(i)) i++;
    return i < state.queue.length ? i : -1;
  }
  function resetGapless() {
    clearTimeout(gaplessTimer);
    gaplessTimer = null;
    preloaded = null;
  }
  function gaplessTick() {
    if (!isOn('gapless') || crossfadeSecs() > 0 || fade || seeking || audio.paused || state.repeat === 'one' || (sleep && sleep.mode === 'song')) return;
    var d = audio.duration;
    if (!d || !isFinite(d)) return;
    var left = (d - audio.currentTime) / (audio.playbackRate || 1);
    if (left > 8) { if (preloaded) resetGapless(); return; }
    if (!preloaded) {
      djFill();
      var i = peekNextIndex();
      if (i < 0) return;
      var t = state.byId.get(state.queue[i]), idle = 1 - active;
      preloaded = { deck: idle, id: t.id };
      setDeckSource(idle, t);
      decks[idle].preload = 'auto';
      try { decks[idle].load(); } catch (e) { /* ignore */ }
    }
    if (left < 1.6 && !gaplessTimer) {
      gaplessTimer = setTimeout(function () {
        gaplessTimer = null;
        if (!preloaded || audio.paused) return;
        var i = peekNextIndex();
        if (i < 0 || state.queue[i] !== preloaded.id) { resetGapless(); return; }
        crossfadeTo(i, 0.03);
      }, Math.max(0, (left - 0.03) * 1000));
    }
  }
  decks.forEach(function (d) {
    d.addEventListener('timeupdate', function () { if (this === audio) gaplessTick(); });
    d.addEventListener('seeking', function () { if (this === audio && preloaded) resetGapless(); });
  });

  /* ---------------- speaker picker + cast / AirPlay ---------------- */
  var canSink = !!((window.AudioContext && window.AudioContext.prototype.setSinkId) || (window.HTMLMediaElement && 'setSinkId' in HTMLMediaElement.prototype));
  function applySink(id) {
    id = id || '';
    var p;
    try {
      if (ac && ac.setSinkId) p = ac.setSinkId(id);
      else p = Promise.all(decks.map(function (d) { return d.setSinkId ? d.setSinkId(id) : null; }));
    } catch (e) { return Promise.resolve(false); }
    return Promise.resolve(p).then(function () { return true; }, function () { return false; });
  }
  async function outputDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    var list = await navigator.mediaDevices.enumerateDevices();
    // Windows lists a "communications" device too — it's the same speakers, so skip it
    return list.filter(function (d) { return d.kind === 'audiooutput' && d.deviceId !== 'communications'; });
  }
  // what kind of device is it? (for the icon)
  var DEV_ICONS = {
    laptop: 'M4 5h16a1 1 0 0 1 1 1v10H3V6a1 1 0 0 1 1-1m1 2v7h14V7zM1 17h22v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z',
    phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m0 3v14h8V5zm4 15.2a1 1 0 1 0 0-2 1 1 0 0 0 0 2',
    headphones: 'M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h2v-8H5v-1a7 7 0 0 1 14 0v1h-2v8h2a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9',
    speaker: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m5 2.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6m0 5.8a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9m0 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5',
    tv: 'M3 4h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1m1 2v10h16V6z',
    desktop: 'M3 3h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1m1 2v10h16V5z'
  };
  function devKind(label) {
    var l = (label || '').toLowerCase();
    if (/airpods|headphone|headset|earbud|buds|earphone|beats|wh-|wf-|bose qc|quietcomfort|sony wh|hands-free|handsfree/.test(l)) return 'headphones';
    if (/hdmi|displayport|tv|television|monitor|display audio|lg |samsung (q|tu|au)/.test(l)) return 'tv';
    if (/jbl|speaker|soundlink|sonos|boom|marshall|flip|charge|soundcore|bluetooth|harman|anker|tribit|homepod/.test(l) && !/macbook|built-in|internal|realtek|laptop/.test(l)) return 'speaker';
    if (/macbook|laptop|notebook/.test(l)) return 'laptop';
    if (/imac|desktop/.test(l)) return 'desktop';
    return IS_PHONE ? 'phone' : 'laptop';
  }
  function devIcon(kind) { return '<svg viewBox="0 0 24 24"><path fill="currentColor" d="' + (DEV_ICONS[kind] || DEV_ICONS.laptop) + '"/></svg>'; }
  function thisDeviceName() { return IS_PHONE ? (IS_IOS ? 'This iPhone' : 'This phone') : /Mac/.test(navigator.userAgent) ? 'This Mac' : 'This computer'; }
  // the pill at the top right of the full-screen player: what's playing the sound right now
  function updateOutputChip() {
    var paint = function (label, kind, other) {
      $$('.out-pill').forEach(function (b) {
        b.querySelector('.out-ic').innerHTML = devIcon(kind);
        b.querySelector('.out-label').textContent = label;
        b.classList.toggle('other', !!other);
      });
    };
    if (settings.sinkId) { paint(settings.sinkLabel || 'Speaker', devKind(settings.sinkLabel), true); return; }
    paint(thisDeviceName(), IS_PHONE ? 'phone' : 'laptop', false);
    // when the computer's own default is headphones or a speaker, show that instead
    if (canSink) outputDevices().then(function (devs) {
      var d = devs.filter(function (x) { return x.deviceId === 'default' && x.label; })[0];
      if (!d || settings.sinkId) return;
      var name = d.label.replace(/^Default\s*-\s*/i, '').replace(/\s*\(.*?\)\s*$/, '');
      var kind = devKind(name);
      if (kind === 'headphones' || kind === 'speaker' || kind === 'tv') paint(name, kind, true);
    }).catch(function () {});
  }
  async function openOutput() {
    if (!canSink) { castNow(); return; }
    var devs = await outputDevices();
    var named = devs.some(function (d) { return d.label; });
    var cur = settings.sinkId || '';
    // the chosen speaker was unplugged: we're back on the default
    if (cur && named && !devs.some(function (d) { return d.deviceId === cur; })) cur = '';
    var rows = named ? devs.map(function (d) {
      var id = d.deviceId === 'default' ? '' : d.deviceId;
      var name = d.deviceId === 'default' ? 'Same as my computer (' + d.label.replace(/^Default\s*-\s*/i, '') + ')' : d.label;
      return '<button class="opt out-opt' + (id === cur ? ' on' : '') + '" data-sink="' + esc(id) + '" data-label="' + esc(d.label.replace(/^Default\s*-\s*/i, '')) + '">' +
        devIcon(d.deviceId === 'default' ? (IS_PHONE ? 'phone' : devKind(d.label.replace(/^Default\s*-\s*/i, ''))) : devKind(d.label)) + '<span>' + esc(name) + '</span>' + (id === cur ? '<em>Playing</em>' : '') + '</button>';
    }).join('') : '';
    openModal('<h3>Play on…</h3>' +
      (named
        ? '<p class="modal-sub">Pick where Tunebox plays. Your other apps keep using your normal sound settings.</p><div class="out-list" id="outList">' + rows + '</div>' +
          '<p class="modal-sub small">Bluetooth speaker or headphones not here? Connect them in your computer’s Bluetooth settings first — they show up here straight away.</p>'
        : '<p class="modal-sub">To list your speakers and headphones by name, Chrome needs you to allow <b>microphone</b> access once. Tunebox never records or listens — it only reads the names, then turns the microphone off right away.</p>' +
          '<div class="modal-actions" style="justify-content:flex-start;margin-top:0"><button class="btn primary" id="outNames">Show my speakers</button></div>') +
      '<div class="set-card-head"><h3>TV, Chromecast or AirPlay</h3></div>' +
      '<div class="modal-actions" style="justify-content:flex-start;margin-top:4px"><button class="btn" id="outCast">How to cast…</button></div>' +
      '<div class="modal-actions"><button class="btn primary" data-close>Done</button></div>',
      function (m) {
        var list = m.querySelector('#outList');
        if (list) list.onclick = function (e) {
          var b = e.target.closest('[data-sink]');
          if (!b) return;
          var id = b.getAttribute('data-sink'), label = b.getAttribute('data-label');
          ensureAudioGraph();
          applySink(id).then(function (ok) {
            if (!ok) { toast('Couldn’t switch to “' + label + '”. Is it still connected?', 3000); return; }
            settings.sinkId = id;
            settings.sinkLabel = id ? label : '';
            saveSettings();
            updateOutputChip();
            toast(id ? 'Playing on ' + label : 'Playing on this device', 1800);
            openOutput();
          });
        };
        var nb = m.querySelector('#outNames');
        if (nb) nb.onclick = function () {
          navigator.mediaDevices.getUserMedia({ audio: true }).then(function (st) {
            st.getTracks().forEach(function (t) { t.stop(); });
            openOutput();
          }, function (err) {
            toast(err && err.name === 'NotFoundError'
              ? 'This computer has no microphone, so Chrome won’t share speaker names. Use your sound settings instead.'
              : 'Permission wasn’t given. You can allow it later from the lock icon next to the address bar.', 4500);
          });
        };
        m.querySelector('#outCast').onclick = castNow;
      }, 'wide');
  }
  // if the chosen speaker disappears (Bluetooth turned off), fall back to this device quietly
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', function () {
      setTimeout(updateOutputChip, 400);
      if (!settings.sinkId) return;
      outputDevices().then(function (devs) {
        if (!devs.some(function (d) { return d.label; })) return;
        if (devs.some(function (d) { return d.deviceId === settings.sinkId; })) { applySink(settings.sinkId); return; }
        toast('“' + settings.sinkLabel + '” disconnected — playing on this device.', 3000);
        applySink('');
        settings.sinkId = '';
        saveSettings();
        updateOutputChip();
      });
    });
  }
  // reconnect to the chosen speaker on start (without Web Audio, set it on the players)
  if (canSink && settings.sinkId) {
    outputDevices().then(function (devs) {
      if (devs.some(function (d) { return d.deviceId === settings.sinkId; }) && !ac) {
        decks.forEach(function (d) { if (d.setSinkId) d.setSinkId(settings.sinkId).catch(function () {}); });
      }
    });
  }
  updateOutputChip();
  function castNow() {
    if (audio.webkitShowPlaybackTargetPicker) { closeModal(); try { audio.webkitShowPlaybackTargetPicker(); return; } catch (e) { /* fall through */ } }
    var help = function () {
      var mac = /Mac/.test(navigator.platform || navigator.userAgent), chrome = /Chrome|Edg/.test(navigator.userAgent);
      openModal('<h3>Cast your music</h3><p class="modal-sub">Your songs are files on this device, so the easiest way is to send this device’s sound:</p><ul class="help-list">' +
        (chrome && !IS_PHONE ? '<li><b>Chromecast / Google TV / Nest:</b> Chrome menu <b>⋮ → Cast…</b>, then <b>Sources → Cast tab</b>, and pick your TV or speaker.</li>' : '') +
        (mac ? '<li><b>AirPlay speakers or Apple TV:</b> click <b>Control Centre → Sound</b> in the menu bar and choose the AirPlay device.</li>' : '') +
        (IS_ANDROID ? '<li><b>Android:</b> pull down Quick Settings → <b>Cast</b> (or Smart View), or connect a Bluetooth speaker.</li>' : '') +
        (IS_IOS ? '<li><b>iPhone:</b> open Control Centre, press and hold the music card, then tap the AirPlay icon.</li>' : '') +
        '<li><b>Bluetooth speakers</b> work like any headphones — connect them in your device settings' + (canSink ? ', then pick them under <b>Play on…</b>' : '') + '.</li></ul>' +
        '<div class="modal-actions"><button class="btn primary" data-close>Got it</button></div>', null, 'wide');
    };
    if (audio.remote && audio.remote.prompt) {
      audio.remote.prompt().catch(help);
      return;
    }
    help();
  }

  /* ---------------- lyrics from the internet (LRCLIB) ---------------- */
  // Only the song's title, artist, album and length are sent — never the music itself.
  var lyricsCache = null;
  function lyricsCacheGet() {
    if (lyricsCache) return Promise.resolve(lyricsCache);
    return idbGet('lyricsCache').then(function (c) { lyricsCache = c || {}; return lyricsCache; }, function () { lyricsCache = {}; return lyricsCache; });
  }
  var saveLyricsCache = debounce(function () { idbSet('lyricsCache', lyricsCache); }, 1500);
  function lyricsOnlineAuto() { return settings.lyricsOnline === true; }
  async function fetchOnlineLyrics(t) {
    var cache = await lyricsCacheGet(), key = trackKey(t);
    var hit = cache[key];
    if (hit && hit.txt) return hit.txt;
    if (hit && hit.none && Date.now() - hit.at < 7 * 864e5) return '';
    if (navigator.onLine === false) return '';
    var artist = artistOf(t), base = 'https://lrclib.net/api/';
    var q = 'artist_name=' + encodeURIComponent(artist) + '&track_name=' + encodeURIComponent(t.title);
    var j = null;
    try {
      var url = base + 'get?' + q + (t.album && t.album !== 'Unknown Album' ? '&album_name=' + encodeURIComponent(t.album) : '') + (t.duration ? '&duration=' + Math.round(t.duration) : '');
      var r = await fetch(url);
      if (r.ok) j = await r.json();
      if (!j || (!j.syncedLyrics && !j.plainLyrics)) {
        var rs = await fetch(base + 'search?' + q);
        var list = rs.ok ? await rs.json() : [];
        list = (list || []).filter(function (x) { return x.syncedLyrics || x.plainLyrics; });
        if (t.duration) list.sort(function (a, b) { return Math.abs((a.duration || 0) - t.duration) - Math.abs((b.duration || 0) - t.duration); });
        j = list.filter(function (x) { return !t.duration || !x.duration || Math.abs(x.duration - t.duration) < 8; })[0] || null;
      }
    } catch (e) { return ''; }
    var txt = j ? (j.syncedLyrics || j.plainLyrics || '') : '';
    cache[key] = txt ? { txt: txt, at: Date.now() } : { none: 1, at: Date.now() };
    saveLyricsCache();
    return txt;
  }
  function onlineLyricsFor(t, manual) {
    if (manual) { $$('[data-lyr="online"]').forEach(function (b) { b.textContent = 'Looking…'; b.disabled = true; }); }
    return fetchOnlineLyrics(t).then(function (txt) {
      if (state.current !== t || (state.lyrics && state.lyrics.synced && !state.lyrics.online)) return;
      var got = txt ? parseLyrics(txt) : null;
      // only replace lyrics the song already has with better (timed) ones
      if (!got || (state.lyrics && !got.synced)) { if (manual) { toast(txt ? 'Only untimed lyrics found online.' : 'No lyrics found online for this song.', 2200); renderLyrics(); } return; }
      state.lyrics = got;
      state.lyrics.online = true;
      renderLyrics();
    });
  }
  // called by loadLyrics when the song has no lyrics of its own
  function noLocalLyrics(t) {
    lyricsCacheGet().then(function (c) {
      var hit = c[trackKey(t)];
      if (hit && hit.txt) { onlineLyricsFor(t); return; }
      if (lyricsOnlineAuto()) onlineLyricsFor(t);
    });
  }
  $('npvAskNo').addEventListener('click', function () { askedLyricsThisVisit = true; $('npvAsk').hidden = true; });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-lyr]');
    if (!b || !state.current) return;
    var act = b.getAttribute('data-lyr');
    if (act === 'online') onlineLyricsFor(state.current, true);
    else if (act === 'always') { settings.lyricsOnline = true; saveSettings(); $('npvAsk').hidden = true; onlineLyricsFor(state.current, true); }
  });

  /* ---------------- car mode ---------------- */
  var car = null, wakeLock = null;
  function keepAwake(on) {
    if (on && navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () {});
    } else if (!on && wakeLock) { try { wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }
  }
  document.addEventListener('visibilitychange', function () { if (car && !document.hidden) keepAwake(true); });
  function openCar() {
    if (car) return;
    car = document.createElement('div');
    car.className = 'car-mode';
    car.innerHTML =
      '<div class="car-top"><button class="car-x" data-car="close" aria-label="Close car mode">✕</button><span class="car-clock" id="carClock"></span><button class="car-chip" data-car="dj">✦ DJ</button></div>' +
      '<div class="car-main"><div class="car-art cover" id="carArt"></div>' +
        '<div class="car-text"><div class="car-title" id="carTitle"></div><div class="car-sub" id="carSub"></div>' +
        '<div class="car-lyric" id="carLyric"></div><div class="car-bar"><i id="carBar"></i></div></div></div>' +
      '<div class="car-btns"><button data-car="prev" aria-label="Previous"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg></button>' +
        '<button class="car-play" data-car="toggle" id="carPlay" aria-label="Play or pause"></button>' +
        '<button data-car="next" aria-label="Next"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 18l8.5-6L6 6zm10-12v12h2V6z"/></svg></button></div>' +
      '<div class="car-hint">Swipe left or right to skip · tap the cover to play or pause</div>';
    document.body.appendChild(car);
    document.body.classList.add('car-on');
    car.addEventListener('click', function (e) {
      var b = e.target.closest('[data-car]');
      if (e.target.closest('#carArt')) { toggle(); updateCar(); return; }
      if (!b) return;
      var a = b.getAttribute('data-car');
      if (a === 'close') closeCar();
      else if (a === 'prev') prev();
      else if (a === 'next') next(false);
      else if (a === 'toggle') toggle();
      else if (a === 'dj') toggleDj();
      setTimeout(updateCar, 50);
    });
    var sx = 0, sy = 0;
    car.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    car.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) next(false); else prev(); setTimeout(updateCar, 50); }
    });
    keepAwake(true);
    car.__iv = setInterval(updateCar, 400);
    updateCar();
  }
  function closeCar() {
    if (!car) return;
    clearInterval(car.__iv);
    car.remove();
    document.body.classList.remove('car-on');
    car = null;
    keepAwake(false);
  }
  var carKey = '';
  function updateCar() {
    if (!car) return;
    var t = state.current;
    $('carTitle').textContent = t ? t.title : 'Nothing playing';
    $('carSub').textContent = t ? artistOf(t) : 'Tap play to start';
    $('carPlay').innerHTML = audio.paused ? ICON_PLAY : ICON_PAUSE;
    var d = audio.duration || (t && t.duration) || 0;
    $('carBar').style.width = (d ? audio.currentTime / d * 100 : 0).toFixed(1) + '%';
    var d2 = new Date();
    $('carClock').textContent = d2.getHours() + ':' + ('0' + d2.getMinutes()).slice(-2);
    car.querySelector('[data-car="dj"]').classList.toggle('on', !!settings.dj);
    var L = state.lyrics, line = '';
    if (L && L.synced) { var i = currentLineIndex(audio.currentTime + 0.12); if (i >= 0 && audio.currentTime < L.lines[i].end + 0.5) line = L.lines[i].text; }
    $('carLyric').textContent = line;
    var k = t ? t.albumKey + t.id : '';
    if (k !== carKey) { carKey = k; if (t) paintCover($('carArt'), t, t.album); else $('carArt').innerHTML = ''; }
  }

  /* ---------------- tidy up song info ---------------- */
  var JUNK_RE = /\s*[\(\[](?:official\s*(?:music\s*)?(?:video|audio|lyric(?:s)?\s*video|visuali[sz]er)|lyric(?:s)?(?:\s*video)?|audio|video|hd|hq|4k|explicit|clean|\d{2,3}\s*kbps|free\s*download|visuali[sz]er)[\)\]]/gi;
  function tidyText(s) {
    if (!s) return s;
    var o = s.replace(JUNK_RE, '')
      .replace(/\b(?:www\.)?[a-z0-9-]+\.(?:com|net|org|info|io|co|ng|gh|me|cc|top|xyz)\b/gi, '')
      .replace(/\s*[-–]\s*copy(?:\s*\(\d+\))?$/i, '')
      .replace(/\s*\(\d\)$/, '')
      .replace(/\s*\b\d{2,3}\s*kbps\b/gi, '')
      .replace(/_/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s\-–|]+|[\s\-–|]+$/g, '')
      .trim();
    return o || s;
  }
  function tidyPlan() {
    var plan = [];
    state.tracks.forEach(function (t) {
      if (t.offline) return;
      var ch = {};
      var title = tidyText(t.title);
      var m = /^(\d{1,2})[\s.\-_]+(?=\D)(.+)$/.exec(title);
      if (m && (!t.track || t.track === +m[1])) { title = m[2].trim(); if (!t.track) ch.track = +m[1]; }
      // "Artist - Title" stuffed into the title tag
      if (title.indexOf(' - ') > 0 && (t.artist === 'Unknown Artist' || title.toLowerCase().indexOf(t.artist.toLowerCase() + ' - ') === 0)) {
        var a2 = title.slice(0, title.indexOf(' - ')).trim();
        if (t.artist === 'Unknown Artist') ch.artist = a2;
        title = title.slice(title.indexOf(' - ') + 3).trim();
      }
      if (title !== t.title) ch.title = title;
      var artist = tidyText(ch.artist || t.artist);
      if (artist !== t.artist) ch.artist = artist;
      var album = tidyText(t.album);
      if (album !== t.album) ch.album = album;
      if (Object.keys(ch).length) plan.push({ t: t, ch: ch });
    });
    // albums split over several folders: same album name and the same artist → one album
    var groups = new Map();
    state.tracks.forEach(function (t) {
      if (t.albumArtist || t.album === 'Unknown Album') return;
      var k = t.album.toLowerCase();
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    });
    groups.forEach(function (list) {
      var keys = new Set(list.map(function (t) { return t.albumKey; }));
      var artists = new Set(list.map(function (t) { return artistOf(t).toLowerCase(); }));
      if (keys.size < 2 || artists.size !== 1) return;
      list.forEach(function (t) {
        var p = plan.filter(function (x) { return x.t === t; })[0];
        if (!p) { p = { t: t, ch: {} }; plan.push(p); }
        p.ch.albumArtist = artistOf(t);
        p.merge = true;
      });
    });
    return plan;
  }
  var tidyBackup = null;
  function openTidy() {
    var plan = tidyPlan();
    if (!plan.length) { toast('Your song info already looks tidy ✓', 2000); return; }
    var merges = plan.filter(function (p) { return p.merge; }).length;
    var show = plan.filter(function (p) { return p.ch.title || p.ch.artist || p.ch.album; }).slice(0, 40);
    openModal('<h3>Tidy up song info</h3><p class="modal-sub">' + plural(plan.length, 'song') + ' can be cleaned up' + (merges ? ', including ' + plural(merges, 'song') + ' from albums split across folders' : '') +
      '. Changes are saved in Tunebox — your files aren’t touched, and you can undo.</p>' +
      '<div class="tidy-list">' + show.map(function (p) {
        var f = p.ch.title ? 'title' : p.ch.artist ? 'artist' : 'album';
        return '<div class="tidy-row"><s>' + esc(p.t[f]) + '</s><b>' + esc(p.ch[f]) + '</b></div>';
      }).join('') + (plan.length > show.length ? '<div class="tidy-row more">…and ' + (plan.length - show.length) + ' more</div>' : '') + '</div>' +
      '<div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="tidyGo">Tidy ' + plural(plan.length, 'song') + '</button></div>',
      function (m) {
        m.querySelector('#tidyGo').addEventListener('click', function () {
          tidyBackup = {};
          plan.forEach(function (p) {
            tidyBackup[p.t.path] = { e: edits[p.t.path] ? JSON.parse(JSON.stringify(edits[p.t.path])) : null, o: { title: p.t.title, artist: p.t.artist, album: p.t.album, albumArtist: p.t.albumArtist, track: p.t.track } };
            var e = edits[p.t.path] || (edits[p.t.path] = {});
            Object.keys(p.ch).forEach(function (k) { e[k] = p.ch[k]; });
            applyEdit(p.t);
          });
          idbSet('edits', edits);
          closeModal();
          invalidate();
          renderAll();
          updateNowPlaying();
          toast('Tidied ' + plural(plan.length, 'song') + '. Undo it in Settings → Library.', 3500);
        });
      }, 'wide');
  }
  function undoTidy() {
    if (!tidyBackup) return;
    Object.keys(tidyBackup).forEach(function (path) {
      var b = tidyBackup[path], t = state.byPath.get(path);
      if (b.e) edits[path] = b.e; else delete edits[path];
      if (t) { Object.keys(b.o).forEach(function (k) { t[k] = b.o[k]; }); computeAlbumKey(t); }
    });
    idbSet('edits', edits);
    tidyBackup = null;
    toast('Tidy-up undone', 1600);
    invalidate();
    renderAll();
  }


  /* ------------------------------ events ------------------------------ */

  var COMMANDS = {
    'open-folder': openFolder,
    'add-files': function () { $('fileInput').click(); },
    'rescan': function () { rescanFolders(false); },
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
    'lyrics-full': function () { showStage(true); setLyricsMode(true); },
    output: function () { openOutput(); },
    car: function () { openCar(); },
    tidy: function () { openTidy(); },
    'tidy-undo': function () { undoTidy(); renderSettings(); },
    eq: function () { toggleEqPanel(); },
    dj: function () { toggleDj(); },
    sleep: openSleepDialog,
    sync: function () { openSync(); },
    browse: openBrowse,
    'new-playlist': function () { askText('New playlist', '', 'Create', function (name) { var p = createPlaylist(name); setView('playlist', p.id); }); },
    'pl-rename': function () { var p = getPl(state.detail); if (p) askText('Rename playlist', p.name, 'Rename', function (n) { p.name = n; savePlaylists(); renderAll(); }); },
    'pl-delete': function () { var p = getPl(state.detail); if (p && confirm('Delete the playlist “' + p.name + '”? Your songs aren’t affected.')) { playlists = playlists.filter(function (x) { return x !== p; }); savePlaylists(); setView('playlists'); } },
    'edit-album': function () { var al = currentAlbum(); if (al) editTracks(al.tracks, true); },
    'np-more': function () {
      if (!state.current) return;
      var b = document.activeElement && document.activeElement.getBoundingClientRect ? document.activeElement.getBoundingClientRect() : { left: window.innerWidth / 2, bottom: window.innerHeight / 2 };
      openTrackMenu([state.current.id], b.left, b.bottom + 4);
    },
    'dj-start': function () { toggleDj(); if (settings.dj && window.innerWidth < 1100) showStage(true); }
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cmd]');
    if (b && COMMANDS[b.getAttribute('data-cmd')]) { COMMANDS[b.getAttribute('data-cmd')](); return; }
    var v = e.target.closest('[data-view]');
    if (v) { setView(v.getAttribute('data-view'), v.getAttribute('data-detail') || undefined); return; }
    var ar = e.target.closest('[data-artist]');
    if (ar) setView('artist', ar.getAttribute('data-artist'));
  });

  $('btnClear').addEventListener('click', function () {
    if (confirm('Remove all songs from Tunebox? (Your files are not touched.)')) clearLibrary();
  });
  $('btnForget').addEventListener('click', function () { idbSet('handles', []); $('reopenBanner').hidden = true; });

  $('dirInput').addEventListener('change', function () {
    var r = filesFromInput(this);
    var fresh = r.entries.filter(function (e) { return !state.byPath.has(e.path); });
    var again = r.root && state.folders.indexOf(r.root) >= 0;
    ingest(r.entries, r.root, { rescan: again });
    if (IS_PHONE) storeFiles(fresh); // phones can't re-open a folder later, so keep the songs
    this.value = '';
  });
  $('fileInput').addEventListener('change', function () {
    var picked = filesFromInput(this).entries;
    ingest(picked, '');
    storeFiles(picked);
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
  $('npvLive').addEventListener('click', function () { setLyricsMode(true); });
  $('npvLyrics').addEventListener('click', function (e) {
    var l = e.target.closest('.lyric-line');
    if (!l || !state.lyrics || !state.lyrics.synced) return;
    audio.currentTime = state.lyrics.lines[+l.getAttribute('data-li')].t;
    userScrolledAt = 0;
    if (audio.paused) play();
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
    var more = e.target.closest('[data-act="more"]');
    if (more) { var r = more.getBoundingClientRect(); openTrackMenu([getList()[i]], r.left - 150, r.bottom + 2); return; }
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
    if (e.key === 'Escape' && !$('modalBack').hidden) { e.preventDefault(); closeModal(); return; }
    if (e.key === 'Escape' && !$('ctxMenu').hidden) { closeMenu(); return; }
    if (!$('modalBack').hidden) return;
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
    else if (k === 'c' || k === 'C') { if (car) closeCar(); else openCar(); }
    else if (k === 'l' || k === 'L') toggleFav();
    else if (k === 'e' || k === 'E') toggleEqPanel();
    else if (k === 't' || k === 'T') toggleTheme();
    else if (k === 'Escape') {
      if (!$('ctxMenu').hidden) closeMenu();
      else if (!$('modalBack').hidden) closeModal();
      else if (!$('eqPanel').hidden) toggleEqPanel(false);
      else if (car) closeCar();
      else if (state.stage && state.lyricsMode) setLyricsMode(false);
      else if (state.stage) showStage(false);
    }
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

  if (IS_IOS || (IS_ANDROID && !window.showDirectoryPicker)) {
    if (IS_IOS) {
      $('btnEmptyOpen').textContent = 'Choose songs';
      $('btnEmptyOpen').nextElementSibling.hidden = true;
      $('emptyHint').textContent = 'Pick songs from the Files app — select several at once. They play right here, nothing is uploaded.';
    } else {
      $('emptyHint').textContent = 'Choose your Music or Download folder to add everything in it, or pick single songs. Nothing is uploaded. Use “Check for new songs” later to add new ones.';
    }
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
  renderPlaylistNav();
  editsLoaded.then(function () {
    if (!state.tracks.length) return;
    state.tracks.forEach(applyEdit);
    invalidate();
    renderAll(true);
  });
  loadStoredFiles().then(function (entries) {
    if (entries.length) ingest(entries, 'Saved on this device');
    receiveShared();
    receiveSync();
  });

  receiveJoin();
  window.addEventListener('hashchange', receiveJoin);

  // exposed for debugging in the console
  window.Tunebox = {
    state: state, settings: settings,
    get audio() { return audio; },
    get graph() { return !!ac; },
    get fading() { return !!fade; },
    get gain() { return deckGains ? deckGains[active].gain.value : null; },
    debugScan: function (h) { return scanHandle(h); },
    debugLyrics: function () { return fetchOnlineLyrics(state.current); },
    connect: { get peers() { return peers; }, handleCode: handleCode, startHosting: startHosting, startParty: startParty, sendTracks: sendTracks, get remote() { return remotePeer; } }
  };
})();

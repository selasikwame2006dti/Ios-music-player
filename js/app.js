/*
 * Tunebox — a local-files music player that runs in the browser.
 * Classic script (no modules) so it works when opened straight from disk (file://).
 */
(function () {
  'use strict';

  var AUDIO_EXT = ['mp3', 'm4a', 'm4b', 'aac', 'mp4', 'wav', 'aif', 'aiff', 'flac', 'ogg', 'oga', 'opus', 'webm', 'caf'];
  var IMG_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
  var ROW_H = 36;
  var COLORS = ['#e8684a', '#d9a13b', '#5aa469', '#3f8fc4', '#8a6bd1', '#c4578c', '#4aa3a2', '#a57b54'];

  function $(id) { return document.getElementById(id); }

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
    if (m < 1) return 'under 1 min';
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' hr ' + (m % 60) + ' min';
  }
  function hashColor(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return COLORS[Math.abs(h) % COLORS.length];
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
    if (skippedDrm) toast(skippedDrm + ' copy-protected iTunes file(s) (.m4p) skipped — browsers can’t play those.', 5000);
    if (!added.length && !skippedDrm) toast('No playable music found there.');
    if (added.length) {
      toast('Added ' + added.length + ' song' + (added.length === 1 ? '' : 's') + '.');
      scanTags(added);
      maybeRestoreLast();
    }
  }

  function clearLibrary() {
    stop();
    state.tracks = [];
    state.byId = new Map();
    state.byPath = new Map();
    state.folderImages = new Map();
    state.folders = [];
    state.queue = [];
    state.originalQueue = [];
    state.qIndex = -1;
    state.current = null;
    coverCache.forEach(function (p) { p.then(function (u) { if (u) URL.revokeObjectURL(u); }); });
    coverCache = new Map();
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
      setStatus(state.tracks.length + ' songs');
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
  var rowsSoon = throttle(function () { renderRows(); updateSubtitle(); }, 1000);

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

  var coverCache = new Map(); // albumKey -> Promise<url|null>

  function getCover(t) {
    if (!t) return Promise.resolve(null);
    var key = t.albumKey;
    if (coverCache.has(key)) return coverCache.get(key);
    var p = Meta.read(t.file, t.ext, true).then(function (m) {
      if (m.cover) return URL.createObjectURL(m.cover);
      var img = state.folderImages.get(t.dir);
      return img ? URL.createObjectURL(img.file) : null;
    }).catch(function () { return null; });
    coverCache.set(key, p);
    return p;
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
      cmp = function (a, b) { return d * cmpStr(k === 'artist' ? sortName(a[k]) : a[k], k === 'artist' ? sortName(b[k]) : b[k]) || defaultOrder(a, b); };
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
        a = { key: t.albumKey, name: t.album, artists: new Set(), albumArtist: t.albumArtist, tracks: [], year: 0 };
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

  function getArtists() {
    var map = new Map();
    state.tracks.forEach(function (t) {
      var n = artistOf(t);
      var a = map.get(n);
      if (!a) { a = { name: n, songs: 0, albums: new Set() }; map.set(n, a); }
      a.songs++;
      a.albums.add(t.albumKey);
    });
    var out = [];
    map.forEach(function (a) { out.push(a); });
    out.sort(function (x, y) { return cmpStr(sortName(x.name), sortName(y.name)); });
    return out;
  }

  /* ------------------------------ rendering ------------------------------ */

  var VIEW_TITLES = { songs: 'Songs', albums: 'Albums', artists: 'Artists', queue: 'Up Next' };

  function setView(view, detail) {
    if (view === 'album' || view === 'artist') {
      if (state.view !== 'album' && state.view !== 'artist') state.parentView = state.view;
    }
    state.view = view;
    state.detail = detail === undefined ? null : detail;
    state.sort = { key: 'default', dir: 1 };
    invalidate();
    var navView = view === 'album' ? 'albums' : view === 'artist' ? 'artists' : view;
    if (view === 'album' && state.parentView !== 'albums') navView = state.parentView;
    Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === navView);
    });
    $('slBody').scrollTop = 0;
    $('albumGrid').scrollTop = 0;
    $('artistList').scrollTop = 0;
    renderAll();
  }

  function renderAll(soft) {
    var has = state.tracks.length > 0;
    $('empty').hidden = has;
    $('foldersSection').hidden = !has;
    $('countSongs').textContent = has ? state.tracks.length : '';
    $('countAlbums').textContent = has ? getAlbums().length : '';
    $('countArtists').textContent = '';
    $('folderList').innerHTML = state.folders.map(function (f) { return '<li title="' + esc(f) + '">📁 ' + esc(f) + '</li>'; }).join('');

    var v = state.view;
    var isList = v === 'songs' || v === 'queue' || v === 'album' || v === 'artist';
    $('songList').hidden = !has || !isList;
    $('albumGrid').hidden = !has || v !== 'albums';
    $('artistList').hidden = !has || v !== 'artists';
    $('btnBack').hidden = !(v === 'album' || v === 'artist');
    $('search').disabled = v === 'queue';
    $('btnPlayView').hidden = !has || !(v === 'album' || v === 'artist' || v === 'songs');

    var title = VIEW_TITLES[v];
    if (v === 'album') {
      var al = getAlbums().filter(function (a) { return a.key === state.detail; })[0];
      title = al ? al.name : 'Album';
    } else if (v === 'artist') {
      title = state.detail;
    }
    $('viewTitle').textContent = title;
    updateSubtitle();

    if (!has) return;
    if (isList) { renderHead(); renderRows(); }
    else if (v === 'albums') { if (!soft || !$('albumGrid').childElementCount) renderAlbums(); }
    else if (v === 'artists') renderArtists();
  }

  function updateSubtitle() {
    var v = state.view, txt = '';
    if (state.tracks.length && (v === 'songs' || v === 'album' || v === 'artist' || v === 'queue')) {
      var ids = getList(), total = 0;
      for (var i = 0; i < ids.length; i++) total += state.byId.get(ids[i]).duration || 0;
      txt = ids.length + ' song' + (ids.length === 1 ? '' : 's') + (total ? ' · ' + fmtLong(total) : '');
      if (v === 'album') {
        var al = getAlbums().filter(function (a) { return a.key === state.detail; })[0];
        if (al) txt = al.artist + (al.year ? ' · ' + al.year : '') + ' · ' + txt;
      }
    }
    $('viewSub').textContent = txt;
    var none = state.tracks.length && v !== 'albums' && v !== 'artists' && !getList().length && state.filter;
    $('noResults').hidden = !none;
  }

  function renderHead() {
    Array.prototype.forEach.call($('slHead').children, function (c) {
      var k = c.getAttribute('data-sort');
      c.classList.toggle('sorted', state.sort.key === k);
      c.classList.toggle('desc', state.sort.key === k && state.sort.dir < 0);
    });
  }

  function renderRows() {
    if ($('songList').hidden) return;
    var ids = getList();
    var body = $('slBody'), spacer = $('slSpacer');
    spacer.style.height = (ids.length * ROW_H) + 'px';
    var top = body.scrollTop, h = body.clientHeight || 600;
    var start = Math.max(0, Math.floor(top / ROW_H) - 6);
    var end = Math.min(ids.length, Math.ceil((top + h) / ROW_H) + 6);
    var showTrackNo = state.view === 'album';
    var cur = state.current ? state.current.id : -1;
    var html = '';
    for (var i = start; i < end; i++) {
      var t = state.byId.get(ids[i]);
      var cls = 'row' + (t.id === cur ? ' playing' : '') + (t.id === state.selectedId ? ' sel' : '') + (t.broken ? ' broken' : '');
      var num = t.id === cur ? '<span class="eq"><i></i><i></i><i></i></span>'
              : '<span class="n">' + (showTrackNo ? (t.track || '') : i + 1) + '</span>';
      html += '<div class="' + cls + '" data-i="' + i + '" style="top:' + (i * ROW_H) + 'px">' +
        '<div class="c-num">' + num +
          '<button class="rp" data-act="play" title="Play"><svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></button></div>' +
        '<div class="c-title" title="' + esc(t.path) + '">' + esc(t.title) + '</div>' +
        '<div class="c-artist">' + esc(t.artist) + '</div>' +
        '<div class="c-album">' + esc(t.album) + '</div>' +
        '<div class="c-time">' + (t.duration ? fmtTime(t.duration) : '') + '</div>' +
      '</div>';
    }
    spacer.innerHTML = html;
  }

  var coverObserver = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      coverObserver.unobserve(en.target);
      loadCardCover(en.target);
    });
  }, { root: $('albumGrid'), rootMargin: '300px' }) : null;

  function loadCardCover(el) {
    var a = getAlbums()[+el.getAttribute('data-i')];
    if (!a) return;
    getCover(a.tracks[0]).then(function (url) {
      if (!url) return;
      var img = new Image();
      img.alt = '';
      img.onload = function () { el.appendChild(img); };
      img.src = url;
    });
  }

  function renderAlbums() {
    var tm = terms();
    var albums = getAlbums();
    var html = '';
    for (var i = 0; i < albums.length; i++) {
      var a = albums[i];
      if (tm.length) {
        var hay = (a.name + '\n' + a.artist).toLowerCase();
        if (!tm.every(function (x) { return hay.indexOf(x) >= 0; })) continue;
      }
      html += '<div class="card" data-i="' + i + '">' +
        '<div class="art" data-i="' + i + '"><div class="ph" style="background:' + hashColor(a.name) + '">' + esc(initials(a.name)) + '</div></div>' +
        '<div class="ct" title="' + esc(a.name) + '">' + esc(a.name) + '</div>' +
        '<div class="ca">' + esc(a.artist) + (a.year ? ' · ' + a.year : '') + '</div></div>';
    }
    var grid = $('albumGrid');
    grid.innerHTML = html;
    $('noResults').hidden = !!html || !state.filter;
    Array.prototype.forEach.call(grid.querySelectorAll('.art'), function (el) {
      if (coverObserver) coverObserver.observe(el); else loadCardCover(el);
    });
  }

  function renderArtists() {
    var tm = terms();
    var list = getArtists().filter(function (a) {
      var n = a.name.toLowerCase();
      return tm.every(function (x) { return n.indexOf(x) >= 0; });
    });
    $('countArtists').textContent = getArtists().length;
    $('artistList').innerHTML = list.map(function (a) {
      return '<div class="artist" data-name="' + esc(a.name) + '">' +
        '<div class="av" style="background:' + hashColor(a.name) + '">' + esc(initials(a.name)) + '</div>' +
        '<div><div class="an">' + esc(a.name) + '</div><div class="am">' + a.albums.size + ' album' + (a.albums.size === 1 ? '' : 's') +
        ' · ' + a.songs + ' song' + (a.songs === 1 ? '' : 's') + '</div></div></div>';
    }).join('');
    $('noResults').hidden = !!list.length || !state.filter;
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
    if (state.view === 'queue') invalidate();
    renderRows();
    if (state.view === 'queue') updateSubtitle();
    saveLast();
  }

  function play() {
    if (!state.current) {
      var ids = state.view === 'albums' || state.view === 'artists' ? defaultIds() : getList();
      if (ids.length) playIds(ids, 0);
      return;
    }
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

  function playIds(ids, index) {
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
        if (state.shuffle) { shuffleArr(state.queue); }
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
      $('seek').value = Math.round(p * 1000);
      $('seek').style.setProperty('--p', (p * 100).toFixed(2) + '%');
      $('tCur').textContent = fmtTime(audio.currentTime);
    }
    $('tDur').textContent = fmtTime(d);
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && d && isFinite(d)) {
      try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(audio.currentTime, d), playbackRate: audio.playbackRate }); } catch (e) { /* ignore */ }
    }
  }

  function updateVolume() {
    var v = audio.muted ? 0 : audio.volume;
    $('volume').value = v;
    $('volume').style.setProperty('--p', (v * 100) + '%');
    $('btnMute').classList.toggle('muted', audio.muted || audio.volume === 0);
  }

  function updateNowPlaying() {
    var t = state.current;
    $('npTitle').textContent = t ? t.title : 'Not playing';
    $('npSub').textContent = t ? t.artist + ' — ' + t.album : '';
    document.title = t ? t.title + ' · ' + t.artist : 'Tunebox';
    $('npArt').style.backgroundImage = '';
    if (!t) { updateTime(); return; }
    var ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
    if (ms && window.MediaMetadata) ms.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album });
    getCover(t).then(function (url) {
      if (state.current !== t || !url) return;
      $('npArt').style.backgroundImage = 'url("' + url + '")';
      if (ms && window.MediaMetadata) {
        ms.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: [{ src: url, sizes: '512x512' }] });
      }
    });
  }

  function updateModes() {
    $('btnShuffle').classList.toggle('on', state.shuffle);
    $('btnRepeat').classList.toggle('on', state.repeat !== 'off');
    $('btnRepeat').classList.toggle('one', state.repeat === 'one');
    $('btnRepeat').title = 'Repeat: ' + state.repeat + ' (R)';
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
      $('reopenText').textContent = 'Pick up where you left off — reopen “' + needAsk.map(function (h) { return h.name; }).join('”, “') + '”.';
      $('reopenBanner').hidden = false;
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

  $('btnOpenFolder').addEventListener('click', openFolder);
  $('btnEmptyOpen').addEventListener('click', openFolder);
  $('btnAddFiles').addEventListener('click', function () { $('fileInput').click(); });
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

  $('nav').addEventListener('click', function (e) {
    var b = e.target.closest('.nav-item');
    if (b) setView(b.getAttribute('data-view'));
  });
  $('btnBack').addEventListener('click', function () { setView(state.parentView); });
  $('btnPlayView').addEventListener('click', function () {
    var ids = getList();
    if (ids.length) playIds(ids, state.shuffle ? Math.floor(Math.random() * ids.length) : 0);
  });

  var searchTimer;
  $('search').addEventListener('input', function () {
    var val = this.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.filter = val.trim();
      invalidate();
      $('slBody').scrollTop = 0;
      renderAll();
    }, 150);
  });

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
  $('slBody').addEventListener('scroll', function () {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(function () { scrollQueued = false; renderRows(); });
  });
  window.addEventListener('resize', throttle(renderRows, 100));

  function playFromRow(i) {
    var ids = getList();
    if (state.view === 'queue') {
      state.qIndex = Math.max(0, state.qIndex) + i;
      loadTrack(state.byId.get(state.queue[state.qIndex]), true);
      return;
    }
    playIds(ids, i);
  }
  $('slSpacer').addEventListener('click', function (e) {
    var row = e.target.closest('.row');
    if (!row) return;
    var i = +row.getAttribute('data-i');
    if (e.target.closest('[data-act="play"]')) { playFromRow(i); return; }
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
    var a = getAlbums()[+c.getAttribute('data-i')];
    if (a) setView('album', a.key);
  });
  $('artistList').addEventListener('click', function (e) {
    var c = e.target.closest('.artist');
    if (c) setView('artist', c.getAttribute('data-name'));
  });
  $('player').querySelector('.np').addEventListener('click', function () {
    if (state.current) setView('album', state.current.albumKey);
  });

  $('btnPlay').addEventListener('click', toggle);
  $('btnNext').addEventListener('click', function () { next(false); });
  $('btnPrev').addEventListener('click', prev);
  $('btnShuffle').addEventListener('click', toggleShuffle);
  $('btnRepeat').addEventListener('click', cycleRepeat);
  $('btnMute').addEventListener('click', function () {
    if (audio.volume === 0) { audio.volume = 0.5; audio.muted = false; } else audio.muted = !audio.muted;
  });

  $('volume').addEventListener('input', function () {
    audio.volume = +this.value;
    audio.muted = false;
  });
  $('seek').addEventListener('input', function () {
    seeking = true;
    var d = audio.duration || 0;
    this.style.setProperty('--p', (this.value / 10) + '%');
    $('tCur').textContent = fmtTime(this.value / 1000 * d);
  });
  $('seek').addEventListener('change', function () {
    var d = audio.duration || 0;
    if (d) audio.currentTime = this.value / 1000 * d;
    seeking = false;
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
    else if (k === '/') { e.preventDefault(); $('search').focus(); }
    else if (k === 's' || k === 'S') toggleShuffle();
    else if (k === 'r' || k === 'R') cycleRepeat();
    else if (k === 'm' || k === 'M') audio.muted = !audio.muted;
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

  updateVolume();
  updateModes();
  updateNowPlaying();
  renderAll();
  checkRemembered();

  // exposed for debugging in the console
  window.Tunebox = { state: state, audio: audio };
})();

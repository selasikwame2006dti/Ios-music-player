/*
 * Tiny tag reader for local audio files. No dependencies.
 *   - MP3: ID3v2.2 / 2.3 / 2.4 (+ ID3v1 fallback)
 *   - M4A / AAC / ALAC (iTunes-style MP4 "ilst" atoms)
 *   - FLAC: Vorbis comments + embedded picture
 * Reads only the parts of the file it needs, so scanning big libraries stays fast.
 *
 * Usage: Meta.read(file, ext, full) -> Promise<{title, artist, album, albumArtist, lyrics,
 *        track, disc, year, cover: Blob|null}>
 */
var Meta = (function () {
  'use strict';

  var dLatin1 = new TextDecoder('windows-1252');
  var dUtf8 = new TextDecoder('utf-8');
  var dU16le = new TextDecoder('utf-16le');
  var dU16be = new TextDecoder('utf-16be');

  var SCAN_BYTES = 128 * 1024;          // first read when only text tags are needed
  var MAX_TAG_BYTES = 16 * 1024 * 1024; // never read more than this for a tag

  function readSlice(file, start, end) {
    var blob = file.slice(start, end);
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsArrayBuffer(blob);
    });
  }

  function ascii(b, pos, len) {
    var s = '';
    for (var i = 0; i < len; i++) s += String.fromCharCode(b[pos + i]);
    return s;
  }
  function u32(b, p) { return ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]; }
  function u32le(b, p) { return ((b[p + 3] << 24) >>> 0) + (b[p + 2] << 16) + (b[p + 1] << 8) + b[p]; }
  function syncsafe(b, p) { return (b[p] & 0x7f) * 2097152 + (b[p + 1] & 0x7f) * 16384 + (b[p + 2] & 0x7f) * 128 + (b[p + 3] & 0x7f); }

  function tidy(s) {
    if (!s) return '';
    return s.replace(/^﻿/, '').replace(/\u0000+$/, '').replace(/\u0000/g, ' / ').trim();
  }
  function num(s) {
    var m = /^\s*(\d+)/.exec(s || '');
    return m ? parseInt(m[1], 10) : 0;
  }
  function year(s) {
    var m = /(\d{4})/.exec(s || '');
    return m ? parseInt(m[1], 10) : 0;
  }

  /* ------------------------------ ID3v2 ------------------------------ */

  function decodeText(enc, b) {
    if (!b.length) return '';
    switch (enc) {
      case 0: return dLatin1.decode(b);
      case 1:
        if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return dU16be.decode(b.subarray(2));
        if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return dU16le.decode(b.subarray(2));
        return dU16le.decode(b);
      case 2: return dU16be.decode(b);
      default: return dUtf8.decode(b);
    }
  }

  // index just past the null terminator for the given encoding, or -1
  function termEnd(enc, b, from) {
    if (enc === 1 || enc === 2) {
      for (var i = from; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i + 2;
    } else {
      for (var j = from; j < b.length; j++) if (b[j] === 0) return j + 1;
    }
    return -1;
  }

  function unsync(b) {
    var out = new Uint8Array(b.length), n = 0;
    for (var i = 0; i < b.length; i++) {
      out[n++] = b[i];
      if (b[i] === 0xff && b[i + 1] === 0x00) i++;
    }
    return out.subarray(0, n);
  }

  var ID3_MAP = {
    TIT2: 'title', TT2: 'title',
    TPE1: 'artist', TP1: 'artist',
    TALB: 'album', TAL: 'album',
    TPE2: 'albumArtist', TP2: 'albumArtist',
    TRCK: 'track', TRK: 'track',
    TPOS: 'disc', TPA: 'disc',
    TYER: 'year', TYE: 'year', TDRC: 'year',
    TCON: 'genre', TCO: 'genre',
    TBPM: 'bpm', TBP: 'bpm'
  };
  var GENRES = ['Blues','Classic Rock','Country','Dance','Disco','Funk','Grunge','Hip-Hop','Jazz','Metal','New Age','Oldies',
    'Other','Pop','R&B','Rap','Reggae','Rock','Techno','Industrial','Alternative','Ska','Death Metal','Pranks','Soundtrack',
    'Euro-Techno','Ambient','Trip-Hop','Vocal','Jazz+Funk','Fusion','Trance','Classical','Instrumental','Acid','House','Game',
    'Sound Clip','Gospel','Noise','Alternative Rock','Bass','Soul','Punk','Space','Meditative','Instrumental Pop',
    'Instrumental Rock','Ethnic','Gothic','Darkwave','Techno-Industrial','Electronic','Pop-Folk','Eurodance','Dream',
    'Southern Rock','Comedy','Cult','Gangsta','Top 40','Christian Rap','Pop/Funk','Jungle','Native American','Cabaret',
    'New Wave','Psychedelic','Rave','Showtunes','Trailer','Lo-Fi','Tribal','Acid Punk','Acid Jazz','Polka','Retro',
    'Musical','Rock & Roll','Hard Rock'];
  function genreName(g) {
    if (!g) return '';
    var m = /^\(?(\d{1,3})\)?$/.exec(g.trim());
    if (m) return GENRES[+m[1]] || '';
    return g.replace(/^\(\d+\)/, '').trim();
  }

  function parseID3(b, wantCover, out) {
    var ver = b[3];
    var flags = b[5];
    var size = syncsafe(b, 6);
    var end = Math.min(10 + size, b.length);
    var body = b.subarray(0, end);
    if ((flags & 0x80) && ver < 4) body = unsync(body);
    end = body.length;

    var pos = 10;
    if (flags & 0x40) pos += ver === 4 ? syncsafe(body, 10) : u32(body, 10) + 4;

    var hdr = ver === 2 ? 6 : 10;
    while (pos + hdr <= end) {
      var id = ascii(body, pos, ver === 2 ? 3 : 4);
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break; // padding reached
      var fsize = ver === 2 ? (body[pos + 3] << 16) | (body[pos + 4] << 8) | body[pos + 5]
                : ver === 4 ? syncsafe(body, pos + 4) : u32(body, pos + 4);
      var fflags = ver === 2 ? 0 : body[pos + 9];
      var start = pos + hdr;
      pos = start + fsize;
      if (fsize <= 0) continue;
      if (pos > end) { out._truncated = true; break; }

      var data = body.subarray(start, pos);
      if (ver === 3 && (fflags & 0xc0)) continue;    // compressed / encrypted
      if (ver === 4) {
        if (fflags & 0x0c) continue;                   // compressed / encrypted
        if (fflags & 0x01) data = data.subarray(4);    // data length indicator
        if (fflags & 0x02) data = unsync(data);
      }

      var key = ID3_MAP[id];
      if ((id === 'TXXX' || id === 'TXX') && data.length > 2) {
        var te = data[0], dEndX = termEnd(te, data, 1);
        if (dEndX > 0) {
          var desc = decodeText(te, data.subarray(1, dEndX)).replace(/[\u0000\uFEFF]/g, '').toUpperCase();
          if (desc === 'REPLAYGAIN_TRACK_GAIN' && !out.rg) out.rg = decodeText(te, data.subarray(dEndX));
        }
        continue;
      }
      if (key) {
        if (!out[key]) out[key] = tidy(decodeText(data[0], data.subarray(1)));
      } else if (wantCover && !out.lyrics && (id === 'USLT' || id === 'ULT') && data.length > 4) {
        // encoding, 3-letter language, content descriptor, then the lyrics text
        var le = data[0], dEndL = termEnd(le, data, 4);
        if (dEndL > 0) out.lyrics = decodeText(le, data.subarray(dEndL)).replace(/^\uFEFF/, '').replace(/\u0000+$/, '');
      } else if (wantCover && !out.cover && (id === 'APIC' || id === 'PIC')) {
        var enc = data[0], mime, p;
        if (id === 'PIC') {
          var fmt = ascii(data, 1, 3).toLowerCase();
          mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
          p = 4;
        } else {
          var mEnd = termEnd(0, data, 1);
          if (mEnd < 0) continue;
          mime = dLatin1.decode(data.subarray(1, mEnd - 1)) || 'image/jpeg';
          if (mime.indexOf('/') < 0) mime = 'image/' + mime.toLowerCase();
          p = mEnd;
        }
        p += 1; // picture type
        var dEnd = termEnd(enc, data, p);
        if (dEnd < 0) continue;
        out.cover = new Blob([data.slice(dEnd)], { type: mime });
      }
    }
    return out;
  }

  function parseID3v1(b, out) {
    if (b.length < 128 || ascii(b, 0, 3) !== 'TAG') return;
    var f = function (p, l) { return tidy(dLatin1.decode(b.subarray(p, p + l))); };
    if (!out.title) out.title = f(3, 30);
    if (!out.artist) out.artist = f(33, 30);
    if (!out.album) out.album = f(63, 30);
    if (!out.year) out.year = f(93, 4);
    if (!out.track && b[125] === 0 && b[126]) out.track = String(b[126]);
  }

  async function readMP3(file, wantCover) {
    var out = {};
    var head = new Uint8Array(await readSlice(file, 0, 10));
    if (head.length === 10 && ascii(head, 0, 3) === 'ID3' && head[3] >= 2 && head[3] <= 4) {
      var total = Math.min(10 + syncsafe(head, 6), MAX_TAG_BYTES);
      var first = wantCover ? total : Math.min(total, SCAN_BYTES);
      var b = new Uint8Array(await readSlice(file, 0, first));
      parseID3(b, wantCover, out);
      // Big tag (usually a large cover first) and we still miss the basics: read the rest.
      if (out._truncated && first < total && !(out.title && out.artist && out.album)) {
        out = {};
        parseID3(new Uint8Array(await readSlice(file, 0, total)), wantCover, out);
      }
    }
    if (!out.title && file.size > 128) {
      parseID3v1(new Uint8Array(await readSlice(file, file.size - 128, file.size)), out);
    }
    return out;
  }

  /* ------------------------------ MP4 / M4A ------------------------------ */

  function findAtom(b, start, end, type) {
    var p = start;
    while (p + 8 <= end) {
      var size = u32(b, p);
      var t = ascii(b, p + 4, 4);
      var hdr = 8;
      if (size === 1) { size = u32(b, p + 8) * 4294967296 + u32(b, p + 12); hdr = 16; }
      else if (size === 0) size = end - p;
      if (size < hdr) return null;
      if (t === type) return { start: p + hdr, end: Math.min(p + size, end) };
      p += size;
    }
    return null;
  }

  async function readMP4(file, wantCover) {
    var out = {};
    // Walk top-level atoms to find "moov" (it may be at the end of the file).
    var pos = 0, moov = null;
    for (var guard = 0; pos + 8 <= file.size && guard < 64; guard++) {
      var h = new Uint8Array(await readSlice(file, pos, pos + 16));
      var size = u32(h, 0), type = ascii(h, 4, 4), hdr = 8;
      if (size === 1) { size = u32(h, 8) * 4294967296 + u32(h, 12); hdr = 16; }
      else if (size === 0) size = file.size - pos;
      if (size < hdr) break;
      if (type === 'moov') {
        if (size > 64 * 1024 * 1024) return out;
        moov = new Uint8Array(await readSlice(file, pos + hdr, pos + size));
        break;
      }
      pos += size;
    }
    if (!moov) return out;

    var udta = findAtom(moov, 0, moov.length, 'udta');
    if (!udta) return out;
    var meta = findAtom(moov, udta.start, udta.end, 'meta');
    if (!meta) return out;
    // "meta" is normally a full box (4 extra bytes); QuickTime-style files skip that.
    var mStart = ascii(moov, meta.start + 4, 4) === 'hdlr' ? meta.start : meta.start + 4;
    var ilst = findAtom(moov, mStart, meta.end, 'ilst');
    if (!ilst) return out;

    var p = ilst.start;
    while (p + 8 <= ilst.end) {
      var isize = u32(moov, p);
      if (isize < 8) break;
      var name = ascii(moov, p + 4, 4);
      var data = findAtom(moov, p + 8, Math.min(p + isize, ilst.end), 'data');
      if (data && data.end - data.start >= 8) {
        var dtype = u32(moov, data.start) & 0xffffff;
        var payload = moov.subarray(data.start + 8, data.end);
        var text = function () { return tidy(dUtf8.decode(payload)); };
        switch (name) {
          case '©nam': out.title = text(); break;
          case '©ART': out.artist = text(); break;
          case '©alb': out.album = text(); break;
          case 'aART': out.albumArtist = text(); break;
          case '©day': out.year = text(); break;
          case '©gen': out.genre = text(); break;
          case 'gnre': if (payload.length >= 2) out.genre = String(((payload[0] << 8) | payload[1]) - 1); break;
          case 'tmpo': if (payload.length >= 2) out.bpm = String((payload[0] << 8) | payload[1]); break;
          case 'trkn': if (payload.length >= 4) out.track = String((payload[2] << 8) | payload[3]); break;
          case 'disk': if (payload.length >= 4) out.disc = String((payload[2] << 8) | payload[3]); break;
          case '\u00a9lyr': if (wantCover) out.lyrics = dUtf8.decode(payload); break;
          case 'covr':
            if (wantCover && !out.cover) {
              out.cover = new Blob([payload.slice()], { type: dtype === 14 ? 'image/png' : 'image/jpeg' });
            }
            break;
        }
      }
      p += isize;
    }
    return out;
  }

  /* ------------------------------ FLAC ------------------------------ */

  async function readFLAC(file, wantCover) {
    var out = {};
    var pos = 0;
    var head = new Uint8Array(await readSlice(file, 0, 10));
    if (ascii(head, 0, 3) === 'ID3') pos = 10 + syncsafe(head, 6);
    var magic = new Uint8Array(await readSlice(file, pos, pos + 4));
    if (ascii(magic, 0, 4) !== 'fLaC') return out;
    pos += 4;

    for (var guard = 0; guard < 128 && pos + 4 <= file.size; guard++) {
      var bh = new Uint8Array(await readSlice(file, pos, pos + 4));
      var last = bh[0] & 0x80, type = bh[0] & 0x7f;
      var len = (bh[1] << 16) | (bh[2] << 8) | bh[3];
      var start = pos + 4;
      pos = start + len;

      if (type === 4 && len < MAX_TAG_BYTES) {
        var c = new Uint8Array(await readSlice(file, start, pos));
        var p = 4 + u32le(c, 0);
        var count = u32le(c, p); p += 4;
        for (var i = 0; i < count && p + 4 <= c.length; i++) {
          var l = u32le(c, p); p += 4;
          var kv = dUtf8.decode(c.subarray(p, p + l)); p += l;
          var eq = kv.indexOf('=');
          if (eq < 0) continue;
          var k = kv.slice(0, eq).toUpperCase(), v = tidy(kv.slice(eq + 1));
          if (k === 'TITLE' && !out.title) out.title = v;
          else if (k === 'ARTIST' && !out.artist) out.artist = v;
          else if (k === 'ALBUM' && !out.album) out.album = v;
          else if ((k === 'ALBUMARTIST' || k === 'ALBUM ARTIST') && !out.albumArtist) out.albumArtist = v;
          else if (k === 'TRACKNUMBER' && !out.track) out.track = v;
          else if (k === 'DISCNUMBER' && !out.disc) out.disc = v;
          else if (k === 'DATE' && !out.year) out.year = v;
          else if (k === 'GENRE' && !out.genre) out.genre = v;
          else if (k === 'REPLAYGAIN_TRACK_GAIN' && !out.rg) out.rg = v;
          else if (k === 'BPM' && !out.bpm) out.bpm = v;
          else if ((k === 'LYRICS' || k === 'UNSYNCEDLYRICS' || k === 'SYNCEDLYRICS') && !out.lyrics) out.lyrics = kv.slice(eq + 1);
        }
      } else if (type === 6 && wantCover && !out.cover && len < MAX_TAG_BYTES) {
        var pic = new Uint8Array(await readSlice(file, start, pos));
        var q = 4;
        var ml = u32(pic, q); q += 4;
        var mime = dLatin1.decode(pic.subarray(q, q + ml)) || 'image/jpeg'; q += ml;
        var dl = u32(pic, q); q += 4 + dl;
        q += 16; // width, height, depth, colours
        var plen = u32(pic, q); q += 4;
        out.cover = new Blob([pic.slice(q, q + plen)], { type: mime });
      }
      if (last) break;
    }
    return out;
  }

  /* ------------------------------ public ------------------------------ */

  async function read(file, ext, wantCover) {
    var raw = {};
    try {
      if (ext === 'm4a' || ext === 'm4b' || ext === 'mp4') raw = await readMP4(file, wantCover);
      else if (ext === 'flac') raw = await readFLAC(file, wantCover);
      else raw = await readMP3(file, wantCover); // mp3, and any file that might carry ID3 (wav, aiff…)
    } catch (e) {
      raw = {};
    }
    return {
      title: raw.title || '',
      artist: raw.artist || '',
      album: raw.album || '',
      albumArtist: raw.albumArtist || '',
      track: num(raw.track),
      disc: num(raw.disc),
      year: year(raw.year),
      genre: genreName(raw.genre),
      bpm: num(raw.bpm),
      rg: raw.rg ? (parseFloat(String(raw.rg).replace(/[^0-9.+-]/g, '')) || 0) : null,
      cover: raw.cover || null,
      lyrics: raw.lyrics || ''
    };
  }

  return { read: read };
})();

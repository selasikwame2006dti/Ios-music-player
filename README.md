# Tunebox

A music player that runs in your web browser and plays the music files already on your Mac.
Nothing to install, no account, and no internet needed. Your files never leave your computer.

It was built to run well on older Macs, like a 2013 MacBook Air on macOS Big Sur.

## Open it

**Online:** https://selasikwame2006dti.github.io/Ios-music-player/

Even when opened from that web address, your music is never uploaded. The page only reads the files you pick, and it does that on your own computer.

**Offline:** download the repo (**Code → Download ZIP**), unzip it, and double-click `index.html`.

## How to use it

1. Open Tunebox in your browser.
   - **Google Chrome** is recommended. It can remember your music folder between visits.
   - **Safari** works too, but you have to choose your folder again each time.
   - **iPhone / iPad:** tap **Choose songs** and select songs from the Files app.
2. Click **Choose music folder** and pick the folder where your music lives. Usually that's one of:
   - `Music › iTunes › iTunes Media › Music` (older iTunes)
   - `Music › Music › Media` (the Music app)
   - or any folder of MP3s

   You can also drag a folder or individual songs onto the window.

Tip: bookmark the page so you can open it in one click.

## Features

**Playing**
- Now Playing stage with a big cover, live visualizer, and synced or plain lyrics
- **Tunebox DJ** (press **D**, or use the DJ button in the sidebar, the Now Playing panel or the phone tab bar): an endless, smart mix with no AI service and no internet needed. It picks each next song by genre, artist, era, tempo, energy and your favourites, learns from what you play through and what you skip, and never repeats the same artist twice in a row.
- **Crossfade** (0–12 s), smooth skips and soft pause
- **10-band equalizer** (±15 dB) with 12 presets and a volume boost. A built-in limiter keeps big boosts from crackling.
- **Vibes:** Slowed + Reverb, Chill, Sped Up, Nightcore and Concert Hall, plus free speed and reverb controls
- Background play: keeps going in other tabs, and works with the Mac media keys and the Now Playing widget

**Library**
- Songs, Albums, Artists and Favourites
- Reads tags, album art, genre, BPM and lyrics from MP3, M4A and FLAC files. Synced lyrics come from `.lrc` files saved next to your songs.
- Remembers song info, so even huge libraries reopen instantly. Only new or changed files are read again.
- Opens your music folder automatically (Chrome)

**App**
- Glass design with light, dark or auto theme, and accent colours from the album art or a colour you pick
- Layouts for wide and narrow windows, plus a phone layout with a tab bar
- **Works offline.** After the first visit, the web version opens without internet. You can also install it from Chrome so it opens in its own window like a Mac app.
- A Settings page for all of the above

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Skip back / forward 5 seconds |
| Shift + ← / → | Previous / next song |
| ↑ / ↓ | Volume |
| / | Search |
| S | Shuffle |
| R | Repeat (off → all → one) |
| M | Mute |
| F | Now Playing |
| D | Tunebox DJ on / off |
| I | Switch Up Next / Lyrics |
| , | Settings |
| L | Favourite the current song |
| E | Equalizer |
| T | Light / dark theme |
| Esc | Close the equalizer or full-screen view |
| Enter | Play selected song |

## File formats

| Format | Chrome | Safari |
| --- | --- | --- |
| MP3, AAC/M4A, WAV, FLAC | ✅ | ✅ |
| OGG / Opus | ✅ | ❌ |
| AIFF, Apple Lossless (ALAC) | ❌ | ✅ |
| `.m4p` (old copy-protected iTunes purchases) | ❌ | ❌ |

If a song won't play, Tunebox tells you and moves on to the next one.

## How it's built

Plain HTML, CSS and JavaScript, with no frameworks and no build step:

- `index.html`: the page layout
- `css/style.css`: styles, written to work in Safari 14+ and Chrome 90+
- `js/metadata.js`: a small tag reader for ID3 (MP3), MP4 atoms (M4A) and Vorbis comments (FLAC)
- `js/app.js`: the library, views, player, folder access and keyboard shortcuts

The scripts are ordinary script files, not modules, so the page works when opened straight from disk (`file://`).

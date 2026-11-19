# Tunebox

A music player that runs in your web browser and plays the music files already on your Mac.
Nothing to install, no account, and no internet needed. Your files never leave your computer.

It was built to run well on older Macs, like a 2013 MacBook Air on macOS Big Sur.

## How to use it

1. On GitHub, click **Code → Download ZIP** and unzip it (or `git clone` the repo).
2. Open the folder and double-click **`index.html`**. It opens in your browser.
   - **Google Chrome** is recommended. It can remember your music folder between visits.
   - **Safari** works too, but you have to choose your folder again each time.
3. Click **Choose music folder** and pick the folder where your music lives. Usually that's one of:
   - `Music › iTunes › iTunes Media › Music` (older iTunes)
   - `Music › Music › Media` (the Music app)
   - or any folder of MP3s

   You can also drag a folder or individual songs onto the window.

Tip: drag `index.html` onto Chrome's bookmarks bar so you can open it in one click.

## Features

- Songs, Albums, Artists and Up Next views
- Reads song info and album art from the files (MP3, M4A/AAC, FLAC), with `cover.jpg`/`folder.jpg` as a fallback
- If a song has no tags, guesses the details from `Artist/Album/01 Song.mp3` folders or `Artist - Title` filenames
- Search across title, artist and album
- Shuffle, repeat all / repeat one, sortable columns
- Mac media keys (F7 / F8 / F9) and the macOS Now Playing widget
- Remembers the last song and where you stopped, plus volume, shuffle and repeat
- Light and dark mode follow your Mac's setting
- Draws only the rows on screen, so big libraries stay smooth

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

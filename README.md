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

**New in this update**
- **Playlists:** right-click any song, or tap **⋯**, then choose Add to playlist. Your playlists appear in the sidebar. There are also 4 **smart playlists** that update themselves: Recently Played, Most Played, Not Heard in a While and Never Played.
- **Song menu:** Play next, Add to Up Next, Add to playlist, Favourite, Start DJ from this song, Go to album or artist, and Edit song info.
- **Sleep timer** (moon icon in Now Playing): 5 minutes to 1½ hours, or the end of the current song. The music fades out gently before stopping.
- **Volume levelling:** quiet and loud songs play at the same level. Tunebox uses ReplayGain tags when a file has them, and otherwise measures each song. There's also an optional "Smooth loudness peaks" setting.
- **Tempo detection:** each song's beat is measured in the background, so the DJ can match tempos even without BPM tags.
- **Listening Stats:** total time and this week, a 14-day chart, and your top songs, artists and genres. Everything is counted on your device.
- **Edit song info and covers:** change titles, artists, albums, years, genres and album art. Changes are saved inside Tunebox, and your files are never modified. Use "Edit album" to change a whole album at once.
- **Keep picked songs:** on phones, songs you add stay in Tunebox after you close it.
- **Share to Tunebox (Android):** share songs from Files, WhatsApp and other apps straight into Tunebox.
- **Send to another device:** a QR code or link copies your playlists, favourites, equalizer and look to your phone or PC. You can also export or import a backup file.

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

## Windows, Android, iPhone

- **Windows:** use Chrome or Edge, and click **Install app** in the sidebar. Tunebox then appears in the Start menu and taskbar. Once it's installed, you can right-click a song in File Explorer and choose **Open with → Tunebox**. The Windows media keys and volume overlay work.
- **Android:** open the link in Chrome and choose **Install app** (or **Add to Home screen**). Pick songs with **Choose songs**. Music keeps playing when you lock the screen, with controls in the notification shade and on the lock screen. If music ever stops when the phone locks, turn off **Settings → App → Sound effects engine**.
- **iPhone / iPad:** in Safari, tap Share → **Add to Home Screen**. The equalizer, reverb and crossfades aren't available there, because Safari on iPhone doesn't allow them.
- **App shortcuts:** right-click the Dock or taskbar icon (or long-press it on Android) to jump straight to **Start Tunebox DJ** or **Settings**.
- **Notifications:** turn on **Settings → App → Song-change notifications** to see each new song while Tunebox is in the background.

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

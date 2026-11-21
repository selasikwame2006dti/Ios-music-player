# Tunebox

A music player that runs in your web browser and plays the music files already on your Mac.
Nothing to install, no account, and no internet needed. Your files never leave your computer.

It was built to run well on older Macs, like a 2013 MacBook Air on macOS Big Sur.

## Open it

**Online:** https://selasikwame2006dti.github.io/Ios-music-player/

Even when opened from that web address, your music is never uploaded. The page only reads the files you pick, and it does that on your own computer.

**Offline:** download the repo (**Code → Download ZIP**), unzip it, and double-click `index.html`.

## How to use it

**New here?** Tunebox offers a one-minute guided tour the first time you open it. It highlights each button and tells you what it does. Take it again any time from **Settings → Help**, where there's also a tour of the full-screen player and a list of keyboard shortcuts.

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
- **Copy settings to another device:** a QR code or link copies your playlists, favourites, equalizer and look to your phone or PC. You can also export or import a backup file.

**Connect devices** (sidebar → Connect devices, or Browse on a phone)
- **Phone as a remote:** play, pause, skip, change the volume, turn on the DJ and search the other device's library to play or queue songs.
- **Send songs:** send the current song, an album, your favourites or any files straight to the other device, where they're saved.
- **Live sync:** playlists, favourites and your sound settings stay the same on both devices.
- **Party mode:** friends scan a QR code and add songs to your queue from their phones. Guests can only add songs unless you let them play and skip.
- **No shared Wi-Fi needed.** Tap **Show my code** on one device and scan it with the other device's camera.
  - When both devices are online, they find each other through the free PeerJS relay. They can be on different networks, such as a PC on your phone's hotspot.
  - When offline (the same Wi-Fi or a hotspot without internet), the second device shows a reply code. Tap **Scan their reply** on the first device and scan it.
  - You can also copy and paste the codes instead of scanning.
  - Devices connect directly and the connection is encrypted. Your music never goes through the relay.
- Party mode needs internet on the host device.

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

## Progress bar styles

Choose in **Settings → Appearance → Progress bar**:
- **Waveform** (default): the song's shape, showing its loud and quiet parts, like Audiomack or SoundCloud. Each song is read once and its shape is saved. Until then, a soft placeholder shape shows.
- **Wave:** the played part ripples, bigger when the music is louder, and flattens when you pause.
- **Classic:** a simple line.

## Radio

- **Radio** (sidebar, or the Radio tab on phones): thousands of free live stations from the community-run radio-browser.info directory.
  - **Finding stations:** *For you* shows popular stations in your country. There are also genres (Afrobeats, Hip-hop, Drill, R&B, Amapiano, Dancehall, Gospel, Highlife and more), and you can search by name, for example "Joy FM" or "Capital XTRA".
  - **Playing:** stations play in the normal player, full screen, the mini player and on the lock screen. Next and previous switch stations. Playing one of your own songs stops the radio.
- **Song names:** shown when the station shares them, sometimes with the song's cover. This works on many Zeno.fm and AzuraCast stations and on stations that put song names in their stream. Not every station shares them.
- **♥ Like song** saves it to **Heard on radio**, with quick links to find it on YouTube, Spotify, Apple Music or Audiomack. It also shows when the song is already in your library.
- **☆ Save station** keeps your favourite stations at the top.
- **The equalizer and effects** work on stations that allow it. Other stations still play normally.
- **Needs internet.** If the signal drops, the station reconnects by itself.

## Lyrics, gapless, car mode and more

- **Lyrics that follow the singer:**
  - The line being sung shows under the song title in full screen, and each word lights up as it's sung. Tap it (or **Lyrics**) for the big lyrics view, and tap any line to jump there.
  - The Now Playing panel lyrics highlight words too, and **⤢ Full screen** opens the big view.
  - Word timing is exact with word-timed `.lrc` files. Otherwise Tunebox estimates it from each line.
- **Lyrics from the internet:** when a song has no lyrics, tap **Find lyrics online**, or turn on **Settings → Find missing lyrics online**. Lyrics come from the free LRCLIB service, which sees only the song's title, artist, album and length. Results are saved, so they still work offline afterwards.
- **Lyrics offline:** lyrics found online are saved on your device, and the line-by-line and word-by-word highlighting runs on the device. So once a song's lyrics are saved, they work with no internet.
  - **Settings → Lyrics for offline → Download for my library** saves lyrics for all your songs at once.
  - With **Find missing lyrics online** turned on, Tunebox also fills them in slowly in the background (not on mobile data) and grabs the next few songs in your queue while you're online.
- **Gapless playback:** with crossfade off, the next song starts the instant the current one ends. Great for live albums and DJ mixes.
- **Play on…:** pick which speaker or headphones Tunebox uses (Chrome or Edge on a computer), and get help casting to a TV, Chromecast or AirPlay speaker.
- **Car mode** (press **C**, the **Car** button in full screen, or **Browse**): huge buttons, swipe to skip, the current lyric line, a clock, and the screen stays on.
- **Tidy up song info** (Settings → Library) cleans names like "Song (Official Video) [320kbps] www.site.com" and joins albums split across folders. You see a preview first, it can be undone, and your files are never changed.

## Fixes and phone improvements

- **Choppy sound after Bluetooth disconnects:** when headphones connect or disconnect, Tunebox restarts its audio engine on the new output. It also watches for stutter and fixes it by itself. It uses larger audio buffers on phones and only runs the reverb while it's turned up. If sound still stutters, turn off **Settings → App → Sound effects engine**.
- **Android folders:** **Choose music folder** now picks a whole folder on Android, such as Music or Download. The songs are kept in Tunebox.
- **Check for new songs** (sidebar, Browse or Settings) adds only songs that aren't in your library yet. On a computer with Chrome or Edge, **Watch folders** does this by itself when you come back to Tunebox and every 10 minutes. On a phone, pick the same folder again.
- **USB sticks, SD cards and external drives:**
  - If a music folder's drive is unplugged, its songs stay in your library, greyed out and marked "not connected". Playback, shuffle and the DJ skip them.
  - Plug the drive back in and Tunebox notices within a few seconds and makes them playable again. It also adds new songs and removes ones you deleted.
  - Pulling the drive out mid-song skips to the next available song.
  - After Chrome restarts, a folder may show **Tap to reconnect**. Tap it, or any of its songs, to give permission again.
  - On Android, songs from a folder you pick are copied into Tunebox, so they keep playing after the SD card or USB drive is removed.
- **Lock screen and notification controls:** album art shows reliably, the progress bar stays in sync, skip and seek buttons work, and tapping a song notification brings Tunebox back.

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
| C | Car mode |
| L | Favourite the current song |
| E | Equalizer |
| T | Light / dark theme |
| Esc | Close car mode, the big lyrics view, the equalizer or full screen |
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
- `js/app.js`: the library, views, player, folder access, device connections and keyboard shortcuts
- Radio stations come from [radio-browser.info](https://www.radio-browser.info/), a free, community-run directory.
- `js/vendor/`: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT), [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0) for scanning codes, and [PeerJS](https://github.com/peers/peerjs) (MIT) for finding devices over the internet

The scripts are ordinary script files, not modules, so the page works when opened straight from disk (`file://`).

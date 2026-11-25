# News Center – specification and decisions

The memory of the project: what was asked, what was decided and why, and how it's built. Read it
before changing behavior. User-facing documentation is in [README.md](README.md) and
[DESKTOP.md](DESKTOP.md); the release process in [MAINTAINING.md](MAINTAINING.md).

## 1. Goal

A multiview dashboard for Israeli live TV: several channels at once, a mixer to choose what you
hear, automatic discovery of Knesset broadcasts, and a news feed beside the video. It started as a
Windows app (WebView2 + HTML/JS) and now also ships as a native Android app built the way
[Shidur](https://github.com/EyalShimshi/shidur) is built: Kotlin, Jetpack Compose, Material 3,
Media3, with GitHub Actions as the only build machine.

## 2. Requirements

Every request so far, in order, and where it stands on each platform.

| # | Request | Windows | Android |
|---|---|---|---|
| R1 | Play the Knesset Channel embed in its own window | ✅ | ✅ (paste the embed code in Add channel; the Knesset Channel is built in) |
| R2 | All live channels from knesset.tv/live, a control dashboard with multiview, channel management, M and S per channel | ✅ | ✅ |
| R3 | Add channels 11, 12 and 13 | ✅ | ✅ (12 through Mako's page, see D-08) |
| R4 | Check knesset.tv for new streams on every start; hide streams that are off air; a global refresh | ✅ | ✅ (start, every 5 min, refresh) |
| R5 | Show Keshet 12 inside the app despite its restrictions | ✅ | ✅ best effort (D-08) |
| R6 | Several channels in S at once; sound from all soloed channels | ✅ | ✅ |
| R7 | Every channel muted (M) when the app opens | ✅ | ✅ (mute/solo are never saved) |
| R8 | Fullscreen inside the app's window, custom window controls | ✅ | ✅ adapted: fullscreen fills the app's window (the whole phone, or just the app's window in split screen) |
| R9 | No per-channel volume sliders | ✅ | ✅ (one master volume) |
| R10 | Volume above 100% for a boost | ✅ (200%, limiter) | ✅ (200%, soft limiter) |
| R11 | Good on a vertical monitor; a zoom for tile size | ✅ | ✅ (tile size: 1, 2 or 3 per row on an upright phone) |
| R12 | Slightly smaller so two tiles fit side by side | ✅ | ✅ (Medium, the default) |
| R13 | Channels 14, 16, 10 and other worthwhile channels | ✅ | ✅ (+ i24NEWS, and off by default: i24NEWS English, Kan Educational, Makan 33, Channel 9) |
| R14 | RSS news from popular outlets; collect many, activate the chosen ones | ✅ | ✅ (32 sources, 5 on) |
| R15 | A button on every stream to spotlight it and solo its sound; another one switches | ✅ (center button, Enter) | ✅ (tap the tile) |
| R16 | Drag tiles to rearrange | ✅ | ✅ (long-press and drag) |
| R17 | Hide the green meter on any stream | ✅ | ✅ (per channel and all) |
| R18 | A mobile app, the Shidur way, in a public repo with an installable APK release | – | ✅ this round ([docs/rounds/01-android-app.md](docs/rounds/01-android-app.md)) |
| R19 | A section about the Knesset's day-to-day work (committees and everything else), thorough but easy to understand, from a deep scan of the Knesset's website | ✅ the Knesset view, in Hebrew ([docs/rounds/02-knesset-view.md](docs/rounds/02-knesset-view.md), [docs/knesset-data.md](docs/knesset-data.md)) | ✅ the Knesset tab (R21) |
| R20 | Never contact one news site again, no network events at all; leave no traces | ✅ (removed; blocked in the page, the fetch bridge, redirects, the browser engine and links) | ✅ (removed; blocked in the fetch layer, sources, channels, headline links, the web-page channel and the Knesset page) |
| R21 | All the Knesset view in the APK, like in the Windows app | ✅ (the same files) | ✅ the Knesset tab ([docs/rounds/03-news-center.md](docs/rounds/03-news-center.md)) |
| R22 | The repository is now `news-center`: change everything from the old name to the new one | ✅ | ✅ |
| R23 | Detach a stream from the program: take it out as a separate window and put it anywhere else | ✅ its own window (`D`): any monitor, on top of other apps, fullscreen on its monitor; its sound follows the mixer ([docs/rounds/04-own-windows.md](docs/rounds/04-own-windows.md)) | ✅ adapted: a pop-out button puts the channel in a floating picture-in-picture window, which goes anywhere on the screen (D-32) |

## 3. Decision log

Decisions made without the owner (he asked for no questions in the Android round); each can be
revisited.

| # | Decision | Why |
|---|---|---|
| D-01 | One repository for both apps: the Windows app stays at the root (`app/`, `host/`), Android in `android/` | The Windows app keeps working from the same folder; one place for issues, releases and docs |
| D-02 | Native Kotlin + Compose + Material 3 + Media3 ExoPlayer, the Shidur toolchain (AGP 9.2.1, Kotlin 2.3.21, Gradle 9.5.0, compileSdk 37, minSdk 31) | Proven to build in CI with the same pipeline; native players handle several HLS streams better than a WebView, and allow real level meters and boost |
| D-03 | Package `io.github.eyalshimshi.newscenter`, name "News Center", English and Hebrew, GPL-3.0-or-later | Same conventions as Shidur |
| D-04 | One ExoPlayer per channel on screen; players start muted; the app holds one audio focus for all of them | Several players asking for focus would pause each other |
| D-05 | Grid tiles capped at 480p, the spotlight/fullscreen channel unlimited (setting, on by default) | Phones have a limited number of video decoders, data and battery |
| D-06 | Level meter and boost in a Media3 audio processor in each player's audio path, measuring before the volume | Same behavior as the desktop (a muted channel still shows activity) without the RECORD_AUDIO permission a Visualizer would need |
| D-07 | Channels you can hear keep playing (sound only) while you're on another tab; everything stops when the app leaves the screen, except picture-in-picture | Watch-and-read is the main use; background playback would need a media service and notification (a later round) |
| D-08 | Channel 12 = Mako's live page in a WebView with a desktop User-Agent, showing only the player; `page-helper.js` is injected into every frame (androidx.webkit document-start scripts) and follows M/S | Mako's streams play only in Mako's player (as found for the desktop); every frame so that a player inside an iframe still starts muted |
| D-09 | Knesset discovery, stream checks, merge rules, feed parsing and mixer rules ported 1:1 from `app/app.js` into plain Kotlin with unit tests | Both apps behave the same; the rules are testable without Android |
| D-10 | jsoup for knesset.tv and for feeds (its XML parser is forgiving), plus the desktop's regex fallback for broken feeds; the server's or document's charset, else UTF-8 | Israeli feeds include windows-1255 and imperfect XML |
| D-11 | Streams and pages are requested with the phone's own WebView User-Agent | Sites treat News Center like the browser on the same phone |
| D-12 | Dark theme by default; Material 3 with a blue accent from the icon, wallpaper colors optional | Video looks best on dark; the desktop app is dark |
| D-13 | Bottom navigation: Watch, Channels, News (and Knesset since 1.2.0, D-23); Settings from the menus; a navigation rail on wide screens | Daily tasks, one tap each |
| D-14 | Signing with a key created by CI and kept in the Actions cache, the same for every build; a workflow to create a release key later | An installable APK now, with updates installing over each other; see MAINTAINING.md for the public-repo cache risk |
| D-15 | Every push: build, unit tests, emulator smoke test with a public test stream, then a pre-release; a `v*` tag makes the full release; the Windows app is built in the same run and attached | Nothing is published unless the shrunk APK actually runs; a public test stream is always available, whatever is on air |
| D-16 | `newscenter://play?url=…&name=…` previews a stream in the spotlight without saving it | Lets the smoke test (and anyone) open a stream directly, without adding channels from outside the app |
| D-17 | Smoke-test screenshots are attached to pre-releases | The owner (and the agent) can see each build's UI without a device |
| D-18 | Version 1.0.0 for the first Android release; development builds are 1.0-dev.N | Feature parity with the desktop app |
| D-19 | The emulator in CI draws with Lavapipe (`-gpu lavapipe`, the emulator's current software renderer), and the test plays a 512×288 stream | With the deprecated SwiftShader modes the whole emulated phone froze, then the emulator quit, seconds after the test stream started next to the live channels (builds 2–5; the phone's log shows the app running normally until everything stopped). An experiment across eight setups ([run 1](https://github.com/EyalShimshi/news-center/actions/runs/44158250899), [repeat](https://github.com/EyalShimshi/news-center/actions/runs/44160119649)): on Android 14, `swiftshader_indirect`, `swiftshader` and `software` froze; `lavapipe` and `swangle` passed 4 of 4. An emulator problem, not the app's |
| D-20 | The Knesset view is a full-window view in Hebrew (right-to-left) that covers the channels while they keep playing | The owner's choice (round 2): the Knesset's data is in Hebrew, and the view needs the whole window |
| D-21 | The Knesset view reads the Knesset's open data (OData v4) and its website's own data service, never the website's pages | Both answer plain requests; the pages sit behind a bot check that holds automated visitors (seen during the scan), so the view only links to them |
| D-22 | Blocked sites are a list in code (`BLOCKED_DOMAINS` in `app/app.js` and `data/Text.kt`, `BlockedDomains` in `host/src/MainForm.cs`), enforced at every layer; docs don't repeat the names | The owner asked that one site never be contacted; one layer missing (a redirect, a frame, a link) would break that |
| D-23 | Android shows the Knesset view itself – `knesset.js`, its guide and `knesset.css`, copied from `app/` by the build – in a WebView, as a fourth tab, with a phone layout (`android.css`) | "Like you did on the exe": one view to maintain, so both apps always match; the view is HTML already, and a Compose rewrite of 1,300 lines would drift from it |
| D-24 | The Android page reads the Knesset through the app (`/__fetch`, answered by `Http`) for HTTPS addresses on knesset.gov.il only; the page can't navigate away, and its links open in the browser | A page can't read other sites itself; the allowlist keeps the page from being a way to reach anything else, and `Http` refuses blocked sites at every redirect (R20) |
| D-25 | On Android, recordings play in a Media3 player with seeking, over everything, with the channels silent until it closes; live sessions among the channels open on the Watch screen, big and heard alone | The desktop's behavior, with the phone's own player (hardware decoding, seek bar, audio focus) instead of a video element in the page |
| D-26 | The Knesset page takes the app's Material colors (light or dark, accent or wallpaper colors) | It should look like part of the app, not a web page |
| D-27 | The new name changes the Android package to `io.github.eyalshimshi.newscenter` (and the CI signing key), so 1.2.0 installs as a new app; the Windows app keeps its settings in a new folder | R22: nothing keeps the old name. Android can't update an app across a package change anyway, so a new key costs nothing more |
| D-28 | CI tests the Knesset view in headless Chrome against the live services, on a phone, a tablet and the desktop, before anything is published; when the Knesset doesn't answer GitHub's machines, missing data is only a warning | The view depends on two outside services; layout and script errors must still fail the build, but the Knesset being unreachable from the cloud must not |
| D-29 | A channel's own window is the dashboard page in single-channel mode (`index.html?channel=<id>`) in a second WebView2 that shares the main window's browser environment; the two pages talk over a `BroadcastChannel`, and the main window keeps the mixer: the window only plays what it's told and forwards its buttons | One tile and player implementation for both; one place for the sound rules, so the windows can't disagree; a shared environment means one cache and one set of browser settings. The window never saves settings, so it can't overwrite the main window's |
| D-30 | Closing a channel's window puts the channel back in the grid, unless News Center closed it (the channel went off air, News Center is closing, Windows is shutting down); "in its own window" is saved with the channel, and each window's place (bounds, maximized, on top) in `channel-windows.json` | Closing the window is the natural way back; going off air or restarting shouldn't lose where the user put it. Windows Forms reports a close from another program, such as Task Manager, as `TaskManagerClosing`; it counts as the user's, so a channel is never left without a window (found by the CI test, D-33) |
| D-31 | A window the user asks for comes to the front; one News Center reopens by itself (at start, back on air) doesn't take the focus | Reopening windows shouldn't take the keyboard from what the user is doing |
| D-32 | On Android, a channel's own window is picture-in-picture, from a pop-out button on the big channel and in fullscreen, whether or not leaving the app does it (Settings) | Android gives an app one floating window, which the user can move anywhere over other apps; a second activity with its own players would compete for the app's single audio focus and the phone's few video decoders |
| D-33 | CI runs the built `NewsCenter.exe` on the Windows runner and drives both windows through the browser's debugging port, with screenshots; the emulator test presses pop out and checks that Android entered picture-in-picture | The feature spans two windows, the host and Windows itself; only running the real program shows that the pieces fit |

## 4. Architecture (Android)

```
MainActivity ── NewsCenterApp (Compose: Watch · Channels · News · Knesset · Settings, fullscreen, PiP)
      │                 │                                  │
      │                 │              KnessetWeb (WebView: assets/knesset/ + app/knesset*.{js,css},
      │                 │                 /__fetch → Http, KnessetFetch) · RecordingPlayer (Media3)
      └── NewsCenterViewModel ──────────────┬── ChannelStore (prefs) ← assets/channels.json
            │  availability, mix,        ├── NewsController ── NewsStore (prefs) ← assets/news.json
            │  spotlight/fullscreen,     ├── KnessetDiscovery ── Http (HttpURLConnection) ── jsoup
            │  Knesset streams, recording├── StreamCheck (is the playlist live?)
            └── PlayerPool ── TilePlayer (ExoPlayer + LevelMeterProcessor) per channel
                     └── AudioFocus (one request for the app; given up while a recording plays)
```

- **Shown channels** = switched on, listed on knesset.tv (for Knesset streams), and live (or
  unreachable, which the player keeps retrying), plus a previewed link.
- **Mixer** (`MixState`): sets of unmuted and soloed ids. Audible = unmuted and (no shown channel
  soloed, or soloed). Spotlight = one channel unmuted and soloed. Gains = (master volume)² for
  audible channels; above 1 the gain goes to the audio processor, with a soft limiter.
- **Players** are acquired by the composables that show them (`rememberTilePlayer`, a
  `RememberObserver`), released 5 seconds after they leave the screen unless audible, retried with
  backoff (3–30 s) on errors, restarted when stuck, stopped when the app leaves the screen and
  resumed at the live edge.
- **Surfaces**: each player renders into a `TextureView`; when two views show the same channel
  (spotlight and fullscreen), the newest one gets the picture and the previous one gets it back.

## 5. Implementation notes

| Spec says | We did | Why |
|---|---|---|
| Hide off-air streams | A channel is shown only after its playlist (or first variant) lists segments; off-air and unreachable channels are checked again every minute; a player that keeps failing triggers a check | The desktop's rule; avoids black tiles |
| Fullscreen inside the app's window | `FullscreenPlayer` fills the activity's window, hides the system bars, and turns to landscape unless in multi-window | A phone app's window is the screen; in split screen it stays in its pane |
| Spotlight + solo button in the middle of the tile | The whole tile is the button (tap) | Touch targets on a phone; long-press is drag |
| Meter hide per stream | `Channel.meter` (in the channel's edit dialog) and a global switch | Same data as the desktop |
| Volume sliders per channel removed | One master volume in the Sound sheet | R9 |
| Zoom slider | Three tile sizes (`GridCells.Adaptive` 320/160/110 dp) | Predictable columns on phones and tablets |
| Discovery every start | On ViewModel creation, every 5 minutes while visible, on returning after 5+ minutes, and on refresh | R4 |
| Channel 12 inside the app | WebView with the page helper in every frame; volume ≤ 100%, no meter/fullscreen/PiP; the WebView is destroyed only after it has left the screen (`AndroidView.onRelease`) | D-08; a web page can't be in two places at once, and a WebView mustn't be destroyed while attached |
| New channels and the spotlight must be visible | A new spotlight scrolls the grid to the top; channels that come on air above the top tile are shown while the grid is at its top | Lazy grids keep their first visible item in place, so items added above it appeared out of sight (found by the emulator test in build 1) |
| Detach a stream into its own window | A pop-out button (`LocalPopOut`, provided by `MainActivity` where the device has picture-in-picture) on the big channel and in fullscreen calls `enterPictureInPictureMode`; if Android refuses (picture-in-picture turned off for the app), a message says where to turn it on | D-32 |

## 6. Known limitations

- Playback stops when the app leaves the screen (except picture-in-picture); no background audio
  with a notification yet.
- Channel 12 depends on Mako's page; if Mako shows a pop-up or needs a tap, use its player in the
  spotlight. It can't be fullscreen or picture-in-picture.
- On Android one channel at a time can float (picture-in-picture is one window per app); on
  Windows every channel can have its own window.
- Some streams are geo-restricted to Israel.
- The CI signing key lives in the Actions cache (see MAINTAINING.md).
- The Knesset view depends on the Knesset's data services, one of them undocumented; if the Knesset
  changes them, the affected parts show "couldn't load" (see docs/knesset-data.md). A recording
  pauses when you leave the app.

## 7. Next options

1. Background audio with a media notification (listen to the Knesset with the screen off).
2. A home-screen widget or quick settings tile for the Knesset Channel.
3. Remote channel/news lists (download updated `channels.json` from this repository) so fixes reach
   installed apps without a new APK, like Shidur's catalog.
4. A release signing key, then Google Play or F-Droid.

# Round 1 – the Android app

## The request

> can we make this into a mobile app? follow the way we made apps like the shidur app in
> U:\radio-app. upload the app to https://github.com/EyalShimshi/news-center which is a new repo for
> this thing. i'm going out of office so no questions. put your final result including your answer
> to this prompt in that repo, and make an installable apk available there as a release. thank you!

## The answer

Yes – News Center is now an Android app as well as a Windows app, built the Shidur way (native
Kotlin, Jetpack Compose, Material 3, Media3; GitHub Actions builds, tests on an emulator and
publishes; the docs are the project's memory). Everything is in this repository, and the APK is
in the [releases](https://github.com/EyalShimshi/news-center/releases/latest).

**What's new**

- **Android app (1.0.0)** with everything the Windows app does, adapted to a phone: a multiview
  grid of every live channel; tap a channel for spotlight + solo; **M**/**S** on every tile with
  several solos at once, everything muted at start; volume to 200% with a limiter; level meters
  you can hide; long-press to rearrange; three tile sizes (two side by side by default);
  fullscreen with channel switching; picture-in-picture.
- **Channels tab**: the same built-in channels (11, 12 via Mako's player, 13, 14, 16, 10,
  i24NEWS, Knesset + four off by default), Knesset committees found automatically on every start,
  every 5 minutes and on refresh, off-air channels hidden until they go live, add/test/edit/remove
  with undo/reset.
- **News tab**: the same 33 sources (5 on), source chips, pull to refresh, add any RSS/Atom feed or
  a site's home page, web-filter detection.
- **One repository for both apps**, with a release that carries the APK *and* the Windows app as a
  zip; every push makes a tested pre-release.
- Hebrew and English, dark theme by default.

**Fixed** – nothing (new app).

**To ship** – pushed to `main` and released as `v1.0.0` (see "Status" below).

**To test**

1. On the phone, open the [latest release](https://github.com/EyalShimshi/news-center/releases/latest)
   and install `news-center-v1.0.0.apk` (allow installs from the browser if asked).
2. Open News Center: after "Checking which channels are on air…" the live channels appear in two
   columns, all muted (red **M**), each with a green level meter.
3. Tap Kan 11: it becomes the big channel and you hear only it. Tap Channel 13: the sound moves.
4. Press **S** on two tiles: you hear both. Press **M** on one of them: it goes quiet.
5. 🔊 → raise the volume past 100%: quiet channels get louder without distorting.
6. Long-press a tile and drag it: the order changes (and matches the Channels tab).
7. On the big channel press ⛶: landscape fullscreen; ⏭ switches channel with its sound. Back
   returns. Press Home with a channel in the spotlight: it continues in a small window.
8. Channels tab: switch on Channel 9, then **Add channel** and paste the knesset.tv embed code –
   the stream address is extracted; **Test stream** says "On air".
9. News tab: headlines from ynet, N12, Maariv, Haaretz and Israel Hayom; tap a chip to filter;
   **News sources** to switch on more.
10. Channel 12: plays inside its tile through Mako's page. In the spotlight you can use Mako's own
    player if it asks for a tap.

**Heads-up**

- I couldn't try the app on a real phone. Every build runs on an Android 14 emulator in GitHub's
  cloud (in the US): there Kan 11, Reshet 13, Now 14 and i24NEWS played live in their tiles with
  their level meters, and a public test stream played in the spotlight; the screenshots are
  attached to each pre-release. Channel 12 (Mako's page in a WebView) is the least certain part –
  Mako may only serve Israel.
- Several CI rounds were needed. The first showed that new tiles (and the spotlight) were added
  above the screen, out of sight – fixed in the app. Then the emulated phone in GitHub's cloud
  froze whenever the test stream started next to the live channels. Recording the phone's log
  showed the app running normally until the whole emulator stopped, and an experiment across eight
  emulator setups pinned it on the emulator's old software renderer; the test now uses its current
  one (Lavapipe) and passes (details in SPEC.md, D-19). On the way, a web-page channel
  (Channel 12) is now destroyed only after it has left the screen.
- Signing: builds are signed with a key that CI keeps in its cache, so updates install over each
  other. Before sharing the app widely, move to a release key (MAINTAINING.md → Signing; one
  uninstall needed then), and set Actions → "Require approval for all external contributors".
- Playback stops when you leave the app (except picture-in-picture).
- To keep the Windows app's folder working, the repository root *is* the Windows app; `NewsCenter.exe`
  itself isn't committed (CI builds it into the release zip).

**Next options**

1. Background audio with a media notification (the Knesset with the screen off).
2. Channel and news lists that update from this repository without a new APK.
3. A release key, then Google Play or F-Droid.
4. A widget or quick-settings tile for the Knesset Channel.

## How it was built

Following [Shidur's build playbook](https://github.com/EyalShimshi/shidur): the toolchain and CI
are Shidur's (AGP 9.2.1, Kotlin 2.3.21, Gradle 9.5.0, R8 + emulator smoke test before publishing),
the UI follows its Material 3 design system (grouped settings, accent presets, dark/pure black,
Hebrew/English with per-app language), and the behavior is ported rule by rule from the Windows
app's `app.js` so both apps agree – see [SPEC.md](../../SPEC.md) for the requirements table, the
decision log (every choice made without asking) and the architecture.

## Status

- Released as **[News Center v1.0.0](https://github.com/EyalShimshi/news-center/releases/tag/v1.0.0)**:
  `news-center-v1.0.0.apk` (Android 12 or newer), `news-center-windows-v1.0.0.zip` (the Windows app)
  and `mapping-v1.0.0.zip` (decodes crash reports from this version).
- Every build passes the same checks before anything is published: the R8-shrunk release build,
  the unit tests (channel catalog, Knesset discovery, feed parsing, the M/S mixer rules, stream and
  news helpers, the built-in lists), and the emulator test – install, live channels in the grid, a
  test stream in the spotlight with its sound and meters, the Channels, News and Watch tabs,
  Settings, and picture-in-picture on the home screen. Each development build ("News Center build N"
  in Releases) carries that run's screenshots.
- In the emulator (in the US): Kan 11, Reshet 13, Now 14, Channel 16 and i24NEWS played in their
  tiles; Channel 12 showed Mako's page for viewers abroad (from Israel that page has the live
  player, which the Windows app plays); News showed N12 and ynet headlines.
- Not checked: a real phone, and Channel 12 from Israel on Android.

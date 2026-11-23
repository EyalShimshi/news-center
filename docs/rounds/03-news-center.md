# Round 3 – News Center, and the Knesset view on Android

## The request

> Make all of the Knesset section in the APK too, like in the Windows app. The repository is
> renamed to news-center: work on that, and change everything from the old name to the new one.

(Paraphrased, without the old name.) Mid-round: finish the APK and publish it as a release on
GitHub, on my own, with no questions.

## The answer

The Android app has a **Knesset** tab with the same Knesset view as the Windows app, and the whole
project is **News Center**.

**What's new**

- **Knesset tab (Android)**: the Windows app's view – the same `knesset.js`, guide and styles – in
  Hebrew, laid out for a phone and in the app's own colors (light or dark, accent or wallpaper):
  - **היום, ועדות, מליאה, הצבעות, חקיקה, חברי הכנסת, ממשלה, מדריך** – the same eight topics, with
    the topics in a row you can swipe sideways.
  - Details open full screen on a phone (beside the list on a tablet); back closes them first.
  - **צפייה** on a live session opens it on the Watch screen as the big channel, heard alone.
  - Recordings play in the phone's own player, with a seek bar, over everything; the channels are
    silent until you close it, and picture-in-picture waits.
  - Links to the Knesset's pages and documents open in your browser.
- **The new name everywhere**: app and window titles, the Android package
  (`io.github.eyalshimshi.newscenter`) and its `newscenter://play` link, the Windows program
  (`NewsCenter.exe`) and its data folder, release files (`news-center-…`), the CI signing key, the
  code's names, and every document. The older releases on GitHub are renamed too.
- **Windows**: the Knesset view's styles moved to `app/knesset.css`, which both apps share.

**Fixed** – ten of the Knesset view's text styles were invalid CSS (`font: 600 14px/1.2 inherit`),
so browsers ignored them; they now apply (tabs, buttons, lists and cards get their intended sizes).

**To ship** – merged to `main` and released as `v1.2.0` with `news-center-v1.2.0.apk`,
`news-center-windows-v1.2.0.zip` and `mapping-v1.2.0.zip`.

**To test**

1. Uninstall the earlier app, then install `news-center-v1.2.0.apk` from the release.
2. Open **הכנסת** (Knesset) in the bottom bar: today's page appears in the app's colors.
3. Swipe the topics sideways; open **ועדות** → a committee: members with photos, sessions.
4. Back closes the committee; back again leaves the tab.
5. On a day with a live session, **צפייה** jumps to Watch with it big and alone.
6. **הקלטה** on a past session: the recording plays with a seek bar; the channels are silent until
   you close it.
7. Settings → theme light/dark or another accent: the Knesset tab follows.

**Heads-up**

- The new package name makes 1.2.0 a new app next to the earlier one: uninstall the earlier one.
  Channels and settings start from the defaults, on Android and on Windows.
- The git history (old commit messages) and the earlier APKs' contents keep the old name; titles,
  file names and descriptions of the old releases now use the new one. GitHub sends visitors of the
  old address to the new one.
- Nothing was built or run on this computer: every build and test ran on GitHub's machines, and
  the working copy used for the changes was deleted at the end.
- The Knesset tab needs the Knesset's services; when they don't answer, it says so and offers to
  try again.

**Next options**

1. Notifications when a committee you follow starts a live session.
2. Following bills: a list of bills you care about, marked when their stage changes.
3. Background audio with a media notification (listen to the Knesset with the screen off).
4. Full-text search in protocols (the website's smart protocol service).

## How it was made

- **One view, two hosts.** The Android tab is the Windows view itself, not a copy: the Gradle task
  `sharedKnessetAssets` copies `app/knesset.js`, `app/knesset-guide.js` and `app/knesset.css` into
  the APK beside `assets/knesset/index.html`. The view gained a few optional hooks for its host
  (`embedded`, `playVideo`, `onBackState`, `back()`, `rerender()`), described at the top of
  `knesset.js`; on Windows nothing changed.
- **The Android side.** `KnessetWeb.kt` keeps one WebView for the app's lifetime (switching tabs
  keeps your place), serves the page from the APK and answers its Knesset requests at `/__fetch`
  through the app's `Http`: HTTPS on knesset.gov.il only (`KnessetFetch`, unit-tested), blocked
  sites refused at every redirect. `android.js` connects the page; `android.css` lays it out for
  touch and maps the app's Material colors (sent by `KnessetScreen.kt`) onto the view's colors.
  `RecordingPlayer.kt` plays recordings with Media3.
- **Testing.** A new CI job, `knesset-web`, opens the view in headless Chrome against the Knesset's
  live services – on a phone in dark and light colors, on a tablet, and in the Windows dashboard –
  and checks every tab and detail, the back gesture, watching and recordings handed to the app, that
  nothing is wider than the screen, no script errors and no request to a blocked site; it saves
  screenshots. The emulator test opens the Knesset tab and waits for its first page. Releases are
  published only when both pass.

## Status

Released as `v1.2.0`; see the [releases](https://github.com/EyalShimshi/news-center/releases).

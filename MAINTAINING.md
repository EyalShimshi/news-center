# Maintaining News Center

How the project is built, released, signed and kept working. For what the apps do, see
[README.md](README.md); for why things are the way they are, see [SPEC.md](SPEC.md).

## Repository layout

| Path | What |
|---|---|
| `android/` | The Android app (Gradle project; module `android/app`) |
| `android/app/src/main/assets/channels.json` | Built-in channels for Android |
| `android/app/src/main/assets/news.json` | Built-in news sources for Android |
| `android/app/src/main/assets/page-helper.js` | Runs inside web-page channels (Channel 12) on Android |
| `android/app/src/main/assets/knesset/` | The Android Knesset tab's page: `index.html`, `android.css` (phone layout, the app's colors) and `android.js` (connects it to the app). The build adds the three shared files below |
| `app/` | The Windows app's dashboard (HTML/JS); `app/channels.js` and `app/news.js` are its built-in lists |
| `app/knesset.js`, `app/knesset-guide.js`, `app/knesset.css` | The Knesset view both apps show, its Hebrew guide (glossary, bill stages, links) and its styles |
| `docs/knesset-data.md` | The Knesset's website and data services, as the Knesset view uses them: endpoints, codes, quirks. Start here when the Knesset changes something |
| `host/` | The Windows app's window (C#, WebView2); `host\build.cmd` builds `NewsCenter.exe` |
| `.github/workflows/build.yml` | CI: builds, tests and publishes both apps |
| `.github/scripts/smoke-test.sh` | Runs the Android release APK on an emulator before anything is published |
| `.github/scripts/desktop-window-test.mjs` | Runs the built `NewsCenter.exe` on Windows and checks a channel in its own window, driving both windows through the browser's debugging port |
| `.github/scripts/knesset-web-test.mjs` | Tests the Knesset view on a phone, a tablet and the desktop against the Knesset's live services |

## How builds and releases work

GitHub Actions is the build machine; nothing needs to be installed locally.

Every push to `main` runs **Build** (`build.yml`); so does every push to a `dev/…` branch, which
builds and tests the same way but publishes nothing:

1. **android**: `gradle assembleRelease` (R8 on), `gradle testDebugUnitTest`, then a smoke test on
   an Android 14 emulator: open the app, play a public test stream from a
   `newscenter://play?url=…` link, open every tab and Settings, pop the test stream out into a
   floating window (picture-in-picture) and back, go to the home screen. The Knesset
   tab must show its first page (the Knesset not answering the emulator is only a warning) without
   script errors. Any crash fails
   the job (decoded with the build's R8 mapping file). Screenshots are kept as `smoke-*.png`.
   The emulator draws with **Lavapipe** (`-gpu lavapipe`), its current software renderer: with
   the older SwiftShader modes the whole emulator froze and quit seconds after the test stream
   started next to the live channels (builds 2–5), and a one-off experiment across eight emulator
   setups showed Lavapipe and SwANGLE pass. While the test runs it records the phone's log
   (`logcat.txt`) and the build machine's memory (`host.txt`), kept with the screenshots in the
   run's `smoke-test` artifact (not published), because a dead emulator leaves nothing to collect.
   If one of the emulator's own apps stops responding, the test answers its dialog with **Wait**.
   Every `adb` call has a time limit and the step stops after 20 minutes, so a frozen emulator
   can't hold the pipeline. The Israeli channels play from GitHub's servers too, so the
   screenshots show real channels.
2. **desktop** (Windows): `host\build.cmd`, then `desktop-window-test.mjs` runs the new
   `NewsCenter.exe` on the build machine (installing the WebView2 Runtime first if it's missing)
   with a public test stream as the only channel, and drives the main window and the channel's own
   window through the browser's debugging port (`NEWSCENTER_DEBUG_PORT`): the channel moves to its
   own window and plays there; S, M and "hear only this" in the window change the main window's
   mixer and come back; pin (checked with Windows itself), fullscreen and `Esc`; the window's back
   button, closing the window as a user does and as another program does all put the channel back;
   after a restart it reopens in its window. Screenshots of both pages and of the desktop: the run's
   `desktop-test` artifact. Only then is `news-center-windows-N.zip` made (`NewsCenter.exe`, `app/`,
   `DESKTOP.md` as `README.md`, `LICENSE`).
3. **knesset-web**: `knesset-web-test.mjs` opens the Knesset view in headless Chrome, as the
   Android page on a phone (dark and light colors) and a tablet and as the Windows dashboard,
   against the Knesset's live services: every tab and detail, the back gesture, watching and
   recordings handed to the app, nothing wider than the screen, no script errors, no request to a
   blocked site. A small server stands in for the apps' fetch bridges with the same rules, and
   requests anywhere but the Knesset are refused. When the Knesset doesn't answer GitHub's
   machines, missing data is a warning. Screenshots: the run's `knesset-web` artifact.
4. **publish** (main and tags only): if the Android job and the Knesset view test passed, a
   **pre-release** named "News Center build N" (tag
   `build-N`) with `news-center-N.apk`, `mapping-N.zip`, the Windows zip (if that job passed) and the
   smoke-test screenshots.

Build errors and test failures are copied into the run's **Summary** page.

### Official releases

1. Update [`RELEASE_NOTES.md`](RELEASE_NOTES.md) (it becomes the release's description) and push.
2. Wait for the build to pass, then tag the same commit:
   `git tag v1.0.1 && git push origin v1.0.1`.
3. The tag build names the version after the tag (`versionName` 1.0.1; `versionCode` is always
   the run number, so every build installs over the previous one) and publishes a full release
   with `news-center-v1.0.1.apk`, `news-center-windows-v1.0.1.zip` and `mapping-v1.0.1.zip`.

### Signing

Android only installs an update signed with the same key as the installed app.

- **Now:** every build is signed with one key that CI creates once and keeps in the Actions cache
  (`newscenter-debug-keystore-v1`). The weekly scheduled run touches the cache so GitHub never evicts
  it (unused caches go after 7 days). If it is ever lost, the next build creates a new key and
  phones must uninstall once before installing it. (The key was made anew with the move to the
  News Center name, when the app's package name changed too, so no update crossed it anyway.)
- **Risk:** the repository is public, and Actions caches are not secrets: a workflow run from a
  fork's pull request can read caches of the default branch. In **Settings → Actions → General →
  Fork pull request workflows**, choose **Require approval for all external contributors**, and
  never approve a run that changes `.github/`.
- **Moving to a release key** (recommended before sharing widely or publishing to a store): run the
  **Create release signing key** workflow from the Actions tab, download its artifact, add
  `RELEASE_KEYSTORE_BASE64.txt` and `RELEASE_KEYSTORE_PASSWORD.txt` as repository secrets
  `RELEASE_KEYSTORE_BASE64` and `RELEASE_KEYSTORE_PASSWORD`, keep the zip somewhere safe, and
  delete the artifact. Builds then use the release key; installed copies must be uninstalled once.

## Channels and news sources

The two apps ship the same lists: change both.

- **Windows:** `app/channels.js`, `app/news.js` (the comments at their top explain the fields).
- **Android:** `android/app/src/main/assets/channels.json` and `news.json`, with the same fields.
  Raise `catalogVersion` (for example to `YYYYMMDD01`). `AssetsTest` fails the build if an entry is
  invalid, an id repeats, an address isn't HTTPS, or the Knesset Channel's id doesn't match what
  discovery produces.

To regenerate the Android files from the Windows ones (Node.js):

```powershell
@'
const fs = require('fs'), vm = require('vm');
const load = (f, k) => { const s = { window: {} }; vm.runInNewContext(fs.readFileSync(f, 'utf8'), s); return s.window[k]; };
const v = Number(new Date().toISOString().slice(0, 10).replace(/-/g, '') + '01');
const channels = load('app/channels.js', 'NEWSCENTER_CHANNELS').map(({ id, name, description, kind, url, poster, enabled, auto }) =>
  Object.fromEntries(Object.entries({ id, name, description, kind, url, poster, enabled, auto }).filter(([, x]) => x !== undefined && x !== '')));
const sources = load('app/news.js', 'NEWSCENTER_NEWS');
fs.writeFileSync('android/app/src/main/assets/channels.json', JSON.stringify({ catalogVersion: v, channels }, null, 2) + '\n');
fs.writeFileSync('android/app/src/main/assets/news.json', JSON.stringify({ catalogVersion: v, sources }, null, 2) + '\n');
'@ | node -
```

User changes survive updates in both apps: unedited built-in channels follow the list, edited ones
keep the user's changes, new built-ins appear next to their neighbours, and removed ones stay
removed until **Reset**.

### Knesset discovery

Both apps read `https://www.knesset.tv/live/` with the same rules (Windows: `discoverKnesset` in
`app/app.js`; Android: `KnessetDiscovery.kt`):

- The main channel: `.main-live-video-container iframe[src]`, a `watch.knesset.tv/?src=<m3u8>&poster=<image>` player.
- Other broadcasts: every `.secondary-video-container` that isn't hidden; each one's page has
  `.video-page-player iframe[src]` (or `iframe.video-iframe[src]`), its title in `.heading-block h1`
  and what's on in `.heading-block h6`.
- A stream's id is `knesset:` + host + folder, so it survives playlist renames.

If knesset.tv changes its page, both places need the new selectors; `KnessetDiscoveryTest` holds a
sample of the page structure.

## The Knesset view

One view for both apps: `app/knesset.js` (the view), `app/knesset-guide.js` (its texts) and
`app/knesset.css` (its styles). Change them once.

- **Windows:** `app/index.html` loads them; `app/app.js` creates the view with
  `NewsCenterKnesset(api)` and answers its requests through the window's fetch bridge.
- **Android:** the Gradle task `sharedKnessetAssets` (`android/app/build.gradle.kts`) copies the
  three files into the APK beside `assets/knesset/index.html`. `KnessetWeb.kt` loads that page in
  one WebView kept for the app's lifetime, and answers `/__fetch?u=<address>` through `Http` for
  HTTPS addresses on knesset.gov.il only (`KnessetFetch`), with blocked sites refused at every
  redirect. `android.js` gives the view the same `api` with `embedded: true` (the view never
  closes), `playVideo` (recordings go to `RecordingPlayer.kt`, with the channels silent) and
  `onBackState` (the back gesture closes details first). `KnessetScreen.kt` passes the app's
  Material colors, which `android.css` maps onto the view's color variables.

The `api` is described at the top of `knesset.js`; anything new the view needs from its host
belongs there and in both hosts. What the Knesset's services offer, and their quirks, is in
[docs/knesset-data.md](docs/knesset-data.md).

## Checking changes before pushing

From the playbook (PowerShell, prints nothing when fine):

```powershell
Get-Content android/app/src/main/assets/channels.json -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null
Get-Content android/app/src/main/assets/news.json -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null
Get-ChildItem android/app/src/main/res -Recurse -Filter *.xml | ForEach-Object {
  try { [xml](Get-Content $_.FullName -Raw -Encoding UTF8) | Out-Null } catch { "Broken XML: $($_.FullName)" } }
Select-String -Path android/app/src/main/res/values*/strings.xml -Encoding UTF8 -Pattern '<(string|item)[^>]*>(?!")[^<]*(?<!\\)'''
```

Compiling, unit tests, the emulator test and the Windows app's window test run in CI.

## Crash reports

The Android app keeps its last crash on the device and offers to copy it or open a pre-filled
GitHub issue. Names in the stack trace are shortened by R8; decode them with the build's mapping
file (`mapping-N.zip` in the same release):

```bash
$ANDROID_HOME/cmdline-tools/latest/bin/retrace mapping-N.txt crash.txt
```

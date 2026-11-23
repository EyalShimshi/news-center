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
| `app/` | The Windows app's dashboard (HTML/JS); `app/channels.js` and `app/news.js` are its built-in lists |
| `app/knesset.js`, `app/knesset-guide.js` | The Windows app's Knesset view, and its Hebrew guide, glossary, bill stages and links |
| `docs/knesset-data.md` | The Knesset's website and data services, as the Knesset view uses them: endpoints, codes, quirks. Start here when the Knesset changes something |
| `host/` | The Windows app's window (C#, WebView2); `host\build.cmd` builds `NewsCenter.exe` |
| `.github/workflows/build.yml` | CI: builds, tests and publishes both apps |
| `.github/scripts/smoke-test.sh` | Runs the Android release APK on an emulator before anything is published |

## How builds and releases work

GitHub Actions is the build machine; nothing needs to be installed locally.

Every push to `main` runs **Build** (`build.yml`):

1. **android**: `gradle assembleRelease` (R8 on), `gradle testDebugUnitTest`, then a smoke test on
   an Android 14 emulator: open the app, play a public test stream from a
   `newscenter://play?url=…` link, open every tab and Settings, go to the home screen. Any crash fails
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
2. **desktop** (Windows): `host\build.cmd`, then `news-center-windows-N.zip` (`NewsCenter.exe`, `app/`,
   `DESKTOP.md` as `README.md`, `LICENSE`).
3. **publish**: if the Android job passed, a **pre-release** named "News Center build N" (tag
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
  phones must uninstall once before installing it.
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

## Checking changes before pushing

From the playbook (PowerShell, prints nothing when fine):

```powershell
Get-Content android/app/src/main/assets/channels.json -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null
Get-Content android/app/src/main/assets/news.json -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null
Get-ChildItem android/app/src/main/res -Recurse -Filter *.xml | ForEach-Object {
  try { [xml](Get-Content $_.FullName -Raw -Encoding UTF8) | Out-Null } catch { "Broken XML: $($_.FullName)" } }
Select-String -Path android/app/src/main/res/values*/strings.xml -Encoding UTF8 -Pattern '<(string|item)[^>]*>(?!")[^<]*(?<!\\)'''
```

Compiling, unit tests and the emulator test run in CI.

## Crash reports

The Android app keeps its last crash on the device and offers to copy it or open a pre-filled
GitHub issue. Names in the stack trace are shortened by R8; decode them with the build's mapping
file (`mapping-N.zip` in the same release):

```bash
$ANDROID_HOME/cmdline-tools/latest/bin/retrace mapping-N.txt crash.txt
```

# News Center

Israeli live TV in one multiview screen, with a mixer: watch several channels side by side, hear
exactly the ones you want, follow the news next to them, and see what the Knesset is doing today.
News Center comes as an **Android app** and a **Windows app**, with the same channels, the same
sound rules, the same news sources and the same Knesset view.

[עברית למטה](#עברית)

| | Android | Windows |
|---|---|---|
| Download | [`news-center-….apk`](https://github.com/EyalShimshi/news-center/releases/latest) (Android 12 or newer) | [`news-center-windows-….zip`](https://github.com/EyalShimshi/news-center/releases/latest) (Windows 10 or 11) |
| Guide | [below](#the-android-app) | [DESKTOP.md](DESKTOP.md) |
| Source | [`android/`](android) (Kotlin, Jetpack Compose, Media3) | [`app/`](app) and [`host/`](host) (HTML/JS in WebView2, C#) |

How the Android app was made, what's in version 1.0.0 and how to try it:
[docs/rounds/01-android-app.md](docs/rounds/01-android-app.md). The Knesset view:
[docs/rounds/02-knesset-view.md](docs/rounds/02-knesset-view.md) (Windows) and
[docs/rounds/03-news-center.md](docs/rounds/03-news-center.md) (Android, and the new name).

## Channels

| Channel | Source | Starts |
|---|---|---|
| Kan 11 | Kan's live stream | On |
| Channel 12 (Keshet) | Mako's own live page and player, shown inside the tile | On |
| Channel 13 (Reshet) | Reshet 13's live stream | On |
| Now 14 | Channel 14's live stream | On |
| Channel 16 | Channel 16's live stream | On |
| Channel 10 (TV10, business) | TV10's live stream | On |
| i24NEWS (Hebrew) | i24NEWS's live stream | On |
| Knesset Channel | knesset.tv | On |
| Knesset committees and special broadcasts | Found automatically on [knesset.tv/live](https://www.knesset.tv/live/) | When live |
| i24NEWS English, Kan Educational, Makan 33 (Arabic), Channel 9 (Russian) | The broadcasters' live streams | Off (switch on in Channels) |

Both apps check knesset.tv every time they start, every five minutes, and on every refresh: new
committee broadcasts appear by themselves, and channels that are off air stay out of the way until
they go live.

## The Android app

### Install

1. On your phone, open the [latest release](https://github.com/EyalShimshi/news-center/releases/latest)
   and tap `news-center-v….apk`. Allow your browser to install apps if Android asks.
2. Open **News Center**. Every channel starts muted.

Updates: install the newer APK over the old one, or add `https://github.com/EyalShimshi/news-center`
to [Obtainium](https://obtainium.imranr.dev/) to be told about new versions. Every change to the
code also produces a development build (a pre-release named "News Center build N"). Version 1.2.0
is the first under the News Center name and installs as a new app: uninstall the earlier one.

### Watch

- **Multiview**: every live channel plays at once in a grid. Tile size: Large (one per row on an
  upright phone), Medium (two side by side, the default) or Small (three).
- **Tap a channel: spotlight + solo.** It becomes the big channel at the top and the only one you
  hear; every other channel is muted. Tap another channel to switch. **⊞** on the big channel puts
  it back in the grid with its sound on.
- **M** mutes or unmutes a channel. **S** solos it (and unmutes it). Solo several channels to hear
  all of them; while any channel is soloed, only soloed channels are heard. Mute wins over solo.
- **Sound** (🔊 in the top bar): one volume up to **200%** (above 100% boosts quiet channels, with
  a limiter so it doesn't distort), **Mute all / Unmute all**, and **Clear solos**.
- **Level meters**: green bars show each channel's sound level, even while it's muted. Hide them
  all from the ⋮ menu or Settings, or one channel's from its edit dialog.
- **Rearrange**: long-press a tile and drag it. The order is the same as in Channels.
- **Fullscreen** (⛶ on the big channel): the phone turns sideways, ⏮ ⏭ switch channels and the
  sound follows. In split screen it fills just News Center's window.
- **Picture-in-picture**: leave the app while a channel is in the spotlight and it keeps playing in
  a small window. Channels you can hear keep playing while you read the News tab.
- **Refresh** (↻) looks for new Knesset broadcasts, checks every channel and reloads them.
- Grid tiles play at most 480p to save data and battery; the big channel plays at full quality
  (Settings → Save data in the grid).

### Channels

Switch channels on and off, drag ⠿ to reorder, and tap a channel to edit it. **Add channel**
takes an HLS address (`.m3u8`), an embed `<iframe>` code or a `watch.knesset.tv` link (the stream
is extracted automatically), or a web page that has its own player. **Test stream** checks it
first. Removing a channel can be undone; built-in and Knesset channels you remove stay removed
until **Reset channels**.

### News

Headlines from the news sites you switch on, newest first, refreshed every few minutes while the
tab is open; pull down to refresh. The chips show one source at a time. Tap a headline to read it
in your browser. **News sources** (the RSS button) lists 32 built-in sources in Hebrew and
English: ynet מבזקים, N12, מעריב מבזקים, הארץ and ישראל היום are on at first; also ynet ראשי,
N12 צבא וביטחון and חדשות בעולם, מעריב, וואלה!, גלובס, ערוץ 7, כיכר השבת, בחדרי חרדים,
רוטר, The Jerusalem Post, Haaretz, Ynetnews, Globes, BBC, The Guardian, The New York Times, The
Washington Post, CNBC, Sky News, Fox News, CBS News, NPR, Axios, France 24, DW and Euronews.
**Add source** takes any RSS or Atom feed, or a news site's home page that names its feed. If a
network's web filter blocks a site, its row says so.

### Knesset

The Knesset's day-to-day work, in Hebrew, straight from the Knesset's own data – the same view as
the Windows app, laid out for a phone and in the app's colors:

- **היום** (Today): what's on air now, today's plenum and committee sessions with their agendas,
  the next plenum sitting and the week ahead in the committees.
- **ועדות** (Committees), **מליאה** (Plenum), **הצבעות** (Votes) and **חקיקה** (Legislation): every
  committee with its members and sessions, the sittings, every vote and how each MK voted, every
  bill with its stage in plain words.
- **חברי הכנסת** (MKs) and **ממשלה** (Government): all 120 MKs (who's in the building now) and the
  government. **מדריך** (Guide): how the Knesset works, with a glossary.

Tap an item for its details; back closes them. **צפייה** (watch) on a live session opens it on the
Watch screen as the big channel, heard alone. Recordings play in a player you can seek in, with the
channels silent until you close it. Links to the Knesset's pages and documents open in your browser.

### Channel 12

Mako's streams only play in Mako's own player, so the Channel 12 tile shows Mako's live page with
everything but the player hidden (the same approach as the Windows app). Its M and S work like on
any channel; its volume stops at 100%, and it has no level meter, fullscreen or
picture-in-picture. In the grid the tile responds to News Center's taps; in the spotlight you can use
Mako's own player (for example to close a pop-up or press play).

### Settings

Tile size, data saving, level meters, picture-in-picture, keeping the screen on, theme (dark by
default), wallpaper or accent colors, pure black, and the app's language (Hebrew or English).

## The Windows app

A borderless window with its own title bar, a resizable multiview with Grid and Spotlight layouts,
a News panel beside or below the channels, keyboard shortcuts for everything, and fullscreen inside
the window. **Knesset** (`K`) opens a full-window view, in Hebrew, of the Knesset's day-to-day
work: what's on air and on the agenda today, every committee with its members and sessions, plenum
sittings, every vote and how each MK voted, bills with their stage in plain words, all 120 MKs
(who's in the building now), the government, and a guide with a glossary. Live sessions open in the
grid and recordings play in place. See [DESKTOP.md](DESKTOP.md) and, for the Knesset's data,
[docs/knesset-data.md](docs/knesset-data.md).

## Privacy

No accounts, no ads, no analytics, no tracking. The apps talk only to the broadcasters' streams and
pages, knesset.tv, the Knesset's data services (knesset.gov.il) while the Knesset view is open, and
the news sites you switch on. Your channels, sources and settings stay on your device. See
[PRIVACY.md](PRIVACY.md).

## Disclaimer

News Center is an independent, unofficial app. It isn't affiliated with the Knesset, Kan, Keshet,
Reshet, Channel 14, Channel 16, TV10, i24NEWS, Channel 9 or any news site. It plays the
broadcasters' own public live streams and pages and opens articles on their own sites. Some
streams are only available in Israel.

## Build from source

- **Android**: GitHub Actions builds, tests and publishes every push (see
  [`.github/workflows/build.yml`](.github/workflows/build.yml)). Locally, with Android Studio or
  JDK 21 + Gradle 9.5 + the Android SDK: `cd android && gradle assembleRelease`.
- **Windows**: `host\build.cmd` (downloads the C# compiler and the WebView2 SDK from nuget.org on
  first use).

How the project is maintained, released and signed: [MAINTAINING.md](MAINTAINING.md). Decisions,
requirements and implementation notes: [SPEC.md](SPEC.md). The story of the Android version:
[docs/rounds/01-android-app.md](docs/rounds/01-android-app.md).

## License

[GPL-3.0-or-later](LICENSE). [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0) is
included in `app/vendor`. The Android app uses AndroidX, Jetpack Compose, Media3 and
androidx.webkit (Apache-2.0), [jsoup](https://jsoup.org/) (MIT), kotlinx (Apache-2.0) and
[Reorderable](https://github.com/Calvin-LL/Reorderable) (Apache-2.0); its icons are Material
Icons (Apache-2.0).

---

## עברית

**News Center** – כל ערוצי הטלוויזיה החיים בישראל במסך אחד, עם מיקסר: רואים כמה ערוצים זה לצד זה,
שומעים בדיוק את מה שרוצים, ועוקבים אחרי החדשות לצידם. יש אפליקציה לאנדרואיד ואפליקציה ל־Windows.

**התקנה באנדרואיד:** פותחים בטלפון את [הגרסה האחרונה](https://github.com/EyalShimshi/news-center/releases/latest)
ומקישים על הקובץ `news-center-v….apk` (אנדרואיד 12 ומעלה). כל הערוצים מתחילים מושתקים.

- **ערוצים:** כאן 11, קשת 12 (בנגן של mako), רשת 13, עכשיו 14, ערוץ 16, ערוץ 10, i24NEWS וערוץ הכנסת.
  ועדות הכנסת ושידורים מיוחדים נמצאים אוטומטית ב־knesset.tv בכל פתיחה, כל חמש דקות ובכל רענון.
  ערוצים שלא משדרים לא מוצגים, ומופיעים מעצמם כשהשידור מתחיל.
- **הקשה על ערוץ** מגדילה אותו ומשמיעה רק אותו; כל השאר מושתקים. הקשה על ערוץ אחר עוברת אליו.
- **M** משתיק, **S** מעביר לסולו (אפשר כמה ערוצים בסולו – ואז שומעים רק אותם). השתקה גוברת על סולו.
- **עוצמה עד 200%** עם מגביל, ומדי עוצמה ירוקים בכל משבצת (אפשר להסתיר).
- **לחיצה ארוכה וגרירה** משנה את סדר המשבצות; גודל המשבצות: אחת, שתיים או שלוש בשורה.
- **מסך מלא** עם מעבר בין ערוצים, ו**תמונה בתוך תמונה** כשיוצאים מהאפליקציה.
- **חדשות:** 32 מקורות בעברית ובאנגלית (חמישה פעילים בהתחלה), סינון לפי מקור, משיכה לרענון,
  והוספת כל פיד RSS או Atom.
- **הכנסת:** מה קורה היום במליאה ובוועדות, הוועדות וחבריהן, ההצבעות ואיך הצביע כל ח״כ, הצעות החוק
  ובאיזה שלב כל אחת, כל 120 חברי הכנסת, הממשלה ומדריך עם מילון מונחים – ישירות מהמידע של הכנסת.
  דיון חי נפתח כערוץ הגדול, והקלטות מתנגנות בנגן עם אפשרות דילוג.
- **ניהול ערוצים:** הפעלה וכיבוי, שינוי סדר, הוספת ערוץ (כתובת m3u8, קוד הטמעה או קישור watch.knesset.tv), בדיקה ואיפוס.
- ממשק בעברית ובאנגלית, ערכה כהה כברירת מחדל.

האפליקציה עצמאית ואינה קשורה לגופי השידור. אין בה חשבונות, פרסומות או מעקב.

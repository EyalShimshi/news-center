## News Center 1.2.0

A new name, and the **Knesset view on Android**.

### Android (`news-center-v1.2.0.apk`, Android 12 or newer)

- **A new name, installed as a new app.** The app is now News Center
  (`io.github.eyalshimshi.newscenter`), so this version installs next to any earlier version
  instead of over it: uninstall the earlier one. Channels and settings start from the defaults.
- **Knesset** tab: the Windows app's Knesset view, in Hebrew, laid out for a phone and in the app's
  own colors (light or dark, accent or wallpaper colors):
  - **היום** – what's on air now, today's plenum and committee sessions with their agendas, the
    next plenum sitting, the week ahead in the committees.
  - **ועדות** – every committee with its chair, responsibilities, members, staff, sessions and press
    releases.
  - **מליאה** and **הצבעות** – the sittings and their agendas, every vote and how each MK voted.
  - **חקיקה** – every bill with its stage in plain words, and recently passed laws with summaries.
  - **חברי הכנסת** and **ממשלה** – the factions, all 120 MKs (who's in the building now), the
    government.
  - **מדריך** – how the Knesset works, how a law is made, a glossary, and links to the Knesset's
    pages.
  - Tap an item for its details; back closes them. A live session opens on the Watch screen as the
    big channel, heard alone. Recordings play in a player you can seek in, with the channels silent
    until you close it. Links open in your browser.
- Stream links are now `newscenter://play?url=…`.

### Windows (`news-center-windows-v1.2.0.zip`)

- The program is now `NewsCenter.exe`. It keeps its settings in a new place, so it starts with the
  default channels and choices.
- The Knesset view's text sizes now apply as designed (some of its styles were being ignored).

Unzip and run `NewsCenter.exe` (Windows 10 or 11). See
[DESKTOP.md](https://github.com/EyalShimshi/news-center/blob/main/DESKTOP.md).

`mapping-v1.2.0.zip` decodes Android crash reports from this version.

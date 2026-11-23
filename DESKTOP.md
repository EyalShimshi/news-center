# News Center for Windows

> This is the guide to the Windows app. The Android app, downloads and an overview of both are in
> [README.md](README.md).

A desktop multiview dashboard for live TV. It plays several channels side by side
in its own window, with mixer-style **M** (mute) and **S** (solo) buttons, a
volume slider that goes up to 200%, a live audio meter for every channel, a
News panel with headlines from the news sites you pick, and a **Knesset view**
that explains the Knesset's day in plain Hebrew.

## Start

Download `news-center-windows-….zip` from the [latest release](https://github.com/EyalShimshi/news-center/releases/latest),
unzip it anywhere and double-click `NewsCenter.exe` (or build it yourself with `host\build.cmd`). It needs Windows 10 or 11 with the Microsoft Edge
WebView2 Runtime and .NET Framework 4.8, both of which are part of Windows 11.
Starting it again while it is open brings the existing window forward.

Settings, the window position and the browser cache are kept in
`%LOCALAPPDATA%\NewsCenter`.

## The window

The title bar is part of the dashboard: drag its empty space to move the window,
double-click it to maximize, and use the buttons on the right to minimize,
maximize or close. Drag any edge or corner to resize. Windows Snap works as usual.

## Channels

| Channel | Source |
| --- | --- |
| Kan 11 | Kan's live stream |
| Channel 12 | Mako's own player, shown inside the tile |
| Channel 13 | Reshet 13's live stream |
| Now 14 | Channel 14's live stream |
| Channel 16 | Channel 16's live stream |
| Channel 10 (TV10, the business channel) | TV10's live stream |
| i24NEWS (Hebrew, channel 15 on most TV providers) | i24NEWS's live stream |
| Knesset Channel | knesset.tv |
| Knesset committees and other Knesset broadcasts | Found automatically on knesset.tv |

These channels are also built in but start switched off. Turn them on in the
channel manager (`C`):

| Channel | Source |
| --- | --- |
| i24NEWS English | i24NEWS's live stream |
| Kan Educational | Kan's live stream |
| Makan 33 (Arabic) | Kan's live stream |
| Channel 9 (Russian) | Channel 9's live stream |

Channels added to News Center in an update appear next to the channel listed before
them above, even if you have rearranged your channels.

News Center reads [knesset.tv/live](https://www.knesset.tv/live/) every time it
starts, every five minutes, and whenever you refresh. New committee streams are
added by themselves. Entries that knesset.tv hides are ignored.

Channels that are off air stay out of the grid and appear as soon as they go
live, so committee streams pop in and out on their own. The channel manager
lists them with their status.

**Refresh** (the ↻ button or `F5`) looks for new Knesset streams, checks every
channel again, reloads what is playing and refreshes the news.

### Channel 12

Mako's streams only play in Mako's own player, so the Channel 12 tile shows
Mako's live page with everything except the player hidden. Mako's ads and
prompts still appear in the player. If Mako shows a pop-up, close it and press
play in the tile. The tile's M, S and volume slider work like on any other
channel; its volume goes up to 100%.

## News

The **News** panel (the **News** button or `N`) lists the latest headlines from
the news sites you choose, newest first. It sits beside the channels, or below
them on a portrait screen; drag its inner edge to resize it, and double-click
the edge for the default size.

- Every headline shows its source and time. Headlines that arrived in the last
  ten minutes are marked **New**. Click a headline to read it in your web browser.
- The chips above the list show one source at a time; click the chip again (or
  **All**) to see every source.
- Headlines refresh every three minutes while the panel is open, and whenever you
  refresh (`F5`). Nothing is downloaded while the panel is hidden.

Choose the sources in the channel manager's **News sources** tab (the list button
on the News panel opens it). Switch outlets on and off as with channels. These
are on at first: ynet מבזקים, N12, מעריב מבזקים, הארץ and ישראל היום. Also
built in, in Hebrew: ynet ראשי, N12 צבא וביטחון, N12 חדשות בעולם, מעריב,
וואלה!, גלובס, ערוץ 7 מבזקים, כיכר השבת, בחדרי חרדים and רוטר; in
English: The Jerusalem Post, Haaretz, Ynetnews, Globes, BBC News, The Guardian,
The New York Times, The Washington Post, CNBC, Sky News, Fox News, CBS News, NPR,
Axios, France 24, DW and Euronews.

**Add news source** takes any RSS or Atom feed address, or a news site's home
page when the page names its feed. **Test feed** checks it and fills in its name.
If a network's web filter blocks a site, its row in the list says so.

Some sites are blocked in News Center altogether (the list is `BLOCKED_DOMAINS` in
`app/app.js` and `BlockedDomains` in `host/src/MainForm.cs`): they can't be added
as a source or a channel, saved ones are dropped, and the window refuses every
request to them – pages, frames, feeds, redirects and links.

## The Knesset view

**Knesset** in the title bar (or `K`) opens a full-window view, in Hebrew, of the
Knesset's day-to-day work. The channels keep playing underneath; `K` or `Esc`
brings them back, and `F5` refreshes the view.

| Tab | What it shows |
| --- | --- |
| היום (Today) | What's on air now (the plenum's current topic and the Knesset streams in the grid), today's plenum and committee sessions in time order with their agendas, cancelled and closed sessions, the next plenum sitting, the week ahead in the committees, and where the Knesset is in its year |
| ועדות (Committees) | Every committee of the current Knesset by type, with its chair and next session; a committee's responsibilities, chair, members, substitutes, staff, contact details, upcoming and recent sessions, and press releases |
| מליאה (Plenum) | The sittings; a sitting's discussed items by type, the items only laid on the table, its votes and its record (דברי הכנסת) |
| הצבעות (Votes) | Every vote, newest first; a vote's result, totals and how each MK voted, by faction |
| חקיקה (Legislation) | How a bill becomes law, every bill of the current Knesset with a stage bar (filter by stage, search), recently passed laws with their summaries; a bill's stage in plain words, initiators, committee, every session it was discussed in (with recordings) and documents |
| חברי הכנסת (MKs) | The factions and their seats, all 120 MKs with photos and roles, who is in the building now; an MK's roles, committees, activity this Knesset and contact details |
| ממשלה (Government) | The prime minister, ministers and deputy ministers, and whether it's a transitional government |
| מדריך (Guide) | Short explanations (the Knesset, coalition and opposition, a working week, committees, the plenum and votes, how a law is made, oversight, secondary legislation, a new Knesset, the government), a 47-term glossary with search, and links to the Knesset's own pages |

Session details show the invitees, the agenda with links, documents (protocols,
background material, decisions) and press releases. **צפייה** (watch) on a live
committee room or the plenum makes that stream the big channel in the grid, heard
alone; recordings play in a player over the view, with the channels silenced
until it closes. Links open the Knesset's website in your browser.

The data comes straight from the Knesset: its open-data service and its website's
own data service, through the window's fetch bridge. What they offer and how Local
TV uses them is in [docs/knesset-data.md](docs/knesset-data.md).

## Sound

- Every channel starts muted each time News Center opens.
- **Spotlight + solo**: point at a channel and press the round button in its
  middle (or select it and press `Enter`). The channel becomes the big one in
  Spotlight and the only one you hear; every other channel is muted. Press the
  button on another channel to switch to it. On the big channel the button goes
  back to the grid and leaves its sound on. On Channel 12 the button sits at the
  top, clear of Mako's own play button.
- **M** mutes or unmutes a channel.
- **S** solos a channel and also unmutes it. Solo several channels to hear all of
  them; while any channel is soloed, only the soloed channels are heard.
  `Ctrl`+click **S** (or `Shift`+`S`) solos only that channel.
- Mute always wins over solo.
- The top-bar **S** light clears all solos, and the **M** light unmutes everything,
  or mutes everything when nothing is muted.
- Volume sliders go to 200%: past the tick at 100% the sound is boosted, and a
  limiter keeps it from distorting. Double-click a slider to reset it to 100%.
- Meters show each channel's level even while it is muted. To hide a channel's
  meter, point at the channel and press the small button next to the meter (or
  select it and press `V`). `Shift`+`V` hides every meter, or shows them all again.
  News Center remembers which meters are hidden.

## Layout

- **Grid** fits every live channel on screen.
- **Spotlight** (`P` on a channel, or `G`) shows one channel large with the
  others beside it. On a tall, portrait screen the large channel goes on top at
  full width, with the others in a grid below.
- **Drag a channel** to move it: grab it anywhere except its buttons and sliders
  (Channel 12 by its bottom bar) and the other channels make room as you move.
  In Spotlight, drop a channel on the big one to swap them. `Esc` puts a channel
  back while you're still carrying it. The new order is saved, and it is the same
  order as in the channel manager.
- The **tile size** slider in the title bar changes the size of the grid's tiles.
  Fit is the tick in the middle: everything is on one screen. Left of it the
  tiles get smaller so more fit side by side (on a portrait screen, a small step
  left puts two channels side by side). Right of it the tiles grow up to the
  full width and the grid scrolls. `Ctrl`+mouse wheel, `+` and `−` change the
  size too, and `0` (or double-clicking the slider) goes back to Fit. Selecting a
  channel with the keyboard scrolls it into view.

## Fullscreen

`F`, double-clicking a channel, or its fullscreen button fills the News Center
window with that channel; the window keeps its size and position. Move the
mouse to the top edge to bring back the title bar, press `1`–`9` or `←` `→` to
switch channels, and press `Esc` to return to the grid. Meters are hidden in
fullscreen.

## Keyboard

| Key | Action |
| --- | --- |
| `1`–`9`, `←` `→` | Select a channel |
| `Enter` | Spotlight + solo the selected channel; again to go back to the grid |
| `M` | Mute or unmute the selected channel |
| `S` | Solo the selected channel |
| `Shift`+`S` | Solo only the selected channel |
| `↑` `↓` | Volume of the selected channel |
| `F` | Fill the window with the selected channel |
| `P` | Spotlight the selected channel |
| `G` | Switch between Grid and Spotlight |
| `+` `−`, `Ctrl`+wheel | Bigger or smaller tiles |
| `0` | Fit all tiles on screen |
| `V` | Hide or show the selected channel's meter |
| `Shift`+`V` | Hide or show every meter |
| `R` | Reload the selected channel |
| `N` | Show or hide the news |
| `K` | Open or close the Knesset view (in it: `F5` refreshes, `Esc` closes the details, then the view) |
| `F5` | Refresh everything |
| `C` | Channel manager |
| `Esc` | Leave fullscreen, close panels, put back a channel you're dragging |

## Managing channels

Open **Channels** to add, edit, reorder (drag, or `Alt`+`↑`/`↓`), switch off and
remove channels. A channel can be:

- a **live stream**: paste an HLS address (`.m3u8`), an embed `<iframe>` code, or
  a `watch.knesset.tv` link, and the stream address is extracted automatically.
  **Test stream** checks it before you save.
- a **web page with its own player**: it plays inside its tile, and News Center shows
  just the page's video player when it can find it.

Removed built-in and Knesset channels don't come back by themselves; **Reset**
restores the built-in list. **Export** and **Import** save and restore the
channel list as JSON. To ship a channel with the project, add it to
`app/channels.js`; to ship a news source, add it to `app/news.js`. The manager's
**News sources** tab works the same way for the News panel.

## Project layout

| Path | Contents |
| --- | --- |
| `NewsCenter.exe` | The app window (built from `host/`) |
| `app/` | The dashboard: `index.html`, `styles.css`, `app.js`, `channels.js` (built-in channels), `news.js` (built-in news sources) |
| `app/knesset.js`, `app/knesset-guide.js` | The Knesset view, and its Hebrew guide, glossary, bill stages and links |
| `app/page-helper.js` | Runs inside web-page channels (sound, player-only view, meter) |
| `host/src/` | C# source of the window |
| `host/build.cmd` | Rebuilds `NewsCenter.exe`; downloads the C# compiler and WebView2 SDK from nuget.org on first use |
| `host/make-icon.mjs` | Regenerates `host/NewsCenter.ico` from `app/icon.svg` (needs Node.js) |

Changes in `app/` take effect the next time News Center starts; changes in `host/`
need `host\build.cmd`.

[hls.js](https://github.com/video-dev/hls.js) 1.7.4 (Apache-2.0) is included in
`app/vendor`.

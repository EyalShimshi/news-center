# Round 2 – the Knesset view

## The request

> i want you to make a deep scan and understanding of the Knesset website, and add a section to
> the exe that revolves around Knesset day to day management like comitees and really everything
> you can find. make it thourough but easily understandable.

Mid-round: Hebrew, as a full-window view (the owner's answers); then: never contact one news site
again (no network events), finish quickly and put it on GitHub, don't launch the app, and leave no
traces on the system.

## The answer

The Windows app has a **Knesset view**: **Knesset** in the title bar, or `K`. It covers the
channels (which keep playing) with eight tabs in Hebrew, built from a scan of the Knesset's website
and the two data services behind it.

**What's new**

- **היום (Today)**: what's on air now; today's plenum and committee sessions in time order, each
  with its agenda, room, and whether it's closed, cancelled or live; the next plenum sitting; the
  week ahead in the committees; where the Knesset is in its year and the next holidays.
- **ועדות (Committees)**: the current Knesset's committees by type (with what each type means),
  chair and next session; per committee: responsibilities, members and substitutes with photos,
  staff, contact details, upcoming and recent sessions, press releases.
- **מליאה (Plenum)**: the sittings; per sitting: what was discussed (by type), what was only laid on
  the table, its votes and its record.
- **הצבעות (Votes)**: every vote, newest first; per vote: the result, a for/against/abstain bar and
  how each MK voted, grouped by faction.
- **חקיקה (Legislation)**: how a law is made, in seven steps; every bill of the current Knesset with
  a stage bar, a stage filter and search; recently passed laws with their plain-language summaries;
  per bill: its stage in plain words, what comes next, initiators, committee, every session it was
  discussed in (with recordings), documents.
- **חברי הכנסת (MKs)**: the factions and their seats; all 120 MKs with photos, roles and who's in the
  building now; per MK: roles, committees, activity this Knesset, contact details, official page.
- **ממשלה (Government)**: the prime minister, ministers and deputies; it says when the government is
  a transitional one (as now: the 37th government serves until the 26th Knesset approves a new one).
- **מדריך (Guide)**: eleven short explanations (from "the Knesset in one sentence" to "when a new
  Knesset starts"), a 47-term glossary with search, and 35 links to the Knesset's own pages.
- **Watch**: a live committee room or the plenum becomes the big channel in the grid, heard alone;
  recordings play in a player over the view while the channels are silenced.
- **The blocked site**: removed from both apps' news sources and blocked at every layer (the page,
  the fetch bridge and its redirects, the browser engine's network, links; on Android the fetch
  layer, sources, channels, headline links and the web-page channel); the list is
  `BLOCKED_DOMAINS`. Your own copy already had it removed, so it wasn't being contacted. My old
  probe files and temporary files are deleted, the DNS cache holds nothing for it, and a stale
  script cache in News Center's data folder is deleted; your saved settings drop the old "removed"
  entry the next time News Center starts.

**Fixed** – nothing (new section).

**To ship** – pushed to `main` and released as `v1.1.0`. NewsCenter.exe was rebuilt in the project
folder but not started.

**To test**

1. Press `K`: the Knesset view opens on **היום** with today's sessions.
2. **צפייה בשידור** on a live session: News Center goes back to the channels with it big and alone.
3. **הקלטה** on a past session: the recording plays over the view; closing it brings the sound back.
4. **ועדות** → a committee: members, staff, sessions; a session → invitees, agenda, documents.
5. **חקיקה**: filter by stage, search a word, open a bill and read where it stands.
6. **חברי הכנסת**: search a name; the green dot means "in the building now".
7. `Esc` closes the details, then the view; `F5` refreshes it.

**Heads-up**

- The Knesset's website itself (main.knesset.gov.il) answers automated visitors with a bot check,
  and after the first few pages of the scan it stopped letting my test browser through. The view
  never loads the website's pages: it reads the open data and the website's data service (both
  answer plain requests) and links to the pages.
- These are the first days of the 26th Knesset: there are only transitional committees, no
  questions or motions yet, and no coalition. The view explains this where it matters and will fill
  in as the Knesset gets to work.
- The website's data service is undocumented (the endpoints came from its script bundles); if the
  Knesset changes it, the affected parts show "couldn't load" and the rest keeps working.
- The Android app doesn't have the Knesset view yet.

**Next options**

1. The Knesset view in the Android app.
2. Notifications when a committee you follow starts a live session.
3. Following bills: a list of bills you care about, with a mark when their stage changes.
4. Full-text search in protocols (the website's smart protocol service).

## How it was made

- The scan: the website's full menu (from the site itself, in a real browser), its 23 script
  bundles (≈150 data calls mapped to their parameters), the open data's 48 tables (schema and live
  samples), and the video, document and photo hosts. Everything found is in
  [docs/knesset-data.md](../knesset-data.md), including the codes (bill stages, positions, vote
  results), the joins between the two services, and the requests to avoid.
- The view: `app/knesset.js` (data, rendering, details, player) and `app/knesset-guide.js` (the
  Hebrew guide, glossary, bill stages and links), opened by `app/app.js`. It was tested end to end
  against the live services in a headless browser at 1600×900 and at the vertical monitor's
  1080×1800: every tab, a detail in each, filters and search, shortcuts, photos, no script errors,
  and no request to a blocked site (34 checks, both sizes).

## Status

Pushed to `main` with build `v1.1.0` released; see the
[releases](https://github.com/EyalShimshi/news-center/releases).

# The Knesset's website and data, as News Center uses them

A map of what the Knesset publishes and how to read it, made for the Knesset view (round 2), which
both apps show: the Windows app in its window, the Android app in its Knesset tab (round 3).
Everything here was checked against the live services in November 2026, in the first days of the
26th Knesset.

## Two official data sources

Both answer plain HTTPS requests; neither sends CORS headers, so the apps read them through their
own fetch bridges: the Windows app's window (`host.fetchText` in `app/app.js`), and on Android the
page's `/__fetch` requests, which `KnessetWeb.kt` answers for HTTPS addresses on knesset.gov.il
only.

| | Open data (OData v4) | The website's own API |
|---|---|---|
| Base | `https://knesset.gov.il/OdataV4/ParliamentInfo/` | `https://knesset.gov.il/WebSiteApi/knessetapi/` |
| Format | JSON, 100 rows per page, `@odata.nextLink` | JSON |
| Documented | `$metadata`; [Knesset ODATA page](https://main.knesset.gov.il/Activity/Info/Pages/Databases.aspx) | No; the endpoint list below comes from the website's script bundles |
| Best for | Lists and history: sessions, agenda items, votes with every MK's vote, bills, laws, MKs' positions, Knesset terms | What the website shows: live status, plain-language bill stages, session invitees and video, committee members and staff, MK photos and presence |

The website itself (`main.knesset.gov.il`) answers non-browser requests with HTTP 247 and a
JavaScript bot check (Radware); repeated automated page loads get held at the check. Its static
files, `fs.knesset.gov.il` documents, `video.knesset.gov.il` recordings and both APIs are not
behind the check. News Center never loads the website's pages; it only links to them.

### Open data: the tables that matter

| Table | What it is | Notes |
|---|---|---|
| `KNS_KnessetDates` | Each Knesset's yearly sessions | `IsCurrent eq true` gives the current Knesset (26, from 10 Nov 2026) |
| `KNS_Committee` | Committees | `IsCurrent` is unreliable (old committees are flagged too): filter by `KnessetNum`. Types: 70 House (ועדת הכנסת), 71 permanent (ראשית), 72 special (מיוחדת), 73 joint (משותפת), 74 sub-committee (ועדת משנה) |
| `KNS_CommitteeSession` | Committee sessions | `StartDate`, `FinishDate` (set when it ends), `TypeDesc` פתוחה/חסויה (open/closed), `StatusID` 193 = cancelled, `Location`, `SessionUrl`. `BroadcastUrl` is always empty |
| `KNS_CmtSessionItem` | A session's agenda items | `ItemTypeID`: 2 bill, 6000 action under law (secondary legislation, reports), 11 discussion topic; `StatusID` is the item's own status (a bill's stage) |
| `KNS_DocumentCommitteeSession` | Protocols, background material, decisions, conclusions, research papers, press releases | `FilePath` on `fs.knesset.gov.il`; documents appear days after the session |
| `KNS_PlenumSession`, `KNS_PlmSessionItem` | Plenum sittings and their agenda | `IsDiscussion` 0 = only laid on the table; a sitting can list 100+ bills |
| `KNS_DocumentPlenumSession` | The sitting's record (דברי הכנסת), treaties, State Comptroller reports | |
| `KNS_PlenumVote`, `KNS_PlenumVoteResult` | Every vote, and every MK's vote | Result codes: 7 for, 8 against, 6 present (abstained). No totals: count the results, or use the website's `Votes/GetVoteDetails/{id}` |
| `KNS_Bill` (+ initiators, names, documents) | Bills | `SubTypeDesc` פרטית/ממשלתית/ועדה; `StatusID` is the stage (see below); `SummaryLaw` is a plain-language summary of a passed law |
| `KNS_IsraelLaw` | The laws in force | |
| `KNS_Query`, `KNS_Agenda` | Parliamentary questions, motions for the agenda | Empty in the first days of a Knesset |
| `KNS_Person`, `KNS_PersonToPosition`, `KNS_Position` | People and every role they hold | Current: `IsCurrent eq true`. Positions: 43/61 MK, 54 faction member, 48 faction chair, 41 committee chair, 42/66 committee member, 67 substitute, 39/57 minister, 40/59 deputy minister, 45 PM, 50/65 deputy PM, 122/123 Speaker, 70/71 deputy Speaker, 130/131 opposition leader, 29/30 coalition chair, 285078 temporary Speaker |
| `KNS_Faction` | Factions (parliamentary groups) | Filter by `KnessetNum` |
| `KNS_GovMinistry` | Ministries | |
| `KNS_Status`, `KNS_ItemType` | Code tables | |
| `KNS_MkSiteCode` | Person ID → website MK ID | Stale for new MKs; join by name instead |
| `V_Lobbyists`, `V_LobbyistsClients` | Lobbyists | Listed but answer 404 |

Bill stages (`KNS_Bill.StatusID`), in order: 104 tabled for a preliminary reading, 150 in the plenum
for the preliminary reading, 106/142 at the House Committee to pick a committee, 101/108
preparation for the first reading, 109/167 approved for the first reading, 111/141 first reading,
113 preparation for the second and third readings, 178/179 approved for them, 114/130 second and
third readings, 115/117/131 third reading only, 118 passed (law). Also: 120/175/176/181/182
continuity from the previous Knesset, 122 merged, 124 turned into a motion, 140/143 removed at a
committee's request, 177 stopped.

Requests to avoid (they return 500, or a WAF "access denied" 473): `Entity(key)?$expand=…`, and
`$expand` with nested options on large tables. Flat `$filter` queries are fast; `in (…)` works.

### The website's API: endpoints News Center uses (all GET)

| Endpoint | Gives |
|---|---|
| `Plenum/GetAgendaPlenum?sessionDate=<ISO>&IsDraft=false` | The day's plenum topics, with `IsLive` on the current one |
| `Plenum/GetNextSession` | The next sitting |
| `Plenum/GetWeeklyDates?CurrentDate=<UTC string>&Direction=&IsDraft=false` | The week's sittings, with Hebrew dates |
| `Committees/GetAllCommittees/he` | Current committees: chair, photo, live now, website ID |
| `Committees/GetAllBroadcasts/he` | The last 50 broadcast sessions with recording URL, poster, and the open-data committee ID (`committeeSanId`) |
| `CommitteeSessions/GetCommitteePortalsSessionDetails?ItemId=<session>&lang=he` | Invitees, agenda items with links, live stream (`LiveUrlFeed`, `IsLiveBroadcast`), recording (`ArchiveUrlFeed`), protocol, press releases |
| `CommitteeDetails/GetCommitteeDetails?committeeId=<website id>&lang=he` | Responsibilities, chair, members, substitutes, staff, room, phone, email |
| `CommitteeNews/GetCommitteeNewsAll?lang=he&committeeId=<website id>` | The committee's press releases |
| `MkLobby/GetMkLobbyData120?lang=he` | All 120 MKs: photo, faction, coalition flag, email, phone, social links, in the building now |
| `MkLobby/GetMkPresent?lang=he` | Who is in the building now |
| `MKs/GetParlamentayActivity?mkId=<website id>&knessetId=<n>` | An MK's bills, votes, questions and motions in a Knesset |
| `Votes/GetVoteDetails/<vote>` | A vote's title, decision, totals and each MK's vote with faction |
| `LegislationItem/GetLegislationBillItem?ItemId=<bill>` | The bill's stage in plain words, initiators, every session it was discussed in (with recordings), documents |
| `Global/GetAllHolidays` | Holidays and memorial days |

The bundles name about 150 calls in all (committee decisions, conclusions, reports, budget
requests; MK expenses, speeches, positions; factions and splits; caucuses; the smart plenum
protocol; secondary legislation; visits). Many are POST and need a JSON body, which neither app's
fetch bridge sends.

The website and the open data use different committee IDs (the website's are permanent across
Knessets, e.g. 2213 = Finance). `GetAllBroadcasts` links the two for committees that broadcast;
otherwise names are matched word by word ("הוועדה הזמנית לענייני כספים" ↔ "ועדת הכספים").

### Video

- Live committee rooms: `https://knesetn.gostreaming.tv/<room>/index.m3u8` (the same streams that
  knesset.tv lists and the TV grid finds by itself).
- Recordings of open, broadcast sessions:
  `https://video.knesset.gov.il/KnsVod/_definst_/mp4:vod/CMT/CmtSession_<session>.mp4/playlist.m3u8`
  (`Access-Control-Allow-Origin: *`; 404 for closed sessions and until the recording is ready).
  Older recordings have other names; take them from `GetAllBroadcasts` or the session details.

## The website, section by section

From the site's menu (`/_layouts/15/1037/MenuJSON/HEJson.js`):

- **MKs** (`/mk/…`): the 26th Knesset's MKs, attendance, caucuses (שדולות), MKs' expenses, the
  Speaker, the opposition leader, past MKs, factions, all governments, coalition agreements,
  elections.
- **Activity** (`/Activity/…`, `/apps/…`): today at the Knesset; the plenum (agenda, broadcasts,
  sittings, votes, questions, motions); committees (portals, broadcasts, schedule, news,
  protocols); elections of office holders; legislation (the National Legislation Database,
  publications, reports under law, legislation chart, new laws, Basic Laws); information and
  research (the Research and Information Center, freedom of information, open data);
  international affairs; visitors' center; the state budget.
- **About** (`/About/…`): how the Knesset works (work and recess dates, branches of government,
  the plenum, committees, factions, MKs' rights and duties, stages of legislation, rules of
  procedure), the building, history, departments (Director General, Secretariat, Legal Adviser,
  Ethics Committee, Knesset Guard, Archive, Ceremonies, Protocols, Lexicon), occasions.
- **News**: Knesset announcements, committee news, weekly summaries, broadcasts (plenum,
  committees, the Knesset Channel, YouTube), publications.

The Knesset view links to these pages (Guide → Official sources) rather than copying them.

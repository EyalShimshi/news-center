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
| `Plenum/GetAgendaPlenum?sessionDate=<ISO>&IsDraft=false` | A day's plenum topics (`TitleId`, `Title`, `Ordinal`), each naming its sitting (`FK_ItemID`), with `IsLive` on the current one and `FinishTime` once the sitting ends |
| `Plenum/GetSessionData?SessionId=<sitting>` | The sitting's agenda items, with summaries and live status (see "The plenum's agenda" below) |
| `Plenum/GetSessionSpeakers?SessionId=<sitting>` | Each item's speakers: order, minutes, and while the sitting is on, who is speaking, has spoken or isn't in the hall |
| `Plenum/GetAdditionalDocuments?SessionId=<sitting>` | Extra documents of items (for example a bill re-tabled for its second and third readings, or its table of amendments) |
| `Plenum/GetNextSession` | The next sitting (`NextSessionItemId`, `NextSessionDate`), days before the open data lists it |
| `Plenum/GetWeeklyDates?CurrentDate=<UTC string>&Direction=&IsDraft=false` | The week's sittings with their IDs and Hebrew dates; `Direction=-` is the week before |
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

### The plenum's agenda

The website's agenda page (`/apps/plenum/agenda/<ddmmyyyy>`) is built from the four `Plenum/` calls
above (found in its script chunk; `IsDraft=true` is for the Knesset's staff only). A sitting's ID
there is the open data's `KNS_PlenumSession.Id`, so any sitting in the open data can be shown this
way, and `KNS_PlenumVote.ItemID` links its votes to its items. `GetSessionData` gives one row per
item:

| Field | What it is |
|---|---|
| `TitleId` | The topic the item belongs to (`GetAgendaPlenum`'s `TitleId`) |
| `OrdinalAlphabet`, `ItemName` | The item's letter within its topic (א, ב, ג…) and its name |
| `FK_ItemID` | The item: for a bill, `KNS_Bill.Id` (so `LegislationItem/GetLegislationBillItem` gives its stages) |
| `LU_ItemType` | 1 urgent question, 2 bill, 3 no-confidence motion, 4 motion for the agenda, 9 speeches and statements, 6000 notices and actions under law |
| `Ext1` | The bill's number with a trailing " - ": `פ/286/26` (private), `כ-1207` (a committee's), `כ-997 (פ/3200/25)` |
| `Ext2` | For a no-confidence motion, the factions behind it: "(יש עתיד)" |
| `Initiators` | "של חבר הכנסת … וקבוצת חברי כנסת"; for a question, the asker and the question's number |
| `Summery` (sic) | The summary (תקציר), plain text with line breaks, up to about 1,900 characters. It may end with the legal adviser's note between asterisks: `* הערת הייעוץ המשפטי: יש לאשר את ההצעה ברוב של 61 ח"כים לפחות … *` |
| `SecretaryNotes` | The secretariat's notes, one per line: `בתמיכת ממשלה`, `בכפוף לקבלת פטור מחובת הנחה`, `דיון אישי והצבעה`, `הוצמדה להצעת חוק שמספרה פ/5716/25`, `תשובה משולבת על סעיפים (ו) ו-(ז)`, `הצבעה אחת על הסעיפים (יא) ו-(יב)`… |
| `CommitteeName` | The committee that prepared a bill for its second and third readings |
| `Presenter`/`PresenterType`, `Reasoner`/`ReasonerType`, `Answer`/`AnswerType` | Who presents, gives the reasons (מנמק/מנמקת) and answers (משיב/משיבה) – usually a minister for the government |
| `DocPath` | The item's text on `fs.knesset.gov.il`, written with backslashes and a doubled slash (`https://fs.knesset.gov.il//26\law\26_lst_16333548.docx`) |
| `IsLive`, `IsDone`, `CurrentSpeaker`, `NextSpeaker` | While the sitting is on: the item being discussed, the items done, who is speaking and who's next (the same on every row). They aren't meaningful afterwards (`IsDone` stays as it was) |
| `IsActive` | `false`: taken off the agenda (the website strikes it through) |

Speakers match an item by its internal ID while the sitting is on
(`SessionItemId` = `FK_InternalSessionItemId`), and afterwards by its topic and session item
(`TitleId` and `SessionItemId` = `FK_SessionItemId`). Extra documents match by `FK_Item_Id` =
`FK_ItemID`. A finished sitting's votes reach the open data within hours; during the sitting there
are none yet.

### For a calendar

- A month's committee sessions from the open data take about 2 seconds for a busy month (350
  sessions, 4 pages); with each session's agenda items (`$expand=KNS_CmtSessionItem`) 10 seconds, so
  the calendar asks for those only for the day you choose.
- Plenum sittings come from `KNS_PlenumSession`, the next one from `GetNextSession` before that, and
  each sitting's number of votes from `KNS_PlenumVote` (`SessionID`).
- `Global/GetAllHolidays` lists holidays and memorial days from 2018 to 2050 (`Name`, `Date`).
- `KNS_KnessetDates` gives each working period (מושב) its start and end: the days outside them are
  recess, or between two Knessets. The Passover break inside a period isn't in the data.

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

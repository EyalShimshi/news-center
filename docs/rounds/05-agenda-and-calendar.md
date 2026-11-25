# Round 5 – the plenum's full agenda, and a calendar

## The request

> I'm missing some details from the Knesset plenum's agenda page (סדר היום של מליאת הכנסת) in the
> מליאה section, like the תקציר and the בתמיכת הממשלה if there is, and the general live agenda
> (insert everything you can and think relevant). I want that in the app and the exe. Also make a
> calendar for a bigger overview.

## The answer

The Knesset view – the same one in the Windows app and in the Android app's Knesset tab – shows the
plenum's agenda the way the Knesset's agenda page does, with everything on it, and has a new
**calendar** tab.

**What's new**

- **מליאה (Plenum): the full agenda.** The page opens on the current sitting: today's, else the
  next one once its agenda is out, else the last one. Topic by topic, every item shows:
  - its letter and name, and its number: פ/… for a private bill, כ-… for a committee's;
  - **בתמיכת הממשלה** when the secretariat's note says the government supports it (and
    "בהתנגדות הממשלה" if it ever says the opposite);
  - the initiators, and the committee that prepared a bill for its last readings;
  - who presents it or gives its reasons (מנמק), and who answers for the government (משיב);
  - the secretariat's other notes: an exemption from the 45-day tabling period, a combined answer, a
    bill attached to another, one vote for several items;
  - the **summary (תקציר)**, cut to three lines with "להמשך התקציר" (only where it is really
    cut), or every summary at once;
  - the legal adviser's notes, such as "a majority of 61 MKs is required";
  - the bill's or question's text (Word or PDF), extra documents (a bill re-tabled for its last
    readings, its table of amendments), the bill's legislative stages, the item's votes, and its
    speakers with their minutes;
  - items taken off the agenda, struck through.
- **The live agenda.** While the plenum sits, the page starts with what's happening: the topic and
  item being discussed, who is speaking and who's next, and how many items are done, with buttons to
  watch and to jump to the item. Speakers who have spoken are ticked, and those not in the hall are
  dimmed. The page refreshes itself every minute and keeps open what you opened; it waits while you
  type in its search. Today's page shows the same on its plenum card: each topic's number of items,
  how many the government supports, the item being discussed and who is speaking.
- **Moving around.** Arrows go to earlier and later sittings. An agenda of more than five items has
  a search over every item's text, summary and notes. A sitting's details now show this agenda too,
  with its votes, the bills laid on the table and its record. A link opens the same day on the
  Knesset's website.
- **לוח שנה (Calendar).** A new tab with the month at a glance, Sunday on the right, with Hebrew
  dates:
  - each day shows its plenum sitting and time, its number of committee sessions, the holidays the
    Knesset lists, and recess (hatched; the days between two Knessets are named as such);
  - the top line has the month's totals: sittings, committee sessions, cancellations and votes;
  - choose a day (tap, click, or the arrow keys) and it appears below: the sitting with its topics
    and their counts, and every committee session with its first agenda item, each opening its
    details;
  - arrows move between months, and "לחודש הנוכחי" comes back. On a phone the days show marks and
    numbers instead of words.
- **The guide** explains how to read the plenum's agenda, and the glossary has 8 new terms (55 in
  all): בתמיכת הממשלה, הצמדה, מנמק ומשיב, נאום בכורה, נאומים בני דקה, סדר היום, פטור מחובת הנחה,
  שאילתה דחופה.

**To ship** – merged to `main` and released as `v1.4.0` with `news-center-windows-v1.4.0.zip`,
`news-center-v1.4.0.apk` and `mapping-v1.4.0.zip`.

**To test**

1. Open the Knesset view (`K` on Windows, the Knesset tab on Android) → **מליאה**.
2. On a sitting day: the agenda topic by topic. Private bills show "בתמיכת הממשלה" where it
   applies, with their summary; "להמשך התקציר" opens one, and "כל התקצירים במלואם" opens all of them.
3. While the plenum sits: "המליאה עכשיו" names the item and who is speaking; a minute later it
   has moved on by itself.
4. "→ הישיבה הקודמת" shows the previous sitting's agenda, with its votes per item once published.
5. **לוח שנה**: today is marked. Choose a plenum day to see its topics; the arrows go to the next
   month and back.
6. The guide's glossary: search "תמיכת".

**Heads-up**

- The details come from the Knesset website's own agenda service, which isn't documented. If the
  Knesset changes it, the plenum page says it couldn't load the agenda (with "try again"), and a
  sitting's details still list its items from the open data, with names and stages only.
- Votes appear on the items hours after they're held, when the Knesset publishes them.
- The calendar marks recess from the Knesset's working periods; the Passover break isn't in that
  data, so it isn't marked.
- Nothing was built or run on this computer. GitHub's machines built both apps and tested the view
  on a phone, a tablet and the desktop against the Knesset's live services, and the working copy
  was deleted at the end.

**Next options**

1. Follow an item: a notice when a bill you follow reaches the plenum or the item comes up live.
2. The week's agenda of the committees in the calendar (each day's topics, not only the count).
3. Export a day or the month to your own calendar (an .ics file).

## How it was made

- **Finding the data.** The website's pages sit behind a bot check, but its scripts don't. The
  agenda page's script (one of 23 chunks the site's loader lists) names the calls it makes:
  `Plenum/GetSessionData`, `GetSessionSpeakers` and `GetAdditionalDocuments`, each by the sitting's
  ID. That ID is the open data's `KNS_PlenumSession.Id`, so every sitting the view lists can show
  its full agenda. The fields and their quirks are in [docs/knesset-data.md](../knesset-data.md#the-plenums-agenda):
  government support is a line in the secretariat's notes, the summary can end with the legal
  adviser's note between asterisks, document paths use backslashes, and speakers point at items in
  two different ways during and after a sitting.
- **One view, two apps.** Everything is in `app/knesset.js`, `app/knesset-guide.js` and
  `app/knesset.css`, which the Windows app loads and the Android build copies into the APK; the
  Android page got only touch sizes and rounded corners for the new parts.
- **The calendar's cost.** A busy month has about 350 committee sessions: two seconds from the open
  data, but ten with their agendas, so the month is asked for without them and the chosen day's
  agendas come when it's chosen.
- **Testing.** The CI job that runs the view in headless Chrome now compares the plenum page with
  the same sitting straight from the Knesset: every item, every summary, every "בתמיכת ממשלה" and
  every presenter or answerer must be there. It also opens a long summary, a speakers list and the
  search, and on the calendar checks this month under the right weekdays, today chosen, a plenum
  day's topics, the month arrows and the arrow keys, all on a phone (dark and light), a tablet and
  the desktop, with screenshots.

## Status

Released as `v1.4.0`; see the [releases](https://github.com/EyalShimshi/news-center/releases).

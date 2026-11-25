/*
 * News Center's Knesset view: the Knesset's day-to-day work in plain Hebrew – what's on today, a
 * calendar, the committees, the plenum and its agenda, votes, legislation, MKs, the government,
 * and a guide. It reads the
 * Knesset's open data (OData) and the Knesset website's own API through the host's fetch bridge;
 * see docs/knesset-data.md for both. The Windows dashboard (app.js) and the Android app's Knesset
 * screen (android/app/src/main/assets/knesset/android.js) create it with NewsCenterKnesset(api):
 *   fetchText(url) → Promise<{ ok, status, text }>, knessetChannels() → [{ id, name, url, now,
 *   main, live }], watchChannel(id), refreshChannels(), showToast(message), silenceTv(on),
 *   onToggle(open), and optionally: embedded (the view is the whole page and never closes),
 *   playVideo(url, title) (the host plays recordings itself) and onBackState(canGoBack).
 */
(() => {
  'use strict';

  const ODATA = 'https://knesset.gov.il/OdataV4/ParliamentInfo/';
  const SITE_API = 'https://knesset.gov.il/WebSiteApi/knessetapi/';
  const SITE = 'https://main.knesset.gov.il';
  const GUIDE = window.NEWSCENTER_KNESSET_GUIDE || { stages: [], endings: {}, billTypes: {}, articles: [], glossary: [], links: [] };
  const STORAGE_KEY = 'newscenter.knesset.v1';
  const TODAY_REFRESH_MS = 60 * 1000;
  const MAX_PAGES = 6;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const TABS = [
    ['today', 'היום'],
    ['calendar', 'לוח שנה'],
    ['committees', 'ועדות'],
    ['plenum', 'מליאה'],
    ['votes', 'הצבעות'],
    ['bills', 'חקיקה'],
    ['mks', 'חברי הכנסת'],
    ['government', 'ממשלה'],
    ['guide', 'מדריך'],
  ];

  const COMMITTEE_TYPES = {
    70: ['ועדת הכנסת', 'אחראית על סדרי העבודה של הכנסת וקובעת איזו ועדה תדון בכל הצעת חוק.'],
    71: ['ועדות קבועות', 'קיימות לאורך כל הכנסת, כל אחת בתחום משלה.'],
    72: ['ועדות מיוחדות', 'מוקמות לנושא מסוים.'],
    73: ['ועדות משותפות', 'חברים מכמה ועדות, לנושא שנוגע לכולן.'],
    74: ['ועדות משנה', 'קבוצה קטנה מתוך ועדה, לנושא אחד שלה.'],
  };

  const ITEM_TYPES = { 1: 'שאילתה', 2: 'הצעת חוק', 3: 'הצעת אי-אמון', 4: 'הצעה לסדר היום', 5: 'ישיבת מליאה', 9: 'דברים במליאה', 11: 'נושא לדיון', 6000: 'פעולה על פי חוק', 6002: 'הצעת חוק', 6003: 'חוק' };

  // A name for a plenum topic whose title isn't out yet (its items are), by the kind of its items.
  const TOPIC_KINDS = { 1: 'שאילתות', 2: 'הצעות חוק', 3: 'הצעות להביע אי-אמון בממשלה', 4: 'הצעות לסדר היום', 9: 'נאומים והודעות', 6000: 'הודעות ופעולות על פי חוק' };

  const VOTE_RESULTS = { 7: ['בעד', 'for'], 8: ['נגד', 'against'], 6: ['נמנע (נוכח)', 'abstain'] };

  const POSITION_ROLES = {
    45: 'ראש הממשלה', 31: 'משנה לראש הממשלה', 51: 'ממלא מקום ראש הממשלה', 73: 'ראש הממשלה החילופי',
    50: 'סגן ראש הממשלה', 65: 'סגנית ראש הממשלה', 122: 'יושב-ראש הכנסת', 123: 'יושבת-ראש הכנסת',
    285078: 'יו"ר הכנסת הזמני', 70: 'סגן יו"ר הכנסת', 71: 'סגנית יו"ר הכנסת', 131: 'ראש האופוזיציה',
    130: 'ראשת האופוזיציה', 30: 'יו"ר הקואליציה', 29: 'יו"ר הקואליציה', 48: 'יו"ר סיעה',
  };

  /* ---------- Small helpers ---------- */

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key === 'text') el.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
        else if (key === 'style') el.style.cssText = value;
        else el.setAttribute(key, value === true ? '' : value);
      }
    }
    return fill(el, ...children);
  }

  // Adds children the way h() does: nested lists flattened, and null, false and '' left out (the
  // DOM's own append would write them out as text).
  function fill(el, ...children) {
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false || child === '') continue;
      el.append(child instanceof Node ? child : String(child));
    }
    return el;
  }

  const icon = (name, cls = 'icon') => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${name}`);
    svg.append(use);
    return svg;
  };

  const clean = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

  function plain(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    return clean(doc.body.textContent || '');
  }

  function externalLink(href, label, cls = 'kn-link') {
    if (!href) return null;
    let url;
    try {
      url = new URL(href, SITE + '/').href;
    } catch {
      return null;
    }
    return h('a', { class: cls, href: url, target: '_blank', rel: 'noopener noreferrer', title: 'נפתח בדפדפן' }, label, icon('i-external', 'icon tiny'));
  }

  const button = (label, onclick, cls = 'kn-btn', extra = {}) => h('button', { type: 'button', class: cls, onclick, ...extra }, label);

  // The website writes document paths with backslashes and a doubled slash after the host.
  const docUrl = path => String(path || '').trim().replace(/\\/g, '/').replace(/^(https?:\/\/[^/]+)\/+/i, '$1/');
  const fileKind = url => (/\.pdf(?:$|[?#])/i.test(url) ? 'PDF' : /\.docx?(?:$|[?#])/i.test(url) ? 'Word' : '');

  function normalizeName(name) {
    return clean(name).replace(/["'״׳`]/g, '').replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Committee names differ between the two sources ("הוועדה הזמנית לענייני כספים" and
  // "ועדת הכספים"), so they are compared by their meaningful words.
  const NAME_FILLER = new Set(['ועדת', 'הוועדה', 'ועדה', 'הזמנית', 'זמנית', 'לענייני', 'ענייני', 'של', 'על', 'המיוחדת', 'מיוחדת']);

  function nameWords(name) {
    return new Set(normalizeName(name).split(/[\s,]+/)
      .map(word => word.replace(/^[והלב](?=[א-ת]{3,})/, '').replace(/^ה(?=[א-ת]{3,})/, ''))
      .filter(word => word && !NAME_FILLER.has(word)));
  }

  function similarity(a, b) {
    const x = nameWords(a);
    const y = nameWords(b);
    if (!x.size || !y.size) return 0;
    let shared = 0;
    for (const word of x) if (y.has(word)) shared++;
    return shared / Math.max(x.size, y.size);
  }

  /* ---------- Dates ---------- */

  const timeFormat = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dayFormat = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
  const fullDayFormat = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const shortDateFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });
  const hebrewParts = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' });

  const toDate = value => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const sameDay = (a, b) => a && b && startOfDay(a).getTime() === startOfDay(b).getTime();

  // 2026-11-18T00:00:00+02:00, the form the open data compares dates in.
  function odataDate(date) {
    const pad = n => String(Math.abs(n)).padStart(2, '0');
    const offset = -date.getTimezoneOffset();
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00${offset >= 0 ? '%2B' : '-'}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
  }

  const LETTERS = [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א']];

  function hebrewNumber(number) {
    let n = number % 1000;
    let text = '';
    for (const [value, letter] of LETTERS) {
      while (n >= value) {
        if (n === 15 || n === 16) {
          text += n === 15 ? 'טו' : 'טז';
          n = 0;
          break;
        }
        text += letter;
        n -= value;
      }
    }
    return text.length > 1 ? `${text.slice(0, -1)}״${text.slice(-1)}` : `${text}׳`;
  }

  // "ח׳ בכסלו תשפ״ז"
  function hebrewOf(date) {
    try {
      const parts = Object.fromEntries(hebrewParts.formatToParts(date).map(part => [part.type, part.value]));
      return { day: Number(parts.day), month: parts.month, year: Number(parts.year) };
    } catch {
      return null;
    }
  }

  function hebrewDate(date) {
    const parts = hebrewOf(date);
    return parts ? `${hebrewNumber(parts.day)} ב${parts.month} ${hebrewNumber(parts.year)}` : '';
  }

  // The Hebrew months a Gregorian month spans: "חשון–כסלו תשפ״ז".
  function hebrewMonthRange(year, month) {
    const seen = [];
    for (let day = new Date(year, month, 1); day.getMonth() === month; day = new Date(year, month, day.getDate() + 1)) {
      const parts = hebrewOf(day);
      if (parts && !seen.some(item => item.month === parts.month && item.year === parts.year)) seen.push(parts);
    }
    if (!seen.length) return '';
    const years = [...new Set(seen.map(item => item.year))];
    if (years.length === 1) return `${seen.map(item => item.month).join('–')} ${hebrewNumber(years[0])}`;
    return seen.map(item => `${item.month} ${hebrewNumber(item.year)}`).join(' – ');
  }

  function dayLabel(date, now = new Date()) {
    const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
    if (days === 0) return 'היום';
    if (days === 1) return 'מחר';
    if (days === -1) return 'אתמול';
    return dayFormat.format(date);
  }

  const time = date => (date ? timeFormat.format(date) : '');
  const shortDate = date => (date ? shortDateFormat.format(date) : '');
  const monthFormat = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' });
  const pad2 = n => String(n).padStart(2, '0');
  const dayKey = date => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  // The website's page for a day's plenum agenda: /apps/plenum/agenda/25112026.
  const agendaUrl = date => `${SITE}/apps/plenum/agenda/${pad2(date.getDate())}${pad2(date.getMonth() + 1)}${date.getFullYear()}`;

  function count(n, one, many) {
    return n === 1 ? one : `${n} ${many}`;
  }

  /* ---------- The view ---------- */

  window.NewsCenterKnesset = function createKnessetView(api) {
    const cache = new Map();
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch {
      saved = {};
    }
    const view = {
      open: false,
      tab: TABS.some(([id]) => id === saved.tab) ? saved.tab : 'today',
      renderToken: 0,
      renderedAt: 0,
      refreshTimer: 0,
      billFilter: 'all',
      billSearch: '',
      mkFaction: 'all',
      mkSearch: '',
      mkPresentOnly: false,
      glossarySearch: '',
      // The plenum page: the sitting chosen with its arrows (none: the current one), whether it's
      // on now, the agenda's search, and which summaries and lists are open (kept across refreshes).
      plenumId: null,
      plenumLive: false,
      agendaSearch: '',
      allSummaries: false,
      openKeys: new Set(),
      // The calendar's month and chosen day (none: today), and whether that day takes the keyboard.
      calMonth: null,
      calDay: null,
      calFocus: false,
    };

    /* Data */

    async function getJson(url) {
      const result = await api.fetchText(url);
      if (!result.ok) throw new Error(`השרת ענה ${result.status}`);
      try {
        return JSON.parse(result.text);
      } catch {
        throw new Error('התשובה מהכנסת לא הייתה תקינה');
      }
    }

    // Rows from the open data, following its pages (100 rows each).
    async function odata(query, maxPages = MAX_PAGES) {
      let url = ODATA + query.replace(/ /g, '%20');
      const rows = [];
      for (let page = 0; url && page < maxPages; page++) {
        const data = await getJson(url);
        rows.push(...(Array.isArray(data.value) ? data.value : []));
        url = data['@odata.nextLink'] || null;
      }
      return rows;
    }

    const site = path => getJson(SITE_API + path);

    // Each answer is kept for `ttl`; a failed request is forgotten so the next try asks again.
    function cached(key, ttl, load, force = false) {
      const entry = cache.get(key);
      if (!force && entry && Date.now() - entry.time < ttl) return entry.promise;
      const promise = load();
      cache.set(key, { time: Date.now(), promise });
      promise.catch(() => {
        if (cache.get(key)?.promise === promise) cache.delete(key);
      });
      return promise;
    }

    const MIN = 60 * 1000;

    const loadKnesset = force => cached('knesset', 60 * MIN, async () => {
      const rows = await odata('KNS_KnessetDates?$filter=IsCurrent eq true');
      const current = rows.sort((a, b) => new Date(b.PlenumStart) - new Date(a.PlenumStart))[0];
      if (!current) throw new Error('לא נמצאה כנסת נוכחית');
      const all = await odata(`KNS_KnessetDates?$filter=KnessetNum eq ${current.KnessetNum}&$select=PlenumStart`);
      const start = all.map(row => toDate(row.PlenumStart)).filter(Boolean).sort((a, b) => a - b)[0] || toDate(current.PlenumStart);
      return { number: current.KnessetNum, name: current.Name, assembly: current.Assembly, plenum: current.Plenum, sessionStart: toDate(current.PlenumStart), sessionEnd: toDate(current.PlenumFinish), start };
    }, force);

    const loadStatuses = () => cached('statuses', 24 * 60 * MIN, async () => {
      const rows = await odata('KNS_Status?$select=Id,Desc,TypeID&$top=400', 4);
      return new Map(rows.map(row => [row.Id, clean(row.Desc)]));
    });

    const SESSION_FIELDS = 'Id,Number,CommitteeID,StartDate,FinishDate,TypeDesc,StatusID,StatusDesc,Location,SessionUrl,Note';

    // Committee sessions from the start of today for a week, with their agenda items.
    const loadWeek = force => cached('week', 2 * MIN, () => {
      const from = startOfDay(new Date());
      const to = new Date(from.getTime() + 8 * DAY_MS);
      return odata(`KNS_CommitteeSession?$filter=StartDate ge ${odataDate(from)} and StartDate lt ${odataDate(to)}&$orderby=StartDate&$select=${SESSION_FIELDS}&$expand=KNS_Committee($select=Name),KNS_CmtSessionItem($select=ItemID,Name,ItemTypeID,Ordinal,StatusID)`);
    }, force);

    // Today's plenum topics; while a sitting is on they change every few minutes.
    const loadPlenumAgenda = force => cached('plenum-agenda', 40 * 1000, () =>
      site(`Plenum/GetAgendaPlenum?sessionDate=${encodeURIComponent(startOfDay(new Date()).toISOString())}&IsDraft=false`), force);

    const loadNextPlenum = force => cached('plenum-next', 10 * MIN, () => site('Plenum/GetNextSession'), force);

    // One sitting's agenda as the website shows it: the topics (GetAgendaPlenum, by the sitting's
    // day), their items with summaries, initiators, notes and live status (GetSessionData), the
    // speakers and extra documents. The website's sitting ID is the open data's KNS_PlenumSession.Id.
    function loadSitting(session, force) {
      const start = toDate(session.StartDate);
      const today = Boolean(start) && sameDay(start, new Date());
      return cached(`sitting-${session.Id}`, today ? 40 * 1000 : 30 * MIN, async () => {
        const [topics, rows, speakers, docs] = await Promise.all([
          today ? loadPlenumAgenda(force).catch(() => [])
            : start ? site(`Plenum/GetAgendaPlenum?sessionDate=${encodeURIComponent(startOfDay(start).toISOString())}&IsDraft=false`).catch(() => []) : [],
          site(`Plenum/GetSessionData?SessionId=${session.Id}`),
          site(`Plenum/GetSessionSpeakers?SessionId=${session.Id}`).catch(() => []),
          site(`Plenum/GetAdditionalDocuments?SessionId=${session.Id}`).catch(() => []),
        ]);
        return sittingAgenda(session, topics, rows, speakers, docs);
      }, force);
    }

    // A sitting's votes; each names the agenda item it was about (ItemID).
    const loadSittingVotes = (session, force) => cached(`sitting-votes-${session.Id}`, sameDay(toDate(session.StartDate), new Date()) ? 2 * MIN : 30 * MIN, () =>
      odata(`KNS_PlenumVote?$filter=SessionID eq ${session.Id}&$orderby=VoteDateTime&$select=Id,VoteDateTime,ItemID,VoteTitle,VoteSubject,VoteMethodDesc`, 4), force);

    const loadSiteCommittees = force => cached('site-committees', 2 * MIN, () => site('Committees/GetAllCommittees/he'), force);

    const loadBroadcasts = force => cached('broadcasts', 5 * MIN, () => site('Committees/GetAllBroadcasts/he'), force);

    const loadHolidays = () => cached('holidays', 24 * 60 * MIN, () => site('Global/GetAllHolidays'));

    // The Knesset's working periods (מושבים) of the last few Knessets; the days between them are
    // recess, or the time between two Knessets.
    const loadWorkPeriods = () => cached('work-periods', 24 * 60 * MIN, async () => {
      const knesset = await loadKnesset();
      const rows = await odata(`KNS_KnessetDates?$filter=KnessetNum ge ${knesset.number - 2}&$orderby=PlenumStart&$select=KnessetNum,Plenum,PlenumStart,PlenumFinish`, 2);
      const periods = [];
      for (const row of rows) {
        const start = toDate(row.PlenumStart);
        if (start && !periods.some(period => period.knesset === row.KnessetNum && period.start.getTime() === start.getTime())) {
          periods.push({ knesset: row.KnessetNum, start, finish: toDate(row.PlenumFinish) });
        }
      }
      return periods;
    });

    // A month for the calendar: committee sessions (without their agendas, which would take
    // seconds for a busy month), plenum sittings with their number of votes, the next sitting if the
    // open data doesn't list it yet, holidays and the working periods.
    const loadMonth = (year, month, force) => cached(`month-${year}-${month}`, 5 * MIN, async () => {
      const from = new Date(year, month, 1);
      const to = new Date(year, month + 1, 1);
      const range = field => `${field} ge ${odataDate(from)} and ${field} lt ${odataDate(to)}`;
      const [sessions, sittings, votes, holidays, periods, next] = await Promise.all([
        odata(`KNS_CommitteeSession?$filter=${range('StartDate')}&$orderby=StartDate&$select=${SESSION_FIELDS}&$expand=KNS_Committee($select=Name)`, 12),
        odata(`KNS_PlenumSession?$filter=${range('StartDate')}&$orderby=StartDate&$select=Id,Number,KnessetNum,Name,StartDate,FinishDate,IsSpecialMeeting`, 1),
        odata(`KNS_PlenumVote?$filter=${range('VoteDateTime')}&$select=Id,SessionID`, 8).catch(() => []),
        loadHolidays().catch(() => []),
        loadWorkPeriods().catch(() => []),
        loadNextPlenum(force).catch(() => null),
      ]);
      const nextDate = next && toDate(next.NextSessionDate);
      if (nextDate && nextDate >= from && nextDate < to && !sittings.some(sitting => sitting.Id === next.NextSessionItemId)) {
        sittings.push({ Id: next.NextSessionItemId, StartDate: next.NextSessionDate, planned: true });
      }
      const votesBySitting = new Map();
      for (const vote of votes) votesBySitting.set(vote.SessionID, (votesBySitting.get(vote.SessionID) || 0) + 1);
      const days = new Map();
      const dayOf = date => {
        const key = dayKey(date);
        if (!days.has(key)) days.set(key, { sittings: [], sessions: [], holidays: [] });
        return days.get(key);
      };
      for (const sitting of sittings) {
        const date = toDate(sitting.StartDate);
        if (date) dayOf(date).sittings.push({ ...sitting, votes: votesBySitting.get(sitting.Id) || 0 });
      }
      for (const session of sessions) {
        const date = toDate(session.StartDate);
        if (date) dayOf(date).sessions.push(session);
      }
      for (const item of Array.isArray(holidays) ? holidays : []) {
        const date = toDate(item.Date);
        const name = clean(item.Name);
        if (date && date >= from && date < to && name && !dayOf(date).holidays.includes(name)) dayOf(date).holidays.push(name);
      }
      return { days, periods, sessions: sessions.length, cancelled: sessions.filter(session => session.StatusID === 193).length, sittings: sittings.length, votes: votes.length };
    }, force);

    // One day's committee sessions with their agendas, for the calendar's chosen day.
    const loadDaySessions = (date, force) => cached(`day-${dayKey(date)}`, sameDay(date, new Date()) ? 2 * MIN : 10 * MIN, () => {
      const from = startOfDay(date);
      const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
      return odata(`KNS_CommitteeSession?$filter=StartDate ge ${odataDate(from)} and StartDate lt ${odataDate(to)}&$orderby=StartDate&$select=${SESSION_FIELDS}&$expand=KNS_Committee($select=Name),KNS_CmtSessionItem($select=ItemID,Name,ItemTypeID,Ordinal,StatusID)`, 3);
    }, force);

    const loadCommittees = force => cached('committees', 30 * MIN, async () => {
      const knesset = await loadKnesset();
      return odata(`KNS_Committee?$filter=KnessetNum eq ${knesset.number}&$select=Id,Name,CommitteeTypeID,CommitteeTypeDesc,ParentCommitteeID,Email,StartDate,FinishDate`);
    }, force);

    const loadPlenumSessions = force => cached('plenum-sessions', 5 * MIN, async () => {
      const knesset = await loadKnesset();
      const rows = await odata(`KNS_PlenumSession?$filter=KnessetNum eq ${knesset.number}&$orderby=StartDate desc&$top=40&$select=Id,Number,Name,StartDate,FinishDate,IsSpecialMeeting`, 1);
      if (rows.length >= 6) return rows;
      // A new Knesset has only a few sittings; the previous Knesset's last ones follow them.
      const earlier = await odata(`KNS_PlenumSession?$filter=KnessetNum eq ${knesset.number - 1}&$orderby=StartDate desc&$top=10&$select=Id,Number,KnessetNum,Name,StartDate,FinishDate,IsSpecialMeeting`, 1);
      return [...rows, ...earlier];
    }, force);

    const loadVotes = force => cached('votes', 5 * MIN, () =>
      odata('KNS_PlenumVote?$orderby=VoteDateTime desc&$top=60&$select=Id,VoteDateTime,SessionID,ItemID,VoteMethodDesc,VoteTitle,VoteSubject,IsNoConfidenceInGov,ForOptionDesc,AgainstOptionDesc', 1), force);

    const loadBills = force => cached('bills', 10 * MIN, async () => {
      const knesset = await loadKnesset();
      return odata(`KNS_Bill?$filter=KnessetNum eq ${knesset.number}&$orderby=LastUpdatedDate desc&$select=Id,Name,SubTypeDesc,PrivateNumber,Number,StatusID,CommitteeID,LastUpdatedDate`, 4);
    }, force);

    const loadLaws = force => cached('laws', 30 * MIN, () =>
      odata('KNS_Bill?$filter=StatusID eq 118&$orderby=PublicationDate desc&$top=30&$select=Id,KnessetNum,Name,SubTypeDesc,PublicationDate,SummaryLaw', 1), force);

    const loadLobby = force => cached('lobby', 3 * MIN, () => site('MkLobby/GetMkLobbyData120?lang=he'), force);

    const loadPositions = force => cached('positions', 30 * MIN, () =>
      odata('KNS_PersonToPosition?$filter=IsCurrent eq true&$select=PersonID,PositionID,KnessetNum,GovernmentNum,FactionName,CommitteeID,CommitteeName,GovMinistryName,DutyDesc,StartDate', 8), force);

    // Names for the people in `positions`; asking by ID is ten times faster than by IsCurrent.
    const loadPeople = (positions, force) => cached('people', 60 * MIN, async () => {
      const ids = [...new Set(positions.map(p => p.PersonID).filter(Number.isInteger))];
      const rows = [];
      for (let i = 0; i < ids.length; i += 150) {
        rows.push(...await odata(`KNS_Person?$filter=Id in (${ids.slice(i, i + 150).join(',')})&$select=Id,FirstName,LastName,GenderDesc`, 3));
      }
      return new Map(rows.map(row => [row.Id, row]));
    }, force);

    // The MKs, with the roles that the open data lists for each of them.
    const loadMembers = force => cached('members', 3 * MIN, async () => {
      const [lobby, positions, knesset] = await Promise.all([loadLobby(force), loadPositions(force), loadKnesset()]);
      const people = await loadPeople(positions, force);
      const byName = new Map();
      for (const person of people.values()) byName.set(normalizeName(`${person.FirstName} ${person.LastName}`), person);
      const mks = (lobby.mks || []).map(mk => {
        const person = byName.get(normalizeName(`${mk.Firstname} ${mk.Lastname}`));
        const roles = person ? positions.filter(p => p.PersonID === person.Id) : [];
        return { ...mk, name: clean(`${mk.Firstname} ${mk.Lastname}`), personId: person ? person.Id : null, roles };
      });
      const photoByPerson = new Map(mks.filter(mk => mk.personId).map(mk => [mk.personId, mk.ImagePath]));
      return { mks, positions, people, photoByPerson, knesset };
    }, force);

    /* Shell */

    const root = h('section', { id: 'knesset', class: 'kn', dir: 'rtl', lang: 'he', 'aria-label': 'הכנסת', hidden: true });
    const subtitle = h('p', { class: 'kn-sub' }, 'טוען…');
    const tabList = h('nav', { class: 'kn-tabs', role: 'tablist', 'aria-label': 'נושאים' });
    // Keyboard hints only where there's a keyboard; embedded (Android), the view never closes.
    const keys = text => (api.embedded ? '' : ` (${text})`);
    const refreshButton = h('button', { type: 'button', class: 'icon-btn refresh', title: `רענון${keys('F5')}`, onclick: () => refresh() }, icon('i-reload'));
    const closeButton = api.embedded ? null : h('button', { type: 'button', class: 'icon-btn', title: 'חזרה לערוצים (K או Esc)', onclick: () => setOpen(false) }, icon('i-close'));
    const main = h('div', { class: 'kn-main', tabindex: '-1' });
    const detail = h('aside', { class: 'kn-detail', hidden: true, 'aria-label': 'פרטים' });
    root.append(
      h('header', { class: 'kn-header' },
        h('div', { class: 'kn-title' }, icon('i-knesset', 'icon kn-logo'), h('div', null, h('h2', null, 'הכנסת'), subtitle)),
        tabList,
        h('div', { class: 'kn-actions' }, refreshButton, closeButton)),
      h('div', { class: 'kn-body' }, main, detail));

    for (const [id, label] of TABS) {
      tabList.append(h('button', {
        type: 'button', role: 'tab', class: 'kn-tab', 'data-tab': id, 'aria-selected': String(id === view.tab),
        onclick: () => setTab(id),
      }, label));
    }

    // The player for recordings and live committee rooms that aren't among the TV channels.
    const player = (() => {
      const dialog = h('dialog', { class: 'dialog kn-player', dir: 'rtl', lang: 'he' });
      const title = h('h2');
      const video = h('video', { controls: true, playsinline: true });
      const note = h('p', { class: 'kn-player-note muted' }, 'ערוצי הטלוויזיה מושתקים בזמן הצפייה.');
      const close = h('button', { type: 'button', class: 'btn primary', onclick: () => dialog.close() }, 'סגירה');
      dialog.append(h('form', { method: 'dialog' }, title, h('div', { class: 'kn-player-screen' }, video), h('footer', { class: 'dialog-footer' }, note, close)));
      let hls = null;
      dialog.addEventListener('close', () => {
        if (hls) hls.destroy();
        hls = null;
        video.removeAttribute('src');
        video.load();
        api.silenceTv(false);
        notifyBack();
      });
      return {
        element: dialog,
        play(url, name) {
          title.textContent = name;
          if (hls) hls.destroy();
          hls = null;
          if (window.Hls && window.Hls.isSupported()) {
            hls = new window.Hls({ enableWorker: true });
            hls.loadSource(url);
            hls.attachMedia(video);
          } else {
            video.src = url;
          }
          api.silenceTv(true);
          if (!dialog.open) dialog.showModal();
          notifyBack();
          video.play().catch(() => {});
        },
      };
    })();

    // Recordings play in the host's own player when it has one (Android), else in the dialog.
    function playVideo(url, name) {
      if (typeof api.playVideo === 'function') api.playVideo(url, name);
      else player.play(url, name);
    }

    // Tells the host whether its back gesture has something here to close.
    let backState = false;
    function notifyBack() {
      const value = !detail.hidden || player.element.open;
      if (value === backState) return;
      backState = value;
      if (typeof api.onBackState === 'function') api.onBackState(value);
    }

    function setOpen(open) {
      if (view.open === open) return;
      view.open = open;
      root.hidden = !open;
      document.body.classList.toggle('knesset-open', open);
      api.onToggle(open);
      clearInterval(view.refreshTimer);
      if (open) {
        render();
        // The MKs and the government share the slowest data; it loads while you read.
        loadMembers().catch(() => {});
        view.refreshTimer = setInterval(() => {
          if (autoRefreshes() && !document.hidden && !document.querySelector('dialog[open]')) render({ quiet: true });
        }, TODAY_REFRESH_MS);
        main.focus({ preventScroll: true });
      } else {
        closeDetail();
      }
    }

    function setTab(tab) {
      // The plenum page opens on the current sitting.
      if (tab === 'plenum' && view.tab !== 'plenum') {
        view.plenumId = null;
        view.agendaSearch = '';
      }
      view.tab = tab;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ tab }));
      } catch {
        // Saving the tab is only a convenience.
      }
      for (const button of tabList.children) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
      closeDetail();
      main.scrollTop = 0;
      render();
    }

    function refresh() {
      if (!view.open) return;
      cache.clear();
      render({ force: true });
      api.refreshChannels();
    }

    // Today's page, and the plenum's while a sitting is on, keep themselves up to date – but not
    // under someone typing in one of their search boxes.
    function autoRefreshes() {
      const typing = main.contains(document.activeElement) && document.activeElement.matches('input');
      return (view.tab === 'today' || (view.tab === 'plenum' && view.plenumLive)) && !typing;
    }

    // Back in sight after a while (another app or tab): the page catches up at once.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && view.open && autoRefreshes() && Date.now() - view.renderedAt > TODAY_REFRESH_MS) render({ quiet: true });
    });

    async function renderSubtitle() {
      try {
        const knesset = await loadKnesset();
        const now = new Date();
        subtitle.textContent = `הכנסת ה-${knesset.number} · ${fullDayFormat.format(now)} · ${hebrewDate(now)}`;
      } catch {
        subtitle.textContent = fullDayFormat.format(new Date());
      }
    }

    // Renders the current tab; a newer render makes an older one's late answers go nowhere.
    async function render({ force = false, quiet = false } = {}) {
      const token = ++view.renderToken;
      renderSubtitle();
      if (!quiet) main.replaceChildren(loading('טוען מהכנסת…'));
      refreshButton.classList.add('is-busy');
      try {
        const content = await RENDERERS[view.tab](force);
        if (token !== view.renderToken) return;
        const scroll = main.scrollTop;
        main.replaceChildren(content);
        view.renderedAt = Date.now();
        if (quiet) main.scrollTop = scroll;
      } catch (error) {
        if (token !== view.renderToken) return;
        // A quiet redraw keeps what's shown, unless that is still the loading message.
        if (!quiet || main.querySelector(':scope > .kn-loading')) main.replaceChildren(problem(error, () => render({ force: true })));
      } finally {
        if (token === view.renderToken) refreshButton.classList.remove('is-busy');
      }
    }

    const loading = text => h('div', { class: 'kn-loading' }, h('div', { class: 'spinner' }), h('p', null, text));

    function problem(error, retry) {
      return h('div', { class: 'kn-problem' },
        h('p', null, 'לא הצלחתי לקבל את המידע מהכנסת.'),
        h('p', { class: 'muted' }, error && error.message ? error.message : ''),
        retry ? button('לנסות שוב', retry, 'btn primary small') : null);
    }

    const section = (title, ...children) => h('section', { class: 'kn-section' }, title ? h('h3', null, title) : null, ...children);
    const empty = text => h('p', { class: 'kn-empty' }, text);
    const badge = (text, tone = '') => h('span', { class: `kn-badge${tone ? ` ${tone}` : ''}` }, text);
    const explain = text => h('p', { class: 'kn-explain' }, text);

    /* Detail pane */

    async function openDetail(title, build) {
      detail.hidden = false;
      root.classList.add('has-detail');
      notifyBack();
      const body = h('div', { class: 'kn-detail-body' }, loading('טוען…'));
      detail.replaceChildren(
        h('header', { class: 'kn-detail-header' },
          h('h3', null, title),
          h('button', { type: 'button', class: 'icon-btn', title: `סגירה${keys('Esc')}`, onclick: closeDetail }, icon('i-close'))),
        body);
      const token = (detail.token = (detail.token || 0) + 1);
      try {
        const content = await build();
        if (detail.token === token) body.replaceChildren(content);
      } catch (error) {
        if (detail.token === token) body.replaceChildren(problem(error));
      }
      detail.scrollTop = 0;
    }

    function closeDetail() {
      detail.hidden = true;
      detail.token = (detail.token || 0) + 1;
      root.classList.remove('has-detail');
      notifyBack();
    }

    /* Watching */

    function streamFolder(url) {
      try {
        const parsed = new URL(url);
        return `${parsed.host}${parsed.pathname.replace(/\/[^/]*$/, '')}`.toLowerCase();
      } catch {
        return '';
      }
    }

    // A Knesset stream among the TV channels becomes the big one; the dashboard closes this view for it.
    function openChannel(id) {
      if (!api.embedded) setOpen(false);
      api.watchChannel(id);
    }

    // A live committee room that is among the TV channels opens there; anything else plays here.
    function watch(url, name) {
      const folder = streamFolder(url);
      const channel = api.knessetChannels().find(item => streamFolder(item.url) === folder);
      if (channel) openChannel(channel.id);
      else playVideo(url, name);
    }

    function watchPlenum() {
      const channel = api.knessetChannels().find(item => item.main);
      if (channel) openChannel(channel.id);
      else api.showToast('ערוץ הכנסת לא משדר כרגע');
    }

    /* ---------- Today ---------- */

    function liveCommitteeNames(siteCommittees) {
      return (Array.isArray(siteCommittees) ? siteCommittees : []).filter(item => item.isLive).map(item => item.name);
    }

    function sessionState(session, now, liveNames) {
      const start = toDate(session.StartDate);
      const finish = toDate(session.FinishDate);
      if (session.StatusID === 193) return ['בוטלה', 'cancelled'];
      if (finish && finish < now) return ['הסתיימה', 'done'];
      const name = session.KNS_Committee ? session.KNS_Committee.Name : '';
      const live = liveNames.some(liveName => similarity(liveName, name) >= 0.5);
      if (start <= now && sameDay(start, now) && live) return ['מתקיימת עכשיו', 'live'];
      if (start > now) return ['', 'upcoming'];
      return ['', 'past'];
    }

    function sessionItems(session) {
      return (session.KNS_CmtSessionItem || []).slice().sort((a, b) => (a.Ordinal || 0) - (b.Ordinal || 0));
    }

    function sessionCard(session, now, liveNames, recordings) {
      const start = toDate(session.StartDate);
      const [stateText, stateClass] = sessionState(session, now, liveNames);
      const name = session.KNS_Committee ? session.KNS_Committee.Name : 'ועדה';
      const items = sessionItems(session);
      const recording = recordings.get(session.Id);
      const card = h('article', { class: `kn-card kn-session is-${stateClass}` },
        h('div', { class: 'kn-when' }, h('b', null, time(start)), session.TypeDesc === 'חסויה' ? badge('חסויה', 'muted') : null),
        h('div', { class: 'kn-what' },
          h('div', { class: 'kn-card-title' }, h('span', { class: 'kn-kind' }, 'ועדה'), h('strong', null, name), stateText ? badge(stateText, stateClass) : null),
          items.length
            ? h('ul', { class: 'kn-items' }, items.slice(0, 4).map(item => h('li', null, h('span', { class: 'kn-item-type' }, ITEM_TYPES[item.ItemTypeID] || 'נושא'), clean(item.Name))), items.length > 4 ? h('li', { class: 'muted' }, `ועוד ${items.length - 4}`) : null)
            : h('p', { class: 'muted' }, 'סדר היום טרם פורסם'),
          h('div', { class: 'kn-card-actions' },
            stateClass === 'live' ? button('צפייה בשידור', () => openSession(session), 'kn-btn live') : null,
            recording ? button('הקלטה', () => playVideo(recording.broadcastUrl, `${name} · ${shortDate(start)}`), 'kn-btn') : null,
            button('פרטים', () => openSession(session)),
            session.Location ? h('span', { class: 'kn-place muted' }, clean(session.Location)) : null)));
      return card;
    }

    // "7 סעיפים, 3 בתמיכת הממשלה" for a topic of the plenum's agenda.
    function topicCounts(topic) {
      if (!topic) return '';
      const supported = topic.items.filter(item => item.support).length;
      return [topic.items.length > 1 ? `${topic.items.length} סעיפים` : '', supported ? `${supported > 1 ? `${supported} ` : ''}בתמיכת הממשלה` : ''].filter(Boolean).join(', ');
    }

    function plenumCard(topics, agenda) {
      const isLive = topics.some(topic => topic.IsLive);
      const start = toDate(topics[0].StartTime);
      const liveItem = agenda && agenda.live ? agenda.topics.flatMap(topic => topic.items).find(item => item.live) : null;
      return h('article', { class: `kn-card kn-session kn-plenum${isLive ? ' is-live' : ''}` },
        h('div', { class: 'kn-when' }, h('b', null, time(start))),
        h('div', { class: 'kn-what' },
          h('div', { class: 'kn-card-title' }, h('span', { class: 'kn-kind plenum' }, 'מליאה'), h('strong', null, 'ישיבת מליאת הכנסת'), isLive ? badge('מתקיימת עכשיו', 'live') : null),
          h('ol', { class: 'kn-items' }, topics.map(topic => {
            const counts = topicCounts(agenda && agenda.topics.find(item => item.id === topic.TitleId));
            return h('li', { class: topic.IsLive ? 'is-now' : '' }, clean(topic.Title),
              counts ? h('span', { class: 'muted' }, ` · ${counts}`) : null,
              topic.IsLive ? badge('עכשיו', 'live') : null,
              topic.IsLive && liveItem ? h('div', { class: 'kn-now-line' }, `${liveItem.letter ? `${liveItem.letter}. ` : ''}${liveItem.name}`) : null,
              topic.IsLive && agenda && agenda.current ? h('div', { class: 'kn-now-line muted' }, `על הדוכן: ${agenda.current}${agenda.next ? ` · הבא בתור: ${agenda.next}` : ''}`) : null);
          })),
          h('div', { class: 'kn-card-actions' },
            button(isLive ? 'צפייה בשידור חי' : 'לערוץ הכנסת', watchPlenum, isLive ? 'kn-btn live' : 'kn-btn'),
            button('סדר היום המלא', () => setTab('plenum')),
            externalLink(start ? agendaUrl(start) : `${SITE}/apps/plenum`, 'באתר הכנסת'))));
    }

    async function renderToday(force) {
      const now = new Date();
      const [knesset, week, agenda, next, siteCommittees, broadcasts, holidays] = await Promise.all([
        loadKnesset(force), loadWeek(force),
        loadPlenumAgenda(force).catch(() => []), loadNextPlenum(force).catch(() => null),
        loadSiteCommittees(force).catch(() => []), loadBroadcasts(force).catch(() => null), loadHolidays().catch(() => []),
      ]);
      const liveNames = liveCommitteeNames(siteCommittees);
      const recordings = new Map(((broadcasts && broadcasts.listBroadcasts) || []).filter(item => item.broadcastUrl).map(item => [item.sessionId, item]));
      const today = week.filter(session => sameDay(toDate(session.StartDate), now));
      const later = week.filter(session => startOfDay(toDate(session.StartDate)) > startOfDay(now));
      const topics = Array.isArray(agenda) ? agenda.slice().sort((a, b) => (a.Ordinal || 0) - (b.Ordinal || 0)) : [];
      // Today's sitting in full: what's being discussed now and who is speaking.
      const sitting = topics.length && topics[0].FK_ItemID ? await loadSitting({ Id: topics[0].FK_ItemID, StartDate: topics[0].StartTime }, force).catch(() => null) : null;
      const fragment = h('div', { class: 'kn-page' });

      // On air: the Knesset streams the TV grid found, and what the plenum is discussing.
      const streams = api.knessetChannels().filter(item => item.live);
      const liveTopic = topics.find(topic => topic.IsLive);
      const liveItem = sitting && sitting.live ? sitting.topics.flatMap(topic => topic.items).find(item => item.live) : null;
      if (streams.length || liveTopic) {
        fragment.append(section('משודר עכשיו', h('div', { class: 'kn-live-row' },
          liveTopic ? h('button', { type: 'button', class: 'kn-live', onclick: watchPlenum }, h('i', { class: 'kn-dot' }), h('span', null, h('b', null, `מליאה · ${clean(liveTopic.Title)}`), liveItem ? liveItem.name : 'שידור חי')) : null,
          streams.filter(item => !(item.main && liveTopic)).map(item => h('button', {
            type: 'button', class: 'kn-live', onclick: () => openChannel(item.id),
          }, h('i', { class: 'kn-dot' }), h('span', null, h('b', null, item.name), item.now || 'שידור חי'))))));
      }

      // Today's timeline: the plenum and every committee session, in time order.
      const timeline = [];
      if (topics.length) timeline.push({ at: toDate(topics[0].StartTime), node: plenumCard(topics, sitting) });
      for (const session of today) timeline.push({ at: toDate(session.StartDate), node: sessionCard(session, now, liveNames, recordings) });
      timeline.sort((a, b) => a.at - b.at);
      const cancelled = today.filter(session => session.StatusID === 193).length;
      fragment.append(section(`היום בכנסת · ${dayFormat.format(now)}`,
        timeline.length
          ? h('div', { class: 'kn-timeline' }, timeline.map(entry => entry.node))
          : empty(now.getDay() === 5 || now.getDay() === 6 ? 'אין דיונים בסוף השבוע.' : 'אין דיונים מתוכננים להיום.'),
        today.length ? h('p', { class: 'kn-note muted' }, `${count(today.length, 'דיון אחד בוועדה', 'דיונים בוועדות')}${cancelled ? `, ${count(cancelled, 'אחד בוטל', 'בוטלו')}` : ''}. רוב הדיונים הפתוחים משודרים, ואחריהם מתפרסמים הקלטה ופרוטוקול.`) : null));

      if (!topics.length && next && next.NextSessionDate) {
        const date = toDate(next.NextSessionDate);
        fragment.append(section('ישיבת המליאה הבאה', h('p', { class: 'kn-big' }, `${dayLabel(date, now)}, ${shortDate(date)}, בשעה ${time(date)}`),
          explain('המליאה מתכנסת בדרך כלל בימים שני ושלישי אחר הצהריים וביום רביעי בבוקר.')));
      }

      // The week ahead, day by day.
      const days = new Map();
      for (const session of later) {
        const key = startOfDay(toDate(session.StartDate)).getTime();
        if (!days.has(key)) days.set(key, []);
        days.get(key).push(session);
      }
      fragment.append(section('השבוע הקרוב בוועדות', days.size
        ? h('div', { class: 'kn-days' }, [...days].map(([key, sessions]) => h('div', { class: 'kn-day' },
          h('h4', null, dayLabel(new Date(key), now), h('span', { class: 'muted' }, ` · ${shortDate(new Date(key))}`)),
          h('ul', { class: 'kn-agenda' }, sessions.map(session => h('li', { class: session.StatusID === 193 ? 'is-cancelled' : '' },
            h('button', { type: 'button', class: 'kn-row-btn', onclick: () => openSession(session) },
              h('b', null, time(toDate(session.StartDate))),
              h('span', null, h('strong', null, session.KNS_Committee ? session.KNS_Committee.Name : 'ועדה'), ' – ', clean(sessionItems(session)[0]?.Name) || 'סדר היום טרם פורסם'),
              session.StatusID === 193 ? badge('בוטלה', 'cancelled') : null)))))))
        : empty('עדיין לא פורסמו דיונים לימים הבאים.')));

      // Where the Knesset is in its year, and the next holidays.
      const upcoming = (Array.isArray(holidays) ? holidays : []).map(item => ({ name: clean(item.Name), date: toDate(item.Date) }))
        .filter(item => item.date && item.date >= startOfDay(now)).sort((a, b) => a.date - b.date).slice(0, 4);
      fragment.append(section('לוח הכנסת', h('dl', { class: 'kn-facts' },
        h('dt', null, 'הכנסת'), h('dd', null, `הכנסת ה-${knesset.number} (${knesset.name}), מאז ${shortDate(knesset.start)}`),
        h('dt', null, 'תקופת העבודה'), h('dd', null, `המושב ה-${knesset.plenum}${knesset.sessionStart ? `, מאז ${shortDate(knesset.sessionStart)}` : ''}${knesset.sessionEnd ? ` עד ${shortDate(knesset.sessionEnd)}` : ''}`),
        upcoming.length ? [h('dt', null, 'מועדים קרובים'), h('dd', null, upcoming.map(item => `${item.name} (${shortDate(item.date)})`).join(' · '))] : null),
        h('div', { class: 'kn-card-actions' },
          button('לוח השנה של הכנסת', () => setTab('calendar'), 'kn-btn small'),
          externalLink(`${SITE}/About/KnessetWork/Pages/WorkAndRecessDates.aspx`, 'מועדי עבודת הכנסת'))));
      return fragment;
    }

    // A committee session: what's on the agenda, who's invited, video, documents.
    function openSession(session) {
      const name = session.KNS_Committee ? session.KNS_Committee.Name : 'דיון בוועדה';
      const start = toDate(session.StartDate);
      openDetail(name, async () => {
        const [info, docs] = await Promise.all([
          site(`CommitteeSessions/GetCommitteePortalsSessionDetails?ItemId=${session.Id}&lang=he`).catch(() => null),
          odata(`KNS_DocumentCommitteeSession?$filter=CommitteeSessionID eq ${session.Id}&$select=GroupTypeDesc,DocumentName,ApplicationDesc,FilePath`, 1).catch(() => []),
        ]);
        const items = info && Array.isArray(info.items) && info.items.length
          ? info.items.map(item => ({ name: clean(item.SanContent), url: item.SessionItemUrl }))
          : sessionItems(session).map(item => ({ name: `${ITEM_TYPES[item.ItemTypeID] || 'נושא'}: ${clean(item.Name)}`, url: '' }));
        const live = info && info.IsLiveBroadcast && info.LiveUrlFeed;
        const archive = info && info.ArchiveUrlFeed;
        return h('div', { class: 'kn-stack' },
          h('p', { class: 'kn-big' }, `${dayLabel(start)}, ${shortDate(start)}, בשעה ${time(start)}`),
          h('p', { class: 'muted' }, [clean(info && info.CommitteeLocation) || clean(session.Location), session.TypeDesc === 'חסויה' ? 'דיון חסוי – סגור לציבור ולא משודר' : 'דיון פתוח', session.StatusID === 193 ? 'הדיון בוטל' : ''].filter(Boolean).join(' · ')),
          live || archive ? h('div', { class: 'kn-card-actions' },
            live ? button('צפייה בשידור חי', () => watch(info.LiveUrlFeed, name), 'kn-btn live') : null,
            archive ? button('צפייה בהקלטה', () => playVideo(info.ArchiveUrlFeed, `${name} · ${shortDate(start)}`), 'kn-btn') : null) : null,
          section('על סדר היום', items.length ? h('ol', { class: 'kn-items' }, items.map(item => h('li', null, item.name, item.url ? externalLink(item.url, 'פרטים') : null))) : empty('סדר היום טרם פורסם.')),
          info && clean(info.Inviteds) ? section('מוזמנים', h('p', { class: 'kn-prose' }, plain(info.Inviteds))) : null,
          info && clean(info.SessionNotes) ? section('הערות', h('p', { class: 'kn-prose' }, plain(info.SessionNotes))) : null,
          docs.length || (info && info.ProtocolUrl) ? section('מסמכים', h('ul', { class: 'kn-docs' },
            info && info.ProtocolUrl ? h('li', null, externalLink(info.ProtocolUrl, 'פרוטוקול הדיון')) : null,
            docs.map(doc => h('li', null, externalLink(doc.FilePath, `${clean(doc.GroupTypeDesc)}${doc.DocumentName ? ` – ${clean(doc.DocumentName)}` : ''} (${doc.ApplicationDesc})`))))) : null,
          info && Array.isArray(info.News) && info.News.length ? section('הודעות לעיתונות', h('ul', { class: 'kn-docs' }, info.News.map(item => h('li', null, externalLink(`${SITE}/apps${item.NewsUrl}`, clean(item.Title)))))) : null,
          externalLink(session.SessionUrl ? session.SessionUrl.replace(/^http:/, 'https:') : `${SITE}/apps/committees`, 'הדיון באתר הכנסת'));
      });
    }

    /* ---------- Committees ---------- */

    function committeeMatch(committee, siteCommittees, broadcasts) {
      const viaBroadcast = (broadcasts || []).find(item => item.committeeSanId === committee.Id);
      const pool = Array.isArray(siteCommittees) ? siteCommittees : [];
      if (viaBroadcast) {
        const exact = pool.find(item => normalizeName(item.name) === normalizeName(viaBroadcast.committeeName));
        if (exact) return exact;
      }
      let best = null;
      let bestScore = 0;
      for (const item of pool) {
        const score = Math.max(similarity(item.name, committee.Name), viaBroadcast ? similarity(item.name, viaBroadcast.committeeName) : 0);
        if (score > bestScore) {
          best = item;
          bestScore = score;
        }
      }
      return bestScore >= 0.5 ? best : null;
    }

    async function renderCommittees(force) {
      const [committees, siteCommittees, broadcasts, week] = await Promise.all([
        loadCommittees(force), loadSiteCommittees(force).catch(() => []), loadBroadcasts(force).catch(() => null), loadWeek(force).catch(() => []),
      ]);
      const list = (broadcasts && broadcasts.listBroadcasts) || [];
      const now = new Date();
      const fragment = h('div', { class: 'kn-page' });
      const isNew = committees.every(committee => /זמני|המסדרת/.test(committee.Name) || committee.CommitteeTypeID === 73 || committee.CommitteeTypeID === 74);
      if (isNew) {
        fragment.append(explain('הכנסת חדשה, ולכן פועלות בינתיים ועדות זמניות והוועדה המסדרת. הוועדות הקבועות יוקמו בהמשך, בדרך כלל אחרי שהממשלה מושבעת.'));
      }
      const groups = new Map();
      for (const committee of committees) {
        const type = COMMITTEE_TYPES[committee.CommitteeTypeID] ? committee.CommitteeTypeID : 72;
        if (!groups.has(type)) groups.set(type, []);
        groups.get(type).push(committee);
      }
      for (const type of [70, 71, 72, 73, 74]) {
        const members = groups.get(type);
        if (!members) continue;
        const [title, text] = COMMITTEE_TYPES[type];
        fragment.append(section(title, explain(text), h('div', { class: 'kn-grid' }, members.sort((a, b) => a.Name.localeCompare(b.Name, 'he')).map(committee => {
          const match = committeeMatch(committee, siteCommittees, list);
          const nextSession = week.find(session => session.CommitteeID === committee.Id && toDate(session.StartDate) >= startOfDay(now) && session.StatusID !== 193);
          return h('button', { type: 'button', class: `kn-tile${match && match.isLive ? ' is-live' : ''}`, onclick: () => openCommittee(committee, match) },
            match && match.img ? h('img', { src: match.img, alt: '', loading: 'lazy' }) : h('span', { class: 'kn-tile-icon' }, icon('i-knesset')),
            h('span', { class: 'kn-tile-text' },
              h('strong', null, committee.Name),
              match && clean(match.chairman) ? h('span', { class: 'muted' }, `${match.gender === 2 ? 'יושבת-ראש' : 'יושב-ראש'}: ${clean(match.chairman)}`) : null,
              match && match.isLive ? badge('בדיון עכשיו', 'live') : nextSession ? h('span', { class: 'muted' }, `דיון הבא: ${dayLabel(toDate(nextSession.StartDate), now)} ${time(toDate(nextSession.StartDate))}`) : null));
        }))));
      }
      fragment.append(h('p', { class: 'kn-note' }, externalLink(`${SITE}/apps/committees/lobby`, 'כל הוועדות באתר הכנסת')));
      return fragment;
    }

    function openCommittee(committee, match) {
      openDetail(committee.Name, async () => {
        const [sessions, details, news] = await Promise.all([
          odata(`KNS_CommitteeSession?$filter=CommitteeID eq ${committee.Id}&$orderby=StartDate desc&$top=20&$select=${SESSION_FIELDS}&$expand=KNS_CmtSessionItem($select=ItemID,Name,ItemTypeID,Ordinal,StatusID)`, 1),
          match ? site(`CommitteeDetails/GetCommitteeDetails?committeeId=${match.id}&lang=he`).catch(() => null) : null,
          match ? site(`CommitteeNews/GetCommitteeNewsAll?lang=he&committeeId=${match.id}`).catch(() => null) : null,
        ]);
        const now = new Date();
        const withCommittee = sessions.map(session => ({ ...session, KNS_Committee: { Name: committee.Name } }));
        const upcoming = withCommittee.filter(session => toDate(session.StartDate) >= startOfDay(now)).reverse();
        const past = withCommittee.filter(session => toDate(session.StartDate) < startOfDay(now));
        const person = member => h('li', { class: 'kn-person' },
          member.MkImagePath ? h('img', { src: member.MkImagePath, alt: '', loading: 'lazy' }) : h('span', { class: 'kn-avatar' }),
          h('span', null, h('strong', null, clean(member.Name)), h('span', { class: 'muted' }, clean(member.FactionName))));
        const sessionRow = session => h('li', { class: session.StatusID === 193 ? 'is-cancelled' : '' },
          h('button', { type: 'button', class: 'kn-row-btn', onclick: () => openSession(session) },
            h('b', null, `${shortDate(toDate(session.StartDate))} ${time(toDate(session.StartDate))}`),
            h('span', null, clean(sessionItems(session)[0]?.Name) || 'סדר היום טרם פורסם'),
            session.StatusID === 193 ? badge('בוטלה', 'cancelled') : session.TypeDesc === 'חסויה' ? badge('חסויה', 'muted') : null));
        const occupations = details && clean(plain(details.Occupations));
        return h('div', { class: 'kn-stack' },
          explain((COMMITTEE_TYPES[committee.CommitteeTypeID] || COMMITTEE_TYPES[72])[1]),
          occupations ? section('תחומי האחריות', h('p', { class: 'kn-prose' }, occupations)) : null,
          details && details.Chairman ? section(details.Chairman.GenderId === 2 ? 'יושבת-ראש' : 'יושב-ראש', h('ul', { class: 'kn-people' }, person(details.Chairman))) : null,
          details && details.CommitteeMembers && details.CommitteeMembers.length ? section(`חברי הוועדה (${details.CommitteeMembers.length})`, h('ul', { class: 'kn-people' }, details.CommitteeMembers.map(person))) : null,
          details && details.SubtituteMembers && details.SubtituteMembers.length ? section('ממלאי מקום', h('ul', { class: 'kn-people' }, details.SubtituteMembers.map(person))) : null,
          section('דיונים קרובים', upcoming.length ? h('ul', { class: 'kn-agenda' }, upcoming.map(sessionRow)) : empty('לא פורסמו דיונים קרובים.')),
          section('דיונים אחרונים', past.length ? h('ul', { class: 'kn-agenda' }, past.slice(0, 10).map(sessionRow)) : empty('אין עדיין דיונים קודמים.')),
          news && Array.isArray(news.news) && news.news.length ? section('הודעות הוועדה', h('ul', { class: 'kn-docs' }, news.news.slice(0, 8).map(item => h('li', null,
            h('span', { class: 'muted' }, `${shortDate(toDate(item.MessageDate))} · `), externalLink(`${SITE}/apps${item.MessageUrl}`, clean(item.Title)))))) : null,
          details && details.CrewMembers && details.CrewMembers.length ? section('צוות הוועדה', h('ul', { class: 'kn-crew' }, details.CrewMembers.map(member => h('li', null, h('span', { class: 'muted' }, `${clean(member.CrewTypeName)}: `), clean(member.MemberName))))) : null,
          details ? section('יצירת קשר', h('p', { class: 'kn-prose' }, [clean(details.Location), clean(details.Phone) && `טלפון ${clean(details.Phone)}`, clean(details.Email)].filter(Boolean).join(' · '))) : null,
          match ? externalLink(`${SITE}/apps/committees/${match.id}`, 'פורטל הוועדה באתר הכנסת') : externalLink(`${SITE}/apps/committees/lobby`, 'הוועדות באתר הכנסת'));
      });
    }

    /* ---------- Plenum ---------- */

    // The Knesset secretariat's notes on an item say when the government supports it.
    const GOV_SUPPORT = /תמיכת\s+ה?ממשלה|הממשלה\s+תומכת/;
    const GOV_AGAINST = /התנגדות\s+ה?ממשלה|הממשלה\s+מתנגדת/;

    // A summary can end with the Knesset legal adviser's note between asterisks
    // ("* הערת הייעוץ המשפטי: יש לאשר את ההצעה ברוב של 61 ח"כים לפחות *").
    function splitSummary(value) {
      const legal = [];
      const text = String(value || '').replace(/\r/g, '').replace(/\*([^*]{4,})\*/g, (_, note) => {
        legal.push(clean(note));
        return '\n';
      });
      return { paragraphs: text.split(/\n+/).map(clean).filter(Boolean), legal: legal.filter(Boolean) };
    }

    // One item of a sitting's agenda, from the website's GetSessionData.
    function agendaItem(row, speakers, docs) {
      const notes = String(row.SecretaryNotes || '').split(/\r?\n/).map(clean).filter(Boolean);
      const { paragraphs, legal } = splitSummary(row.Summery);
      const internal = row.FK_InternalSessionItemId;
      return {
        key: `${row.TitleId}-${row.FK_SessionItemId || row.FK_ItemID}`,
        itemId: row.FK_ItemID,
        type: row.LU_ItemType,
        letter: clean(row.OrdinalAlphabet),
        name: clean(row.ItemName),
        number: clean(String(row.Ext1 || '').replace(/[\s\-–]+$/, '')),
        parties: clean(row.Ext2).replace(/^\(\s*/, '(').replace(/\s*\)$/, ')'),
        initiators: clean(row.Initiators),
        committee: clean(row.CommitteeName),
        roles: [['מציג', row.PresenterType, row.Presenter], ['מנמק', row.ReasonerType, row.Reasoner], ['משיב', row.AnswerType, row.Answer]]
          .filter(([, , who]) => clean(who))
          .map(([fallback, type, who]) => [clean(type).replace(/:$/, '') || fallback, clean(who)]),
        support: notes.some(note => GOV_SUPPORT.test(note)),
        against: notes.some(note => GOV_AGAINST.test(note)),
        notes: notes.filter(note => !GOV_SUPPORT.test(note) && !GOV_AGAINST.test(note)),
        summary: paragraphs,
        legal,
        doc: docUrl(row.DocPath),
        docs: docs.filter(doc => doc.FK_Item_Id === row.FK_ItemID && doc.FilePath).map(doc => ({ url: docUrl(doc.FilePath), name: clean(doc.FileDesc) || 'מסמך' })),
        // While a sitting is on, its speakers point at the item's internal ID; later at its topic and session item.
        speakers: speakers.filter(speaker => (internal && speaker.SessionItemId === internal) || (speaker.TitleId === row.TitleId && speaker.SessionItemId === row.FK_SessionItemId))
          .sort((a, b) => (a.Ordinal || 0) - (b.Ordinal || 0)),
        live: Boolean(row.IsLive),
        done: Boolean(row.IsDone),
        active: row.IsActive !== false,
      };
    }

    function sittingAgenda(session, topics, rows, speakers, docs) {
      const items = Array.isArray(rows) ? rows : [];
      const speakerRows = Array.isArray(speakers) ? speakers : [];
      const docRows = Array.isArray(docs) ? docs : [];
      // A day can have two sittings; each topic names its own.
      const list = (Array.isArray(topics) ? topics : []).filter(topic => !topic.FK_ItemID || topic.FK_ItemID === session.Id)
        .slice().sort((a, b) => (a.Ordinal || 0) - (b.Ordinal || 0))
        .map(topic => ({ id: topic.TitleId, title: clean(topic.Title), live: Boolean(topic.IsLive), finish: toDate(topic.FinishTime) }));
      for (const row of items) {
        if (!list.some(topic => topic.id === row.TitleId)) list.push({ id: row.TitleId, title: TOPIC_KINDS[row.LU_ItemType] || '', live: false, finish: null });
      }
      for (const topic of list) topic.items = items.filter(row => row.TitleId === topic.id).map(row => agendaItem(row, speakerRows, docRows));
      const live = list.some(topic => topic.live) || items.some(row => row.IsLive);
      const speaking = live ? items.find(row => clean(row.CurrentSpeaker)) : null;
      return {
        session,
        topics: list,
        count: items.length,
        live,
        finish: list.map(topic => topic.finish).find(Boolean) || null,
        current: speaking ? clean(speaking.CurrentSpeaker) : '',
        next: speaking ? clean(speaking.NextSpeaker) : '',
      };
    }

    const hasAgenda = agenda => Boolean(agenda && (agenda.count || agenda.topics.length));

    function votesByItem(votes) {
      const map = new Map();
      for (const vote of votes || []) {
        if (!vote.ItemID) continue;
        if (!map.has(vote.ItemID)) map.set(vote.ItemID, []);
        map.get(vote.ItemID).push(vote);
      }
      return map;
    }

    // A <details> that stays open or closed across the page's automatic refreshes.
    function remembered(key, label, ...content) {
      const element = h('details', { class: 'kn-more', open: view.openKeys.has(key) }, h('summary', null, label), ...content);
      element.addEventListener('toggle', () => {
        if (element.open) view.openKeys.add(key);
        else view.openKeys.delete(key);
      });
      return element;
    }

    const longSummary = item => item.summary.join(' ').length > 260 || item.summary.length > 2;

    function speakerRow(speaker, live) {
      const current = live && speaker.IsCurrent;
      const spoke = live && speaker.IsSpoken && !current;
      const away = live && !speaker.IsPresent && !current && !spoke;
      const female = speaker.Gender === 0;
      return h('li', { class: [current ? 'is-current' : '', spoke ? 'is-spoken' : '', away ? 'is-away' : ''].filter(Boolean).join(' ') || null, title: away ? 'לא באולם' : null },
        clean(speaker.Speaker),
        speaker.SpokenTime ? h('span', { class: 'muted' }, ` · ${speaker.SpokenTime} דק׳`) : null,
        current ? badge(female ? 'מדברת עכשיו' : 'מדבר עכשיו', 'live') : null,
        spoke ? h('span', { class: 'kn-check', title: female ? 'כבר דיברה' : 'כבר דיבר' }, '✓') : null);
    }

    // An item of the agenda: its letter and name, the government's position, the number and the
    // initiators, who presents it and who answers, the secretariat's notes, the summary, documents,
    // the bill's stages, votes, and the speakers. Done and live marks only while the sitting is on.
    function agendaItemView(item, { live, votes }) {
      const long = longSummary(item);
      const openKey = `summary:${item.key}`;
      const open = view.openKeys.has(openKey);
      const li = h('li', {
        class: ['kn-item', live && item.live ? 'is-live' : '', live && item.done && !item.live ? 'is-done' : '', item.active ? '' : 'is-inactive', open ? 'is-open' : ''].filter(Boolean).join(' '),
        'data-key': item.key,
        'data-text': normalizeName([item.letter, item.name, item.number, item.parties, item.initiators, item.committee, ...item.roles.flat(), ...item.notes, ...item.summary, item.support ? 'בתמיכת הממשלה' : ''].join(' ')),
      });
      const more = long ? h('button', { type: 'button', class: 'kn-more-btn', 'aria-expanded': String(open) }, open ? 'פחות' : 'להמשך התקציר') : null;
      if (more) {
        more.addEventListener('click', () => {
          const expanded = !li.classList.contains('is-open');
          li.classList.toggle('is-open', expanded);
          more.setAttribute('aria-expanded', String(expanded));
          more.textContent = expanded ? 'פחות' : 'להמשך התקציר';
          if (expanded) view.openKeys.add(openKey);
          else view.openKeys.delete(openKey);
        });
      }
      const meta = [item.number, item.parties, item.initiators, item.committee ? `ועדה: ${item.committee}` : ''].filter(Boolean);
      const docLabel = item.type === 1 ? 'נוסח השאילתה' : item.type === 2 ? 'נוסח ההצעה' : 'המסמך';
      const withKind = (label, url) => `${label}${fileKind(url) ? ` (${fileKind(url)})` : ''}`;
      const actions = [
        item.doc ? externalLink(item.doc, withKind(docLabel, item.doc)) : null,
        ...item.docs.map(doc => externalLink(doc.url, withKind(doc.name, doc.url))),
        item.type === 2 && item.itemId ? button('שלבי החקיקה', () => openBill({ Id: item.itemId, Name: item.name }), 'kn-btn small') : null,
        votes.length === 1 ? button('תוצאת ההצבעה', () => openVote(votes[0]), 'kn-btn small') : null,
      ].filter(Boolean);
      fill(li,
        h('div', { class: 'kn-item-head' },
          h('strong', { class: 'kn-item-name' }, item.letter ? h('span', { class: 'kn-letter' }, `${item.letter}. `) : null, item.name),
          live && item.live ? badge('עכשיו בדיון', 'live') : null,
          live && item.done && !item.live ? badge('נדון', 'done') : null,
          item.active ? null : badge('ירד מסדר היום', 'cancelled'),
          item.support ? badge('בתמיכת הממשלה', 'gov') : null,
          item.against ? badge('בהתנגדות הממשלה', 'warn') : null),
        meta.length ? h('p', { class: 'kn-item-meta' }, meta.join(' · ')) : null,
        item.roles.length ? h('p', { class: 'kn-item-roles' }, item.roles.map(([type, who], i) => [i ? ' · ' : '', h('span', { class: 'muted' }, `${type}: `), who])) : null,
        item.notes.length ? h('ul', { class: 'kn-notes' }, item.notes.map(note => h('li', null, note))) : null,
        item.summary.length ? h('div', { class: 'kn-item-summary' },
          h('b', null, 'תקציר'),
          h('p', { class: `kn-summary-text${long ? ' is-long' : ''}` }, item.summary.join('\n')),
          more) : null,
        item.legal.map(note => h('p', { class: 'kn-legal' }, note)),
        actions.length ? h('div', { class: 'kn-item-actions' }, actions) : null,
        votes.length > 1 ? remembered(`votes:${item.key}`, `הצבעות (${votes.length})`, h('ul', { class: 'kn-agenda' }, votes.map(vote => h('li', null,
          h('button', { type: 'button', class: 'kn-row-btn', onclick: () => openVote(vote) }, h('b', null, time(toDate(vote.VoteDateTime))), h('span', null, clean(vote.VoteSubject) || clean(vote.VoteTitle))))))) : null,
        item.speakers.length ? remembered(`speakers:${item.key}`, `הדוברים (${item.speakers.length})`, h('ol', { class: 'kn-speakers' }, item.speakers.map(speaker => speakerRow(speaker, live)))) : null);
      return li;
    }

    // The sitting's agenda, topic by topic; a long one gets a search over every item's text.
    function agendaView(agenda, { votes = new Map(), search = false } = {}) {
      const showAll = 'כל התקצירים במלואם';
      const showLess = 'לקצר את התקצירים';
      const container = h('div', { class: `kn-agenda-view${view.allSummaries ? ' show-all' : ''}` });
      const toolbar = h('div', { class: 'kn-toolbar' });
      const noMatch = empty('אין סעיפים שמתאימים לחיפוש.');
      noMatch.hidden = true;
      const filter = () => {
        const words = normalizeName(view.agendaSearch).split(' ').filter(Boolean);
        let shown = 0;
        for (const topic of container.querySelectorAll('.kn-topic')) {
          const titleMatch = words.every(word => normalizeName(topic.querySelector('h4').textContent).includes(word));
          let visible = 0;
          for (const item of topic.querySelectorAll('.kn-item')) {
            item.hidden = !titleMatch && !words.every(word => item.dataset.text.includes(word));
            if (!item.hidden) visible++;
          }
          topic.hidden = !titleMatch && visible === 0;
          if (!topic.hidden) shown++;
        }
        noMatch.hidden = shown > 0;
      };
      if (search) {
        const input = h('input', { type: 'search', class: 'kn-search', placeholder: 'חיפוש בסדר היום', value: view.agendaSearch, 'aria-label': 'חיפוש בסדר היום' });
        input.addEventListener('input', () => {
          view.agendaSearch = input.value;
          filter();
        });
        toolbar.append(input);
      }
      if (agenda.topics.some(topic => topic.items.some(longSummary))) {
        const toggle = button(view.allSummaries ? showLess : showAll, () => {
          view.allSummaries = !view.allSummaries;
          container.classList.toggle('show-all', view.allSummaries);
          toggle.textContent = view.allSummaries ? showLess : showAll;
        }, 'kn-btn small');
        toolbar.append(toggle);
      }
      if (toolbar.childElementCount) container.append(toolbar);
      agenda.topics.forEach((topic, index) => {
        const counts = topicCounts(topic);
        container.append(h('section', { class: `kn-topic${agenda.live && topic.live ? ' is-live' : ''}` },
          h('div', { class: 'kn-topic-head' },
            h('span', { class: 'kn-topic-num' }, String(index + 1)),
            h('h4', null, topic.title || 'נושא'),
            agenda.live && topic.live ? badge('עכשיו', 'live') : null,
            counts ? h('span', { class: 'muted' }, counts) : null),
          topic.items.length ? h('ol', { class: 'kn-item-list' }, topic.items.map(item => agendaItemView(item, { live: agenda.live, votes: votes.get(item.itemId) || [] }))) : null));
      });
      container.append(noMatch);
      if (search && view.agendaSearch) filter();
      // "להמשך התקציר" only where the summary is really cut, which depends on the width.
      new ResizeObserver(() => {
        if (container.classList.contains('show-all')) return;
        for (const text of container.querySelectorAll('.kn-summary-text.is-long')) {
          const item = text.closest('.kn-item');
          if (!item.classList.contains('is-open') && text.clientHeight) item.classList.toggle('fits', text.scrollHeight <= text.clientHeight + 1);
        }
      }).observe(container);
      return container;
    }

    // While a sitting is on: the topic and the item being discussed, who is speaking and who's next.
    function nowPanel(agenda) {
      const items = agenda.topics.flatMap(topic => topic.items);
      const item = items.find(entry => entry.live);
      const topic = agenda.topics.find(entry => entry.live) || agenda.topics.find(entry => entry.items.includes(item));
      const active = items.filter(entry => entry.active);
      const done = active.filter(entry => entry.done).length;
      return h('div', { class: 'kn-now' },
        h('div', { class: 'kn-now-head' }, h('i', { class: 'kn-dot' }), h('b', null, 'המליאה עכשיו'), topic && topic.title ? h('span', null, topic.title) : null),
        item ? h('p', { class: 'kn-now-item' }, `${item.letter ? `${item.letter}. ` : ''}${item.name}`) : null,
        agenda.current ? h('p', null, h('span', { class: 'muted' }, 'על הדוכן: '), agenda.current, agenda.next ? [h('span', { class: 'muted' }, ' · הבא בתור: '), agenda.next] : null) : null,
        active.length ? h('p', { class: 'muted' }, `${done} מתוך ${active.length} סעיפים נדונו`) : null,
        h('div', { class: 'kn-card-actions' },
          button('צפייה בשידור חי', watchPlenum, 'kn-btn live'),
          item ? button('לסעיף שבדיון', () => main.querySelector(`.kn-item[data-key="${CSS.escape(item.key)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })) : null));
    }

    // The sittings, newest first, with the next one when the open data doesn't list it yet.
    function sittingsWithNext(sessions, next) {
      const list = sessions.slice();
      const date = next && toDate(next.NextSessionDate);
      if (date && next.NextSessionItemId && !list.some(session => session.Id === next.NextSessionItemId)) {
        list.push({ Id: next.NextSessionItemId, StartDate: next.NextSessionDate, planned: true });
      }
      return list.sort((a, b) => toDate(b.StartDate) - toDate(a.StartDate));
    }

    // The sitting the page shows: the one chosen with the arrows; else today's, else the next one if
    // its agenda is out, else the last one.
    async function featuredSitting(sittings, now, force) {
      const chosen = view.plenumId ? sittings.find(session => session.Id === view.plenumId) : null;
      const upcoming = sittings.filter(session => toDate(session.StartDate) > now);
      const candidates = chosen ? [chosen] : [...new Set([
        sittings.find(session => sameDay(toDate(session.StartDate), now)),
        upcoming[upcoming.length - 1],
        sittings.find(session => toDate(session.StartDate) <= now && !sameDay(toDate(session.StartDate), now)),
      ].filter(Boolean))];
      let first = null;
      for (const sitting of candidates) {
        try {
          const agenda = await loadSitting(sitting, force);
          if (hasAgenda(agenda)) return { sitting, agenda };
          first = first || { sitting, agenda };
        } catch (error) {
          first = first || { sitting, agenda: null, error };
        }
      }
      return first || { sitting: null, agenda: null };
    }

    async function renderPlenum(force) {
      const [sessions, next, knesset] = await Promise.all([loadPlenumSessions(force), loadNextPlenum(force).catch(() => null), loadKnesset()]);
      const now = new Date();
      const sittings = sittingsWithNext(sessions, next);
      const { sitting, agenda, error } = await featuredSitting(sittings, now, force);
      const start = sitting && toDate(sitting.StartDate);
      const votes = sitting && !sitting.planned && start <= now ? await loadSittingVotes(sitting, force).catch(() => []) : [];
      view.plenumLive = Boolean(agenda && agenda.live);
      const fragment = h('div', { class: 'kn-page' });
      fragment.append(explain('המליאה היא כל 120 חברי הכנסת יחד: כאן מצביעים על חוקים, שואלים את השרים ומעלים נושאים לדיון. סדר היום מפרט כל סעיף: מי הגיש, מה מוצע, מה עמדת הממשלה ומי מציג ומשיב.'));
      if (agenda && agenda.live) fragment.append(nowPanel(agenda));
      if (sitting) {
        const ordered = sittings.slice().reverse();
        const index = ordered.indexOf(sitting);
        const earlier = index > 0 ? ordered[index - 1] : null;
        const later = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;
        const go = target => {
          view.plenumId = target ? target.Id : null;
          view.agendaSearch = '';
          render();
        };
        const status = agenda && agenda.live ? badge('מתקיימת עכשיו', 'live')
          : sitting.FinishDate || (agenda && agenda.finish) ? badge('הסתיימה', 'done')
            : start > now ? badge('מתוכננת', 'muted') : null;
        // Shown instead of a next sitting whose agenda isn't out yet.
        const nextSitting = !view.plenumId && start < startOfDay(now) && later && toDate(later.StartDate) > now ? toDate(later.StartDate) : null;
        fragment.append(h('section', { class: 'kn-section kn-featured', 'data-session': String(sitting.Id) },
          h('div', { class: 'kn-featured-head' },
            h('h3', null, `סדר היום · ${dayLabel(start, now)}, ${shortDate(start)}, ${time(start)}`),
            status,
            sitting.Number ? h('span', { class: 'muted' }, `ישיבה ${sitting.Number}${sitting.KnessetNum && sitting.KnessetNum !== knesset.number ? ` של הכנסת ה-${sitting.KnessetNum}` : ''}`) : null),
          h('div', { class: 'kn-sitting-nav' },
            earlier ? button('→ הישיבה הקודמת', () => go(earlier), 'kn-btn small') : null,
            later ? button('הישיבה הבאה ←', () => go(later), 'kn-btn small') : null,
            view.plenumId ? button('לישיבה הנוכחית', () => go(null), 'kn-btn small') : null),
          nextSitting ? h('p', { class: 'muted' }, `הישיבה הבאה: ${dayLabel(nextSitting, now)}, ${shortDate(nextSitting)}, בשעה ${time(nextSitting)}. סדר היום שלה עדיין לא פורסם.`) : null,
          hasAgenda(agenda)
            ? [agenda.count ? explain('"מנמק" מציג את ההצעה ומסביר אותה; "משיב" עונה בשם הממשלה או הוועדה. "בתמיכת הממשלה" – ועדת השרים לחקיקה החליטה לתמוך בהצעה, ובדרך כלל גם הקואליציה מצביעה בעדה.') : null,
              agendaView(agenda, { votes: votesByItem(votes), search: agenda.count > 5 })]
            : error ? problem(error, () => render({ force: true }))
              : empty(start > now ? 'סדר היום של הישיבה הזאת עדיין לא פורסם.' : 'לא פורסם סדר יום לישיבה הזאת.'),
          h('div', { class: 'kn-card-actions' },
            sitting.planned ? null : button('פרטי הישיבה: הצבעות ומסמכים', () => openPlenum(sitting), 'kn-btn small'),
            externalLink(agendaUrl(start), 'סדר היום באתר הכנסת'))));
      }
      fragment.append(section('ישיבות המליאה', h('ul', { class: 'kn-agenda kn-sittings' }, sittings.map(session => {
        const date = toDate(session.StartDate);
        const ongoing = date <= now && !session.FinishDate && sameDay(date, now);
        return h('li', { class: session.planned ? 'is-planned' : null }, h('button', { type: 'button', class: 'kn-row-btn', onclick: () => openPlenum(session) },
          h('b', null, `${dayLabel(date, now)} · ${shortDate(date)} ${time(date)}`),
          h('span', null, session.planned ? 'הישיבה הבאה' : `ישיבה ${session.Number || ''}${session.KnessetNum && session.KnessetNum !== knesset.number ? ` של הכנסת ה-${session.KnessetNum}` : ''}${session.IsSpecialMeeting ? ' (ישיבה מיוחדת)' : ''}`),
          ongoing ? badge('מתקיימת', 'live') : date > now ? badge('מתוכננת', 'muted') : null));
      }))));
      fragment.append(h('p', { class: 'kn-note' }, externalLink(`${SITE}/apps/plenum`, 'סדר היום של המליאה באתר הכנסת'), ' ', externalLink(`${SITE}/apps/smartprotocol/search`, 'דברי הכנסת')));
      return fragment;
    }

    function openPlenum(session) {
      const start = toDate(session.StartDate);
      openDetail(`ישיבת המליאה · ${shortDate(start)}`, async () => {
        const [agenda, items, docs, votes, statuses] = await Promise.all([
          loadSitting(session).catch(() => null),
          odata(`KNS_PlmSessionItem?$filter=PlenumSessionID eq ${session.Id}&$orderby=Ordinal&$select=ItemID,ItemTypeID,ItemTypeDesc,Ordinal,Name,StatusID,IsDiscussion`, 4).catch(() => []),
          odata(`KNS_DocumentPlenumSession?$filter=PlenumSessionID eq ${session.Id}&$select=GroupTypeDesc,ApplicationDesc,FilePath`, 1).catch(() => []),
          loadSittingVotes(session).catch(() => []),
          loadStatuses().catch(() => new Map()),
        ]);
        const now = new Date();
        const finish = toDate(session.FinishDate) || (agenda && agenda.finish);
        const discussed = items.filter(item => item.IsDiscussion);
        const tabled = items.filter(item => !item.IsDiscussion);
        const byType = list => {
          const groups = new Map();
          for (const item of list) {
            const type = clean(item.ItemTypeDesc) || ITEM_TYPES[item.ItemTypeID] || 'נושאים';
            if (!groups.has(type)) groups.set(type, []);
            groups.get(type).push(item);
          }
          return [...groups].map(([type, group]) => h('div', { class: 'kn-group' }, h('h4', null, `${type} (${group.length})`),
            h('ol', { class: 'kn-items' }, group.map(item => h('li', null, clean(item.Name),
              item.ItemTypeID === 2 ? button('שלבי החקיקה', () => openBill({ Id: item.ItemID, Name: item.Name, StatusID: item.StatusID }), 'kn-btn small') : null,
              statuses.get(item.StatusID) && item.ItemTypeID === 2 ? h('span', { class: 'muted' }, ` · ${statuses.get(item.StatusID)}`) : null)))));
        };
        const onAir = agenda ? agenda.live : sameDay(start, now) && start <= now && !finish;
        return h('div', { class: 'kn-stack' },
          h('p', { class: 'kn-big' }, `${dayLabel(start)}, ${shortDate(start)}, בשעה ${time(start)}${finish ? ` – ${time(finish)}` : ''}`),
          onAir ? h('div', { class: 'kn-card-actions' }, button('צפייה בשידור חי', watchPlenum, 'kn-btn live')) : null,
          hasAgenda(agenda)
            ? section('סדר היום', agendaView(agenda, { votes: votesByItem(votes) }))
            : section('נדונו בישיבה', discussed.length ? byType(discussed) : empty(start > now ? 'סדר היום עדיין לא פורסם.' : 'לא פורסם סדר יום לדיון.')),
          tabled.length ? section(`הונחו על שולחן הכנסת (${tabled.length})`, explain('"הנחה" היא פרסום רשמי לכל חברי הכנסת – עדיין לא דיון. הצעות חוק פרטיות מונחות כך לפני הקריאה הטרומית.'), h('details', { class: 'kn-more' }, h('summary', null, 'להציג את כולן'), byType(tabled))) : null,
          votes.length ? section(`הצבעות (${votes.length})`, h('ul', { class: 'kn-agenda' }, votes.map(vote => h('li', null,
            h('button', { type: 'button', class: 'kn-row-btn', onclick: () => openVote(vote) }, h('b', null, time(toDate(vote.VoteDateTime))), h('span', null, clean(vote.VoteTitle), vote.VoteSubject ? h('span', { class: 'muted' }, ` – ${clean(vote.VoteSubject)}`) : null)))))) : null,
          docs.length ? section('מסמכים', h('ul', { class: 'kn-docs' }, docs.map(doc => h('li', null, externalLink(doc.FilePath, `${clean(doc.GroupTypeDesc)} (${doc.ApplicationDesc})`))))) : null,
          externalLink(agendaUrl(start), 'סדר היום באתר הכנסת'));
      });
    }

    /* ---------- Calendar ---------- */

    const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

    // Whether the Knesset works on a day: '' (in session, or not known), 'recess', or 'between'
    // (after one Knesset's last session and before the next one is sworn in).
    function workState(date, periods) {
      if (!periods.length) return '';
      const day = startOfDay(date);
      if (day < startOfDay(periods[0].start)) return '';
      if (periods.some(period => day >= startOfDay(period.start) && (!period.finish || day <= startOfDay(period.finish)))) return '';
      const before = periods.filter(period => period.finish && startOfDay(period.finish) < day).pop();
      const after = periods.find(period => startOfDay(period.start) > day);
      return before && after && after.knesset !== before.knesset ? 'between' : 'recess';
    }

    function calendarCell(date, data, now) {
      const info = data.days.get(dayKey(date)) || { sittings: [], sessions: [], holidays: [] };
      const sessions = info.sessions.filter(session => session.StatusID !== 193).length;
      const sitting = info.sittings[0];
      const state = workState(date, data.periods);
      const hebrew = hebrewOf(date);
      const today = sameDay(date, now);
      const selected = Boolean(view.calDay) && sameDay(view.calDay, date);
      const label = [
        fullDayFormat.format(date),
        hebrew ? `${hebrewNumber(hebrew.day)} ב${hebrew.month}` : '',
        ...info.holidays,
        sitting ? `ישיבת מליאה בשעה ${time(toDate(sitting.StartDate))}` : '',
        sessions ? count(sessions, 'דיון אחד בוועדות', 'דיונים בוועדות') : '',
        state === 'recess' ? 'פגרה' : state === 'between' ? 'בין כנסות' : '',
      ].filter(Boolean).join(', ');
      const classes = ['kn-cal-day', today ? 'is-today' : '', selected ? 'is-selected' : '', date.getDay() >= 5 ? 'is-weekend' : '', state ? 'is-recess' : '',
        sitting ? 'has-plenum' : '', sessions ? 'has-cmt' : '', info.holidays.length ? 'has-holiday' : ''];
      return h('button', {
        type: 'button', class: classes.filter(Boolean).join(' '), 'data-day': dayKey(date), 'aria-pressed': String(selected),
        'aria-current': today ? 'date' : null, 'aria-label': label, tabindex: selected ? '0' : '-1',
      },
        h('span', { class: 'kn-cal-top' },
          h('span', { class: 'kn-cal-num' }, String(date.getDate())),
          hebrew ? h('span', { class: 'kn-cal-heb' }, `${hebrewNumber(hebrew.day)}${hebrew.day === 1 ? ` ${hebrew.month}` : ''}`) : null),
        sitting ? h('span', { class: 'kn-cal-plenum' }, h('span', { class: 'kn-cal-words' }, 'מליאה '), time(toDate(sitting.StartDate))) : null,
        sessions ? h('span', { class: 'kn-cal-cmt' }, h('b', null, String(sessions)), h('span', { class: 'kn-cal-words' }, ' בוועדות')) : null,
        info.holidays.length ? h('span', { class: 'kn-cal-holiday', title: info.holidays.join(', ') }, info.holidays[0]) : null);
    }

    // A plenum sitting on the chosen day: its topics (loaded with the sitting's agenda) and links.
    function calendarSittingCard(sitting, now) {
      const start = toDate(sitting.StartDate);
      const topics = h('div', { class: 'kn-cal-topics' }, h('p', { class: 'muted' }, 'טוען את סדר היום…'));
      const title = h('div', { class: 'kn-card-title' },
        h('span', { class: 'kn-kind plenum' }, 'מליאה'),
        h('strong', null, sitting.Number ? `ישיבה ${sitting.Number}` : 'ישיבת המליאה'),
        sitting.planned || start > now ? badge('מתוכננת', 'muted') : null,
        sitting.votes ? h('span', { class: 'muted' }, count(sitting.votes, 'הצבעה אחת', 'הצבעות')) : null);
      const actions = h('div', { class: 'kn-card-actions' },
        button('סדר היום המלא', () => openPlenum(sitting)),
        externalLink(agendaUrl(start), 'באתר הכנסת'));
      const card = h('article', { class: 'kn-card kn-session kn-plenum' },
        h('div', { class: 'kn-when' }, h('b', null, time(start))),
        h('div', { class: 'kn-what' }, title, topics, actions));
      loadSitting(sitting).then(agenda => {
        if (agenda.live) {
          card.classList.add('is-live');
          title.append(badge('מתקיימת עכשיו', 'live'));
          actions.prepend(button('צפייה בשידור חי', watchPlenum, 'kn-btn live'));
        }
        topics.replaceChildren(agenda.topics.length
          ? h('ol', { class: 'kn-items' }, agenda.topics.map(topic => {
            const counts = topicCounts(topic);
            return h('li', { class: agenda.live && topic.live ? 'is-now' : null }, topic.title || 'נושא',
              counts ? h('span', { class: 'muted' }, ` · ${counts}`) : null,
              agenda.live && topic.live ? badge('עכשיו', 'live') : null);
          }))
          : h('p', { class: 'muted' }, start > now ? 'סדר היום עדיין לא פורסם.' : 'לא פורסם סדר יום.'));
      }).catch(() => topics.replaceChildren(h('p', { class: 'muted' }, 'סדר היום לא נטען. אפשר לנסות שוב ברענון.')));
      return card;
    }

    function calendarSessionRow(session, now, liveNames) {
      const [stateText, stateClass] = sessionState(session, now, liveNames);
      const first = sessionItems(session)[0];
      return h('li', { class: session.StatusID === 193 ? 'is-cancelled' : null },
        h('button', { type: 'button', class: 'kn-row-btn', onclick: () => openSession(session) },
          h('b', null, time(toDate(session.StartDate))),
          h('span', null, h('strong', null, session.KNS_Committee ? session.KNS_Committee.Name : 'ועדה'), first ? ` – ${clean(first.Name)}` : ''),
          session.StatusID === 193 ? badge('בוטלה', 'cancelled') : stateClass === 'live' ? badge(stateText, 'live') : session.TypeDesc === 'חסויה' ? badge('חסויה', 'muted') : null));
    }

    // The chosen day under the month: holidays, recess, the plenum sitting with its topics, and the
    // committee sessions with their first agenda item (asked for once the day is chosen).
    function paintDay(panel, date, data, now, liveNames) {
      const info = data.days.get(dayKey(date)) || { sittings: [], sessions: [], holidays: [] };
      const state = workState(date, data.periods);
      const list = h('div', { class: 'kn-cal-sessions' });
      const sessionsView = sessions => (sessions.length
        ? [h('h4', null, `דיונים בוועדות (${sessions.length})`), h('ul', { class: 'kn-agenda kn-cal-list' }, sessions.map(session => calendarSessionRow(session, now, liveNames)))]
        : info.sittings.length ? [] : [empty(date.getDay() >= 5 ? 'סוף השבוע: אין דיונים.' : 'אין דיונים ביום הזה.')]);
      list.replaceChildren(...sessionsView(info.sessions));
      panel.replaceChildren();
      fill(panel,
        h('div', { class: 'kn-cal-panel-head' },
          h('h3', null, fullDayFormat.format(date)),
          sameDay(date, now) ? badge('היום') : null,
          h('span', { class: 'muted' }, [hebrewDate(date), ...info.holidays].filter(Boolean).join(' · '))),
        state === 'recess' ? explain('הכנסת בפגרה: המליאה לא מתכנסת, אבל ועדות יכולות להמשיך לעבוד.') : null,
        state === 'between' ? explain('בין כנסות: הכנסת הקודמת סיימה את עבודתה והכנסת החדשה עוד לא הושבעה. בתקופה הזאת מתקיימות הבחירות.') : null,
        info.sittings.map(sitting => calendarSittingCard(sitting, now)),
        list);
      if (info.sessions.length) {
        loadDaySessions(date).then(rows => {
          if (list.isConnected && view.calDay && sameDay(view.calDay, date) && rows.length) list.replaceChildren(...sessionsView(rows));
        }).catch(() => {});
      }
    }

    // A month at a glance: every day with its plenum sitting, the number of committee sessions,
    // holidays and recess. Choosing a day shows it in full below.
    async function renderCalendar(force) {
      const now = new Date();
      const month = view.calMonth || new Date(now.getFullYear(), now.getMonth(), 1);
      const year = month.getFullYear();
      const index = month.getMonth();
      const thisMonth = now.getFullYear() === year && now.getMonth() === index;
      const [data, siteCommittees] = await Promise.all([loadMonth(year, index, force), loadSiteCommittees(force).catch(() => [])]);
      const liveNames = liveCommitteeNames(siteCommittees);
      if (!view.calDay || view.calDay.getFullYear() !== year || view.calDay.getMonth() !== index) {
        view.calDay = thisMonth ? startOfDay(now) : new Date(year, index, 1);
      }
      const move = (target, day = null, focus = false) => {
        view.calMonth = new Date(target.getFullYear(), target.getMonth(), 1);
        view.calDay = day;
        view.calFocus = focus;
        render();
      };
      const fragment = h('div', { class: 'kn-page kn-calendar' });
      fragment.append(h('div', { class: 'kn-cal-head' },
        h('button', { type: 'button', class: 'kn-btn kn-cal-move', title: 'החודש הקודם', 'aria-label': 'החודש הקודם', onclick: () => move(new Date(year, index - 1, 1)) }, '→'),
        h('div', { class: 'kn-cal-title' }, h('h3', null, monthFormat.format(month)), h('span', { class: 'muted' }, hebrewMonthRange(year, index))),
        h('button', { type: 'button', class: 'kn-btn kn-cal-move', title: 'החודש הבא', 'aria-label': 'החודש הבא', onclick: () => move(new Date(year, index + 1, 1)) }, '←'),
        thisMonth ? null : button('לחודש הנוכחי', () => move(now, startOfDay(now)), 'kn-btn small')));
      fragment.append(h('p', { class: 'kn-cal-sum' }, [
        count(data.sittings, 'ישיבת מליאה אחת', 'ישיבות מליאה'),
        count(data.sessions - data.cancelled, 'דיון אחד בוועדות', 'דיונים בוועדות'),
        data.cancelled ? count(data.cancelled, 'דיון אחד בוטל', 'דיונים בוטלו') : '',
        data.votes ? count(data.votes, 'הצבעה אחת במליאה', 'הצבעות במליאה') : '',
      ].filter(Boolean).join(' · ')));
      fragment.append(h('ul', { class: 'kn-cal-legend', 'aria-label': 'מקרא' },
        h('li', null, h('i', { class: 'plenum' }), 'ישיבת מליאה'),
        h('li', null, h('i', { class: 'cmt' }), 'דיונים בוועדות'),
        h('li', null, h('i', { class: 'holiday' }), 'חג או מועד'),
        h('li', null, h('i', { class: 'recess' }), 'פגרה')));

      const grid = h('div', { class: 'kn-cal', role: 'group', 'aria-label': monthFormat.format(month) });
      for (const name of WEEKDAYS) grid.append(h('div', { class: 'kn-cal-wd', 'aria-hidden': 'true' }, name));
      for (let i = 0; i < month.getDay(); i++) grid.append(h('div', { class: 'kn-cal-pad', 'aria-hidden': 'true' }));
      for (let date = new Date(year, index, 1); date.getMonth() === index; date = new Date(year, index, date.getDate() + 1)) {
        grid.append(calendarCell(date, data, now));
      }
      const panel = h('section', { class: 'kn-section kn-cal-panel' });
      const choose = (date, focus) => {
        view.calDay = date;
        for (const cell of grid.querySelectorAll('.kn-cal-day')) {
          const on = cell.dataset.day === dayKey(date);
          cell.classList.toggle('is-selected', on);
          cell.setAttribute('aria-pressed', String(on));
          cell.tabIndex = on ? 0 : -1;
          if (on && focus) cell.focus();
        }
        paintDay(panel, date, data, now, liveNames);
      };
      grid.addEventListener('click', event => {
        const cell = event.target.closest('.kn-cal-day');
        if (!cell) return;
        const [y, m, d] = cell.dataset.day.split('-').map(Number);
        choose(new Date(y, m - 1, d), false);
        // On a phone the day is below the month: bring it into sight.
        if (panel.getBoundingClientRect().top > main.getBoundingClientRect().bottom - 120) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      grid.addEventListener('keydown', event => {
        if (!event.target.closest('.kn-cal-day')) return;
        // Right to left: the left arrow is the next day.
        const step = { ArrowLeft: 1, ArrowRight: -1, ArrowDown: 7, ArrowUp: -7 }[event.key];
        if (!step) return;
        event.preventDefault();
        const date = new Date(view.calDay.getFullYear(), view.calDay.getMonth(), view.calDay.getDate() + step);
        if (date.getFullYear() === year && date.getMonth() === index) choose(date, true);
        else move(date, date, true);
      });
      fragment.append(h('div', { class: 'kn-cal-wrap' }, grid), panel);
      paintDay(panel, view.calDay, data, now, liveNames);
      if (view.calFocus) {
        view.calFocus = false;
        requestAnimationFrame(() => grid.querySelector('.kn-cal-day.is-selected')?.focus());
      }
      return fragment;
    }

    /* ---------- Votes ---------- */

    async function renderVotes(force) {
      const [votes, knesset] = await Promise.all([loadVotes(force), loadKnesset()]);
      const fragment = h('div', { class: 'kn-page' });
      fragment.append(explain('כל הצבעה במליאה, מהאחרונה. בחרו הצבעה כדי לראות את התוצאה ואיך הצביע כל חבר כנסת. "נמנע (נוכח)" – השתתף ולא הצביע בעד או נגד.'));
      const now = new Date();
      let lastDay = '';
      const list = h('ul', { class: 'kn-agenda kn-votes' });
      for (const vote of votes) {
        const date = toDate(vote.VoteDateTime);
        const day = shortDate(date);
        if (day !== lastDay) {
          list.append(h('li', { class: 'kn-day-head' }, `${dayLabel(date, now)} · ${day}`));
          lastDay = day;
        }
        list.append(h('li', null, h('button', { type: 'button', class: 'kn-row-btn', onclick: () => openVote(vote) },
          h('b', null, time(date)),
          h('span', null, clean(vote.VoteTitle), vote.VoteSubject ? h('span', { class: 'muted' }, ` – ${clean(vote.VoteSubject)}`) : null),
          vote.IsNoConfidenceInGov ? badge('אי-אמון', 'warn') : null,
          h('span', { class: 'muted' }, clean(vote.VoteMethodDesc)))));
      }
      fragment.append(section(`הצבעות אחרונות · הכנסת ה-${knesset.number}`, votes.length ? list : empty('עדיין אין הצבעות.')));
      fragment.append(h('p', { class: 'kn-note' }, externalLink(`${SITE}/Activity/plenum/Votes/Pages/default.aspx`, 'חיפוש הצבעות באתר הכנסת')));
      return fragment;
    }

    function openVote(vote) {
      openDetail('הצבעה במליאה', async () => {
        const details = await site(`Votes/GetVoteDetails/${vote.Id}`);
        const header = (details.VoteHeader || [])[0] || {};
        const results = Array.isArray(details.VoteDetails) ? details.VoteDetails : [];
        const tally = { 7: 0, 8: 0, 6: 0 };
        for (const row of results) if (tally[row.VoteResultId] !== undefined) tally[row.VoteResultId]++;
        const total = tally[7] + tally[8] + tally[6];
        const factions = new Map();
        for (const row of results) {
          const name = clean(row.FactionName) || 'ללא סיעה';
          if (!factions.has(name)) factions.set(name, []);
          factions.get(name).push(row);
        }
        const bar = h('div', { class: 'kn-vote-bar', role: 'img', 'aria-label': `בעד ${tally[7]}, נגד ${tally[8]}, נמנעים ${tally[6]}` },
          [7, 8, 6].map(code => tally[code] ? h('i', { class: VOTE_RESULTS[code][1], style: `flex:${tally[code]}` }) : null));
        return h('div', { class: 'kn-stack' },
          h('p', { class: 'kn-big' }, clean(header.ItemTitle) || clean(vote.VoteTitle)),
          vote.VoteSubject ? h('p', null, clean(vote.VoteSubject)) : null,
          h('p', { class: 'muted' }, [header.VoteDateStr || shortDate(toDate(vote.VoteDateTime)), header.VoteTimeStr, clean(header.VoteType), header.ChairmanName ? `ניהל: ${clean(header.ChairmanName)}` : ''].filter(Boolean).join(' · ')),
          header.AcceptedText ? h('p', { class: `kn-verdict ${header.IsForAccepted ? 'yes' : 'no'}` }, clean(header.AcceptedText), header.Decision ? h('span', { class: 'muted' }, ` (${clean(header.Decision)})`) : null) : null,
          total ? h('div', { class: 'kn-tally' }, bar, h('p', null, h('b', { class: 'for' }, `${tally[7]} בעד`), ' · ', h('b', { class: 'against' }, `${tally[8]} נגד`), ' · ', h('b', { class: 'abstain' }, `${tally[6]} נמנעים`))) : empty('תוצאות ההצבעה טרם פורסמו.'),
          (details.DescreetVoteResults || []).length ? explain('הצבעה חשאית: פורסמו רק הסיכומים.') : null,
          factions.size ? section('לפי סיעות', h('div', { class: 'kn-factions-votes' }, [...factions].sort((a, b) => b[1].length - a[1].length).map(([name, rows]) => h('details', { class: 'kn-more' },
            h('summary', null, h('span', null, name), h('span', { class: 'kn-mini-tally' }, [7, 8, 6].map(code => {
              const n = rows.filter(row => row.VoteResultId === code).length;
              return n ? h('b', { class: VOTE_RESULTS[code][1] }, `${n} ${VOTE_RESULTS[code][0].split(' ')[0]}`) : null;
            }))),
            h('ul', { class: 'kn-names' }, rows.map(row => h('li', { class: (VOTE_RESULTS[row.VoteResultId] || ['', ''])[1] }, clean(row.MkName), h('span', { class: 'muted' }, ` – ${clean(row.Title)}`)))))))) : null,
          externalLink(`${SITE}/Activity/plenum/Votes/Pages/default.aspx`, 'ההצבעות באתר הכנסת'));
      });
    }

    /* ---------- Legislation ---------- */

    function billProgress(statusId, subType) {
      const stages = GUIDE.stages.filter(stage => !stage.privateOnly || subType === 'פרטית' || !subType);
      const index = stages.findIndex(stage => stage.statuses.includes(statusId));
      return { stages, index, ending: GUIDE.endings[statusId] || '' };
    }

    function progressBar(statusId, subType) {
      const { stages, index, ending } = billProgress(statusId, subType);
      return h('ol', { class: `kn-progress${ending ? ' is-stopped' : ''}`, 'aria-label': index >= 0 ? `שלב: ${stages[index].title}` : 'שלב לא ידוע' },
        stages.map((stage, i) => h('li', { class: i < index ? 'done' : i === index ? 'now' : '', title: stage.title }, stage.label)));
    }

    function stageFilterOf(statusId, subType) {
      const { stages, index, ending } = billProgress(statusId, subType);
      if (ending) return 'stopped';
      return index >= 0 ? stages[index].id : 'other';
    }

    async function renderBills(force) {
      const [bills, laws, statuses, knesset] = await Promise.all([loadBills(force), loadLaws(force).catch(() => []), loadStatuses().catch(() => new Map()), loadKnesset()]);
      const fragment = h('div', { class: 'kn-page' });
      fragment.append(section('איך חוק נחקק', explain('כל הצעת חוק עוברת שלוש קריאות במליאה, ובין לבין עבודה בוועדה. הצעה פרטית של חבר כנסת עוברת לפני כן גם קריאה טרומית.'),
        h('ol', { class: 'kn-steps' }, GUIDE.stages.map(stage => h('li', null, h('b', null, stage.title), h('span', null, stage.text)))),
        button('עוד במדריך', () => setTab('guide'), 'kn-btn small')));

      // Bills in the current Knesset, newest change first, filtered by stage or words.
      const filters = [['all', 'הכול'], ...GUIDE.stages.map(stage => [stage.id, stage.title]), ['stopped', 'נעצרו או מוזגו']];
      const counts = new Map();
      for (const bill of bills) {
        const key = stageFilterOf(bill.StatusID, bill.SubTypeDesc);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const list = h('ul', { class: 'kn-bills' });
      const search = h('input', { type: 'search', class: 'kn-search', placeholder: 'חיפוש בשמות ההצעות', value: view.billSearch, 'aria-label': 'חיפוש הצעות חוק' });
      const chips = h('div', { class: 'kn-chips', role: 'toolbar', 'aria-label': 'סינון לפי שלב' });
      const paint = () => {
        const words = normalizeName(view.billSearch).split(' ').filter(Boolean);
        const shown = bills.filter(bill => (view.billFilter === 'all' || stageFilterOf(bill.StatusID, bill.SubTypeDesc) === view.billFilter)
          && words.every(word => normalizeName(bill.Name).includes(word)));
        list.replaceChildren(...shown.slice(0, 150).map(bill => h('li', null, h('button', { type: 'button', class: 'kn-bill', onclick: () => openBill(bill) },
          h('span', { class: 'kn-bill-title' }, clean(bill.Name)),
          h('span', { class: 'muted' }, [bill.SubTypeDesc ? `הצעה ${clean(bill.SubTypeDesc)}` : '', bill.PrivateNumber ? `פ/${bill.PrivateNumber}/${knesset.number}` : '', statuses.get(bill.StatusID) || '', `עודכנה ${shortDate(toDate(bill.LastUpdatedDate))}`].filter(Boolean).join(' · ')),
          progressBar(bill.StatusID, bill.SubTypeDesc)))));
        if (!shown.length) list.replaceChildren(h('li', null, empty('אין הצעות שמתאימות לסינון.')));
        for (const chip of chips.children) chip.setAttribute('aria-pressed', String(chip.dataset.filter === view.billFilter));
      };
      for (const [id, label] of filters) {
        if (id !== 'all' && !counts.get(id)) continue;
        chips.append(h('button', { type: 'button', class: 'chip', 'data-filter': id, onclick: () => { view.billFilter = id; paint(); } }, label, h('span', { class: 'chip-count' }, String(id === 'all' ? bills.length : counts.get(id)))));
      }
      search.addEventListener('input', () => {
        view.billSearch = search.value;
        paint();
      });
      paint();
      fragment.append(section(`הצעות חוק בכנסת ה-${knesset.number} (${bills.length})`, h('div', { class: 'kn-toolbar' }, search), chips, list));

      fragment.append(section('חוקים שהתקבלו לאחרונה', laws.length ? h('ul', { class: 'kn-laws' }, laws.map(law => h('li', null,
        h('button', { type: 'button', class: 'kn-bill', onclick: () => openBill({ ...law, StatusID: 118 }) },
          h('span', { class: 'kn-bill-title' }, clean(law.Name)),
          h('span', { class: 'muted' }, [law.SubTypeDesc ? `הצעה ${clean(law.SubTypeDesc)}` : '', law.PublicationDate ? `פורסם ${shortDate(toDate(law.PublicationDate))}` : '', law.KnessetNum ? `הכנסת ה-${law.KnessetNum}` : ''].filter(Boolean).join(' · ')),
          law.SummaryLaw ? h('span', { class: 'kn-summary' }, clean(law.SummaryLaw)) : null)))) : empty('לא נמצאו חוקים.'),
        externalLink(`${SITE}/apps/legislation/main/home`, 'מאגר החקיקה הלאומי')));
      return fragment;
    }

    function openBill(bill) {
      openDetail('הצעת חוק', async () => {
        // A bill opened from the plenum's agenda comes without its stage: the open data has it.
        const [data, statuses, row] = await Promise.all([
          site(`LegislationItem/GetLegislationBillItem?ItemId=${bill.Id}`),
          loadStatuses().catch(() => new Map()),
          bill.StatusID == null ? odata(`KNS_Bill?$filter=Id eq ${bill.Id}&$select=StatusID,SubTypeDesc`, 1).then(rows => rows[0] || null).catch(() => null) : null,
        ]);
        const general = data.general || {};
        const subType = clean(general.SubType) || clean(bill.SubTypeDesc) || clean(row && row.SubTypeDesc);
        const statusId = bill.StatusID ?? (row ? row.StatusID : undefined);
        const { stages, index, ending } = billProgress(statusId, subType);
        const sessions = (data.sessionAndDocs && data.sessionAndDocs.Sessions) || [];
        const docs = data.sessionAndDocs ? [...(data.sessionAndDocs.DraftLaws || []), ...(data.sessionAndDocs.DocumentsAccompanyingBills || []), ...(data.sessionAndDocs.LegalDocuments || []), ...(data.sessionAndDocs.GovernmentDocuments || [])] : [];
        return h('div', { class: 'kn-stack' },
          h('p', { class: 'kn-big' }, clean(general.Name) || clean(bill.Name)),
          h('p', { class: 'muted' }, [subType ? `הצעה ${subType}` : '', clean(general.PrivateNumber), general.Knesset ? `הכנסת ה-${general.Knesset}` : ''].filter(Boolean).join(' · ')),
          GUIDE.billTypes[subType] ? explain(GUIDE.billTypes[subType]) : null,
          section('איפה ההצעה עומדת', progressBar(statusId, subType),
            h('p', { class: 'kn-prose' }, h('b', null, clean(general.Status) || statuses.get(statusId) || ''), general.ImageAlt ? ` – ${clean(general.ImageAlt)}` : ''),
            ending ? explain(ending) : index >= 0 ? explain(stages[index].text) : null,
            index >= 0 && index < stages.length - 1 && !ending ? h('p', { class: 'muted' }, `השלב הבא: ${stages[index + 1].title}`) : null),
          clean(general.Initiators) ? section('יוזמים', h('p', { class: 'kn-prose' }, clean(general.Initiators))) : null,
          clean(general.CommitteeName) ? section('הוועדה המטפלת', h('p', { class: 'kn-prose' }, clean(general.CommitteeName))) : null,
          clean(general.SummaryLaw) || clean(bill.SummaryLaw) ? section('תקציר החוק', h('p', { class: 'kn-prose' }, clean(general.SummaryLaw) || clean(bill.SummaryLaw))) : null,
          sessions.length ? section('הדרך עד כה', h('ol', { class: 'kn-path' }, sessions.map(step => h('li', null,
            h('b', null, `${clean(step.SessionDate)} `), clean(step.StepTitle), h('span', { class: 'muted' }, ` · ${clean(step.Location)}`),
            step.BroadcastUrl ? button('הקלטה', () => playVideo(step.BroadcastUrl, `${clean(step.Location)} · ${clean(step.SessionDate)}`), 'kn-btn small') : null,
            step.ProtocolUrl ? externalLink(step.ProtocolUrl, 'פרוטוקול') : null)))) : null,
          docs.length ? section('מסמכים', h('ul', { class: 'kn-docs' }, docs.map(doc => h('li', null, externalLink(String(doc.FilePath || '').replace(/\\/g, '/'), clean(doc.FileText) || 'מסמך'))))) : null,
          externalLink(`${SITE}/apps/legislation/main/bills/${bill.Id}`, 'דף ההצעה במאגר החקיקה'));
      });
    }

    /* ---------- MKs ---------- */

    function roleLines(roles, knessetNumber) {
      const lines = [];
      for (const role of roles) {
        if (POSITION_ROLES[role.PositionID]) lines.push(role.PositionID === 48 && role.FactionName ? `יו"ר סיעת ${clean(role.FactionName)}` : POSITION_ROLES[role.PositionID]);
        else if ([39, 57, 40, 59, 285079].includes(role.PositionID)) lines.push(clean(role.DutyDesc) || clean(role.GovMinistryName));
        else if (role.PositionID === 41 && role.KnessetNum === knessetNumber) lines.push(`יו"ר ${clean(role.CommitteeName)}`);
      }
      return [...new Set(lines.filter(Boolean))];
    }

    async function renderMks(force) {
      const { mks, knesset } = await loadMembers(force);
      const fragment = h('div', { class: 'kn-page' });
      const present = mks.filter(mk => mk.IsPresent).length;
      const factions = new Map();
      for (const mk of mks) {
        const name = clean(mk.FactionName);
        if (!factions.has(name)) factions.set(name, { name, count: 0, coalition: mk.IsCoalition });
        factions.get(name).count++;
      }
      const ordered = [...factions.values()].sort((a, b) => b.count - a.count);
      const anyCoalition = ordered.some(faction => faction.coalition);
      fragment.append(section(`הסיעות בכנסת ה-${knesset.number}`,
        explain(anyCoalition ? 'הקואליציה – הסיעות שתומכות בממשלה – מסומנת בכחול; האופוזיציה באפור. 61 מושבים הם רוב.' : 'עדיין לא הוקמה קואליציה: עד שממשלה חדשה תושבע, הסיעות מוצגות לפי גודלן.'),
        h('div', { class: 'kn-seats', role: 'img', 'aria-label': ordered.map(faction => `${faction.name}: ${faction.count}`).join(', ') },
          ordered.map((faction, i) => h('i', { class: faction.coalition ? 'coalition' : '', style: `flex:${faction.count};--hue:${(i * 47) % 360}`, title: `${faction.name}: ${faction.count}` }))),
        h('ul', { class: 'kn-faction-list' }, ordered.map((faction, i) => h('li', null, h('button', {
          type: 'button', class: `kn-faction${view.mkFaction === faction.name ? ' is-on' : ''}`, style: `--hue:${(i * 47) % 360}`,
          onclick: () => {
            view.mkFaction = view.mkFaction === faction.name ? 'all' : faction.name;
            render({ quiet: true });
          },
        }, h('i'), h('span', null, faction.name), h('b', null, String(faction.count))))))));

      const search = h('input', { type: 'search', class: 'kn-search', placeholder: 'חיפוש חבר כנסת', value: view.mkSearch, 'aria-label': 'חיפוש חבר כנסת' });
      const presentToggle = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: view.mkPresentOnly }), h('span', null, `רק מי שבבניין עכשיו (${present})`));
      const grid = h('ul', { class: 'kn-mk-grid' });
      const paint = () => {
        const words = normalizeName(view.mkSearch).split(' ').filter(Boolean);
        const shown = mks.filter(mk => (view.mkFaction === 'all' || clean(mk.FactionName) === view.mkFaction)
          && (!view.mkPresentOnly || mk.IsPresent)
          && words.every(word => normalizeName(`${mk.name} ${mk.FactionName}`).includes(word)))
          .sort((a, b) => a.Lastname.localeCompare(b.Lastname, 'he'));
        grid.replaceChildren(...shown.map(mk => {
          const roles = roleLines(mk.roles, knesset.number);
          return h('li', null, h('button', { type: 'button', class: 'kn-mk', onclick: () => openMk(mk) },
            h('span', { class: 'kn-photo' }, mk.ImagePath ? h('img', { src: mk.ImagePath, alt: '', loading: 'lazy' }) : null, mk.IsPresent ? h('i', { class: 'kn-here', title: 'בבניין הכנסת עכשיו' }) : null),
            h('strong', null, mk.name),
            h('span', { class: 'muted' }, clean(mk.FactionName)),
            roles.length ? h('span', { class: 'kn-role' }, roles.slice(0, 2).join(' · ')) : null));
        }));
        if (!shown.length) grid.replaceChildren(h('li', null, empty('אין חברי כנסת שמתאימים לחיפוש.')));
      };
      search.addEventListener('input', () => {
        view.mkSearch = search.value;
        paint();
      });
      presentToggle.querySelector('input').addEventListener('change', event => {
        view.mkPresentOnly = event.target.checked;
        paint();
      });
      paint();
      fragment.append(section(`חברי הכנסת (${mks.length}) · ${count(present, 'אחד בבניין עכשיו', 'בבניין עכשיו')}`,
        h('div', { class: 'kn-toolbar' }, search, presentToggle, view.mkFaction !== 'all' ? button(`ביטול הסינון: ${view.mkFaction}`, () => { view.mkFaction = 'all'; render({ quiet: true }); }, 'kn-btn small') : null),
        grid,
        h('p', { class: 'kn-note' }, externalLink(`${SITE}/mk/apps/mklobby/main/mks-attendance/all-mks-presences`, 'נוכחות חברי הכנסת באתר הכנסת'))));
      return fragment;
    }

    function openMk(mk) {
      openDetail(mk.name, async () => {
        const knesset = await loadKnesset();
        const activity = await site(`MKs/GetParlamentayActivity?mkId=${mk.MkId}&knessetId=${knesset.number}`).catch(() => null);
        const roles = roleLines(mk.roles, knesset.number);
        const committees = [...new Set(mk.roles.filter(role => [41, 42, 66, 67].includes(role.PositionID) && role.KnessetNum === knesset.number).map(role => `${clean(role.CommitteeName)}${role.PositionID === 41 ? ' (יו"ר)' : role.PositionID === 67 ? ' (ממלא מקום)' : ''}`))];
        const social = [['Facebook', mk.Facebook], ['X', mk.Twitter], ['Instagram', mk.Instegram], ['YouTube', mk.Youtube], ['אתר', mk.WebsiteUrl]].filter(([, url]) => url);
        const tally = (list, label) => (Array.isArray(list) ? h('li', null, h('b', null, String(list.length)), ` ${label}`) : null);
        return h('div', { class: 'kn-stack' },
          h('div', { class: 'kn-mk-head' },
            mk.ImagePath ? h('img', { src: mk.ImagePath, alt: '' }) : null,
            h('div', null,
              h('p', { class: 'kn-big' }, mk.name),
              h('p', null, clean(mk.FactionName)),
              mk.IsPresent ? badge('בבניין הכנסת עכשיו', 'live') : badge('לא בבניין עכשיו', 'muted'),
              mk.YearDate ? h('p', { class: 'muted' }, `שנת לידה ${mk.YearDate}`) : null)),
          roles.length ? section('תפקידים', h('ul', { class: 'kn-docs' }, roles.map(role => h('li', null, role)))) : null,
          committees.length ? section('ועדות', h('ul', { class: 'kn-docs' }, committees.map(name => h('li', null, name)))) : null,
          activity ? section(`פעילות בכנסת ה-${knesset.number}`, h('ul', { class: 'kn-counts' },
            tally(activity.PrivateBills, 'הצעות חוק'), tally(activity.PlenaryVotes, 'הצבעות'), tally(activity.Queries, 'שאילתות'), tally(activity.AgendaProposals, 'הצעות לסדר היום'))) : null,
          section('יצירת קשר', h('ul', { class: 'kn-docs' },
            mk.Email ? h('li', null, h('a', { class: 'kn-link', href: `mailto:${mk.Email}` }, mk.Email)) : null,
            mk.Phone ? h('li', null, `טלפון: ${clean(mk.Phone)}`) : null,
            social.map(([label, url]) => h('li', null, externalLink(url, label))))),
          externalLink(`${SITE}/mk/apps/mk/mk-personal-details/${mk.MkId}`, 'הדף של חבר הכנסת באתר הכנסת'));
      });
    }

    /* ---------- Government ---------- */

    async function renderGovernment(force) {
      const [{ positions, people, photoByPerson, knesset, mks }] = await Promise.all([loadMembers(force)]);
      const government = Math.max(0, ...positions.map(p => p.GovernmentNum || 0));
      const members = positions.filter(p => p.GovernmentNum === government && government);
      const fragment = h('div', { class: 'kn-page' });
      if (!members.length) {
        fragment.append(empty('לא נמצא מידע על הממשלה.'));
        return fragment;
      }
      const started = members.map(p => toDate(p.StartDate)).filter(Boolean).sort((a, b) => a - b)[0];
      // A new Knesset copies the sitting government's positions on its first day, and no MK is
      // in a coalition until a new government is sworn in: then it's a transitional government.
      const carriedOver = started && knesset.start && started - knesset.start < 3 * DAY_MS;
      const transitional = carriedOver || !mks.some(mk => mk.IsCoalition);
      fragment.append(section(`הממשלה ה-${government}`,
        transitional ? explain(`זו ממשלת מעבר: היא הושבעה בכנסת הקודמת וממשיכה לכהן עד שממשלה חדשה תקבל את אמון הכנסת ה-${knesset.number}. נשיא המדינה מטיל על אחד מחברי הכנסת להרכיב ממשלה – 28 ימים, שאפשר להאריך ב-14.`) : explain('הממשלה היא הרשות המבצעת. כל שר אחראי למשרד, והממשלה כולה אחראית בפני הכנסת.'),
        started && !transitional ? h('p', { class: 'muted' }, `בתפקיד מאז ${shortDate(started)}`) : null));
      const nameOf = id => {
        const person = people.get(id);
        return person ? clean(`${person.FirstName} ${person.LastName}`) : '';
      };
      const personCard = (id, roles) => h('li', { class: 'kn-person' },
        photoByPerson.get(id) ? h('img', { src: photoByPerson.get(id), alt: '', loading: 'lazy' }) : h('span', { class: 'kn-avatar' }),
        h('span', null, h('strong', null, nameOf(id) || '—'), roles.map(role => h('span', { class: 'muted' }, role))));
      const leaders = [45, 73, 51, 31, 50, 65];
      const top = [];
      for (const position of leaders) {
        for (const row of members.filter(p => p.PositionID === position)) top.push([row.PersonID, POSITION_ROLES[position] || clean(row.DutyDesc)]);
      }
      if (top.length) {
        const merged = new Map();
        for (const [id, role] of top) merged.set(id, [...(merged.get(id) || []), role]);
        fragment.append(section('בראש הממשלה', h('ul', { class: 'kn-people wide' }, [...merged].map(([id, roles]) => personCard(id, [...new Set(roles)])))));
      }
      const ministers = new Map();
      for (const row of members.filter(p => [39, 57].includes(p.PositionID))) {
        // The prime minister is listed above as such, not again as the minister of his office.
        if (top.some(([id]) => id === row.PersonID) && /ראש הממשלה/.test(row.DutyDesc || '')) continue;
        ministers.set(row.PersonID, [...(ministers.get(row.PersonID) || []), clean(row.DutyDesc) || clean(row.GovMinistryName)]);
      }
      fragment.append(section(`השרים (${ministers.size})`, explain('שר אחד יכול להחזיק בכמה משרדים. שר לא חייב להיות חבר כנסת.'),
        h('ul', { class: 'kn-people wide' }, [...ministers].sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0]), 'he')).map(([id, roles]) => personCard(id, [...new Set(roles)])))));
      const deputies = members.filter(p => [40, 59, 285079].includes(p.PositionID));
      if (deputies.length) fragment.append(section('סגני שרים', h('ul', { class: 'kn-people wide' }, deputies.map(row => personCard(row.PersonID, [clean(row.DutyDesc) || clean(row.GovMinistryName)])))));
      fragment.append(h('p', { class: 'kn-note' }, externalLink(`${SITE}/mk/government/pages/governments.aspx`, 'כל ממשלות ישראל'), ' ', externalLink(`${SITE}/mk/government/Pages/CoalitionAgreements.aspx`, 'הסכמים קואליציוניים וקווי יסוד')));
      return fragment;
    }

    /* ---------- Guide ---------- */

    async function renderGuide() {
      const fragment = h('div', { class: 'kn-page kn-guide' });
      fragment.append(h('nav', { class: 'kn-toc', 'aria-label': 'תוכן המדריך' }, GUIDE.articles.map(article => h('a', { href: `#kn-${article.id}`, onclick: event => {
        event.preventDefault();
        main.querySelector(`#kn-${article.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } }, article.title)), h('a', { href: '#kn-glossary', onclick: event => {
        event.preventDefault();
        main.querySelector('#kn-glossary')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } }, 'מילון מונחים'), h('a', { href: '#kn-links', onclick: event => {
        event.preventDefault();
        main.querySelector('#kn-links')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } }, 'באתר הכנסת')));
      for (const article of GUIDE.articles) {
        fragment.append(h('section', { class: 'kn-section kn-article', id: `kn-${article.id}` }, h('h3', null, article.title),
          article.body.map(text => h('p', { class: 'kn-prose' }, text)),
          article.stages ? h('ol', { class: 'kn-steps' }, GUIDE.stages.map(stage => h('li', null, h('b', null, stage.title), h('span', null, stage.text)))) : null));
      }
      const search = h('input', { type: 'search', class: 'kn-search', placeholder: 'חיפוש מונח', value: view.glossarySearch, 'aria-label': 'חיפוש במילון' });
      const list = h('dl', { class: 'kn-glossary' });
      const paint = () => {
        const query = normalizeName(view.glossarySearch);
        list.replaceChildren(...GUIDE.glossary.filter(([term, text]) => !query || normalizeName(`${term} ${text}`).includes(query))
          .flatMap(([term, text]) => [h('dt', null, term), h('dd', null, text)]));
      };
      search.addEventListener('input', () => {
        view.glossarySearch = search.value;
        paint();
      });
      paint();
      fragment.append(h('section', { class: 'kn-section', id: 'kn-glossary' }, h('h3', null, 'מילון מונחים'), h('div', { class: 'kn-toolbar' }, search), list));
      fragment.append(h('section', { class: 'kn-section', id: 'kn-links' }, h('h3', null, 'באתר הכנסת'),
        h('div', { class: 'kn-link-groups' }, GUIDE.links.map(group => h('div', null, h('h4', null, group.title), h('ul', { class: 'kn-docs' }, group.items.map(([label, url]) => h('li', null, externalLink(url, label)))))))));
      fragment.append(h('p', { class: 'kn-note muted' }, 'המידע מגיע ישירות מהמאגר הפתוח של הכנסת ומאתר הכנסת, ומתעדכן בכל פתיחה ורענון.'));
      return fragment;
    }

    const RENDERERS = {
      today: renderToday,
      calendar: renderCalendar,
      committees: renderCommittees,
      plenum: renderPlenum,
      votes: renderVotes,
      bills: renderBills,
      mks: renderMks,
      government: renderGovernment,
      guide: renderGuide,
    };

    return {
      element: root,
      dialogs: [player.element],
      isOpen: () => view.open,
      setOpen,
      toggle: () => setOpen(!view.open),
      refresh,
      // Esc closes the details first, then the view.
      escape() {
        if (!detail.hidden) closeDetail();
        else setOpen(false);
      },
      // A phone's back gesture: closes the player, then the details; false when nothing was open.
      back() {
        if (player.element.open) {
          player.element.close();
          return true;
        }
        if (!detail.hidden) {
          closeDetail();
          return true;
        }
        return false;
      },
      // Redraws the open page from the data it has, for example when the live channels change.
      rerender() {
        if (view.open && !main.querySelector(':scope > .kn-loading')) render({ quiet: true });
      },
      // Exposed for tests.
      hebrewDate,
      similarity,
      billProgress,
    };
  };
})();

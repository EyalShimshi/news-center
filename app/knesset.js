/*
 * News Center's Knesset view: the Knesset's day-to-day work in plain Hebrew – what's on today, the
 * committees, the plenum, votes, legislation, MKs, the government, and a guide. It reads the
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

  const ITEM_TYPES = { 1: 'שאילתה', 2: 'הצעת חוק', 4: 'הצעה לסדר היום', 5: 'ישיבת מליאה', 11: 'נושא לדיון', 6000: 'פעולה על פי חוק', 6002: 'הצעת חוק', 6003: 'חוק' };

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
  function hebrewDate(date) {
    try {
      const parts = Object.fromEntries(hebrewParts.formatToParts(date).map(part => [part.type, part.value]));
      return `${hebrewNumber(Number(parts.day))} ב${parts.month} ${hebrewNumber(Number(parts.year))}`;
    } catch {
      return '';
    }
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
      plenumId: null,
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

    const loadPlenumAgenda = force => cached('plenum-agenda', 2 * MIN, () =>
      site(`Plenum/GetAgendaPlenum?sessionDate=${encodeURIComponent(startOfDay(new Date()).toISOString())}&IsDraft=false`), force);

    const loadNextPlenum = force => cached('plenum-next', 10 * MIN, () => site('Plenum/GetNextSession'), force);

    const loadSiteCommittees = force => cached('site-committees', 2 * MIN, () => site('Committees/GetAllCommittees/he'), force);

    const loadBroadcasts = force => cached('broadcasts', 5 * MIN, () => site('Committees/GetAllBroadcasts/he'), force);

    const loadHolidays = () => cached('holidays', 24 * 60 * MIN, () => site('Global/GetAllHolidays'));

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
          if (view.tab === 'today' && !document.hidden && !document.querySelector('dialog[open]')) render({ quiet: true });
        }, TODAY_REFRESH_MS);
        main.focus({ preventScroll: true });
      } else {
        closeDetail();
      }
    }

    function setTab(tab) {
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

    // Back in sight after a while (another app or tab): today's page catches up at once.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && view.open && view.tab === 'today' && Date.now() - view.renderedAt > TODAY_REFRESH_MS) render({ quiet: true });
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

    function plenumCard(topics, now) {
      const live = topics.find(topic => topic.IsLive);
      const start = toDate(topics[0].StartTime);
      const finish = toDate(topics.find(topic => topic.FinishTime)?.FinishTime);
      const isLive = Boolean(live) || (start <= now && !finish && sameDay(start, now) && now - start < 10 * 60 * 60 * 1000 && Boolean(live));
      return h('article', { class: `kn-card kn-session kn-plenum${isLive ? ' is-live' : ''}` },
        h('div', { class: 'kn-when' }, h('b', null, time(start))),
        h('div', { class: 'kn-what' },
          h('div', { class: 'kn-card-title' }, h('span', { class: 'kn-kind plenum' }, 'מליאה'), h('strong', null, 'ישיבת מליאת הכנסת'), isLive ? badge('מתקיימת עכשיו', 'live') : null),
          h('ol', { class: 'kn-items' }, topics.map(topic => h('li', { class: topic.IsLive ? 'is-now' : '' }, clean(topic.Title), topic.IsLive ? badge('עכשיו', 'live') : null))),
          h('div', { class: 'kn-card-actions' },
            button(isLive ? 'צפייה בשידור חי' : 'לערוץ הכנסת', watchPlenum, isLive ? 'kn-btn live' : 'kn-btn'),
            button('סדר היום המלא', () => setTab('plenum')),
            externalLink(`${SITE}/apps/plenum`, 'באתר הכנסת'))));
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
      const fragment = h('div', { class: 'kn-page' });

      // On air: the Knesset streams the TV grid found, and today's live plenum topic.
      const streams = api.knessetChannels().filter(item => item.live);
      const liveTopic = topics.find(topic => topic.IsLive);
      if (streams.length || liveTopic) {
        fragment.append(section('משודר עכשיו', h('div', { class: 'kn-live-row' },
          liveTopic ? h('button', { type: 'button', class: 'kn-live', onclick: watchPlenum }, h('i', { class: 'kn-dot' }), h('span', null, h('b', null, 'מליאה'), clean(liveTopic.Title))) : null,
          streams.filter(item => !(item.main && liveTopic)).map(item => h('button', {
            type: 'button', class: 'kn-live', onclick: () => openChannel(item.id),
          }, h('i', { class: 'kn-dot' }), h('span', null, h('b', null, item.name), item.now || 'שידור חי'))))));
      }

      // Today's timeline: the plenum and every committee session, in time order.
      const timeline = [];
      if (topics.length) timeline.push({ at: toDate(topics[0].StartTime), node: plenumCard(topics, now) });
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
        externalLink(`${SITE}/About/KnessetWork/Pages/WorkAndRecessDates.aspx`, 'מועדי עבודת הכנסת')));
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

    async function renderPlenum(force) {
      const [sessions, agenda, knesset] = await Promise.all([loadPlenumSessions(force), loadPlenumAgenda(force).catch(() => []), loadKnesset()]);
      const now = new Date();
      const fragment = h('div', { class: 'kn-page' });
      fragment.append(explain('המליאה היא כל 120 חברי הכנסת יחד: כאן מצביעים על חוקים, שואלים את השרים ומעלים נושאים לדיון. בחרו ישיבה כדי לראות מה היה על סדר היום.'));
      const live = Array.isArray(agenda) && agenda.find(topic => topic.IsLive);
      if (live) {
        fragment.append(h('div', { class: 'kn-live-row' }, h('button', { type: 'button', class: 'kn-live', onclick: watchPlenum }, h('i', { class: 'kn-dot' }), h('span', null, h('b', null, 'המליאה עכשיו'), clean(live.Title)))));
      }
      fragment.append(section('ישיבות המליאה', h('ul', { class: 'kn-agenda kn-sittings' }, sessions.map(session => {
        const start = toDate(session.StartDate);
        const ongoing = start <= now && !session.FinishDate && sameDay(start, now);
        return h('li', null, h('button', { type: 'button', class: 'kn-row-btn', onclick: () => openPlenum(session) },
          h('b', null, `${dayLabel(start, now)} · ${shortDate(start)} ${time(start)}`),
          h('span', null, `ישיבה ${session.Number || ''}${session.KnessetNum && session.KnessetNum !== knesset.number ? ` של הכנסת ה-${session.KnessetNum}` : ''}${session.IsSpecialMeeting ? ' (ישיבה מיוחדת)' : ''}`),
          ongoing ? badge('מתקיימת', 'live') : start > now ? badge('מתוכננת', 'muted') : null));
      }))));
      fragment.append(h('p', { class: 'kn-note' }, externalLink(`${SITE}/apps/plenum`, 'סדר היום של המליאה באתר הכנסת'), ' ', externalLink(`${SITE}/apps/smartprotocol/search`, 'דברי הכנסת')));
      if (!view.plenumId && sessions[0]) view.plenumId = sessions[0].Id;
      return fragment;
    }

    function openPlenum(session) {
      const start = toDate(session.StartDate);
      openDetail(`ישיבת המליאה · ${shortDate(start)}`, async () => {
        const [items, docs, votes, statuses] = await Promise.all([
          odata(`KNS_PlmSessionItem?$filter=PlenumSessionID eq ${session.Id}&$orderby=Ordinal&$select=ItemID,ItemTypeID,ItemTypeDesc,Ordinal,Name,StatusID,IsDiscussion`, 4),
          odata(`KNS_DocumentPlenumSession?$filter=PlenumSessionID eq ${session.Id}&$select=GroupTypeDesc,ApplicationDesc,FilePath`, 1).catch(() => []),
          odata(`KNS_PlenumVote?$filter=SessionID eq ${session.Id}&$orderby=VoteDateTime&$select=Id,VoteDateTime,VoteTitle,VoteSubject,VoteMethodDesc`, 2).catch(() => []),
          loadStatuses().catch(() => new Map()),
        ]);
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
        return h('div', { class: 'kn-stack' },
          h('p', { class: 'kn-big' }, `${dayLabel(start)}, ${shortDate(start)}, בשעה ${time(start)}${session.FinishDate ? ` – ${time(toDate(session.FinishDate))}` : ''}`),
          sameDay(start, new Date()) && !session.FinishDate ? h('div', { class: 'kn-card-actions' }, button('צפייה בשידור', watchPlenum, 'kn-btn live')) : null,
          section('נדונו בישיבה', discussed.length ? byType(discussed) : empty('לא פורסם סדר יום לדיון.')),
          tabled.length ? section(`הונחו על שולחן הכנסת (${tabled.length})`, explain('"הנחה" היא פרסום רשמי לכל חברי הכנסת – עדיין לא דיון. הצעות חוק פרטיות מונחות כך לפני הקריאה הטרומית.'), h('details', { class: 'kn-more' }, h('summary', null, 'להציג את כולן'), byType(tabled))) : null,
          votes.length ? section(`הצבעות (${votes.length})`, h('ul', { class: 'kn-agenda' }, votes.map(vote => h('li', null,
            h('button', { type: 'button', class: 'kn-row-btn', onclick: () => openVote(vote) }, h('b', null, time(toDate(vote.VoteDateTime))), h('span', null, clean(vote.VoteTitle), vote.VoteSubject ? h('span', { class: 'muted' }, ` – ${clean(vote.VoteSubject)}`) : null)))))) : null,
          docs.length ? section('מסמכים', h('ul', { class: 'kn-docs' }, docs.map(doc => h('li', null, externalLink(doc.FilePath, `${clean(doc.GroupTypeDesc)} (${doc.ApplicationDesc})`))))) : null);
      });
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
        const [data, statuses] = await Promise.all([site(`LegislationItem/GetLegislationBillItem?ItemId=${bill.Id}`), loadStatuses().catch(() => new Map())]);
        const general = data.general || {};
        const subType = clean(general.SubType) || clean(bill.SubTypeDesc);
        const statusId = bill.StatusID;
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

// Tests the Knesset view (app/knesset.js) the way both apps show it, in headless Chrome against
// the Knesset's live services: the Android page (android/app/src/main/assets/knesset/) on a phone in
// dark and light colors and on a tablet, and the Windows dashboard (app/index.html) at 1600x900.
// A small server stands in for the apps: it serves the pages and answers the Knesset requests the
// way KnessetWeb.kt (/__fetch) and the desktop's fetch bridge do. Requests anywhere but this server
// and the Knesset are refused, so no TV stream plays. Screenshots and results.json go to <out-dir>.
// If the Knesset doesn't answer this machine, missing data is a warning, not a failure.
// Usage: node knesset-web-test.mjs <out-dir>
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ANDROID_PAGE = join(ROOT, 'android/app/src/main/assets/knesset');
const APP = join(ROOT, 'app');
// The files the Android build copies from app/ beside its page (android/app/build.gradle.kts).
const SHARED = ['knesset.js', 'knesset-guide.js', 'knesset.css'];
const outDir = resolve(process.argv[2] || 'knesset-web');
mkdirSync(outDir, { recursive: true });

const BLOCKED = [...readFileSync(join(APP, 'app.js'), 'utf8').match(/BLOCKED_DOMAINS = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const sleep = ms => new Promise(done => setTimeout(done, ms));

/* ---------- Results ---------- */

const results = [];
// Strict while the Knesset answers this machine; otherwise missing data is only a warning. Hard
// checks (layout, the apps' contract, script errors) fail either way.
let strict = true;
function check(name, ok, detail = '', { soft = false, hard = false } = {}) {
  const level = ok ? 'PASS' : hard ? 'FAIL' : soft || !strict ? 'WARN' : 'FAIL';
  results.push({ name, level, detail });
  console.log(`${level} ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ---------- The apps' side ---------- */

const hostOf = url => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
};
const isBlocked = url => BLOCKED.some(domain => hostOf(url) === domain || hostOf(url).endsWith(`.${domain}`));
const isKnesset = url => hostOf(url) === 'knesset.gov.il' || hostOf(url).endsWith('.knesset.gov.il');
// KnessetFetch.kt: HTTPS on knesset.gov.il only, never a blocked site.
const isAllowed = url => url.startsWith('https://') && isKnesset(url) && !isBlocked(url);
const pageStatus = status => ((status >= 100 && status <= 299) || (status >= 400 && status <= 599) ? status : 502);

const upstream = [];
// Like Http.kt: redirects followed one at a time, each checked against the blocked sites.
async function knessetFetch(url) {
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    if (isBlocked(current)) throw new Error('blocked site');
    const started = Date.now();
    const response = await fetch(current, {
      redirect: 'manual',
      headers: { 'User-Agent': PHONE_UA, 'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8' },
      signal: AbortSignal.timeout(20000),
    });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).href;
      continue;
    }
    const text = await response.text();
    upstream.push({ url: current, status: response.status, ms: Date.now() - started, bytes: text.length });
    return { status: response.status, text };
  }
  throw new Error('too many redirects');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function fileFor(pathname) {
  const path = decodeURIComponent(pathname);
  if (path.includes('..')) return null;
  const isFile = file => existsSync(file) && statSync(file).isFile();
  if (path.startsWith('/assets/knesset/')) {
    const name = path.slice('/assets/knesset/'.length);
    if (isFile(join(ANDROID_PAGE, name))) return join(ANDROID_PAGE, name);
    return SHARED.includes(name) ? join(APP, name) : null;
  }
  if (path.startsWith('/app/') && isFile(join(APP, path.slice(5)))) return join(APP, path.slice(5));
  return null;
}

function reply(res, status, text, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(text);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/__fetch') {
      const target = url.searchParams.get('u') || '';
      if (req.method !== 'GET' || !isAllowed(target)) return reply(res, 403, '');
      try {
        const answer = await knessetFetch(target);
        return reply(res, pageStatus(answer.status), answer.text);
      } catch (error) {
        upstream.push({ url: target, status: 0, error: String(error.message || error) });
        return reply(res, 502, '', { 'X-NC-Error': 'network' });
      }
    }
    const file = fileFor(url.pathname);
    if (!file) return reply(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  } catch (error) {
    reply(res, 500, String(error));
  }
});

// Runs in every page before its own scripts: the Android app's message object, or the desktop
// host's fetch bridge (which answers only the Knesset, so the dashboard's channels stay off air).
const STAND_IN = `(() => {
  window.__hostMessages = [];
  if (location.pathname.startsWith('/assets/knesset/')) {
    window.NewsCenterHost = { postMessage(text) { window.__hostMessages.push(JSON.parse(text)); } };
  } else if (location.pathname.startsWith('/app/')) {
    const listeners = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      addEventListener(type, listener) { if (type === 'message') listeners.push(listener); },
      removeEventListener() {},
      postMessage(message) {
        window.__hostMessages.push(message);
        if (!message || message.type !== 'fetch') return;
        const answer = data => setTimeout(() => listeners.forEach(listener => listener({ data })));
        fetch('/__fetch?u=' + encodeURIComponent(message.url), { cache: 'no-store' }).then(async response => {
          const text = await response.text();
          if (response.headers.get('X-NC-Error') || response.status === 403) answer({ type: 'fetch-result', id: message.id, status: 0, error: 'not answered in the test' });
          else answer({ type: 'fetch-result', id: message.id, ok: response.ok, status: response.status, url: message.url, text });
        }, () => answer({ type: 'fetch-result', id: message.id, status: 0, error: 'no answer' }));
      },
    };
  }
})();`;

/* ---------- Themes (Material colors, as KnessetScreen.kt sends them) ---------- */

const DARK = { dark: true, colors: { background: '#121318', surfaceContainerLow: '#1A1B21', surfaceContainer: '#1E1F25', surfaceContainerHigh: '#292A2F', surfaceContainerHighest: '#34343A', onSurface: '#E3E1E9', onSurfaceVariant: '#C5C5D0', outline: '#8F909A', outlineVariant: '#45464F', primary: '#B9C3FF', onPrimary: '#212C61', primaryContainer: '#384379', onPrimaryContainer: '#DDE1FF', secondaryContainer: '#414659', onSecondaryContainer: '#DEE1F9', error: '#FFB4AB' } };
const LIGHT = { dark: false, colors: { background: '#FBF8FF', surfaceContainerLow: '#F5F2FA', surfaceContainer: '#EFEDF4', surfaceContainerHigh: '#E9E7EF', surfaceContainerHighest: '#E3E1E9', onSurface: '#1B1B21', onSurfaceVariant: '#45464F', outline: '#767680', outlineVariant: '#C6C5D0', primary: '#4F5B92', onPrimary: '#FFFFFF', primaryContainer: '#DDE1FF', onPrimaryContainer: '#374379', secondaryContainer: '#DFE1F9', onSecondaryContainer: '#424659', error: '#BA1A1A' } };

// Two Knesset streams on the Watch screen: the Knesset Channel and a committee room.
const CHANNELS = [
  { id: 'knesset:kneset.gostreaming.tv/p2-kneset/_definst_/myStream', name: 'ערוץ הכנסת', url: 'https://kneset.gostreaming.tv/p2-kneset/_definst_/myStream/playlist.m3u8', now: '', main: true, live: true },
  { id: 'knesset:test-room', name: 'ועדת בדיקה', url: 'https://kneset.gostreaming.tv/p2-test/_definst_/myStream/playlist.m3u8', now: 'דיון לדוגמה', main: false, live: true },
];

/* ---------- Browser ---------- */

const CHROME = process.env.CHROME_BIN || (process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : 'google-chrome');
const profile = mkdtempSync(join(tmpdir(), 'knesset-web-'));
let browser;
let ws;
const pending = new Map();
let nextId = 1;
const errors = [];
const consoleErrors = [];
const refused = new Set();

function cdp(method, params = {}) {
  return new Promise((done, fail) => {
    const id = nextId++;
    pending.set(id, { done, fail });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(test, timeout, what) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const value = await test();
      if (value) return value;
    } catch {
      // Not yet.
    }
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function shot(name) {
  const data = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data.data, 'base64'));
}

async function startBrowser() {
  browser = spawn(CHROME, [
    '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--mute-audio', '--lang=he-IL', '--hide-scrollbars', '--window-size=1600,900', 'about:blank',
  ], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  const port = await waitFor(() => existsSync(portFile) && readFileSync(portFile, 'utf8').split('\n')[0].trim(), 30000, 'the browser');
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page'), 30000, 'a page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    ws.onopen = done;
    ws.onerror = fail;
  });
  ws.onmessage = async event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { done, fail } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) fail(new Error(message.error.message));
      else done(message.result);
      return;
    }
    const params = message.params || {};
    if (message.method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && params.type === 'error') consoleErrors.push(params.args.map(arg => arg.value ?? arg.description).join(' '));
    // Only this server and the Knesset: everything else (TV streams, other sites) is refused.
    if (message.method === 'Fetch.requestPaused') {
      const url = params.request.url;
      const local = url.startsWith('http://127.0.0.1:');
      if (local || (isKnesset(url) && !isBlocked(url))) {
        cdp('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
      } else {
        refused.add(hostOf(url) || url.slice(0, 40));
        cdp('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      }
    }
  };
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: STAND_IN });
  await cdp('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Jerusalem' });
  await cdp('Emulation.setLocaleOverride', { locale: 'he-IL' }).catch(() => {});
}

async function emulate({ width, height, scale, mobile, dark }) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile, screenWidth: width, screenHeight: height });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  await cdp('Emulation.setUserAgentOverride', { userAgent: mobile ? PHONE_UA : DESKTOP_UA });
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
}

/* ---------- Checks shared by the runs ---------- */

const ROOT_SEL = '#knesset';
const settle = async (what, timeout = 90000) => {
  await waitFor(() => evaluate(`Boolean(document.querySelector('${ROOT_SEL} .kn-main')?.firstElementChild) && !document.querySelector('${ROOT_SEL} .kn-main > .kn-loading')`), timeout, what);
  await sleep(700);
};
const detailOpen = () => evaluate(`(() => { const d = document.querySelector('${ROOT_SEL} .kn-detail'); return Boolean(d && !d.hidden); })()`);
const messages = () => evaluate('window.__hostMessages.slice()');

// Nothing sticks out sideways: the page and its lists fit the screen (sideways lists excepted). On
// the desktop the view is measured, not the dashboard document around it.
let measureView = false;
async function checkFits(label) {
  const info = await evaluate(`(() => {
    const scrollers = '.kn-tabs, .kn-chips, .kn-faction-list';
    const out = [...document.querySelectorAll('${ROOT_SEL} .kn-main *, ${ROOT_SEL} .kn-detail:not([hidden]) *')].filter(el => {
      if (el.closest(scrollers)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.right > innerWidth + 1 || r.left < -1);
    }).slice(0, 4).map(el => (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName.toLowerCase()) + ':' + (el.textContent || '').trim().slice(0, 30));
    const main = document.querySelector('${ROOT_SEL} .kn-main');
    const view = document.querySelector('${ROOT_SEL}');
    const page = ${measureView} ? view.scrollWidth - view.clientWidth : document.documentElement.scrollWidth - innerWidth;
    return { page, main: main.scrollWidth - main.clientWidth, out };
  })()`);
  check(`${label}: fits the screen`, info.page <= 1 && info.main <= 1 && info.out.length === 0, info.page > 1 || info.main > 1 || info.out.length ? JSON.stringify(info) : '', { hard: true });
}

const TABS = ['today', 'calendar', 'committees', 'plenum', 'votes', 'bills', 'mks', 'government', 'guide'];
// What to tap for a detail on each page (an expression giving the element). Today's cards also
// have watch and recording buttons, so there it's "פרטים" (details) or a row of the week ahead.
// The calendar's chosen day lists its committee sessions (a day that has some is chosen first).
const OPENERS = {
  today: `[...document.querySelectorAll('${ROOT_SEL} .kn-main .kn-card .kn-btn')].find(b => b.textContent.trim() === 'פרטים') || document.querySelector('${ROOT_SEL} .kn-main .kn-agenda .kn-row-btn')`,
  calendar: `(() => { const row = () => document.querySelector('${ROOT_SEL} .kn-main .kn-cal-panel .kn-row-btn'); if (!row()) document.querySelector('${ROOT_SEL} .kn-main .kn-cal-day.has-cmt')?.click(); return row(); })()`,
  committees: `document.querySelector('${ROOT_SEL} .kn-main .kn-tile')`,
  plenum: `document.querySelector('${ROOT_SEL} .kn-main .kn-sittings li:not(.is-planned) .kn-row-btn')`,
  votes: `document.querySelector('${ROOT_SEL} .kn-main .kn-votes .kn-row-btn')`,
  bills: `document.querySelector('${ROOT_SEL} .kn-main .kn-bill')`,
  mks: `document.querySelector('${ROOT_SEL} .kn-main .kn-mk')`,
};

// Requests the Knesset didn't answer so far (no connection, or a server error). A page that shows a
// problem right after one of these is the Knesset not answering, which is only a warning.
const unanswered = () => upstream.filter(entry => entry.status === 0 || entry.status >= 500).length;
const notAnsweredNote = ' (the Knesset didn\'t answer)';

async function openTab(label, tab) {
  const started = Date.now();
  const failures = unanswered();
  await evaluate(`document.querySelector('${ROOT_SEL} [data-tab="${tab}"]').click()`);
  await settle(`${label} ${tab}`);
  const info = await evaluate(`(() => {
    const main = document.querySelector('${ROOT_SEL} .kn-main');
    return { problem: main.querySelector('.kn-problem')?.textContent.replace(/\\s+/g, ' ').trim() || '', text: main.innerText.length, sections: main.querySelectorAll('.kn-section').length };
  })()`);
  const down = Boolean(info.problem) && unanswered() > failures;
  check(`${label}: ${tab} loads`, !info.problem && info.text > 200, `${Date.now() - started} ms, ${info.sections} sections${info.problem ? `, problem: ${info.problem}` : ''}${down ? notAnsweredNote : ''}`, { soft: down });
  return info;
}

async function openDetailOf(label, tab, { back }) {
  const failures = unanswered();
  const opened = await evaluate(`(() => { const el = ${OPENERS[tab]}; if (!el) return false; el.click(); return true; })()`);
  if (!opened) {
    check(`${label}: ${tab} has an item to open`, false, 'none on the page', { soft: true });
    return false;
  }
  await waitFor(() => evaluate(`(() => { const d = document.querySelector('${ROOT_SEL} .kn-detail'); return d && !d.hidden && !d.querySelector('.kn-loading'); })()`), 60000, `${label} ${tab} detail`);
  await sleep(600);
  const detail = await evaluate(`(() => { const d = document.querySelector('${ROOT_SEL} .kn-detail'); const r = d.getBoundingClientRect(); return { title: d.querySelector('h3')?.innerText || '', problem: d.querySelector('.kn-problem')?.textContent.replace(/\\s+/g, ' ').trim() || '', text: d.innerText.length, width: r.width, height: r.height, top: r.top, innerWidth, innerHeight }; })()`);
  const down = Boolean(detail.problem) && unanswered() > failures;
  check(`${label}: ${tab} detail opens`, !detail.problem && detail.text > 80, `"${detail.title.slice(0, 50)}"${detail.problem ? `, problem: ${detail.problem}` : ''}${down ? notAnsweredNote : ''}`, { soft: down });
  if (back) {
    await shot(`${label}-detail-${tab}`);
    await checkFits(`${label} ${tab} detail`);
  }
  return detail;
}

/* ---------- The plenum's agenda and the calendar ---------- */

const keyOf = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// The plenum page shows a sitting's agenda in full: compared with the same sitting straight from the
// Knesset's website API – every item, every summary, every "בתמיכת ממשלה" – then the summary's
// "read more", the speakers and the agenda's search.
async function checkAgenda(label) {
  const info = await evaluate(`(() => {
    const section = document.querySelector('${ROOT_SEL} .kn-main .kn-featured');
    if (!section) return null;
    const links = [...section.querySelectorAll('.kn-item-actions a')];
    return {
      session: Number(section.dataset.session),
      title: section.querySelector('h3')?.textContent.trim() || '',
      topics: section.querySelectorAll('.kn-topic').length,
      items: section.querySelectorAll('.kn-item').length,
      summaries: section.querySelectorAll('.kn-summary-text').length,
      gov: section.querySelectorAll('.kn-item .kn-badge.gov').length,
      roles: section.querySelectorAll('.kn-item-roles').length,
      speakers: section.querySelectorAll('.kn-speakers').length,
      docs: links.filter(a => /^https:\\/\\/fs\\.knesset\\.gov\\.il\\/[^/]/.test(a.href)).length,
      badDocs: links.filter(a => /%5C|\\\\/i.test(a.href) || /^https:\\/\\/[^/]+\\/\\//.test(a.href)).map(a => a.href).slice(0, 2),
    };
  })()`);
  if (!info) {
    check(`${label}: the plenum page shows a sitting's agenda`, false, 'no agenda on the page');
    return;
  }
  check(`${label}: the plenum page shows a sitting's agenda`, info.topics > 0, `${info.title}: ${info.topics} topics, ${info.items} items`);
  check(`${label}: document links are clean addresses`, info.badDocs.length === 0, info.badDocs.length ? info.badDocs.join(' ') : `${info.docs} documents`, { hard: true });
  try {
    const rows = JSON.parse((await knessetFetch(`https://knesset.gov.il/WebSiteApi/knessetapi/Plenum/GetSessionData?SessionId=${info.session}`)).text);
    const expected = {
      items: rows.length,
      summaries: rows.filter(row => String(row.Summery || '').replace(/\*[^*]{4,}\*/g, '').trim()).length,
      gov: rows.filter(row => /תמיכת\s+ה?ממשלה/.test(row.SecretaryNotes || '')).length,
      roles: rows.filter(row => row.Presenter || row.Reasoner || row.Answer).length,
    };
    check(`${label}: every agenda item is listed`, info.items === expected.items, `${info.items} of ${expected.items}`);
    check(`${label}: every summary (תקציר) is shown`, info.summaries === expected.summaries, `${info.summaries} of ${expected.summaries}`);
    check(`${label}: government support is marked`, info.gov === expected.gov, `${info.gov} of ${expected.gov}`);
    check(`${label}: who presents and who answers`, info.roles === expected.roles, `${info.roles} of ${expected.roles}`);
  } catch (error) {
    check(`${label}: the agenda matches the Knesset's`, false, error.message, { soft: true });
  }

  const more = await evaluate(`(() => {
    const button = [...document.querySelectorAll('${ROOT_SEL} .kn-featured .kn-more-btn')].find(b => b.offsetParent !== null);
    if (!button) return null;
    const text = button.closest('.kn-item').querySelector('.kn-summary-text');
    const before = text.scrollHeight - text.clientHeight;
    button.click();
    const after = text.scrollHeight - text.clientHeight;
    return { before, after, label: button.textContent };
  })()`);
  if (more) check(`${label}: a long summary opens in full`, more.before > 2 && more.after <= 1 && more.label === 'פחות', JSON.stringify(more), { hard: true });

  const speakers = await evaluate(`(() => {
    const list = [...document.querySelectorAll('${ROOT_SEL} .kn-featured details.kn-more')].find(d => d.querySelector('.kn-speakers'));
    if (!list) return null;
    list.open = true;
    return { label: list.querySelector('summary').textContent, shown: list.querySelectorAll('.kn-speakers li').length, visible: list.querySelector('.kn-speakers').getBoundingClientRect().height > 0 };
  })()`);
  if (speakers) check(`${label}: an item's speakers open`, speakers.shown > 0 && speakers.visible, JSON.stringify(speakers), { hard: true });

  const search = await evaluate(`(() => {
    const input = document.querySelector('${ROOT_SEL} .kn-featured .kn-search');
    if (!input) return null;
    const items = [...document.querySelectorAll('${ROOT_SEL} .kn-featured .kn-item')];
    const name = items[0].querySelector('.kn-item-name').textContent;
    const word = name.split(/\\s+/).filter(w => w.length >= 4).sort((a, b) => b.length - a.length)[0] || name;
    input.value = word;
    input.dispatchEvent(new Event('input'));
    const shown = items.filter(item => !item.hidden).length;
    const first = !items[0].hidden;
    input.value = '';
    input.dispatchEvent(new Event('input'));
    return { word, total: items.length, shown, first, back: items.filter(item => !item.hidden).length };
  })()`);
  if (search) check(`${label}: the agenda's search finds an item`, search.first && search.shown >= 1 && search.shown <= search.total && search.back === search.total, JSON.stringify(search), { hard: true });
}

// The calendar: this month under the right weekdays, today marked and chosen, the Knesset's days,
// a plenum day in full, the month's arrows and the keyboard.
async function checkCalendar(label, { full }) {
  const now = new Date();
  const info = await evaluate(`(() => {
    const root = document.querySelector('${ROOT_SEL} .kn-main');
    return {
      weekdays: root.querySelectorAll('.kn-cal-wd').length,
      days: root.querySelectorAll('.kn-cal-day').length,
      pads: root.querySelectorAll('.kn-cal-pad').length,
      today: root.querySelector('.kn-cal-day.is-today')?.dataset.day || '',
      selected: root.querySelector('.kn-cal-day.is-selected')?.dataset.day || '',
      plenum: root.querySelectorAll('.kn-cal-day.has-plenum').length,
      committees: root.querySelectorAll('.kn-cal-day.has-cmt').length,
      title: root.querySelector('.kn-cal-title h3')?.textContent || '',
      hebrew: root.querySelector('.kn-cal-title .muted')?.textContent || '',
      panel: root.querySelector('.kn-cal-panel h3')?.textContent || '',
    };
  })()`);
  const length = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const firstWeekday = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  check(`${label}: the calendar shows this month`, info.weekdays === 7 && info.days === length && info.pads === firstWeekday, `${info.title} (${info.hebrew}): ${info.days} days, ${info.pads} blank before the 1st`, { hard: true });
  check(`${label}: today is marked and chosen`, info.today === keyOf(now) && info.selected === keyOf(now) && Boolean(info.panel), `${info.today} · ${info.panel}`, { hard: true });
  check(`${label}: the month has the Knesset's days`, info.plenum + info.committees > 0, `${info.plenum} plenum days, ${info.committees} days with committees`, { soft: true });
  if (!full) return;

  // A plenum day: the sitting's card fills in its topics.
  const plenumDay = await evaluate(`(() => { const day = [...document.querySelectorAll('${ROOT_SEL} .kn-cal-day.has-plenum')].pop(); if (!day) return ''; day.click(); return day.dataset.day; })()`);
  if (plenumDay) {
    const card = await waitFor(() => evaluate(`(() => {
      const card = document.querySelector('${ROOT_SEL} .kn-cal-panel .kn-plenum');
      const topics = card && card.querySelector('.kn-cal-topics');
      if (!topics || /טוען/.test(topics.textContent)) return null;
      return { topics: topics.querySelectorAll('li').length, text: topics.textContent.trim().slice(0, 60), chosen: document.querySelector('${ROOT_SEL} .kn-cal-day.is-selected')?.dataset.day };
    })()`), 30000, "the sitting's topics").catch(() => null);
    check(`${label}: a plenum day shows its sitting's topics`, Boolean(card && card.chosen === plenumDay && (card.topics > 0 || card.text)), JSON.stringify(card));
    await shot(`${label}-calendar-day`);
    await checkFits(`${label} calendar day`);
  }

  // The keyboard: right to left, the left arrow is the next day.
  const keys = await evaluate(`(() => {
    const cell = document.querySelector('${ROOT_SEL} .kn-cal-day.is-selected');
    const before = cell.dataset.day;
    cell.focus();
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    return { before, after: document.querySelector('${ROOT_SEL} .kn-cal-day.is-selected')?.dataset.day || '' };
  })()`);
  const [y, m, d] = keys.before.split('-').map(Number);
  const previous = keyOf(new Date(y, m - 1, d - 1));
  check(`${label}: the right arrow goes to the day before`, keys.after === previous || (d === 1 && Boolean(keys.after)), JSON.stringify(keys), { hard: true });
  if (d === 1) await settle(`${label} calendar after the arrow`);

  // The month's arrows, and back to this month.
  const title = () => evaluate(`document.querySelector('${ROOT_SEL} .kn-cal-title h3')?.textContent || ''`);
  const start = await title();
  await evaluate(`document.querySelector('${ROOT_SEL} [aria-label="החודש הבא"]').click()`);
  await settle(`${label} next month`);
  const next = await title();
  await shot(`${label}-calendar-next`);
  await evaluate(`[...document.querySelectorAll('${ROOT_SEL} .kn-cal-head .kn-btn')].find(b => b.textContent.trim() === 'לחודש הנוכחי')?.click()`);
  await settle(`${label} this month again`);
  const back = await title();
  const thisMonth = await evaluate(`new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' }).format(new Date())`);
  check(`${label}: the month's arrows move and come back`, next !== start && back === thisMonth, `${start} → ${next} → ${back}`, { hard: true });
}

/* ---------- Android: phone and tablet ---------- */

async function androidRun(label, size, theme, { full }) {
  console.log(`\n== ${label} (${size.width}x${size.height}, ${theme.dark ? 'dark' : 'light'}) ==`);
  await emulate({ ...size, mobile: true, dark: theme.dark });
  await cdp('Page.navigate', { url: `${base}/assets/knesset/index.html?theme=${encodeURIComponent(JSON.stringify(theme))}` });
  await waitFor(() => evaluate('window.__hostMessages && window.__hostMessages.some(m => m.type === "ready")'), 30000, 'the page to say it is ready');
  await evaluate(`window.__nc.theme(${JSON.stringify(theme)}); window.__nc.channels(${JSON.stringify(CHANNELS)})`);
  check(`${label}: the page tells the app it's ready`, true);
  check(`${label}: no close button (the tab bar leaves the screen)`, await evaluate(`!document.querySelector('${ROOT_SEL} .kn-actions [title^="חזרה לערוצים"]')`), '', { hard: true });

  const colors = await evaluate(`(() => { const s = getComputedStyle(document.body); const m = getComputedStyle(document.querySelector('${ROOT_SEL}')); return { body: s.backgroundColor, text: s.color, view: m.backgroundColor }; })()`);
  const rgb = hex => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
  check(`${label}: the app's colors`, colors.view === rgb(theme.colors.background) && colors.text === rgb(theme.colors.onSurface), JSON.stringify(colors), { hard: true });

  await settle(`${label} first page`);
  await waitFor(async () => (await messages()).some(m => m.type === 'log' && /^page (shown|problem)/.test(m.text)), 10000, 'the first page report').catch(() => {});
  const report = (await messages()).find(m => m.type === 'log');
  check(`${label}: reports its first page to the app`, Boolean(report), report ? report.text.slice(0, 80) : 'no report', { hard: true });

  const tabs = full ? TABS : ['today', 'calendar', 'plenum', 'committees', 'mks'];
  for (const tab of tabs) {
    try {
      await openTab(label, tab);
      await shot(`${label}-${tab}`);
      await checkFits(`${label} ${tab}`);
      if (full && ['today', 'mks', 'bills', 'plenum', 'calendar'].includes(tab)) {
        await evaluate(`document.querySelector('${ROOT_SEL} .kn-main').scrollTop = innerHeight * 0.85`);
        await sleep(400);
        await shot(`${label}-${tab}-2`);
        await evaluate(`document.querySelector('${ROOT_SEL} .kn-main').scrollTop = 0`);
      }
      if (tab === 'plenum') await checkAgenda(label);
      if (tab === 'calendar') await checkCalendar(label, { full });
      if (tab === 'today') {
        const live = await evaluate(`(() => { const el = document.querySelector('${ROOT_SEL} .kn-live'); if (!el) return ''; el.click(); return el.innerText.replace(/\\s+/g, ' ').trim(); })()`);
        await sleep(300);
        const watched = (await messages()).filter(m => m.type === 'watch');
        check(`${label}: "on air now" opens the channel in the app`, Boolean(live) && watched.length > 0 && CHANNELS.some(c => c.id === watched.at(-1).id), live ? `${live.slice(0, 40)} → ${JSON.stringify(watched.at(-1) || null)}` : 'no "on air now" item');
        check(`${label}: the view stays open after watching`, await evaluate(`!document.querySelector('${ROOT_SEL}').hidden`), '', { hard: true });
      }
      if (OPENERS[tab] && (full || tab === 'committees')) {
        const before = (await messages()).filter(m => m.type === 'back').length;
        const detail = await openDetailOf(label, tab, { back: true });
        if (detail) {
          if (size.width < 860) check(`${label}: ${tab} detail covers the screen`, detail.width >= size.width - 1 && detail.height >= size.height - 1 && detail.top <= 0.5, `${Math.round(detail.width)}x${Math.round(detail.height)}`, { hard: true });
          else check(`${label}: ${tab} detail is a panel beside the list`, detail.width < size.width * 0.6, `${Math.round(detail.width)} of ${size.width}`, { hard: true });
          const backs = (await messages()).filter(m => m.type === 'back').slice(before);
          check(`${label}: tells the app back has something to close`, backs.some(m => m.open === true), '', { hard: true });
          // A recording in the details goes to the app's player.
          const played = await evaluate(`(() => { const b = [...document.querySelectorAll('${ROOT_SEL} .kn-detail .kn-btn')].find(el => /הקלטה/.test(el.textContent)); if (!b) return false; b.click(); return true; })()`);
          if (played) {
            await sleep(300);
            const play = (await messages()).filter(m => m.type === 'play').at(-1);
            check(`${label}: a recording plays in the app's player`, Boolean(play && /^https:\/\//.test(play.url) && play.title), JSON.stringify(play || null).slice(0, 120), { hard: true });
            check(`${label}: the page's own player stays closed`, await evaluate('!document.querySelector("dialog[open]")'), '', { hard: true });
          }
          const closed = await evaluate('window.__nc.back()');
          const again = await evaluate('window.__nc.back()');
          check(`${label}: back closes the detail, then has nothing left`, closed === true && again === false && !(await detailOpen()), '', { hard: true });
          check(`${label}: tells the app when nothing is open`, (await messages()).filter(m => m.type === 'back').at(-1)?.open === false, '', { hard: true });
        }
      }
    } catch (error) {
      check(`${label}: ${tab}`, false, error.message);
      await shot(`${label}-${tab}-failed`).catch(() => {});
    }
  }

  if (full) {
    try {
      await evaluate(`document.querySelector('${ROOT_SEL} [data-tab="bills"]').click()`);
      await settle(`${label} bills again`);
      const filtered = await evaluate(`(() => {
        const before = document.querySelectorAll('${ROOT_SEL} .kn-bills .kn-bill').length;
        const chip = [...document.querySelectorAll('${ROOT_SEL} .kn-chips .chip')].find(c => c.dataset.filter !== 'all');
        if (!chip) return { before, after: -1 };
        chip.click();
        return { before, after: document.querySelectorAll('${ROOT_SEL} .kn-bills .kn-bill').length };
      })()`);
      check(`${label}: the stage filter narrows the bills`, filtered.after >= 0 && filtered.after <= filtered.before, JSON.stringify(filtered));
      await evaluate(`document.querySelector('${ROOT_SEL} [data-tab="mks"]').click()`);
      await settle(`${label} mks again`);
      const mks = await evaluate(`(() => {
        const all = document.querySelectorAll('${ROOT_SEL} .kn-mk').length;
        const input = document.querySelector('${ROOT_SEL} .kn-toolbar .kn-search');
        input.value = 'אוחנה';
        input.dispatchEvent(new Event('input'));
        const found = document.querySelectorAll('${ROOT_SEL} .kn-mk').length;
        input.value = '';
        input.dispatchEvent(new Event('input'));
        return { all, found };
      })()`);
      check(`${label}: 120 MKs, and search finds one`, mks.all === 120 && mks.found >= 1 && mks.found < 10, JSON.stringify(mks));
      await sleep(2500);
      const photos = await evaluate(`(() => { const imgs = [...document.querySelectorAll('${ROOT_SEL} .kn-mk img')].slice(0, 12); return { loaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length, total: imgs.length }; })()`);
      check(`${label}: MK photos load`, photos.loaded >= Math.min(6, photos.total), JSON.stringify(photos), { soft: true });
      const rerender = await evaluate(`(() => { window.__nc.channels([]); return true; })()`);
      await sleep(1500);
      check(`${label}: a change of channels redraws without errors`, rerender && errors.length === 0, '', { hard: true });
    } catch (error) {
      check(`${label}: filters and search`, false, error.message);
    }
  }
  // The next run starts on its first page, as a fresh install does.
  await evaluate('localStorage.clear()');
}

/* ---------- Windows dashboard ---------- */

async function desktopRun() {
  const label = 'desktop';
  console.log('\n== desktop (1600x900) ==');
  measureView = true;
  await cdp('Emulation.clearDeviceMetricsOverride');
  await emulate({ width: 1600, height: 900, scale: 1, mobile: false, dark: true });
  await cdp('Page.navigate', { url: `${base}/app/index.html` });
  await waitFor(() => evaluate('document.readyState === "complete" && Boolean(document.querySelector("#toggle-knesset"))'), 30000, 'the dashboard');
  await sleep(1500);
  await evaluate('document.querySelector("#toggle-knesset").click()');
  check(`${label}: the Knesset button opens the view`, await waitFor(() => evaluate(`!document.querySelector('${ROOT_SEL}').hidden`), 5000, 'the view'), '', { hard: true });
  check(`${label}: the view has its close button`, await evaluate(`Boolean(document.querySelector('${ROOT_SEL} .kn-actions [title^="חזרה לערוצים"]'))`), '', { hard: true });
  for (const tab of ['today', 'calendar', 'plenum', 'committees', 'votes']) {
    try {
      await openTab(label, tab);
      await shot(`${label}-${tab}`);
      if (tab === 'plenum') {
        await checkAgenda(label);
        await shot(`${label}-plenum-open`);
      }
      if (tab === 'calendar') await checkCalendar(label, { full: true });
      if (tab !== 'today') await openDetailOf(label, tab, { back: true });
      // Esc closes the details first (with nothing open it would close the whole view).
      if (await detailOpen()) await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }))');
    } catch (error) {
      check(`${label}: ${tab}`, false, error.message);
      await shot(`${label}-${tab}-failed`).catch(() => {});
    }
  }
  const styles = await evaluate(`(() => { const tab = document.querySelector('${ROOT_SEL} .kn-tab'); const s = getComputedStyle(tab); return { size: s.fontSize, weight: s.fontWeight }; })()`);
  check(`${label}: the shared styles apply (tabs 14px, semi-bold)`, styles.size === '14px' && Number(styles.weight) >= 600, JSON.stringify(styles), { hard: true });
}

/* ---------- Run ---------- */

let base = '';
try {
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;

  // Does the Knesset answer this machine? Cloud machines are sometimes held by its bot check.
  const probe = async url => {
    try {
      const answer = await knessetFetch(url);
      JSON.parse(answer.text);
      return answer.status === 200 ? 'ok' : `HTTP ${answer.status}`;
    } catch (error) {
      return error.message;
    }
  };
  const odata = await probe('https://knesset.gov.il/OdataV4/ParliamentInfo/KNS_KnessetDates?$filter=IsCurrent%20eq%20true');
  const site = await probe('https://knesset.gov.il/WebSiteApi/knessetapi/Plenum/GetNextSession');
  strict = odata === 'ok' && site === 'ok';
  console.log(`The Knesset's open data: ${odata}; its website's API: ${site}${strict ? '' : ' — missing data will only be warnings'}`);

  await startBrowser();
  await androidRun('phone', { width: 360, height: 780, scale: 2 }, DARK, { full: true });
  await androidRun('phone-light', { width: 360, height: 780, scale: 2 }, LIGHT, { full: false });
  await androidRun('tablet', { width: 900, height: 1280, scale: 1.5 }, DARK, { full: false });
  await desktopRun();

  check('no script errors', errors.length === 0, errors.slice(0, 5).join(' | '), { hard: true });
  check('no request to a blocked site', !upstream.some(item => isBlocked(item.url)) && ![...refused].some(host => isBlocked(`https://${host}/`)), '', { hard: true });
  if (consoleErrors.length) console.log(`Console errors (not failures): ${consoleErrors.slice(0, 8).join(' | ')}`);
  if (refused.size) console.log(`Refused outside requests to: ${[...refused].slice(0, 20).join(', ')}`);
} catch (error) {
  check('test run', false, error.stack || String(error), { hard: true });
} finally {
  const slow = upstream.filter(item => item.ms > 5000).length;
  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ results, errors, consoleErrors, refused: [...refused], upstream }, null, 1));
  const failed = results.filter(result => result.level === 'FAIL');
  const warned = results.filter(result => result.level === 'WARN');
  const summary = [
    `## Knesset view: ${results.length - failed.length - warned.length} passed, ${warned.length} warnings, ${failed.length} failed`,
    `${upstream.length} requests to the Knesset (${upstream.filter(item => item.status !== 200).length} not 200, ${slow} slower than 5 s). Screenshots: the knesset-web artifact.`,
    '',
    ...[...failed, ...warned].map(result => `- **${result.level}** ${result.name}${result.detail ? ` — ${result.detail.replace(/\n/g, ' ').slice(0, 300)}` : ''}`),
  ].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  for (const result of warned) console.log(`::warning::${result.name}${result.detail ? `: ${result.detail.slice(0, 200)}` : ''}`);
  for (const result of failed) console.log(`::error::${result.name}${result.detail ? `: ${result.detail.slice(0, 200)}` : ''}`);
  console.log(`\n${results.length - failed.length} of ${results.length} passed (${warned.length} warnings)`);
  try {
    ws?.close();
  } catch {
    // Already closed.
  }
  browser?.kill();
  server.close();
  await sleep(1000);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // The browser may still hold a file for a moment; the machine is thrown away anyway.
  }
  process.exitCode = failed.length ? 1 : 0;
}

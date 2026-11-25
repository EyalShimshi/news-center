// Runs the built NewsCenter.exe on this Windows machine and checks that a channel can move to its
// own window and back. It drives both windows through the browser's debugging port: a public test
// stream is the only channel; it moves to its own window (which must play it); solo, "hear only
// this" and mute from that window reach the main window and come back; pin and fullscreen work;
// the window's own button, closing the window, and a restart of News Center all behave as they
// should. Screenshots of both pages and of the desktop go to <out-dir>.
// Usage: node desktop-window-test.mjs <out-dir>
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXE = join(ROOT, 'NewsCenter.exe');
const DATA = join(process.env.LOCALAPPDATA || '', 'NewsCenter');
const PORT = 9333;
const ORIGIN = 'https://newscenter.example/';
const STORAGE_KEY = 'newscenter.state.v2';
const TEST = {
  id: 'test-stream',
  name: 'Test stream',
  kind: 'stream',
  // A public test stream, always on air (its 512x288 rendition, light for a build machine).
  url: 'https://test-streams.mux.dev/x36xhzz/url_4/193039199_mp4_h264_aac_7.m3u8',
  enabled: true,
};
const outDir = resolve(process.argv[2] || 'desktop-test');
mkdirSync(outDir, { recursive: true });
const sleep = ms => new Promise(done => setTimeout(done, ms));

const results = [];
function check(name, ok, detail = '', { soft = false } = {}) {
  const level = ok ? 'PASS' : soft ? 'WARN' : 'FAIL';
  results.push({ name, level, detail });
  console.log(`${level} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function waitFor(test, timeout, what) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await test();
      if (last) return last;
    } catch {
      // Not yet.
    }
    await sleep(400);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/* ---------- The app and its pages ---------- */

let app = null;
function launch() {
  app = spawn(EXE, [], { env: { ...process.env, NEWSCENTER_DEBUG_PORT: String(PORT) }, stdio: 'ignore' });
  app.exited = false;
  app.on('exit', () => { app.exited = true; });
}

async function targets() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  return list.filter(target => (target.type === 'page' || target.type === 'webview') && target.url.startsWith(ORIGIN));
}
const mainTarget = async () => (await targets()).find(target => !target.url.includes('?channel='));
const windowTarget = async id => (await targets()).find(target => target.url.includes(`?channel=${encodeURIComponent(id)}`));

const pageErrors = [];
class Page {
  static async open(target) {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((done, fail) => {
      ws.onopen = done;
      ws.onerror = () => fail(new Error(`could not connect to ${target.url}`));
    });
    const page = new Page(ws, target);
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    return page;
  }

  constructor(ws, target) {
    this.ws = ws;
    this.label = target.url.includes('?channel=') ? 'channel window' : 'main window';
    this.nextId = 1;
    this.pending = new Map();
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { done, fail } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) fail(new Error(message.error.message));
        else done(message.result);
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        pageErrors.push(`${this.label}: ${details.exception?.description || details.text}`);
      }
    };
    ws.onclose = () => {
      this.closed = true;
      for (const { fail } of this.pending.values()) fail(new Error('the page went away'));
      this.pending.clear();
    };
  }

  send(method, params = {}) {
    return new Promise((done, fail) => {
      if (this.closed) {
        fail(new Error('the page went away'));
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, { done, fail });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }

  async key(code, key, keyCode) {
    for (const type of ['keyDown', 'keyUp']) await this.send('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode: keyCode });
  }

  async shot(name) {
    try {
      const data = await this.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outDir, `${name}.png`), Buffer.from(data.data, 'base64'));
    } catch (error) {
      console.log(`(no screenshot of ${name}: ${error.message})`);
    }
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // Already closed.
    }
  }
}

/* ---------- Windows ---------- */

const WINDOWS = `
Add-Type -ReferencedAssemblies System.Drawing, System.Windows.Forms @'
using System; using System.Drawing; using System.Text; using System.Runtime.InteropServices; using System.Windows.Forms;
public static class Desk {
  delegate bool EnumProc(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window, int index);
  // close: 1 as the user does it (the X button, Alt+F4: WM_SYSCOMMAND SC_CLOSE), 2 as another
  // program such as Task Manager does it (WM_CLOSE).
  public static string Find(string prefix, int close) {
    var found = new StringBuilder();
    EnumWindows((window, data) => {
      var title = new StringBuilder(512);
      GetWindowText(window, title, 512);
      if (IsWindowVisible(window) && title.ToString().StartsWith(prefix)) {
        bool topMost = (GetWindowLong(window, -20) & 0x8) != 0;
        found.Append(title).Append(topMost ? " [on top]" : "").Append("\\n");
        if (close == 1) PostMessage(window, 0x112, (IntPtr)0xF060, IntPtr.Zero);
        else if (close == 2) PostMessage(window, 0x10, IntPtr.Zero, IntPtr.Zero);
      }
      return true;
    }, IntPtr.Zero);
    return found.ToString();
  }
  public static void Shot(string file) {
    var area = SystemInformation.VirtualScreen;
    using (var image = new Bitmap(area.Width, area.Height))
    using (var graphics = Graphics.FromImage(image)) {
      graphics.CopyFromScreen(area.Location, Point.Empty, area.Size);
      image.Save(file);
    }
  }
}
'@
`;

// The script goes base64-encoded, so its quotes and line breaks reach PowerShell unchanged. Without
// progress records, PowerShell's first-use module preparation stays out of the log.
function powershell(command) {
  const encoded = Buffer.from(`$ProgressPreference = 'SilentlyContinue'\n${WINDOWS}\n${command}`, 'utf16le').toString('base64');
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8' }).trim();
}

// Top-level windows whose titles start with `prefix`; closed as the 'user' or another 'program' would.
const findWindows = (prefix, close = '') => powershell(`[Desk]::Find('${prefix}', ${{ user: 1, program: 2 }[close] || 0})`).split('\n').filter(Boolean);

function desktopShot(name) {
  try {
    powershell(`[Desk]::Shot('${join(outDir, `${name}.png`)}')`);
  } catch (error) {
    console.log(`(no desktop screenshot: ${error.message.split('\n')[0]})`);
  }
}

/* ---------- Steps ---------- */

const tileIn = (page, id) => page.eval(`Boolean(document.querySelector('.tile[data-id="${id}"]'))`);

async function connectMain() {
  const target = await waitFor(mainTarget, 60000, 'the main window');
  const page = await Page.open(target);
  await waitFor(() => page.eval('document.readyState === "complete" && Boolean(document.querySelector(".statusbar"))'), 30000, 'the dashboard');
  return page;
}

async function connectWindow(id, timeout = 30000) {
  const target = await waitFor(() => windowTarget(id), timeout, `${id} in its own window`);
  const page = await Page.open(target);
  await waitFor(() => page.eval(`document.documentElement.classList.contains('own-window') && Boolean(document.querySelector('.tile[data-id="${id}"]'))`), 30000, 'the channel window\'s page');
  return page;
}

async function closeApp() {
  if (!app || app.exited) return;
  try {
    findWindows('News Center', 'program');
  } catch {
    // Ends below either way.
  }
  try {
    await waitFor(() => app.exited, 20000, 'News Center to close');
  } catch {
    app.kill();
    await sleep(1000);
  }
}

let main;
let own;
try {
  if (!existsSync(EXE)) throw new Error(`${EXE} is missing: build it first (host\\build.cmd)`);
  launch();
  main = await connectMain();
  check('News Center starts with its debugging port', true);

  // Only the test stream: every built-in channel and news source counts as removed. Written on
  // pagehide, after the page's own save, then the page reloads with it.
  const seed = await main.eval(`(() => {
    const state = {
      channels: [${JSON.stringify(TEST)}],
      removed: (window.NEWSCENTER_CHANNELS || []).map(channel => channel.id),
      layout: 'grid',
      news: { open: false, sources: [], removed: (window.NEWSCENTER_NEWS || []).map(source => source.id) },
    };
    addEventListener('pagehide', () => localStorage.setItem('${STORAGE_KEY}', JSON.stringify(state)));
    return state.removed.length;
  })()`);
  await main.send('Page.reload');
  await sleep(1500);
  await waitFor(() => main.eval('document.readyState === "complete" && Boolean(document.querySelector(".statusbar"))'), 30000, 'the dashboard after the reload');
  check('test channel set up', seed >= 0, `${seed} built-in channels set aside`);

  const codecs = await main.eval('typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(\'video/mp4; codecs="avc1.64001f,mp4a.40.2"\')');
  if (!codecs) console.log('This machine has no H.264/AAC decoder: playback checks are warnings only.');

  await waitFor(() => tileIn(main, TEST.id), 60000, 'the test stream in the grid');
  check('the test stream is in the grid', true);
  if (codecs) {
    const live = await waitFor(() => main.eval(`document.querySelector('.tile[data-id="${TEST.id}"]')?.dataset.status === 'live'`), 45000, 'the test stream to play').catch(() => false);
    check('it plays in the grid', live, '', { soft: true });
  }
  check('the own-window button is there', await main.eval(`getComputedStyle(document.querySelector('.tile[data-id="${TEST.id}"] .detach')).display !== 'none'`));
  await main.shot('1-main-before');

  // To its own window.
  await main.eval(`document.querySelector('.tile[data-id="${TEST.id}"] .detach').click()`);
  own = await connectWindow(TEST.id);
  check('the channel opens in its own window', true);
  check('it left the grid', await waitFor(async () => !(await tileIn(main, TEST.id)), 10000, 'the tile to leave').catch(() => false));
  check('the grid says where it went', await main.eval('document.querySelector("#empty-title")?.textContent.includes("own window")'), '', { soft: true });
  const title = await own.eval('document.title');
  check('the window is named after the channel', title.startsWith(TEST.name), title);
  check('Windows shows the window with that name', findWindows(TEST.name).length === 1, findWindows(TEST.name).join(' | '));
  if (codecs) {
    const playing = await waitFor(async () => {
      const state = await own.eval(`(() => { const v = document.querySelector('.tile video'); return { status: document.querySelector('.tile').dataset.status, time: v ? v.currentTime : 0 }; })()`);
      return state.status === 'live' && state.time > 1 ? state : null;
    }, 45000, 'the window to play').catch(() => null);
    check('the window plays the channel', Boolean(playing), playing ? `${playing.time.toFixed(1)} s in` : '');
  }

  // Its sound follows the main window's mixer, both ways.
  const heardAlone = () => own.eval('document.querySelector(".tile").classList.contains("is-focused") && document.querySelector(".focus-label").textContent === "Heard alone"');
  await own.eval('document.querySelector(".tile .ms.solo").click()');
  check('S in the window solos the channel in the main window', await waitFor(() => main.eval('document.querySelector("#any-solo").classList.contains("active")'), 5000, 'solo in the main window').catch(() => false));
  check('…and the window shows it', await waitFor(() => own.eval('document.querySelector(".tile .ms.solo").getAttribute("aria-pressed") === "true"'), 5000, 'the solo button').catch(() => false));
  await own.eval('document.querySelector(".tile .ms.solo").click()');
  check('S again stops soloing it', await waitFor(() => main.eval('!document.querySelector("#any-solo").classList.contains("active")'), 5000, 'no solo in the main window').catch(() => false));
  await own.eval('document.querySelector(".tile .focus-btn").click()');
  check('"Hear only this" makes it the one heard', await waitFor(heardAlone, 5000, 'heard alone').catch(() => false));
  await own.eval('document.querySelector(".tile .focus-btn").click()');
  check('…and again stops soloing it', await waitFor(async () => !(await heardAlone()) && await main.eval('!document.querySelector("#any-solo").classList.contains("active")'), 5000, 'not alone').catch(() => false));
  await own.eval('document.querySelector(".tile .ms.mute").click()');
  check('M in the window mutes it', await waitFor(() => own.eval('document.querySelector(".tile .ms.mute").getAttribute("aria-pressed") === "true" && document.querySelector(".tile").classList.contains("is-silent")'), 5000, 'mute').catch(() => false));
  await own.eval('document.querySelector(".tile .ms.mute").click()');

  // Pin on top, and fullscreen on its monitor.
  await own.eval('document.querySelector(".tile .pin").click()');
  check('the pin keeps the window on top', await waitFor(() => own.eval('document.querySelector(".tile .pin").getAttribute("aria-pressed") === "true"'), 5000, 'pinned').catch(() => false));
  check('Windows has it on top', findWindows(TEST.name).some(line => line.includes('[on top]')), findWindows(TEST.name).join(' | '));
  await own.eval('document.querySelector(".tile .fullscreen").click()');
  const full = await waitFor(() => own.eval('document.body.classList.contains("has-fullscreen") && innerWidth >= screen.width - 1 && innerHeight >= screen.height - 1 ? innerWidth + "x" + innerHeight : ""'), 5000, 'fullscreen').catch(() => '');
  check('fullscreen fills the screen', Boolean(full), full);
  await own.shot('2-window-fullscreen');
  await own.key('Escape', 'Escape', 27);
  check('Esc leaves fullscreen', await waitFor(() => own.eval('!document.body.classList.contains("has-fullscreen") && innerWidth < screen.width'), 5000, 'not fullscreen').catch(() => false));
  await own.eval('document.querySelector(".tile .pin").click()');
  await sleep(1500);
  await own.shot('3-window');
  await main.shot('4-main-with-window');
  desktopShot('5-desktop');

  // Back to the grid with the window's own button.
  await own.eval('document.querySelector(".tile .detach").click()');
  check('the window\'s button brings it back to the grid', await waitFor(() => tileIn(main, TEST.id), 10000, 'the tile to return').catch(() => false));
  check('…and its window closes', await waitFor(async () => !(await windowTarget(TEST.id)), 10000, 'the window to close').catch(() => false));
  own.close();

  // Closing the window the way a user does (its X, Alt+F4) brings the channel back too, and so does
  // another program closing it (Task Manager).
  for (const [closer, label] of [['user', 'closing the window (X, Alt+F4)'], ['program', 'another program closing the window (Task Manager)']]) {
    await main.eval(`document.querySelector('.tile[data-id="${TEST.id}"] .detach').click()`);
    own = await connectWindow(TEST.id);
    findWindows(TEST.name, closer);
    check(`${label} brings the channel back`, await waitFor(() => tileIn(main, TEST.id), 10000, 'the tile to return').catch(() => false));
    own.close();
    await waitFor(async () => !(await windowTarget(TEST.id)), 10000, 'the window to close').catch(() => {});
  }

  // A channel in its own window reopens there after a restart, where it was.
  await main.eval(`document.querySelector('.tile[data-id="${TEST.id}"] .detach').click()`);
  own = await connectWindow(TEST.id);
  await sleep(1000);
  own.close();
  main.close();
  await closeApp();
  check('News Center closes with the channel window open', app.exited);
  check('the window\'s place is remembered', existsSync(join(DATA, 'channel-windows.json')) && readFileSync(join(DATA, 'channel-windows.json'), 'utf8').includes(TEST.id));
  launch();
  main = await connectMain();
  own = await connectWindow(TEST.id, 60000).catch(() => null);
  check('after a restart it opens in its own window again', Boolean(own));
  check('…and not in the grid', !(await tileIn(main, TEST.id)));
  await sleep(1500);
  desktopShot('6-desktop-after-restart');
} catch (error) {
  check('test run', false, error.stack || String(error));
  desktopShot('failure-desktop');
} finally {
  own?.close();
  main?.close();
  await closeApp();
  const log = join(DATA, 'error.log');
  if (existsSync(log)) check('no errors in error.log', false, readFileSync(log, 'utf8').slice(-1500));
  check('no script errors', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));
  const failed = results.filter(result => result.level === 'FAIL');
  const warned = results.filter(result => result.level === 'WARN');
  const summary = [
    `## Channel in its own window: ${results.length - failed.length - warned.length} passed, ${warned.length} warnings, ${failed.length} failed`,
    'Screenshots: the run\'s desktop-test artifact.',
    '',
    ...[...failed, ...warned].map(result => `- **${result.level}** ${result.name}${result.detail ? ` — ${result.detail.replace(/\n/g, ' ').slice(0, 300)}` : ''}`),
  ].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  for (const result of failed) console.log(`::error::${result.name}${result.detail ? `: ${result.detail.slice(0, 200)}` : ''}`);
  for (const result of warned) console.log(`::warning::${result.name}${result.detail ? `: ${result.detail.slice(0, 200)}` : ''}`);
  console.log(`\n${results.length - failed.length} of ${results.length} passed (${warned.length} warnings)`);
  process.exitCode = failed.length ? 1 : 0;
}

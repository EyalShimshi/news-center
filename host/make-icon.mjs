// Renders ../app/icon.svg into NewsCenter.ico (16-256 px) with headless Microsoft Edge.
// Run with: node make-icon.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const EDGE = ['ProgramFiles(x86)', 'ProgramFiles']
  .map(variable => process.env[variable] && join(process.env[variable], 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  .find(path => path && existsSync(path));
const SIZES = [16, 20, 24, 32, 40, 48, 64, 256];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const svg = readFileSync(join(here, '..', 'app', 'icon.svg'));
const profile = mkdtempSync(join(tmpdir(), 'newscenter-icon-'));
const browser = spawn(EDGE, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });

async function render() {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 80 && !existsSync(portFile); i += 1) await sleep(250);
  const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const expression = `(async () => {
    const image = new Image();
    image.src = 'data:image/svg+xml;base64,${svg.toString('base64')}';
    await image.decode();
    return ${JSON.stringify(SIZES)}.map(size => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, size, size);
      if (size >= 256) return { size, png: canvas.toDataURL('image/png').split(',')[1] };
      const pixels = context.getImageData(0, 0, size, size).data;
      let binary = '';
      for (let i = 0; i < pixels.length; i += 1) binary += String.fromCharCode(pixels[i]);
      return { size, rgba: btoa(binary) };
    });
  })()`;
  const result = await new Promise(resolve => {
    socket.onmessage = event => resolve(JSON.parse(event.data));
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  socket.close();
  if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.text);
  return result.result.result.value;
}

// Closing through DevTools ends all of Edge's helper processes, unlike killing the main process.
async function closeBrowser() {
  try {
    const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim();
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await sleep(1500);
  } catch {
    // Fall back to ending the main process below.
  }
  if (browser.exitCode === null) browser.kill();
}

// Small sizes are stored as 32-bit bitmaps for the widest compatibility; 256 px as PNG.
function bitmapEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4, 20);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const from = (y * size + x) * 4;
      const to = ((size - 1 - y) * size + x) * 4;
      pixels[to] = rgba[from + 2];
      pixels[to + 1] = rgba[from + 1];
      pixels[to + 2] = rgba[from];
      pixels[to + 3] = rgba[from + 3];
    }
  }
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
  return Buffer.concat([header, pixels, mask]);
}

try {
  const images = await render();
  const entries = images.map(image => ({
    size: image.size,
    data: image.png ? Buffer.from(image.png, 'base64') : bitmapEntry(image.size, Buffer.from(image.rgba, 'base64')),
  }));
  const directory = Buffer.alloc(6 + 16 * entries.length);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(entries.length, 4);
  let offset = directory.length;
  entries.forEach((entry, index) => {
    const at = 6 + index * 16;
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(entry.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });
  writeFileSync(join(here, 'NewsCenter.ico'), Buffer.concat([directory, ...entries.map(entry => entry.data)]));
  console.log(`Wrote NewsCenter.ico (${SIZES.join(', ')} px)`);
} finally {
  await closeBrowser();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // Edge can hold the temporary profile briefly after exiting; the OS cleans the temp folder later.
  }
}

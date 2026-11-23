/*
 * News Center page-channel helper.
 *
 * The News Center window injects this script into every frame. It does nothing unless the frame
 * belongs to a web page that the dashboard shows as a channel. There it:
 *   - follows the dashboard's mute and volume for every video and audio element, including
 *     ads and nested frames, so the tile's M and S buttons work like for any other channel;
 *   - shows just the page's video player, filling the tile;
 *   - tells the dashboard whether the video is playing and how loud it is, for the tile's meter.
 */
(() => {
  'use strict';

  const APP_ORIGIN = 'https://newscenter.example';
  const PLAYER_SELECTORS = '.video-js, .jwplayer, .shaka-video-container, .plyr, .bitmovinplayer-container, .theoplayer-container';

  if (window.top === window) return;
  const ancestors = location.ancestorOrigins;
  if (!ancestors || !ancestors.length || ancestors[ancestors.length - 1] !== APP_ORIGIN) return;

  // The page that the dashboard embeds, as opposed to frames nested inside it (ads, players).
  const isChannelPage = ancestors.length === 1;
  const desired = { muted: true, volume: 1 };

  /* ---------- Sound ---------- */

  function follow(element) {
    try {
      if (element.muted !== desired.muted) element.muted = desired.muted;
      if (!desired.muted && Math.abs(element.volume - desired.volume) > 0.005) element.volume = desired.volume;
    } catch {
      // Some players lock their elements; they are retried on the next pass.
    }
  }

  function followEverywhere() {
    document.querySelectorAll('video, audio').forEach(follow);
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        frame.contentWindow.postMessage({ newscenterRelay: { muted: desired.muted, volume: desired.volume } }, '*');
      } catch {
        // The frame may be gone already.
      }
    }
  }

  // Apply the dashboard's sound settings before anything starts playing.
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function play(...args) {
    follow(this);
    return nativePlay.apply(this, args);
  };
  for (const type of ['loadstart', 'loadedmetadata', 'play', 'playing', 'volumechange']) {
    document.addEventListener(type, event => {
      if (event.target instanceof HTMLMediaElement) follow(event.target);
    }, true);
  }

  window.addEventListener('message', event => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (event.source !== window.parent) {
      if (typeof data.newscenterUp === 'string' && isChildFrame(event.source)) reportPointer(data.newscenterUp);
      return;
    }
    let next = null;
    if (isChannelPage && event.origin === APP_ORIGIN && data.newscenter === 'audio') next = data;
    else if (!isChannelPage && data.newscenterRelay && typeof data.newscenterRelay === 'object') next = data.newscenterRelay;
    if (!next) return;
    desired.muted = Boolean(next.muted);
    desired.volume = Math.min(1, Math.max(0, Number(next.volume) || 0));
    followEverywhere();
  });

  /* ---------- Pointer ---------- */

  // The dashboard can't see the pointer over a channel's page, nor over the frames inside it
  // (pop-ups, ads, players), so pointer activity is passed up to the channel page, which tells
  // the dashboard. That shows the tile's own buttons, and a click selects the channel.
  let lastHover = 0;

  function reportPointer(kind) {
    if (kind !== 'hover' && kind !== 'pointer') return;
    if (kind === 'hover') {
      const now = Date.now();
      if (now - lastHover < 250) return;
      lastHover = now;
    }
    if (isChannelPage) window.parent.postMessage({ newscenter: kind }, APP_ORIGIN);
    else window.parent.postMessage({ newscenterUp: kind }, '*');
  }

  function isChildFrame(source) {
    return [...document.querySelectorAll('iframe')].some(frame => frame.contentWindow === source);
  }

  // Frames on the page's own origin, such as pop-up messages written into an empty frame, don't
  // always get this helper, so they are watched from here.
  const watchedDocuments = new WeakSet();

  function watchFrames() {
    for (const frame of document.querySelectorAll('iframe')) {
      let doc = null;
      try {
        doc = frame.contentDocument;
      } catch {
        doc = null;
      }
      if (!doc || watchedDocuments.has(doc)) continue;
      watchedDocuments.add(doc);
      doc.addEventListener('pointermove', () => reportPointer('hover'), true);
      doc.addEventListener('pointerdown', () => reportPointer('pointer'), true);
    }
  }

  window.addEventListener('pointermove', () => reportPointer('hover'), true);
  window.addEventListener('pointerdown', () => reportPointer('pointer'), true);
  setInterval(() => {
    followEverywhere();
    watchFrames();
  }, 1000);

  if (!isChannelPage) return;

  const tell = message => window.parent.postMessage(message, APP_ORIGIN);

  // Leaving the page for the dashboard hides the tile's buttons again.
  window.addEventListener('pointerout', event => {
    if (event.relatedTarget) return;
    lastHover = 0;
    tell({ newscenter: 'hover-end' });
  }, true);

  /* ---------- Dashboard shortcuts ---------- */

  // Keys pressed inside the page never reach the dashboard, so its shortcuts are passed on.
  const SHORTCUT_CODES = new Set(['Escape', 'F5', 'KeyM', 'KeyS', 'KeyF', 'KeyR', 'KeyP', 'KeyG', 'KeyC', 'KeyN', 'KeyV',
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Slash',
    'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'Digit0', 'Numpad0']);
  const isEditable = element => element instanceof HTMLElement
    && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));
  // Enter stays with the page when it's on one of the page's own controls, like a pop-up's button.
  const CONTROLS = 'a[href], button, summary, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="switch"]';
  const isControl = element => element instanceof Element && Boolean(element.closest(CONTROLS));

  window.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || isEditable(event.target)) return;
    const enter = (event.code === 'Enter' || event.code === 'NumpadEnter') && !isControl(event.target);
    const shortcut = enter || SHORTCUT_CODES.has(event.code) || /^(?:Digit|Numpad)[1-9]$/.test(event.code);
    if (!shortcut || (event.code === 'Slash' && !event.shiftKey)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    tell({ newscenter: 'key', code: event.code, shiftKey: event.shiftKey });
  }, true);

  /* ---------- Player only ---------- */

  // Prompts that the page shows over its player stay visible, so the user can answer them:
  // some players stay paused until a pop-up (for example a Braze message) is closed.
  const PROMPT_SELECTORS = '.ab-iam-root, [aria-modal="true"], [role="alertdialog"], .ReactModal__Overlay';
  const ISOLATE_CSS = `
    html, body { overflow: hidden !important; background: #000 !important; }
    body { visibility: hidden !important; }
    [data-newscenter-player] {
      visibility: visible !important;
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
      border-radius: 0 !important;
      transform: none !important;
      z-index: 2147483646 !important;
      background: #000 !important;
    }
    :is(${PROMPT_SELECTORS}) { visibility: visible !important; z-index: 2147483647 !important; }
    [data-newscenter-ancestor] {
      transform: none !important;
      filter: none !important;
      perspective: none !important;
      contain: none !important;
      will-change: auto !important;
      backdrop-filter: none !important;
    }
  `;
  let player = null;
  let style = null;

  function largestVideo() {
    let best = null;
    let bestArea = 0;
    for (const video of document.querySelectorAll('video')) {
      const rect = video.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        best = video;
        bestArea = area;
      }
    }
    return bestArea >= 40000 ? best : null;
  }

  function findPlayer() {
    const known = [...document.querySelectorAll(PLAYER_SELECTORS)].find(element => element.querySelector('video'));
    if (known) return known;
    const video = largestVideo();
    if (!video) return null;
    // Climb to the player's container: the outermost ancestor that is still the video's size.
    const target = video.getBoundingClientRect();
    let element = video;
    while (element.parentElement && element.parentElement !== document.body) {
      const rect = element.parentElement.getBoundingClientRect();
      if (Math.abs(rect.width - target.width) > 8 || Math.abs(rect.height - target.height) > 8) break;
      element = element.parentElement;
    }
    return element;
  }

  function showPlayerOnly() {
    if (player && player.isConnected) return;
    const next = findPlayer();
    if (!next) return;
    document.querySelectorAll('[data-newscenter-ancestor]').forEach(element => element.removeAttribute('data-newscenter-ancestor'));
    if (player) player.removeAttribute('data-newscenter-player');
    player = next;
    player.setAttribute('data-newscenter-player', '');
    for (let element = player.parentElement; element && element !== document.documentElement; element = element.parentElement) {
      element.setAttribute('data-newscenter-ancestor', '');
    }
    if (!style || !style.isConnected) {
      style = document.createElement('style');
      style.textContent = ISOLATE_CSS;
      (document.head || document.documentElement).appendChild(style);
    }
    window.dispatchEvent(new Event('resize'));
  }

  /* ---------- Status and meter ---------- */

  let playing = null;
  let audioContext = null;
  let analysers = null;
  let tapped = null;
  const samples = new Float32Array(1024);

  const mainVideo = () => (player && player.querySelector('video')) || largestVideo();

  // captureStream copies the sound for measuring without changing what is heard.
  function tap(video) {
    if (tapped === video && analysers) return;
    tapped = video;
    analysers = null;
    try {
      const stream = video.captureStream();
      if (!stream.getAudioTracks().length) {
        tapped = null;
        return;
      }
      audioContext = audioContext || new AudioContext();
      const splitter = audioContext.createChannelSplitter(2);
      audioContext.createMediaStreamSource(stream).connect(splitter);
      analysers = [0, 1].map(index => {
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = samples.length;
        analyser.smoothingTimeConstant = 0;
        splitter.connect(analyser, index);
        return analyser;
      });
    } catch {
      analysers = null;
    }
  }

  function report() {
    const video = mainVideo();
    const isPlaying = Boolean(video && !video.paused && video.readyState > 2);
    if (isPlaying !== playing) {
      playing = isPlaying;
      tell({ newscenter: 'page-status', playing });
    }
    if (isPlaying) tap(video);
  }

  function measure() {
    if (!playing || !analysers || !audioContext || audioContext.state !== 'running') return;
    const levels = analysers.map(analyser => {
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const value = Math.abs(samples[i]);
        if (value > peak) peak = value;
      }
      return peak;
    });
    tell({ newscenter: 'levels', levels });
  }

  const start = () => {
    showPlayerOnly();
    report();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  setInterval(() => {
    showPlayerOnly();
    report();
  }, 1000);
  setInterval(measure, 80);
  tell({ newscenter: 'hello' });
})();

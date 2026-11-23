/*
 * News Center page-channel helper (Android), adapted from the desktop app's app/page-helper.js.
 *
 * News Center injects this script into every frame of a web-page channel (Channel 12's Mako page).
 *   - Every video and audio element, including ads and nested frames, follows the app's mute and
 *     volume, so the tile's M and S buttons work like for any other channel. Everything starts
 *     muted until the app says otherwise.
 *   - The page itself shows just its video player, filling the tile.
 * The app calls window.newscenterAudio(muted, volume), window.newscenterPause() and
 * window.newscenterResume() on the page.
 */
(() => {
  'use strict';

  if (window.__newscenterHelper) return;
  window.__newscenterHelper = true;

  const PLAYER_SELECTORS = '.video-js, .jwplayer, .shaka-video-container, .plyr, .bitmovinplayer-container, .theoplayer-container';
  const isChannelPage = window.top === window;
  const desired = { muted: true, volume: 1 };

  /* ---------- Sound ---------- */

  function follow(element) {
    try {
      if (element.muted !== desired.muted) element.muted = desired.muted;
      if (!desired.muted && Math.abs(element.volume - desired.volume) > 0.005) element.volume = desired.volume;
    } catch (error) {
      // Some players lock their elements; they are retried on the next pass.
    }
  }

  function followEverywhere() {
    document.querySelectorAll('video, audio').forEach(follow);
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        frame.contentWindow.postMessage({ newscenterRelay: { muted: desired.muted, volume: desired.volume } }, '*');
      } catch (error) {
        // The frame may be gone already.
      }
    }
  }

  function setDesired(muted, volume) {
    desired.muted = Boolean(muted);
    desired.volume = Math.min(1, Math.max(0, Number(volume) || 0));
    followEverywhere();
  }

  // Apply the app's sound settings before anything starts playing.
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

  // Nested frames take their sound settings from the frame that contains them.
  window.addEventListener('message', event => {
    const data = event.data;
    if (isChannelPage || event.source !== window.parent || !data || typeof data !== 'object') return;
    const next = data.newscenterRelay;
    if (next && typeof next === 'object') setDesired(next.muted, next.volume);
  });

  setInterval(followEverywhere, 1000);

  if (!isChannelPage) return;

  window.newscenterAudio = setDesired;
  window.newscenterPause = () => {
    document.querySelectorAll('video, audio').forEach(element => {
      try {
        element.pause();
      } catch (error) {
        // Nothing to pause.
      }
    });
  };
  window.newscenterResume = () => {
    const video = mainVideo();
    if (video && video.paused) video.play().catch(() => {});
  };

  /* ---------- Player only ---------- */

  // Prompts that the page shows over its player stay visible, so the user can answer them:
  // some players stay paused until a pop-up is closed.
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

  function mainVideo() {
    return (player && player.querySelector('video')) || largestVideo();
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

  const start = () => showPlayerOnly();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  setInterval(showPlayerOnly, 1000);
})();

/* News Center: a multiview dashboard for live TV. */
(() => {
  'use strict';

  const STORAGE_KEY = 'newscenter.state.v2';
  const ASPECT = 16 / 9;
  const MIN_TILE_WIDTH = 200;
  const MAX_VOLUME = 2;
  const UNITY_SNAP = 0.04;
  const RETRY_DELAYS_MS = [3000, 6000, 12000, 20000, 30000];
  const STALL_LIMIT_MS = 20000;
  const CONNECT_LIMIT_MS = 45000;
  const RECHECK_OFFLINE_MS = 60000;
  const DISCOVERY_INTERVAL_MS = 5 * 60 * 1000;
  const FORGET_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
  const IDLE_AFTER_MS = 2500;
  const METER_RANGE_DB = 60;
  const METER_RELEASE_PER_SECOND = 0.9;
  const PEAK_HOLD_MS = 1500;
  const PAGE_LEVELS_TIMEOUT_MS = 1000;
  const KNESSET_LIVE_URL = 'https://www.knesset.tv/live/';
  const KNESSET_MAIN_NAME = 'ערוץ הכנסת';
  const DRAG_THRESHOLD = 6;
  const FOCUS_FLASH_MS = 900;
  const PAGE_HOVER_MS = 3000;
  const NEWS_REFRESH_MS = 3 * 60 * 1000;
  const NEWS_RETRY_MS = [60 * 1000, 3 * 60 * 1000, 10 * 60 * 1000];
  const NEWS_TICK_MS = 15000;
  const NEWS_MAX_AGE_MS = 48 * 60 * 60 * 1000;
  const NEWS_FRESH_MS = 10 * 60 * 1000;
  const NEWS_PER_SOURCE = 60;
  const NEWS_SHOWN = 250;
  // Smallest and default size of the news panel: its width beside the tiles, its height below them.
  const NEWS_SIZE = { width: [260, 380], height: [160, 360] };
  const NEWS_BLOCKED = "Blocked by this network's web filter";

  const HLS_CONFIG = {
    capLevelToPlayerSize: true,
    abrEwmaDefaultEstimate: 2500000,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 10,
    maxBufferLength: 20,
    backBufferLength: 30,
  };

  const STATUS_LABELS = {
    checking: 'Checking',
    connecting: 'Connecting',
    live: 'Live',
    buffering: 'Buffering',
    offline: 'Off air',
    error: 'Reconnecting',
    web: 'Web',
    hidden: 'Hidden',
    unlisted: 'Not listed',
  };

  const BUILTIN_CHANNELS = Array.isArray(window.NEWSCENTER_CHANNELS) ? window.NEWSCENTER_CHANNELS : [];
  const BUILTIN_NEWS = Array.isArray(window.NEWSCENTER_NEWS) ? window.NEWSCENTER_NEWS : [];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const loudness = volume => volume * volume;

  const dom = {
    topbar: $('.topbar'),
    stage: $('#stage'),
    stageSizer: $('#stage-sizer'),
    zoom: $('#zoom'),
    emptyState: $('#empty-state'),
    emptyTitle: $('#empty-title'),
    emptyText: $('#empty-text'),
    emptyAction: $('#empty-action'),
    summary: $('#summary'),
    clock: $('#clock'),
    refresh: $('#refresh'),
    banner: $('#audio-banner'),
    layoutButtons: $$('[data-layout]'),
    anySolo: $('#any-solo'),
    anyMute: $('#any-mute'),
    masterMute: $('#master-mute'),
    masterVolume: $('#master-volume'),
    masterMeter: $('#master-meter'),
    managerButton: $('#open-manager'),
    manager: $('#manager'),
    managerCount: $('#manager-count'),
    channelList: $('#channel-list'),
    importFile: $('#import-file'),
    channelDialog: $('#channel-dialog'),
    channelForm: $('#channel-form'),
    channelDialogTitle: $('#channel-dialog-title'),
    urlFeedback: $('#url-feedback'),
    testRow: $('#test-row'),
    testResult: $('#test-result'),
    confirmDialog: $('#confirm-dialog'),
    helpDialog: $('#help-dialog'),
    toasts: $('#toasts'),
    revealZone: $('.reveal-zone'),
    tileTemplate: $('#tile-template'),
    rowTemplate: $('#row-template'),
    tabs: $$('#manager [role="tab"]'),
    channelsPanel: $('#channels-panel'),
    sourcesPanel: $('#sources-panel'),
    sourceList: $('#source-list'),
    sourcesCount: $('#sources-count'),
    sourceTemplate: $('#source-template'),
    sourceDialog: $('#source-dialog'),
    sourceForm: $('#source-form'),
    sourceDialogTitle: $('#source-dialog-title'),
    sourceUrl: $('#source-url'),
    sourceName: $('#source-name'),
    sourceTestResult: $('#source-test-result'),
    newsToggle: $('#toggle-news'),
    news: $('#news'),
    newsResizer: $('#news-resizer'),
    newsStatus: $('#news-status'),
    newsRefresh: $('#news-refresh'),
    newsFilters: $('#news-filters'),
    newsList: $('#news-list'),
    newsEmpty: $('#news-empty'),
    newsEmptyText: $('#news-empty-text'),
    newsEmptyAction: $('#news-empty-action'),
    newsItemTemplate: $('#news-item-template'),
  };

  const fields = {
    name: $('#field-name'),
    description: $('#field-description'),
    kind: $('#field-kind'),
    url: $('#field-url'),
    poster: $('#field-poster'),
    enabled: $('#field-enabled'),
  };

  /* ---------- Helpers ---------- */

  function makeId(prefix = 'ch') {
    return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  function cleanText(value, maxLength) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
  }

  function isHttpUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
      const { protocol } = new URL(value.trim());
      return protocol === 'https:' || protocol === 'http:';
    } catch {
      return false;
    }
  }

  function hostName(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  // Sites News Center never contacts, whatever a saved source, a link or a redirect says.
  const BLOCKED_DOMAINS = ['srugim.co.il'];

  function isBlockedUrl(url) {
    const host = hostName(String(url || '').trim()).toLowerCase().replace(/\.$/, '');
    return BLOCKED_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
  }

  function bidi(text) {
    const element = document.createElement('bdi');
    element.textContent = text;
    return element;
  }

  // Like the News Center window does: the charset the server names, else the one the document
  // declares (feeds such as <?xml encoding="windows-1255"?>), else UTF-8.
  function decodeBody(buffer, contentType) {
    const bytes = new Uint8Array(buffer);
    const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 2048));
    const named = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType || '');
    const declared = /<\?xml[^>]*?\bencoding\s*=\s*["']([\w.:-]+)|<meta[^>]+?charset\s*=\s*["']?([\w.:-]+)/i.exec(head);
    for (const label of [named && named[1], declared && (declared[1] || declared[2]), 'utf-8']) {
      if (!label) continue;
      try {
        return new TextDecoder(label).decode(bytes);
      } catch {
        // Not an encoding this browser knows; try the next one.
      }
    }
    return '';
  }

  /* ---------- News Center window ---------- */

  // Inside the News Center window (WebView2) the host draws nothing itself: the page provides the
  // window controls, and the host fetches pages that cross-site rules hide from a browser tab.
  const host = (() => {
    const webview = window.chrome && window.chrome.webview;
    const listeners = new Map();
    const pending = new Map();
    let nextId = 1;
    if (webview) {
      webview.addEventListener('message', event => {
        const message = event.data;
        if (!message || typeof message !== 'object') return;
        if (message.type === 'fetch-result') {
          const resolve = pending.get(message.id);
          if (resolve) {
            pending.delete(message.id);
            resolve(message);
          }
          return;
        }
        (listeners.get(message.type) || []).forEach(listener => listener(message));
      });
    }
    return {
      available: Boolean(webview),
      post(message) {
        if (webview) webview.postMessage(message);
      },
      on(type, listener) {
        listeners.set(type, [...(listeners.get(type) || []), listener]);
      },
      async fetchText(url) {
        if (isBlockedUrl(url)) throw new Error('this site is blocked in News Center');
        if (!webview) {
          const response = await fetch(url, { cache: 'no-store' });
          const text = decodeBody(await response.arrayBuffer(), response.headers.get('content-type'));
          return { ok: response.ok, status: response.status, url: response.url, text };
        }
        const id = String(nextId++);
        const result = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`no answer from ${hostName(url)}`));
          }, 30000);
          pending.set(id, message => {
            clearTimeout(timer);
            resolve(message);
          });
          webview.postMessage({ type: 'fetch', id, url });
        });
        if (!result.status) throw new Error(result.error || `could not reach ${hostName(url)}`);
        return result;
      },
    };
  })();

  /* ---------- Channel state ---------- */

  const maxVolume = kind => (kind === 'page' ? 1 : MAX_VOLUME);

  function normalizeChannel(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = cleanText(raw.name, 80);
    const url = cleanText(raw.url, 2048);
    if (!name || !isHttpUrl(url) || isBlockedUrl(url)) return null;
    const kind = raw.kind === 'page' ? 'page' : 'stream';
    return {
      id: cleanText(raw.id, 240) || makeId(),
      name,
      description: cleanText(raw.description, 160),
      kind,
      url,
      poster: isHttpUrl(raw.poster) ? raw.poster.trim() : '',
      enabled: raw.enabled !== false,
      auto: raw.auto === 'knesset' ? 'knesset' : '',
      builtin: raw.builtin === true,
      edited: raw.edited === true,
      listed: raw.listed !== false,
      lastSeen: Number.isFinite(raw.lastSeen) ? raw.lastSeen : 0,
      now: cleanText(raw.now, 300),
      volume: Number.isFinite(raw.volume) ? clamp(raw.volume, 0, maxVolume(kind)) : 1,
      meter: raw.meter !== false,
      // Every channel starts muted each time News Center opens.
      muted: true,
      soloed: false,
    };
  }

  function builtinChannels() {
    return BUILTIN_CHANNELS.map(normalizeChannel)
      .filter(Boolean)
      .map(channel => ({ ...channel, builtin: true, edited: false }));
  }

  function sameDefinition(a, b) {
    return a.name === b.name && a.description === b.description && a.kind === b.kind && a.url === b.url && a.poster === b.poster;
  }

  // Keeps saved channels in sync with channels.js: unedited built-ins pick up changes, and new
  // built-ins appear unless the user removed them. A new built-in goes right after the built-in
  // listed before it in channels.js, so it joins its neighbours instead of trailing the Knesset streams.
  function mergeBuiltins(channels, removed) {
    const builtins = new Map(builtinChannels().map(channel => [channel.id, channel]));
    const seen = new Set();
    const merged = [];
    for (const channel of channels) {
      if (seen.has(channel.id)) continue;
      const builtin = builtins.get(channel.id);
      if (builtin) {
        if (!channel.builtin) {
          channel.builtin = true;
          channel.edited = !sameDefinition(channel, builtin);
        }
        if (!channel.edited) {
          const { name, description, kind, url, poster, auto } = builtin;
          Object.assign(channel, { name, description, kind, url, poster, auto });
        }
      } else if (channel.builtin) {
        if (!channel.edited) continue;
        channel.builtin = false;
      }
      seen.add(channel.id);
      merged.push(channel);
    }
    let previous = -1;
    for (const builtin of builtins.values()) {
      const index = merged.findIndex(channel => channel.id === builtin.id);
      if (index >= 0) {
        previous = index;
      } else if (!removed.includes(builtin.id)) {
        previous += 1;
        merged.splice(previous, 0, builtin);
      }
    }
    return merged;
  }

  const SOURCE_COLORS = ['#5b8cff', '#f5a524', '#34d399', '#f472b6', '#38bdf8', '#a78bfa', '#fb923c', '#facc15'];

  function normalizeSource(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = cleanText(raw.name, 60);
    const url = cleanText(raw.url, 2048);
    if (!name || !isHttpUrl(url) || isBlockedUrl(url)) return null;
    return {
      id: cleanText(raw.id, 120) || makeId('news'),
      name,
      url,
      lang: raw.lang === 'he' || raw.lang === 'en' ? raw.lang : '',
      color: /^#[0-9a-f]{3,8}$/i.test(raw.color || '') ? raw.color : '',
      enabled: raw.enabled === true,
      builtin: raw.builtin === true,
      edited: raw.edited === true,
    };
  }

  function builtinSources() {
    return BUILTIN_NEWS.map(normalizeSource)
      .filter(Boolean)
      .map(source => ({ ...source, builtin: true, edited: false }));
  }

  // Like the channels: unedited built-in sources follow news.js, new ones appear unless the
  // user removed them, and each source stays switched on or off as the user left it.
  function mergeSources(saved, removed) {
    const builtins = builtinSources();
    const builtinIds = new Set(builtins.map(source => source.id));
    const byId = new Map(saved.map(source => [source.id, source]));
    const merged = [];
    for (const builtin of builtins) {
      const source = byId.get(builtin.id);
      if (!source) {
        if (!removed.includes(builtin.id)) merged.push(builtin);
        continue;
      }
      source.builtin = true;
      source.lang = builtin.lang;
      source.color = builtin.color;
      if (!source.edited) Object.assign(source, { name: builtin.name, url: builtin.url });
      merged.push(source);
    }
    for (const source of byId.values()) {
      if (builtinIds.has(source.id) || (source.builtin && !source.edited)) continue;
      source.builtin = false;
      merged.push(source);
    }
    return merged;
  }

  function loadNews(saved) {
    const data = saved && typeof saved === 'object' ? saved : {};
    // Only built-in sources can be "removed"; ids that left the built-in list are forgotten.
    const removed = Array.isArray(data.removed) ? data.removed.filter(id => typeof id === 'string' && BUILTIN_NEWS.some(source => source.id === id)) : [];
    return {
      open: data.open !== false,
      filter: typeof data.filter === 'string' ? data.filter : 'all',
      width: Number.isFinite(data.width) ? data.width : NEWS_SIZE.width[1],
      height: Number.isFinite(data.height) ? data.height : NEWS_SIZE.height[1],
      sources: Array.isArray(data.sources) ? mergeSources(data.sources.map(normalizeSource).filter(Boolean), removed) : builtinSources(),
      removed,
    };
  }

  function loadState() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      saved = null;
    }
    const valid = saved && typeof saved === 'object' && Array.isArray(saved.channels);
    const removed = valid && Array.isArray(saved.removed) ? saved.removed.filter(id => typeof id === 'string') : [];
    const master = valid && saved.master && typeof saved.master === 'object' ? saved.master : {};
    return {
      channels: valid ? mergeBuiltins(saved.channels.map(normalizeChannel).filter(Boolean), removed) : builtinChannels(),
      removed,
      layout: valid && saved.layout === 'spotlight' ? 'spotlight' : 'grid',
      zoom: valid && Number.isFinite(saved.zoom) ? clamp(saved.zoom, -1, 1) : 0,
      spotlightId: valid && typeof saved.spotlightId === 'string' ? saved.spotlightId : null,
      selectedId: valid && typeof saved.selectedId === 'string' ? saved.selectedId : null,
      master: {
        volume: Number.isFinite(master.volume) ? clamp(master.volume, 0, MAX_VOLUME) : 1,
        muted: master.muted === true,
      },
      news: loadNews(valid ? saved.news : null),
    };
  }

  // While a Knesset recording plays, the TV channels are silent (not saved).
  let tvSilenced = false;
  const state = loadState();
  const tiles = new Map();
  let saveTimer = 0;

  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeState, 150);
  }

  // Mute and solo are not saved: every session starts with all channels muted.
  function writeState() {
    clearTimeout(saveTimer);
    try {
      const channels = state.channels.map(({ muted, soloed, ...channel }) => channel);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, channels }));
    } catch (error) {
      console.warn('News Center could not save its settings.', error);
    }
  }

  const findChannel = id => state.channels.find(channel => channel.id === id) || null;

  // Whether each stream is on air right now. Not saved: it is checked on every start.
  const runtime = new Map();

  function runtimeOf(id) {
    let info = runtime.get(id);
    if (!info) {
      info = { availability: 'checking', detail: '', lastCheck: 0, pending: null };
      runtime.set(id, info);
    }
    return info;
  }

  const isListed = channel => channel.auto !== 'knesset' || channel.listed;
  const wantsScreen = channel => channel.enabled && isListed(channel);
  const availabilityOf = channel => (channel.kind === 'page' ? 'live' : runtimeOf(channel.id).availability);

  // Off-air streams stay out of the grid and come back by themselves when they go live.
  function isShown(channel) {
    if (!wantsScreen(channel)) return false;
    const availability = availabilityOf(channel);
    return availability === 'live' || availability === 'error';
  }

  const shownChannels = () => state.channels.filter(isShown);
  const orderedTiles = () => shownChannels().map(channel => tiles.get(channel.id)).filter(Boolean);
  const selectedTile = () => tiles.get(state.selectedId) || orderedTiles()[0] || null;

  function channelStatus(channel) {
    if (!channel.enabled) return 'hidden';
    if (!isListed(channel)) return 'unlisted';
    const tile = tiles.get(channel.id);
    return tile ? tile.status : availabilityOf(channel);
  }

  /* ---------- Audio ---------- */

  // Each stream runs through its own gain (volume, mute, solo) into a master gain and a limiter,
  // so volumes above 100% boost quiet channels without clipping. Meters read the signal before
  // the channel gain, so a muted channel still shows activity.
  const audio = {
    ctx: null,
    master: null,
    masterAnalysers: [],

    init() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      try {
        this.ctx = new AudioContextClass({ latencyHint: 'playback' });
      } catch (error) {
        console.warn('Web Audio is unavailable; using basic volume control.', error);
        return;
      }
      this.master = this.ctx.createGain();
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.2;
      this.master.connect(limiter);
      limiter.connect(this.ctx.destination);
      this.masterAnalysers = createStereoAnalysers(this.ctx, limiter);
      this.ctx.addEventListener('statechange', refreshAudioLock);
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    },

    attach(video) {
      if (!this.ctx) return null;
      const source = this.ctx.createMediaElementSource(video);
      const input = this.ctx.createGain();
      input.channelCount = 2;
      input.channelCountMode = 'explicit';
      input.channelInterpretation = 'speakers';
      const output = this.ctx.createGain();
      source.connect(input);
      input.connect(output);
      output.connect(this.master);
      return { nodes: [source, input, output], output, analysers: createStereoAnalysers(this.ctx, input) };
    },

    detach(chain) {
      if (chain) chain.nodes.forEach(node => node.disconnect());
    },

    setGain(node, value) {
      node.gain.setTargetAtTime(value, this.ctx.currentTime, 0.015);
    },
  };

  function createStereoAnalysers(ctx, node) {
    const splitter = ctx.createChannelSplitter(2);
    node.connect(splitter);
    return [0, 1].map(channel => {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0;
      splitter.connect(analyser, channel);
      return analyser;
    });
  }

  const meterSamples = new Float32Array(1024);

  function analyserPeaks(analysers) {
    return analysers.map(analyser => {
      analyser.getFloatTimeDomainData(meterSamples);
      let peak = 0;
      for (let i = 0; i < meterSamples.length; i += 1) {
        const sample = Math.abs(meterSamples[i]);
        if (sample > peak) peak = sample;
      }
      return peak;
    });
  }

  class Meter {
    constructor(root) {
      this.bars = $$('.meter-bar', root).map(element => ({ element, level: 0, peak: 0, peakTime: 0, shownLevel: -1, shownPeak: -1 }));
    }

    update(peaks, now, elapsedSeconds) {
      this.bars.forEach((bar, index) => {
        const peak = peaks ? peaks[index] || 0 : 0;
        const target = peak > 0 ? clamp(1 + (20 * Math.log10(peak)) / METER_RANGE_DB, 0, 1) : 0;
        bar.level = target >= bar.level ? target : Math.max(target, bar.level - METER_RELEASE_PER_SECOND * elapsedSeconds);
        if (bar.level >= bar.peak || now - bar.peakTime > PEAK_HOLD_MS) {
          bar.peak = bar.level;
          bar.peakTime = now;
        }
        const level = Math.round(bar.level * 200) / 200;
        const held = Math.round(bar.peak * 200) / 200;
        if (level !== bar.shownLevel) {
          bar.shownLevel = level;
          bar.element.style.setProperty('--level', level);
        }
        if (held !== bar.shownPeak) {
          bar.shownPeak = held;
          bar.element.style.setProperty('--peak', held);
        }
      });
    }
  }

  const masterMeter = new Meter(dom.masterMeter);

  function applyAudio() {
    const shown = shownChannels();
    const soloActive = shown.some(channel => channel.soloed);
    const anyMuted = shown.some(channel => channel.muted);
    const masterGain = state.master.muted || tvSilenced ? 0 : loudness(state.master.volume);

    for (const tile of tiles.values()) {
      const { channel, ui, el } = tile;
      const audible = !channel.muted && (!soloActive || channel.soloed);
      tile.setGain(audible ? loudness(channel.volume) : 0, masterGain);
      el.classList.toggle('is-muted', channel.muted);
      el.classList.toggle('is-soloed', channel.soloed);
      el.classList.toggle('is-silent', !audible);
      ui.mute.setAttribute('aria-pressed', String(channel.muted));
      ui.solo.setAttribute('aria-pressed', String(channel.soloed));
      ui.audioFlag.title = channel.muted ? 'Muted' : 'Silent while other channels are soloed';
      setFader(ui.fader, channel.volume);
    }

    if (audio.ctx) audio.setGain(audio.master, masterGain);
    dom.anySolo.disabled = !soloActive;
    dom.anySolo.classList.toggle('active', soloActive);
    dom.anySolo.title = soloActive ? 'Clear all solos' : 'No channel is soloed';
    dom.anyMute.classList.toggle('active', anyMuted);
    dom.anyMute.title = anyMuted ? 'Unmute all channels' : 'Mute all channels';
    const masterSilent = state.master.muted || state.master.volume === 0;
    dom.masterMute.setAttribute('aria-pressed', String(state.master.muted));
    dom.masterMute.title = state.master.muted ? 'Unmute all sound' : 'Mute all sound';
    $('use', dom.masterMute).setAttribute('href', masterSilent ? '#i-volume-off' : '#i-volume');
    setFader(dom.masterVolume, state.master.volume);
    renderFocus();
  }

  function setFader(input, volume) {
    const max = Number(input.max) || 200;
    const percent = Math.round(volume * 100);
    if (input.valueAsNumber !== percent) input.value = String(percent);
    input.style.setProperty('--fill', `${(percent / max) * 100}%`);
    input.classList.toggle('is-boosted', percent > 100);
    input.title = percent > 100 ? `Volume ${percent}% (boosted)` : `Volume ${percent}%`;
  }

  // The slider snaps to 100% when it passes close by.
  function faderValue(input) {
    const value = input.valueAsNumber / 100;
    return Math.abs(value - 1) <= UNITY_SNAP ? 1 : value;
  }

  function refreshAudioLock() {
    const contextBlocked = Boolean(audio.ctx) && audio.ctx.state !== 'running';
    const mediaBlocked = [...tiles.values()].some(tile => tile.autoplayBlocked);
    dom.banner.hidden = !(contextBlocked || mediaBlocked);
  }

  function unlockAudio() {
    if (audio.ctx && audio.ctx.state !== 'running') audio.ctx.resume().catch(() => {});
    for (const tile of tiles.values()) {
      if (!tile.autoplayBlocked) continue;
      tile.autoplayBlocked = false;
      tile.play();
    }
    applyAudio();
    refreshAudioLock();
  }

  /* ---------- Tiles ---------- */

  function createTileElement(channel, kind) {
    const el = dom.tileTemplate.content.firstElementChild.cloneNode(true);
    el.dataset.id = channel.id;
    el.dataset.kind = kind;
    el.classList.add('is-new');
    $('.poster', el).addEventListener('error', event => { event.target.hidden = true; });
    return el;
  }

  function tileParts(el) {
    return {
      number: $('.num', el),
      name: $('.name', el),
      description: $('.desc', el),
      stats: $('.stats', el),
      statusText: $('.status-text', el),
      poster: $('.poster', el),
      overlayTitle: $('.overlay-title', el),
      overlayDetail: $('.overlay-detail', el),
      audioFlag: $('.audio-flag', el),
      mute: $('.ms.mute', el),
      solo: $('.ms.solo', el),
      fader: $('.fader', el),
      fullscreen: $('.fullscreen', el),
      focus: $('.focus-btn', el),
      focusIcon: $('.focus-btn use', el),
      focusLabel: $('.focus-label', el),
      meterToggle: $('.meter-toggle', el),
      meterIcon: $('.meter-toggle use', el),
    };
  }

  function bindTileControls(tile) {
    const { el, ui } = tile;
    const id = () => tile.channel.id;
    el.addEventListener('pointerdown', () => selectChannel(id()));
    ui.mute.addEventListener('click', () => toggleMute(id()));
    ui.solo.addEventListener('click', event => toggleSolo(id(), event.ctrlKey || event.metaKey));
    ui.fader.addEventListener('input', () => setVolume(id(), faderValue(ui.fader)));
    ui.fader.addEventListener('dblclick', () => setVolume(id(), 1));
    $('.reload', el).addEventListener('click', () => tile.restart());
    $('.retry', el).addEventListener('click', () => tile.restart());
    $('.spotlight', el).addEventListener('click', () => toggleSpotlight(id()));
    ui.fullscreen.addEventListener('click', () => toggleFullscreen(id()));
    $('.screen', el).addEventListener('dblclick', () => toggleFullscreen(id()));
    // The second click of a double-click would undo the first.
    ui.focus.addEventListener('click', event => {
      if (event.detail <= 1) toggleFocus(id());
    });
    ui.meterToggle.addEventListener('click', () => toggleMeter(id()));
    for (const button of [ui.focus, ui.meterToggle]) button.addEventListener('dblclick', event => event.stopPropagation());
  }

  function renderMeterToggle(tile) {
    const { ui, channel } = tile;
    const label = channel.meter ? 'Hide the level meter (V)' : 'Show the level meter (V)';
    tile.el.classList.toggle('meter-off', !channel.meter);
    if (ui.meterToggle.title === label) return;
    ui.meterToggle.title = label;
    ui.meterToggle.setAttribute('aria-label', label);
    ui.meterIcon.setAttribute('href', channel.meter ? '#i-meter-off' : '#i-meter');
  }

  function renderTileInfo(tile, number) {
    const { ui, channel, el } = tile;
    const secondLine = channel.now || channel.description;
    ui.number.textContent = String(number);
    ui.name.textContent = channel.name;
    ui.description.textContent = secondLine;
    ui.description.title = secondLine;
    ui.description.hidden = !secondLine;
    el.setAttribute('aria-label', `${number}. ${channel.name}`);
    if (!channel.poster) {
      ui.poster.removeAttribute('src');
      ui.poster.hidden = true;
    } else if (ui.poster.getAttribute('src') !== channel.poster) {
      ui.poster.hidden = false;
      ui.poster.src = channel.poster;
    }
    renderMeterToggle(tile);
  }

  class StreamTile {
    constructor(channel) {
      this.kind = 'stream';
      this.channel = channel;
      this.url = channel.url;
      this.el = createTileElement(channel, 'stream');
      this.ui = tileParts(this.el);
      this.video = $('video', this.el);
      this.video.crossOrigin = 'anonymous';
      this.meter = new Meter($('.meter', this.el));
      this.audio = audio.attach(this.video);
      this.hls = null;
      this.status = '';
      this.detail = '';
      this.retryCount = 0;
      this.retryTimer = 0;
      this.retryAt = 0;
      this.mediaRecoveries = 0;
      this.lastTime = -1;
      this.lastProgress = Date.now();
      this.autoplayBlocked = false;
      this.statsText = '';
      bindTileControls(this);
      this.bindMedia();
      this.start();
    }

    bindMedia() {
      const { video } = this;
      video.addEventListener('playing', () => {
        this.retryCount = 0;
        this.mediaRecoveries = 0;
        this.lastProgress = Date.now();
        this.setStatus('live');
        setAvailability(this.channel.id, 'live');
      });
      video.addEventListener('waiting', () => {
        if (this.status === 'live') this.setStatus('buffering');
      });
      video.addEventListener('timeupdate', () => {
        if (video.currentTime === this.lastTime) return;
        this.lastTime = video.currentTime;
        this.lastProgress = Date.now();
        if (this.status === 'buffering') this.setStatus('live');
      });
      video.addEventListener('pause', () => {
        // A live channel should never stay paused, e.g. after a system media key.
        setTimeout(() => {
          if (video.paused && !this.autoplayBlocked && (this.status === 'live' || this.status === 'buffering')) this.play();
        }, 500);
      });
      video.addEventListener('error', () => this.recover('Playback error'));
    }

    start() {
      clearTimeout(this.retryTimer);
      this.retryTimer = 0;
      this.teardown();
      this.lastTime = -1;
      this.lastProgress = Date.now();
      this.setStatus('connecting');
      const Hls = window.Hls;
      if (Hls && Hls.isSupported()) {
        const hls = new Hls({ ...HLS_CONFIG });
        this.hls = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (this.hls === hls) this.play();
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (this.hls === hls) this.onHlsError(data);
        });
        hls.loadSource(this.url);
        hls.attachMedia(this.video);
      } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
        this.video.src = this.url;
        this.play();
      } else {
        this.setStatus('error', 'This browser cannot play HLS streams');
      }
    }

    restart() {
      this.retryCount = 0;
      this.mediaRecoveries = 0;
      this.start();
    }

    teardown() {
      const { hls, video } = this;
      if (hls) {
        this.hls = null;
        hls.destroy();
      } else if (video.hasAttribute('src')) {
        video.removeAttribute('src');
        video.load();
      }
    }

    play() {
      const attempt = this.video.play();
      if (!attempt) return;
      attempt.catch(error => {
        if (error.name !== 'NotAllowedError' || this.video.muted) return;
        // Sound needs a click first; keep the picture running in the meantime.
        this.autoplayBlocked = true;
        this.video.muted = true;
        refreshAudioLock();
        this.video.play().catch(() => {});
      });
    }

    setGain(gain, masterGain) {
      if (this.audio) {
        audio.setGain(this.audio.output, gain);
      } else {
        const volume = clamp(gain * masterGain, 0, 1);
        this.video.volume = volume;
        this.video.muted = this.autoplayBlocked || volume === 0;
      }
    }

    onHlsError(data) {
      if (!data.fatal) return;
      const { ErrorTypes, ErrorDetails } = window.Hls;
      if (data.type === ErrorTypes.MEDIA_ERROR) {
        this.recover(describeHlsError(data));
        return;
      }
      const code = data.response && data.response.code;
      if (code >= 400 && code < 500) this.goOffAir(`HTTP ${code}`);
      else if (data.details === ErrorDetails.LEVEL_EMPTY_ERROR) this.goOffAir('Not broadcasting');
      else this.scheduleRetry(describeHlsError(data));
    }

    recover(reason) {
      if (this.retryTimer) return;
      if (this.hls && this.mediaRecoveries < 2) {
        this.mediaRecoveries += 1;
        this.hls.recoverMediaError();
        return;
      }
      this.scheduleRetry(reason);
    }

    // The stream stopped broadcasting: the tile leaves the grid until it is back on air.
    goOffAir(detail) {
      clearTimeout(this.retryTimer);
      this.retryTimer = 0;
      this.teardown();
      setAvailability(this.channel.id, 'offline', detail);
    }

    scheduleRetry(detail) {
      this.teardown();
      clearTimeout(this.retryTimer);
      const delay = RETRY_DELAYS_MS[Math.min(this.retryCount, RETRY_DELAYS_MS.length - 1)];
      this.retryCount += 1;
      this.retryAt = Date.now() + delay;
      this.retryTimer = setTimeout(() => this.start(), delay);
      this.setStatus('error', detail);
    }

    setStatus(status, detail = '') {
      const changed = status !== this.status;
      this.status = status;
      this.detail = detail;
      this.el.dataset.status = status;
      this.ui.statusText.textContent = STATUS_LABELS[status] || status;
      this.renderOverlay();
      this.renderStats();
      if (changed) onTileStatus(this);
    }

    renderOverlay() {
      let title = '';
      let detail = '';
      if (this.status === 'connecting') {
        title = 'Connecting…';
      } else if (this.status === 'error') {
        const seconds = Math.max(0, Math.ceil((this.retryAt - Date.now()) / 1000));
        title = 'Connection problem';
        detail = this.retryTimer ? `${this.detail} · retrying in ${seconds}s` : this.detail;
      }
      if (this.ui.overlayTitle.textContent !== title) this.ui.overlayTitle.textContent = title;
      if (this.ui.overlayDetail.textContent !== detail) this.ui.overlayDetail.textContent = detail;
    }

    renderStats() {
      let text = '';
      if (this.status === 'live' || this.status === 'buffering') {
        const parts = [];
        const { hls, video } = this;
        if (video.videoHeight) parts.push(`${video.videoHeight}p`);
        const level = hls && hls.levels && hls.levels[hls.currentLevel];
        if (level && level.bitrate) parts.push(`${(level.bitrate / 1e6).toFixed(1)} Mb/s`);
        if (hls && Number.isFinite(hls.latency) && hls.latency > 0) parts.push(`${Math.round(hls.latency)}s delay`);
        text = parts.join(' · ');
      }
      if (text !== this.statsText) {
        this.statsText = text;
        this.ui.stats.textContent = text;
      }
    }

    tick(now) {
      if (this.status === 'error') {
        this.renderOverlay();
        return;
      }
      if (!(this.autoplayBlocked && this.video.paused)) {
        const idle = now - this.lastProgress;
        if ((this.status === 'live' || this.status === 'buffering') && idle > STALL_LIMIT_MS) {
          this.scheduleRetry('The stream stalled');
          return;
        }
        if (this.status === 'connecting' && idle > CONNECT_LIMIT_MS) {
          this.scheduleRetry('No video received');
          return;
        }
      }
      this.renderStats();
    }

    update(channel, number) {
      this.channel = channel;
      renderTileInfo(this, number);
      if (channel.url !== this.url) {
        this.url = channel.url;
        this.restart();
      }
    }

    destroy() {
      clearTimeout(this.retryTimer);
      this.retryTimer = 0;
      this.status = 'removed';
      this.teardown();
      this.video.pause();
      audio.detach(this.audio);
      this.el.remove();
    }
  }

  // A web page with its own player, shown inside the tile. The injected page helper
  // (page-helper.js) follows this tile's sound settings and reports playback and levels.
  class PageTile {
    constructor(channel) {
      this.kind = 'page';
      this.channel = channel;
      this.url = channel.url;
      this.status = '';
      this.el = createTileElement(channel, 'page');
      this.ui = tileParts(this.el);
      this.ui.fader.max = '100';
      this.meter = new Meter($('.meter', this.el));
      this.levels = null;
      this.levelsAt = 0;
      this.sound = { muted: true, volume: 0 };
      this.frame = document.createElement('iframe');
      this.frame.className = 'page-frame';
      this.frame.title = channel.name;
      this.frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
      this.frame.referrerPolicy = 'no-referrer';
      $('video', this.el).replaceWith(this.frame);
      this.frame.addEventListener('load', () => this.sendSound());
      this.frame.src = this.url;
      bindTileControls(this);
      this.setStatus('web');
    }

    setStatus(status) {
      if (status === this.status) return;
      this.status = status;
      this.el.dataset.status = status;
      this.ui.statusText.textContent = status === 'live' ? STATUS_LABELS.live : STATUS_LABELS.web;
      onTileStatus(this);
    }

    setGain(gain, masterGain) {
      const volume = clamp(gain * masterGain, 0, 1);
      const next = { muted: volume === 0, volume };
      if (next.muted === this.sound.muted && next.volume === this.sound.volume) return;
      this.sound = next;
      this.sendSound();
    }

    sendSound() {
      const target = this.frame.contentWindow;
      if (target) target.postMessage({ newscenter: 'audio', muted: this.sound.muted, volume: this.sound.volume }, '*');
    }

    receive(data) {
      if (data.newscenter === 'hello') {
        this.sendSound();
      } else if (data.newscenter === 'page-status') {
        this.setStatus(data.playing ? 'live' : 'web');
      } else if (data.newscenter === 'levels' && Array.isArray(data.levels)) {
        this.levels = data.levels.slice(0, 2).map(value => clamp(Number(value) || 0, 0, 1));
        this.levelsAt = performance.now();
      } else if (data.newscenter === 'pointer') {
        selectChannel(this.channel.id);
        markActive();
      } else if (data.newscenter === 'hover' || data.newscenter === 'hover-end') {
        // Like a video player's controls, the tile's buttons hide when the pointer rests.
        clearTimeout(this.hoverTimer);
        const hovered = data.newscenter === 'hover';
        this.el.classList.toggle('is-hovered', hovered);
        if (hovered) this.hoverTimer = setTimeout(() => this.el.classList.remove('is-hovered'), PAGE_HOVER_MS);
      } else if (data.newscenter === 'key' && typeof data.code === 'string') {
        handleShortcut({ code: data.code, shiftKey: Boolean(data.shiftKey) });
      }
    }

    restart() {
      this.setStatus('web');
      this.frame.src = this.url;
    }

    update(channel, number) {
      this.channel = channel;
      this.frame.title = channel.name;
      renderTileInfo(this, number);
      if (channel.url !== this.url) {
        this.url = channel.url;
        this.restart();
      }
    }

    tick() {}

    destroy() {
      this.frame.src = 'about:blank';
      this.el.remove();
    }
  }

  function describeHlsError(data) {
    const code = data.response && data.response.code;
    if (code) return `HTTP ${code}`;
    if (!data.details) return 'Playback error';
    const words = data.details.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  window.addEventListener('message', event => {
    const data = event.data;
    if (!data || typeof data !== 'object' || typeof data.newscenter !== 'string') return;
    for (const tile of tiles.values()) {
      if (tile.kind === 'page' && tile.frame.contentWindow === event.source) {
        tile.receive(data);
        return;
      }
    }
  });

  /* ---------- On air or not ---------- */

  let started = false;

  // A stream counts as live when its playlist (or its first variant) lists video segments.
  async function checkStream(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const outcome = response => ({
      availability: response.status >= 400 && response.status < 500 ? 'offline' : 'error',
      detail: `HTTP ${response.status}`,
    });
    try {
      let response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) return outcome(response);
      let text = await response.text();
      if (!text.trimStart().startsWith('#EXTM3U')) return { availability: 'offline', detail: 'Not an HLS playlist' };
      if (!/#EXTINF/i.test(text)) {
        const variant = text.split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#'));
        if (!variant) return { availability: 'offline', detail: 'Empty playlist' };
        response = await fetch(new URL(variant, response.url).href, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return outcome(response);
        text = await response.text();
        if (!/#EXTINF/i.test(text)) return { availability: 'offline', detail: 'Not broadcasting' };
      }
      return { availability: 'live', detail: '' };
    } catch (error) {
      return { availability: 'error', detail: error.name === 'AbortError' ? 'No answer' : 'Unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }

  function checkChannel(channel) {
    if (channel.kind !== 'stream') return Promise.resolve();
    const info = runtimeOf(channel.id);
    if (!info.pending) {
      const { id, url } = channel;
      info.pending = checkStream(url).then(result => {
        info.pending = null;
        info.lastCheck = Date.now();
        // Ignore answers about an address the channel no longer uses.
        const current = findChannel(id);
        if (runtime.get(id) === info && current && current.url === url) setAvailability(id, result.availability, result.detail);
      });
    }
    return info.pending;
  }

  function setAvailability(id, availability, detail = '') {
    const info = runtimeOf(id);
    const previous = info.availability;
    info.availability = availability;
    info.detail = detail;
    if (availability === 'offline') info.lastCheck = Date.now();
    if (previous === availability) return;
    const channel = findChannel(id);
    if (started && channel && previous === 'offline' && availability === 'live' && wantsScreen(channel)) {
      showToast([bidi(channel.name), ' is live']);
    }
    syncChannels(true);
  }

  function recheckOffAir(now) {
    for (const channel of state.channels) {
      if (channel.kind !== 'stream' || !wantsScreen(channel)) continue;
      const info = runtimeOf(channel.id);
      if (info.availability === 'offline' && !info.pending && now - info.lastCheck > RECHECK_OFFLINE_MS) checkChannel(channel);
    }
  }

  /* ---------- Knesset streams ---------- */

  const discovery = { running: null, lastRun: 0, lastError: '' };

  function parseHtml(text) {
    return new DOMParser().parseFromString(text, 'text/html');
  }

  // knesset.tv embeds its player as watch.knesset.tv?src=<stream>&poster=<image>.
  function playerStream(src, base) {
    let player;
    try {
      player = new URL(src.replace(/&amp;/g, '&'), base);
    } catch {
      return null;
    }
    const stream = player.searchParams.get('src');
    if (!isHttpUrl(stream) || !/\.m3u8$/i.test(new URL(stream).pathname)) return null;
    const url = new URL(stream);
    const poster = player.searchParams.get('poster');
    return {
      id: `knesset:${url.host}${url.pathname.replace(/\/[^/]*$/, '')}`,
      url: url.href,
      poster: isHttpUrl(poster) ? new URL(poster).href : '',
    };
  }

  // Entries that knesset.tv hides on its live page are left out.
  const isHiddenEntry = element => element.hidden || /display\s*:\s*none/i.test(element.getAttribute('style') || '');

  async function discoverKnesset() {
    const page = await host.fetchText(KNESSET_LIVE_URL);
    if (!page.ok) throw new Error(`knesset.tv answered HTTP ${page.status}`);
    const doc = parseHtml(page.text);
    const found = [];

    const mainFrame = doc.querySelector('.main-live-video-container iframe[src]');
    const main = mainFrame && playerStream(mainFrame.getAttribute('src'), page.url);
    if (main) {
      const program = cleanText($('.main-video-desc', doc)?.textContent, 300) || cleanText($('.main-video-title', doc)?.textContent, 300);
      found.push({ ...main, name: KNESSET_MAIN_NAME, description: 'Knesset Channel', now: program });
    }

    const entries = $$('.secondary-video-container', doc).filter(element => !isHiddenEntry(element));
    // A committee page that fails to load leaves the listing incomplete; then nothing is unlisted.
    let complete = true;
    const pages = await Promise.all(entries.map(async entry => {
      const link = $('a[href]', entry);
      if (!link) return null;
      try {
        const response = await host.fetchText(new URL(link.getAttribute('href'), page.url).href);
        if (!response.ok) {
          complete = false;
          return null;
        }
        const entryDoc = parseHtml(response.text);
        const frame = $('.video-page-player iframe[src], iframe.video-iframe[src]', entryDoc);
        const stream = frame && playerStream(frame.getAttribute('src'), response.url);
        if (!stream) return null;
        const name = cleanText($('.secondary-video-title', entry)?.textContent, 80) || cleanText($('.heading-block h1', entryDoc)?.textContent, 80);
        const now = cleanText($('.heading-block h6', entryDoc)?.textContent, 300);
        return { ...stream, name: name || 'Knesset broadcast', description: 'Knesset · live broadcast', now };
      } catch {
        complete = false;
        return null;
      }
    }));
    for (const item of pages) {
      if (item && !found.some(existing => existing.url === item.url)) found.push(item);
    }
    return { found, complete };
  }

  function applyDiscovery(found, complete) {
    const now = Date.now();
    const foundIds = new Set();
    const added = [];
    for (const item of found) {
      foundIds.add(item.id);
      let channel = findChannel(item.id);
      if (!channel) {
        if (state.removed.includes(item.id)) continue;
        channel = normalizeChannel({ ...item, auto: 'knesset' });
        if (!channel) continue;
        const lastKnesset = state.channels.map(existing => existing.auto).lastIndexOf('knesset');
        state.channels.splice(lastKnesset >= 0 ? lastKnesset + 1 : state.channels.length, 0, channel);
        added.push(channel);
      } else if (!channel.edited) {
        if (channel.url !== item.url) {
          channel.url = item.url;
          runtime.delete(channel.id);
        }
        if (!channel.builtin) {
          channel.name = item.name;
          channel.description = item.description;
          if (item.poster) channel.poster = item.poster;
        }
      }
      channel.auto = 'knesset';
      channel.listed = true;
      channel.lastSeen = now;
      channel.now = item.now || '';
    }
    if (!complete) return added;
    for (const channel of [...state.channels]) {
      if (channel.auto !== 'knesset' || foundIds.has(channel.id)) continue;
      channel.listed = false;
      if (!channel.builtin && !channel.edited && now - channel.lastSeen > FORGET_AFTER_MS) {
        state.channels.splice(state.channels.indexOf(channel), 1);
      }
    }
    return added;
  }

  function setRefreshing(busy) {
    dom.refresh.classList.toggle('is-busy', busy);
    dom.refresh.disabled = busy;
  }

  // Looks for new Knesset streams; runs on start, every few minutes, and on refresh.
  function runDiscovery({ announce = false } = {}) {
    if (discovery.running) return discovery.running;
    discovery.running = (async () => {
      try {
        const { found, complete } = await discoverKnesset();
        const added = applyDiscovery(found, complete);
        discovery.lastError = '';
        discovery.lastRun = Date.now();
        saveState();
        syncChannels(true);
        await Promise.all(state.channels.filter(channel => channel.auto === 'knesset' && wantsScreen(channel)).map(checkChannel));
        const liveAdded = added.filter(channel => availabilityOf(channel) === 'live');
        if (started && liveAdded.length) {
          showToast(liveAdded.length === 1 ? ['New Knesset stream: ', bidi(liveAdded[0].name)] : `${liveAdded.length} new Knesset streams`);
        }
        return { found, added };
      } catch (error) {
        discovery.lastError = error.message;
        if (announce) showToast(`Couldn't check knesset.tv: ${error.message}`);
        return null;
      } finally {
        discovery.running = null;
        renderChannelList();
        renderEmptyState();
      }
    })();
    return discovery.running;
  }

  let refreshing = false;

  // The global refresh: look for new streams, recheck everything and reload what is playing.
  async function refreshAll() {
    if (refreshing) return;
    refreshing = true;
    setRefreshing(true);
    loadDueSources(true);
    try {
      const result = await runDiscovery({ announce: true });
      await Promise.all(state.channels.filter(channel => channel.kind === 'stream' && wantsScreen(channel)).map(checkChannel));
      for (const tile of tiles.values()) tile.restart();
      syncChannels(true);
      const live = shownChannels().length;
      const offAir = state.channels.filter(channel => channel.kind === 'stream' && wantsScreen(channel) && availabilityOf(channel) === 'offline').length;
      const added = result ? result.added.length : 0;
      showToast(`Refreshed · ${live} on screen${offAir ? `, ${offAir} off air` : ''}${added ? `, ${added} new` : ''}`);
    } finally {
      refreshing = false;
      setRefreshing(false);
    }
  }

  /* ---------- Sync ---------- */

  function onTileStatus(tile) {
    renderSummary();
    const row = dom.channelList.querySelector(`[data-id="${CSS.escape(tile.channel.id)}"]`);
    if (row) paintRow(row, tile.channel);
  }

  // Creates, updates and removes tiles to match the channel list and what is on air.
  function syncChannels(animate = false) {
    const shown = shownChannels();
    const shownIds = new Set(shown.map(channel => channel.id));
    if (drag && drag.active && (drag.order.length !== shown.length || drag.order.some(tile => !shownIds.has(tile.channel.id)))) {
      endDrag(false);
    }
    for (const channel of state.channels) {
      if (!shownIds.has(channel.id)) channel.soloed = false;
    }
    for (const [id, tile] of tiles) {
      const channel = findChannel(id);
      if (!shownIds.has(id) || !channel || channel.kind !== tile.kind) {
        tile.destroy();
        tiles.delete(id);
      }
    }
    shown.forEach((channel, index) => {
      let tile = tiles.get(channel.id);
      if (!tile) {
        tile = channel.kind === 'page' ? new PageTile(channel) : new StreamTile(channel);
        tiles.set(channel.id, tile);
        dom.stage.append(tile.el);
      }
      tile.update(channel, index + 1);
    });
    if (!tiles.has(state.selectedId)) {
      // Keep a saved selection while that channel is still being checked at start-up.
      const selected = findChannel(state.selectedId);
      const pending = selected && wantsScreen(selected) && availabilityOf(selected) === 'checking';
      if (!pending) state.selectedId = shown.length ? shown[0].id : null;
    }
    if (fullscreenId && !tiles.has(fullscreenId)) setFullscreen(null);
    renderSelection();
    applyAudio();
    relayout(animate);
    renderChannelList();
    renderSummary();
    renderEmptyState();
    refreshAudioLock();
  }

  /* ---------- Layout ---------- */

  // The largest equal tiles that fit `count` channels into width x height, and the grid shape.
  function fitGrid(count, width, height, gap, bar) {
    let best = null;
    for (let cols = 1; cols <= count; cols += 1) {
      const rows = Math.ceil(count / cols);
      const cellWidth = (width - gap * (cols - 1)) / cols;
      const cellHeight = (height - gap * (rows - 1)) / rows;
      const tileWidth = Math.max(0, Math.min(cellWidth, (cellHeight - bar) * ASPECT));
      if (!best || tileWidth > best.tileWidth + 0.5) best = { cols, rows, tileWidth };
    }
    return best;
  }

  const blockHeight = (rows, tileWidth, gap, bar) => rows * (tileWidth / ASPECT + bar) + (rows - 1) * gap;

  // Rows of equal tiles, each row centered, starting at `top`.
  function placeRows(count, cols, tileWidth, width, top, gap, bar) {
    const tileHeight = tileWidth / ASPECT + bar;
    return Array.from({ length: count }, (_, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      const inRow = Math.min(cols, count - row * cols);
      const left = (width - (inRow * tileWidth + (inRow - 1) * gap)) / 2;
      return { x: left + col * (tileWidth + gap), y: top + row * (tileHeight + gap), w: tileWidth, h: tileHeight };
    });
  }

  // Zoom 0 fits every channel on screen. Positive zoom grows the tiles up to the full width, with
  // fewer per row, and the stage scrolls. Negative zoom shrinks them, so more fit side by side.
  function gridLayout(count, width, height, gap, bar) {
    const fit = fitGrid(count, width, height, gap, bar);
    let { cols, rows, tileWidth } = fit;
    if (state.zoom > 0) {
      tileWidth = fit.tileWidth + (width - fit.tileWidth) * state.zoom;
      cols = clamp(Math.floor((width + gap) / (tileWidth + gap)), 1, count);
      rows = Math.ceil(count / cols);
    } else if (state.zoom < 0) {
      // Smaller sizes go by whole columns, with each row filling the width.
      const smallest = Math.min(fit.tileWidth, Math.max(MIN_TILE_WIDTH, fit.tileWidth * 0.35));
      const wanted = fit.tileWidth + (fit.tileWidth - smallest) * state.zoom;
      cols = clamp(Math.floor((width + gap) / (wanted + gap)), 1, count);
      rows = Math.ceil(count / cols);
      const rowWidth = (width - gap * (cols - 1)) / cols;
      const heightFit = ((height - gap * (rows - 1)) / rows - bar) * ASPECT;
      tileWidth = Math.max(0, Math.min(rowWidth, heightFit));
    }
    const total = blockHeight(rows, tileWidth, gap, bar);
    const top = Math.max(0, (height - total) / 2);
    return { rects: placeRows(count, cols, tileWidth, width, top, gap, bar), height: Math.max(height, total) };
  }

  // One large tile and the others beside it, or below it on a tall (portrait) screen.
  function spotlightLayout(count, mainIndex, width, height, gap, bar) {
    const others = count - 1;
    if (height > width) {
      const mainWidth = Math.max(0, Math.min(width, (height * 0.6 - bar) * ASPECT));
      const mainHeight = mainWidth / ASPECT + bar;
      const fit = fitGrid(others, width, height - mainHeight - gap, gap, bar);
      const total = mainHeight + gap + blockHeight(fit.rows, fit.tileWidth, gap, bar);
      const top = Math.max(0, (height - total) / 2);
      const rest = placeRows(others, fit.cols, fit.tileWidth, width, top + mainHeight + gap, gap, bar);
      const main = { x: (width - mainWidth) / 2, y: top, w: mainWidth, h: mainHeight, main: true };
      return { rects: [...rest.slice(0, mainIndex), main, ...rest.slice(mainIndex)], height };
    }
    const sideCols = others <= 4 ? 1 : others <= 8 ? 2 : 3;
    const sideRows = Math.ceil(others / sideCols);
    const sideWidth = clamp(
      ((height - gap * (sideRows - 1)) / sideRows - bar) * ASPECT,
      0,
      (width * 0.3 - gap * (sideCols - 1)) / sideCols,
    );
    const sideHeight = sideWidth / ASPECT + bar;
    const sideBlockWidth = sideCols * sideWidth + (sideCols - 1) * gap;
    const mainWidth = Math.max(0, Math.min(width - sideBlockWidth - gap, (height - bar) * ASPECT));
    const mainHeight = mainWidth / ASPECT + bar;
    const left = (width - (mainWidth + gap + sideBlockWidth)) / 2;
    const sideTop = (height - (sideRows * sideHeight + (sideRows - 1) * gap)) / 2;
    const sideLeft = left + mainWidth + gap;
    let sideIndex = 0;
    const rects = Array.from({ length: count }, (_, index) => {
      if (index === mainIndex) return { x: left, y: (height - mainHeight) / 2, w: mainWidth, h: mainHeight, main: true };
      const col = sideIndex % sideCols;
      const row = Math.floor(sideIndex / sideCols);
      sideIndex += 1;
      return { x: sideLeft + col * (sideWidth + gap), y: sideTop + row * (sideHeight + gap), w: sideWidth, h: sideHeight };
    });
    return { rects, height };
  }

  function spotlightId() {
    const ids = shownChannels().map(channel => channel.id);
    if (ids.includes(state.spotlightId)) return state.spotlightId;
    return tiles.has(state.selectedId) ? state.selectedId : ids[0];
  }

  function stageMetrics() {
    const styles = getComputedStyle(document.documentElement);
    const gap = parseFloat(styles.getPropertyValue('--gap')) || 12;
    const bar = parseFloat(styles.getPropertyValue('--bar-h')) || 46;
    return { gap, bar, width: dom.stage.clientWidth - gap * 2, height: dom.stage.clientHeight - gap * 2 };
  }

  // Where each tile goes, for tiles in this order with this channel in the spotlight.
  function computeLayout(list, mainId, { gap, bar, width, height }) {
    const mainIndex = state.layout === 'spotlight' && list.length > 1 ? Math.max(0, list.findIndex(tile => tile.channel.id === mainId)) : -1;
    return mainIndex >= 0
      ? spotlightLayout(list.length, mainIndex, width, height, gap, bar)
      : gridLayout(list.length, width, height, gap, bar);
  }

  function placeTile(tile, rect, gap) {
    tile.rect = rect;
    const { style } = tile.el;
    style.transform = `translate(${Math.round(rect.x + gap)}px, ${Math.round(rect.y + gap)}px)`;
    style.width = `${Math.round(rect.w)}px`;
    style.height = `${Math.round(rect.h)}px`;
    tile.el.classList.toggle('is-main', Boolean(rect.main));
  }

  function layoutTiles() {
    if (drag && drag.active) {
      previewDrag(true);
      return;
    }
    const list = orderedTiles();
    const zoomed = state.layout === 'grid' && state.zoom > 0;
    dom.stage.classList.toggle('is-zoomed', zoomed);
    const metrics = stageMetrics();
    if (!list.length || metrics.width <= 0 || metrics.height <= 0) {
      dom.stageSizer.style.height = '0';
      return;
    }
    const layout = computeLayout(list, spotlightId(), metrics);
    // Tiles are positioned absolutely, so this sets how far the stage scrolls (including its padding).
    dom.stageSizer.style.height = `${Math.ceil(layout.height + metrics.gap * 2)}px`;
    list.forEach((tile, index) => {
      placeTile(tile, layout.rects[index], metrics.gap);
      if (tile.el.classList.contains('is-new')) setTimeout(() => tile.el.classList.remove('is-new'), 400);
    });
  }

  /* ---------- Moving channels around ---------- */

  // A channel is carried by dragging anywhere on its tile except its buttons and sliders
  // (a web-page channel by its bar). The other tiles make room as it moves.
  let drag = null;
  let suppressClick = false;
  let scrollFrame = 0;

  // The pointer's position in the stage's scrolling content, where tiles are placed.
  function stagePoint(event) {
    const box = dom.stage.getBoundingClientRect();
    return {
      x: event.clientX - box.left - dom.stage.clientLeft + dom.stage.scrollLeft,
      y: event.clientY - box.top - dom.stage.clientTop + dom.stage.scrollTop,
    };
  }

  const contains = (rect, x, y) => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;

  function nearestRect(rects, x, y) {
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < rects.length; index += 1) {
      const rect = rects[index];
      if (contains(rect, x, y)) return index;
      const distance = (x - (rect.x + rect.w / 2)) ** 2 + (y - (rect.y + rect.h / 2)) ** 2;
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    return best;
  }

  // What dropping the carried tile here would do: the new order and, in Spotlight, which channel
  // is the big one. Dropping on the big tile, or dragging the big tile onto another, swaps them.
  function dropTarget(point, metrics) {
    const { order, tile } = drag;
    const x = point.x - metrics.gap;
    const y = point.y - metrics.gap;
    const moveTo = (list, index) => {
      const rest = list.filter(other => other !== tile);
      rest.splice(index, 0, tile);
      return rest;
    };
    const swap = (list, a, b) => list.map(other => (other === a ? b : other === b ? a : other));
    if (state.layout !== 'spotlight' || order.length < 2) {
      const { rects } = gridLayout(order.length, metrics.width, metrics.height, metrics.gap, metrics.bar);
      const index = nearestRect(rects, x, y);
      return { key: `grid:${index}`, order: moveTo(order, index), mainId: null };
    }
    const main = order.find(other => other.channel.id === drag.mainId) || order[0];
    const { rects } = spotlightLayout(order.length, 0, metrics.width, metrics.height, metrics.gap, metrics.bar);
    if (contains(rects[0], x, y)) {
      return { key: 'main', order: swap(order, tile, main), mainId: tile.channel.id };
    }
    const others = order.filter(other => other !== main);
    const index = nearestRect(rects.slice(1), x, y);
    if (tile === main) {
      const target = others[index];
      return { key: `side:${index}`, order: swap(order, tile, target), mainId: target.channel.id };
    }
    const placed = moveTo(others, index);
    placed.splice(order.indexOf(main), 0, main);
    return { key: `side:${index}`, order: placed, mainId: main.channel.id };
  }

  function beginDrag(event) {
    const list = orderedTiles();
    const { tile } = drag;
    if (list.length < 2 || !tile.rect || !list.includes(tile)) return false;
    const metrics = stageMetrics();
    const point = stagePoint(event);
    // The big spotlight tile shrinks to the size of the others while it is carried.
    const side = tile.rect.main ? list.find(other => other !== tile && other.rect && !other.rect.main) : null;
    const width = side ? side.rect.w : tile.rect.w;
    const height = side ? side.rect.h : tile.rect.h;
    Object.assign(drag, {
      active: true,
      order: list,
      mainId: state.layout === 'spotlight' ? spotlightId() : null,
      width,
      height,
      offsetX: (point.x - (tile.rect.x + metrics.gap)) * (width / tile.rect.w),
      offsetY: (point.y - (tile.rect.y + metrics.gap)) * (height / tile.rect.h),
      target: null,
    });
    tile.el.classList.add('is-dragging');
    dom.stage.classList.add('is-reordering');
    document.body.classList.add('is-dragging-tile');
    try {
      tile.el.setPointerCapture(drag.pointerId);
    } catch {
      // The pointer is already gone; the drag ends with the next pointer event.
    }
    return true;
  }

  // Moves the carried tile with the pointer and the others to where they would go.
  function previewDrag(force = false) {
    const metrics = stageMetrics();
    const point = stagePoint(drag.lastEvent);
    const target = dropTarget(point, metrics);
    if (force || !drag.target || target.key !== drag.target.key) {
      const layout = computeLayout(target.order, target.mainId, metrics);
      target.order.forEach((tile, index) => {
        if (tile !== drag.tile) placeTile(tile, layout.rects[index], metrics.gap);
      });
    }
    drag.target = target;
    const { style } = drag.tile.el;
    style.transform = `translate(${Math.round(point.x - drag.offsetX)}px, ${Math.round(point.y - drag.offsetY)}px)`;
    style.width = `${Math.round(drag.width)}px`;
    style.height = `${Math.round(drag.height)}px`;
  }

  // Scrolls the stage while a tile is held near its top or bottom edge.
  function autoScroll() {
    if (scrollFrame) return;
    const step = () => {
      scrollFrame = 0;
      if (!drag || !drag.active) return;
      const box = dom.stage.getBoundingClientRect();
      const y = drag.lastEvent.clientY;
      const edge = 56;
      const reach = y < box.top + edge ? y - (box.top + edge) : y > box.bottom - edge ? y - (box.bottom - edge) : 0;
      if (!reach) return;
      const before = dom.stage.scrollTop;
      dom.stage.scrollTop += Math.sign(reach) * Math.min(24, Math.abs(reach) / 2);
      if (dom.stage.scrollTop === before) return;
      previewDrag();
      scrollFrame = requestAnimationFrame(step);
    };
    scrollFrame = requestAnimationFrame(step);
  }

  // Puts the channels on screen in this order, leaving the others where they are in the list.
  function applyTileOrder(ids) {
    const byId = new Map(state.channels.map(channel => [channel.id, channel]));
    const ordered = ids.map(id => byId.get(id));
    if (ordered.some(channel => !channel)) return;
    const moving = new Set(ids);
    let next = 0;
    state.channels.forEach((channel, index) => {
      if (moving.has(channel.id)) state.channels[index] = ordered[next++];
    });
  }

  function endDrag(commit) {
    const finished = drag;
    drag = null;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    if (!finished || !finished.active) return;
    const { tile, target } = finished;
    try {
      tile.el.releasePointerCapture(finished.pointerId);
    } catch {
      // Already released.
    }
    tile.el.classList.remove('is-dragging');
    dom.stage.classList.remove('is-reordering');
    document.body.classList.remove('is-dragging-tile');
    // The drag ends with a click on the tile; that click shouldn't do anything.
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (commit && target) {
      const ids = target.order.map(other => other.channel.id);
      const moved = ids.join('\n') !== finished.order.map(other => other.channel.id).join('\n');
      const newMain = state.layout === 'spotlight' && Boolean(target.mainId) && target.mainId !== spotlightId();
      if (moved) applyTileOrder(ids);
      if (newMain) state.spotlightId = target.mainId;
      if (moved || newMain) {
        saveState();
        syncChannels(true);
        return;
      }
    }
    relayout(true);
  }

  function bindTileDragging() {
    dom.stage.addEventListener('pointerdown', event => {
      if (event.button !== 0 || drag || fullscreenId) return;
      const el = event.target.closest('.tile');
      if (!el || event.target.closest('button, input, select, a, iframe')) return;
      const tile = tiles.get(el.dataset.id);
      if (tile) drag = { tile, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastEvent: event, active: false };
    });
    document.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.lastEvent = event;
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return;
        if (!beginDrag(event)) {
          drag = null;
          return;
        }
      }
      previewDrag();
      autoScroll();
    });
    document.addEventListener('pointerup', event => {
      if (drag && event.pointerId === drag.pointerId) endDrag(true);
    });
    document.addEventListener('pointercancel', event => {
      if (drag && event.pointerId === drag.pointerId) endDrag(false);
    });
    window.addEventListener('blur', () => {
      if (drag) endDrag(false);
    });
    dom.stage.addEventListener('scroll', () => {
      if (drag && drag.active) previewDrag();
    });
    dom.stage.addEventListener('click', event => {
      if (!suppressClick) return;
      suppressClick = false;
      event.stopPropagation();
      event.preventDefault();
    }, true);
  }

  function setZoom(value) {
    const zoom = clamp(Math.round(value * 100) / 100, -1, 1);
    const leaveSpotlight = state.layout !== 'grid';
    if (zoom !== state.zoom || leaveSpotlight) {
      state.zoom = zoom;
      if (leaveSpotlight) {
        state.layout = 'grid';
        renderLayoutButtons();
      }
      relayout(false);
      revealTile(state.selectedId, 'auto');
      saveState();
    }
    renderZoom();
  }

  // The slider snaps to Fit when it passes close by.
  function zoomValue(input) {
    const value = input.valueAsNumber / 100;
    return Math.abs(value) <= 0.03 ? 0 : value;
  }

  function renderZoom() {
    const percent = Math.round(state.zoom * 100);
    if (dom.zoom.valueAsNumber !== percent) dom.zoom.value = String(percent);
    dom.zoom.style.setProperty('--fill', `${(percent + 100) / 2}%`);
    dom.zoom.title = percent > 0
      ? 'Tile size: bigger than fit, the grid scrolls (0 or double-click to fit)'
      : percent < 0
        ? 'Tile size: smaller than fit, more channels side by side (0 or double-click to fit)'
        : 'Tile size: everything fits on screen';
  }

  // Scrolls a tile into view when the tiles are bigger than the screen.
  function revealTile(id, behavior = 'smooth') {
    const tile = tiles.get(id);
    if (tile && dom.stage.scrollHeight > dom.stage.clientHeight + 1) tile.el.scrollIntoView({ block: 'nearest', behavior });
  }

  let animationTimer = 0;
  function relayout(animate) {
    if (animate) {
      dom.stage.classList.add('animate');
      clearTimeout(animationTimer);
      animationTimer = setTimeout(() => dom.stage.classList.remove('animate'), 350);
    }
    layoutTiles();
    renderFocus();
  }

  function setLayout(layout) {
    if (state.layout === layout) return;
    state.layout = layout;
    if (layout === 'spotlight' && !tiles.has(state.spotlightId)) state.spotlightId = state.selectedId;
    renderLayoutButtons();
    relayout(true);
    saveState();
  }

  function toggleSpotlight(id) {
    selectChannel(id);
    if (state.layout === 'spotlight' && spotlightId() === id) {
      setLayout('grid');
      return;
    }
    state.spotlightId = id;
    state.layout = 'spotlight';
    renderLayoutButtons();
    relayout(true);
    saveState();
  }

  function renderLayoutButtons() {
    dom.layoutButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.layout === state.layout)));
  }

  /* ---------- Fullscreen inside the window ---------- */

  let fullscreenId = null;
  let idleTimer = 0;
  let revealTimer = 0;

  // Fills the News Center window with one channel; the monitor and the window size stay as they are.
  function setFullscreen(id) {
    const next = id && tiles.has(id) ? id : null;
    if (next === fullscreenId) return;
    fullscreenId = next;
    for (const tile of tiles.values()) {
      const active = tile.channel.id === fullscreenId;
      tile.el.classList.toggle('is-fullscreen', active);
      $('use', tile.ui.fullscreen).setAttribute('href', active ? '#i-exit-fullscreen' : '#i-fullscreen');
      tile.ui.fullscreen.title = active ? 'Back to the grid (F or Esc)' : 'Fill the window (F)';
    }
    document.body.classList.toggle('has-fullscreen', Boolean(fullscreenId));
    revealTopbar(false);
    if (fullscreenId) {
      closeManager();
      selectChannel(fullscreenId);
      markActive();
    } else {
      clearTimeout(idleTimer);
      document.body.classList.remove('is-idle');
    }
  }

  const toggleFullscreen = id => setFullscreen(fullscreenId === id ? null : id);

  function markActive() {
    document.body.classList.remove('is-idle');
    clearTimeout(idleTimer);
    if (fullscreenId) idleTimer = setTimeout(() => document.body.classList.add('is-idle'), IDLE_AFTER_MS);
  }

  function revealTopbar(show) {
    clearTimeout(revealTimer);
    document.body.classList.toggle('reveal-topbar', show);
  }

  function bindFullscreenChrome() {
    dom.revealZone.addEventListener('pointerenter', () => revealTopbar(true));
    dom.topbar.addEventListener('pointerenter', () => clearTimeout(revealTimer));
    document.addEventListener('pointermove', event => {
      if (!fullscreenId) return;
      markActive();
      if (document.body.classList.contains('reveal-topbar') && event.clientY > dom.topbar.offsetHeight + 24) {
        clearTimeout(revealTimer);
        revealTimer = setTimeout(() => revealTopbar(false), 350);
      }
    });
    document.addEventListener('pointerdown', markActive, true);
  }

  /* ---------- Actions ---------- */

  function selectChannel(id) {
    if (!tiles.has(id)) return;
    if (state.selectedId !== id) {
      state.selectedId = id;
      saveState();
    }
    renderSelection();
  }

  function renderSelection() {
    for (const tile of tiles.values()) tile.el.classList.toggle('is-selected', tile.channel.id === state.selectedId);
    $$('.channel-row', dom.channelList).forEach(row => row.classList.toggle('is-selected', row.dataset.id === state.selectedId));
  }

  // In fullscreen, choosing another channel switches the fullscreen view to it.
  function goToChannel(id) {
    if (fullscreenId) {
      setFullscreen(id);
      return;
    }
    selectChannel(id);
    revealTile(id);
  }

  function selectRelative(step) {
    const list = orderedTiles();
    if (!list.length) return;
    const index = list.indexOf(selectedTile());
    goToChannel(list[(index + step + list.length) % list.length].channel.id);
  }

  function toggleMute(id) {
    const channel = findChannel(id);
    if (!channel) return;
    channel.muted = !channel.muted;
    applyAudio();
  }

  // Solo adds a channel to the set that is heard; soloing a muted channel also unmutes it.
  // Exclusive solo (Ctrl+click or Shift+S) keeps only this channel soloed.
  function toggleSolo(id, exclusive) {
    const channel = findChannel(id);
    if (!channel) return;
    if (exclusive) {
      const onlyThis = channel.soloed && state.channels.every(other => other === channel || !other.soloed);
      for (const other of state.channels) other.soloed = !onlyThis && other === channel;
    } else {
      channel.soloed = !channel.soloed;
    }
    if (channel.soloed) channel.muted = false;
    applyAudio();
  }

  function clearSolo() {
    state.channels.forEach(channel => { channel.soloed = false; });
    applyAudio();
  }

  /* ---------- Spotlight + solo ---------- */

  // The focused channel is the big one in Spotlight and the only one soloed.
  function focusedId() {
    if (state.layout !== 'spotlight') return null;
    const id = spotlightId();
    const channel = findChannel(id);
    if (!channel || !tiles.has(id) || channel.muted || !channel.soloed) return null;
    return shownChannels().every(other => other === channel || !other.soloed) ? id : null;
  }

  // Makes a channel the big one and the only one heard, muting every other channel. Doing it
  // again on the same channel goes back to the grid and leaves its sound on.
  function toggleFocus(id) {
    const channel = findChannel(id);
    if (!channel || !tiles.has(id)) return;
    if (focusedId() === id) {
      setFullscreen(null);
      setLayout('grid');
      return;
    }
    for (const other of state.channels) {
      other.soloed = other === channel;
      if (other !== channel) other.muted = true;
    }
    channel.muted = false;
    setFullscreen(null);
    state.spotlightId = id;
    state.layout = 'spotlight';
    selectChannel(id);
    renderLayoutButtons();
    applyAudio();
    relayout(true);
    saveState();
    flashFocus(id);
  }

  function flashFocus(id) {
    const tile = tiles.get(id);
    if (!tile) return;
    tile.el.classList.remove('focus-flash');
    void tile.el.offsetWidth;
    tile.el.classList.add('focus-flash');
    clearTimeout(tile.flashTimer);
    tile.flashTimer = setTimeout(() => tile.el.classList.remove('focus-flash'), FOCUS_FLASH_MS);
  }

  function renderFocus() {
    const focused = focusedId();
    for (const tile of tiles.values()) {
      const { ui, channel } = tile;
      const active = channel.id === focused;
      tile.el.classList.toggle('is-focused', active);
      const label = active ? 'Back to the grid' : 'Spotlight + solo';
      const title = active
        ? 'Back to the grid; the sound stays on (Enter)'
        : `Make ${channel.name} the big channel and hear only it (Enter)`;
      if (ui.focus.title === title) continue;
      ui.focus.title = title;
      ui.focus.setAttribute('aria-label', title);
      ui.focusLabel.textContent = label;
      ui.focusIcon.setAttribute('href', active ? '#i-grid' : '#i-focus');
    }
  }

  /* ---------- Level meters ---------- */

  function toggleMeter(id) {
    const channel = findChannel(id);
    if (!channel) return;
    channel.meter = !channel.meter;
    const tile = tiles.get(id);
    if (tile) renderMeterToggle(tile);
    saveState();
  }

  // Hides every meter while any is showing; otherwise shows them all.
  function toggleAllMeters() {
    const show = !shownChannels().some(channel => channel.meter);
    state.channels.forEach(channel => { channel.meter = show; });
    tiles.forEach(renderMeterToggle);
    saveState();
    showToast(show ? 'Level meters shown' : 'Level meters hidden');
  }

  function toggleMuteAll() {
    const anyMuted = shownChannels().some(channel => channel.muted);
    state.channels.forEach(channel => { channel.muted = !anyMuted; });
    applyAudio();
  }

  function setVolume(id, volume) {
    const channel = findChannel(id);
    if (!channel) return;
    channel.volume = clamp(Math.round(volume * 100) / 100, 0, maxVolume(channel.kind));
    applyAudio();
    saveState();
  }

  function renderSummary() {
    const list = orderedTiles();
    const count = (...statuses) => list.filter(tile => statuses.includes(tile.status)).length;
    const streams = state.channels.filter(channel => channel.kind === 'stream' && wantsScreen(channel));
    const live = count('live', 'buffering');
    const connecting = count('connecting') + streams.filter(channel => availabilityOf(channel) === 'checking').length;
    const reconnecting = count('error');
    const offAir = streams.filter(channel => availabilityOf(channel) === 'offline').length;
    const parts = [`${live} live`];
    if (connecting) parts.push(`${connecting} connecting`);
    if (reconnecting) parts.push(`${reconnecting} reconnecting`);
    if (offAir) parts.push(`${offAir} off air`);
    const text = parts.join(' · ');
    if (dom.summary.textContent !== text) dom.summary.textContent = text;
    const title = live ? `News Center · ${live} live` : 'News Center';
    if (document.title !== title) document.title = title;
  }

  function renderEmptyState() {
    const empty = tiles.size === 0;
    dom.emptyState.hidden = !empty;
    if (!empty) return;
    const checking = !started || state.channels.some(channel => channel.kind === 'stream' && wantsScreen(channel) && availabilityOf(channel) === 'checking');
    dom.emptyState.classList.toggle('is-checking', checking);
    dom.emptyTitle.textContent = checking ? 'Checking channels…' : 'Nothing on air right now';
    dom.emptyText.textContent = checking ? '' : 'Channels appear here by themselves when they go live.';
    dom.emptyAction.hidden = checking;
  }

  /* ---------- Channel manager ---------- */

  const ROW_STATUS_TEXT = {
    live: 'Live',
    buffering: 'Live',
    connecting: 'Connecting',
    checking: 'Checking…',
    error: 'Connection problem',
    offline: 'Off air',
    web: 'Web player',
    hidden: 'Hidden',
    unlisted: 'Not on knesset.tv right now',
  };

  let managerTab = 'channels';

  function setManagerTab(tab) {
    managerTab = tab === 'news' ? 'news' : 'channels';
    dom.tabs.forEach(button => {
      const selected = button.dataset.tab === managerTab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    dom.channelsPanel.hidden = managerTab !== 'channels';
    dom.sourcesPanel.hidden = managerTab !== 'news';
    if (managerTab === 'news') renderSourceList();
  }

  function openManager(tab = 'channels') {
    if (knesset && knesset.isOpen()) knesset.setOpen(false);
    setFullscreen(null);
    setManagerTab(tab);
    dom.manager.inert = false;
    dom.manager.classList.add('open');
    dom.managerButton.setAttribute('aria-expanded', 'true');
    const focusTarget = managerTab === 'news'
      ? dom.sourceList.querySelector('.source-row') || $('#add-source')
      : dom.channelList.querySelector('.channel-row.is-selected') || $('#add-channel');
    focusTarget.focus({ preventScroll: true });
  }

  function closeManager() {
    if (!dom.manager.classList.contains('open')) return;
    if (dom.manager.contains(document.activeElement)) dom.managerButton.focus();
    dom.manager.classList.remove('open');
    dom.manager.inert = true;
    dom.managerButton.setAttribute('aria-expanded', 'false');
  }

  // C opens the channel list; on an open manager it switches to the list, or closes it.
  function toggleManager(tab = 'channels') {
    if (dom.manager.classList.contains('open') && managerTab === tab) closeManager();
    else openManager(tab);
  }

  function renderChannelList() {
    const focusedRow = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.channel-row') : null;
    const focusedId = focusedRow && dom.channelList.contains(focusedRow) ? focusedRow.dataset.id : null;
    const rows = state.channels.map(channel => {
      const row = dom.rowTemplate.content.firstElementChild.cloneNode(true);
      row.dataset.id = channel.id;
      const name = $('.row-name', row);
      name.textContent = channel.name;
      if (channel.auto === 'knesset' && !channel.builtin) {
        const tag = document.createElement('span');
        tag.className = 'row-tag';
        tag.textContent = 'Auto';
        tag.title = 'Found on knesset.tv';
        name.after(tag);
      }
      const toggle = $('.row-enabled', row);
      toggle.checked = channel.enabled;
      toggle.setAttribute('aria-label', `Show ${channel.name} when it's live`);
      row.setAttribute('aria-label', channel.name);
      row.classList.toggle('is-selected', channel.id === state.selectedId);
      paintRow(row, channel);
      return row;
    });
    dom.channelList.replaceChildren(...rows);
    const total = state.channels.length;
    dom.managerCount.textContent = `${total} channel${total === 1 ? '' : 's'} · ${tiles.size} on screen`;
    if (focusedId) {
      const row = dom.channelList.querySelector(`[data-id="${CSS.escape(focusedId)}"]`);
      if (row) row.focus({ preventScroll: true });
    }
  }

  function paintRow(row, channel) {
    const status = channelStatus(channel);
    row.dataset.status = status;
    row.classList.toggle('is-dimmed', !tiles.has(channel.id));
    const parts = [ROW_STATUS_TEXT[status], channel.now || channel.description, hostName(channel.url)];
    $('.row-meta', row).textContent = parts.filter(Boolean).join(' · ');
    $('.row-dot', row).title = ROW_STATUS_TEXT[status] || '';
  }

  function setEnabled(id, enabled) {
    const channel = findChannel(id);
    if (!channel) return;
    channel.enabled = enabled;
    if (enabled && channel.kind === 'stream') checkChannel(channel);
    syncChannels(true);
    saveState();
  }

  function moveChannel(id, step) {
    const index = state.channels.findIndex(channel => channel.id === id);
    const target = index + step;
    if (index < 0 || target < 0 || target >= state.channels.length) return;
    const [channel] = state.channels.splice(index, 1);
    state.channels.splice(target, 0, channel);
    syncChannels(true);
    saveState();
  }

  function applyOrder(ids) {
    const byId = new Map(state.channels.map(channel => [channel.id, channel]));
    const ordered = ids.map(id => byId.get(id)).filter(Boolean);
    if (ordered.length !== state.channels.length) return;
    if (ordered.every((channel, index) => channel === state.channels[index])) return;
    state.channels.splice(0, state.channels.length, ...ordered);
    syncChannels(true);
    saveState();
  }

  // Removed built-in and Knesset channels are remembered so they don't come back by themselves.
  function deleteChannel(id) {
    const index = state.channels.findIndex(channel => channel.id === id);
    if (index < 0) return;
    const [removed] = state.channels.splice(index, 1);
    const remembered = (removed.builtin || removed.auto === 'knesset') && !state.removed.includes(removed.id);
    if (remembered) state.removed.push(removed.id);
    syncChannels(true);
    saveState();
    showToast(['Removed ', bidi(removed.name)], {
      actionLabel: 'Undo',
      onAction: () => {
        state.channels.splice(Math.min(index, state.channels.length), 0, removed);
        if (remembered) state.removed = state.removed.filter(removedId => removedId !== removed.id);
        checkChannel(removed);
        syncChannels(true);
        saveState();
      },
    });
  }

  function bindManager() {
    const list = dom.channelList;
    list.addEventListener('click', event => {
      const row = event.target.closest('.channel-row');
      if (!row) return;
      if (event.target.closest('.row-edit')) openEditor(row.dataset.id);
      else if (event.target.closest('.row-delete')) deleteChannel(row.dataset.id);
      else if (!event.target.closest('.switch')) selectChannel(row.dataset.id);
    });
    list.addEventListener('change', event => {
      if (!event.target.classList.contains('row-enabled')) return;
      setEnabled(event.target.closest('.channel-row').dataset.id, event.target.checked);
    });
    list.addEventListener('keydown', event => {
      const row = event.target;
      if (!row.classList || !row.classList.contains('channel-row')) return;
      const id = row.dataset.id;
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        moveChannel(id, event.key === 'ArrowUp' ? -1 : 1);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const sibling = event.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
        if (sibling) sibling.focus();
      } else if (event.key === 'Enter') {
        openEditor(id);
      } else if (event.key === 'Delete') {
        deleteChannel(id);
      } else if (event.key === ' ') {
        setEnabled(id, !findChannel(id).enabled);
      } else {
        return;
      }
      event.preventDefault();
    });

    let dragging = null;
    list.addEventListener('dragstart', event => {
      dragging = event.target.closest('.channel-row');
      if (!dragging) return;
      dragging.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragging.dataset.id);
    });
    list.addEventListener('dragover', event => {
      if (!dragging) return;
      event.preventDefault();
      const target = event.target.closest('.channel-row');
      if (!target || target === dragging) return;
      const { top, height } = target.getBoundingClientRect();
      if (event.clientY > top + height / 2) target.after(dragging);
      else target.before(dragging);
    });
    list.addEventListener('drop', event => event.preventDefault());
    list.addEventListener('dragend', () => {
      if (!dragging) return;
      dragging.classList.remove('dragging');
      dragging = null;
      applyOrder($$('.channel-row', list).map(row => row.dataset.id));
    });

    $('#add-channel').addEventListener('click', () => openEditor());
    $('#import-channels').addEventListener('click', () => dom.importFile.click());
    $('#export-channels').addEventListener('click', exportChannels);
    $('#reset-channels').addEventListener('click', resetChannels);
    dom.importFile.addEventListener('change', importChannels);
  }

  /* ---------- Channel editor ---------- */

  let editingId = null;

  function openEditor(id = null) {
    const channel = id ? findChannel(id) : null;
    editingId = channel ? channel.id : null;
    dom.channelDialogTitle.textContent = channel ? 'Edit channel' : 'Add channel';
    fields.name.value = channel ? channel.name : '';
    fields.description.value = channel ? channel.description : '';
    fields.kind.value = channel ? channel.kind : 'stream';
    fields.url.value = channel ? channel.url : '';
    fields.poster.value = channel ? channel.poster : '';
    fields.enabled.checked = channel ? channel.enabled : true;
    Object.values(fields).forEach(field => field.setCustomValidity(''));
    setFeedback(dom.urlFeedback, '');
    setFeedback(dom.testResult, '');
    updateKindUi();
    dom.channelDialog.showModal();
    fields.name.focus();
  }

  function setFeedback(element, message, tone = '') {
    element.textContent = message;
    element.dataset.tone = tone;
  }

  function updateKindUi() {
    const isStream = fields.kind.value === 'stream';
    dom.testRow.hidden = !isStream;
    fields.url.placeholder = isStream
      ? 'https://example.com/live/playlist.m3u8\nYou can also paste an embed <iframe> code or a watch.knesset.tv link.'
      : 'https://broadcaster.example/live\nThe page plays in its tile, showing just its video player when News Center can find it.';
  }

  // Accepts a stream address, an <iframe> embed code, or a player link that carries the stream
  // in its "src" parameter (like watch.knesset.tv).
  function parseStreamInput(input) {
    let value = input.trim();
    if (!value) return null;
    let fromEmbed = false;
    const iframe = value.match(/<iframe[^>]*?\ssrc\s*=\s*["']([^"']+)["']/i);
    if (iframe) {
      value = iframe[1];
      fromEmbed = true;
    }
    value = value.replace(/&amp;/gi, '&');
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    const inner = url.searchParams.get('src');
    if (inner && isHttpUrl(inner)) {
      const poster = url.searchParams.get('poster');
      return { url: inner.trim(), poster: isHttpUrl(poster) ? poster.trim() : '', extracted: true };
    }
    return { url: url.href, poster: '', extracted: fromEmbed };
  }

  function invalid(field, message) {
    field.setCustomValidity(message);
    field.reportValidity();
    field.addEventListener('input', () => field.setCustomValidity(''), { once: true });
  }

  async function probeStream(url) {
    const result = await checkStream(url);
    if (result.availability === 'live') {
      try {
        const text = await (await fetch(url, { cache: 'no-store' })).text();
        const heights = [...text.matchAll(/RESOLUTION=\d+x(\d+)/g)].map(match => Number(match[1]));
        return [heights.length ? `On air, up to ${Math.max(...heights)}p` : 'On air', 'ok'];
      } catch {
        return ['On air', 'ok'];
      }
    }
    if (result.availability === 'offline') return [`Not broadcasting right now (${result.detail}). News Center keeps checking once it's added.`, 'warn'];
    return ['Could not load it. The server may be offline or may not allow other apps to play it.', 'error'];
  }

  function bindEditor() {
    fields.kind.addEventListener('change', () => {
      updateKindUi();
      setFeedback(dom.urlFeedback, '');
    });

    fields.url.addEventListener('input', () => {
      if (fields.kind.value !== 'stream') return;
      const parsed = parseStreamInput(fields.url.value);
      if (!parsed || !parsed.extracted) return;
      fields.url.value = parsed.url;
      if (!fields.poster.value && parsed.poster) fields.poster.value = parsed.poster;
      setFeedback(dom.urlFeedback, 'Used the address from the embed code.', 'ok');
    });

    $('#test-stream').addEventListener('click', async () => {
      const parsed = parseStreamInput(fields.url.value);
      if (!parsed || !isHttpUrl(parsed.url)) {
        setFeedback(dom.testResult, 'Enter a stream address first.', 'error');
        return;
      }
      setFeedback(dom.testResult, 'Testing…', 'pending');
      const [message, tone] = await probeStream(parsed.url);
      setFeedback(dom.testResult, message, tone);
    });

    dom.channelForm.addEventListener('submit', event => {
      event.preventDefault();
      const kind = fields.kind.value === 'page' ? 'page' : 'stream';
      const name = fields.name.value.trim();
      const parsed = kind === 'stream' ? parseStreamInput(fields.url.value) : null;
      const url = parsed ? parsed.url : fields.url.value.trim();
      const poster = fields.poster.value.trim();
      if (!name) return invalid(fields.name, 'Enter a channel name.');
      if (!isHttpUrl(url)) return invalid(fields.url, 'Enter an http:// or https:// address.');
      if (isBlockedUrl(url)) return invalid(fields.url, 'This site is blocked in News Center.');
      if (poster && !isHttpUrl(poster)) return invalid(fields.poster, 'Enter an http:// or https:// image address, or leave it empty.');

      const values = { name, description: fields.description.value.trim(), kind, url, poster, enabled: fields.enabled.checked };
      const existing = editingId ? findChannel(editingId) : null;
      let channel = existing;
      if (existing) {
        const changed = !sameDefinition(existing, values);
        const urlChanged = existing.url !== url;
        Object.assign(existing, values);
        existing.volume = clamp(existing.volume, 0, maxVolume(kind));
        if (changed && (existing.builtin || existing.auto)) existing.edited = true;
        if (urlChanged) runtime.delete(existing.id);
      } else {
        channel = normalizeChannel({ ...values, id: makeId() });
        state.channels.push(channel);
      }
      dom.channelDialog.close();
      if (channel.kind === 'stream' && channel.enabled) {
        checkChannel(channel).then(() => {
          if (tiles.has(channel.id)) selectChannel(channel.id);
        });
      }
      syncChannels(true);
      saveState();
      showToast(existing ? 'Channel saved' : 'Channel added');
      return undefined;
    });
  }

  /* ---------- Import, export and reset ---------- */

  function exportChannels() {
    const data = {
      app: 'News Center',
      version: 2,
      exportedAt: new Date().toISOString(),
      channels: state.channels.map(({ id, name, description, kind, url, poster, enabled, auto }) => ({ id, name, description, kind, url, poster, enabled, auto })),
    };
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    link.download = `newscenter-channels-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    showToast('Channel list exported');
  }

  async function importChannels() {
    const file = dom.importFile.files[0];
    dom.importFile.value = '';
    if (!file) return;
    let channels;
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data && Array.isArray(data.channels) ? data.channels : null;
      if (!list) throw new Error('the file has no channel list');
      channels = list.map(raw => normalizeChannel({ ...raw, builtin: false, edited: false })).filter(Boolean);
      if (!channels.length) throw new Error('the file has no valid channels');
    } catch (error) {
      showToast(`Import failed: ${error.message}`);
      return;
    }
    const confirmed = await confirmAction({
      title: 'Import channels',
      message: `Replace your ${state.channels.length} channels with the ${channels.length} channels in “${file.name}”?`,
      confirmLabel: 'Replace',
    });
    if (!confirmed) return;
    const ids = new Set();
    for (const channel of channels) {
      if (ids.has(channel.id)) channel.id = makeId();
      ids.add(channel.id);
    }
    state.removed = builtinChannels().map(channel => channel.id).filter(id => !ids.has(id));
    state.channels.splice(0, state.channels.length, ...mergeBuiltins(channels, state.removed));
    runtime.clear();
    syncChannels(true);
    saveState();
    state.channels.forEach(checkChannel);
    showToast(`Imported ${channels.length} channels`);
  }

  async function resetChannels() {
    const confirmed = await confirmAction({
      title: 'Reset channels',
      message: 'Go back to the built-in channels? Channels you added are removed; Knesset streams are found again automatically.',
      confirmLabel: 'Reset',
      danger: true,
    });
    if (!confirmed) return;
    state.channels.splice(0, state.channels.length, ...builtinChannels());
    state.removed = [];
    runtime.clear();
    syncChannels(true);
    saveState();
    state.channels.forEach(checkChannel);
    runDiscovery({ announce: true });
    showToast('Channels reset to the built-in list');
  }

  /* ---------- News ---------- */

  const newsRuntime = new Map();
  const newsElements = new Map();
  const chipElements = new Map();
  const sourceRows = new Map();
  const SOURCE_GROUPS = [['he', 'Hebrew'], ['en', 'English'], ['', 'Added by you']];
  let sourceListSignature = '';
  let newsRenderTimer = 0;
  let newsPainted = false;

  const findSource = id => state.news.sources.find(source => source.id === id) || null;
  const enabledSources = () => state.news.sources.filter(source => source.enabled);
  const sourceGroup = source => (source.builtin ? source.lang : '');
  const isRtlText = text => /[\u0590-\u05ff\u0600-\u06ff]/.test(text);

  function sourceInfo(id) {
    let info = newsRuntime.get(id);
    if (!info) {
      info = { url: '', status: 'idle', error: '', items: [], loadedOnce: false, loading: false, fetchedAt: 0, nextAt: 0, failures: 0, pending: null };
      newsRuntime.set(id, info);
    }
    return info;
  }

  function sourceColor(source) {
    if (source.color) return source.color;
    let hash = 0;
    for (const char of source.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return SOURCE_COLORS[hash % SOURCE_COLORS.length];
  }

  /* Reading feeds */

  // Feed text often carries HTML, sometimes escaped twice; only its text is shown.
  function plainText(value, maxLength) {
    let text = typeof value === 'string' ? value : '';
    for (let pass = 0; pass < 2 && /[<&]/.test(text); pass += 1) text = parseHtml(text).body.textContent || '';
    return cleanText(text, maxLength);
  }

  function parseFeedDate(value) {
    if (!value) return NaN;
    // Israeli sites name their time zone IST or IDT, which browsers don't know.
    const text = value.trim().replace(/\s+/g, ' ').replace(/\bIST$/, '+0200').replace(/\bIDT$/, '+0300');
    const time = Date.parse(text);
    if (!Number.isNaN(time)) return time;
    const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
    return match ? new Date(+match[3], +match[2] - 1, +match[1], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0)).getTime() : NaN;
  }

  function childText(element, ...names) {
    for (const name of names) {
      for (const child of element.children) {
        if (child.localName.toLowerCase() !== name) continue;
        const text = child.textContent.trim();
        if (text) return text;
      }
    }
    return '';
  }

  function entryLink(entry) {
    let other = '';
    for (const child of entry.children) {
      if (child.localName.toLowerCase() !== 'link') continue;
      const href = child.getAttribute('href');
      if (!href) {
        const text = child.textContent.trim();
        if (text) return text;
      } else if ((child.getAttribute('rel') || 'alternate') === 'alternate') {
        return href;
      } else {
        other = other || href;
      }
    }
    const guid = childText(entry, 'origlink', 'guid', 'id');
    return other || (isHttpUrl(guid) ? guid : '');
  }

  function makeHeadline(raw, baseUrl) {
    const title = plainText(raw.title, 300);
    if (!title) return null;
    let link = '';
    if (raw.link) {
      try {
        const url = new URL(raw.link, baseUrl);
        if ((url.protocol === 'https:' || url.protocol === 'http:') && !isBlockedUrl(url.href)) link = url.href;
      } catch {
        link = '';
      }
    }
    return { key: cleanText(raw.guid, 500) || link || title, title, link, time: parseFeedDate(raw.date), summary: plainText(raw.summary, 400) };
  }

  // Reads RSS 2.0, RSS 1.0 (RDF) and Atom; broken XML gets a more forgiving reading.
  function parseFeed(text, baseUrl) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const root = doc.documentElement;
    const kind = root ? root.localName.toLowerCase() : '';
    if (doc.getElementsByTagName('parsererror').length || !['rss', 'rdf', 'feed'].includes(kind)) return parseFeedLoosely(text, baseUrl);
    const channel = [...root.children].find(child => child.localName.toLowerCase() === 'channel') || root;
    // Namespace-blind, so prefixed elements such as <atom:entry> count too.
    const entries = [...doc.getElementsByTagNameNS('*', 'item'), ...doc.getElementsByTagNameNS('*', 'entry')];
    const items = entries.map(entry => makeHeadline({
      title: childText(entry, 'title'),
      link: entryLink(entry),
      date: childText(entry, 'pubdate', 'date', 'published', 'updated', 'issued', 'modified'),
      summary: childText(entry, 'description', 'summary', 'encoded', 'content'),
      guid: childText(entry, 'guid', 'id'),
    }, baseUrl)).filter(Boolean);
    return { title: plainText(childText(channel, 'title'), 80), items };
  }

  function parseFeedLoosely(text, baseUrl) {
    const blocks = text.match(/<(item|entry)\b[^>]*>[\s\S]*?<\/\1>/gi);
    if (!blocks) return null;
    const unwrap = value => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    const field = (block, ...names) => {
      for (const name of names) {
        const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
        const value = match ? unwrap(match[1]) : '';
        if (value) return value;
      }
      return '';
    };
    const href = block => {
      const match = /<link\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/i.exec(block);
      return match ? match[1] : '';
    };
    const items = blocks.map(block => makeHeadline({
      title: field(block, 'title'),
      link: (field(block, 'link') || href(block) || field(block, 'guid')).replace(/&amp;/g, '&'),
      date: field(block, 'pubDate', 'dc:date', 'published', 'updated'),
      summary: field(block, 'description', 'summary', 'content:encoded', 'content'),
      guid: field(block, 'guid', 'id'),
    }, baseUrl)).filter(Boolean);
    if (!items.length) return null;
    const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(text);
    return { title: plainText(title ? unwrap(title[1]) : '', 80), items };
  }

  // Some corporate web filters (Symantec's Fire Glass) answer a site they isolate with a page that
  // loads the filter's own script instead of the site. Merely mentioning the filter doesn't count.
  const isIsolationPage = text => /<script\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^"'\/]*\.fire\.glass\//i.test(text);

  // Never throws: the result has the feed, or an error and, for a web page, the page itself.
  async function requestFeed(url) {
    let response;
    try {
      response = await host.fetchText(url);
    } catch {
      return { error: `Can't reach ${hostName(url)}` };
    }
    const text = response.text || '';
    const feed = response.ok ? parseFeed(text, response.url || url) : null;
    if (feed) return { feed };
    if (isIsolationPage(text)) return { error: NEWS_BLOCKED };
    if (!response.ok) return { error: `The site answered HTTP ${response.status}` };
    const isPage = /<html[\s>]/i.test(text);
    return { error: isPage ? 'This address is a web page, not a feed' : 'Not an RSS or Atom feed', page: isPage ? text : '', pageUrl: response.url || url };
  }

  // A news site's home page usually names its feed in a <link rel="alternate"> tag.
  async function inspectFeed(address) {
    const result = await requestFeed(address);
    if (result.feed) return { url: address, feed: result.feed };
    if (!result.page) return { error: result.error };
    const link = [...parseHtml(result.page).querySelectorAll('link[rel~="alternate"][href]')]
      .find(element => /rss|atom/i.test(element.getAttribute('type') || ''));
    let url = '';
    try {
      url = link ? new URL(link.getAttribute('href'), result.pageUrl).href : '';
    } catch {
      url = '';
    }
    if (!isHttpUrl(url)) return { error: "This address is a web page that doesn't name a feed" };
    const found = await requestFeed(url);
    return found.feed ? { url, feed: found.feed, found: true } : { error: found.error };
  }

  /* Keeping headlines up to date */

  // Headlines that roll off a busy feed stay for a while, so they aren't lost between refreshes.
  function mergeHeadlines(info, items) {
    const now = Date.now();
    const known = new Map(info.items.map(item => [item.key, item]));
    const merged = new Map();
    for (const item of items) {
      if (merged.has(item.key)) continue;
      const previous = known.get(item.key);
      // Some feeds date stories ahead of the clock; those count as just published.
      const time = Number.isFinite(item.time) ? Math.min(item.time, now) : previous ? previous.time : now;
      const fresh = previous ? previous.fresh : info.loadedOnce && now - time < 60 * 60 * 1000;
      merged.set(item.key, { ...item, time, fresh, seenAt: previous ? previous.seenAt : now });
    }
    for (const item of info.items) {
      if (!merged.has(item.key) && now - item.time < NEWS_MAX_AGE_MS) merged.set(item.key, item);
    }
    info.items = [...merged.values()].sort((a, b) => b.time - a.time).slice(0, NEWS_PER_SOURCE);
    info.loadedOnce = true;
  }

  function loadSource(source) {
    const info = sourceInfo(source.id);
    if (info.pending) return info.pending;
    const { id, url } = source;
    if (info.url !== url) Object.assign(info, { url, status: 'idle', error: '', items: [], loadedOnce: false, fetchedAt: 0, failures: 0 });
    const current = () => findSource(id)?.url === url;
    info.loading = true;
    info.pending = requestFeed(url).then(result => {
      if (!current()) return;
      if (result.feed) {
        mergeHeadlines(info, result.feed.items);
        Object.assign(info, { status: 'ok', error: '', failures: 0, fetchedAt: Date.now() });
        info.nextAt = info.fetchedAt + NEWS_REFRESH_MS + Math.random() * 20000;
      } else {
        info.status = result.error === NEWS_BLOCKED ? 'blocked' : 'error';
        info.error = result.error;
        info.nextAt = Date.now() + NEWS_RETRY_MS[Math.min(info.failures, NEWS_RETRY_MS.length - 1)];
        info.failures += 1;
      }
    }).finally(() => {
      info.pending = null;
      info.loading = false;
      renderNewsSoon();
      // The address changed while loading: load the new one.
      if (!current() && findSource(id)) loadDueSources();
    });
    renderNewsSoon();
    return info.pending;
  }

  // Loads the switched-on sources that are due. News is only fetched while the panel is open.
  function loadDueSources(force = false) {
    if (!state.news.open) return Promise.resolve();
    const now = Date.now();
    const due = enabledSources().filter(source => {
      const info = sourceInfo(source.id);
      return !info.pending && (force || info.url !== source.url || now >= info.nextAt);
    });
    return Promise.all(due.map(loadSource));
  }

  // The newest headlines of the switched-on sources, or of the one picked above the list.
  function headlines() {
    const sources = enabledSources();
    const filter = sources.some(source => source.id === state.news.filter) ? state.news.filter : 'all';
    const cutoff = Date.now() - NEWS_MAX_AGE_MS;
    const list = [];
    for (const source of sources) {
      if (filter !== 'all' && source.id !== filter) continue;
      for (const item of sourceInfo(source.id).items) {
        if (item.time >= cutoff) list.push({ item, source });
      }
    }
    list.sort((a, b) => b.item.time - a.item.time);
    // A story in two feeds of the same outlet shows once.
    const seen = new Set();
    return list.filter(({ item }) => {
      const key = item.link || item.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, NEWS_SHOWN);
  }

  /* The News panel */

  const newsClock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const newsDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
  const newsFullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

  function newsTime(time, now) {
    const clock = newsClock.format(time);
    const minutes = Math.floor((now - time) / 60000);
    if (minutes < 60) return `${clock} · ${minutes < 1 ? 'now' : `${minutes}m`}`;
    const day = new Date(time).toDateString();
    if (day === new Date(now).toDateString()) return clock;
    if (day === new Date(now - 24 * 60 * 60 * 1000).toDateString()) return `Yesterday ${clock}`;
    return `${newsDay.format(time)} ${clock}`;
  }

  function renderNewsSoon() {
    if (newsRenderTimer) return;
    newsRenderTimer = setTimeout(() => {
      newsRenderTimer = 0;
      renderNews();
    }, 30);
  }

  function renderNews() {
    renderNewsPanel();
    if (dom.manager.classList.contains('open') && managerTab === 'news') renderSourceList();
    if (!state.news.open) return;
    const list = headlines();
    renderNewsFilters();
    renderNewsStatus();
    renderHeadlines(list);
    renderNewsEmpty(list);
  }

  function renderNewsPanel() {
    const { open, width, height } = state.news;
    dom.news.hidden = !open;
    dom.newsToggle.setAttribute('aria-pressed', String(open));
    dom.newsToggle.title = open ? 'Hide the news (N)' : 'Show the news (N)';
    dom.news.style.setProperty('--news-w', `${width}px`);
    dom.news.style.setProperty('--news-h', `${height}px`);
  }

  function renderNewsFilters() {
    const sources = enabledSources();
    const active = sources.some(source => source.id === state.news.filter) ? state.news.filter : 'all';
    const cutoff = Date.now() - NEWS_MAX_AGE_MS;
    const counts = new Map(sources.map(source => [source.id, sourceInfo(source.id).items.filter(item => item.time >= cutoff).length]));
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const entries = [{ id: 'all', name: 'All', source: null }, ...sources.map(source => ({ id: source.id, name: source.name, source }))];
    entries.forEach((entry, index) => {
      let chip = chipElements.get(entry.id);
      if (!chip) {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.dataset.filter = entry.id;
        const name = document.createElement('bdi');
        const count = document.createElement('span');
        count.className = 'chip-count';
        chip.append(document.createElement('i'), name, count);
        chipElements.set(entry.id, chip);
      }
      const { source } = entry;
      const info = source ? sourceInfo(source.id) : null;
      const count = source ? counts.get(source.id) : total;
      const failing = Boolean(info) && (info.status === 'error' || info.status === 'blocked');
      chip.setAttribute('aria-pressed', String(entry.id === active));
      chip.classList.toggle('is-error', failing);
      chip.classList.toggle('is-loading', Boolean(info) && info.loading && !info.loadedOnce);
      chip.hidden = false;
      if (source) chip.style.setProperty('--c', sourceColor(source));
      chip.children[0].hidden = !source;
      if (chip.children[1].textContent !== entry.name) chip.children[1].textContent = entry.name;
      const countText = failing ? '!' : String(count);
      if (chip.children[2].textContent !== countText) chip.children[2].textContent = countText;
      chip.title = failing ? `${entry.name}: ${info.error}` : entry.id === active && source ? `Showing only ${entry.name}; click to show all` : `${entry.name} · ${count} headlines`;
      if (dom.newsFilters.children[index] !== chip) dom.newsFilters.insertBefore(chip, dom.newsFilters.children[index] || null);
    });
    while (dom.newsFilters.children.length > entries.length) dom.newsFilters.lastElementChild.remove();
    for (const id of chipElements.keys()) {
      if (!entries.some(entry => entry.id === id)) chipElements.delete(id);
    }
    renderChipOverflow();
  }

  function renderChipOverflow() {
    const { scrollLeft, scrollWidth, clientWidth } = dom.newsFilters;
    dom.newsFilters.classList.toggle('more-before', scrollLeft > 1);
    dom.newsFilters.classList.toggle('more-after', scrollLeft + clientWidth < scrollWidth - 1);
  }

  function renderNewsStatus() {
    const infos = enabledSources().map(source => sourceInfo(source.id));
    const loading = infos.some(info => info.loading);
    const failing = infos.filter(info => info.status === 'error' || info.status === 'blocked').length;
    const updated = Math.max(0, ...infos.map(info => info.fetchedAt));
    const parts = [];
    if (loading) parts.push('Updating…');
    else if (updated) parts.push(`Updated ${newsClock.format(updated)}`);
    if (infos.length) parts.push(`${infos.length} source${infos.length === 1 ? '' : 's'}`);
    if (failing) parts.push(`${failing} not loading`);
    const text = parts.join(' · ');
    if (dom.newsStatus.textContent !== text) dom.newsStatus.textContent = text;
    dom.newsRefresh.classList.toggle('is-busy', loading);
  }

  const headlineContent = new WeakMap();

  function createHeadline() {
    return dom.newsItemTemplate.content.firstElementChild.cloneNode(true);
  }

  // Outlets correct their headlines, so a story that changed is repainted with its new title and link.
  function paintHeadlineContent(element, item) {
    const signature = `${item.title}\n${item.link}\n${item.summary}`;
    if (headlineContent.get(element) === signature) return;
    headlineContent.set(element, signature);
    const link = $('.news-link', element);
    if (item.link) link.href = item.link;
    else link.removeAttribute('href');
    $('.news-title', element).textContent = item.title;
    element.dir = isRtlText(item.title) ? 'rtl' : 'ltr';
    const summary = item.summary && !item.summary.startsWith(item.title) ? item.summary : '';
    link.title = summary ? `${item.title}\n\n${summary}` : item.title;
  }

  function paintHeadline(element, item, source, now) {
    element.style.setProperty('--c', sourceColor(source));
    const name = $('.news-source', element);
    if (name.textContent !== source.name) name.textContent = source.name;
    const time = $('.news-time', element);
    const label = newsTime(item.time, now);
    if (time.textContent !== label) {
      time.textContent = label;
      time.dateTime = new Date(item.time).toISOString();
      time.title = newsFullDate.format(item.time);
    }
    element.classList.toggle('is-fresh', item.fresh && now - item.seenAt < NEWS_FRESH_MS);
  }

  // Updates the list in place, so the browser keeps the reading position when headlines arrive.
  function renderHeadlines(list) {
    const now = Date.now();
    const keep = new Set();
    list.forEach(({ item, source }, index) => {
      const key = `${source.id}\n${item.key}`;
      keep.add(key);
      let element = newsElements.get(key);
      if (!element) {
        element = createHeadline();
        newsElements.set(key, element);
        if (newsPainted && item.fresh) element.classList.add('is-arriving');
      }
      paintHeadlineContent(element, item);
      paintHeadline(element, item, source, now);
      const current = dom.newsList.children[index];
      if (current !== element) dom.newsList.insertBefore(element, current || null);
    });
    while (dom.newsList.children.length > list.length) dom.newsList.lastElementChild.remove();
    for (const key of newsElements.keys()) {
      if (!keep.has(key)) newsElements.delete(key);
    }
    newsPainted = true;
  }

  function renderNewsEmpty(list) {
    const sources = enabledSources();
    const infos = sources.map(source => sourceInfo(source.id));
    let text = '';
    let loading = false;
    let action = false;
    if (!sources.length) {
      text = 'No news sources are switched on.';
      action = true;
    } else if (!list.length) {
      loading = infos.some(info => info.loading || (!info.loadedOnce && info.status === 'idle'));
      if (loading) {
        text = 'Loading headlines…';
      } else if (infos.every(info => info.status === 'error' || info.status === 'blocked')) {
        text = `Couldn't load the news. ${[...new Set(infos.map(info => info.error))].join(' · ')}`;
        action = true;
      } else {
        text = 'No headlines from the last two days.';
      }
    }
    dom.newsList.hidden = Boolean(text);
    dom.newsEmpty.hidden = !text;
    dom.newsEmpty.classList.toggle('is-loading', loading);
    if (dom.newsEmptyText.textContent !== text) dom.newsEmptyText.textContent = text;
    dom.newsEmptyAction.hidden = !action;
  }

  function setNewsOpen(open) {
    state.news.open = open;
    saveState();
    if (open) loadDueSources();
    renderNews();
  }

  function newsTick() {
    if (!state.news.open) return;
    loadDueSources();
    renderNews();
  }

  // Drag the panel's inner edge to resize it; double-click it for the default size.
  function bindNewsResizer() {
    const handle = dom.newsResizer;
    let start = null;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const box = dom.news.getBoundingClientRect();
      start = { id: event.pointerId, x: event.clientX, y: event.clientY, width: box.width, height: box.height, portrait: matchMedia('(orientation: portrait)').matches };
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('is-active');
      document.body.classList.add('is-resizing-news');
    });
    handle.addEventListener('pointermove', event => {
      if (!start || event.pointerId !== start.id) return;
      if (start.portrait) {
        state.news.height = Math.round(clamp(start.height + start.y - event.clientY, NEWS_SIZE.height[0], Math.max(NEWS_SIZE.height[0], window.innerHeight - 360)));
      } else {
        state.news.width = Math.round(clamp(start.width + start.x - event.clientX, NEWS_SIZE.width[0], Math.max(NEWS_SIZE.width[0], window.innerWidth - 420)));
      }
      renderNewsPanel();
    });
    const finish = event => {
      if (!start || event.pointerId !== start.id) return;
      start = null;
      handle.classList.remove('is-active');
      document.body.classList.remove('is-resizing-news');
      saveState();
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('dblclick', () => {
      state.news.width = NEWS_SIZE.width[1];
      state.news.height = NEWS_SIZE.height[1];
      renderNewsPanel();
      saveState();
    });
  }

  /* News sources */

  function sourceStatus(source) {
    const info = sourceInfo(source.id);
    if (!source.enabled) return ['off', hostName(source.url)];
    if (info.url === source.url && info.status === 'blocked') return ['blocked', NEWS_BLOCKED];
    if (info.url === source.url && info.status === 'error') return ['error', `Not loading: ${info.error}`];
    if (info.url === source.url && info.loadedOnce) {
      const cutoff = Date.now() - NEWS_MAX_AGE_MS;
      const count = info.items.filter(item => item.time >= cutoff).length;
      return ['ok', `${count} headline${count === 1 ? '' : 's'} · updated ${newsClock.format(info.fetchedAt)}`];
    }
    if (info.loading) return ['loading', 'Loading…'];
    return ['waiting', state.news.open ? 'Waiting to load' : 'Loads when the News panel is open'];
  }

  function renderSourceList() {
    const groups = SOURCE_GROUPS
      .map(([lang, label]) => ({ label, sources: state.news.sources.filter(source => sourceGroup(source) === lang) }))
      .filter(group => group.sources.length);
    const signature = groups.map(group => `${group.label}:${group.sources.map(source => source.id).join(',')}`).join('|');
    if (signature !== sourceListSignature) {
      sourceListSignature = signature;
      const focused = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.source-row') : null;
      const focusedId = focused && dom.sourceList.contains(focused) ? focused.dataset.id : null;
      sourceRows.clear();
      const items = [];
      for (const group of groups) {
        const heading = document.createElement('li');
        heading.className = 'list-heading';
        heading.setAttribute('role', 'presentation');
        heading.textContent = group.label;
        items.push(heading);
        for (const source of group.sources) {
          const row = dom.sourceTemplate.content.firstElementChild.cloneNode(true);
          row.dataset.id = source.id;
          sourceRows.set(source.id, row);
          items.push(row);
        }
      }
      dom.sourceList.replaceChildren(...items);
      if (focusedId && sourceRows.has(focusedId)) sourceRows.get(focusedId).focus({ preventScroll: true });
    }
    for (const source of state.news.sources) {
      const row = sourceRows.get(source.id);
      if (row) paintSourceRow(row, source);
    }
    dom.sourcesCount.textContent = `${state.news.sources.length} sources · ${enabledSources().length} on`;
  }

  function paintSourceRow(row, source) {
    const [status, text] = sourceStatus(source);
    row.dataset.status = status;
    row.classList.toggle('is-on', source.enabled);
    row.style.setProperty('--c', sourceColor(source));
    row.setAttribute('aria-label', source.name);
    const name = $('.row-name', row);
    if (name.textContent !== source.name) name.textContent = source.name;
    const meta = $('.row-meta', row);
    if (meta.textContent !== text) {
      meta.textContent = text;
      meta.title = status === 'off' ? source.url : text;
    }
    const toggle = $('.row-enabled', row);
    toggle.checked = source.enabled;
    toggle.setAttribute('aria-label', `Show headlines from ${source.name}`);
  }

  function setSourceEnabled(id, enabled) {
    const source = findSource(id);
    if (!source) return;
    source.enabled = enabled;
    if (!enabled && state.news.filter === id) state.news.filter = 'all';
    if (enabled && !state.news.open) {
      setNewsOpen(true);
      return;
    }
    saveState();
    loadDueSources();
    renderNews();
  }

  // Removed built-in sources are remembered so they don't come back by themselves.
  function deleteSource(id) {
    const index = state.news.sources.findIndex(source => source.id === id);
    if (index < 0) return;
    const [removed] = state.news.sources.splice(index, 1);
    const remembered = removed.builtin && !state.news.removed.includes(removed.id);
    if (remembered) state.news.removed.push(removed.id);
    if (state.news.filter === id) state.news.filter = 'all';
    saveState();
    renderNews();
    showToast(['Removed ', bidi(removed.name)], {
      actionLabel: 'Undo',
      onAction: () => {
        state.news.sources.splice(Math.min(index, state.news.sources.length), 0, removed);
        if (remembered) state.news.removed = state.news.removed.filter(removedId => removedId !== removed.id);
        saveState();
        loadDueSources();
        renderNews();
      },
    });
  }

  async function resetSources() {
    const confirmed = await confirmAction({
      title: 'Reset news sources',
      message: 'Go back to the built-in news sources, with the default ones switched on? Sources you added are removed.',
      confirmLabel: 'Reset',
      danger: true,
    });
    if (!confirmed) return;
    state.news.sources = builtinSources();
    state.news.removed = [];
    state.news.filter = 'all';
    saveState();
    loadDueSources();
    renderNews();
    showToast('News sources reset to the built-in list');
  }

  let editingSourceId = null;
  // Each feed test gets a number; editing the address or reopening the editor makes a pending test stale.
  let sourceTest = 0;

  function openSourceEditor(id = null) {
    sourceTest += 1;
    const source = id ? findSource(id) : null;
    editingSourceId = source ? source.id : null;
    dom.sourceDialogTitle.textContent = source ? 'Edit news source' : 'Add news source';
    dom.sourceUrl.value = source ? source.url : '';
    dom.sourceName.value = source ? source.name : '';
    [dom.sourceUrl, dom.sourceName].forEach(field => field.setCustomValidity(''));
    setFeedback(dom.sourceTestResult, '');
    dom.sourceDialog.showModal();
    (source ? dom.sourceName : dom.sourceUrl).focus();
  }

  function bindNews() {
    dom.newsToggle.addEventListener('click', () => {
      if (knesset && knesset.isOpen()) {
        knesset.setOpen(false);
        setNewsOpen(true);
      } else {
        setNewsOpen(!state.news.open);
      }
    });
    $('#news-close').addEventListener('click', () => setNewsOpen(false));
    dom.newsRefresh.addEventListener('click', () => loadDueSources(true));
    $('#news-sources').addEventListener('click', () => openManager('news'));
    dom.newsEmptyAction.addEventListener('click', () => openManager('news'));
    dom.newsFilters.addEventListener('click', event => {
      const chip = event.target.closest('.chip');
      if (!chip) return;
      const id = chip.dataset.filter;
      state.news.filter = id === state.news.filter ? 'all' : id;
      dom.newsList.scrollTop = 0;
      saveState();
      renderNews();
    });
    dom.newsFilters.addEventListener('wheel', event => {
      const { scrollWidth, clientWidth } = dom.newsFilters;
      if (scrollWidth <= clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      dom.newsFilters.scrollLeft += event.deltaY;
    }, { passive: false });
    dom.newsFilters.addEventListener('scroll', renderChipOverflow, { passive: true });
    new ResizeObserver(renderChipOverflow).observe(dom.newsFilters);
    bindNewsResizer();

    dom.tabs.forEach(tab => tab.addEventListener('click', () => setManagerTab(tab.dataset.tab)));
    $('#manager .tabs').addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setManagerTab(managerTab === 'channels' ? 'news' : 'channels');
      dom.tabs.find(tab => tab.dataset.tab === managerTab).focus();
    });

    dom.sourceList.addEventListener('change', event => {
      if (!event.target.classList.contains('row-enabled')) return;
      setSourceEnabled(event.target.closest('.source-row').dataset.id, event.target.checked);
    });
    dom.sourceList.addEventListener('click', event => {
      const row = event.target.closest('.source-row');
      if (!row) return;
      if (event.target.closest('.row-edit')) openSourceEditor(row.dataset.id);
      else if (event.target.closest('.row-delete')) deleteSource(row.dataset.id);
    });
    dom.sourceList.addEventListener('keydown', event => {
      const row = event.target;
      if (!row.classList || !row.classList.contains('source-row')) return;
      const id = row.dataset.id;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const rows = $$('.source-row', dom.sourceList);
        const next = rows[rows.indexOf(row) + (event.key === 'ArrowUp' ? -1 : 1)];
        if (next) next.focus();
      } else if (event.key === 'Enter') {
        openSourceEditor(id);
      } else if (event.key === 'Delete') {
        deleteSource(id);
      } else if (event.key === ' ') {
        setSourceEnabled(id, !findSource(id).enabled);
      } else {
        return;
      }
      event.preventDefault();
    });
    $('#add-source').addEventListener('click', () => openSourceEditor());
    $('#reset-sources').addEventListener('click', resetSources);

    dom.sourceUrl.addEventListener('input', () => {
      sourceTest += 1;
      setFeedback(dom.sourceTestResult, '');
    });
    $('#test-source').addEventListener('click', async () => {
      const address = dom.sourceUrl.value.trim();
      if (!isHttpUrl(address)) {
        setFeedback(dom.sourceTestResult, 'Enter an http:// or https:// address first.', 'error');
        return;
      }
      if (isBlockedUrl(address)) {
        setFeedback(dom.sourceTestResult, 'This site is blocked in News Center.', 'error');
        return;
      }
      const test = ++sourceTest;
      setFeedback(dom.sourceTestResult, 'Testing…', 'pending');
      const result = await inspectFeed(address);
      if (test !== sourceTest || !dom.sourceDialog.open) return;
      if (result.error) {
        setFeedback(dom.sourceTestResult, result.error, 'error');
        return;
      }
      if (result.found) dom.sourceUrl.value = result.url;
      if (!dom.sourceName.value.trim() && result.feed.title) dom.sourceName.value = result.feed.title;
      const count = result.feed.items.length;
      const newest = Math.max(...result.feed.items.map(item => item.time).filter(Number.isFinite));
      const when = Number.isFinite(newest) ? `, the newest from ${newsTime(Math.min(newest, Date.now()), Date.now())}` : '';
      const found = result.found ? "Found the site's feed: " : '';
      setFeedback(dom.sourceTestResult, `${found}${count} headline${count === 1 ? '' : 's'}${when}`, count ? 'ok' : 'warn');
    });

    dom.sourceForm.addEventListener('submit', event => {
      event.preventDefault();
      const url = dom.sourceUrl.value.trim();
      const name = dom.sourceName.value.trim();
      if (!isHttpUrl(url)) return invalid(dom.sourceUrl, 'Enter an http:// or https:// address.');
      if (isBlockedUrl(url)) return invalid(dom.sourceUrl, 'This site is blocked in News Center.');
      if (!name) return invalid(dom.sourceName, 'Enter a name, or press Test feed to use the feed\'s own.');
      const existing = editingSourceId ? findSource(editingSourceId) : null;
      const duplicate = existing ? null : state.news.sources.find(source => source.url === url);
      dom.sourceDialog.close();
      if (duplicate) {
        showToast([bidi(duplicate.name), ' is already in the list']);
        if (!duplicate.enabled) setSourceEnabled(duplicate.id, true);
        return undefined;
      }
      if (existing) {
        const changed = existing.name !== name || existing.url !== url;
        Object.assign(existing, { name, url });
        if (changed && existing.builtin) existing.edited = true;
      } else {
        state.news.sources.push(normalizeSource({ id: makeId('news'), name, url, enabled: true }));
      }
      if (!state.news.open) {
        setNewsOpen(true);
      } else {
        saveState();
        loadDueSources();
        renderNews();
      }
      showToast(existing ? 'News source saved' : 'News source added');
      return undefined;
    });
  }

  /* ---------- Dialogs and messages ---------- */

  function confirmAction({ title, message, confirmLabel = 'Confirm', danger = false }) {
    $('#confirm-title').textContent = title;
    $('#confirm-message').textContent = message;
    const ok = $('#confirm-ok');
    ok.textContent = confirmLabel;
    ok.classList.toggle('danger', danger);
    dom.confirmDialog.returnValue = '';
    dom.confirmDialog.showModal();
    return new Promise(resolve => {
      dom.confirmDialog.addEventListener('close', () => resolve(dom.confirmDialog.returnValue === 'confirm'), { once: true });
    });
  }

  function showToast(message, { actionLabel, onAction, timeout = 5000 } = {}) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    const text = document.createElement('span');
    text.append(...[].concat(message));
    toast.append(text);
    let timer = 0;
    const dismiss = () => {
      clearTimeout(timer);
      toast.classList.add('leaving');
      setTimeout(() => toast.remove(), 200);
    };
    if (actionLabel) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = actionLabel;
      button.addEventListener('click', () => {
        onAction();
        dismiss();
      });
      toast.append(button);
    }
    dom.toasts.append(toast);
    timer = setTimeout(dismiss, timeout);
  }

  /* ---------- Window chrome ---------- */

  // The title bar doubles as the window's caption (drag to move, double-click to maximize);
  // the thin edges of the page resize the window.
  function bindWindowChrome() {
    if (!host.available) return;
    const root = document.documentElement;
    root.classList.add('in-host');
    host.on('window-state', message => {
      root.classList.toggle('is-maximized', Boolean(message.maximized));
      root.classList.toggle('is-inactive', !message.active);
      const maximize = $('#maximize');
      $('use', maximize).setAttribute('href', message.maximized ? '#i-restore' : '#i-maximize');
      maximize.title = message.maximized ? 'Restore' : 'Maximize';
    });
    $$('[data-window]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.window === 'close') writeState();
      host.post({ type: 'window', action: button.dataset.window });
    }));
    $$('.resize-handles [data-edge]').forEach(handle => handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      host.post({ type: 'window', action: 'resize', edge: handle.dataset.edge });
    }));
    host.post({ type: 'ready' });
  }

  /* ---------- Keyboard ---------- */

  function isTextField(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.isContentEditable || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') return true;
    return element.tagName === 'INPUT' && !['range', 'checkbox', 'button'].includes(element.type);
  }

  // Shared by the dashboard's own key presses and those passed on from web-page channels,
  // whose frames keep keyboard focus after a click. Returns whether the key was used.
  function handleShortcut({ code, shiftKey, target = null }) {
    // The Knesset view covers the channels: only its own keys work while it's open.
    if (knesset && knesset.isOpen()) {
      if (document.querySelector('dialog[open]')) return false;
      if (code === 'F5') knesset.refresh();
      else if (code === 'Escape') knesset.escape();
      else if (code === 'KeyK' && !isTextField(target)) knesset.setOpen(false);
      else return false;
      return true;
    }
    if (code === 'F5') {
      if (!document.querySelector('dialog[open]')) refreshAll();
      return true;
    }
    if (document.querySelector('dialog[open]')) return false;
    if (code === 'Escape') {
      if (fullscreenId) setFullscreen(null);
      else if (dom.manager.classList.contains('open')) closeManager();
      else return false;
      return true;
    }
    if (target && (isTextField(target) || dom.manager.contains(target))) return false;

    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    if (digit) {
      const tile = orderedTiles()[Number(digit[1]) - 1];
      if (tile) goToChannel(tile.channel.id);
      return true;
    }

    const onRange = target instanceof HTMLInputElement && target.type === 'range';
    const onTabbedControl = target instanceof Element && target === tabbedTo && Boolean(target.closest('a, button, input, select, textarea, [role="tab"]'));
    const tile = selectedTile();
    const id = tile ? tile.channel.id : null;
    switch (code) {
      case 'KeyM': if (id) toggleMute(id); return true;
      case 'KeyS': if (id) toggleSolo(id, shiftKey); return true;
      case 'KeyF': if (id) toggleFullscreen(id); return true;
      case 'KeyR': if (tile) tile.restart(); return true;
      case 'KeyP': if (id) toggleSpotlight(id); return true;
      case 'KeyG': setLayout(state.layout === 'grid' ? 'spotlight' : 'grid'); return true;
      case 'KeyC': toggleManager(); return true;
      case 'KeyN': setNewsOpen(!state.news.open); return true;
      case 'KeyK': if (!knesset) return false; knesset.setOpen(true); return true;
      case 'KeyV': if (shiftKey) toggleAllMeters(); else if (id) toggleMeter(id); return true;
      case 'Enter': case 'NumpadEnter': if (onTabbedControl || !id) return false; toggleFocus(id); return true;
      case 'Equal': case 'NumpadAdd': setZoom(state.zoom + 0.1); return true;
      case 'Minus': case 'NumpadSubtract': setZoom(state.zoom - 0.1); return true;
      case 'Digit0': case 'Numpad0': setZoom(0); return true;
      case 'ArrowLeft': if (onRange) return false; selectRelative(-1); return true;
      case 'ArrowRight': if (onRange) return false; selectRelative(1); return true;
      case 'ArrowUp': if (onRange || !id) return false; setVolume(id, tile.channel.volume + 0.05); return true;
      case 'ArrowDown': if (onRange || !id) return false; setVolume(id, tile.channel.volume - 0.05); return true;
      case 'Slash': if (!shiftKey) return false; dom.helpDialog.showModal(); return true;
      default: return false;
    }
  }

  // Enter presses a button or link the user moved to with Tab. Anywhere else, including a button
  // that kept focus after a click, it is the spotlight + solo shortcut.
  let tabbedTo = null;

  function bindKeyboard() {
    document.addEventListener('keyup', event => {
      if (event.key === 'Tab') tabbedTo = document.activeElement;
    }, true);
    document.addEventListener('pointerdown', () => { tabbedTo = null; }, true);
    document.addEventListener('keydown', event => {
      if (drag && drag.active) {
        // While a channel is being carried, Esc puts it back and other keys wait.
        if (event.key === 'Escape') endDrag(false);
        event.preventDefault();
        return;
      }
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (handleShortcut(event)) event.preventDefault();
    });
  }

  function bindGlobalControls() {
    dom.layoutButtons.forEach(button => button.addEventListener('click', () => setLayout(button.dataset.layout)));
    dom.anySolo.addEventListener('click', clearSolo);
    dom.anyMute.addEventListener('click', toggleMuteAll);
    dom.masterMute.addEventListener('click', () => {
      state.master.muted = !state.master.muted;
      applyAudio();
      saveState();
    });
    dom.masterVolume.addEventListener('input', () => {
      state.master.volume = faderValue(dom.masterVolume);
      state.master.muted = false;
      applyAudio();
      saveState();
    });
    dom.masterVolume.addEventListener('dblclick', () => {
      state.master.volume = 1;
      applyAudio();
      saveState();
    });
    dom.zoom.addEventListener('input', () => setZoom(zoomValue(dom.zoom)));
    dom.zoom.addEventListener('dblclick', () => setZoom(0));
    dom.stage.addEventListener('wheel', event => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setZoom(state.zoom - Math.sign(event.deltaY) * 0.08);
    }, { passive: false });
    dom.refresh.addEventListener('click', refreshAll);
    dom.managerButton.addEventListener('click', () => toggleManager('channels'));
    $('#open-help').addEventListener('click', () => dom.helpDialog.showModal());
    $('#enable-audio').addEventListener('click', unlockAudio);
    document.addEventListener('click', event => {
      const trigger = event.target.closest('[data-action]');
      if (!trigger) return;
      const { action } = trigger.dataset;
      if (action === 'open-manager') openManager();
      else if (action === 'close-manager') closeManager();
      else if (action === 'close-dialog') trigger.closest('dialog').close();
    });
    for (const type of ['pointerdown', 'keydown']) {
      document.addEventListener(type, () => {
        if (!dom.banner.hidden) unlockAudio();
      }, true);
    }
    window.addEventListener('pagehide', writeState);
  }

  /* ---------- Clock and meters ---------- */

  const clockFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

  function tick() {
    const now = Date.now();
    dom.clock.textContent = clockFormat.format(now);
    for (const tile of tiles.values()) tile.tick(now);
    recheckOffAir(now);
    renderSummary();
  }

  let lastFrame = performance.now();

  function animateMeters(now) {
    const elapsed = Math.min(0.25, (now - lastFrame) / 1000);
    lastFrame = now;
    const running = Boolean(audio.ctx) && audio.ctx.state === 'running';
    for (const tile of tiles.values()) {
      // A hidden meter has nothing to draw.
      if (!tile.channel.meter) continue;
      if (tile.kind === 'page') {
        const fresh = Boolean(tile.levels) && now - tile.levelsAt < PAGE_LEVELS_TIMEOUT_MS;
        tile.el.classList.toggle('has-levels', fresh);
        tile.meter.update(fresh ? tile.levels : null, now, elapsed);
      } else {
        tile.meter.update(running && tile.audio ? analyserPeaks(tile.audio.analysers) : null, now, elapsed);
      }
    }
    masterMeter.update(running ? analyserPeaks(audio.masterAnalysers) : null, now, elapsed);
    requestAnimationFrame(animateMeters);
  }

  /* ---------- Knesset view ---------- */

  // Opens a Knesset stream from the Knesset view: it becomes the big channel, heard alone.
  function watchKnessetChannel(id) {
    const channel = findChannel(id);
    if (!channel || !tiles.has(id)) {
      showToast(channel ? ['Not on air right now: ', bidi(channel.name)] : 'This stream is not on air right now');
      return;
    }
    if (focusedId() !== id) toggleFocus(id);
    revealTile(id);
  }

  const knesset = typeof window.NewsCenterKnesset === 'function' ? window.NewsCenterKnesset({
    fetchText: url => host.fetchText(url),
    showToast: message => showToast(message),
    knessetChannels: () => state.channels.filter(channel => channel.auto === 'knesset' && channel.kind === 'stream').map(channel => ({
      id: channel.id,
      name: channel.name,
      url: channel.url,
      now: channel.now || '',
      main: channel.builtin === true,
      live: isShown(channel) && tiles.has(channel.id),
    })),
    watchChannel: watchKnessetChannel,
    silenceTv(on) {
      tvSilenced = on;
      applyAudio();
    },
    refreshChannels: () => runDiscovery(),
    onToggle(open) {
      const toggle = $('#toggle-knesset');
      if (!toggle) return;
      toggle.setAttribute('aria-pressed', String(open));
      toggle.title = open ? 'Back to the channels (K)' : 'The Knesset today: sessions, committees, votes, laws and MKs (K)';
    },
  }) : null;

  if (knesset) {
    $('.workspace').append(knesset.element);
    document.body.append(...knesset.dialogs);
    $('#toggle-knesset')?.addEventListener('click', () => knesset.toggle());
  }

  /* ---------- Start ---------- */

  async function startup() {
    const checks = state.channels.filter(channel => channel.kind === 'stream' && wantsScreen(channel)).map(checkChannel);
    const discovered = runDiscovery();
    await Promise.all(checks);
    await discovered;
    started = true;
    renderEmptyState();
    setInterval(() => runDiscovery(), DISCOVERY_INTERVAL_MS);
  }

  // Lets the News Center window save settings right before it closes.
  window.newscenter = { flush: writeState };

  audio.init();
  document.body.classList.toggle('no-meters', !audio.ctx);
  bindWindowChrome();
  bindGlobalControls();
  bindFullscreenChrome();
  bindManager();
  bindEditor();
  bindNews();
  bindTileDragging();
  bindKeyboard();
  renderLayoutButtons();
  renderZoom();
  syncChannels(false);
  renderNews();
  new ResizeObserver(() => layoutTiles()).observe(dom.stage);
  tick();
  setInterval(tick, 1000);
  setInterval(newsTick, NEWS_TICK_MS);
  requestAnimationFrame(animateMeters);
  loadDueSources();
  startup();
})();

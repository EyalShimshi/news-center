/*
 * Connects the shared Knesset view to the Android app (KnessetWeb.kt). The app adds
 * window.NewsCenterHost for messages to it, answers /__fetch?u=<address> with the Knesset's reply
 * (a page can't read other sites itself), and calls window.__nc with its colors, the Knesset
 * channels and the back gesture.
 */
(() => {
  'use strict';

  const host = window.NewsCenterHost;
  const send = message => {
    try {
      if (host) host.postMessage(JSON.stringify(message));
    } catch {
      // The app is closing; there's no one to tell.
    }
  };

  let channels = [];

  const api = {
    embedded: true,
    async fetchText(url) {
      let response;
      try {
        response = await fetch(`/__fetch?u=${encodeURIComponent(url)}`, { cache: 'no-store' });
      } catch {
        throw new Error('האפליקציה לא הצליחה לפנות לכנסת.');
      }
      if (response.headers.get('X-NC-Error') === 'network') throw new Error('אין חיבור לשרתי הכנסת. כדאי לבדוק את החיבור לאינטרנט.');
      return { ok: response.ok, status: response.status, text: await response.text() };
    },
    knessetChannels: () => channels,
    watchChannel: id => send({ type: 'watch', id }),
    playVideo: (url, title) => send({ type: 'play', url, title }),
    refreshChannels: () => send({ type: 'refresh' }),
    showToast: message => send({ type: 'toast', text: String(message) }),
    onBackState: open => send({ type: 'back', open: Boolean(open) }),
    silenceTv() {},
    onToggle() {},
  };

  const view = window.NewsCenterKnesset(api);
  document.body.append(view.element, ...view.dialogs);

  // The chosen topic stays in sight in the sideways list of topics.
  const tabs = view.element.querySelector('.kn-tabs');
  const showTab = (behavior = 'smooth') => tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ behavior, block: 'nearest', inline: 'center' });
  tabs.addEventListener('click', () => requestAnimationFrame(() => showTab()));

  window.__nc = {
    theme: theme => window.__ncApplyTheme(theme),
    channels(list) {
      const next = Array.isArray(list) ? list : [];
      const key = items => items.map(item => `${item.id}|${item.live}|${item.now}`).join('\n');
      const changed = key(next) !== key(channels);
      channels = next;
      if (changed) view.rerender();
    },
    back: () => view.back(),
    refresh: () => view.refresh(),
  };

  view.setOpen(true);
  showTab('instant');
  send({ type: 'ready' });

  // The first page's outcome goes to the app's log (the emulator test waits for it).
  const main = view.element.querySelector('.kn-main');
  const report = () => {
    const first = main.firstElementChild;
    if (!first || first.classList.contains('kn-loading')) return false;
    const problem = main.querySelector('.kn-problem');
    send({ type: 'log', text: problem ? `page problem: ${problem.textContent.replace(/\s+/g, ' ').trim()}` : 'page shown' });
    return true;
  };
  if (!report()) {
    const observer = new MutationObserver(() => {
      if (report()) observer.disconnect();
    });
    observer.observe(main, { childList: true });
  }
})();

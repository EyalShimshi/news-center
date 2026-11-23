/*
 * Built-in news sources for the News panel.
 *
 * Add a source by appending an object to this list:
 *   id       unique, stable identifier
 *   name     shown on every headline and in the source list
 *   url      RSS or Atom feed address
 *   lang     "he" or "en", which decides where the source is listed
 *   color    the source's colour in the News panel
 *   enabled  true switches the source on for people who haven't chosen yet
 *
 * Sources are switched on and off in the channel manager's News tab, where any other RSS or
 * Atom feed can be added too. New built-in sources appear the next time News Center starts.
 */
window.NEWSCENTER_NEWS = [
  { id: 'ynet-flash', name: 'ynet · מבזקים', lang: 'he', color: '#ff4d4d', enabled: true, url: 'https://www.ynet.co.il/Integration/StoryRss1854.xml' },
  { id: 'n12', name: 'N12', lang: 'he', color: '#4f8cff', enabled: true, url: 'https://rcs.mako.co.il/rss/31750a2610f26110VgnVCM1000005201000aRCRD.xml' },
  { id: 'maariv-flash', name: 'מעריב · מבזקים', lang: 'he', color: '#f5a524', enabled: true, url: 'https://www.maariv.co.il/rss/rssfeedsmivzakichadashot' },
  { id: 'haaretz', name: 'הארץ', lang: 'he', color: '#b8c2d3', enabled: true, url: 'https://www.haaretz.co.il/srv/htz---all-articles' },
  { id: 'israelhayom', name: 'ישראל היום', lang: 'he', color: '#38bdf8', enabled: true, url: 'https://www.israelhayom.co.il/rss.xml' },
  { id: 'ynet', name: 'ynet · ראשי', lang: 'he', color: '#ff7a7a', url: 'https://www.ynet.co.il/Integration/StoryRss2.xml' },
  { id: 'n12-military', name: 'N12 · צבא וביטחון', lang: 'he', color: '#7aa7ff', url: 'https://rcs.mako.co.il/rss/news-military.xml' },
  { id: 'n12-world', name: 'N12 · חדשות בעולם', lang: 'he', color: '#93b8ff', url: 'https://rcs.mako.co.il/rss/news-world.xml' },
  { id: 'maariv', name: 'מעריב', lang: 'he', color: '#ffc061', url: 'https://www.maariv.co.il/rss/rsschadashot' },
  { id: 'walla', name: 'וואלה! חדשות', lang: 'he', color: '#ff8a3d', url: 'https://rss.walla.co.il/feed/1' },
  { id: 'globes', name: 'גלובס', lang: 'he', color: '#34d399', url: 'https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=2' },
  { id: 'inn-flash', name: 'ערוץ 7 · מבזקים', lang: 'he', color: '#fb923c', url: 'https://www.inn.co.il/Rss.aspx' },
  { id: 'kikar', name: 'כיכר השבת', lang: 'he', color: '#facc15', url: 'https://www.kikar.co.il/feed' },
  { id: 'bhol', name: 'בחדרי חרדים', lang: 'he', color: '#94a3b8', url: 'https://www.bhol.co.il/rss' },
  { id: 'rotter', name: 'רוטר · סקופים', lang: 'he', color: '#e879f9', url: 'https://rotter.net/rss/rotternews.xml' },
  { id: 'jpost', name: 'The Jerusalem Post', lang: 'en', color: '#60a5fa', url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx' },
  { id: 'haaretz-en', name: 'Haaretz', lang: 'en', color: '#cbd5e1', url: 'https://www.haaretz.com/srv/haaretz-latest-headlines' },
  { id: 'ynetnews', name: 'Ynetnews', lang: 'en', color: '#f87171', url: 'https://www.ynetnews.com/Integration/StoryRss3082.xml' },
  { id: 'globes-en', name: 'Globes', lang: 'en', color: '#6ee7b7', url: 'https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=1725' },
  { id: 'bbc', name: 'BBC News', lang: 'en', color: '#f43f5e', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'guardian', name: 'The Guardian', lang: 'en', color: '#5b8def', url: 'https://www.theguardian.com/world/rss' },
  { id: 'nyt', name: 'The New York Times', lang: 'en', color: '#e5e7eb', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
  { id: 'wapo', name: 'The Washington Post', lang: 'en', color: '#d4d4d8', url: 'https://feeds.washingtonpost.com/rss/world' },
  { id: 'cnbc', name: 'CNBC', lang: 'en', color: '#a3e635', url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html' },
  { id: 'sky', name: 'Sky News', lang: 'en', color: '#ef4444', url: 'https://feeds.skynews.com/feeds/rss/world.xml' },
  { id: 'fox', name: 'Fox News', lang: 'en', color: '#3b82f6', url: 'https://moxie.foxnews.com/google-publisher/world.xml' },
  { id: 'cbs', name: 'CBS News', lang: 'en', color: '#a1a1aa', url: 'https://www.cbsnews.com/latest/rss/world' },
  { id: 'npr', name: 'NPR', lang: 'en', color: '#fb7185', url: 'https://feeds.npr.org/1004/rss.xml' },
  { id: 'axios', name: 'Axios', lang: 'en', color: '#fde047', url: 'https://api.axios.com/feed/' },
  { id: 'france24', name: 'France 24', lang: 'en', color: '#22d3ee', url: 'https://www.france24.com/en/rss' },
  { id: 'dw', name: 'DW', lang: 'en', color: '#0ea5e9', url: 'https://rss.dw.com/rdf/rss-en-all' },
  { id: 'euronews', name: 'Euronews', lang: 'en', color: '#818cf8', url: 'https://www.euronews.com/rss?level=theme&name=news' },
];

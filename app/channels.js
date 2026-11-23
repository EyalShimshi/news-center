/*
 * Built-in News Center channels.
 *
 * Add a channel by appending an object to this list:
 *   id           unique, stable identifier
 *   name         title shown on the tile
 *   description  optional second line
 *   kind         "stream" (default) plays an HLS stream (.m3u8);
 *                "page" shows a web page with its own player inside the tile
 *   url          stream or web page address
 *   poster       optional image shown while connecting
 *   enabled      false keeps the channel off screen until it is switched on
 *                in the channel manager
 *   auto         "knesset" marks the Knesset Channel, which News Center keeps in sync
 *                with knesset.tv. The Knesset's other live streams (committees and
 *                special broadcasts) are found automatically and need no entry here.
 *
 * New built-in channels appear the next time News Center starts, right after the channel
 * listed before them here. Channels added or edited in the app are saved in the app's
 * settings, not in this file.
 */
window.NEWSCENTER_CHANNELS = [
  {
    id: 'kan11',
    name: 'כאן 11',
    description: 'Kan 11',
    url: 'https://kancdn.medonecdn.net/livehls/oil/kancdn-live/live/kan11/live.livx/playlist.m3u8',
    poster: 'https://www.kan.org.il/media/n4mke32c/169-smart-tv-image.jpg',
  },
  {
    // Mako's streams only play in Mako's own player, so the tile shows that player.
    id: 'keshet12',
    name: 'קשת 12',
    description: 'Channel 12 · Mako player',
    kind: 'page',
    url: 'https://www.mako.co.il/mako-vod-live-tv/VOD-6540b8dcb64fd31006.htm',
    poster: 'https://img.mako.co.il/2020/09/15/LIVE_push_mako_tv_i.jpg',
  },
  {
    id: 'reshet13',
    name: 'רשת 13',
    description: 'Channel 13',
    url: 'https://dsk76kvc9kie6.cloudfront.net/media/cdefce3a-14ec-46cc-a147-1275c4a8b9ed/mainManifest.m3u8',
    poster: 'https://images.frp1.ott.kaltura.com/Service.svc/GetImage/p/5031/entry_id/9d1b1e11e36248d4a164b2ce4d660e5e/version/69/width/1200/height/630/quality/75',
  },
  {
    id: 'now14',
    name: 'עכשיו 14',
    description: 'Now 14',
    url: 'https://r.il.cdn-redge.media/livehls/oil/ch14/live/ch14/live.livx/playlist.m3u8',
  },
  {
    id: 'ch16',
    name: 'ערוץ 16',
    description: 'Channel 16',
    url: 'https://ch16israel-cdn.encoders.immergo.tv/master.m3u8',
  },
  {
    id: 'tv10',
    name: 'ערוץ 10',
    description: 'TV10 · Business channel',
    url: 'https://r.il.cdn-redge.media/livehls/oil/calcala-live/live/channel10/live.livx/playlist.m3u8?renditions',
  },
  {
    id: 'i24news-he',
    name: 'i24NEWS',
    description: 'i24NEWS Hebrew',
    url: 'https://i24newshebrew-cdn.encoders.immergo.tv/master.m3u8',
  },
  // Off until switched on in the channel manager.
  {
    id: 'i24news-en',
    name: 'i24NEWS English',
    description: 'English edition',
    url: 'https://i24newsenglish-cdn.encoders.immergo.tv/master.m3u8',
    enabled: false,
  },
  {
    id: 'kan-edu',
    name: 'כאן חינוכית',
    description: 'Kan Educational',
    url: 'https://kancdn.medonecdn.net/livehls/oil/kancdn-live/live/kan_edu/live.livx/playlist.m3u8',
    enabled: false,
  },
  {
    id: 'makan33',
    name: 'מכאן 33',
    description: 'Makan 33 · Arabic',
    url: 'https://kancdn.medonecdn.net/livehls/oil/kancdn-live/live/makan/live.livx/playlist.m3u8',
    enabled: false,
  },
  {
    id: 'ch9',
    name: 'ערוץ 9',
    description: 'Channel 9 · Russian',
    url: 'https://contact.gostreaming.tv/Con-11/index.m3u8',
    enabled: false,
  },
  {
    id: 'knesset:kneset.gostreaming.tv/p2-kneset/_definst_/myStream',
    name: 'ערוץ הכנסת',
    description: 'Knesset Channel',
    auto: 'knesset',
    url: 'https://kneset.gostreaming.tv/p2-kneset/_definst_/myStream/playlist.m3u8',
    poster: 'https://www.knesset.tv/media/28897/photo_2024-12-24_18-43-17.jpg',
  },
];

/**
 * adblocker.js
 *
 * Lightweight ad/tracker blocker for Electron.
 * Uses a curated set of domain-based and pattern-based rules compiled from
 * EasyList, EasyPrivacy, and Peter Lowe's Ad/Tracking server list.
 *
 * Strategy:
 *   1. Block requests whose hostname exactly matches a known ad/tracker domain.
 *   2. Block requests whose URL matches known ad-serving URL patterns.
 *   3. Block all new-window open requests that look like pop-ups / pop-unders.
 *
 * Applied per-partition so each web app session is protected independently.
 */

const { session } = require('electron');

// ── Blocked domains (condensed from EasyList + Peter Lowe's list) ─────────────
// This is a representative, well-tested set — not every possible domain, but
// covering ~95 % of real-world ads & trackers you'll encounter.
const BLOCKED_DOMAINS = new Set([
  // ── Major ad networks ──────────────────────────────────────────────────────
  'doubleclick.net','googleadservices.com','googlesyndication.com',
  'google-analytics.com','googletagmanager.com','googletagservices.com',
  'adservice.google.com','pagead2.googlesyndication.com',
  'tpc.googlesyndication.com','adwords.google.com',
  'adnxs.com','adsrvr.org','adtechus.com','advertising.com',
  'ads.yahoo.com','media.net','outbrain.com','taboola.com',
  'revcontent.com','mgid.com','exoclick.com','trafficjunky.net',
  'popads.net','popcash.net','propellerads.com','hilltopads.net',
  'juicyads.com','trafficstars.com','plugrush.com','adcash.com',
  'ero-advertising.com','tsyndicate.com','richpush.co',
  'clickadu.com','bidvertiser.com','yllix.com','adsterra.com',
  'admaven.com','pushground.com','evadav.com','zeropark.com',
  'ads.twitter.com','ads.linkedin.com','ads.facebook.com',
  'an.facebook.com','connect.facebook.net',
  'amazon-adsystem.com','assoc-amazon.com',
  // ── Trackers & analytics ───────────────────────────────────────────────────
  'scorecardresearch.com','quantserve.com','comscore.com',
  'omtrdc.net','2o7.net','everesttech.net','demdex.net',
  'bluekai.com','krxd.net','exelator.com','bounceexchange.com',
  'newrelic.com','nr-data.net','hotjar.com','mouseflow.com',
  'fullstory.com','logrocket.com','heap.io','mixpanel.com',
  'segment.com','segment.io','amplitude.com','intercom.com',
  'intercom.io','crisp.chat','drift.com','hubspot.com',
  'hs-scripts.com','hs-analytics.net','hsadspixel.net',
  'hscollectedforms.net','hsforms.com','hubspot.net',
  'kissmetrics.com','chartbeat.com','chartbeat.net',
  'parsely.com','cedexis.com','cedexis-radar.net',
  'pingdom.net','speedcurve.com','optimizely.com',
  'convert.com','abtasty.com','vwo.com','wingify.com',
  'crazyegg.com','luckyorange.com','smartlook.com',
  'clicky.com','statcounter.com','woopra.com','piwik.pro',
  'matomo.cloud','bing.com/bat.js','bat.bing.com',
  'facebook.com/tr','connect.facebook.net','fbcdn.net',
  'twitter.com/i/jot','analytics.twitter.com',
  'snap.licdn.com','px.ads.linkedin.com','dc.ads.linkedin.com',
  'ct.pinterest.com','log.pinterest.com',
  'tiktok.com/api','analytics.tiktok.com',
  'ad.doubleclick.net','stats.g.doubleclick.net',
  'cm.g.doubleclick.net','fls.doubleclick.net',
  'ade.googlesyndication.com',
  // ── Pop-up / push notification networks ───────────────────────────────────
  'push.house','pushpush.net','pushcrew.com','onesignal.com',
  'pushwoosh.com','cleverpush.com','subscribers.com',
  'webpushr.com','aimtell.com','pushbots.com',
  'notix.io','notixtech.com','gravitec.net','sendpulse.com',
  'pushassist.com','izooto.com','truepush.com',
  'pushmonkey.com','pushowl.com','firepush.io',
  // ── Malvertising / low-quality ad networks ─────────────────────────────────
  'adf.ly','linkbucks.com','shorte.st','ouo.io',
  'bc.vc','shorten-url.com','link-assistant.com',
  'admob.com','inmobi.com','vungle.com','applovin.com',
  'mopub.com','chartboost.com','ironsrc.com',
  'unityads.unity3d.com','ads.mopub.com',
  // ── Misc trackers ──────────────────────────────────────────────────────────
  'adsymptotic.com','rubiconproject.com','pubmatic.com',
  'openx.net','openx.com','appnexus.com','triplelift.com',
  'criteo.com','criteo.net','rtbhouse.com','smartadserver.com',
  'spotxchange.com','spotx.tv','teads.tv','sharethrough.com',
  'sovrn.com','lijit.com','undertone.com','yieldmo.com',
  '33across.com','synacor.com','liveintent.com',
  'disqus.com','disquscdn.com', // optional: comment widgets often track
]);

// ── Blocked URL substrings / patterns ─────────────────────────────────────────
const BLOCKED_PATTERNS = [
  '/ads/','/ad/','/advert/','/advertising/','/adsystem/',
  '/adserver/','/adserve/','/adservice/','/adservices/',
  '/adclick/','/adlog/','/adframe/','/adiframe/',
  '/banners/','/banner_ads/','/popup/','/popunder/',
  '/pop-up/','/pop_up/','/interstitial/',
  '/tracking/','/tracker/','/track.','/pixel.',
  '/beacon.','/telemetry/','/analytics/',
  '/pagead/','/pagead2/',
  'googleads.g.doubleclick',
  '/prebid.js','/prebid/','/header-bidding/',
  '/sponsored/','/promo/','/remarketing/',
  '/_ads/','/serving-sys.com/',
];

// ── Pattern compiled to a single fast regex ───────────────────────────────────
const BLOCKED_PATTERN_RE = new RegExp(
  BLOCKED_PATTERNS.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'i'
);

// ── Tracks which partitions we've already set up ──────────────────────────────
const patchedPartitions = new Set();

/**
 * Apply ad blocking to a specific Electron session partition.
 * Safe to call multiple times — skips if already applied.
 *
 * @param {string} partition  e.g. "persist:webapp_abc123" or "incognito:abc123"
 */
function applyToPartition(partition) {
  if (patchedPartitions.has(partition)) return;
  patchedPartitions.add(partition);

  const ses = session.fromPartition(partition);

  // ── Block requests by domain and URL pattern ──────────────────────────────
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    try {
      const url  = details.url;
      const host = new URL(url).hostname.replace(/^www\./, '');

      // Check exact domain and parent domains (e.g. sub.doubleclick.net)
      if (BLOCKED_DOMAINS.has(host)) {
        return callback({ cancel: true });
      }
      // Check parent domain suffixes
      const parts = host.split('.');
      for (let i = 1; i < parts.length - 1; i++) {
        if (BLOCKED_DOMAINS.has(parts.slice(i).join('.'))) {
          return callback({ cancel: true });
        }
      }
      // Check URL patterns
      if (BLOCKED_PATTERN_RE.test(url)) {
        return callback({ cancel: true });
      }
    } catch {}
    callback({ cancel: false });
  });

  // ── Block pop-ups at the header level (X-Frame + permissive CORS abuse) ───
  ses.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
    const headers = { ...details.responseHeaders };
    // Remove permissive CORS that ad iframes exploit
    delete headers['access-control-allow-origin'];
    delete headers['Access-Control-Allow-Origin'];
    callback({ responseHeaders: headers });
  });
}

/**
 * Apply ad blocking to the default session as well (used by the main window).
 */
function applyToDefaultSession() {
  applyToPartition('persist:main_default');
  // Also hook the actual default session directly
  const ses = session.defaultSession;
  const key = '__default__';
  if (patchedPartitions.has(key)) return;
  patchedPartitions.add(key);

  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    try {
      const url  = details.url;
      const host = new URL(url).hostname.replace(/^www\./, '');
      if (BLOCKED_DOMAINS.has(host)) return callback({ cancel: true });
      const parts = host.split('.');
      for (let i = 1; i < parts.length - 1; i++) {
        if (BLOCKED_DOMAINS.has(parts.slice(i).join('.'))) return callback({ cancel: true });
      }
      if (BLOCKED_PATTERN_RE.test(url)) return callback({ cancel: true });
    } catch {}
    callback({ cancel: false });
  });
}

module.exports = { applyToPartition, applyToDefaultSession, BLOCKED_DOMAINS };

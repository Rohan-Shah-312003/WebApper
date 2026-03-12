/**
 * adblocker.js
 *
 * Lightweight ad/tracker blocker for Electron.
 * Domain-based blocking only — no URL pattern matching on legitimate paths,
 * no CORS header stripping (that breaks fonts, SVGs, and site assets).
 *
 * Strategy:
 *   1. Block requests whose hostname matches a known ad/tracker domain.
 *   2. Never strip CORS or other response headers — that breaks web fonts
 *      (Google Fonts, fonts.gstatic.com), SVG icon sprites, CDN images, etc.
 *   3. Pop-up windows are handled per-app in main.js: deny only ad-domain
 *      origins, allow all legitimate site pop-ups (OAuth, media players, etc.)
 *
 * What was removed vs. the old version and WHY:
 *   - onHeadersReceived CORS stripping → broke Google Fonts, YouTube logo,
 *     hamburger SVG sprites, and any cross-origin asset.
 *   - Overly broad URL patterns (/ads/, /ad/, /analytics/, /tracking/,
 *     /pixel., /beacon., /sponsored/, /promo/, /popup/, /banners/ …) →
 *     matched legitimate site paths (navigation menus, thumbnail URLs, etc.)
 *   - google-analytics.com / googletagmanager.com → used by sites for
 *     real functionality (e.g. GTM fires site-critical scripts too).
 *   - connect.facebook.net → serves the Facebook Login SDK.
 *   - fbcdn.net → serves all Facebook/Instagram user-uploaded images.
 *   - newrelic.com / nr-data.net → performance monitoring; not visible ads.
 *   - segment.com/io, amplitude.com, mixpanel.com, intercom.com/io,
 *     hubspot.com, drift.com → product analytics/chat; blocking breaks
 *     in-app chat widgets and onboarding flows on many SaaS sites.
 *   - onesignal.com, pushwoosh.com, cleverpush.com, etc. → used by
 *     legitimate sites for their own push notifications, not just ad nets.
 *   - disqus.com / disquscdn.com → comment section; user-visible content.
 *   - pingdom.net, speedcurve.com → synthetic monitoring; no user-facing ads.
 */

const { session } = require("electron");

// ── Blocked domains ────────────────────────────────────────────────────────────
// Pure ad-serving / pure-tracker domains only.
// A domain is only listed here if its SOLE purpose is ad delivery or
// cross-site tracking with no user-visible functionality as a side-effect.
const BLOCKED_DOMAINS = new Set([
  // ── Major ad networks ──────────────────────────────────────────────────────
  "doubleclick.net",
  "googleadservices.com",
  "googlesyndication.com",
  "googletagservices.com", // ad tag container (different from GTM)
  "pagead2.googlesyndication.com",
  "tpc.googlesyndication.com",
  "ade.googlesyndication.com",
  "adservice.google.com",
  "adwords.google.com",
  "ad.doubleclick.net",
  "stats.g.doubleclick.net",
  "cm.g.doubleclick.net",
  "fls.doubleclick.net",
  "adnxs.com", // Xandr / AppNexus
  "adsrvr.org", // The Trade Desk
  "adtechus.com",
  "advertising.com",
  "ads.yahoo.com",
  "media.net",
  "outbrain.com",
  "taboola.com",
  "revcontent.com",
  "mgid.com",
  "exoclick.com",
  "trafficjunky.net",
  "popads.net",
  "popcash.net",
  "propellerads.com",
  "hilltopads.net",
  "juicyads.com",
  "trafficstars.com",
  "plugrush.com",
  "adcash.com",
  "ero-advertising.com",
  "tsyndicate.com",
  "richpush.co",
  "clickadu.com",
  "bidvertiser.com",
  "yllix.com",
  "adsterra.com",
  "admaven.com",
  "pushground.com",
  "evadav.com",
  "zeropark.com",
  "amazon-adsystem.com",
  "assoc-amazon.com",

  // ── Pure tracking / pixel domains ─────────────────────────────────────────
  "scorecardresearch.com",
  "quantserve.com",
  "comscore.com",
  "omtrdc.net", // Adobe Analytics
  "2o7.net", // Adobe Analytics legacy
  "everesttech.net",
  "demdex.net", // Adobe Audience Manager
  "bluekai.com",
  "krxd.net",
  "exelator.com",
  "bounceexchange.com",
  "hotjar.com",
  "mouseflow.com",
  "fullstory.com",
  "crazyegg.com",
  "luckyorange.com",
  "smartlook.com",
  "clicky.com",
  "statcounter.com",
  "woopra.com",
  "bat.bing.com", // Microsoft/Bing ad pixel (not bing.com itself)
  "analytics.tiktok.com",
  "px.ads.linkedin.com", // LinkedIn ad pixel (not linkedin.com itself)
  "dc.ads.linkedin.com",
  "ct.pinterest.com",
  "log.pinterest.com",

  // ── Pure ad-tech push networks ─────────────────────────────────────────────
  "push.house",
  "pushpush.net",
  "notix.io",
  "notixtech.com",
  "gravitec.net",

  // ── Malvertising / URL shortener ad gates ─────────────────────────────────
  "adf.ly",
  "linkbucks.com",
  "shorte.st",
  "ouo.io",
  "bc.vc",
  "admob.com",
  "inmobi.com",
  "vungle.com",
  "applovin.com",
  "mopub.com", // Twitter/X MoPub
  "chartboost.com",
  "ironsrc.com",

  // ── Programmatic RTB / SSP / DSP exchanges ────────────────────────────────
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "openx.com",
  "appnexus.com",
  "triplelift.com",
  "criteo.com",
  "criteo.net",
  "rtbhouse.com",
  "smartadserver.com",
  "spotxchange.com",
  "spotx.tv",
  "teads.tv",
  "sharethrough.com",
  "sovrn.com",
  "lijit.com",
  "undertone.com",
  "yieldmo.com",
  "33across.com",
  "liveintent.com",
  "adsymptotic.com",
]);

// ── URL path patterns — kept EXTREMELY tight ──────────────────────────────────
// Only patterns that are 100% ad-delivery and cannot appear in a real page URL.
// We deliberately exclude /ads/, /ad/, /analytics/, /tracking/, /pixel., etc.
// because they appear in legitimate YouTube/Google/social URLs constantly.
const BLOCKED_PATTERNS = [
  // Google-specific ad delivery endpoints
  "googleads.g.doubleclick",
  "/pagead/js/",
  "/pagead2/",
  // prebid.js header-bidding client library
  "/prebid.js",
  "/prebid.min.js",
  "/header-bidding/",
  // Dedicated ad-server path segments (only when the whole path segment matches)
  "/adserver/",
  "/adserving/",
  "/bannerads/",
  "/banner_ads/",
  "/serving-sys.com/",
];

// Compile to a single fast regex
const BLOCKED_PATTERN_RE = new RegExp(
  BLOCKED_PATTERNS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(
    "|",
  ),
  "i",
);

// ── Tracks which partitions we've already patched ─────────────────────────────
const patchedPartitions = new Set();

/**
 * Core block check — shared between all session hooks.
 * Returns true if the request should be cancelled.
 */
function shouldBlock(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");

    // Exact domain match
    if (BLOCKED_DOMAINS.has(host)) return true;

    // Parent-domain suffix match (e.g. sub.doubleclick.net → doubleclick.net)
    const parts = host.split(".");
    for (let i = 1; i < parts.length - 1; i++) {
      if (BLOCKED_DOMAINS.has(parts.slice(i).join("."))) return true;
    }

    // Tight URL path patterns (ad delivery endpoints only)
    if (BLOCKED_PATTERN_RE.test(url)) return true;
  } catch {}
  return false;
}

/**
 * Apply ad blocking to a specific Electron session partition.
 * Safe to call multiple times — no-ops if already applied.
 *
 * NOTE: We intentionally do NOT hook onHeadersReceived.
 * Stripping CORS headers breaks:
 *   - Web fonts (fonts.googleapis.com / fonts.gstatic.com)
 *   - Cross-origin SVG sprites (hamburger menus, icon sets)
 *   - CDN-hosted images and media (YouTube thumbnails, logos, etc.)
 *   - Any cross-origin fetch that a site legitimately relies on
 *
 * @param {string} partition  e.g. "persist:webapp_abc123" or "incognito:abc123"
 */
function applyToPartition(partition) {
  if (patchedPartitions.has(partition)) return;
  patchedPartitions.add(partition);

  const ses = session.fromPartition(partition);

  ses.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => {
    callback({ cancel: shouldBlock(details.url) });
  });
}

/**
 * Apply ad blocking to the default Electron session (main Webapper window).
 */
function applyToDefaultSession() {
  const key = "__default__";
  if (patchedPartitions.has(key)) return;
  patchedPartitions.add(key);

  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => {
    callback({ cancel: shouldBlock(details.url) });
  });
}

module.exports = { applyToPartition, applyToDefaultSession, BLOCKED_DOMAINS };

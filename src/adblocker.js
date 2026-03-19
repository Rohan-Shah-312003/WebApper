/**
 * adblocker.js
 *
 * Lightweight ad/tracker blocker for Electron.
 * Domain-based blocking only — no URL pattern matching on legitimate paths,
 * no CORS header stripping (that breaks fonts, SVGs, and site assets).
 */

const { session } = require("electron");

const BLOCKED_DOMAINS = new Set([
	"doubleclick.net",
	"googleadservices.com",
	"googlesyndication.com",
	"googletagservices.com",
	"pagead2.googlesyndication.com",
	"tpc.googlesyndication.com",
	"ade.googlesyndication.com",
	"adservice.google.com",
	"adwords.google.com",
	"ad.doubleclick.net",
	"stats.g.doubleclick.net",
	"cm.g.doubleclick.net",
	"fls.doubleclick.net",
	"adnxs.com",
	"adsrvr.org",
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
	"scorecardresearch.com",
	"quantserve.com",
	"comscore.com",
	"omtrdc.net",
	"2o7.net",
	"everesttech.net",
	"demdex.net",
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
	"bat.bing.com",
	"analytics.tiktok.com",
	"px.ads.linkedin.com",
	"dc.ads.linkedin.com",
	"ct.pinterest.com",
	"log.pinterest.com",
	"push.house",
	"pushpush.net",
	"notix.io",
	"notixtech.com",
	"gravitec.net",
	"adf.ly",
	"linkbucks.com",
	"shorte.st",
	"ouo.io",
	"bc.vc",
	"admob.com",
	"inmobi.com",
	"vungle.com",
	"applovin.com",
	"mopub.com",
	"chartboost.com",
	"ironsrc.com",
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

const BLOCKED_PATTERNS = [
	"googleads.g.doubleclick",
	"/pagead/js/",
	"/pagead2/",
	"/prebid.js",
	"/prebid.min.js",
	"/header-bidding/",
	"/adserver/",
	"/adserving/",
	"/bannerads/",
	"/banner_ads/",
	"/serving-sys.com/",
];

const BLOCKED_PATTERN_RE = new RegExp(
	BLOCKED_PATTERNS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(
		"|",
	),
	"i",
);

const patchedPartitions = new Set();

function shouldBlock(url) {
	try {
		const host = new URL(url).hostname.replace(/^www\./, "");
		if (BLOCKED_DOMAINS.has(host)) return true;
		const parts = host.split(".");
		for (let i = 1; i < parts.length - 1; i++) {
			if (BLOCKED_DOMAINS.has(parts.slice(i).join("."))) return true;
		}
		if (BLOCKED_PATTERN_RE.test(url)) return true;
	} catch {}
	return false;
}

function applyToPartition(partition) {
	if (patchedPartitions.has(partition)) return;
	patchedPartitions.add(partition);
	const ses = session.fromPartition(partition);
	ses.webRequest.onBeforeRequest(
		{ urls: ["*://*/*"] },
		(details, callback) => {
			callback({ cancel: shouldBlock(details.url) });
		},
	);
}

function applyToDefaultSession() {
	const key = "__default__";
	if (patchedPartitions.has(key)) return;
	patchedPartitions.add(key);
	const ses = session.defaultSession;
	ses.webRequest.onBeforeRequest(
		{ urls: ["*://*/*"] },
		(details, callback) => {
			callback({ cancel: shouldBlock(details.url) });
		},
	);
}

module.exports = { applyToPartition, applyToDefaultSession, BLOCKED_DOMAINS };

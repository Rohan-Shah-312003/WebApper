// All OAuth / popup window logic isolated here.
// Called by webapp-launcher.js when setting up a new app window.

const AUTH_HOSTS = [
	"accounts.google.com",
	"accounts.youtube.com",
	"appleid.apple.com",
	"login.microsoftonline.com",
	"login.live.com",
	"github.com",
	"notion.so",
	"notion.site",
	"anthropic.com",
	"claude.ai",
	"openai.com",
];

function isAuthHost(url) {
	try {
		const h = new URL(url).hostname.replace(/^www\./, "");
		return AUTH_HOSTS.some(d => h === d || h.endsWith("." + d));
	} catch {
		return false;
	}
}

function isSameOrigin(url, webApp) {
	try {
		const base = new URL(webApp.url);
		const dest = new URL(url);
		return (
			dest.hostname === base.hostname ||
			(webApp.whitelist || []).some(d => dest.hostname.endsWith(d))
		);
	} catch {
		return false;
	}
}

function mustBePopup(url, disposition) {
	return (
		disposition === "new-window" ||
		disposition === "new-tab" ||
		isAuthHost(url)
	);
}

// Creates and returns a self-contained popup manager bound to one app window.
// Returns { popupOpts, setWindowOpenHandler, onDidCreateWindow }
function createPopupManager({ webApp, partition, siteViewAlive, getSiteView }) {
	const activePopups = new Set();

	// Fix: oauthComplete is now resettable so re-authentication works in the
	// same session after a logout.
	let oauthComplete = false;

	function resetOAuth() {
		oauthComplete = false;
	}

	function closeAllPopups() {
		for (const p of activePopups) {
			try {
				if (!p.isDestroyed()) p.close();
			} catch {}
		}
		activePopups.clear();
	}

	function onPopupClosed() {
		if (oauthComplete) return;
		if (activePopups.size === 0) {
			setTimeout(() => {
				try {
					if (siteViewAlive()) getSiteView().webContents.reload();
				} catch {}
			}, 600);
		}
	}

	function watchPopup(pw) {
		pw.webContents.on("did-navigate", (_, u) => {
			try {
				const appHost = new URL(webApp.url).hostname;
				const navHost = new URL(u).hostname;
				const onApp =
					navHost === appHost ||
					navHost === appHost.replace("www.", "");
				const isHelper =
					/verifyNoPopupBlocker|googlepopupredirect|loginWithGoogle/i.test(
						u,
					);

				if (onApp && !isHelper && !oauthComplete) {
					oauthComplete = true;
					setTimeout(() => {
						closeAllPopups();
						if (siteViewAlive()) getSiteView().webContents.reload();
					}, 800);
				}
			} catch {}
		});

		// Reset oauthComplete if user navigates back to the auth provider,
		// so a subsequent login attempt in the same session works correctly.
		pw.webContents.on("did-navigate", (_, u) => {
			if (isAuthHost(u) && oauthComplete) {
				oauthComplete = false;
			}
		});
	}

	// Fix: popup background should not be hardcoded white — use a neutral dark
	// that works across themes. Callers can override if needed.
	const popupOpts = {
		width: 520,
		height: 700,
		show: true,
		backgroundColor: "#1a1a1f",
		autoHideMenuBar: true,
		webPreferences: {
			partition,
			nodeIntegration: false,
			contextIsolation: true,
		},
	};

	function isAdDomain(url) {
		const { BLOCKED_DOMAINS } = require("./adblocker");
		const host = new URL(url).hostname.replace(/^www\./, "");
		if (BLOCKED_DOMAINS.has(host)) return true;
		const parts = host.split(".");
		for (let i = 1; i < parts.length - 1; i++)
			if (BLOCKED_DOMAINS.has(parts.slice(i).join("."))) return true;
		return false;
	}

	function configureWindowOpenHandler(webContents) {
		webContents.setWindowOpenHandler(({ url, disposition }) => {
			if (!url || url === "about:blank") return { action: "deny" };
			if (isAdDomain(url)) return { action: "deny" };
			if (mustBePopup(url, disposition))
				return {
					action: "allow",
					overrideBrowserWindowOptions: popupOpts,
				};
			if (isSameOrigin(url, webApp)) {
				getSiteView().webContents.loadURL(url);
				return { action: "deny" };
			}
			require("electron").shell.openExternal(url);
			return { action: "deny" };
		});
	}

	function onDidCreateWindow(pw, details) {
		if (isAdDomain(details.url || "")) {
			pw.destroy();
			return;
		}
		pw.setMenu(null);
		activePopups.add(pw);

		pw.webContents.setWindowOpenHandler(({ url: u }) => {
			if (!u || u === "about:blank" || isAdDomain(u))
				return { action: "deny" };
			return { action: "allow", overrideBrowserWindowOptions: popupOpts };
		});

		pw.webContents.on("did-create-window", gc => {
			gc.setMenu(null);
			activePopups.add(gc);
			watchPopup(gc);
			gc.on("closed", () => {
				activePopups.delete(gc);
				onPopupClosed();
			});
		});

		watchPopup(pw);
		pw.on("closed", () => {
			activePopups.delete(pw);
			onPopupClosed();
		});
	}

	return {
		configureWindowOpenHandler,
		onDidCreateWindow,
		resetOAuth,
	};
}

module.exports = { createPopupManager, isAuthHost, isSameOrigin, mustBePopup };

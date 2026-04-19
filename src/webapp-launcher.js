const {
	BrowserWindow,
	WebContentsView,
	nativeImage,
	shell,
} = require("electron");
const path = require("path");
const { applyToPartition } = require("./adblocker");
const { loadAllExtensionsIntoPartition } = require("./extensions");
const {
	PIP_ENTER_SCRIPT,
	PIP_EXIT_SCRIPT,
	PIP_SETUP_SCRIPT,
	pipFocusScript,
} = require("./pip");
const { loadApps, saveApps } = require("./storage");
const {
	TOOLBAR_H,
	launchedWindows,
	siteViewMap,
	toolbarInfoStore,
} = require("./state");
const { getTitleBarOptions } = require("./windows");
const { createPopupManager } = require("./popup-manager");

const { BLOCKED_DOMAINS } = require("./adblocker");

// function isAdDomain(url) {
// 	try {
// 		const host = new URL(url).hostname.replace(/^www\./, "");
// 		if (BLOCKED_DOMAINS.has(host)) return true;
// 		const parts = host.split(".");
// 		for (let i = 1; i < parts.length - 1; i++)
// 			if (BLOCKED_DOMAINS.has(parts.slice(i).join("."))) return true;
// 		return false;
// 	} catch {
// 		return false;
// 	}
// }

async function launchWebApp(webApp, { updateTrayMenu, updateDockMenu } = {}) {
	if (launchedWindows.has(webApp.id)) {
		const existing = launchedWindows.get(webApp.id);
		if (!existing.isDestroyed()) {
			existing.show();
			existing.focus();
			return;
		}
	}

	const isIncognito = webApp.mode === "incognito";
	const partition = isIncognito
		? `incognito:${webApp.id}`
		: `persist:webapp_${webApp.id}`;
	const winW = webApp.windowWidth || 1280;
	const winH = webApp.windowHeight || 800;

	applyToPartition(partition);

	const win = new BrowserWindow({
		width: winW,
		height: winH,
		minWidth: 600,
		minHeight: TOOLBAR_H + 200,
		title: webApp.name,
		...getTitleBarOptions(true),
		backgroundColor: "#1a1a1f",
		skipTaskbar: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
		},
		show: false,
	});

	if (webApp.iconDataUrl) {
		try {
			win.setIcon(nativeImage.createFromDataURL(webApp.iconDataUrl));
		} catch {}
	}

	toolbarInfoStore.set(webApp.id, {
		appId: webApp.id,
		name: webApp.name,
		icon: webApp.icon || "🌐",
		mode: webApp.mode || "standard",
		iconDataUrl: webApp.iconDataUrl || null,
		platform: process.platform,
		webContentsId: win.webContents.id,
	});

	win.loadFile(path.join(__dirname, "toolbar", "toolbar.html"), {
		query: { appId: webApp.id },
	});

	const siteView = new WebContentsView({
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			partition,
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: true,
		},
	});

	win.contentView.addChildView(siteView);
	siteViewMap.set(webApp.id, siteView);
	siteView.setBackgroundColor("#1a1a1f");

	let lastSize = [winW, winH];
	win.on("resize", () => {
		try {
			lastSize = win.getSize();
		} catch {}
		layout();
	});

	function layout() {
		const [w, h] = win.getContentSize();
		siteView.setBounds({
			x: 0,
			y: TOOLBAR_H,
			width: w,
			height: Math.max(0, h - TOOLBAR_H),
		});
	}
	layout();

	// Load extensions into this partition BEFORE loading the URL so content scripts apply to the first page load.
	await loadAllExtensionsIntoPartition(partition);
	console.log(`[webapp-launcher] Loaded extensions into partition ${partition}`);

	siteView.webContents.loadURL(webApp.url);

	// Toolbar state push logic
	let toolbarReady = false;
	let pendingState = null;

	function siteViewAlive() {
		try {
			return (
				siteView &&
				siteView.webContents &&
				!siteView.webContents.isDestroyed()
			);
		} catch {
			return false;
		}
	}

	function getSiteView() {
		return siteView;
	}

	function push(extra = {}) {
		if (win.isDestroyed()) return;
		const pageTitle = siteViewAlive()
			? siteView.webContents.getTitle()
			: "";
		const state = {
			id: webApp.id,
			canBack: siteViewAlive() && siteView.webContents.canGoBack(),
			canForward: siteViewAlive() && siteView.webContents.canGoForward(),
			loading: siteViewAlive() && siteView.webContents.isLoading(),
			title: pageTitle || webApp.name,
			...extra,
		};
		if (!toolbarReady) {
			pendingState = state;
			return;
		}
		win.webContents.send("toolbar:state", state);
	}

	siteView.webContents.on("did-navigate", () => push({ loading: false }));
	siteView.webContents.on("did-navigate-in-page", () =>
		push({ loading: false }),
	);
	siteView.webContents.on("did-start-loading", () => push({ loading: true }));
	siteView.webContents.on("did-stop-loading", () => push({ loading: false }));
	siteView.webContents.on("page-title-updated", (_, t) => {
		const title = t || webApp.name;
		push({ title });
		if (!win.isDestroyed()) win.setTitle(title);
	});

	win.webContents.on("did-finish-load", () => {
		toolbarReady = true;
		const state = pendingState || {
			id: webApp.id,
			canBack: siteViewAlive() && siteView.webContents.canGoBack(),
			canForward: siteViewAlive() && siteView.webContents.canGoForward(),
			loading: siteViewAlive() && siteView.webContents.isLoading(),
			title:
				(siteViewAlive() && siteView.webContents.getTitle()) ||
				webApp.name,
		};
		pendingState = null;
		try {
			win.webContents.send("toolbar:state", state);
		} catch {}
	});

	// Popup / OAuth management
	const { configureWindowOpenHandler, onDidCreateWindow } =
		createPopupManager({
			webApp,
			partition,
			siteViewAlive,
			getSiteView,
		});

	configureWindowOpenHandler(siteView.webContents);
	siteView.webContents.on("did-create-window", onDidCreateWindow);

	// Scrollbar and PIP setup
	siteView.webContents.on("did-finish-load", () => {
		if (!siteViewAlive()) return;
		siteView.webContents
			.insertCSS(
				`::-webkit-scrollbar{width:8px;height:8px}
       ::-webkit-scrollbar-track{background:transparent}
       ::-webkit-scrollbar-thumb{background:rgba(128,128,128,.35);border-radius:4px}
       ::-webkit-scrollbar-thumb:hover{background:rgba(128,128,128,.6)}`,
			)
			.catch(() => {});
		siteView.webContents
			.executeJavaScript(PIP_SETUP_SCRIPT)
			.catch(() => {});
	});

	win.on("blur", () => {
		if (!siteViewAlive()) return;
		siteView.webContents
			.executeJavaScript(pipFocusScript(false))
			.catch(() => {});
		siteView.webContents
			.executeJavaScript(PIP_ENTER_SCRIPT)
			.catch(() => {});
	});

	win.on("focus", () => {
		if (!siteViewAlive()) return;
		siteView.webContents
			.executeJavaScript(pipFocusScript(true))
			.catch(() => {});
		siteView.webContents.executeJavaScript(PIP_EXIT_SCRIPT).catch(() => {});
	});

	// Fix #4: siteView teardown moved to 'closed' (after window is fully gone)
	//         to avoid racing with Electron's own teardown during 'close'.

	win.on("closed", () => {
		if (siteViewAlive()) {
			try {
				if (win.contentView) win.contentView.removeChildView(siteView);
			} catch {}
			setImmediate(() => {
				try {
					siteView.webContents.destroy();
				} catch {}
			});
		}

		const all = loadApps();
		const idx = all.findIndex(a => a.id === webApp.id);
		if (idx !== -1) {
			all[idx].windowWidth = lastSize[0];
			all[idx].windowHeight = lastSize[1];
			all[idx].lastOpened = new Date().toISOString();
			saveApps(all);
		}

		toolbarInfoStore.delete(webApp.id);
		siteViewMap.delete(webApp.id);
		launchedWindows.delete(webApp.id);

		updateDockMenu?.();
		updateTrayMenu?.();
	});

	win.once("ready-to-show", () => {
		win.show();
		updateDockMenu?.();
		updateTrayMenu?.();
	});

	launchedWindows.set(webApp.id, win);
}

module.exports = { launchWebApp };

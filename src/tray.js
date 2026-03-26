const { app, Menu, Tray, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const { isMac, isWin, launchedWindows } = require("./state");

let tray = null;

function buildTrayIcon() {
	const candidates = isWin
		? [
				path.join(__dirname, "..", "assets", "icon.ico"),
				path.join(__dirname, "..", "assets", "icon.png"),
			]
		: [path.join(__dirname, "..", "assets", "icon.png")];

	for (const p of candidates) {
		try {
			if (fs.existsSync(p)) {
				const img = nativeImage.createFromPath(p);
				if (!img.isEmpty())
					return img.resize({ width: 16, height: 16 });
			}
		} catch {}
	}

	// Minimal 16×16 fallback PNG encoded as base64
	const FALLBACK_PNG_BASE64 =
		"iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAANklEQVQ4T2NkoBAwUqifYdQA" +
		"hjAIDgMGBgYGJioZwECFMBg1gIFKYTBqAAOVwmDUAAYqhQEAMAAIAAEbPL4AAAAASUVORK5CYII=";

	return nativeImage.createFromDataURL(
		`data:image/png;base64,${FALLBACK_PNG_BASE64}`,
	);
}

function createTray(getMainWindow) {
	if (isMac) return;

	try {
		tray = new Tray(buildTrayIcon());
		tray.setToolTip("Webapper");
		updateTrayMenu(getMainWindow);

		const focusMain = () => {
			const mainWindow = getMainWindow?.();
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.show();
				mainWindow.focus();
			}
		};

		tray.on("click", focusMain);
		tray.on("double-click", focusMain);
	} catch (err) {
		console.warn("Tray creation failed:", err.message);
	}
}

// Fix: prune destroyed windows before building the menu so stale entries
// from crashed windows don't accumulate.
function updateTrayMenu(getMainWindow) {
	if (!tray || tray.isDestroyed()) return;

	const openAppItems = [];
	for (const [id, w] of launchedWindows) {
		if (w.isDestroyed()) {
			launchedWindows.delete(id);
			continue;
		}
		let label = "App";
		try {
			label = w.getTitle() || "App";
		} catch {}
		openAppItems.push({
			label,
			click: () => {
				try {
					w.show();
					w.focus();
				} catch {}
			},
		});
	}

	const menuTemplate = [
		{
			label: "Show Webapper",
			click: () => {
				const mainWindow = getMainWindow?.();
				if (mainWindow && !mainWindow.isDestroyed()) {
					mainWindow.show();
					mainWindow.focus();
				}
			},
		},
		...(openAppItems.length
			? [{ type: "separator" }, ...openAppItems]
			: []),
		{ type: "separator" },
		{
			label: "Quit",
			click: () => {
				app.isQuitting = true;
				app.quit();
			},
		},
	];

	tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}

function getTray() {
	return tray;
}

module.exports = { createTray, updateTrayMenu, getTray };

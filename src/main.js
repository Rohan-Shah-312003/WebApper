const { app } = require("electron");
const { isMac, isWin, isLinux } = require("./state");

// Platform / GPU flags
if (isLinux) {
	app.commandLine.appendSwitch("no-sandbox");
	app.commandLine.appendSwitch("disable-dev-shm-usage");
	app.commandLine.appendSwitch("disable-gpu");
	app.commandLine.appendSwitch("disable-gpu-compositing");
	app.commandLine.appendSwitch("disable-gpu-sandbox");
	app.commandLine.appendSwitch("in-process-gpu");
	app.commandLine.appendSwitch("use-gl", "swiftshader");
	app.commandLine.appendSwitch("enable-unsafe-swiftshader");
	app.commandLine.appendSwitch("disable-software-rasterizer", "false");
	app.commandLine.appendSwitch("ozone-platform", "x11");
	const shmFallback = require("path").join(
		require("os").homedir(),
		".webapper-tmp",
	);
	try {
		require("fs").mkdirSync(shmFallback, { recursive: true });
	} catch {}
	process.env.TMPDIR = shmFallback;
	process.env.TEMP = shmFallback;
	process.env.TMP = shmFallback;
} else {
	app.commandLine.appendSwitch("disable-gpu");
	app.commandLine.appendSwitch("disable-gpu-compositing");
	app.commandLine.appendSwitch("disable-software-rasterizer");
	app.commandLine.appendSwitch("no-sandbox");
}

const { applyToDefaultSession } = require("./adblocker");
const { initExtensions } = require("./extensions");
const { createMainWindow, getMainWindow } = require("./windows");
const { buildAppMenu, updateDockMenu } = require("./menu");
const { createTray, updateTrayMenu, getTray } = require("./tray");
const { launchWebApp } = require("./webapp-launcher");
const { registerToolbarIpc } = require("./toolbar-ipc");
const { registerAppsIpc } = require("./apps-ipc");

// IPC registration
registerAppsIpc(
	wa =>
		launchWebApp(wa, {
			updateTrayMenu: () => updateTrayMenu(getMainWindow),
			updateDockMenu: () => updateDockMenu(getMainWindow),
		}),
	getMainWindow,
);

registerToolbarIpc();

app.on("web-contents-created", (event, contents) => {
	contents.on("console-message", (e, level, message, line, sourceId) => {
		console.log(`[RENDERER CONSOLE] ${message} (${sourceId}:${line})`);
	});
});
// Lifecycle
app.whenReady().then(async () => {
	applyToDefaultSession();

	try {
		await initExtensions();
	} catch {}

	createMainWindow();
	createTray(getMainWindow);

	// Connect app menu as getMainWindow is available
	buildAppMenu(getMainWindow);
	updateDockMenu(getMainWindow);

	app.on("activate", () => {
		const mainWindow = getMainWindow();
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.show();
			mainWindow.focus();
		} else {
			createMainWindow();
		}
	});
});

app.on("before-quit", () => {
	const { launchedWindows } = require("./state");
	app.isQuitting = true;
	for (const [, w] of launchedWindows) {
		try {
			if (!w.isDestroyed()) w.destroy();
		} catch {}
	}
	launchedWindows.clear();
});

app.on("window-all-closed", () => {
	if (isMac) {
		app.quit();
		return;
	}
	const tray = getTray();
	if (!tray || tray.isDestroyed()) app.quit();
});

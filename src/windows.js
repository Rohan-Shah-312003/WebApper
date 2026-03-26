const { app, BrowserWindow } = require("electron");
const path = require("path");
const { isMac } = require("./state");

let mainWindow = null;

// Title bar style per platform
function getTitleBarOptions(isWebAppWindow = false) {
	if (isMac) {
		return {
			titleBarStyle: "hiddenInset",
			...(isWebAppWindow
				? { trafficLightPosition: { x: 12, y: 13 } }
				: {}),
		};
	}
	return {
		titleBarStyle: "default",
		autoHideMenuBar: false,
	};
}

function createMainWindow() {
	mainWindow = new BrowserWindow({
		width: 960,
		height: 680,
		minWidth: 800,
		minHeight: 560,
		...getTitleBarOptions(false),
		backgroundColor: "#0f0f11",
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			backgroundThrottling: false,
			// Dedicated partition so extensions loaded into defaultSession
			// don't interfere with the main UI at all.
			partition: "persist:webapper_ui",
		},
		show: false,
		paintWhenInitiallyHidden: true,
		title: "Webapper",
	});

	mainWindow.loadFile(path.join(__dirname, "ui", "index.html"));
	mainWindow.once("ready-to-show", () => mainWindow.show());

	// Fix #7: Platform is now delivered only via the ipcMain.handle('platform:get')
	// handler in toolbar-ipc.js. The push on did-finish-load has been removed
	// to eliminate the duplicate dual-delivery mechanism.
}

function getMainWindow() {
	return mainWindow;
}

module.exports = { createMainWindow, getMainWindow, getTitleBarOptions };

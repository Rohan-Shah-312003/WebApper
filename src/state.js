const { app } = require("electron");

// Platform helpers
const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
const isLinux = process.platform === "linux";

// Toolbar height constant
const TOOLBAR_H = 44;

// Shared Maps — imported by every module that needs them.
// Never reassign these references; mutate them in place.
const launchedWindows = new Map(); // appId -> BrowserWindow
const siteViewMap = new Map(); // appId -> WebContentsView
const toolbarInfoStore = new Map(); // appId -> toolbar metadata

module.exports = {
	isMac,
	isWin,
	isLinux,
	TOOLBAR_H,
	launchedWindows,
	siteViewMap,
	toolbarInfoStore,
};

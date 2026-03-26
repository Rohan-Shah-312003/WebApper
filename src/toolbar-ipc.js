const { ipcMain } = require("electron");
const { siteViewMap, toolbarInfoStore } = require("./state");

function registerToolbarIpc() {
	ipcMain.on("toolbar:reload", (_, id) => {
		const sv = siteViewMap.get(id);
		if (sv && !sv.webContents.isDestroyed()) sv.webContents.reload();
	});

	ipcMain.on("toolbar:back", (_, id) => {
		const sv = siteViewMap.get(id);
		if (sv && !sv.webContents.isDestroyed() && sv.webContents.canGoBack())
			sv.webContents.goBack();
	});

	ipcMain.on("toolbar:forward", (_, id) => {
		const sv = siteViewMap.get(id);
		if (
			sv &&
			!sv.webContents.isDestroyed() &&
			sv.webContents.canGoForward()
		)
			sv.webContents.goForward();
	});

	ipcMain.handle("toolbar:getState", (_, id) => {
		const sv = siteViewMap.get(id);
		const info = toolbarInfoStore.get(id);
		if (!sv || sv.webContents.isDestroyed()) {
			return {
				canBack: false,
				canForward: false,
				loading: false,
				title: info?.name || "",
			};
		}
		return {
			canBack: sv.webContents.canGoBack(),
			canForward: sv.webContents.canGoForward(),
			loading: sv.webContents.isLoading(),
			title: sv.webContents.getTitle() || info?.name,
		};
	});

	ipcMain.handle("toolbar:getInfo", (_, id) => toolbarInfoStore.get(id));

	// Single canonical platform handler — renderer should use this instead of
	// the did-finish-load push, which has been removed from windows.js to avoid
	// the redundant dual-delivery (fix #7).
	ipcMain.handle("platform:get", () => process.platform);
}

module.exports = { registerToolbarIpc };

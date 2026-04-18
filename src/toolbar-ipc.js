const { ipcMain } = require("electron");
const { siteViewMap, toolbarInfoStore } = require("./state");

function registerToolbarIpc() {

	ipcMain.on("toolbar:back", (event, reqId) => {
		let id = reqId;
		if (!id) {
			for (const [key, info] of toolbarInfoStore.entries()) {
				if (info.webContentsId === event.sender.id) { id = key; break; }
			}
		}
		const sv = siteViewMap.get(id);
		if (sv && !sv.webContents.isDestroyed() && sv.webContents.canGoBack())
			sv.webContents.goBack();
	});

	ipcMain.on("toolbar:reload", (event, reqId) => {
		let id = reqId;
		if (!id) {
			for (const [key, info] of toolbarInfoStore.entries()) {
				if (info.webContentsId === event.sender.id) { id = key; break; }
			}
		}
		const sv = siteViewMap.get(id);
		if (sv && !sv.webContents.isDestroyed()) sv.webContents.reload();
	});

	ipcMain.on("toolbar:forward", (event, reqId) => {
		let id = reqId;
		if (!id) {
			for (const [key, info] of toolbarInfoStore.entries()) {
				if (info.webContentsId === event.sender.id) { id = key; break; }
			}
		}
		const sv = siteViewMap.get(id);
		if (sv && !sv.webContents.isDestroyed() && sv.webContents.canGoForward())
			sv.webContents.goForward();
	});

	ipcMain.handle("toolbar:getState", (event, reqId) => {
		let id = reqId;
		if (!id) {
			for (const [key, info] of toolbarInfoStore.entries()) {
				if (info.webContentsId === event.sender.id) {
					id = key;
					break;
				}
			}
		}
		const sv = siteViewMap.get(id);
		const info = toolbarInfoStore.get(id);
		if (!sv || sv.webContents.isDestroyed()) {
			return {
				id,
				canBack: false,
				canForward: false,
				loading: false,
				title: info?.name,
			};
		}
		return {
			id,
			canBack: sv.webContents.canGoBack(),
			canForward: sv.webContents.canGoForward(),
			loading: sv.webContents.isLoading(),
			title: sv.webContents.getTitle() || info?.name,
		};
	});

	ipcMain.handle("toolbar:getInfo", (event, reqId) => {
		let id = reqId;
		if (!id) {
			for (const [key, info] of toolbarInfoStore.entries()) {
				if (info.webContentsId === event.sender.id) {
					id = key;
					break;
				}
			}
		}
		return toolbarInfoStore.get(id);
	});
	ipcMain.on("toolbar:log", (_, ...args) => console.log("[TOOLBAR LOG]", ...args));

	// Single canonical platform handler — renderer should use this instead of
	// the did-finish-load push, which has been removed from windows.js to avoid
	// the redundant dual-delivery (fix #7).
	ipcMain.handle("platform:get", () => process.platform);
}

module.exports = { registerToolbarIpc };

const { ipcMain, dialog, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const { loadApps, saveApps } = require("./storage");
const { launchedWindows } = require("./state");
const {
	loadExtensionData,
	installExtension,
	removeExtension,
} = require("./extensions");

function registerAppsIpc(launchWebApp, getMainWindow) {
	ipcMain.handle("apps:list", () => loadApps());

	ipcMain.handle("apps:save", (_, apps) => {
		saveApps(apps);
		return true;
	});

	ipcMain.handle("apps:launch", (_, wa) => {
		launchWebApp(wa);
		return true;
	});

	ipcMain.handle("apps:delete", (_, id) => {
		saveApps(loadApps().filter(a => a.id !== id));
		const w = launchedWindows.get(id);
		if (w && !w.isDestroyed()) {
			try {
				w.close();
			} catch {
				try {
					w.destroy();
				} catch {}
			}
		}
		return true;
	});

	ipcMain.handle("app:fetchFavicon", async (_, url) => {
		try {
			const { hostname, origin } = new URL(url);
			return [
				`https://www.google.com/s2/favicons?domain=${hostname}&sz=128`,
				`${origin}/favicon.ico`,
				`${origin}/apple-touch-icon.png`,
			];
		} catch {
			return [];
		}
	});

	ipcMain.handle("dialog:pickImage", async () => {
		const mainWindow = getMainWindow?.();
		const r = await dialog.showOpenDialog(mainWindow, {
			properties: ["openFile"],
			filters: [
				{
					name: "Images",
					extensions: ["png", "jpg", "jpeg", "ico", "icns", "svg"],
				},
			],
		});
		if (r.canceled || !r.filePaths.length) return null;
		const data = fs.readFileSync(r.filePaths[0]);
		const ext = path.extname(r.filePaths[0]).slice(1).toLowerCase();
		const mime =
			ext === "svg"
				? "image/svg+xml"
				: `image/${ext === "jpg" ? "jpeg" : ext}`;
		return `data:${mime};base64,${data.toString("base64")}`;
	});

	// Extension IPC
	ipcMain.handle("extensions:list", () => loadExtensionData());

	ipcMain.handle("extensions:install", async (_, urlOrId) => {
		try {
			const record = await installExtension(urlOrId);
			return { ok: true, extension: record };
		} catch (err) {
			return { ok: false, error: err.message };
		}
	});

	ipcMain.handle("extensions:remove", async (_, id) => {
		try {
			await removeExtension(id);
			return { ok: true };
		} catch (err) {
			return { ok: false, error: err.message };
		}
	});
}

module.exports = { registerAppsIpc };

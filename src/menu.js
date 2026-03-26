const { app, Menu } = require("electron");
const { isMac, launchedWindows } = require("./state");

function buildAppMenu(getMainWindow) {
	const template = [
		...(isMac
			? [
					{
						label: app.name,
						submenu: [
							{ role: "about" },
							{ type: "separator" },
							{ role: "hide" },
							{ role: "hideOthers" },
							{ role: "unhide" },
							{ type: "separator" },
							{ role: "quit" },
						],
					},
				]
			: [
					{
						label: "File",
						submenu: [
							{
								label: "Show Webapper",
								accelerator: "CmdOrCtrl+Shift+W",
								click: () => {
									const mainWindow = getMainWindow?.();
									if (
										mainWindow &&
										!mainWindow.isDestroyed()
									) {
										mainWindow.show();
										mainWindow.focus();
									}
								},
							},
							{ type: "separator" },
							{ role: "quit" },
						],
					},
				]),
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// macOS dock menu — lists all open webapp windows.
// Fix: prune destroyed windows before iterating to prevent stale entries
// accumulating from crashed windows.
function updateDockMenu(getMainWindow) {
	if (!isMac || !app.dock) return;

	const items = [];
	for (const [id, w] of launchedWindows) {
		// Prune destroyed entries on the fly
		if (w.isDestroyed()) {
			launchedWindows.delete(id);
			continue;
		}
		let label = "App";
		try {
			label = w.getTitle() || "App";
		} catch {}
		items.push({
			label,
			click: () => {
				try {
					w.show();
					w.focus();
				} catch {}
			},
		});
	}

	const open = {
		label: "Open Webapper",
		click: () => {
			const mainWindow = getMainWindow?.();
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.show();
				mainWindow.focus();
			}
		},
	};

	app.dock.setMenu(
		Menu.buildFromTemplate(
			items.length ? [...items, { type: "separator" }, open] : [open],
		),
	);
}

module.exports = { buildAppMenu, updateDockMenu };

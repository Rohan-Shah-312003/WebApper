const path = require("path");
const fs = require("fs");
const { app } = require("electron");

const DATA_PATH = path.join(app.getPath("userData"), "webapps.json");

function loadApps() {
	try {
		if (fs.existsSync(DATA_PATH))
			return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
	} catch {}
	return [];
}

function saveApps(apps) {
	fs.writeFileSync(DATA_PATH, JSON.stringify(apps, null, 2));
}

module.exports = { loadApps, saveApps };

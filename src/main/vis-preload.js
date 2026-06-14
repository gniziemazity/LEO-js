"use strict";

const { contextBridge } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");

function loadVisData() {
	try {
		const dataPath = path.join(os.tmpdir(), "leo-last-vis-data.js");
		const content = fs.readFileSync(dataPath, "utf8");
		const m = content.match(/window\.__LOG_DATA__\s*=\s*([\s\S]+?);\s*$/);
		if (!m) return null;
		return JSON.parse(m[1]);
	} catch (_) {
		return null;
	}
}

contextBridge.exposeInMainWorld("__LOG_DATA_PRELOAD__", loadVisData());

"use strict";

const { contextBridge } = require("electron");
const fs = require("fs");
const path = require("path");

function loadVisData() {
	try {
		const dataPath = path.join(
			__dirname,
			"../../lesson_tools/.last_vis_data.js",
		);
		const content = fs.readFileSync(dataPath, "utf8");
		const m = content.match(/window\.__LOG_DATA__\s*=\s*([\s\S]+?);\s*$/);
		if (!m) return null;
		return JSON.parse(m[1]);
	} catch (_) {
		return null;
	}
}

contextBridge.exposeInMainWorld("__LOG_DATA_PRELOAD__", loadVisData());

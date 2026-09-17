"use strict";
const { exec } = require("child_process");
const { PORT, ensureServer } = require("./server-launch");

const [, , tool = "students.html", ...params] = process.argv;
const qs = params.length ? "?" + params.join("&") : "";
const url = `http://127.0.0.1:${PORT}/${tool}${qs}`;

ensureServer({}, () => {
	exec(`start "" "${url}"`, (err) => {
		if (err) console.error(err.message);
	});
});

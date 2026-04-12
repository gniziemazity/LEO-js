"use strict";
const { exec, spawn } = require("child_process");
const http = require("http");
const path = require("path");

const PORT = 7891;
const [, , tool = "students.html", ...params] = process.argv;
const qs = params.length ? "?" + params.join("&") : "";
const url = `http://127.0.0.1:${PORT}/${tool}${qs}`;

function openUrl() {
	exec(`start "" "${url}"`, (err) => {
		if (err) console.error(err.message);
	});
}

function startServer(cb) {
	const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
	setTimeout(cb, 300);
}

const req = http
	.get(`http://127.0.0.1:${PORT}/`, (res) => {
		res.destroy();
		openUrl();
	})
	.on("error", () => {
		startServer(openUrl);
	});
req.setTimeout(500, () => {
	req.destroy();
	startServer(openUrl);
});

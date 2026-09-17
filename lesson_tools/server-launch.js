"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const PORT = Number(process.env.LESSON_TOOLS_PORT) || 7891;
const SERVER_FILE = path.join(__dirname, "server.js");
const INFO_PATH = "/__server-info";
const PROBE_TIMEOUT_MS = 500;
const POLL_MS = 100;
const WAIT_MS = 3000;

function serverStamp() {
	return crypto
		.createHash("sha1")
		.update(fs.readFileSync(SERVER_FILE))
		.digest("hex");
}

function probeServer(cb) {
	let done = false;
	const finish = (up, info) => {
		if (done) return;
		done = true;
		cb({ up, info });
	};
	const req = http.get(
		{ host: "127.0.0.1", port: PORT, path: INFO_PATH },
		(res) => {
			let body = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => (body += chunk));
			res.on("error", () => finish(true, null));
			res.on("end", () => {
				let info = null;
				try {
					if (res.statusCode === 200) info = JSON.parse(body);
				} catch {}
				finish(true, info);
			});
		},
	);
	req.on("error", () => finish(false, null));
	req.setTimeout(PROBE_TIMEOUT_MS, () => {
		req.destroy();
		finish(false, null);
	});
}

function waitFor(wantUp, cb) {
	const deadline = Date.now() + WAIT_MS;
	const poll = () => {
		probeServer(({ up }) => {
			if (up === wantUp || Date.now() >= deadline) cb();
			else setTimeout(poll, POLL_MS);
		});
	};
	poll();
}

function startServer(env, cb) {
	try {
		spawn(process.execPath, [SERVER_FILE], {
			detached: true,
			stdio: "ignore",
			env,
		}).unref();
	} catch {}
	waitFor(true, cb);
}

function ensureServer({ env = process.env } = {}, cb) {
	probeServer(({ up, info }) => {
		if (!up) return startServer(env, cb);
		if (!info || !info.pid || info.stamp === serverStamp()) return cb();
		try {
			process.kill(info.pid);
		} catch {}
		waitFor(false, () => startServer(env, cb));
	});
}

module.exports = { PORT, SERVER_FILE, serverStamp, probeServer, ensureServer };

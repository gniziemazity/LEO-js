"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("child_process");

const TEST_PORT = 7993;
process.env.LESSON_TOOLS_PORT = String(TEST_PORT);
const launch = require("../lesson_tools/server-launch.js");

const probe = () => new Promise((resolve) => launch.probeServer(resolve));
const ensure = () => new Promise((resolve) => launch.ensureServer({}, resolve));

async function stopServer() {
	const { up, info } = await probe();
	if (!up) return;
	if (info && info.pid) {
		try {
			process.kill(info.pid);
		} catch {}
	}
	for (let i = 0; i < 30 && (await probe()).up; i++) {
		await new Promise((r) => setTimeout(r, 100));
	}
}

function startStaleServer() {
	const src = `require("http").createServer((q, s) => { s.writeHead(200); s.end(JSON.stringify({ pid: process.pid, stamp: "stale" })); }).listen(${TEST_PORT}, "127.0.0.1", () => console.log("up"));`;
	const child = spawn(process.execPath, ["-e", src], {
		stdio: ["ignore", "pipe", "ignore"],
	});
	const exited = new Promise((resolve) => child.once("exit", resolve));
	const ready = new Promise((resolve) => child.stdout.once("data", resolve));
	return { child, exited, ready };
}

test("the test runs on its own port, never the live one", async () => {
	assert.strictEqual(launch.PORT, TEST_PORT);
	assert.notStrictEqual(launch.PORT, 7891);
	assert.strictEqual((await probe()).up, false, `port ${TEST_PORT} is busy`);
});

test("a missing server is started and reports the current stamp", async (t) => {
	t.after(stopServer);
	await ensure();
	const { up, info } = await probe();
	assert.strictEqual(up, true);
	assert.strictEqual(info.stamp, launch.serverStamp());
	assert.notStrictEqual(info.pid, process.pid);
});

test("a server running the current code is reused, not restarted", async (t) => {
	t.after(stopServer);
	await ensure();
	const first = (await probe()).info;
	await ensure();
	const second = (await probe()).info;
	assert.strictEqual(second.pid, first.pid);
});

test("a server running outdated code is replaced", async (t) => {
	t.after(stopServer);
	const stale = startStaleServer();
	await stale.ready;
	assert.strictEqual((await probe()).info.stamp, "stale");
	await ensure();
	const { up, info } = await probe();
	assert.strictEqual(up, true);
	assert.strictEqual(info.stamp, launch.serverStamp());
	assert.notStrictEqual(info.pid, stale.child.pid);
	await stale.exited;
});

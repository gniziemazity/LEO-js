"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EDIT_KEYS } = require("../src/main/websocket-server");

const SRC = path.resolve(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf-8");

test("the server, the host and the phone agree on the edit keys", () => {
	const table = /const EDIT_KEY_TO_KEY = \{([\s\S]*?)\};/.exec(
		read("main/remote-input.js"),
	)[1];
	const host = [...table.matchAll(/(\w+): Key\./g)].map((m) => m[1]);
	const phone = [
		...read("remote.html").matchAll(/remoteEditKey\('(\w+)'\)/g),
	].map((m) => m[1]);

	assert.deepEqual(
		[...host, "enter"].sort(),
		[...EDIT_KEYS].sort(),
		"every key the server accepts presses something; Enter is handled before the table",
	);
	assert.deepEqual(
		[...phone].sort(),
		[...EDIT_KEYS].sort(),
		"and every one has a button on the phone",
	);
});

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..", "..");

function loadModule(relPath, stubs = {}) {
	const abs = path.resolve(REPO, relPath);
	const dir = path.dirname(abs);
	const src = fs.readFileSync(abs, "utf-8");

	const resolve = (name) => {
		if (Object.hasOwn(stubs, name)) return stubs[name];
		if (name.startsWith(".")) return require(path.resolve(dir, name));
		try {
			return require(name);
		} catch (err) {
			throw new Error(
				`${relPath} requires "${name}", which this test neither stubs ` +
					`nor can load here. Add it to the stubs argument.`,
			);
		}
	};

	const module = { exports: {} };
	new Function("require", "module", "exports", src)(
		resolve,
		module,
		module.exports,
	);
	return module.exports;
}

function fakeIpcRenderer(overrides = {}) {
	const sent = [];
	const ipcRenderer = {
		send: (ch, payload) => sent.push({ ch, payload }),
		on() {},
		invoke: async () => ({}),
		...overrides,
	};
	return {
		sent,
		channels: () => sent.map((m) => m.ch),
		stub: { ipcRenderer },
	};
}

module.exports = { loadModule, fakeIpcRenderer, REPO };

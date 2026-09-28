"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

function gitListed() {
	const out = execFileSync("git", ["ls-files", "*.js"], {
		cwd: ROOT,
		encoding: "utf-8",
		maxBuffer: 1 << 26,
		stdio: ["ignore", "pipe", "ignore"],
	});
	return out
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
}

function ignoredRoots() {
	const file = path.join(ROOT, ".gitignore");
	if (!fs.existsSync(file)) return [];
	return fs
		.readFileSync(file, "utf-8")
		.split(/\r?\n/)
		.map((s) => s.trim())
		.filter((s) => s.startsWith("/"))
		.map((s) => s.slice(1).replace(/\/$/, ""));
}

function walked() {
	const skip = ignoredRoots();
	const found = [];
	(function walk(rel) {
		const dir = path.join(ROOT, rel);
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const child = rel ? rel + "/" + entry.name : entry.name;
			if (entry.name.startsWith(".") || entry.name === "node_modules")
				continue;
			if (skip.includes(child)) continue;
			if (entry.isDirectory()) walk(child);
			else if (child.endsWith(".js")) found.push(child);
		}
	})("");
	return found;
}

function listed() {
	try {
		return gitListed();
	} catch (e) {
		return walked();
	}
}

function tracked() {
	return listed()
		.filter((f) => !f.includes("node_modules"))
		.filter((f) => !/\.min\.js$/.test(f));
}

test("every tracked script parses", () => {
	const broken = [];
	for (const rel of tracked()) {
		const abs = path.join(ROOT, rel);
		let src;
		try {
			src = fs.readFileSync(abs, "utf-8");
		} catch (e) {
			continue;
		}
		try {
			new vm.Script(src, { filename: abs });
		} catch (e) {
			broken.push(`${rel}: ${e.message}`);
		}
	}
	assert.deepEqual(
		broken,
		[],
		"a main-process file is never require()d by a test, so a syntax error " +
			"in it reaches the user as a startup dialog instead of a red test",
	);
});

test("a copy without .git still finds the scripts git would list", () => {
	let fromGit;
	try {
		fromGit = gitListed();
	} catch (e) {
		return;
	}
	const fromWalk = new Set(walked());
	const missed = fromGit.filter(
		(f) => fs.existsSync(path.join(ROOT, f)) && !fromWalk.has(f),
	);
	assert.deepEqual(
		missed,
		[],
		"a zip download or an applied scratch tree has no .git, and must not " +
			"skip a script the repo's own run would have parsed",
	);
	assert.ok(walked().includes("src/main/main.js"));
});

test("the main process is more than a parse: its top level must load", () => {
	const main = fs.readFileSync(path.join(ROOT, "src/main/main.js"), "utf-8");
	assert.match(
		main,
		/^async function createWindow\(\) \{/m,
		"createWindow awaits inside; losing its async keyword is a silent break",
	);
	assert.equal(
		/^async const /m.test(main),
		false,
		"an insertion that lands between `async` and `function` strands it",
	);
});

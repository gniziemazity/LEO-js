"use strict";

const fs = require("fs");
const path = require("path");

const logPath = process.argv[2];
if (!logPath) {
	console.error("usage: node _parity_runner.js <log.json>");
	process.exit(2);
}

const here = __dirname;
const modelSrc = fs.readFileSync(
	path.join(here, "shared/simulator-model.js"),
	"utf-8",
);
const cfgSrc = fs.readFileSync(path.join(here, "timeline/config.js"), "utf-8");
const dataSrc = fs.readFileSync(path.join(here, "timeline/data.js"), "utf-8");
const statsSrc = fs.readFileSync(path.join(here, "timeline/stats.js"), "utf-8");

const stub = `
var THEME = { blue: "#000", orange: "#000", green: "#000" };
function _hexToRgba() { return ""; }
function _cssVar() { return ""; }
function lowerBound(a, v, k) {
	let lo = 0, hi = a.length;
	while (lo < hi) { const m = (lo + hi) >> 1; if (k(a[m]) < v) lo = m + 1; else hi = m; }
	return lo;
}
function upperBound(a, v, k) {
	let lo = 0, hi = a.length;
	while (lo < hi) { const m = (lo + hi) >> 1; if (k(a[m]) <= v) lo = m + 1; else hi = m; }
	return lo;
}
function _singletonToTextPart(e) { return e.char || ""; }
function alert(msg) { console.error(msg); }
function newTokenRegex() { return /[a-zA-Z0-9]+|[^\\s]/gu; }
`;

const bundle =
	stub + "\n" + modelSrc + "\n" + cfgSrc + "\n" + dataSrc + "\n" + statsSrc;

const api = new Function(`
	${bundle}
	return { processData, buildLessonStatsCsv };
`)();

const raw = JSON.parse(fs.readFileSync(logPath, "utf-8"));
const p = api.processData({ events: raw.events });
if (!p) {
	console.error("processData returned null");
	process.exit(3);
}
const zeroTokens = { total: 0, html: 0, css: 0, js: 0, py: 0 };
const csv = api.buildLessonStatsCsv(p, zeroTokens);
process.stdout.write(csv);

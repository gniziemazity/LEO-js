const fs = require("fs");
const path = require("path");

const SKIPPED_DIRS = new Set(["node_modules", ".git"]);
const TOKEN_RE = /⚓(\d+)⚓/g;
const STRAY_RE = /⚓\d*/g;

function startDirFor(planPath) {
	if (!planPath) return null;
	const ext = path.extname(planPath);
	return path.join(
		path.dirname(planPath),
		`${path.basename(planPath, ext)}_start`,
	);
}

function isDirectory(dir) {
	try {
		return fs.statSync(dir).isDirectory();
	} catch (e) {
		return false;
	}
}

function looksBinary(buffer) {
	return buffer.includes(0);
}

function listStartFiles(dir) {
	const out = [];
	const walk = (abs, rel) => {
		const entries = fs
			.readdirSync(abs, { withFileTypes: true })
			.sort((a, b) => a.name.localeCompare(b.name));
		for (const entry of entries) {
			const childAbs = path.join(abs, entry.name);
			const childRel = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (!SKIPPED_DIRS.has(entry.name)) walk(childAbs, childRel);
				continue;
			}
			if (!entry.isFile()) continue;
			const buffer = fs.readFileSync(childAbs);
			if (looksBinary(buffer)) continue;
			out.push({
				name: childRel,
				text: buffer.toString("utf8").replace(/\r\n?/g, "\n"),
			});
		}
	};
	walk(dir, "");
	return out;
}

function lineStarts(text) {
	const starts = [0];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") starts.push(i + 1);
	}
	return starts;
}

function offsetOf(text, starts, [line, col]) {
	if (!Number.isInteger(line) || !Number.isInteger(col)) return null;
	if (line < 1 || line > starts.length || col < 1) return null;
	const start = starts[line - 1];
	const end = line < starts.length ? starts[line] - 1 : text.length;
	return Math.min(start + col - 1, end);
}

function positionOf(starts, offset) {
	let line = 0;
	while (line + 1 < starts.length && starts[line + 1] <= offset) line++;
	return [line + 1, offset - starts[line] + 1];
}

function embedAnchors(text, anchors) {
	const starts = lineStarts(text);
	const placed = Object.entries(anchors || {})
		.map(([id, pos]) => [id, offsetOf(text, starts, pos)])
		.filter(([, offset]) => offset !== null)
		.sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]));
	let out = text;
	for (const [id, offset] of placed) {
		out = out.slice(0, offset) + `⚓${id}⚓` + out.slice(offset);
	}
	return out;
}

function readAnchors(body) {
	const found = [];
	let clean = "";
	let last = 0;
	const source = String(body == null ? "" : body);
	TOKEN_RE.lastIndex = 0;
	let match;
	while ((match = TOKEN_RE.exec(source)) !== null) {
		clean += source.slice(last, match.index).replace(STRAY_RE, "");
		found.push([match[1], clean.length]);
		last = match.index + match[0].length;
	}
	clean += source.slice(last).replace(STRAY_RE, "");
	const starts = lineStarts(clean);
	const anchors = {};
	for (const [id, offset] of found) anchors[id] = positionOf(starts, offset);
	return { clean, anchors };
}

module.exports = {
	startDirFor,
	isDirectory,
	listStartFiles,
	embedAnchors,
	readAnchors,
};

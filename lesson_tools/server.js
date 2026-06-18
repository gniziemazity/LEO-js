"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 7891;
const ROOT = __dirname;
const SESSION_FILE = path.join(__dirname, ".grades_session.json");

function getGradesFolder() {
	try {
		return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")).folder || null;
	} catch {
		return null;
	}
}

const MIME = {
	".html": "text/html",
	".js": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".txt": "text/plain",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

function _sendDir(res, dirPath) {
	const entries = fs.readdirSync(dirPath, { withFileTypes: true });
	res.writeHead(200, {
		"Content-Type": "application/json",
		"Cache-Control": "no-cache",
	});
	res.end(
		JSON.stringify(
			entries.map((e) => ({
				name: e.name,
				kind: e.isDirectory() ? "directory" : "file",
			})),
		),
	);
}

function _sendFile(res, filePath) {
	fs.readFile(filePath, (err, data) => {
		if (err) {
			res.writeHead(404);
			res.end();
			return;
		}
		const mime =
			MIME[path.extname(filePath).toLowerCase()] ||
			"application/octet-stream";
		res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" });
		res.end(data);
	});
}

function serveUnder(res, baseDir, fullPath, { allowDirListing }) {
	if (!fullPath.startsWith(baseDir + path.sep) && fullPath !== baseDir) {
		res.writeHead(403);
		res.end();
		return;
	}
	let stat = null;
	try {
		stat = fs.statSync(fullPath);
	} catch {}
	if (allowDirListing && stat?.isDirectory()) {
		_sendDir(res, fullPath);
		return;
	}
	_sendFile(res, fullPath);
}

function writeUnder(res, baseDir, fullPath, req) {
	if (!fullPath.startsWith(baseDir + path.sep)) {
		res.writeHead(403);
		res.end();
		return;
	}
	const writeExt = path.extname(fullPath).toLowerCase();
	if (writeExt !== ".xlsx" && writeExt !== ".json") {
		res.writeHead(403);
		res.end("Only .xlsx and .json writes are allowed");
		return;
	}
	const chunks = [];
	req.on("data", (c) => chunks.push(c));
	req.on("error", () => {
		res.writeHead(400);
		res.end();
	});
	req.on("end", () => {
		try {
			fs.mkdirSync(path.dirname(fullPath), { recursive: true });
			fs.writeFileSync(fullPath, Buffer.concat(chunks));
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
		} catch (err) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({ ok: false, error: String(err && err.message) }),
			);
		}
	});
}

http
	.createServer((req, res) => {
		let urlPath = req.url.split("?")[0];
		try {
			urlPath = decodeURIComponent(urlPath);
		} catch {}

		if (urlPath === "/grades-session") {
			const folder = getGradesFolder();
			res.writeHead(folder ? 200 : 404, {
				"Content-Type": "application/json",
			});
			res.end(JSON.stringify(folder ? { folder } : { error: "no session" }));
			return;
		}

		if (urlPath.startsWith("/grades-data/")) {
			const folder = getGradesFolder();
			if (!folder) {
				res.writeHead(404);
				res.end("No grades session");
				return;
			}

			const rel = urlPath.slice("/grades-data/".length);
			const fullPath = path.resolve(folder, ...rel.split("/"));
			if (req.method === "PUT") {
				writeUnder(res, folder, fullPath, req);
				return;
			}
			serveUnder(res, folder, fullPath, { allowDirListing: true });
			return;
		}

		if (urlPath.startsWith("/src/")) {
			const srcRoot = path.resolve(__dirname, "..", "src");
			const srcFile = path.resolve(
				srcRoot,
				...urlPath.slice("/src/".length).split("/"),
			);
			serveUnder(res, srcRoot, srcFile, { allowDirListing: false });
			return;
		}

		const filePath = path.join(
			ROOT,
			urlPath === "/" ? "index.html" : urlPath,
		);
		serveUnder(res, ROOT, filePath, { allowDirListing: true });
	})
	.listen(PORT, "127.0.0.1", () => {
		console.log(`lesson_tools server: http://127.0.0.1:${PORT}`);
	});

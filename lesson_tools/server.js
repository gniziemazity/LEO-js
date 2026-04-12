"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 7891;
const ROOT = __dirname;

const MIME = {
	".html": "text/html",
	".js": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".txt": "text/plain",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

http
	.createServer((req, res) => {
		const urlPath = req.url.split("?")[0];
		const filePath = path.join(
			ROOT,
			urlPath === "/" ? "index.html" : urlPath,
		);
		if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
			res.writeHead(403);
			res.end();
			return;
		}
		fs.readFile(filePath, (err, data) => {
			if (err) {
				res.writeHead(404);
				res.end();
				return;
			}
			const mime =
				MIME[path.extname(filePath).toLowerCase()] ||
				"application/octet-stream";
			res.writeHead(200, {
				"Content-Type": mime,
				"Cache-Control": "no-cache",
			});
			res.end(data);
		});
	})
	.listen(PORT, "127.0.0.1", () => {
		console.log(`lesson_tools server: http://127.0.0.1:${PORT}`);
	});

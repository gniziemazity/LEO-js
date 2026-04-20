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
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".txt": "text/plain",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

http
	.createServer((req, res) => {
		const urlPath = req.url.split("?")[0];

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

			if (!fullPath.startsWith(folder + path.sep) && fullPath !== folder) {
				res.writeHead(403);
				res.end();
				return;
			}

			let stat;
			try {
				stat = fs.statSync(fullPath);
			} catch {
				res.writeHead(404);
				res.end();
				return;
			}

			if (stat.isDirectory()) {
				const entries = fs.readdirSync(fullPath, { withFileTypes: true });
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify(
						entries.map((e) => ({
							name: e.name,
							kind: e.isDirectory() ? "directory" : "file",
						})),
					),
				);
				return;
			}

			fs.readFile(fullPath, (err, data) => {
				if (err) {
					res.writeHead(404);
					res.end();
					return;
				}
				const mime =
					MIME[path.extname(fullPath).toLowerCase()] ||
					"application/octet-stream";
				res.writeHead(200, {
					"Content-Type": mime,
					"Cache-Control": "no-cache",
				});
				res.end(data);
			});
			return;
		}

		if (urlPath.startsWith("/src/")) {
			const srcRoot = path.resolve(__dirname, "..", "src");
			const srcFile = path.resolve(
				srcRoot,
				...urlPath.slice("/src/".length).split("/"),
			);
			if (!srcFile.startsWith(srcRoot + path.sep) && srcFile !== srcRoot) {
				res.writeHead(403);
				res.end();
				return;
			}
			fs.readFile(srcFile, (err, data) => {
				if (err) {
					res.writeHead(404);
					res.end();
					return;
				}
				const mime =
					MIME[path.extname(srcFile).toLowerCase()] ||
					"application/octet-stream";
				res.writeHead(200, {
					"Content-Type": mime,
					"Cache-Control": "no-cache",
				});
				res.end(data);
			});
			return;
		}

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
				let dstat;
				try {
					dstat = fs.statSync(filePath);
				} catch {}
				if (dstat?.isDirectory()) {
					const entries = fs.readdirSync(filePath, {
						withFileTypes: true,
					});
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
					return;
				}
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

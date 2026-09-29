const fs = require("fs");
const path = require("path");

const EXPORT_EXT =
	/\.(html|htm|css|js|ts|tsx|py|json|png|jpe?g|gif|svg|webp|ico|bmp|mp3|wav|ogg|m4a|aac|flac|mp4|webm|ogv|mov)$/i;
const BAD_SEGMENT = /[\u0000-\u001f:<>"|?*]/;
const MAX_FILES = 1000;
const MAX_BYTES = 200 * 1024 * 1024;

function planExport(files) {
	if (!Array.isArray(files) || !files.length) {
		throw new Error("There are no files to write.");
	}
	if (files.length > MAX_FILES) {
		throw new Error(`Too many files to write (${files.length}).`);
	}
	let total = 0;
	const seen = new Set();
	return files.map((file) => {
		const rel = String((file && file.path) || "").replace(/\\/g, "/");
		const parts = rel.split("/");
		if (
			parts.some(
				(p) => !p || p === "." || p === ".." || BAD_SEGMENT.test(p),
			) ||
			!EXPORT_EXT.test(rel)
		) {
			throw new Error(`Refusing to write "${rel}".`);
		}
		const key = parts.join("/").toLowerCase();
		if (seen.has(key)) throw new Error(`"${rel}" is listed twice.`);
		seen.add(key);
		const data = file.data;
		if (!(data instanceof Uint8Array)) {
			throw new Error(`"${rel}" has no file contents.`);
		}
		total += data.length;
		if (total > MAX_BYTES)
			throw new Error("The files are too large to write.");
		return { parts, data };
	});
}

function writeExport(dir, plan) {
	const root = path.resolve(dir);
	const targets = plan.map(({ parts, data }) => {
		const full = path.resolve(root, ...parts);
		if (!full.startsWith(root + path.sep)) {
			throw new Error(`Refusing to write outside the folder: ${full}`);
		}
		return { full, data };
	});
	for (const { full, data } of targets) {
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, data);
	}
	return targets.length;
}

function registerToolExport({
	ipcMain,
	dialog,
	shell,
	BrowserWindow,
	isToolSender,
}) {
	const exported = new Map();
	let lastDir;

	ipcMain.handle("tool-export-files", async (event, files) => {
		if (!isToolSender(event)) return { error: "Not a lesson tool window." };
		try {
			const plan = planExport(files);
			const win = BrowserWindow.fromWebContents(event.sender);
			const options = {
				title: "Write the corrected files to…",
				buttonLabel: "Write here",
				defaultPath: lastDir,
				properties: ["openDirectory", "createDirectory"],
			};
			const result = win
				? await dialog.showOpenDialog(win, options)
				: await dialog.showOpenDialog(options);
			if (result.canceled || !result.filePaths || !result.filePaths.length) {
				return { canceled: true };
			}
			const dir = result.filePaths[0];
			const count = writeExport(dir, plan);
			lastDir = dir;
			exported.set(event.sender.id, dir);
			return { dir, count };
		} catch (err) {
			return { error: String((err && err.message) || err) };
		}
	});

	ipcMain.handle("tool-open-export-folder", async (event) => {
		if (!isToolSender(event)) return false;
		const dir = exported.get(event.sender.id);
		if (!dir) return false;
		return (await shell.openPath(dir)) === "";
	});
}

module.exports = { planExport, writeExport, registerToolExport };

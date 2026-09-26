const { spawn } = require("child_process");
const { getWindows } = require("@computer-use/nut-js");

const POLL_MS = 300;
const FIND_TIMEOUT_MS = 20000;
const SETTLE_MS = 1500;
const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;
const VSCODE_TITLE = /Visual Studio Code$/;

function pickWindow(windows, before, folderName) {
	const matching = windows.filter(
		(w) =>
			VSCODE_TITLE.test(w.title) &&
			w.width >= MIN_WIDTH &&
			w.height >= MIN_HEIGHT,
	);
	const fresh = matching.find((w) => !before.has(w.handle));
	if (fresh) return fresh;
	if (!folderName) return null;
	return matching.find((w) => w.title.includes(folderName)) || null;
}

async function listWindows() {
	const out = [];
	for (const win of await getWindows()) {
		try {
			const title = await win.getTitle();
			if (!title) continue;
			const r = await win.getRegion();
			out.push({
				handle: win.windowHandle,
				title,
				width: r.width,
				height: r.height,
			});
		} catch (_) {}
	}
	return out;
}

async function windowHandles() {
	try {
		return new Set((await listWindows()).map((w) => w.handle));
	} catch (_) {
		return new Set();
	}
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findVSCode(before, folderName) {
	const deadline = Date.now() + FIND_TIMEOUT_MS;
	for (;;) {
		const win = pickWindow(await listWindows(), before, folderName);
		if (win || Date.now() >= deadline) return win;
		await sleep(POLL_MS);
	}
}

const MAXIMIZE_TYPE = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LeoWindow {
	[DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
	public static void Maximize(long handle) {
		ShowWindow(new IntPtr(handle), 3);
	}
}
'@
`;

function maximizeScript(handle) {
	const n = Math.round(Number(handle));
	if (!Number.isFinite(n)) return null;
	const call = `[LeoWindow]::Maximize(${n})`;
	return `${MAXIMIZE_TYPE}${call}\nStart-Sleep -Milliseconds ${SETTLE_MS}\n${call}\n`;
}

function runPowerShell(script) {
	return new Promise((resolve) => {
		const child = spawn(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-EncodedCommand",
				Buffer.from(script, "utf16le").toString("base64"),
			],
			{ windowsHide: true, stdio: "ignore" },
		);
		child.on("error", () => resolve(false));
		child.on("exit", (code) => resolve(code === 0));
	});
}

async function maximizeVSCode({ before, folderName }) {
	if (process.platform !== "win32") return false;
	const win = await findVSCode(before, folderName);
	if (!win) return false;
	const script = maximizeScript(win.handle);
	return script ? runPowerShell(script) : false;
}

module.exports = {
	pickWindow,
	maximizeScript,
	windowHandles,
	maximizeVSCode,
};

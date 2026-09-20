const { clipboard } = require("electron");
const { keyboard, Key } = require("@computer-use/nut-js");
const {
	settingsManager,
	broadcastServer,
	hotkeyManager,
} = require("./context");
const state = require("./state");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { warnRemoteInput } = require("./remote-input");
const { isFileName } = require("../shared/move-to-target");

function mediaPopup(kind) {
	return {
		started: (payload) =>
			broadcastServer.broadcastMediaStarted({ ...payload, kind }),
		ended: () => broadcastServer.broadcastMediaEnded(),
		confirmChannel: `${kind}-confirmed`,
	};
}

const PAUSING_POPUPS = {
	"move-to": {
		started: (payload) => broadcastServer.broadcastMoveToStarted(payload),
		ended: () => broadcastServer.broadcastMoveToEnded(),
		confirmChannel: "move-to-confirmed",
		onConfirmKey: (payload) => {
			if (!offersName(payload)) return confirmPopup("move-to");
			if (!hasPendingName()) armMoveToName();
		},
	},
	"code-insert": {
		started: (payload) => broadcastServer.broadcastCodeInsertStarted(payload),
		ended: () => broadcastServer.broadcastCodeInsertEnded(),
		confirmChannel: "code-insert-confirmed",
		onEnter: (payload) => holdCodeOnClipboard(payload),
		onExit: () => releaseCodeFromClipboard(),
		onConfirmKey: (payload) =>
			payload && payload.paste !== false
				? pasteAndConfirm()
				: confirmPopup("code-insert"),
	},
	note: {
		started: (payload) => broadcastServer.broadcastNoteStarted(payload),
		ended: () => broadcastServer.broadcastNoteEnded(),
		confirmChannel: "note-confirmed",
	},
	image: mediaPopup("image"),
	web: mediaPopup("web"),
};

const MEDIA_KINDS = ["image", "web"];
const PASTE_SETTLE_MS = 300;

let openPopup = null;
let openPayload = null;
let pendingName = null;
let onNameProgress = null;

function enterPopup(kind, payload) {
	const popup = PAUSING_POPUPS[kind];
	openPopup = kind;
	openPayload = payload;
	state.pause("popup");
	if (popup.onEnter) popup.onEnter(payload);
	popup.started(payload);
	hotkeyManager.registerConfirmPopup(confirmKeyFor(kind));
}

function confirmKeyFor(kind) {
	const popup = PAUSING_POPUPS[kind];
	if (!popup.onConfirmKey) return () => confirmPopup(kind);
	return () => popup.onConfirmKey(openPayload);
}

function endPopup(kind) {
	const popup = PAUSING_POPUPS[kind];
	if (openPopup === kind) {
		openPopup = null;
		openPayload = null;
		pendingName = null;
	}
	hotkeyManager.unregisterConfirmPopup();
	state.unpause("popup");
	if (popup.onExit) popup.onExit();
	popup.ended();
}

function confirmPopup(kind) {
	endPopup(kind);
	state.send(PAUSING_POPUPS[kind].confirmChannel);
}

function endPopupIfOpen(kind) {
	if (openPopup === kind) endPopup(kind);
}

function confirmMedia() {
	if (MEDIA_KINDS.includes(openPopup)) confirmPopup(openPopup);
}

function dismissMedia(floats) {
	if (!MEDIA_KINDS.includes(openPopup)) return;
	const float = floats[openPopup];
	if (float && !float.pinned) float.close();
	confirmPopup(openPopup);
}

let heldClipboard = null;

function holdCodeOnClipboard(payload) {
	if (!payload || payload.paste === false) return;
	const code = payload.text;
	if (!code) return;
	heldClipboard = { code, previous: clipboard.readText() };
	clipboard.writeText(code);
}

function releaseCodeFromClipboard() {
	const held = heldClipboard;
	heldClipboard = null;
	if (!held) return;
	if (clipboard.readText() === held.code) clipboard.writeText(held.previous);
}

async function pasteCodeInsert() {
	const held = heldClipboard;
	if (!held) return;
	try {
		if (clipboard.readText() !== held.code) clipboard.writeText(held.code);
		const modifier =
			settingsManager.get("platform") === "macos"
				? Key.LeftCmd
				: Key.LeftControl;
		await keyboard.type(modifier, Key.V);
	} catch (e) {
		warnRemoteInput("code insert paste", e);
	}
}

async function pasteAndConfirm() {
	const payload = openPayload;
	if (openPopup !== "code-insert") return;
	await pasteCodeInsert();
	await sleep(PASTE_SETTLE_MS);
	if (openPopup === "code-insert" && openPayload === payload) {
		confirmPopup("code-insert");
	}
}

function offersName(payload) {
	return !!(payload && payload.typeName && isFileName(payload.target || ""));
}

function moveToNameChars() {
	const target = openPayload && openPayload.target;
	if (openPopup !== "move-to" || !target) return null;
	if (!isFileName(target)) return null;
	return [...target];
}

function nameProgress() {
	return {
		target: (openPayload && openPayload.target) || "",
		typed: pendingName ? pendingName.index : null,
	};
}

function hasPendingName() {
	return pendingName !== null;
}

function armMoveToName() {
	const chars = moveToNameChars();
	if (!chars) return;
	pendingName = { chars, index: 0, busy: false };
	if (onNameProgress) onNameProgress(nameProgress());
}

async function typeNextNameChar() {
	if (!pendingName || pendingName.busy) return !!pendingName;
	const ch = pendingName.chars[pendingName.index];
	pendingName.busy = true;
	const macOS = settingsManager.get("platform") === "macos";
	const released = state.isActive
		? hotkeyManager.releaseTypingHotkeysFor(ch)
		: [];
	if (released.length && macOS) await sleep(20);
	try {
		await keyboard.type(ch);
	} catch (e) {
		warnRemoteInput("type file name", e);
	} finally {
		if (released.length) {
			if (macOS) await sleep(20);
			hotkeyManager.restoreTypingHotkeys(released);
		}
	}
	if (!pendingName) return true;
	pendingName.index += 1;
	pendingName.busy = false;
	if (pendingName.index >= pendingName.chars.length) {
		pendingName = null;
		try {
			await keyboard.type(Key.Enter);
		} catch (e) {
			warnRemoteInput("type file name", e);
		}
		confirmPopup("move-to");
		return true;
	}
	if (onNameProgress) onNameProgress(nameProgress());
	return true;
}

function openPopupKind() {
	return openPopup;
}

function setNameProgressHandler(fn) {
	onNameProgress = fn;
}

module.exports = {
	PAUSING_POPUPS,
	enterPopup,
	endPopup,
	confirmPopup,
	endPopupIfOpen,
	confirmMedia,
	dismissMedia,
	confirmKeyFor,
	pasteAndConfirm,
	armMoveToName,
	hasPendingName,
	typeNextNameChar,
	setNameProgressHandler,
	openPopupKind,
};

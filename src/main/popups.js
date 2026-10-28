const { clipboard } = require("electron");
const { keyboard, Key } = require("@computer-use/nut-js");
const {
	settingsManager,
	broadcastServer,
	hotkeyManager,
} = require("./context");
const state = require("./state");
const { sleep, isMacOS, primaryModifier } = require("./platform");
const { warnRemoteInput } = require("./remote-input");
const { isFileName } = require("../shared/go-to-target");

function mediaPopup(type) {
	return {
		started: (payload) =>
			broadcastServer.broadcastMediaStarted({ ...payload, type }),
		ended: () => broadcastServer.broadcastMediaEnded(),
		confirmChannel: `${type}-confirmed`,
	};
}

const PAUSING_POPUPS = {
	"go-to": {
		started: (payload) => broadcastServer.broadcastGoToStarted(payload),
		ended: () => broadcastServer.broadcastGoToEnded(),
		confirmChannel: "go-to-confirmed",
		onConfirmKey: (payload) => {
			if (!offersName(payload)) return confirmPopup("go-to");
			if (!hasPendingName()) armGoToName();
		},
	},
	snippet: {
		started: (payload) => broadcastServer.broadcastSnippetStarted(payload),
		ended: () => broadcastServer.broadcastSnippetEnded(),
		confirmChannel: "snippet-confirmed",
		onEnter: (payload) => holdCodeOnClipboard(payload),
		onExit: () => releaseCodeFromClipboard(),
		onConfirmKey: (payload) =>
			payload && payload.paste !== false
				? pasteAndConfirm()
				: confirmPopup("snippet"),
	},
	note: {
		started: (payload) => broadcastServer.broadcastNoteStarted(payload),
		ended: () => broadcastServer.broadcastNoteEnded(),
		confirmChannel: "note-confirmed",
	},
	image: mediaPopup("image"),
	web: mediaPopup("web"),
};

const MEDIA_TYPES = ["image", "web"];
const PASTE_SETTLE_MS = 300;

let openPopup = null;
let openPayload = null;
let pendingName = null;
let onNameProgress = null;

function enterPopup(type, payload) {
	const popup = PAUSING_POPUPS[type];
	openPopup = type;
	openPayload = payload;
	state.pause("popup");
	if (popup.onEnter) popup.onEnter(payload);
	popup.started(payload);
	hotkeyManager.registerConfirmPopup(confirmKeyFor(type));
}

function confirmKeyFor(type) {
	const popup = PAUSING_POPUPS[type];
	if (!popup.onConfirmKey) return () => confirmPopup(type);
	return () => popup.onConfirmKey(openPayload);
}

function endPopup(type) {
	if (openPopup !== type) return false;
	const popup = PAUSING_POPUPS[type];
	openPopup = null;
	openPayload = null;
	pendingName = null;
	hotkeyManager.unregisterConfirmPopup();
	state.unpause("popup");
	if (popup.onExit) popup.onExit();
	popup.ended();
	return true;
}

function confirmPopup(type) {
	if (!endPopup(type)) return false;
	state.send(PAUSING_POPUPS[type].confirmChannel);
	return true;
}

function confirmMedia() {
	if (MEDIA_TYPES.includes(openPopup)) confirmPopup(openPopup);
}

function dismissMedia(floats) {
	if (!MEDIA_TYPES.includes(openPopup)) return;
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

async function pasteSnippet() {
	const held = heldClipboard;
	if (!held) return;
	try {
		if (clipboard.readText() !== held.code) clipboard.writeText(held.code);
		await keyboard.type(primaryModifier(settingsManager, Key), Key.V);
	} catch (e) {
		warnRemoteInput("snippet paste", e);
	}
}

async function pasteAndConfirm() {
	const payload = openPayload;
	if (openPopup !== "snippet") return;
	await pasteSnippet();
	await sleep(PASTE_SETTLE_MS);
	if (openPopup === "snippet" && openPayload === payload) {
		confirmPopup("snippet");
	}
}

function offersName(payload) {
	return !!(payload && payload.typeName && isFileName(payload.target || ""));
}

function goToNameChars() {
	const target = openPayload && openPayload.target;
	if (openPopup !== "go-to" || !target) return null;
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

function armGoToName() {
	const chars = goToNameChars();
	if (!chars) return;
	pendingName = { chars, index: 0, busy: false };
	if (onNameProgress) onNameProgress(nameProgress());
}

async function typeNextNameChar() {
	if (!pendingName || pendingName.busy) return !!pendingName;
	const ch = pendingName.chars[pendingName.index];
	pendingName.busy = true;
	const macOS = isMacOS(settingsManager);
	const released = state.isActive
		? hotkeyManager.releaseAutoTypingHotkeysFor(ch)
		: [];
	if (released.length && macOS) await sleep(20);
	try {
		await keyboard.type(ch);
	} catch (e) {
		warnRemoteInput("type file name", e);
	} finally {
		if (released.length) {
			if (macOS) await sleep(20);
			hotkeyManager.restoreAutoTypingHotkeys(released);
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
		confirmPopup("go-to");
		return true;
	}
	if (onNameProgress) onNameProgress(nameProgress());
	return true;
}

function typeNameOnKey() {
	if (settingsManager.get("hotkeyMode") === "auto-run") runGoToName();
	else typeNextNameChar();
}

async function runGoToName() {
	const run = pendingName;
	if (!run || run.running) return;
	run.running = true;
	const ms = settingsManager.get("autoRunSpeed");
	while (pendingName === run) {
		await typeNextNameChar();
		if (pendingName === run) await sleep(ms);
	}
}

function stepGoToName(delta) {
	if (!pendingName) return false;
	if (!pendingName.busy) {
		const last = pendingName.chars.length - 1;
		pendingName.index = Math.max(
			0,
			Math.min(last, pendingName.index + delta),
		);
		if (onNameProgress) onNameProgress(nameProgress());
	}
	return true;
}

function openPopupType() {
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
	confirmMedia,
	dismissMedia,
	confirmKeyFor,
	pasteAndConfirm,
	armGoToName,
	hasPendingName,
	typeNextNameChar,
	typeNameOnKey,
	stepGoToName,
	setNameProgressHandler,
	openPopupType,
	releaseCodeFromClipboard,
};

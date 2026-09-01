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

const PAUSING_POPUPS = {
	"move-to": {
		started: (payload) => broadcastServer.broadcastMoveToStarted(payload),
		ended: () => broadcastServer.broadcastMoveToEnded(),
		confirmChannel: "move-to-confirmed",
	},
	"code-insert": {
		started: (payload) => broadcastServer.broadcastCodeInsertStarted(payload),
		ended: () => broadcastServer.broadcastCodeInsertEnded(),
		confirmChannel: "code-insert-confirmed",
		onEnter: (payload) => holdCodeOnClipboard(payload && payload.text),
		onExit: () => releaseCodeFromClipboard(),
	},
};

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
	hotkeyManager.registerConfirmPopup(() => confirmPopup(kind));
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

let heldClipboard = null;

function holdCodeOnClipboard(code) {
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

function moveToNameChars() {
	const target = openPayload && openPayload.target;
	if (openPopup !== "move-to" || !target) return null;
	if (!isFileName(target)) return null;
	return [...target, Key.Enter];
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
	const heldTypingKeys = state.isActive;
	const macOS = settingsManager.get("platform") === "macos";
	if (heldTypingKeys) {
		hotkeyManager.unregisterTypingHotkeys();
		if (macOS) await sleep(20);
	}
	try {
		await keyboard.type(ch);
	} catch (e) {
		warnRemoteInput("type file name", e);
	} finally {
		if (heldTypingKeys) {
			if (macOS) await sleep(20);
			hotkeyManager.registerTypingHotkeys();
		}
	}
	if (!pendingName) return true;
	pendingName.index += 1;
	pendingName.busy = false;
	if (pendingName.index >= pendingName.chars.length) pendingName = null;
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
	pasteCodeInsert,
	armMoveToName,
	hasPendingName,
	typeNextNameChar,
	setNameProgressHandler,
	openPopupKind,
};

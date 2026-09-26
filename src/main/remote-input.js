const { mouse, Button, Point, keyboard, Key } = require("@computer-use/nut-js");
const {
	settingsManager,
	broadcastServer,
	hotkeyManager,
} = require("./context");
const state = require("./state");
const { applyWindowPinch, applyWindowDrag } = require("./float-windows");

const warnedRemoteOps = new Set();
function warnRemoteInput(op, err) {
	if (warnedRemoteOps.has(op)) return;
	warnedRemoteOps.add(op);
	console.error(`[LEO] remote ${op} failed: ${err && err.message}`);
}

mouse.config.autoDelayMs = 0;
mouse.config.mouseSpeed = 2000;

broadcastServer.on("client-mouse-move", async (dx, dy) => {
	try {
		const pos = await mouse.getPosition();
		await mouse.setPosition(new Point(pos.x + dx, pos.y + dy));
	} catch (e) {
		warnRemoteInput("pointer move", e);
	}
});
broadcastServer.on("client-mouse-click", async (button) => {
	try {
		if (button === "right") await mouse.rightClick();
		else await mouse.leftClick();
	} catch (e) {
		warnRemoteInput("click", e);
	}
});
broadcastServer.on("client-mouse-scroll", async (dy) => {
	try {
		const amount = Math.abs(Math.round(dy));
		if (dy > 0) await mouse.scrollDown(amount);
		else await mouse.scrollUp(amount);
	} catch (e) {
		warnRemoteInput("scroll", e);
	}
});
let mouseDragActive = false;
let mouseDragOwner = null;
broadcastServer.on("client-mouse-drag-start", async () => {
	try {
		mouseDragActive = true;
		mouseDragOwner = broadcastServer.currentClientId;
		await mouse.pressButton(Button.LEFT);
	} catch (e) {
		mouseDragActive = false;
		mouseDragOwner = null;
		warnRemoteInput("drag start", e);
	}
});
async function releaseDrag(op) {
	mouseDragActive = false;
	mouseDragOwner = null;
	try {
		await mouse.releaseButton(Button.LEFT);
	} catch (e) {
		warnRemoteInput(op, e);
	}
}
broadcastServer.on("client-mouse-drag-end", () => releaseDrag("drag end"));
broadcastServer.on("client-connected", () => {
	state.send("client-connected");
});
broadcastServer.on("client-disconnected", async (clientId) => {
	if (!mouseDragActive) return;
	if (mouseDragOwner !== null && mouseDragOwner !== clientId) return;
	await releaseDrag("drag release on disconnect");
});

broadcastServer.on("client-window-pinch", (scale, dx, dy) =>
	applyWindowPinch(scale, dx, dy),
);
broadcastServer.on("client-window-drag", (dx, dy) => applyWindowDrag(dx, dy));
broadcastServer.on("client-remote-key-press", () => {
	hotkeyManager.handleKey("remote");
});
const EDIT_KEY_TO_KEY = {
	copy: Key.C,
	cut: Key.X,
	paste: Key.V,
	undo: Key.Z,
	save: Key.S,
};
broadcastServer.on("client-remote-edit-key", async (action) => {
	try {
		if (action === "enter") {
			await keyboard.type(Key.Enter);
			return;
		}
		const modifier =
			settingsManager.get("platform") === "macos"
				? Key.LeftCmd
				: Key.LeftControl;
		await keyboard.type(modifier, EDIT_KEY_TO_KEY[action] || Key.C);
	} catch (e) {
		warnRemoteInput("edit key", e);
	}
});

function releaseHeldMouseButton() {
	if (mouseDragActive) releaseDrag("drag release on quit");
}

module.exports = { warnRemoteInput, releaseHeldMouseButton };

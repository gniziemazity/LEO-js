const { globalShortcut } = require("electron");
const state = require("./state");
const { HOTKEY_SETTINGS } = require("../shared/settings-schema");

const CHORD_GUARD_MS = 150;
const TOGGLE_REPEAT_MS = 1000;
const MODIFIER_ORDER = ["Control", "Alt", "Shift"];
const MODIFIER_ALIASES = {
	commandorcontrol: "Control",
	cmdorctrl: "Control",
	control: "Control",
	ctrl: "Control",
	alt: "Alt",
	option: "Alt",
	shift: "Shift",
};

const SPACE = " ";

const swallow = () => {};

function acceleratorFor(key) {
	return key === SPACE ? "Space" : key;
}

function keyNamed(name) {
	const key = String(name).toLowerCase();
	return key === "space" ? SPACE : key;
}

function takesGuards(key) {
	return key === SPACE || /^[a-z]$/i.test(String(key));
}

function guardedChordModifiers(accelerator) {
	const parts = String(accelerator).split("+");
	if (!takesGuards(keyNamed(parts.pop()))) return null;
	const held = parts.map((part) => MODIFIER_ALIASES[part.toLowerCase()]);
	if (held.includes(undefined)) return null;
	return MODIFIER_ORDER.filter((name) => held.includes(name)).join("+");
}

class HotkeyManager {
	constructor(settingsManager) {
		this.settingsManager = settingsManager;
		this.confirmPopupKey = null;
		this.remoteConnected = false;
		this.chordLayers = new Map();
	}

	handleKey(letter) {
		if (!state.isActive) return;
		if (state.onPopupKey && state.onPopupKey()) return;
		if (state.isPaused) return;

		const hotkeyMode = this.settingsManager.get("hotkeyMode");

		if (hotkeyMode === "auto-run") {
			if (state.isAutoRunning) return;

			state.lock();
			state.startAutoRun();
			this.registerEscapeForAutoRun();
			state.send("start-auto-run");
		} else {
			if (state.isLocked) {
				state.queueAdvance(letter);
			} else {
				state.lock();
				state.send("advance-cursor");
			}
		}
	}

	step(delta) {
		if (state.onStepKey && state.onStepKey(delta)) return;
		const h = HOTKEY_SETTINGS.find((s) => s.step === delta);
		if (h) state.send(h.channel);
	}

	registerSystemShortcuts() {
		const shortcuts = this.settingsManager.get("hotkeys");
		const hold = (accelerator, callback, toggle = false) => {
			const modifiers = guardedChordModifiers(accelerator);
			let lastFired = -Infinity;
			globalShortcut.register(accelerator, () => {
				if (modifiers && this.chordLayers.has(modifiers)) return;
				if (toggle) {
					const now = Date.now();
					const repeat = now - lastFired < TOGGLE_REPEAT_MS;
					lastFired = now;
					if (repeat) return;
				}
				callback();
			});
		};

		for (const h of HOTKEY_SETTINGS) {
			if (!h.channel) continue;
			hold(
				shortcuts[h.key],
				() => {
					if (h.step) this.step(h.step);
					else state.send(h.channel);
				},
				!h.step,
			);
		}

		hold(
			shortcuts.alwaysOnTop,
			() => {
				if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
				const isTop = state.mainWindow.isAlwaysOnTop();
				state.mainWindow.setAlwaysOnTop(!isTop);
			},
			true,
		);

		hold(
			shortcuts.toggleTransparency,
			() => {
				if (!state.mainWindow) return;
				const current = state.mainWindow.getOpacity();
				state.mainWindow.setOpacity(current < 0.9 ? 1.0 : 0.5);
			},
			true,
		);

		hold(
			shortcuts.toggleWindow,
			() => {
				if (state.onToggleWindow) state.onToggleWindow();
			},
			true,
		);
	}

	guardChord(modifiers, chordKey) {
		if (!state.isActive || !this.autoTypingHotkeysEnabled()) return () => {};
		const layer =
			this.chordLayers.get(modifiers) || this.armChordLayer(modifiers);
		clearTimeout(layer.timer);
		const own = layer.guards.get(keyNamed(chordKey));
		if (own) globalShortcut.unregister(own);
		return () => {
			if (own) globalShortcut.register(own, swallow);
			this.lingerChordLayer(modifiers, layer);
		};
	}

	armChordLayer(modifiers) {
		const guards = new Map();
		for (const key of this.settingsManager.get("hotkeys.typing") || []) {
			if (!takesGuards(key)) continue;
			const accelerator = `${modifiers}+${acceleratorFor(key)}`;
			if (globalShortcut.isRegistered(accelerator)) continue;
			if (globalShortcut.register(accelerator, swallow)) {
				guards.set(String(key).toLowerCase(), accelerator);
			}
		}
		const layer = { guards, timer: null };
		this.chordLayers.set(modifiers, layer);
		return layer;
	}

	lingerChordLayer(modifiers, layer) {
		const due = Date.now() + CHORD_GUARD_MS;
		layer.timer = setTimeout(() => {
			const loopWasBlocked = Date.now() - due > CHORD_GUARD_MS / 2;
			if (loopWasBlocked) this.lingerChordLayer(modifiers, layer);
			else this.disarmChordLayer(modifiers);
		}, CHORD_GUARD_MS);
	}

	disarmChordLayer(modifiers) {
		const layer = this.chordLayers.get(modifiers);
		if (!layer) return;
		clearTimeout(layer.timer);
		layer.guards.forEach((accelerator) =>
			globalShortcut.unregister(accelerator),
		);
		this.chordLayers.delete(modifiers);
	}

	disarmChordLayers() {
		[...this.chordLayers.keys()].forEach((modifiers) =>
			this.disarmChordLayer(modifiers),
		);
	}

	registerAutoTypingHotkeys() {
		const hotkeys = this.settingsManager.get("hotkeys.typing");
		hotkeys.forEach((letter) => this.registerKey(letter));
	}

	unregisterAutoTypingHotkeys() {
		const hotkeys = this.settingsManager.get("hotkeys.typing");
		hotkeys.forEach((letter) => this.unregisterKey(letter));
		this.disarmChordLayers();
	}

	autoTypingHotkeysEnabled() {
		if (!this.remoteConnected) return true;
		return this.settingsManager.get("typingHotkeysOffWithRemote") !== true;
	}

	setRemoteConnected(connected) {
		this.remoteConnected = !!connected;
		if (!state.isActive) return;
		if (this.autoTypingHotkeysEnabled()) this.registerAutoTypingHotkeys();
		else this.unregisterAutoTypingHotkeys();
	}

	autoTypingHotkeysFor(ch) {
		if (!this.autoTypingHotkeysEnabled()) return [];
		if (typeof ch !== "string" || !ch) return [];
		const hotkeys = this.settingsManager.get("hotkeys.typing") || [];
		const lower = ch.toLowerCase();
		return hotkeys.filter((k) => String(k).toLowerCase() === lower);
	}

	releaseAutoTypingHotkeysFor(ch) {
		const keys = this.autoTypingHotkeysFor(ch);
		keys.forEach((letter) => this.unregisterKey(letter));
		return keys;
	}

	restoreAutoTypingHotkeys(keys) {
		if (!state.isActive) return;
		(keys || []).forEach((letter) => this.registerKey(letter));
	}

	registerKey(letter) {
		if (!this.autoTypingHotkeysEnabled()) return;
		const accelerator = acceleratorFor(letter);
		if (globalShortcut.isRegistered(accelerator)) return;
		globalShortcut.register(accelerator, () => this.handleKey(letter));
	}

	registerEscapeForAutoRun() {
		if (!globalShortcut.isRegistered("Escape")) {
			globalShortcut.register("Escape", () => {
				state.mainWindow.webContents.send("stop-auto-run");
			});
		}
	}

	registerConfirmPopup(callback) {
		if (!state.isActive) return;
		const accelerator = this.settingsManager.get("hotkeys.confirmPopup");
		if (!accelerator) return;
		this.confirmPopupKey = accelerator;
		if (globalShortcut.isRegistered(accelerator)) return;
		if (!globalShortcut.register(accelerator, callback)) {
			console.warn(`[LEO] hotkey unavailable: ${accelerator}`);
		}
	}

	unregisterConfirmPopup() {
		if (!this.confirmPopupKey) return;
		globalShortcut.unregister(this.confirmPopupKey);
		this.confirmPopupKey = null;
	}

	unregisterEscape() {
		if (globalShortcut.isRegistered("Escape")) {
			globalShortcut.unregister("Escape");
		}
	}

	unregisterKey(letter) {
		globalShortcut.unregister(acceleratorFor(letter));
	}

	unregisterAll() {
		globalShortcut.unregisterAll();
		this.chordLayers.forEach((layer) => clearTimeout(layer.timer));
		this.chordLayers.clear();
	}
}

module.exports = HotkeyManager;

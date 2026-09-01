const { globalShortcut } = require("electron");
const state = require("./state");
const { HOTKEY_SETTINGS } = require("../shared/settings-schema");

class HotkeyManager {
	constructor(settingsManager) {
		this.settingsManager = settingsManager;
		this.confirmPopupKey = null;
	}

	handleKey(letter) {
		if (!state.isActive) return;
		if (state.onPopupKey && state.onPopupKey()) return;
		if (state.isPaused) return;

		const hotkeyMode = this.settingsManager.get("hotkeyMode");

		if (hotkeyMode === "auto-run") {
			if (state.isAutoTyping) return;

			state.lock();
			state.startAutoTyping();
			this.registerEscapeForAutoTyping();
			state.send("start-auto-typing");
		} else {
			if (state.isLocked) {
				state.queueAdvance(letter);
			} else {
				state.lock();
				state.send("advance-cursor");
			}
		}
	}

	registerSystemShortcuts() {
		const shortcuts = this.settingsManager.get("hotkeys");

		for (const h of HOTKEY_SETTINGS) {
			if (!h.channel) continue;
			globalShortcut.register(shortcuts[h.key], () => {
				state.send(h.channel);
			});
		}

		globalShortcut.register(shortcuts.alwaysOnTop, () => {
			if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
			const isTop = state.mainWindow.isAlwaysOnTop();
			state.mainWindow.setAlwaysOnTop(!isTop);
		});

		globalShortcut.register(shortcuts.toggleTransparency, () => {
			if (!state.mainWindow) return;
			const current = state.mainWindow.getOpacity();
			state.mainWindow.setOpacity(current < 0.9 ? 1.0 : 0.5);
		});

		const toggleWindowKey = shortcuts.toggleWindow;
		globalShortcut.register(toggleWindowKey, () => {
			if (state.onToggleWindow) state.onToggleWindow();
		});
	}

	registerTypingHotkeys() {
		const hotkeys = this.settingsManager.get("hotkeys.typing");
		hotkeys.forEach((letter) => this.registerKey(letter));
	}

	unregisterTypingHotkeys() {
		const hotkeys = this.settingsManager.get("hotkeys.typing");
		hotkeys.forEach((letter) => globalShortcut.unregister(letter));
	}

	registerKey(letter) {
		if (globalShortcut.isRegistered(letter)) return;
		globalShortcut.register(letter, () => this.handleKey(letter));
	}

	registerEscapeForAutoTyping() {
		if (!globalShortcut.isRegistered("Escape")) {
			globalShortcut.register("Escape", () => {
				state.mainWindow.webContents.send("stop-auto-typing");
			});
		}
	}

	registerConfirmPopup(callback) {
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
		globalShortcut.unregister(letter);
	}

	unregisterAll() {
		globalShortcut.unregisterAll();
	}
}

module.exports = HotkeyManager;

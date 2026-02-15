const { keyboard, Key } = require("@computer-use/nut-js");
const { NUTJS_KEY_MAPPING } = require("../shared/constants");
const state = require("./state");

class KeyboardHandler {
	constructor(hotkeyManager, settingsManager) {
		this.hotkeyManager = hotkeyManager;
		this.settingsManager = settingsManager;
		this.isProcessing = false;

		keyboard.config.autoDelayMs = 0;
	}

	async typeCharacter(char) {
		if (this.isProcessing) {
			console.log("Already processing, skipping:", char);
			return;
		}

		if (state.isPaused) {
			return;
		}

		this.isProcessing = true;

		const charLower = char.toLowerCase();
		const typingHotkeys = this.settingsManager.get("hotkeys.typing");
		const isInterceptorKey = typingHotkeys.includes(charLower);

		try {
			await this.typeCharWithHotkeyManagement(char, charLower, isInterceptorKey);
			this.processQueue();

			if (state.mainWindow) {
				state.mainWindow.webContents.send("character-typed");
			}
		} catch (error) {
			console.error("Error typing character:", error);
			this.ensureHotkeyRegistered(charLower, isInterceptorKey);
			state.unlock();
			state.clearQueue();
		} finally {
			this.isProcessing = false;
		}
	}

	async typeCharWithHotkeyManagement(char, charLower, isInterceptorKey) {
		if (isInterceptorKey) {
			this.hotkeyManager.unregisterKey(charLower);
		}

		await this.typeWithNutJs(char);

		if (isInterceptorKey) {
			this.hotkeyManager.registerKey(charLower);
		}
	}

	ensureHotkeyRegistered(charLower, isInterceptorKey) {
		if (isInterceptorKey) {
			this.hotkeyManager.registerKey(charLower);
		}
	}

	async autoTypeBlock(steps, startIndex, speed) {
		const typingHotkeys = this.settingsManager.get("hotkeys.typing");

		for (let i = startIndex; i < steps.length; i++) {
			if (!state.isAutoTyping) {
				break;
			}

			if (steps[i].type === "block") break;
			if (steps[i].type === "char") {
				const char = steps[i].char;
				const charLower = char.toLowerCase();
				const isInterceptorKey = typingHotkeys.includes(charLower);

				try {
					await this.typeCharWithHotkeyManagement(char, charLower, isInterceptorKey);

					if (state.mainWindow) {
						state.mainWindow.webContents.send(
							"auto-type-step-complete",
							steps[i].index,
						);
					}

					await new Promise((resolve) => setTimeout(resolve, speed));
				} catch (error) {
					console.error("Error typing character during auto-type:", error);
					this.ensureHotkeyRegistered(charLower, isInterceptorKey);
					break;
				}
			}
		}
	}

	async typeWithNutJs(char) {
		if (NUTJS_KEY_MAPPING[char]) {
			const mapping = NUTJS_KEY_MAPPING[char];

			if (mapping.pause) {
				state.pause();

				await new Promise((resolve) => setTimeout(resolve, mapping.pause));

				state.unpause();
				return;
			}

			if (mapping.modifier) {
				await keyboard.type(mapping.modifier, mapping.key);
			} else if (mapping.shift) {
				await keyboard.type(Key.LeftShift, mapping.key);
			} else {
				await keyboard.type(mapping.key);
			}
		} else if (char === "\n") {
			await keyboard.type(Key.Enter);
		} else {
			await keyboard.type(char);
		}
	}

	processQueue() {
		if (state.hasQueuedKeys()) {
			const nextKey = state.dequeueKey();
			state.mainWindow.webContents.send("advance-cursor");
		} else {
			state.unlock();
		}
	}
}

module.exports = KeyboardHandler;

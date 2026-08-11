const { keyboard, Key } = require("@computer-use/nut-js");
const { NUTJS_KEY_MAPPING } = require("../shared/constants");
const state = require("./state");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class KeyboardHandler {
	constructor(hotkeyManager, settingsManager) {
		this.hotkeyManager = hotkeyManager;
		this.settingsManager = settingsManager;
		this.isProcessing = false;

		this.lastTypedChar = null;
		this.lastTypedTime = 0;
		this.debounceMs = 30;

		this.updatePlatformSettings();
	}

	updatePlatformSettings() {
		const platform = this.settingsManager.get("platform") || "windows";
		if (platform === "macos") {
			keyboard.config.autoDelayMs = 50;
		} else {
			keyboard.config.autoDelayMs = 0;
		}
	}

	isMacOS() {
		return this.settingsManager.get("platform") === "macos";
	}

	async typeCharacter(char) {
		if (state.isPaused) {
			return;
		}

		const now = Date.now();
		if (
			char === this.lastTypedChar &&
			now - this.lastTypedTime < this.debounceMs
		) {
			console.log("Debounced duplicate char:", char);
			return;
		}
		this.lastTypedChar = char;
		this.lastTypedTime = now;

		if (this.isProcessing) {
			console.log("Queueing character:", char);
			state.queueChar(char);
			return;
		}

		this.isProcessing = true;

		const charLower = char.toLowerCase();
		const typingHotkeys = this.settingsManager.get("hotkeys.typing");
		const isInterceptorKey = typingHotkeys.includes(charLower);

		try {
			await this.typeCharWithHotkeyManagement(
				char,
				charLower,
				isInterceptorKey,
			);

			state.send("character-typed");

			this.processQueue();
		} catch (error) {
			console.error("Error typing character:", error);
			this.ensureHotkeyRegistered(charLower, isInterceptorKey);
			state.unlock();
			state.clearQueue();
		} finally {
			this.isProcessing = false;

			if (state.hasQueuedChars()) {
				const nextChar = state.dequeueChar();
				this.typeCharacter(nextChar);
			}
		}
	}

	async typeCharWithHotkeyManagement(char, charLower, isInterceptorKey) {
		if (isInterceptorKey) {
			this.hotkeyManager.unregisterKey(charLower);
			// macOS fix: wait for unregister to take effect
			if (this.isMacOS()) {
				await sleep(20);
			}
		}

		await this.typeWithNutJs(char);

		if (isInterceptorKey) {
			// macOS fix: wait before re-registering
			if (this.isMacOS()) {
				await sleep(20);
			}
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
					await this.typeCharWithHotkeyManagement(
						char,
						charLower,
						isInterceptorKey,
					);

					state.send("auto-type-step-complete", steps[i].index);

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
			if (mapping.modifier && mapping.shift) {
				await keyboard.type(mapping.modifier, Key.LeftShift, mapping.key);
			} else if (mapping.modifier) {
				await keyboard.type(mapping.modifier, mapping.key);
			} else if (mapping.shift) {
				await keyboard.type(Key.LeftShift, mapping.key);
			} else {
				await keyboard.type(mapping.key);
			}
			return;
		}

		if (char === "\n") {
			await keyboard.type(Key.Enter);
			return;
		}

		if (char === "\t") {
			await keyboard.type(Key.Tab);
			return;
		}

		await keyboard.type(char);
	}

	processQueue() {
		if (state.hasQueuedAdvances()) {
			state.dequeueAdvance();
			state.send("advance-cursor");
		} else {
			state.unlock();
		}
	}
}

module.exports = KeyboardHandler;

const { keyboard, Key } = require("@computer-use/nut-js");
const { NUTJS_KEY_MAPPING } = require("../shared/constants");
const state = require("./state");

const CHAR_TO_KEY = {
	a: Key.A,
	b: Key.B,
	c: Key.C,
	d: Key.D,
	e: Key.E,
	f: Key.F,
	g: Key.G,
	h: Key.H,
	i: Key.I,
	j: Key.J,
	k: Key.K,
	l: Key.L,
	m: Key.M,
	n: Key.N,
	o: Key.O,
	p: Key.P,
	q: Key.Q,
	r: Key.R,
	s: Key.S,
	t: Key.T,
	u: Key.U,
	v: Key.V,
	w: Key.W,
	x: Key.X,
	y: Key.Y,
	z: Key.Z,
	0: Key.Num0,
	1: Key.Num1,
	2: Key.Num2,
	3: Key.Num3,
	4: Key.Num4,
	5: Key.Num5,
	6: Key.Num6,
	7: Key.Num7,
	8: Key.Num8,
	9: Key.Num9,
	" ": Key.Space,
	".": Key.Period,
	",": Key.Comma,
	"/": Key.Slash,
	"\\": Key.Backslash,
	";": Key.Semicolon,
	"'": Key.Quote,
	"[": Key.LeftBracket,
	"]": Key.RightBracket,
	"-": Key.Minus,
	"=": Key.Equal,
	"`": Key.Grave,
	"\t": Key.Tab,
};

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
			state.queueKey(char);
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
			this.processQueue();

			if (state.mainWindow) {
				state.mainWindow.webContents.send("character-typed");
			}

			this.processQueue();
		} catch (error) {
			console.error("Error typing character:", error);
			this.ensureHotkeyRegistered(charLower, isInterceptorKey);
			state.unlock();
			state.clearQueue();
		} finally {
			this.isProcessing = false;

			if (state.hasQueuedKeys()) {
				const nextChar = state.dequeueKey();
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

		if (this.isMacOS()) {
			await this.typeWithKeyConstants(char);
		} else {
			await keyboard.type(char);
		}
	}

	async typeWithKeyConstants(char) {
		const charLower = char.toLowerCase();

		if (CHAR_TO_KEY[charLower]) {
			const keyToType = CHAR_TO_KEY[charLower];
			const isUpperCase = char !== charLower && /[A-Z]/.test(char);

			if (isUpperCase) {
				await keyboard.type(Key.LeftShift, keyToType);
			} else {
				await keyboard.type(keyToType);
			}
			return;
		}

		await keyboard.type(char);
	}

	processQueue() {
		if (state.hasQueuedKeys()) {
			state.dequeueKey();
			state.mainWindow.webContents.send("advance-cursor");
		} else {
			state.unlock();
		}
	}
}

module.exports = KeyboardHandler;

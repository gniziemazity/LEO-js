const { execFile } = require("child_process");
const { keyboard, Key } = require("@computer-use/nut-js");
const { libnut } = require("@computer-use/libnut/dist/import_libnut");
const { NUTJS_KEY_MAPPING } = require("../shared/constants");
const state = require("./state");
const { sleep, isMacOS, primaryModifier } = require("./platform");

const SHIFTED_CHAR_TO_KEY = {
	"!": Key.Num1,
	"@": Key.Num2,
	"#": Key.Num3,
	$: Key.Num4,
	"%": Key.Num5,
	"^": Key.Num6,
	"&": Key.Num7,
	"*": Key.Num8,
	"(": Key.Num9,
	")": Key.Num0,
	_: Key.Minus,
	"+": Key.Equal,
	"{": Key.LeftBracket,
	"}": Key.RightBracket,
	"|": Key.Backslash,
	":": Key.Semicolon,
	'"': Key.Quote,
	"<": Key.Comma,
	">": Key.Period,
	"?": Key.Slash,
	"~": Key.Grave,
};

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
};

const LAYOUT_NATIVE_CHAINS = {
	"<": [["<", []]],
	">": [["<", ["shift"]]],
};

function tapLayoutChar(char, modifiers) {
	try {
		libnut.keyTap(char, modifiers);
		return true;
	} catch {
		return false;
	}
}

function keystrokeViaSystemEvents(char) {
	const codePoint = char.codePointAt(0);
	const script = `tell application "System Events" to keystroke (character id ${codePoint})`;
	return new Promise((resolve) => {
		execFile("osascript", ["-e", script], (error) => resolve(!error));
	});
}

class KeyboardHandler {
	constructor(hotkeyManager, settingsManager) {
		this.hotkeyManager = hotkeyManager;
		this.settingsManager = settingsManager;
		this.isProcessing = false;

		this.updatePlatformSettings();
	}

	updatePlatformSettings() {
		keyboard.config.autoDelayMs = this.isMacOS() ? 50 : 0;
	}

	isMacOS() {
		return isMacOS(this.settingsManager);
	}

	async typeCharacter(char) {
		if (state.isPaused) {
			state.unlock();
			state.clearQueue();
			return;
		}

		if (this.isProcessing) {
			state.queueChar(char);
			return;
		}

		this.isProcessing = true;

		try {
			await this.typeCharWithHotkeyManagement(char);

			this.processQueue();
		} catch (error) {
			console.error("[LEO] type failed:", error);
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

	async typeCharWithHotkeyManagement(char) {
		const released = this.hotkeyManager.releaseAutoTypingHotkeysFor(char);
		const settle = released.length > 0 && this.isMacOS();
		if (settle) await sleep(20);
		try {
			await this.typeWithNutJs(char);
		} finally {
			if (settle) await sleep(20);
			this.hotkeyManager.restoreAutoTypingHotkeys(released);
		}
	}

	async autoRunBlock(steps, startIndex, speed) {
		for (let i = startIndex; i < steps.length; i++) {
			if (!state.isAutoRunning) {
				break;
			}

			if (steps[i].type === "block") break;
			if (steps[i].type === "char") {
				try {
					await this.typeCharWithHotkeyManagement(steps[i].char);

					state.send("auto-run-step-complete", steps[i].index);

					await sleep(speed);
				} catch (error) {
					console.error("[LEO] auto-run failed:", error);
					break;
				}
			}
		}
	}

	async typeWithNutJs(char) {
		if (NUTJS_KEY_MAPPING[char]) {
			const mapping = NUTJS_KEY_MAPPING[char];

			if (mapping.pause) {
				state.pause("pause-key");
				await sleep(mapping.pause);
				state.unpause("pause-key");
				return;
			}
			const modifier = mapping.primary
				? primaryModifier(this.settingsManager, Key)
				: mapping.modifier;
			if (modifier && mapping.shift) {
				await keyboard.type(modifier, Key.LeftShift, mapping.key);
			} else if (modifier) {
				await keyboard.type(modifier, mapping.key);
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
		const chain = LAYOUT_NATIVE_CHAINS[char] || [];
		for (const [key, modifiers] of chain) {
			if (tapLayoutChar(key, modifiers)) {
				return;
			}
		}

		if (await this.typeWithUsLayout(char)) {
			return;
		}

		if (await keystrokeViaSystemEvents(char)) {
			return;
		}

		await keyboard.type(char);
	}

	async typeWithUsLayout(char) {
		const charLower = char.toLowerCase();

		try {
			if (CHAR_TO_KEY[charLower]) {
				const keyToType = CHAR_TO_KEY[charLower];
				const isUpperCase = char !== charLower && /[A-Z]/.test(char);

				if (isUpperCase) {
					await keyboard.type(Key.LeftShift, keyToType);
				} else {
					await keyboard.type(keyToType);
				}
				return true;
			}

			if (SHIFTED_CHAR_TO_KEY[char]) {
				await keyboard.type(Key.LeftShift, SHIFTED_CHAR_TO_KEY[char]);
				return true;
			}
		} catch {
			return false;
		}

		return false;
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

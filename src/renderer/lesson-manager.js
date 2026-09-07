const fs = require("fs");
const path = require("path");
const {
	moveToFileName,
	wrapAnchor,
	isFileName,
} = require("../shared/move-to-target");
const { normalizeEdgeNewlines } = require("../shared/code-text");
const { getBlockSubtype, splitPinToken } = require("../shared/blocks");
const { replayPlan, toReplayableText } = require("./anchor-snippet");

class LessonManager {
	constructor() {
		this.data = [];
		this.currentFilePath = "";
		this.hasUnsavedChanges = false;
		this.onChangeCallback = null;
	}

	load(filePath, callback) {
		fs.readFile(filePath, "utf8", (err, data) => {
			if (err) {
				callback(err, null);
				return;
			}

			try {
				const parsed = JSON.parse(data);
				const migrated = LessonManager._migrateBlocks(parsed);
				if (!Array.isArray(migrated)) {
					callback(
						new Error("Not a valid LEO plan (expected a list of blocks)"),
						null,
					);
					return;
				}
				this.data = LessonManager._expandIncludes(
					LessonManager._withStartWith(migrated),
					path.dirname(filePath),
					new Set([path.resolve(filePath)]),
				);
				this.currentFilePath = filePath;
				this.hasUnsavedChanges = false;
				callback(null, this.data);
			} catch (e) {
				callback(e, null);
			}
		});
	}

	static _pinShorthand(text) {
		const sub = getBlockSubtype(text);
		if (sub !== "image-comment" && sub !== "web-comment") return null;
		const split = splitPinToken(text);
		return split.pin ? split : null;
	}

	static _migrateBlocks(blocks) {
		if (!Array.isArray(blocks)) return blocks;
		return blocks.map((b) => {
			if (b && b.type === "code" && typeof b.text === "string") {
				return { ...b, text: normalizeEdgeNewlines(b.text) };
			}
			if (b && b.type === "comment" && typeof b.text === "string") {
				const shorthand = LessonManager._pinShorthand(b.text);
				if (shorthand) return { ...b, text: shorthand.text, pin: true };
			}
			return b;
		});
	}

	static authored(blocks) {
		return blocks.filter(
			(b) => b && !b.fromInclude && !(b.type === "include" && !b.path),
		);
	}

	static _withStartWith(blocks) {
		const rest = blocks.filter((b) => !b || b.type !== "include");
		const first = blocks.find((b) => b && b.type === "include");
		return [first || { type: "include", path: "" }, ...rest];
	}

	getStartWith() {
		const b = this.data[0];
		return b && b.type === "include" ? b.path || "" : "";
	}

	setStartWith(planPath) {
		if (!this.data[0] || this.data[0].type !== "include") {
			this.data.unshift({ type: "include", path: "" });
		}
		this.data[0].path = planPath || "";
		this.markAsChanged();
	}

	listSiblingPlans() {
		if (!this.currentFilePath) return [];
		const dir = path.dirname(this.currentFilePath);
		const self = path.basename(this.currentFilePath);
		try {
			return fs
				.readdirSync(dir)
				.filter((f) => /\.(leo|json)$/i.test(f) && f !== self)
				.sort((a, b) => a.localeCompare(b))
				.map((f) => "./" + f);
		} catch (e) {
			return [];
		}
	}

	static _expandIncludes(blocks, baseDir, seen) {
		const out = [];
		for (const block of blocks) {
			out.push(block);
			if (!block || block.type !== "include") continue;
			if (typeof block.path !== "string" || !block.path.trim()) continue;
			const abs = path.resolve(baseDir, block.path);
			if (seen.has(abs)) {
				throw new Error(`Include loops back on itself: ${block.path}`);
			}
			let raw;
			try {
				raw = fs.readFileSync(abs, "utf8");
			} catch (e) {
				throw new Error(`Included plan not found: ${block.path}`);
			}
			const inner = LessonManager._migrateBlocks(JSON.parse(raw));
			if (!Array.isArray(inner)) {
				throw new Error(
					`Included plan is not a list of blocks: ${block.path}`,
				);
			}
			const expanded = LessonManager._expandIncludes(
				inner,
				path.dirname(abs),
				new Set(seen).add(abs),
			);
			out.push(...LessonManager._startingStateBlocks(expanded));
		}
		return out;
	}

	static _startingStateBlocks(blocks) {
		const { editors, order } = replayPlan(blocks);
		const out = [];
		for (const name of order) {
			if (name === "main" || name === "dev") continue;
			const state = editors[name];
			if (!state || !state.text) continue;
			out.push({ type: "move-to", target: name, fromInclude: true });
			out.push({
				type: "comment",
				text: `📋 ${LessonManager._textWithAnchors(state)}`,
				fromInclude: true,
			});
		}
		return out;
	}

	static _textWithAnchors(state) {
		const placed = Object.entries(state.anchors || {})
			.filter(
				([, pos]) =>
					Number.isInteger(pos) && pos >= 0 && pos <= state.text.length,
			)
			.sort((a, b) => b[1] - a[1]);
		let text = state.text;
		for (const [id, pos] of placed) {
			text = text.slice(0, pos) + wrapAnchor(id) + text.slice(pos);
		}
		return toReplayableText(text);
	}

	save(callback) {
		if (!this.currentFilePath) {
			callback(new Error("No file path set"));
			return;
		}

		const jsonData = JSON.stringify(
			LessonManager.authored(this.data),
			null,
			2,
		);

		fs.writeFile(this.currentFilePath, jsonData, (err) => {
			if (err) {
				callback(err);
			} else {
				this.hasUnsavedChanges = false;
				callback(null);
			}
		});
	}

	static defaultBlocks() {
		return [
			{ type: "comment", text: "Enter lesson title" },
			{ type: "code", text: "// Enter first code snippet" },
		];
	}

	create(filePath, callback) {
		this.currentFilePath = filePath;
		this.data = LessonManager._withStartWith(LessonManager.defaultBlocks());
		this.hasUnsavedChanges = true;

		this.save(callback);
	}

	addBlock(type, afterIndex = null, initialText = null) {
		let newBlock;
		if (type === "move-to") {
			newBlock = {
				type,
				target: typeof initialText === "string" ? initialText : "MAIN",
			};
		} else if (type === "include") {
			this.setStartWith(initialText);
			return 0;
		} else {
			const text =
				initialText !== null && initialText !== undefined
					? initialText
					: "";
			newBlock = {
				type,
				text: type === "code" ? normalizeEdgeNewlines(text) : text,
			};
			const shorthand = LessonManager._pinShorthand(newBlock.text);
			if (shorthand) {
				newBlock.text = shorthand.text;
				newBlock.pin = true;
			}
		}

		if (afterIndex === null) {
			this.data.push(newBlock);
		} else {
			this.data.splice(afterIndex + 1, 0, newBlock);
		}

		this.markAsChanged();
		return this.data.length - 1;
	}

	removeBlock(index) {
		if (index < 0 || index >= this.data.length) {
			return false;
		}

		this.data.splice(index, 1);
		this.markAsChanged();
		return true;
	}

	updateBlock(index, text) {
		if (index < 0 || index >= this.data.length) {
			return false;
		}

		const block = this.data[index];
		let next = block.type === "code" ? normalizeEdgeNewlines(text) : text;
		const shorthand = LessonManager._pinShorthand(next);
		if (shorthand) {
			next = shorthand.text;
			block.pin = true;
		}
		block.text = next;
		this.markAsChanged();
		return true;
	}

	updateMoveToTarget(index, target) {
		if (index < 0 || index >= this.data.length) {
			return false;
		}
		if (this.data[index].type !== "move-to") return false;
		this.data[index].target = target;
		this.markAsChanged();
		return true;
	}

	updateMoveToNote(index, note) {
		if (index < 0 || index >= this.data.length) {
			return false;
		}
		if (this.data[index].type !== "move-to") return false;
		const text = String(note == null ? "" : note).trim();
		if (text) this.data[index].note = text;
		else delete this.data[index].note;
		this.markAsChanged();
		return true;
	}

	isFirstMoveToFile(index) {
		const block = this.data[index];
		if (!block || block.type !== "move-to") return false;
		const target = block.target;
		if (!isFileName(target)) return false;
		for (let i = 0; i < index; i++) {
			const b = this.data[i];
			if (b && b.type === "move-to" && b.target === target) return false;
		}
		return true;
	}

	updateBlockOption(index, key, value, defaultValue) {
		if (index < 0 || index >= this.data.length) {
			return false;
		}
		const block = this.data[index];
		if (value === defaultValue) delete block[key];
		else block[key] = value;
		this.markAsChanged();
		return true;
	}

	anchorIdsBefore(index) {
		const { editors } = replayPlan(this.data, index);
		const seen = new Set();
		const out = [];
		for (const state of Object.values(editors)) {
			for (const id of Object.keys(state.anchors)) {
				if (id && !seen.has(id)) {
					seen.add(id);
					out.push(id);
				}
			}
		}
		return out;
	}

	getAllMoveToFiles() {
		const seen = new Set();
		const out = [];
		for (const block of this.data) {
			if (!block || block.type !== "move-to") continue;
			const name = moveToFileName(block.target);
			if (name && !seen.has(name)) {
				seen.add(name);
				out.push(name);
			}
		}
		return out;
	}

	getBlock(index) {
		return this.data[index] || null;
	}

	getAllBlocks() {
		return this.data;
	}

	getCurrentFilePath() {
		return this.currentFilePath;
	}

	getNextAnchorId() {
		let max = -1;
		const re = /⚓(\d+)⚓/g;
		for (const block of this.data) {
			const text =
				typeof block.text === "string"
					? block.text
					: typeof block.target === "string"
						? block.target
						: "";
			if (!text) continue;
			let m;
			while ((m = re.exec(text)) !== null) {
				const n = parseInt(m[1], 10);
				if (Number.isFinite(n) && n > max) max = n;
			}
		}
		return max + 1;
	}

	hasChanges() {
		return this.hasUnsavedChanges;
	}

	markAsChanged() {
		this.hasUnsavedChanges = true;
		if (this.onChangeCallback) {
			this.onChangeCallback();
		}
	}

	onChange(callback) {
		this.onChangeCallback = callback;
	}
}

module.exports = LessonManager;

const fs = require("fs");
const path = require("path");
const {
	goToFileName,
	isFileName,
	wrapAnchor,
	anchorIdPattern,
} = require("../shared/go-to-target");
const { normalizeEdgeNewlines } = require("../shared/code-text");
const {
	writeFileAtomic,
	writeFileAtomicSync,
} = require("../shared/atomic-write");
const {
	PICKABLE_TYPES,
	GO_TO_TYPE,
	CODE_TYPE,
	getBlockType,
	withTypePrefix,
	splitPinToken,
	stripBlockPrefix,
} = require("../shared/blocks");
const { replayPlan } = require("./plan-replay");
const {
	startDirFor,
	isDirectory,
	listStartFiles,
	embedAnchors,
	readAnchors,
} = require("../shared/start-folder");

const AUTOSAVE_EXT = ".autosave";
const AUTOSAVE_DEBOUNCE_MS = 2000;
const GO_TO_IN_FILE = "move-to";

class LessonManager {
	constructor() {
		this.data = [];
		this.currentFilePath = "";
		this.hasUnsavedChanges = false;
		this.changeListeners = [];
		this.autosaveTimer = null;
	}

	load(filePath, callback, options = {}) {
		if (this.autosaveTimer) {
			clearTimeout(this.autosaveTimer);
			this.autosaveTimer = null;
		}
		const readFrom = options.from || filePath;
		const recovered = readFrom !== filePath;

		fs.readFile(readFrom, "utf8", (err, data) => {
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
				this.data = LessonManager._expandStart(
					LessonManager._withStartSlot(migrated),
					filePath,
				);
				this.currentFilePath = filePath;
				this.hasUnsavedChanges = recovered;
				if (!recovered) this.clearAutosave();
				callback(null, this.data);
			} catch (e) {
				callback(e, null);
			}
		});
	}

	static _pinShorthand(text) {
		const type = getBlockType(text);
		if (type !== "image" && type !== "web") return null;
		const split = splitPinToken(text);
		return split.pin ? split : null;
	}

	static _normalized(b) {
		if (!b || typeof b.text !== "string") return b;
		if (b.type === "code") {
			return { ...b, text: normalizeEdgeNewlines(b.text) };
		}
		if (b.type === "comment") {
			const shorthand = LessonManager._pinShorthand(b.text);
			if (shorthand) return { ...b, text: shorthand.text, pin: true };
		}
		return b;
	}

	static _migrateBlocks(blocks) {
		if (!Array.isArray(blocks)) return blocks;
		return blocks.map((b) =>
			LessonManager._normalized(
				b && b.type === GO_TO_IN_FILE ? { ...b, type: GO_TO_TYPE } : b,
			),
		);
	}

	static authored(blocks) {
		const out = [];
		for (const b of blocks) {
			if (!b || b.fromStart) continue;
			if (b.type !== "include") {
				out.push(b.type === GO_TO_TYPE ? { ...b, type: GO_TO_IN_FILE } : b);
				continue;
			}
			const anchors = LessonManager._storedAnchors(b.anchors);
			if (anchors) out.push({ type: "include", anchors });
		}
		return out;
	}

	static _storedAnchors(anchors) {
		const kept = {};
		for (const [file, byId] of Object.entries(anchors || {})) {
			if (byId && Object.keys(byId).length) kept[file] = byId;
		}
		return Object.keys(kept).length ? kept : null;
	}

	static _withStartSlot(blocks) {
		const rest = blocks.filter((b) => !b || b.type !== "include");
		const first = blocks.find((b) => b && b.type === "include");
		return [
			{ type: "include", anchors: (first && first.anchors) || {} },
			...rest,
		];
	}

	static _expandStart(blocks, planPath) {
		const slot = blocks[0];
		const dir = startDirFor(planPath);
		if (!dir || !isDirectory(dir)) {
			slot.dir = null;
			return blocks;
		}
		const files = listStartFiles(dir);
		slot.dir = path.basename(dir);
		slot.files = files.length;
		const generated = [];
		for (const { name, text } of files) {
			generated.push({ type: "go-to", target: name, fromStart: true });
			generated.push({
				type: "comment",
				text: `📋 ${embedAnchors(text, (slot.anchors || {})[name])}`,
				fromStart: true,
				startFile: name,
				startText: text,
			});
		}
		return [slot, ...generated, ...blocks.slice(1)];
	}

	_readStartBody(index, body) {
		const block = this.data[index];
		if (!block || !block.startFile) return null;
		const { clean, anchors } = readAnchors(body);
		return clean === block.startText ? { block, anchors } : null;
	}

	canSetStartAnchors(index, body) {
		return this._readStartBody(index, body) !== null;
	}

	setStartAnchors(index, body) {
		const read = this._readStartBody(index, body);
		if (!read) return false;
		const { block, anchors } = read;
		const slot = this.data[0];
		slot.anchors = slot.anchors || {};
		const before = JSON.stringify(slot.anchors[block.startFile] || {});
		if (Object.keys(anchors).length) slot.anchors[block.startFile] = anchors;
		else delete slot.anchors[block.startFile];
		block.text = `📋 ${embedAnchors(block.startText, anchors)}`;
		if (JSON.stringify(anchors) !== before) this.markAsChanged();
		return true;
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

		writeFileAtomic(this.currentFilePath, jsonData, ".saving", (err) => {
			if (err) {
				callback(err);
				return;
			}
			this.hasUnsavedChanges = false;
			this.clearAutosave();
			callback(null);
		});
	}

	static defaultBlocks() {
		return [
			{ type: "comment", text: "", placeholder: "Enter lesson title" },
			{ type: "code", text: "", placeholder: "Enter first code snippet" },
		];
	}

	create(filePath, callback) {
		this.currentFilePath = filePath;
		this.data = LessonManager._withStartSlot(LessonManager.defaultBlocks());
		this.hasUnsavedChanges = true;

		this.save(callback);
	}

	addBlock(type, afterIndex = null, initialText = null) {
		let newBlock;
		if (type === "go-to") {
			newBlock = {
				type,
				target: typeof initialText === "string" ? initialText : "MAIN",
			};
		} else {
			newBlock = LessonManager._normalized({
				type,
				text: initialText ?? "",
			});
		}

		let at;
		if (afterIndex === null) {
			at = this.data.length;
			this.data.push(newBlock);
		} else {
			at = afterIndex + 1;
			this.data.splice(at, 0, newBlock);
		}

		this.markAsChanged();
		return at;
	}

	insertBlockCopy(block, afterIndex) {
		const copy = JSON.parse(JSON.stringify(block));
		for (const key of ["fromStart", "startFile", "startText"]) {
			delete copy[key];
		}
		if (typeof copy.text === "string") {
			let next = this.getNextAnchorId();
			copy.text = copy.text.replace(anchorIdPattern(), () =>
				wrapAnchor(next++),
			);
		}
		const at = afterIndex + 1;
		this.data.splice(at, 0, copy);
		this.markAsChanged();
		return at;
	}

	firstAuthoredIndex() {
		let i = 1;
		while (i < this.data.length && this.data[i] && this.data[i].fromStart) {
			i++;
		}
		return i;
	}

	_authoredSet(indices) {
		const floor = this.firstAuthoredIndex();
		const sorted = [...new Set(indices)].sort((a, b) => a - b);
		if (!sorted.length) return null;
		if (sorted[0] < floor || sorted[sorted.length - 1] >= this.data.length)
			return null;
		return { floor, sorted };
	}

	canRemoveBlock(index) {
		return this.canRemoveBlocks([index]);
	}

	canRemoveBlocks(indices) {
		const set = this._authoredSet(indices);
		if (!set) return false;
		return this.data.length - set.floor - set.sorted.length >= 1;
	}

	removeBlocks(indices) {
		if (!this.canRemoveBlocks(indices)) return false;
		const sorted = this._authoredSet(indices).sorted;
		for (const i of sorted.reverse()) this.data.splice(i, 1);
		this.markAsChanged();
		return true;
	}

	canMoveBlock(index, delta) {
		return this.canMoveBlocks([index], delta);
	}

	canMoveBlocks(indices, delta) {
		const set = this._authoredSet(indices);
		if (!set) return false;
		const { floor, sorted } = set;
		return (
			sorted[0] + delta >= floor &&
			sorted[sorted.length - 1] + delta < this.data.length
		);
	}

	moveBlock(index, delta) {
		return this.moveBlocks([index], delta);
	}

	moveBlocks(indices, delta) {
		if (!this.canMoveBlocks(indices, delta)) return false;
		const sorted = this._authoredSet(indices).sorted;
		for (const i of delta < 0 ? sorted : sorted.reverse()) {
			const [block] = this.data.splice(i, 1);
			this.data.splice(i + delta, 0, block);
		}
		this.markAsChanged();
		return true;
	}

	canSetBlockType(index, type) {
		const block = this.getBlock(index);
		if (!block || block.fromStart) return false;
		if (
			block.type !== "comment" &&
			block.type !== GO_TO_TYPE &&
			block.type !== CODE_TYPE
		) {
			return false;
		}
		return PICKABLE_TYPES.includes(type);
	}

	setBlockType(index, type) {
		if (!this.canSetBlockType(index, type)) return false;
		const block = this.data[index];
		const wasGoTo = block.type === GO_TO_TYPE;
		const words = wasGoTo
			? block.note || ""
			: stripBlockPrefix(block.text || "");

		if (type === GO_TO_TYPE) {
			const note = words.replace(/\s+/g, " ").trim();
			delete block.text;
			delete block.paste;
			delete block.pin;
			block.type = GO_TO_TYPE;
			if (!wasGoTo) block.target = "MAIN";
			if (note) block.note = note;
			else delete block.note;
		} else {
			if (wasGoTo) {
				delete block.target;
				delete block.typeName;
				delete block.note;
			}
			block.type = type === CODE_TYPE ? CODE_TYPE : "comment";
			block.text =
				type === CODE_TYPE
					? normalizeEdgeNewlines(words)
					: withTypePrefix(type, words);
			if (type !== "snippet") delete block.paste;
			if (type !== "image" && type !== "web") delete block.pin;
		}

		this.markAsChanged();
		return true;
	}

	updateBlock(index, text) {
		const block = this.getBlock(index);
		if (!block) return false;
		const next = LessonManager._normalized({ type: block.type, text });
		block.text = next.text;
		if (next.pin) block.pin = true;
		this.markAsChanged();
		return true;
	}

	updateBlockBody(index, body) {
		const block = this.data[index];
		if (!block) return false;
		if (block.type !== "comment") return this.updateBlock(index, body);
		return this.updateBlock(
			index,
			withTypePrefix(getBlockType(block.text), body),
		);
	}

	_goToBlock(index) {
		const block = this.getBlock(index);
		return block && block.type === "go-to" ? block : null;
	}

	updateGoToTarget(index, target) {
		const block = this._goToBlock(index);
		if (!block) return false;
		block.target = target;
		this.markAsChanged();
		return true;
	}

	updateGoToNote(index, note) {
		const block = this._goToBlock(index);
		if (!block) return false;
		const text = String(note == null ? "" : note).trim();
		if (text) block.note = text;
		else delete block.note;
		this.markAsChanged();
		return true;
	}

	isFirstGoToFile(index) {
		const block = this._goToBlock(index);
		if (!block) return false;
		const target = block.target;
		if (!isFileName(target)) return false;
		for (let i = 0; i < index; i++) {
			const b = this.data[i];
			if (b && b.type === "go-to" && b.target === target) return false;
		}
		return true;
	}

	updateBlockOption(index, key, value, defaultValue) {
		const block = this.getBlock(index);
		if (!block) return false;
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

	getAllGoToFiles() {
		const seen = new Set();
		const out = [];
		for (const block of this.data) {
			if (!block || block.type !== "go-to") continue;
			const name = goToFileName(block.target);
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
		const re = anchorIdPattern();
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
		this.scheduleAutosave();
		for (const listener of this.changeListeners) listener();
	}

	static autosavePathFor(planPath) {
		return `${planPath}${AUTOSAVE_EXT}`;
	}

	autosavePath() {
		return this.currentFilePath
			? LessonManager.autosavePathFor(this.currentFilePath)
			: "";
	}

	scheduleAutosave() {
		if (!this.currentFilePath) return;
		if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
		this.autosaveTimer = setTimeout(() => {
			this.autosaveTimer = null;
			this.writeAutosave();
		}, AUTOSAVE_DEBOUNCE_MS);
	}

	writeAutosave() {
		if (!this.currentFilePath || !this.hasUnsavedChanges) return;
		try {
			writeFileAtomicSync(
				this.autosavePath(),
				JSON.stringify(LessonManager.authored(this.data), null, 2),
			);
		} catch (error) {
			console.error("[LEO] autosave failed:", error);
		}
	}

	discardChanges() {
		this.clearAutosave();
		this.hasUnsavedChanges = false;
	}

	clearAutosave() {
		if (this.autosaveTimer) {
			clearTimeout(this.autosaveTimer);
			this.autosaveTimer = null;
		}
		const target = this.autosavePath();
		if (!target) return;
		try {
			fs.unlinkSync(target);
		} catch (_) {}
	}

	static pendingAutosave(planPath) {
		const target = LessonManager.autosavePathFor(planPath);
		try {
			const saved = fs.statSync(target);
			const plan = fs.statSync(planPath);
			if (saved.mtimeMs <= plan.mtimeMs) return null;
			return target;
		} catch (_) {
			return null;
		}
	}

	onChange(callback) {
		this.changeListeners.push(callback);
	}
}

module.exports = LessonManager;

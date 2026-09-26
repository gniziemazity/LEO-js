const fs = require("fs");
const path = require("path");
const { moveToFileName, isFileName } = require("../shared/move-to-target");
const { normalizeEdgeNewlines } = require("../shared/code-text");
const {
	PICKABLE_KINDS,
	MOVE_TO_KIND,
	CODE_KIND,
	getBlockKind,
	withKindPrefix,
	splitPinToken,
	stripBlockPrefix,
} = require("../shared/blocks");
const { replayPlan } = require("./anchor-snippet");
const {
	startDirFor,
	isDirectory,
	listStartFiles,
	embedAnchors,
	readAnchors,
} = require("../shared/start-folder");

const AUTOSAVE_EXT = ".autosave";
const AUTOSAVE_DEBOUNCE_MS = 2000;

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
					LessonManager._withStartWith(migrated),
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
		const kind = getBlockKind(text);
		if (kind !== "image" && kind !== "web") return null;
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
		return blocks.map(LessonManager._normalized);
	}

	static authored(blocks) {
		const out = [];
		for (const b of blocks) {
			if (!b || b.fromInclude) continue;
			if (b.type !== "include") {
				out.push(b);
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

	static _withStartWith(blocks) {
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
			generated.push({ type: "move-to", target: name, fromInclude: true });
			generated.push({
				type: "comment",
				text: `📋 ${embedAnchors(text, (slot.anchors || {})[name])}`,
				fromInclude: true,
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

		const target = this.currentFilePath;
		const temp = `${target}.saving`;

		fs.writeFile(temp, jsonData, (err) => {
			if (err) {
				callback(err);
				return;
			}
			fs.rename(temp, target, (renameErr) => {
				if (renameErr) {
					fs.unlink(temp, () => {});
					callback(renameErr);
					return;
				}
				this.hasUnsavedChanges = false;
				this.clearAutosave();
				callback(null);
			});
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
		for (const key of ["fromInclude", "startFile", "startText"]) {
			delete copy[key];
		}
		if (typeof copy.text === "string") {
			let next = this.getNextAnchorId();
			copy.text = copy.text.replace(/⚓\d+⚓/g, () => `⚓${next++}⚓`);
		}
		const at = afterIndex + 1;
		this.data.splice(at, 0, copy);
		this.markAsChanged();
		return at;
	}

	firstAuthoredIndex() {
		let i = 1;
		while (i < this.data.length && this.data[i] && this.data[i].fromInclude) {
			i++;
		}
		return i;
	}

	canRemoveBlock(index) {
		const floor = this.firstAuthoredIndex();
		if (index < floor || index >= this.data.length) return false;
		return this.data.length - floor > 1;
	}

	canMoveBlock(index, delta) {
		const floor = this.firstAuthoredIndex();
		const to = index + delta;
		if (index < floor || index >= this.data.length) return false;
		return to >= floor && to < this.data.length;
	}

	moveBlock(index, delta) {
		if (!this.canMoveBlock(index, delta)) return false;
		const to = index + delta;
		const [block] = this.data.splice(index, 1);
		this.data.splice(to, 0, block);
		this.markAsChanged();
		return true;
	}

	canSetBlockKind(index, kind) {
		const block = this.getBlock(index);
		if (!block || block.fromInclude) return false;
		if (
			block.type !== "comment" &&
			block.type !== MOVE_TO_KIND &&
			block.type !== CODE_KIND
		) {
			return false;
		}
		return PICKABLE_KINDS.includes(kind);
	}

	setBlockKind(index, kind) {
		if (!this.canSetBlockKind(index, kind)) return false;
		const block = this.data[index];
		const wasMoveTo = block.type === MOVE_TO_KIND;
		const words = wasMoveTo
			? block.note || ""
			: stripBlockPrefix(block.text || "");

		if (kind === MOVE_TO_KIND) {
			const note = words.replace(/\s+/g, " ").trim();
			delete block.text;
			delete block.paste;
			delete block.pin;
			block.type = MOVE_TO_KIND;
			if (!wasMoveTo) block.target = "MAIN";
			if (note) block.note = note;
			else delete block.note;
		} else {
			if (wasMoveTo) {
				delete block.target;
				delete block.typeName;
				delete block.note;
			}
			block.type = kind === CODE_KIND ? CODE_KIND : "comment";
			block.text =
				kind === CODE_KIND
					? normalizeEdgeNewlines(words)
					: withKindPrefix(kind, words);
			if (kind !== "snippet") delete block.paste;
			if (kind !== "image" && kind !== "web") delete block.pin;
		}

		this.markAsChanged();
		return true;
	}

	removeBlock(index) {
		if (!this.getBlock(index)) return false;
		this.data.splice(index, 1);
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
			withKindPrefix(getBlockKind(block.text), body),
		);
	}

	_moveToBlock(index) {
		const block = this.getBlock(index);
		return block && block.type === "move-to" ? block : null;
	}

	updateMoveToTarget(index, target) {
		const block = this._moveToBlock(index);
		if (!block) return false;
		block.target = target;
		this.markAsChanged();
		return true;
	}

	updateMoveToNote(index, note) {
		const block = this._moveToBlock(index);
		if (!block) return false;
		const text = String(note == null ? "" : note).trim();
		if (text) block.note = text;
		else delete block.note;
		this.markAsChanged();
		return true;
	}

	isFirstMoveToFile(index) {
		const block = this._moveToBlock(index);
		if (!block) return false;
		const target = block.target;
		if (!isFileName(target)) return false;
		for (let i = 0; i < index; i++) {
			const b = this.data[i];
			if (b && b.type === "move-to" && b.target === target) return false;
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
		const target = this.autosavePath();
		const temp = `${target}.tmp`;
		try {
			fs.writeFileSync(
				temp,
				JSON.stringify(LessonManager.authored(this.data), null, 2),
			);
			fs.renameSync(temp, target);
		} catch (error) {
			console.error("[LEO] autosave failed:", error);
			try {
				fs.unlinkSync(temp);
			} catch (_) {}
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

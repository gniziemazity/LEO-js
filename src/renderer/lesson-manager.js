const fs = require("fs");

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
				this.data = migrated;
				this.currentFilePath = filePath;
				this.hasUnsavedChanges = false;
				callback(null, this.data);
			} catch (e) {
				callback(e, null);
			}
		});
	}

	static _migrateBlocks(blocks) {
		if (!Array.isArray(blocks)) return blocks;
		return blocks.map((b) => {
			if (
				b &&
				b.type === "comment" &&
				typeof b.text === "string" &&
				b.text.trim().startsWith("➡️")
			) {
				const target = b.text.trim().replace(/^➡️\s*/, "");
				return {
					type: "move-to",
					target: LessonManager._unwrapFileTarget(target),
				};
			}
			if (b && b.type === "move-to" && typeof b.target === "string") {
				return { ...b, target: LessonManager._unwrapFileTarget(b.target) };
			}
			return b;
		});
	}

	static _unwrapFileTarget(target) {
		const fileName = LessonManager._moveToFileName(target);
		return fileName !== null ? fileName : target;
	}

	save(callback) {
		if (!this.currentFilePath) {
			callback(new Error("No file path set"));
			return;
		}

		const jsonData = JSON.stringify(this.data, null, 2);

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
		this.data = LessonManager.defaultBlocks();
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
			newBlock = {
				type,
				text:
					initialText !== null && initialText !== undefined
						? initialText
						: "",
			};
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

		this.data[index].text = text;
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

	getAllAnchorIds() {
		const seen = new Set();
		const out = [];
		const re = /⚓([^⚓]*)⚓/g;
		for (const block of this.data) {
			const sources = [];
			if (typeof block.text === "string") sources.push(block.text);
			if (typeof block.target === "string") sources.push(block.target);
			for (const src of sources) {
				let m;
				while ((m = re.exec(src)) !== null) {
					const id = m[1];
					if (id && !seen.has(id)) {
						seen.add(id);
						out.push(id);
					}
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
			const name = LessonManager._moveToFileName(block.target);
			if (name && !seen.has(name)) {
				seen.add(name);
				out.push(name);
			}
		}
		return out;
	}

	static _moveToFileName(target) {
		if (typeof target !== "string" || target === "MAIN" || target === "DEV") {
			return null;
		}
		const inner =
			target.startsWith("⚓") && target.endsWith("⚓")
				? target.slice(1, -1)
				: target;
		return /\.[a-z0-9]+$/i.test(inner) ? inner : null;
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

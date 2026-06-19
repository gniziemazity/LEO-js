"use strict";

class TextState {
	constructor() {
		this.reset();
	}

	reset() {
		this.text = "";
		this.cursor = 0;
		this.anchors = {};
		this.charTs = [];
		this.selAnchor = null;
		this._followingAnchor = null;
		this._anchorHadBackspace = false;
	}

	insert(ch, ts) {
		const pos = this.cursor;
		this.text = this.text.slice(0, pos) + ch + this.text.slice(pos);
		this.charTs.splice(pos, 0, ts);
		for (const name in this.anchors) {
			const p = this.anchors[name];
			if (
				p > pos ||
				(p === pos &&
					name === this._followingAnchor &&
					this._anchorHadBackspace)
			) {
				this.anchors[name]++;
			}
		}
		this.cursor++;
	}

	deleteBack(n = 1) {
		if (this.cursor < n) return;
		const start = this.cursor - n;
		if (
			this._followingAnchor !== null &&
			this.anchors[this._followingAnchor] === this.cursor
		) {
			this._anchorHadBackspace = true;
		}
		this.text = this.text.slice(0, start) + this.text.slice(this.cursor);
		this.charTs.splice(start, n);
		for (const name in this.anchors) {
			const p = this.anchors[name];
			if (p >= this.cursor) this.anchors[name] = p - n;
			else if (p > start) this.anchors[name] = start;
		}
		this.cursor = start;
	}

	deleteForward(n = 1) {
		if (this.cursor + n > this.text.length) return;
		const end = this.cursor + n;
		this.text = this.text.slice(0, this.cursor) + this.text.slice(end);
		this.charTs.splice(this.cursor, n);
		for (const name in this.anchors) {
			const p = this.anchors[name];
			if (p >= end) this.anchors[name] = p - n;
			else if (p > this.cursor) this.anchors[name] = this.cursor;
		}
	}

	deleteLine() {
		const ls = lineStartAt(this.text, this.cursor);
		const raw = this.text.indexOf("\n", this.cursor);
		const le = raw === -1 ? this.text.length : raw;
		const end = raw === -1 ? le : le + 1;
		const len = end - ls;
		this.text = this.text.slice(0, ls) + this.text.slice(end);
		this.charTs.splice(ls, len);
		for (const name in this.anchors) {
			const p = this.anchors[name];
			if (p >= end) this.anchors[name] = p - len;
			else if (p >= ls) this.anchors[name] = ls;
		}
		this.cursor = ls;
	}

	moveCursor(dir) {
		this._followingAnchor = null;
		this._anchorHadBackspace = false;
		if (dir === "linestart") {
			const ls = lineStartAt(this.text, this.cursor);
			const le = lineEndAt(this.text, ls);
			const indent =
				this.text.slice(ls, le).length -
				this.text.slice(ls, le).trimStart().length;
			this.cursor = ls + indent;
		} else if (dir === "lineend") {
			this.cursor = lineEndAt(this.text, this.cursor);
		} else {
			const [dl, dc] = dir;
			if (dl === 0) {
				this.cursor = Math.max(
					0,
					Math.min(this.text.length, this.cursor + dc),
				);
			} else {
				this.cursor = _moveByLines(this.text, this.cursor, dl);
			}
		}
		this.cursor = Math.max(0, Math.min(this.text.length, this.cursor));
	}

	setAnchor(name) {
		this.anchors[name] = this.cursor;
	}

	jumpToAnchor(name) {
		if (name in this.anchors) {
			this.cursor = this.anchors[name];
			this._followingAnchor = name;
			this._anchorHadBackspace = false;
			return true;
		}
		return false;
	}
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { TextState };
}

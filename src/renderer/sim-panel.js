const { replayMarked, fileColoredLines } = require("./anchor-snippet");
const { renderLines } = require("../shared/snippet-view");

const REGENERATE_DELAY_MS = 200;
const MIN_PANEL_W = 260;
const MIN_EDITOR_W = 420;
const WIDTH_KEY = "simPanelWidth";

function readStoredWidth() {
	try {
		const n = Number(localStorage.getItem(WIDTH_KEY));
		return Number.isFinite(n) && n > 0 ? n : null;
	} catch (_) {
		return null;
	}
}

function storeWidth(width) {
	try {
		localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
	} catch (_) {}
}

class SimPanel {
	constructor(lessonManager, focusOf = () => null) {
		this.lessonManager = lessonManager;
		this.focusOf = focusOf;
		this.visible = false;
		this.timer = null;
		this.version = 0;
		this.shownKey = null;
		this.files = [];
		this.marks = {};
		this.selected = null;
		this.focusIndex = null;
		this.width = null;
		this.scroller = null;
		this.tabsEl = null;
		this.codeEl = null;
	}

	attach(root, scroller = null) {
		this.scroller = scroller;
		this.tabsEl = root.querySelector(".sim-panel-tabs");
		this.codeEl = root.querySelector(".sim-panel-code");
		const resizer = root.querySelector(".sim-panel-resizer");
		if (resizer) this._attachResizer(resizer);
		this.width = readStoredWidth();
		window.addEventListener("resize", () => {
			if (this.visible && this.width) this.setWidth(this.width);
		});
	}

	_editorScroller(visible) {
		return visible ? this.scroller : document.scrollingElement;
	}

	setVisible(visible) {
		const was = this.visible;
		this.visible = !!visible;
		const from = this._editorScroller(was);
		const top = was !== this.visible && from ? from.scrollTop : null;
		document.body.classList.toggle("sim-panel-on", this.visible);
		const to = this._editorScroller(this.visible);
		if (top !== null && to) to.scrollTop = top;
		this._cancel();
		if (!this.visible) return;
		if (this.width) this.setWidth(this.width);
		this.shownKey = null;
		this.regenerate();
	}

	setWidth(px) {
		const max = Math.max(MIN_PANEL_W, window.innerWidth - MIN_EDITOR_W);
		const width = Math.round(Math.min(max, Math.max(MIN_PANEL_W, px)));
		this.width = width;
		document.documentElement.style.setProperty("--sim-panel-w", `${width}px`);
		return width;
	}

	_attachResizer(handle) {
		handle.addEventListener("pointerdown", (e) => {
			if (e.button !== 0) return;
			e.preventDefault();
			handle.setPointerCapture(e.pointerId);
			document.body.classList.add("sim-resizing");
			const move = (ev) => this.setWidth(window.innerWidth - ev.clientX);
			const end = () => {
				handle.removeEventListener("pointermove", move);
				handle.removeEventListener("pointerup", end);
				handle.removeEventListener("pointercancel", end);
				document.body.classList.remove("sim-resizing");
				if (this.width) storeWidth(this.width);
			};
			handle.addEventListener("pointermove", move);
			handle.addEventListener("pointerup", end);
			handle.addEventListener("pointercancel", end);
		});
	}

	changed() {
		this.version++;
		this.schedule();
	}

	schedule() {
		if (!this.visible) return;
		this._cancel();
		this.timer = setTimeout(() => {
			this.timer = null;
			this.regenerate();
		}, REGENERATE_DELAY_MS);
	}

	_cancel() {
		if (!this.timer) return;
		clearTimeout(this.timer);
		this.timer = null;
	}

	regenerate() {
		if (!this.visible || !this.codeEl) return;
		const focus = this.focusOf();
		const key = JSON.stringify([this.version, focus]);
		if (key === this.shownKey) return;
		this.shownKey = key;

		const view = replayMarked(this.lessonManager.getAllBlocks(), focus);
		const focusIndex = focus ? focus.index : null;
		const newBlock = focusIndex !== this.focusIndex;
		this.focusIndex = focusIndex;
		const shown = this.selected;
		this.files = view.files;
		this.marks = view.marks;
		const names = this.files.map((f) => f.name);
		if (newBlock && names.includes(view.marked)) {
			this.selected = view.marked;
		} else if (!names.includes(this.selected)) {
			this.selected = names.includes(view.active)
				? view.active
				: names[0] || null;
		}
		this._renderTabs();
		this._renderCode(this.selected === shown, newBlock);
	}

	select(name) {
		if (name === this.selected) return;
		this.selected = name;
		this._renderTabs();
		this._renderCode(false);
	}

	_renderTabs() {
		this.tabsEl.innerHTML = "";
		for (const file of this.files) {
			const tab = document.createElement("button");
			tab.type = "button";
			tab.className = "sim-panel-tab";
			if (file.name === this.selected) tab.classList.add("active");
			tab.textContent = file.label;
			tab.title = file.label;
			tab.addEventListener("click", () => this.select(file.name));
			this.tabsEl.appendChild(tab);
		}
	}

	_renderCode(keepScroll, revealMark = false) {
		const { scrollTop, scrollLeft } = this.codeEl;
		const file = this.files.find((f) => f.name === this.selected);
		if (!file) {
			this.codeEl.innerHTML = "";
			return;
		}
		renderLines(
			this.codeEl,
			file.text,
			fileColoredLines(file.name, file.text),
			this.marks[file.name],
		);
		this.codeEl.scrollTop = keepScroll ? scrollTop : 0;
		this.codeEl.scrollLeft = keepScroll ? scrollLeft : 0;
		const caret = this.codeEl.querySelector(".snippet-caret");
		this._reveal(
			caret || (revealMark && this.codeEl.querySelector(".snippet-mark")),
		);
	}

	_reveal(el) {
		if (!el || !el.getBoundingClientRect) return;
		const box = this.codeEl.getBoundingClientRect();
		const at = el.getBoundingClientRect();
		if (at.top < box.top || at.bottom > box.bottom) {
			this.codeEl.scrollTop += at.top - box.top - box.height / 2;
		}
		if (at.left < box.left || at.right > box.right) {
			this.codeEl.scrollLeft += at.left - box.left - box.width / 2;
		}
	}
}

module.exports = SimPanel;

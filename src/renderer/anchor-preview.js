const { extractAnchorSnippet } = require("./anchor-snippet");
const { renderSnippet } = require("../shared/snippet-view");
const { classifyMoveToTarget } = require("../shared/move-to-target");

const SHOW_DELAY_MS = 120;
const MARGIN = 8;
const MIN_STRIP_HEIGHT = 90;

class AnchorPreview {
	constructor(lessonManager, uiManager) {
		this.lessonManager = lessonManager;
		this.uiManager = uiManager;
		this.el = null;
		this.timer = null;
		this.target = null;
	}

	attach(container) {
		document.addEventListener("mouseover", (e) => this._onOver(e));
		document.addEventListener("mouseout", (e) => this._onOut(e));
		document.addEventListener("mousedown", () => this.hide(), true);
		if (container)
			container.addEventListener("scroll", () => this.hide(), true);
	}

	_hoverTarget(e) {
		const closest = e.target && e.target.closest;
		if (!closest) return null;

		const option = e.target.closest(".mt-option");
		if (option) {
			const list = option.closest(".mt-options");
			const idx = list ? Number(list.dataset.blockIndex) : NaN;
			if (!Number.isFinite(idx)) return null;
			return {
				el: option,
				list,
				value: option.dataset.value,
				blockIdx: idx,
			};
		}

		const block = e.target.closest(".block");
		if (block && block.dataset.target) {
			const idx = this._domBlockIndex(block);
			if (idx === null) return null;
			return {
				el: block,
				list: null,
				value: block.dataset.target,
				blockIdx: idx,
			};
		}
		return null;
	}

	_domBlockIndex(block) {
		const blocks = [...document.querySelectorAll(".block")];
		const idx = blocks.indexOf(block);
		return idx < 0 ? null : idx;
	}

	_onOver(e) {
		if (this.uiManager.isActive()) return;
		const hit = this._hoverTarget(e);
		if (!hit || classifyMoveToTarget(hit.value).mode !== "anchor") return;
		if (hit.el === this.target) return;
		this.hide();
		this.target = hit.el;
		this.timer = setTimeout(() => this._show(hit), SHOW_DELAY_MS);
	}

	_onOut(e) {
		const hit = this._hoverTarget(e);
		if (
			hit &&
			hit.el === this.target &&
			e.relatedTarget &&
			this.target.contains(e.relatedTarget)
		) {
			return;
		}
		this.hide();
	}

	_show(hit) {
		this.timer = null;
		const snippet = extractAnchorSnippet(
			hit.value,
			hit.blockIdx,
			this.lessonManager.getAllBlocks(),
			3,
			3,
		);
		if (!snippet) return;

		const el = this._element();
		if (!renderSnippet(el, snippet)) return;
		el.style.display = "block";
		this._place(hit.el, hit.list);
	}

	_element() {
		if (!this.el) {
			this.el = document.createElement("div");
			this.el.className = "anchor-preview";
			document.body.appendChild(this.el);
		}
		return this.el;
	}

	_place(hoverEl, listEl) {
		const el = this.el;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const a = hoverEl.getBoundingClientRect();
		el.style.maxHeight = "";

		if (!listEl) {
			el.style.maxWidth = `${vw - 2 * MARGIN}px`;
			const box = el.getBoundingClientRect();
			const above = a.top - box.height - MARGIN;
			this._at(above < MARGIN ? a.bottom + MARGIN : above, a.left, box);
			return;
		}

		const l = listEl.getBoundingClientRect();
		const rightRoom = vw - l.right - 2 * MARGIN;
		const leftRoom = l.left - 2 * MARGIN;

		el.style.maxWidth = `${vw - 2 * MARGIN}px`;
		const natural = el.getBoundingClientRect();
		if (natural.width <= rightRoom || natural.width <= leftRoom) {
			const useRight = natural.width <= rightRoom;
			el.style.maxWidth = `${useRight ? rightRoom : leftRoom}px`;
			const box = el.getBoundingClientRect();
			const left = useRight ? l.right + MARGIN : l.left - MARGIN - box.width;
			this._at(a.top, left, box);
			return;
		}

		const below = vh - l.bottom - 2 * MARGIN;
		const above = l.top - 2 * MARGIN;
		const goBelow = below >= above;
		el.style.maxHeight = `${Math.max(MIN_STRIP_HEIGHT, goBelow ? below : above)}px`;
		const box = el.getBoundingClientRect();
		this._at(
			goBelow ? l.bottom + MARGIN : l.top - MARGIN - box.height,
			l.left,
			box,
		);
	}

	_at(top, left, box) {
		const el = this.el;
		const maxTop = Math.max(MARGIN, window.innerHeight - box.height - MARGIN);
		const maxLeft = Math.max(MARGIN, window.innerWidth - box.width - MARGIN);
		el.style.top = `${Math.max(MARGIN, Math.min(top, maxTop))}px`;
		el.style.left = `${Math.max(MARGIN, Math.min(left, maxLeft))}px`;
	}

	hide() {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.target = null;
		if (this.el) this.el.style.display = "none";
	}
}

module.exports = AnchorPreview;

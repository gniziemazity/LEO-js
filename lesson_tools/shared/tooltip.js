"use strict";

class Tooltip {
	constructor({
		el = null,
		createId = null,
		inlineStyle = null,
		manageWhiteSpace = false,
		offset = { x: 14, y: -8 },
	} = {}) {
		this._el = el;
		this._createId = createId;
		this._inlineStyle = inlineStyle;
		this._manageWhiteSpace = manageWhiteSpace;
		this._offset = offset;
	}
	_ensure() {
		if (this._el && document.body.contains(this._el)) return this._el;
		if (this._createId) {
			let e = document.getElementById(this._createId);
			if (!e) {
				e = document.createElement("div");
				e.id = this._createId;
				if (this._inlineStyle) e.style.cssText = this._inlineStyle;
				document.body.appendChild(e);
			}
			this._el = e;
		}
		return this._el;
	}
	show(e, content, { html = false, noWrap = false } = {}) {
		const el = this._ensure();
		if (!el) return;
		if (html) el.innerHTML = content;
		else el.textContent = content;
		if (this._manageWhiteSpace)
			el.style.whiteSpace = !html && noWrap ? "pre" : "pre-wrap";
		el.style.display = "block";
		this.move(e);
	}
	move(e) {
		const el = this._el;
		if (!el) return;
		const tw = el.offsetWidth;
		const th = el.offsetHeight;
		const off = this._offset;
		let tx = e.clientX + off.x;
		let ty = e.clientY + off.y;
		if (tx + tw > window.innerWidth - 8) tx = e.clientX - tw - off.x;
		if (ty + th > window.innerHeight - 8) ty = e.clientY - th - 8;
		el.style.left = tx + "px";
		el.style.top = ty + "px";
	}
	hide() {
		if (this._el) this._el.style.display = "none";
	}
	attachText(target, text, { noWrap = false } = {}) {
		target.addEventListener("mouseenter", (e) =>
			this.show(e, text, { noWrap }),
		);
		target.addEventListener("mousemove", (e) => this.move(e));
		target.addEventListener("mouseleave", () => this.hide());
	}
	attachHtml(target, htmlOrFn) {
		const get = typeof htmlOrFn === "function" ? htmlOrFn : () => htmlOrFn;
		target.addEventListener("mouseenter", (e) => {
			const html = get();
			if (!html) return;
			this.show(e, html, { html: true });
		});
		target.addEventListener("mousemove", (e) => this.move(e));
		target.addEventListener("mouseleave", () => this.hide());
	}
}

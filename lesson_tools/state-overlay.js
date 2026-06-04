"use strict";

class StateOverlay {
	constructor({ emptyEl, contentEls = {} } = {}) {
		this._emptyEl = emptyEl;
		this._contentEls = new Map();
		for (const [name, config] of Object.entries(contentEls)) {
			if (!config) continue;
			if (config instanceof HTMLElement) {
				this._contentEls.set(name, { el: config, display: "" });
			} else {
				this._contentEls.set(name, {
					el: config.el,
					display: config.display || "",
				});
			}
		}
	}

	showContent(name) {
		if (this._emptyEl) this._emptyEl.style.display = "none";
		for (const [n, { el, display }] of this._contentEls) {
			if (!el) continue;
			el.style.display = n === name ? display || "flex" : "none";
		}
	}

	showMessage(msg) {
		if (this._emptyEl) {
			this._emptyEl.textContent = msg;
			this._emptyEl.style.display = "flex";
		}
		for (const { el } of this._contentEls.values()) {
			if (el) el.style.display = "none";
		}
	}

	showLoading(msg = "Loading…") {
		this.showMessage(msg);
	}

	showError(msg) {
		this.showMessage(msg);
	}
}

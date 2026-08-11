"use strict";

class KvList {
	constructor() {
		this.rows = [];
	}
	add(label, valueHtml) {
		this.rows.push([label, valueHtml]);
		return this;
	}
	addAll(pairs) {
		for (const [k, v] of pairs) this.add(k, v);
		return this;
	}
	html() {
		return this.rows
			.map(
				([k, v]) =>
					`<div class="kv-row"><span>${escHtml(k)}</span><span>${v}</span></div>`,
			)
			.join("");
	}
}

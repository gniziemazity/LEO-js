"use strict";

class StatTable {
	constructor(headers = null) {
		this.headers = headers;
		this.rows = [];
	}
	row(cells) {
		this.rows.push(cells);
		return this;
	}
	html() {
		const head = this.headers
			? `<tr>${this.headers.map((h) => `<th>${escHtml(h)}</th>`).join("")}</tr>`
			: "";
		const body = this.rows
			.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
			.join("");
		return `<table class="st-tbl">${head}${body}</table>`;
	}
}

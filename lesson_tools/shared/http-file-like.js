"use strict";

class HttpFileLike {
	constructor(url, name) {
		this.url = url;
		this.name = name;
	}
	async text() {
		const r = await fetch(this.url);
		if (!r.ok) throw new Error(`Fetch ${this.url} failed: ${r.status}`);
		return r.text();
	}
	async arrayBuffer() {
		const r = await fetch(this.url);
		if (!r.ok) throw new Error(`Fetch ${this.url} failed: ${r.status}`);
		return r.arrayBuffer();
	}
}

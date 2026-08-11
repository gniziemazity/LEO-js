"use strict";

class Seekbar {
	constructor(vis, barEl, fillEl) {
		this.vis = vis;
		this.el = barEl;
		this.fill = fillEl;
		this.seeking = false;
		this._wasPlaying = false;
		this._dragFrac = 0;
		this._dragTimer = null;
		this.el.addEventListener("pointerdown", (e) => {
			this.el.setPointerCapture(e.pointerId);
			this._onPress(e);
		});
		document.addEventListener("pointermove", (e) => this._onDrag(e));
		document.addEventListener("pointerup", (e) => this._onRelease(e));
		document.addEventListener("pointercancel", (e) => this._onRelease(e));
	}
	renderSkips() {
		const vis = this.vis;
		if (!this.el) return;
		for (const el of this.el.querySelectorAll(".seek-skip")) el.remove();
		if (!vis.elSkipPauses || !vis.elSkipPauses.checked || !vis._totalDelay)
			return;
		const frag = document.createDocumentFragment();
		for (const r of vis._skipRegions) {
			const seg = document.createElement("div");
			seg.className = "seek-skip";
			seg.style.left = `${(r.start / vis._totalDelay) * 100}%`;
			seg.style.width = `${((r.end - r.start) / vis._totalDelay) * 100}%`;
			frag.appendChild(seg);
		}
		this.el.appendChild(frag);
	}
	drawFrac(frac) {
		this.fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
	}
	_onPress(e) {
		const vis = this.vis;
		if (!vis.micro.length) return;
		this.seeking = true;
		this._wasPlaying = vis.playing;
		if (vis.playing) vis._pause();
		const frac = e.offsetX / this.el.offsetWidth;
		vis._playMs = frac * vis._totalDelay;
		this.drawFrac(frac);
		if (vis._tsOrigin) vis._paintHud();
	}
	_onDrag(e) {
		const vis = this.vis;
		if (!this.seeking) return;
		const rect = this.el.getBoundingClientRect();
		const frac = Math.max(
			0,
			Math.min(1, (e.clientX - rect.left) / rect.width),
		);
		this._dragFrac = frac;
		vis._playMs = frac * vis._totalDelay;
		this.drawFrac(frac);
		if (vis._tsOrigin) vis._paintHud();
		if (!this._dragTimer)
			this._dragTimer = setTimeout(() => {
				this._dragTimer = null;
				if (this.seeking) vis._seekToMs(this._dragFrac * vis._totalDelay);
			}, 150);
	}
	_onRelease(e) {
		const vis = this.vis;
		if (!this.seeking) return;
		if (this._dragTimer) {
			clearTimeout(this._dragTimer);
			this._dragTimer = null;
		}
		this.seeking = false;
		let frac;
		if (e.type === "pointercancel") {
			frac = this._dragFrac;
		} else {
			const rect = this.el.getBoundingClientRect();
			frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		}
		vis._seekToMs(frac * vis._totalDelay);
		if (this._wasPlaying) vis._play();
	}
}

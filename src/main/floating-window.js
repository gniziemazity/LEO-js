class FloatingWindow {
	constructor({
		make,
		channel,
		onClosed,
		onShow,
		broadcastServer,
		floatRect,
		trackWindowRect,
	}) {
		this.win = null;
		this.rect = null;
		this.pinned = false;
		this.closePending = false;
		this._closing = false;
		this._fadeTimer = null;
		this._make = make;
		this._channel = channel;
		this._onClosed = onClosed || (() => {});
		this._onShow = onShow || (() => {});
		this._broadcastServer = broadcastServer;
		this._floatRect = floatRect;
		this._trackWindowRect = trackWindowRect;
	}

	isAlive() {
		return !!(this.win && !this.win.isDestroyed() && !this._closing);
	}

	get activeWin() {
		return this.isAlive() ? this.win : null;
	}

	showOrReuse(payload, { shouldPin, gatePin } = {}) {
		this.closePending = false;
		if (this._fadeTimer) {
			clearTimeout(this._fadeTimer);
			this._fadeTimer = null;
		}
		if (this.isAlive()) {
			if (gatePin && this.pinned) return;
			this._broadcastServer.broadcastFloatingWindowReshown();
			this.win.webContents.send(this._channel, payload);
			this.win.show();
			this.win.focus();
			if (gatePin && shouldPin) this.pinned = true;
			this._onShow(this);
			return;
		}
		if (gatePin) this.pinned = shouldPin || false;
		const win = this._make();
		this.win = win;

		// clicking a floating window makes it the one the remote drags and resizes.
		win.on("focus", () => {
			if (this.win === win && !win.isDestroyed()) this._onShow(this);
		});
		this._closing = false;
		this.rect = this._floatRect(win);
		this._onShow(this);
		win.webContents.on("did-finish-load", () => {
			if (!win.isDestroyed()) win.webContents.send(this._channel, payload);
		});
		win.on("closed", () => {
			if (this._fadeTimer) {
				clearTimeout(this._fadeTimer);
				this._fadeTimer = null;
			}
			const isCurrent = this.win === win;
			if (isCurrent) this._onClosed(this);
			this._broadcastServer.broadcastFloatingWindowClosed();
			if (!isCurrent) return;
			this.win = null;
			this.rect = null;
			this.pinned = false;
			this.closePending = false;
			this._closing = false;
		});
		this._trackWindowRect(win, () => this.rect);
	}

	setPinned(value) {
		this.pinned = !!value;
		if (!this.pinned && this.closePending) {
			this.closePending = false;
			this.close();
		}
	}

	close({ force } = {}) {
		if (!force && this.pinned) {
			this.closePending = true;
			return;
		}
		if (this.isAlive()) {
			this._closing = true;
			this.win.close();
		}
	}

	fadeOutAndClose(ms = 300) {
		if (!this.isAlive()) return false;
		const win = this.win;
		win.webContents.send("fade-out");
		this._fadeTimer = setTimeout(() => {
			this._fadeTimer = null;
			if (win && !win.isDestroyed()) win.close();
		}, ms);
		return true;
	}
}

module.exports = FloatingWindow;

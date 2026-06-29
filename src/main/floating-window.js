class FloatingWindow {
	constructor({
		make,
		channel,
		sync,
		getPinned,
		onCreate,
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
		this._fadeTimer = null;
		this._make = make;
		this._channel = channel;
		this._sync = sync || (() => {});
		this._getPinned = getPinned || (() => this.pinned);
		this._onCreate = onCreate || (() => {});
		this._onClosed = onClosed || (() => {});
		this._onShow = onShow || (() => {});
		this._broadcastServer = broadcastServer;
		this._floatRect = floatRect;
		this._trackWindowRect = trackWindowRect;
	}

	isAlive() {
		return !!(this.win && !this.win.isDestroyed());
	}

	showOrReuse(payload, { shouldPin, gatePin } = {}) {
		this.closePending = false;
		if (this._fadeTimer) {
			clearTimeout(this._fadeTimer);
			this._fadeTimer = null;
		}
		if (this.isAlive()) {
			if (gatePin && this._getPinned()) return;
			this._broadcastServer.signalFloatingWindowOpen();
			this.win.webContents.send(this._channel, payload);
			this.win.show();
			this.win.focus();
			if (gatePin && shouldPin) {
				this.pinned = true;
				this._sync(this);
			}
			this._onShow(this);
			return;
		}
		if (gatePin) this.pinned = shouldPin || false;
		const win = this._make();
		this.win = win;
		this.rect = this._floatRect(win);
		this._sync(this);
		this._onCreate(this);
		this._onShow(this);
		win.webContents.on("did-finish-load", () => {
			if (!win.isDestroyed()) win.webContents.send(this._channel, payload);
		});
		win.on("closed", () => {
			if (this._fadeTimer) {
				clearTimeout(this._fadeTimer);
				this._fadeTimer = null;
			}
			this._onClosed(this);
			this._broadcastServer.broadcastFloatingWindowClosed();
			this.win = null;
			this.rect = null;
			this.pinned = false;
			this.closePending = false;
			this._sync(this);
		});
		this._trackWindowRect(win, () => this.rect);
	}

	setPinned(value) {
		this.pinned = !!value;
		this._sync(this);
		if (!this.pinned && this.closePending) {
			this.closePending = false;
			this.close();
		}
	}

	close({ force } = {}) {
		if (!force && this._getPinned()) {
			this.closePending = true;
			return;
		}
		if (this.isAlive()) {
			this.win.close();
			this.win = null;
			this._sync(this);
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

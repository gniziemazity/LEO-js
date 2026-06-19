class FloatingWindow {
	constructor({
		make,
		channel,
		sync,
		getPinned,
		onCreate,
		onClosed,
		broadcastServer,
		floatRect,
		trackWindowRect,
	}) {
		this.win = null;
		this.rect = null;
		this.pinned = false;
		this._make = make;
		this._channel = channel;
		this._sync = sync || (() => {});
		this._getPinned = getPinned || (() => this.pinned);
		this._onCreate = onCreate || (() => {});
		this._onClosed = onClosed || (() => {});
		this._broadcastServer = broadcastServer;
		this._floatRect = floatRect;
		this._trackWindowRect = trackWindowRect;
	}

	isAlive() {
		return !!(this.win && !this.win.isDestroyed());
	}

	showOrReuse(payload, { shouldPin, gatePin } = {}) {
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
			return;
		}
		if (gatePin) this.pinned = shouldPin || false;
		const win = this._make();
		this.win = win;
		this.rect = this._floatRect(win);
		this._sync(this);
		this._onCreate(this);
		win.webContents.on("did-finish-load", () => {
			if (!win.isDestroyed()) win.webContents.send(this._channel, payload);
		});
		win.on("closed", () => {
			this._onClosed(this);
			this._broadcastServer.broadcastFloatingWindowClosed();
			this.win = null;
			this.rect = null;
			this.pinned = false;
			this._sync(this);
		});
		this._trackWindowRect(win, () => this.rect);
	}

	close({ force } = {}) {
		if (!force && this._getPinned()) return;
		if (this.isAlive()) {
			this.win.close();
			this.win = null;
			this._sync(this);
		}
	}
}

module.exports = FloatingWindow;

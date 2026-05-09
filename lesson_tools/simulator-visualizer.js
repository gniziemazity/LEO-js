"use strict";

// LogVisualizer: orchestrates playback, action handling, VS Code auto-features,
// preview iframe, event log, seekbar, and settings modal.

class LogVisualizer {
	constructor() {
		this.micro = [];
		this.microIdx = 0;
		this.playing = false;
		this.timerId = null;
		this.speed = 8.0;
		this._silent = false;

		this._imageUris = {};
		this.main = new TextState();
		this.dev = new TextState();
		this._files = { MAIN: this.main };
		this._activeFilename = "MAIN";
		this._activeEditor = "main";
		this._lessonFile = null;
		this._ciBaseIndent = "";
		this._anchorFlashTimer = null;

		this._logBuf = [];
		this._microCumDelay = null;
		this._totalDelay = 0;

		this._seeking = false;
		this._seekWasPlaying = false;
		this._dragFrac = 0;
		this._dragTimer = null;

		this._stepStartWall = 0;
		this._stepDurS = 0.001;
		this._seekbarRaf = null;

		this.vscode = new VSCodeSettings();
		this._selAnchorMain = null;

		this._previewDirty = false;
		this._previewRafId = null;

		this._buildUI();
	}

	_buildUI() {
		const root = document.getElementById("vis-root");
		root.innerHTML = `
        <div id="vis-left">
          <div id="vis-toolbar" class="app-toolbar">
            <button id="btn-play" disabled>▶  Play</button>
            <div class="sep"></div>
            <button id="btn-toggle-log" title="Toggle event log">📋</button>
            <button id="btn-toggle-devtools" title="Toggle dev tools">🔧</button>
            <div class="sep"></div>
            <label>Speed: <input id="speed-slider" type="range" min="1" max="60" value="8" step="0.5"></label>
            <span id="speed-label">8×</span>
            <div class="sep"></div>
            <label><input id="chk-autoscroll" type="checkbox" checked> Auto-scroll</label>
            <span id="ts-label" style="margin-left:auto;color:${CLR.accent};font-family:Consolas,monospace;font-size:11px;line-height:1"></span>
            <span id="prog-label" style="margin-left:12px;color:${CLR.muted};font-family:Consolas,monospace;font-size:11px;line-height:1">No file loaded</span>
          </div>
          <div id="vis-seekbar"><div id="vis-seekfill"></div></div>
          <div id="vis-main">
            <div id="vis-editor-wrap">
              <div id="vis-file-tabs"></div>
              <pre id="vis-editor"></pre>
            </div>
            <div id="vis-event-log-wrap">
              <div class="pane-title">Event Log</div>
              <div id="vis-event-log"></div>
            </div>
          </div>
        </div>
        <div id="vis-divider" title="Drag to resize"></div>
        <div id="vis-right">
          <div id="vis-right-main">
            <iframe id="vis-preview" sandbox="allow-scripts allow-same-origin"></iframe>
            <div id="vis-dev-divider" title="Drag to resize"></div>
            <div id="vis-dev-outer">
              <div class="pane-title">DevTools</div>
              <pre id="vis-dev-editor"></pre>
            </div>
          </div>
        </div>
        `;

		this.elPlay = document.getElementById("btn-play");
		this.elSpeed = document.getElementById("speed-slider");
		this.elSpeedLbl = document.getElementById("speed-label");
		this.elAutoScroll = document.getElementById("chk-autoscroll");
		this.elTsLbl = document.getElementById("ts-label");
		this.elProgLbl = document.getElementById("prog-label");
		this.elSeekbar = document.getElementById("vis-seekbar");
		this.elSeekFill = document.getElementById("vis-seekfill");
		this.elFileTabs = document.getElementById("vis-file-tabs");
		this.elEditor = document.getElementById("vis-editor");
		this.elDevEditor = document.getElementById("vis-dev-editor");
		this.elDevOuter = document.getElementById("vis-dev-outer");
		this.elEventLog = document.getElementById("vis-event-log");
		this.elEventLogWrap = document.getElementById("vis-event-log-wrap");
		this.elPreview = document.getElementById("vis-preview");
		this.elBtnLog = document.getElementById("btn-toggle-log");
		this.elBtnDev = document.getElementById("btn-toggle-devtools");

		const logOn = localStorage.getItem("sim-event-log") === "on";
		const devOn = localStorage.getItem("sim-devtools") !== "off";
		this._setEventLogVisible(logOn);
		this._setDevPanelVisible(devOn);

		this.elPlay.onclick = () => this.togglePlay();
		this.elBtnLog.onclick = () => {
			const next = this.elEventLogWrap.style.display === "none";
			this._setEventLogVisible(next);
			localStorage.setItem("sim-event-log", next ? "on" : "off");
		};
		this.elBtnDev.onclick = () => {
			const next = !this._devExpanded;
			this._setDevPanelVisible(next);
			localStorage.setItem("sim-devtools", next ? "on" : "off");
		};

		this.elSpeed.addEventListener("input", () => {
			this.speed = parseFloat(this.elSpeed.value);
			this.elSpeedLbl.textContent = `${this.speed.toFixed(0)}×`;
		});

		this.elSeekbar.addEventListener("pointerdown", (e) => {
			this.elSeekbar.setPointerCapture(e.pointerId);
			this._onSeekPress(e);
		});
		document.addEventListener("pointermove", (e) => this._onSeekDrag(e));
		document.addEventListener("pointerup", (e) => this._onSeekRelease(e));
		document.addEventListener("pointercancel", (e) => this._onSeekRelease(e));

		this._initHoverTooltip();
		this._installDragDivider({
			dividerId: "vis-divider",
			targetId: "vis-right",
			containerId: "vis-root",
			storageKey: "sim-right-pct",
			axis: "x",
		});
		this._installDragDivider({
			dividerId: "vis-dev-divider",
			targetId: "vis-dev-outer",
			containerId: "vis-right-main",
			storageKey: "sim-dev-pct",
			axis: "y",
		});
	}

	_installDragDivider({ dividerId, targetId, containerId, storageKey, axis }) {
		const divider = document.getElementById(dividerId);
		const target = document.getElementById(targetId);
		const container = document.getElementById(containerId);
		if (!divider || !target || !container) return;

		const stored = parseFloat(localStorage.getItem(storageKey));
		if (Number.isFinite(stored) && stored > 5 && stored < 95) {
			target.style.flex = `0 0 ${stored}%`;
		}

		const cursor = axis === "x" ? "col-resize" : "row-resize";
		let dragging = false;
		divider.addEventListener("pointerdown", (e) => {
			dragging = true;
			divider.setPointerCapture(e.pointerId);
			document.body.style.cursor = cursor;
			document.body.style.userSelect = "none";
			e.preventDefault();
		});
		divider.addEventListener("pointermove", (e) => {
			if (!dragging) return;
			const r = container.getBoundingClientRect();
			const pct =
				axis === "x"
					? ((r.right - e.clientX) / r.width) * 100
					: ((r.bottom - e.clientY) / r.height) * 100;
			const clamped = Math.max(10, Math.min(80, pct));
			target.style.flex = `0 0 ${clamped}%`;
		});
		const stop = (e) => {
			if (!dragging) return;
			dragging = false;
			try {
				divider.releasePointerCapture(e.pointerId);
			} catch {}
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			const m = target.style.flex.match(/0 0 ([\d.]+)%/);
			if (m) localStorage.setItem(storageKey, m[1]);
		};
		divider.addEventListener("pointerup", stop);
		divider.addEventListener("pointercancel", stop);
	}

	_setEventLogVisible(on) {
		this.elEventLogWrap.style.display = on ? "" : "none";
		if (this.elBtnLog) this.elBtnLog.classList.toggle("is-toggle-on", on);
	}

	_setDevPanelVisible(on) {
		this._devExpanded = !!on;
		this.elDevOuter.style.display = on ? "" : "none";
		if (this.elBtnDev) this.elBtnDev.classList.toggle("is-toggle-on", on);
	}

	loadFile({ filePath, micro, error, imageUris, lessonFile }) {
		if (error) {
			console.error("expand error:\n" + error);
			return;
		}

		this.vscode = new VSCodeSettings();
		this._imageUris = imageUris || {};
		this._lessonFile = lessonFile || null;

		this.micro = micro;

		this._tsOrigin = 0;
		for (const act of micro) {
			const ts = act[2];
			if (ts && ts > 1_000_000_000_000) {
				this._tsOrigin = ts;
				break;
			}
		}

		this._microCumDelay = new Float64Array(micro.length + 1);
		let cumD = 0;
		for (let i = 0; i < micro.length; i++) {
			this._microCumDelay[i] = cumD;
			const act = micro[i];
			let d;
			switch (act[0]) {
				case "code_insert_begin":
				case "code_insert_end":
					d = act[2];
					break;
				default:
					d = act[3] !== undefined ? act[3] : DELAY_OPS;
					break;
			}
			cumD += Math.max(1, d);
		}
		this._microCumDelay[micro.length] = cumD;
		this._totalDelay = cumD;

		this._seekTo(this.micro.length);
		this.elPlay.disabled = false;
	}

	togglePlay() {
		if (this.playing) this._pause();
		else {
			if (this.microIdx >= this.micro.length && this.micro.length)
				this._seekTo(0);
			this._play();
		}
	}

	_play() {
		this.playing = true;
		this.elPlay.textContent = "⏸  Pause";
		this.elPlay.style.background = CLR.red;
		this._stepStartWall = performance.now();
		this._stepDurS = 0.001;
		this._scheduleSeekbarUpdate();
		this._schedule(0);
	}

	_pause() {
		this.playing = false;
		if (this.timerId) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}
		if (this._seekbarRaf) {
			cancelAnimationFrame(this._seekbarRaf);
			this._seekbarRaf = null;
		}
		this.elPlay.textContent = "▶  Play";
		this.elPlay.style.background = "";
	}

	_resetAllFiles() {
		for (const st of Object.values(this._files)) st.reset();
		this._files = { MAIN: this._files["MAIN"] };
		this.main = this._files["MAIN"];
		this._activeFilename = "MAIN";
		this._updateFileTabs();
	}

	_schedule(delayMs) {
		if (this.playing)
			this.timerId = setTimeout(() => this._step(), Math.max(1, delayMs));
	}

	_step() {
		if (!this.playing) return;
		if (this.microIdx >= this.micro.length) {
			this.playing = false;
			this.elPlay.textContent = "▶  Play";
			this.elPlay.style.background = "";
			this._renderEditors();
			this._schedulePreview();
			return;
		}
		const act = this.micro[this.microIdx++];
		const delayBase = this._handle(act);
		this._renderEditors();
		this._schedulePreview();
		this._updateProgress();
		const delayMs = Math.max(
			1,
			Math.round(delayBase / Math.max(0.1, this.speed)),
		);
		this._stepStartWall = performance.now();
		this._stepDurS = delayMs / 1000;
		this._schedule(delayMs);
	}

	_handle(act) {
		const kind = act[0];

		if (kind === "switch_editor") {
			const [, target, , delay] = act;
			const label = target === "dev" ? "DevTools" : "Main Editor";
			this._log(act[2], `⇄  switch to ${label}`, CLR.move);
			this._activeEditor = target;
			if (target === "main") this._switchToFile("MAIN");

			return delay;
		} else if (kind === "char") {
			const [, ch, ts, delay, editor] = act;
			return this._handleChar(ch, ts, delay, editor);
		} else if (kind === "code_insert_begin") {
			const lineStart =
				this.main.text.lastIndexOf("\n", this.main.cursor - 1) + 1;
			const m = this.main.text
				.slice(lineStart, this.main.cursor)
				.match(/^(\s*)/);
			this._ciBaseIndent = m ? m[1] : "";
			return act[2];
		} else if (kind === "code_insert_end") {
			this._ciBaseIndent = "";
			return act[2];
		} else if (kind === "code_char") {
			const [, ch, ts, delay, editor] = act;
			const st = editor === "dev" ? this.dev : this.main;
			if (editor === "main") this._autoDedent(ch, ts);
			st.insert(ch, ts);
			return delay;
		} else if (kind === "log_code_insert") {
			const clean = act[1].replace(ANCHOR_RE, "");
			this._log(
				act[2],
				`⬇  code_insert: ${JSON.stringify(clean.slice(0, 50))}`,
				CLR.orange,
			);
			return act[3];
		} else if (kind === "set_anchor") {
			const [, name, ts, delay] = act;
			this.main.setAnchor(name);
			this._log(ts, `⚓  anchor ${name} → ${this.main.cursor}`, CLR.accent);
			return delay;
		} else if (kind === "move_anchor") {
			const [, name, ts, delay] = act;
			const ok = this.main.jumpToAnchor(name);
			if (ok) {
				this._log(
					ts,
					`→  move to ${name} (pos ${this.main.cursor})`,
					CLR.move,
				);
				this._flashAnchor();
			} else {
				this._log(ts, `⚠  unknown anchor: ${name}`, CLR.red);
			}
			return delay;
		} else if (kind === "switch_file") {
			const [, filename, ts, delay] = act;
			this._switchToFile(filename);
			this._log(ts, `⇄  switch to file: ${filename}`, CLR.move);
			return delay;
		} else if (kind === "code_insert_newline") {
			const [, ts, delay, editor] = act;
			const st = editor === "dev" ? this.dev : this.main;
			st.insert("\n", ts);
			if (editor === "main") {
				this._autoIndent(ts);
				const lineStart =
					this.main.text.lastIndexOf("\n", this.main.cursor - 1) + 1;
				const m = this.main.text
					.slice(lineStart, this.main.cursor)
					.match(/^(\s*)/);
				this._ciBaseIndent = m ? m[1] : "";
			}
			this._log(ts, "↩  Insert Newline (in code_insert)", CLR.orange);
			return delay;
		} else if (kind === "code_cursor_move") {
			const [, ch, ts, delay, editor] = act;
			const st = editor === "dev" ? this.dev : this.main;
			if (ch in CURSOR_MOVES) {
				st.moveCursor(CURSOR_MOVES[ch]);
			}
			if (editor === "main") {
				const lineStart =
					this.main.text.lastIndexOf("\n", this.main.cursor - 1) + 1;
				const m = this.main.text
					.slice(lineStart, this.main.cursor)
					.match(/^(\s*)/);
				this._ciBaseIndent = m ? m[1] : "";
			}
			this._log(ts, `  ${ch} (in code_insert)`, CLR.orange);
			return delay;
		} else if (kind === "code_backspace") {
			const [, ts, delay, editor] = act;
			const st = editor === "dev" ? this.dev : this.main;
			if (this._backspaceIsIgnored(st)) {
				this._log(
					ts,
					"⌫  Backspace (ignored — in code_insert)",
					CLR.pale_red,
				);
			} else {
				st.deleteBack(1);
				this._log(ts, "⌫  Backspace (in code_insert)", CLR.red);
			}
			return delay;
		} else if (kind === "code_fwd_delete") {
			const [, ts, delay, editor] = act;
			const st = editor === "dev" ? this.dev : this.main;
			st.deleteForward(1);
			this._log(ts, "⌦  Delete (in code_insert)", CLR.red);
			return delay;
		} else if (kind === "code_delete_line") {
			const [, ts, delay, editor] = act;
			const st = editor === "dev" ? this.dev : this.main;
			st.deleteLine();
			this._log(ts, "⛔  Delete Line (in code_insert)", CLR.red);
			return delay;
		} else if (kind === "code_insert_atomic") {
			return this._handleCodeInsertAtomic(act);
		}

		return DELAY_OPS;
	}

	_handleChar(ch, ts, delay, editor) {
		const st = editor === "dev" ? this.dev : this.main;

		if (ch in CURSOR_MOVES) {
			this.main.moveCursor(CURSOR_MOVES[ch]);
			this._selAnchorMain = null;
			this._log(ts, `⌨  ${ch}`, CLR.blue);
			return delay;
		}
		if (ch in SHIFT_CURSOR_MOVES) {
			if (this._selAnchorMain === null)
				this._selAnchorMain = this.main.cursor;
			this.main.moveCursor(SHIFT_CURSOR_MOVES[ch]);
			this._log(ts, `⌨  ${ch} (select)`, CLR.blue);
			return delay;
		}

		if (ch in CHAR_REPLACEMENTS) {
			const real = CHAR_REPLACEMENTS[ch];
			if (
				real === "\t" &&
				editor === "main" &&
				this._selAnchorMain !== null
			) {
				this._indentSelection(ts);
				this._log(ts, "⇥ Tab (indent selection)", CLR.blue);
				return delay;
			}
			st.insert(real, ts);
			if (real === "\n" && editor === "main") this._autoIndent(ts);
			this._log(ts, `⌨  ${real === "\n" ? "↩ Enter" : "⇥ Tab"}`, CLR.blue);
			return delay;
		}

		if (ch === "⌫" || ch === "↢") {
			if (this._backspaceIsIgnored(st)) {
				this._log(
					ts,
					"⌫  Backspace (ignored — before closing tag)",
					CLR.pale_red,
				);
				return delay;
			}
			st.deleteBack(1);
			this._log(ts, "⌫  Backspace", CLR.red);
			return delay;
		}

		if (ch === DELETE_FWRD_CHAR) {
			st.deleteForward(1);
			this._log(ts, "⌦  Delete (forward)", CLR.blue);
			return delay;
		}

		if (ch === DELETE_LINE_CHAR) {
			st.deleteLine();
			this._log(ts, "⛔  Delete Line (Ctrl+Shift+K)", CLR.blue);
			return delay;
		}

		if (ch === PAUSE_CHAR) {
			this._log(ts, "🕛  pause 500 ms", CLR.dim);
			return PAUSE_MS;
		}

		if (IGNORED_CHARS.has(ch)) return DELAY_OPS;

		if (ch === ";" && editor === "dev") {
			st.insert(ch, ts);
			this._devSemicolonNewline(ts);
			this._log(ts, `⌨  ${JSON.stringify(ch)}`, CLR.dim);
			return delay;
		}

		if (editor === "main") this._autoDedent(ch, ts);
		st.insert(ch, ts);
		if (editor === "main") this._applyVscodeAuto(ch, ts);

		this._log(ts, `⌨  ${JSON.stringify(ch)}`, CLR.dim);
		return delay;
	}

	_handleCodeInsertAtomic(act) {
		const [, code, ts, delay, editor] = act;
		const clean = code.replace(ANCHOR_RE, "");
		this._log(
			ts,
			`⬇  code_insert: ${JSON.stringify(clean.slice(0, 50))}`,
			CLR.orange,
		);

		const lineStart =
			this.main.text.lastIndexOf("\n", this.main.cursor - 1) + 1;
		const m = this.main.text
			.slice(lineStart, this.main.cursor)
			.match(/^(\s*)/);
		this._ciBaseIndent = m ? m[1] : "";

		const segments = _splitCodeWithAnchors(code);
		for (const [segKind, segVal] of segments) {
			if (segKind === "text") {
				for (const ch of segVal) {
					const st = editor === "dev" ? this.dev : this.main;
					if (ch === DELETE_LINE_CHAR) {
						st.deleteLine();
					} else if (
						Object.prototype.hasOwnProperty.call(CURSOR_MOVES, ch)
					) {
						st.moveCursor(CURSOR_MOVES[ch]);
						if (editor === "main") {
							const ls =
								this.main.text.lastIndexOf("\n", this.main.cursor - 1) +
								1;
							const mc = this.main.text
								.slice(ls, this.main.cursor)
								.match(/^(\s*)/);
							this._ciBaseIndent = mc ? mc[1] : "";
						}
					} else if (ch === "↩" || ch === "\n") {
						st.insert("\n", ts);
						if (editor === "main") {
							this._autoIndent(ts);
							const ls =
								this.main.text.lastIndexOf("\n", this.main.cursor - 1) +
								1;
							const mc = this.main.text
								.slice(ls, this.main.cursor)
								.match(/^(\s*)/);
							this._ciBaseIndent = mc ? mc[1] : "";
						}
					} else if (ch === "―" || ch === "\t") {
						st.insert("\t", ts);
					} else if (_EXPAND_BACKSPACE.has(ch)) {
						if (!this._backspaceIsIgnored(st)) st.deleteBack(1);
					} else if (_EXPAND_FWD_DEL.has(ch)) {
						st.deleteForward(1);
					} else {
						if (editor === "main") this._autoDedent(ch, ts);
						st.insert(ch, ts);
					}
				}
			} else {
				this.main.setAnchor(segVal);
			}
		}

		this._ciBaseIndent = "";
		return delay;
	}

	_applyVscodeAuto(ch, ts) {
		const textBefore = this.main.text.slice(0, this.main.cursor);
		const textAfter = this.main.text.slice(this.main.cursor);
		const lineEnd = textAfter.indexOf("\n");
		const afterLine =
			lineEnd === -1 ? textAfter : textAfter.slice(0, lineEnd);

		let auto = this.vscode.autoCreateQuotes(ch, textBefore.slice(0, -1));
		if (auto) {
			for (const c of auto) this.main.insert(c, ts);
			this.main.cursor -= auto.length;
			this._log(ts, `  ↳ auto-quotes: ${JSON.stringify(auto)}`, CLR.green);
			return;
		}

		auto = this.vscode.autoCloseHtmlTag(ch, textBefore.slice(0, -1));
		if (auto) {
			for (const c of auto) this.main.insert(c, ts);
			this.main.cursor -= auto.length;
			this._log(ts, `  ↳ auto-tag: ${JSON.stringify(auto)}`, CLR.green);
			return;
		}

		auto = this.vscode.autoCloseBracket(ch, afterLine);
		if (auto) {
			for (const c of auto) this.main.insert(c, ts);
			this.main.cursor -= auto.length;
			this._log(ts, `  ↳ auto-bracket: ${JSON.stringify(auto)}`, CLR.green);
			return;
		}

		auto = this.vscode.autoCloseQuote(ch, textBefore, afterLine);
		if (auto) {
			for (const c of auto) this.main.insert(c, ts);
			this.main.cursor -= auto.length;
			this._log(ts, `  ↳ auto-quote: ${JSON.stringify(auto)}`, CLR.green);
			return;
		}
	}

	_activeProfile() {
		const LP = window.LanguageProfiles;
		if (!LP) return null;
		const fn = (this._activeFilename || "").toLowerCase();
		const m = fn.match(/\.[^./\\]+$/);
		if (m) return LP.getProfile(m[0]);
		const lessonExt = LP.lessonFileExtension(this._lessonFile);
		if (lessonExt) return LP.getProfile(lessonExt);
		return LP.getProfile(".html");
	}

	_dedentOne(indent) {
		if (indent.startsWith("\t")) return indent.slice(1);
		if (indent.startsWith("    ")) return indent.slice(4);
		if (indent.startsWith("  ")) return indent.slice(2);
		return indent;
	}

	_autoIndent(ts) {
		const cur = this.main.cursor;
		const prevEnd = this.main.text.lastIndexOf("\n", cur - 1);
		const prev2 =
			prevEnd > 0 ? this.main.text.lastIndexOf("\n", prevEnd - 1) : -1;
		const prevLine = this.main.text.slice(prev2 + 1, prevEnd);
		const base = (prevLine.match(/^(\s*)/) || ["", ""])[1];
		const lineEnd = this.main.text.indexOf("\n", cur);
		const after =
			lineEnd === -1
				? this.main.text.slice(cur)
				: this.main.text.slice(cur, lineEnd);
		const afterTrimmed = after.trimStart();

		const LP = window.LanguageProfiles;
		const profile = this._activeProfile();
		let opens, closes, dedentAfter;
		if (profile && LP) {
			opens = LP.shouldIncreaseAfter(profile, prevLine);
			closes = LP.shouldDecreaseOnLine(profile, afterTrimmed);
			dedentAfter = LP.shouldDecreaseAfter(profile, prevLine);
		} else {
			const trimmed = prevLine.trimEnd();
			const opensWithBrace = /[{([]$/.test(trimmed);
			const opensWithTag =
				/<[a-zA-Z][a-zA-Z0-9-]*(\s[^>]*)?>$/.test(trimmed) &&
				!/\/>$/.test(trimmed) &&
				!/<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)(\s[^>]*)?>$/i.test(
					trimmed,
				);
			opens = opensWithBrace || opensWithTag;
			closes = /^[})\]]/.test(afterTrimmed) || /^<\//.test(afterTrimmed);
			dedentAfter = false;
		}

		let indent = base + (opens ? "\t" : "");
		if (dedentAfter && !opens && !closes) {
			indent = this._dedentOne(base);
		}

		if (opens && closes) {
			for (const c of indent) this.main.insert(c, ts);
			this.main.insert("\n", ts);
			for (const c of base) this.main.insert(c, ts);
			this.main.cursor -= base.length + 1;
		} else if (!opens && closes) {
			const closingIndent = this._dedentOne(base);
			for (const c of closingIndent) this.main.insert(c, ts);
		} else {
			for (const c of indent) this.main.insert(c, ts);
		}
	}

	_indentSelection(ts) {
		const selStart = Math.min(this._selAnchorMain, this.main.cursor);
		const selEnd = Math.max(this._selAnchorMain, this.main.cursor);
		const text = this.main.text;

		const lineStarts = [];
		let p = text.lastIndexOf("\n", selStart - 1) + 1;
		lineStarts.push(p);
		while (true) {
			const nl = text.indexOf("\n", p);
			if (nl === -1 || nl >= selEnd) break;
			lineStarts.push(nl + 1);
			p = nl + 1;
		}
		if (lineStarts.length > 1 && lineStarts[lineStarts.length - 1] === selEnd)
			lineStarts.pop();

		let cursor = this.main.cursor;

		for (let i = lineStarts.length - 1; i >= 0; i--) {
			const pos = lineStarts[i];
			this.main.text =
				this.main.text.slice(0, pos) + "\t" + this.main.text.slice(pos);
			this.main.charTs.splice(pos, 0, ts);
			for (const name in this.main.anchors) {
				if (this.main.anchors[name] > pos) this.main.anchors[name]++;
			}
			if (cursor > pos) cursor++;
		}

		this.main.cursor = cursor;
		this._selAnchorMain = null;
	}

	_initHoverTooltip() {
		this._hoverTip = document.createElement("div");
		this._hoverTip.id = "vis-hover-tip";
		document.body.appendChild(this._hoverTip);

		const showTip = (e, st) => {
			const idx = this._charIndexAtPoint(
				e.clientX,
				e.clientY,
				e.currentTarget,
			);
			if (idx !== null && idx < st.charTs.length) {
				const ts = st.charTs[idx];
				if (ts) {
					const timeStr = fmtTs(ts).split("  ")[1] ?? fmtTs(ts);
					this._hoverTip.textContent = timeStr;
					this._hoverTip.style.left = `${e.clientX + 14}px`;
					this._hoverTip.style.top = `${e.clientY + 18}px`;
					this._hoverTip.style.display = "block";
					return;
				}
			}
			this._hoverTip.style.display = "none";
		};
		const hideTip = () => {
			this._hoverTip.style.display = "none";
		};

		this.elEditor.addEventListener("mousemove", (e) => showTip(e, this.main));
		this.elEditor.addEventListener("mouseleave", hideTip);
		this.elDevEditor.addEventListener("mousemove", (e) =>
			showTip(e, this.dev),
		);
		this.elDevEditor.addEventListener("mouseleave", hideTip);
	}

	_charIndexAtPoint(x, y, root) {
		let range;
		if (document.caretPositionFromPoint) {
			const pos = document.caretPositionFromPoint(x, y);
			if (!pos) return null;
			range = document.createRange();
			range.setStart(pos.offsetNode, pos.offset);
		} else {
			const doc = /** @type {any} */ (document);
			if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(x, y);
		}
		if (!range) return null;
		return this._countCharsToNode(
			root,
			range.startContainer,
			range.startOffset,
		);
	}

	_countCharsToNode(root, targetNode, targetOffset) {
		let srcIdx = 0;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
		let node = walker.nextNode();
		while (node) {
			if (node === targetNode) {
				if (node.nodeType !== Node.TEXT_NODE) return srcIdx;
				const p = node.parentElement;
				if (p?.classList.contains("vis-cursor")) return srcIdx;
				if (p?.classList.contains("vis-tab")) return srcIdx;
				return srcIdx + targetOffset;
			}
			if (node.nodeType === Node.TEXT_NODE) {
				const p = node.parentElement;
				if (p?.classList.contains("vis-cursor")) {
					node = walker.nextNode();
					continue;
				}
				if (p?.classList.contains("vis-tab")) {
					srcIdx += 1;
					node = walker.nextNode();
					continue;
				}
				srcIdx += node.textContent.length;
			} else if (node.nodeName === "BR") {
				srcIdx += 1;
			}
			node = walker.nextNode();
		}
		return null;
	}

	_switchToFile(filename) {
		if (!(filename in this._files)) {
			this._files[filename] = new TextState();
		}
		this._activeFilename = filename;
		this.main = this._files[filename];
		if (!this._silent) this._updateFileTabs();
	}

	_updateFileTabs() {
		if (!this.elFileTabs) return;
		const keys = Object.keys(this._files);
		if (keys.length <= 1) {
			this.elFileTabs.innerHTML = "";
			return;
		}
		this.elFileTabs.innerHTML = "";
		for (const name of keys) {
			const btn = document.createElement("button");
			btn.className =
				"file-tab" +
				(name === this._activeFilename ? " file-tab-active" : "");
			btn.textContent =
				name === "MAIN" ? "MAIN" : name.split("/").pop().split("\\").pop();
			btn.title = name;
			btn.onclick = () => {
				this._switchToFile(name);
				this._renderEditors();
			};
			this.elFileTabs.appendChild(btn);
		}
	}

	_flashAnchor() {
		if (this._anchorFlashTimer) clearTimeout(this._anchorFlashTimer);
		this.elEditor.classList.add("anchor-flash");
		this._anchorFlashTimer = setTimeout(() => {
			this.elEditor.classList.remove("anchor-flash");
			this._anchorFlashTimer = null;
		}, 500);
	}

	_prevLineOpensTag(st, ls) {
		if (ls === 0) return false;
		const prevEnd = ls - 1;
		const prevLs = st.text.lastIndexOf("\n", prevEnd - 1) + 1;
		const prevLine = st.text.slice(prevLs, prevEnd).trimEnd();
		const m = prevLine.match(/<([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?>$/);
		if (!m) return false;
		if (prevLine.endsWith("/>")) return false;
		if (HTML_VOID_TAGS.has(m[1].toLowerCase())) return false;
		return true;
	}

	_backspaceIsIgnored(st) {
		if (st.cursor === 0) return false;
		const CLOSING = ["</style", "</script", "</html"];
		const prevChar = st.text[st.cursor - 1];
		if (prevChar === "\n") {
			const ahead = st.text.slice(st.cursor, st.cursor + 9).trimStart();
			return CLOSING.some((p) => ahead.startsWith(p));
		}
		if (prevChar === " " || prevChar === "\t") {
			const ls = st.text.lastIndexOf("\n", st.cursor - 1) + 1;
			const leRaw = st.text.indexOf("\n", st.cursor);
			const le = leRaw === -1 ? st.text.length : leRaw;
			if (st.text.slice(ls, le).trim() === "") {
				const nextStart = leRaw === -1 ? st.text.length : leRaw + 1;
				const ahead = st.text.slice(nextStart, nextStart + 9).trimStart();
				if (CLOSING.some((p) => ahead.startsWith(p))) return true;
				if (this._prevLineOpensTag(st, ls)) return true;
			}
		}
		return false;
	}

	_autoDedent(ch, ts) {
		const lineStart =
			this.main.text.lastIndexOf("\n", this.main.cursor - 1) + 1;
		const before = this.main.text.slice(lineStart, this.main.cursor);

		const isCloser = "})]".includes(ch);
		const isHtmlEnd = ch === "/" && /^[ \t]*<$/.test(before);
		if (!(isCloser || isHtmlEnd)) return;
		if (isCloser && !/^[ \t]*$/.test(before)) return;
		if (!before) return;

		let newBefore;
		if (before.startsWith("\t")) newBefore = before.slice(1);
		else if (before.startsWith("    ")) newBefore = before.slice(4);
		else if (before.startsWith("  ")) newBefore = before.slice(2);
		else return;

		const n = before.length - newBefore.length;
		const savedCursor = this.main.cursor;
		this.main.cursor = lineStart;
		this.main.deleteForward(n);
		this.main.cursor = savedCursor - n;
	}

	_devSemicolonNewline(ts) {
		const lineStart =
			this.dev.text.lastIndexOf("\n", this.dev.cursor - 1) + 1;
		const line = this.dev.text.slice(lineStart, this.dev.cursor);
		const indent = (line.match(/^(\s*)/) || ["", ""])[1];
		this.dev.insert("\n", ts);
		for (const c of indent) this.dev.insert(c, ts);
	}

	_renderEditors() {
		const fn = this._activeFilename.toLowerCase();
		let mainFileType;
		if (fn.endsWith(".css")) mainFileType = "css";
		else if (fn.endsWith(".js")) mainFileType = "js";
		else if (fn.endsWith(".py")) mainFileType = "py";
		else {
			const LP = window.LanguageProfiles;
			const lessonExt = LP ? LP.lessonFileExtension(this._lessonFile) : null;
			if (lessonExt === ".py") mainFileType = "py";
			else if (lessonExt === ".css") mainFileType = "css";
			else if (lessonExt === ".js") mainFileType = "js";
			else mainFileType = "html";
		}
		this.elEditor.innerHTML = renderEditorHtml(this.main, true, mainFileType);
		this.elDevEditor.innerHTML = renderEditorHtml(this.dev, true, "none");
		if (this.elAutoScroll.checked) {
			const cur = this.elEditor.querySelector(".vis-cursor");
			if (cur) cur.scrollIntoView({ block: "nearest" });
		}
		const ts = this.main.tsAtCursor() || this.dev.tsAtCursor();
		if (ts && !this._silent) this.elTsLbl.textContent = fmtTs(ts).slice(-12);
	}

	_schedulePreview() {
		this._previewDirty = true;
		if (!this._previewRafId)
			this._previewRafId = requestAnimationFrame(() => {
				this._previewRafId = null;
				if (this._previewDirty) {
					this._updatePreview();
					this._previewDirty = false;
				}
			});
	}

	_updatePreview(force = false) {
		if (!force && this.playing && this.microIdx % 300 !== 0) {
			this._previewDirty = true;
			return;
		}
		try {
			const html = (this._files["MAIN"] || this.main).text;
			this.elPreview.srcdoc = this._inlineFiles(html) || "";
		} catch (_) {}
		this._previewDirty = false;
	}

	_inlineFiles(html) {
		const filesMap = { ...this._imageUris };
		for (const [key, st] of Object.entries(this._files)) {
			if (key === "MAIN") continue;
			const base = key.replace(/\\/g, "/").split("/").pop();
			filesMap[base] = st.text;
		}
		if (!Object.keys(filesMap).length) return html;
		return inlineFilesInHtml(html, filesMap);
	}

	_log(ts, msg, color = CLR.blue) {
		const tShort = ts ? fmtTs(ts).slice(-12) : "??:??:??.???";
		const text = `[${tShort}] ${msg}\n`;
		this._logBuf.push([this.microIdx, text, color]);
		if (!this._silent) this._appendLogEntry(text, color);
	}

	_appendLogEntry(text, color) {
		const span = document.createElement("span");
		span.style.color = color;
		span.textContent = text;
		this.elEventLog.appendChild(span);
		this.elEventLog.scrollTop = this.elEventLog.scrollHeight;
	}

	_clearEventLog() {
		this.elEventLog.innerHTML = "";
	}

	_drawSeekbar(frac) {
		this.elSeekFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
	}

	_idxToFrac(idx) {
		if (!this._totalDelay || !this._microCumDelay)
			return this.micro.length ? idx / this.micro.length : 0;
		const i = Math.max(0, Math.min(idx, this._microCumDelay.length - 1));
		return this._microCumDelay[i] / this._totalDelay;
	}

	_fracToIdx(frac) {
		if (!this._totalDelay || !this._microCumDelay) {
			return Math.max(
				0,
				Math.min(this.micro.length, Math.round(frac * this.micro.length)),
			);
		}
		const target = frac * this._totalDelay;
		let lo = 0,
			hi = this.micro.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (this._microCumDelay[mid] < target) lo = mid + 1;
			else hi = mid;
		}
		return Math.max(0, Math.min(this.micro.length, lo));
	}

	_scheduleSeekbarUpdate() {
		if (this._seekbarRaf) cancelAnimationFrame(this._seekbarRaf);
		if (!this.playing || this._seeking) return;
		this._seekbarRaf = requestAnimationFrame(() => {
			this._seekbarRaf = null;
			if (!this.playing) return;
			const elapsed = (performance.now() - this._stepStartWall) / 1000;
			const t =
				this._stepDurS > 0 ? Math.min(1, elapsed / this._stepDurS) : 1;
			const prevFrac = this._idxToFrac(Math.max(0, this.microIdx - 1));
			const nextFrac = this._idxToFrac(this.microIdx);
			const frac = Math.min(1, prevFrac + (nextFrac - prevFrac) * t);
			this._drawSeekbar(frac);
			this._scheduleSeekbarUpdate();
		});
	}

	_onSeekPress(e) {
		if (!this.micro.length) return;
		this._seeking = true;
		this._seekWasPlaying = this.playing;
		if (this.playing) this._pause();
		const frac = e.offsetX / this.elSeekbar.offsetWidth;
		this._drawSeekbar(frac);
	}

	_onSeekDrag(e) {
		if (!this._seeking) return;
		const rect = this.elSeekbar.getBoundingClientRect();
		const frac = Math.max(
			0,
			Math.min(1, (e.clientX - rect.left) / rect.width),
		);
		this._dragFrac = frac;
		this._drawSeekbar(frac);
		if (!this._dragTimer)
			this._dragTimer = setTimeout(() => {
				this._dragTimer = null;
				if (this._seeking) {
					this._seekTo(this._fracToIdx(this._dragFrac));
					this._drawSeekbar(this._dragFrac);
				}
			}, 150);
	}

	_onSeekRelease(e) {
		if (!this._seeking) return;
		if (this._dragTimer) {
			clearTimeout(this._dragTimer);
			this._dragTimer = null;
		}
		this._seeking = false;
		let frac;
		if (e.type === "pointercancel") {
			frac = this._dragFrac;
		} else {
			const rect = this.elSeekbar.getBoundingClientRect();
			frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		}
		this._seekTo(this._fracToIdx(frac));
		if (this._seekWasPlaying) this._play();
	}

	_seekTo(targetIdx) {
		if (!this.micro.length) return;
		targetIdx = Math.max(0, Math.min(targetIdx, this.micro.length));

		this._silent = true;
		this.microIdx = 0;
		this._resetAllFiles();
		this.dev.reset();
		this._ciBaseIndent = "";
		this._activeEditor = "main";
		this._selAnchorMain = null;
		this._logBuf = [];

		while (this.microIdx < targetIdx) {
			this._handle(this.micro[this.microIdx]);
			this.microIdx++;
		}
		this._silent = false;
		this._updateFileTabs();

		this._clearEventLog();
		const frag = document.createDocumentFragment();
		for (const [, text, color] of this._logBuf) {
			const span = document.createElement("span");
			span.style.color = color;
			span.textContent = text;
			frag.appendChild(span);
		}
		this.elEventLog.appendChild(frag);
		this.elEventLog.scrollTop = this.elEventLog.scrollHeight;

		this._renderEditors();
		this._updatePreview(true);
		this._updateProgress();
	}

	_updateProgress() {
		const t = this.micro.length,
			i = this.microIdx;
		if (!this._silent) this.elProgLbl.textContent = `${i} / ${t}`;
		if (!this.playing || this._seeking) this._drawSeekbar(this._idxToFrac(i));
	}
}

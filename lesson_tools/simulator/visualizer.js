"use strict";

const PAUSE_CAP_MS = 3000;

function computeSkipRegions(cumDelay, cap) {
	const regions = [];
	if (!cumDelay) return regions;
	for (let i = 1; i < cumDelay.length; i++) {
		const gap = cumDelay[i] - cumDelay[i - 1];
		if (gap > cap) {
			regions.push({ start: cumDelay[i - 1] + cap, end: cumDelay[i] });
		}
	}
	return regions;
}

class LogVisualizer {
	constructor() {
		this.micro = [];
		this.microIdx = 0;
		this.playing = false;
		this.speed = 8.0;
		this._silent = false;

		this._imageUris = {};
		this._interactions = [];
		this._studentNameMap = {};
		this.main = new TextState();
		this.dev = new TextState();
		this._files = { MAIN: this.main };
		this._activeFilename = "MAIN";
		this._activeEditor = "main";
		this._lessonFile = null;
		this._anchorFlashTimer = null;
		this._scrollTarget = null;
		this._scrollRafId = null;

		this._logBuf = [];
		this._microCumDelay = null;
		this._totalDelay = 0;
		this._skipRegions = [];

		this._seeking = false;
		this._seekWasPlaying = false;
		this._dragFrac = 0;
		this._dragTimer = null;

		this._playMs = 0;
		this._lastWall = 0;
		this._rafId = null;
		this._currentInt = null;
		this._nextIntIdx = 0;

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
            <label><input id="chk-skip-pauses" type="checkbox" checked> Skip pauses</label>
            <span id="ts-label" style="margin-left:auto;color:${CLR.accent};font-family:Consolas,monospace;font-size:11px;line-height:1"></span>
            <button id="btn-copy-ts" title="Copy link to this moment" style="margin-left:6px" disabled>🔗</button>
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
              <div class="pane-title">Dev Tools</div>
              <pre id="vis-dev-editor"></pre>
            </div>
          </div>
        </div>
        `;

		this.elPlay = document.getElementById("btn-play");
		this.elSpeed = document.getElementById("speed-slider");
		this.elSpeedLbl = document.getElementById("speed-label");
		this.elAutoScroll = document.getElementById("chk-autoscroll");
		this.elSkipPauses = document.getElementById("chk-skip-pauses");
		this.elTsLbl = document.getElementById("ts-label");
		this.elCopyTs = document.getElementById("btn-copy-ts");
		this.elProgLbl = document.getElementById("prog-label");
		this.elSeekbar = document.getElementById("vis-seekbar");
		this.elSeekFill = document.getElementById("vis-seekfill");
		this.elDevEditor = document.getElementById("vis-dev-editor");
		this.elDevOuter = document.getElementById("vis-dev-outer");
		this.elEventLog = document.getElementById("vis-event-log");
		this.elEventLogWrap = document.getElementById("vis-event-log-wrap");
		this.elBtnLog = document.getElementById("btn-toggle-log");
		this.elBtnDev = document.getElementById("btn-toggle-devtools");

		this.fileViewer = new FileViewer({
			editorEl: document.getElementById("vis-editor"),
			previewEl: document.getElementById("vis-preview"),
			tabsEl: document.getElementById("vis-file-tabs"),
			onActiveFileChange: (name) => {
				this._switchToFile(name);
				this._renderEditors();
			},
		});
		this.elFileTabs = this.fileViewer._tabsEl;
		this.elEditor = this.fileViewer.editorEl;
		this.elPreview = this.fileViewer.previewEl;

		const logOn = localStorage.getItem("sim-event-log") === "on";
		const devOn = localStorage.getItem("sim-devtools") !== "off";
		this._setEventLogVisible(logOn);
		this._setDevPanelVisible(devOn);

		this.elPlay.onclick = () => this.togglePlay();
		this.elCopyTs.onclick = () => this._copyTimestampLink();
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

		if (this.elSkipPauses)
			this.elSkipPauses.addEventListener("change", () =>
				this._renderSkipSegments(),
			);

		this.elSeekbar.addEventListener("pointerdown", (e) => {
			this.elSeekbar.setPointerCapture(e.pointerId);
			this._onSeekPress(e);
		});
		document.addEventListener("pointermove", (e) => this._onSeekDrag(e));
		document.addEventListener("pointerup", (e) => this._onSeekRelease(e));
		document.addEventListener("pointercancel", (e) => this._onSeekRelease(e));

		this._initHoverTooltip();
		installDragDivider({
			dividerEl: document.getElementById("vis-divider"),
			targetEl: document.getElementById("vis-right"),
			containerEl: document.getElementById("vis-root"),
			persistKey: "sim-right-pct",
			axis: "x",
		});
		installDragDivider({
			dividerEl: document.getElementById("vis-dev-divider"),
			targetEl: document.getElementById("vis-dev-outer"),
			containerEl: document.getElementById("vis-right-main"),
			persistKey: "sim-dev-pct",
			axis: "y",
		});
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

	_prepareInteractions(rawInteractions) {
		const sorted = [...rawInteractions]
			.filter((it) => it && typeof it.timestamp === "number")
			.sort((a, b) => a.timestamp - b.timestamp);
		const typingTs = [];
		for (const m of this.micro || []) {
			if ((m[0] === "char" || m[0] === "code_insert_atomic") && m[2]) {
				typingTs.push(m[2]);
			}
		}
		const nextTypingAfter = (ts) => {
			for (const t of typingTs) if (t > ts) return t;
			return Infinity;
		};
		return sorted.map((it, i) => {
			const naturalEnd =
				it.closed_at != null
					? it.closed_at
					: (sorted[i + 1]?.timestamp ?? it.timestamp + 5000);
			const typingEnd = nextTypingAfter(it.timestamp);
			return { ...it, endTs: Math.min(naturalEnd, typingEnd) };
		});
	}

	_lookupStudentName(field) {
		if (field == null) return "";
		const key = String(field).trim();
		if (!key) return "";
		const name = this._studentNameMap?.[key];
		return name || key;
	}

	_activeInteractionAt(ts) {
		if (!ts || !this._interactions?.length) return null;
		for (const it of this._interactions) {
			if (it.timestamp <= ts && ts <= it.endTs) return it;
		}
		return null;
	}

	_renderInteractionHtml(it) {
		const KIND = {
			"teacher-question": { icon: "❓", label: "Teacher Question" },
			"student-question": { icon: "🙋", label: "Student Question" },
			"providing-help": { icon: "🤝", label: "Providing Help" },
		};
		const k = KIND[it.interaction] || {
			icon: "💬",
			label: it.interaction || "Interaction",
		};
		const fmtWho = (v) => {
			let arr;
			if (Array.isArray(v)) arr = v;
			else if (typeof v === "string") arr = v.split(",");
			else if (v != null) arr = [v];
			else arr = [];
			return arr
				.map((x) => this._lookupStudentName(x))
				.filter(Boolean)
				.join(", ");
		};
		const parts = [
			`<div class="vis-int-title">${k.icon} ${escHtml(k.label)}</div>`,
		];
		if (it.info) {
			parts.push(
				`<div class="vis-int-info">${escHtml(String(it.info))}</div>`,
			);
		}
		const askedBy = fmtWho(it.asked_by);
		if (askedBy) {
			parts.push(
				`<div class="vis-int-line"><span class="vis-int-key">Asked by:</span> ${escHtml(askedBy)}</div>`,
			);
		}
		const answeredBy = fmtWho(it.answered_by);
		if (answeredBy) {
			parts.push(
				`<div class="vis-int-line"><span class="vis-int-key">Answered by:</span> ${escHtml(answeredBy)}</div>`,
			);
		}
		const student = fmtWho(it.student);
		if (student) {
			parts.push(
				`<div class="vis-int-line"><span class="vis-int-key">Student:</span> ${escHtml(student)}</div>`,
			);
		}
		return parts.join("");
	}

	loadFile({
		filePath,
		micro,
		error,
		imageUris,
		lessonFile,
		lessonName,
		interactions,
		studentNameMap,
		seekStep,
		seekTs,
	}) {
		if (error) {
			console.error("expand error:\n" + error);
			return;
		}

		this._imageUris = imageUris || {};
		this._lessonFile = lessonFile || null;
		this._studentNameMap = studentNameMap || {};
		this.micro = micro;
		this._interactions = this._prepareInteractions(interactions || []);
		document.title = lessonName ? `Simulator: ${lessonName}` : "Simulator";

		this._tsOrigin = 0;
		let tsOriginIdx = 0;
		for (let i = 0; i < micro.length; i++) {
			const ts = micro[i][2];
			if (ts && ts > 1_000_000_000_000) {
				this._tsOrigin = ts;
				tsOriginIdx = i;
				break;
			}
		}

		this._microCumDelay = new Float64Array(micro.length + 1);
		this._microCumDelay[0] = 0;
		for (let i = 1; i <= micro.length; i++) {
			const prevTs = micro[i - 1]?.[2];
			const nextTs = i < micro.length ? micro[i]?.[2] : prevTs;
			let d = 1;
			if (
				prevTs &&
				nextTs &&
				prevTs > 1_000_000_000_000 &&
				nextTs > prevTs
			) {
				d = nextTs - prevTs;
			}
			this._microCumDelay[i] = this._microCumDelay[i - 1] + Math.max(1, d);
		}
		this._totalDelay = this._microCumDelay[micro.length];
		this._tsOriginCum = this._microCumDelay[tsOriginIdx] || 0;
		this._skipRegions = computeSkipRegions(this._microCumDelay, PAUSE_CAP_MS);
		this._renderSkipSegments();

		let targetMs = this._totalDelay;
		if (seekTs != null && seekTs !== "") {
			const ms = this._playMsForTimestamp(seekTs);
			if (ms != null) targetMs = ms;
		} else if (seekStep != null && Number.isFinite(Number(seekStep))) {
			targetMs =
				this._microCumDelay[
					Math.max(
						0,
						Math.min(this.micro.length, Math.floor(Number(seekStep))),
					)
				];
		}
		this._seekToMs(targetMs);
		this.elPlay.disabled = false;
		if (this.elCopyTs) this.elCopyTs.disabled = !this._tsOrigin;
	}

	seekToStep(n) {
		if (!this.micro.length) return;
		const idx = Math.max(
			0,
			Math.min(this.micro.length, Math.floor(Number(n) || 0)),
		);
		this._seekToMs(this._microCumDelay[idx]);
	}

	seekToTimestamp(value) {
		const ms = this._playMsForTimestamp(value);
		if (ms != null) this._seekToMs(ms);
	}

	_playMsForTimestamp(value) {
		if (value == null || !this.micro.length) return null;
		const raw = String(value).trim();
		let want = null;
		if (/^\d+$/.test(raw)) {
			let epochMs = Number(raw);
			if (epochMs >= 1_000_000_000 && epochMs < 1_000_000_000_000)
				epochMs *= 1000;
			if (epochMs >= 1_000_000_000_000)
				return epochMs - this._tsOrigin + (this._tsOriginCum || 0);
			if (this._tsOrigin)
				want = fmtTs(this._tsOrigin + epochMs * 1000).slice(-12);
		} else {
			const m = raw.match(
				/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/,
			);
			if (m)
				want = `${m[1].padStart(2, "0")}:${m[2]}:${
					m[3] || "00"
				}.${((m[4] || "") + "000").slice(0, 3)}`;
		}
		if (want == null) return null;
		for (let i = 0; i < this.micro.length; i++) {
			const ts = this.micro[i][2];
			if (!ts || ts < 1_000_000_000_000) continue;
			if (fmtTs(ts).slice(-12) >= want) return this._microCumDelay[i];
		}
		return this._totalDelay;
	}

	_copyTimestampLink() {
		const tsStr = (this.elTsLbl.textContent || "").trim();
		if (!tsStr) return;
		const { lesson, group } = parseToolParams();
		const speed = this.speed !== 8 ? this.speed : null;
		const text = lesson
			? new URL(
					buildToolUrl("simulator.html", {
						lesson,
						group,
						ts: tsStr,
						speed,
					}),
					location.href,
				).href
			: tsStr;
		const flash = (msg) => {
			this.elCopyTs.textContent = msg;
			clearTimeout(this._copyTsTimer);
			this._copyTsTimer = setTimeout(() => {
				this.elCopyTs.textContent = "🔗";
			}, 1200);
		};
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard
				.writeText(text)
				.then(() => flash("✓"))
				.catch(() => flash("✖"));
			return;
		}
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.left = "-9999px";
		document.body.appendChild(ta);
		ta.focus();
		ta.select();
		let ok = false;
		try {
			ok = document.execCommand("copy");
		} catch {}
		ta.remove();
		flash(ok ? "✓" : "✖");
	}

	setSpeed(value) {
		const v = Number(value);
		if (!Number.isFinite(v) || v <= 0) return;
		this.speed = v;
		if (this.elSpeed)
			this.elSpeed.value = String(Math.max(1, Math.min(60, v)));
		if (this.elSpeedLbl) this.elSpeedLbl.textContent = `${v.toFixed(0)}×`;
	}

	togglePlay() {
		if (this.playing) this._pause();
		else {
			if (this.micro.length && this._playMs >= this._totalDelay)
				this._seekToMs(0);
			this._play();
		}
	}

	_play() {
		this.playing = true;
		this.elPlay.textContent = "⏸  Pause";
		this.elPlay.style.background = CLR.red;
		this._lastWall = performance.now();
		this._rafId = requestAnimationFrame(() => this._raf());
	}

	_pause() {
		this.playing = false;
		if (this._rafId) {
			cancelAnimationFrame(this._rafId);
			this._rafId = null;
		}
		this.elPlay.textContent = "▶  Play";
		this.elPlay.style.background = "";
	}

	_raf() {
		this._rafId = null;
		if (!this.playing || this._seeking) return;
		const now = performance.now();
		const dtSec = (now - this._lastWall) / 1000;
		this._lastWall = now;
		let newPlayMs = Math.min(
			this._totalDelay,
			this._playMs + dtSec * 1000 * Math.max(0.1, this.speed),
		);
		newPlayMs = this._snapPastSkips(newPlayMs);
		let eventsFired = false;
		while (
			this.microIdx < this.micro.length &&
			this._microCumDelay[this.microIdx] < newPlayMs
		) {
			this._handle(this.micro[this.microIdx]);
			this.microIdx++;
			eventsFired = true;
		}
		this._playMs = newPlayMs;
		this._paintHud();
		if (eventsFired) {
			this._renderEditors();
			this._schedulePreview();
		} else if (this.elAutoScroll.checked) {
			this._followCursor();
		}
		if (
			this.microIdx >= this.micro.length &&
			this._playMs >= this._totalDelay
		) {
			this.playing = false;
			this.elPlay.textContent = "▶  Play";
			this.elPlay.style.background = "";
			this._renderEditors();
			this._schedulePreview();
			return;
		}
		this._rafId = requestAnimationFrame(() => this._raf());
	}

	_paintHud() {
		this._drawSeekbar(this._totalDelay ? this._playMs / this._totalDelay : 0);
		if (this._tsOrigin) {
			const ts = this._tsOrigin + (this._playMs - (this._tsOriginCum || 0));
			this.elTsLbl.textContent = fmtTs(ts).slice(-12);
			this._updateInteractionOverlay(ts);
		}
		this.elProgLbl.textContent = `${this.microIdx} / ${this.micro.length}`;
	}

	_updateInteractionOverlay(ts) {
		const activeInt = this._activeInteractionAt(ts);
		if (activeInt === this._currentInt) return;
		this._currentInt = activeInt;
		if (activeInt) {
			this.elDevEditor.classList.add("vis-int-mode");
			this.elDevEditor.innerHTML = this._renderInteractionHtml(activeInt);
			if (!this._loggedInteractions?.has(activeInt)) {
				this._logInteraction(activeInt);
			}
		} else {
			this.elDevEditor.classList.remove("vis-int-mode");
			this.elDevEditor.innerHTML = renderEditorHtml(this.dev, true, "none");
		}
	}

	_logInteraction(it) {
		if (!this._loggedInteractions) this._loggedInteractions = new Set();
		this._loggedInteractions.add(it);
		const KIND = {
			"teacher-question": {
				icon: "❓",
				label: "Question",
				color: CLR.accent,
			},
			"student-question": { icon: "🙋", label: "Question", color: CLR.move },
			"providing-help": { icon: "🤝", label: "Help", color: CLR.green },
		};
		const k = KIND[it.interaction] || {
			icon: "💬",
			label: "Interaction",
			color: CLR.dim,
		};
		this._log(it.timestamp, `${k.icon}  ${k.label}`, k.color);
	}

	_resetAllFiles() {
		for (const st of Object.values(this._files)) st.reset();
		this._files = { MAIN: this._files["MAIN"] };
		this.main = this._files["MAIN"];
		this._activeFilename = "MAIN";
		this._updateFileTabs();
	}

	_handle(act) {
		const kind = act[0];

		if (kind === "switch_editor") {
			const [, target, , delay] = act;
			const label = target === "dev" ? "Dev Tools" : "Main Editor";
			this._log(act[2], `→  ${label}`, CLR.move);
			this._activeEditor = target;
			if (target === "main") this._switchToFile("MAIN");

			return delay;
		} else if (kind === "char") {
			const [, ch, ts, delay, editor] = act;
			return this._handleChar(ch, ts, delay, editor);
		} else if (kind === "set_anchor") {
			const [, name, ts, delay] = act;
			this.main.setAnchor(name);
			this._log(ts, `⚓  ${name}`, CLR.accent);
			return delay;
		} else if (kind === "move_anchor") {
			const [, name, ts, delay] = act;
			const ok = this.main.jumpToAnchor(name);
			if (ok) {
				this._log(ts, `→  ${name}`, CLR.move);
				this._flashAnchor();
			} else {
				this._log(ts, `⚠  Unknown anchor: ${name}`, CLR.red);
			}
			return delay;
		} else if (kind === "switch_file") {
			const [, filename, ts, delay] = act;
			this._switchToFile(filename);
			this._log(ts, `→  ${filename}`, CLR.move);
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
			const lbl = CURSOR_MOVE_LABELS[ch];
			this._log(ts, `⌨  ${ch}${lbl ? " " + lbl : ""}`, CLR.blue);
			return delay;
		}
		if (ch in SHIFT_CURSOR_MOVES) {
			if (this._selAnchorMain === null)
				this._selAnchorMain = this.main.cursor;
			this.main.moveCursor(SHIFT_CURSOR_MOVES[ch]);
			const lbl = CURSOR_MOVE_LABELS[ch];
			this._log(ts, `⌨  ${ch}${lbl ? " " + lbl : ""} (select)`, CLR.blue);
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
				this._log(ts, "⌨  ― Tab", CLR.blue);
				return delay;
			}
			st.insert(real, ts);
			if (real === "\n" && editor === "main") this._autoIndent(ts);
			this._log(ts, `⌨  ${real === "\n" ? "↩ Enter" : "― Tab"}`, CLR.blue);
			return delay;
		}

		if (ch === "⌫" || ch === "↢") {
			if (this._backspaceIsIgnored(st)) {
				this._log(ts, "⌫  Backspace", CLR.pale_red);
				return delay;
			}
			st.deleteBack(1);
			this._log(ts, "⌫  Backspace", CLR.red);
			return delay;
		}

		if (ch === DELETE_FWRD_CHAR) {
			st.deleteForward(1);
			this._log(ts, "⌦  Delete", CLR.blue);
			return delay;
		}

		if (ch === DELETE_LINE_CHAR) {
			st.deleteLine();
			this._log(ts, "⛔  Delete Line", CLR.red);
			return delay;
		}

		if (ch === PAUSE_CHAR) {
			this._log(ts, "🕛  Pause 500 ms", CLR.dim);
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

		this._log(ts, `⌨  ${JSON.stringify(ch)}`, CLR.dim);
		return delay;
	}

	_handleCodeInsertAtomic(act) {
		const [, code, ts, delay, editor] = act;
		this._log(ts, "⬇  Code Insert", CLR.orange);

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
					} else if (ch === "↩" || ch === "\n") {
						st.insert("\n", ts);
						if (editor === "main") {
							this._autoIndent(ts);
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

		return delay;
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

	_autoIndent(ts) {
		autoIndent(this.main, ts, (prevLine, afterTrimmed) => {
			const LP = window.LanguageProfiles;
			const profile = this._activeProfile();
			if (profile && LP) {
				return {
					opens: LP.shouldIncreaseAfter(profile, prevLine),
					closes: LP.shouldDecreaseOnLine(profile, afterTrimmed),
					dedentAfter: LP.shouldDecreaseAfter(profile, prevLine),
				};
			}
			return null;
		});
	}

	_indentSelection(ts) {
		const selStart = Math.min(this._selAnchorMain, this.main.cursor);
		const selEnd = Math.max(this._selAnchorMain, this.main.cursor);
		const text = this.main.text;

		const lineStarts = [];
		let p = lineStartAt(text, selStart);
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
		const keys = Object.keys(this._files);
		this.fileViewer.setTabs(keys, this._activeFilename);
	}

	_flashAnchor() {
		if (this._anchorFlashTimer) clearTimeout(this._anchorFlashTimer);
		this.elEditor.classList.add("anchor-flash");
		this._anchorFlashTimer = setTimeout(() => {
			this.elEditor.classList.remove("anchor-flash");
			this._anchorFlashTimer = null;
		}, 500);
	}

	_backspaceIsIgnored(st) {
		return backspaceIsIgnored(st);
	}

	_autoDedent(ch, ts) {
		autoDedent(this.main, ch, ts);
	}

	_devSemicolonNewline(ts) {
		const indent = currentLineIndent(this.dev.text, this.dev.cursor);
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
		this.fileViewer.setEditorHtml(
			renderEditorHtml(this.main, true, mainFileType),
		);
		if (!this._currentInt) {
			this.elDevEditor.classList.remove("vis-int-mode");
			this.elDevEditor.innerHTML = renderEditorHtml(this.dev, true, "none");
		}
		this._syncCursorBlink();
		if (this.elAutoScroll.checked) this._followCursor();
	}

	_syncCursorBlink() {
		const delay = `${-(performance.now() % 1000)}ms`;
		const mc = this.elEditor.querySelector(".vis-cursor");
		if (mc) mc.style.animationDelay = delay;
		const dc = this.elDevEditor.querySelector(".vis-cursor");
		if (dc) dc.style.animationDelay = delay;
	}

	_followCursor() {
		const cur = this.elEditor.querySelector(".vis-cursor");
		if (!cur) return;
		const c = this.elEditor;
		const h = c.clientHeight;
		if (!h) return;
		const cRect = c.getBoundingClientRect();
		const curRect = cur.getBoundingClientRect();
		const curTop = curRect.top - cRect.top;
		const topZone = h * 0.18;
		const bottomZone = h * 0.75;
		const restPos = h * 0.45;
		if (curTop >= topZone && curTop <= bottomZone) {
			this._scrollTarget = null;
			return;
		}
		const maxTop = Math.max(0, c.scrollHeight - h);
		const target = Math.max(
			0,
			Math.min(maxTop, c.scrollTop + curTop - restPos),
		);
		if (Math.abs(target - c.scrollTop) < 1) {
			this._scrollTarget = null;
			return;
		}
		if (Math.abs(target - c.scrollTop) > h * 2) {
			if (this._scrollRafId) {
				cancelAnimationFrame(this._scrollRafId);
				this._scrollRafId = null;
			}
			this._scrollTarget = null;
			c.scrollTop = target;
			return;
		}
		this._scrollTarget = target;
		if (this._scrollRafId == null)
			this._scrollRafId = requestAnimationFrame(() => this._scrollStep());
	}

	_scrollStep() {
		this._scrollRafId = null;
		if (this._scrollTarget == null) return;
		const c = this.elEditor;
		const diff = this._scrollTarget - c.scrollTop;
		if (Math.abs(diff) < 1) {
			c.scrollTop = this._scrollTarget;
			this._scrollTarget = null;
			return;
		}
		c.scrollTop = c.scrollTop + diff * 0.12;
		this._scrollRafId = requestAnimationFrame(() => this._scrollStep());
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
			this.fileViewer.setPreviewSrcdoc(this._inlineFiles(html) || "");
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

	_snapPastSkips(playMs) {
		if (!this.elSkipPauses || !this.elSkipPauses.checked) return playMs;
		for (const r of this._skipRegions) {
			if (playMs > r.start && playMs < r.end)
				return Math.min(r.end + 0.5, this._totalDelay);
		}
		return playMs;
	}

	_renderSkipSegments() {
		if (!this.elSeekbar) return;
		for (const el of this.elSeekbar.querySelectorAll(".seek-skip"))
			el.remove();
		if (!this.elSkipPauses || !this.elSkipPauses.checked || !this._totalDelay)
			return;
		const frag = document.createDocumentFragment();
		for (const r of this._skipRegions) {
			const seg = document.createElement("div");
			seg.className = "seek-skip";
			seg.style.left = `${(r.start / this._totalDelay) * 100}%`;
			seg.style.width = `${((r.end - r.start) / this._totalDelay) * 100}%`;
			frag.appendChild(seg);
		}
		this.elSeekbar.appendChild(frag);
	}

	_drawSeekbar(frac) {
		this.elSeekFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
	}

	_onSeekPress(e) {
		if (!this.micro.length) return;
		this._seeking = true;
		this._seekWasPlaying = this.playing;
		if (this.playing) this._pause();
		const frac = e.offsetX / this.elSeekbar.offsetWidth;
		this._playMs = frac * this._totalDelay;
		this._drawSeekbar(frac);
		if (this._tsOrigin) this._paintHud();
	}

	_onSeekDrag(e) {
		if (!this._seeking) return;
		const rect = this.elSeekbar.getBoundingClientRect();
		const frac = Math.max(
			0,
			Math.min(1, (e.clientX - rect.left) / rect.width),
		);
		this._dragFrac = frac;
		this._playMs = frac * this._totalDelay;
		this._drawSeekbar(frac);
		if (this._tsOrigin) this._paintHud();
		if (!this._dragTimer)
			this._dragTimer = setTimeout(() => {
				this._dragTimer = null;
				if (this._seeking)
					this._seekToMs(this._dragFrac * this._totalDelay);
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
		this._seekToMs(frac * this._totalDelay);
		if (this._seekWasPlaying) this._play();
	}

	_seekToMs(playMs) {
		if (!this.micro.length) return;
		this._playMs = this._snapPastSkips(
			Math.max(0, Math.min(this._totalDelay, playMs)),
		);

		this._silent = true;
		this.microIdx = 0;
		this._resetAllFiles();
		this.dev.reset();
		this._activeEditor = "main";
		this._selAnchorMain = null;
		this._logBuf = [];
		this._loggedInteractions = new Set();

		const sortedInts = this._interactions || [];
		let intIdx = 0;
		const lessonTsAtCum = (cum) =>
			this._tsOrigin + (cum - (this._tsOriginCum || 0));
		while (
			this.microIdx < this.micro.length &&
			this._microCumDelay[this.microIdx] < this._playMs
		) {
			const evLessonTs = lessonTsAtCum(this._microCumDelay[this.microIdx]);
			while (
				intIdx < sortedInts.length &&
				sortedInts[intIdx].timestamp <= evLessonTs
			) {
				this._logInteraction(sortedInts[intIdx]);
				intIdx++;
			}
			this._handle(this.micro[this.microIdx]);
			this.microIdx++;
		}
		const finalLessonTs = lessonTsAtCum(this._playMs);
		while (
			intIdx < sortedInts.length &&
			sortedInts[intIdx].timestamp <= finalLessonTs
		) {
			this._logInteraction(sortedInts[intIdx]);
			intIdx++;
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

		this._currentInt = null;
		this._renderEditors();
		this._updatePreview(true);
		this._paintHud();
	}
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { computeSkipRegions, PAUSE_CAP_MS };
}

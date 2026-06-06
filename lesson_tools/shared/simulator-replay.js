"use strict";

function headlessReplay(events, lessonFile = null) {
	const files = new Map();
	files.set("MAIN", new TextState());
	const dev = new TextState();

	let activeFilename = "MAIN";
	let selAnchorMain = null;

	const mainState = () => files.get(activeFilename);

	const switchToFile = (filename) => {
		if (!files.has(filename)) files.set(filename, new TextState());
		activeFilename = filename;
	};

	const activeProfile = () => {
		const LP = typeof window !== "undefined" ? window.LanguageProfiles : null;
		if (!LP) return null;
		const fn = (activeFilename || "").toLowerCase();
		const m = fn.match(/\.[^./\\]+$/);
		if (m) {
			const p = LP.getProfile(m[0]);
			if (p) return p;
		}
		const lessonExt = LP.lessonFileExtension
			? LP.lessonFileExtension(lessonFile)
			: null;
		if (lessonExt) {
			const p = LP.getProfile(lessonExt);
			if (p) return p;
		}
		return LP.getProfile(".html");
	};

	const opensClosesForActive = () => (prevLine, afterTrimmed) => {
		const LP = typeof window !== "undefined" ? window.LanguageProfiles : null;
		if (!LP) return null;
		const profile = activeProfile();
		if (!profile) return null;
		return {
			opens: LP.shouldIncreaseAfter(profile, prevLine),
			closes: LP.shouldDecreaseOnLine(profile, afterTrimmed),
			dedentAfter: LP.shouldDecreaseAfter(profile, prevLine),
		};
	};

	const indentSelection = (state, ts) => {
		const selStart = Math.min(selAnchorMain, state.cursor);
		const selEnd = Math.max(selAnchorMain, state.cursor);
		const text = state.text;

		const lineStarts = [];
		let p = lineStartAt(text, selStart);
		lineStarts.push(p);
		while (true) {
			const nl = text.indexOf("\n", p);
			if (nl === -1 || nl >= selEnd) break;
			lineStarts.push(nl + 1);
			p = nl + 1;
		}
		if (
			lineStarts.length > 1 &&
			lineStarts[lineStarts.length - 1] === selEnd
		) {
			lineStarts.pop();
		}

		let cursor = state.cursor;
		for (let i = lineStarts.length - 1; i >= 0; i--) {
			const pos = lineStarts[i];
			state.text = state.text.slice(0, pos) + "\t" + state.text.slice(pos);
			state.charTs.splice(pos, 0, ts);
			for (const name in state.anchors) {
				if (state.anchors[name] > pos) state.anchors[name]++;
			}
			if (cursor > pos) cursor++;
		}
		state.cursor = cursor;
	};

	const devSemicolonNewline = (ts) => {
		const indent = currentLineIndent(dev.text, dev.cursor);
		dev.insert("\n", ts);
		for (const c of indent) dev.insert(c, ts);
	};

	const handleChar = (ch, ts, editor) => {
		const st = editor === "dev" ? dev : mainState();

		if (ch in CURSOR_MOVES) {
			mainState().moveCursor(CURSOR_MOVES[ch]);
			selAnchorMain = null;
			return;
		}
		if (ch in SHIFT_CURSOR_MOVES) {
			if (selAnchorMain === null) selAnchorMain = mainState().cursor;
			mainState().moveCursor(SHIFT_CURSOR_MOVES[ch]);
			return;
		}
		if (ch in CHAR_REPLACEMENTS) {
			const real = CHAR_REPLACEMENTS[ch];
			if (real === "\t" && editor === "main" && selAnchorMain !== null) {
				indentSelection(mainState(), ts);
				selAnchorMain = null;
				return;
			}
			st.insert(real, ts);
			if (real === "\n" && editor === "main") {
				autoIndent(mainState(), ts, opensClosesForActive());
			}
			return;
		}
		if (ch === "⌫" || ch === "↢") {
			if (backspaceIsIgnored(st)) return;
			st.deleteBack(1);
			return;
		}
		if (ch === DELETE_FWRD_CHAR) {
			st.deleteForward(1);
			return;
		}
		if (ch === DELETE_LINE_CHAR) {
			st.deleteLine();
			return;
		}
		if (ch === PAUSE_CHAR) return;
		if (IGNORED_CHARS.has(ch)) return;

		if (ch === ";" && editor === "dev") {
			st.insert(ch, ts);
			devSemicolonNewline(ts);
			return;
		}

		if (editor === "main") autoDedent(mainState(), ch, ts);
		st.insert(ch, ts);
	};

	const handleCodeInsertAtomic = (code, ts, editor) => {
		const segments = _splitCodeWithAnchors(code);
		for (const [segKind, segVal] of segments) {
			if (segKind !== "text") {
				mainState().setAnchor(segVal);
				continue;
			}
			for (const ch of segVal) {
				const st = editor === "dev" ? dev : mainState();
				if (ch === DELETE_LINE_CHAR) {
					st.deleteLine();
				} else if (Object.prototype.hasOwnProperty.call(CURSOR_MOVES, ch)) {
					st.moveCursor(CURSOR_MOVES[ch]);
				} else if (ch === "↩" || ch === "\n") {
					st.insert("\n", ts);
					if (editor === "main") {
						autoIndent(mainState(), ts, opensClosesForActive());
					}
				} else if (ch === "―" || ch === "\t") {
					st.insert("\t", ts);
				} else if (ch === "↢" || ch === "⌫") {
					if (!backspaceIsIgnored(st)) st.deleteBack(1);
				} else if (ch === "↣" || ch === "⌦") {
					st.deleteForward(1);
				} else {
					if (editor === "main") autoDedent(mainState(), ch, ts);
					st.insert(ch, ts);
				}
			}
		}
	};

	const actions = expandEvents(events);
	for (const act of actions) {
		const kind = act[0];
		if (kind === "switch_editor") {
			const [, target] = act;
			if (target === "main") switchToFile("MAIN");
		} else if (kind === "char") {
			const [, ch, ts, , editor] = act;
			handleChar(ch, ts, editor);
		} else if (kind === "set_anchor") {
			const [, name] = act;
			mainState().setAnchor(name);
		} else if (kind === "move_anchor") {
			const [, name] = act;
			mainState().jumpToAnchor(name);
		} else if (kind === "switch_file") {
			const [, filename] = act;
			switchToFile(filename);
		} else if (kind === "code_insert_atomic") {
			const [, code, ts, , editor] = act;
			handleCodeInsertAtomic(code, ts, editor);
		}
	}

	const tsToPos = new Map();
	for (const [filename, st] of files) {
		for (let i = 0; i < st.charTs.length; i++) {
			const ts = st.charTs[i];
			let arr = tsToPos.get(ts);
			if (!arr) {
				arr = [];
				tsToPos.set(ts, arr);
			}
			arr.push({ file: filename, pos: i });
		}
	}

	return { files, dev, tsToPos };
}

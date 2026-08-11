"use strict";

function _annotateRemovedLengths(events) {
	const lines = [[]];
	let cursorLine = 0;
	let cursorCol = 0;
	let inDev = false;

	const insertChar = (ch) => {
		if (ch === "\n" || ch === "↩") {
			const tail = lines[cursorLine].splice(cursorCol);
			lines.splice(cursorLine + 1, 0, tail);
			cursorLine++;
			cursorCol = 0;
		} else {
			lines[cursorLine].splice(cursorCol, 0, ch);
			cursorCol++;
		}
	};

	for (const ev of events) {
		if (ev.move_to === "DEV" || ev.switch_editor === "dev") {
			inDev = true;
			continue;
		}
		if (ev.move_to === "MAIN" || ev.switch_editor === "main") {
			inDev = false;
			continue;
		}
		if (inDev) continue;
		if (ev.char != null) {
			const ch = ev.char;
			if (ch === DELETE_LINE_CHAR) {
				ev._removed_len = lines[cursorLine].length + 1; // +1 for the newline
				if (cursorLine < lines.length - 1) {
					lines.splice(cursorLine, 1);
					if (cursorLine >= lines.length) cursorLine = lines.length - 1;
				} else {
					lines[cursorLine] = [];
				}
				cursorCol = 0;
			} else if (BACKSPACE_CHARS_SET.has(ch)) {
				if (cursorCol > 0) {
					lines[cursorLine].splice(cursorCol - 1, 1);
					cursorCol--;
				} else if (cursorLine > 0) {
					const prevLen = lines[cursorLine - 1].length;
					lines[cursorLine - 1] = lines[cursorLine - 1].concat(
						lines[cursorLine],
					);
					lines.splice(cursorLine, 1);
					cursorLine--;
					cursorCol = prevLen;
				}
			} else if (DELETE_FWRD_CHARS_SET.has(ch)) {
				if (cursorCol < lines[cursorLine].length) {
					lines[cursorLine].splice(cursorCol, 1);
				} else if (cursorLine < lines.length - 1) {
					lines[cursorLine] = lines[cursorLine].concat(
						lines[cursorLine + 1],
					);
					lines.splice(cursorLine + 1, 1);
				}
			} else if (CURSOR_LEFT_CHARS.has(ch)) {
				if (cursorCol > 0) cursorCol--;
				else if (cursorLine > 0) {
					cursorLine--;
					cursorCol = lines[cursorLine].length;
				}
			} else if (CURSOR_RIGHT_CHARS.has(ch)) {
				if (cursorCol < lines[cursorLine].length) cursorCol++;
				else if (cursorLine < lines.length - 1) {
					cursorLine++;
					cursorCol = 0;
				}
			} else if (CURSOR_UP_CHARS.has(ch)) {
				if (cursorLine > 0) {
					cursorLine--;
					cursorCol = Math.min(cursorCol, lines[cursorLine].length);
				}
			} else if (CURSOR_DOWN_CHARS.has(ch)) {
				if (cursorLine < lines.length - 1) {
					cursorLine++;
					cursorCol = Math.min(cursorCol, lines[cursorLine].length);
				}
			} else if (CURSOR_HOME_CHARS.has(ch)) {
				cursorCol = 0;
			} else if (CURSOR_END_CHARS.has(ch)) {
				cursorCol = lines[cursorLine].length;
			} else if (ch === "\t" || ch === "―") {
				insertChar("\t");
			} else if (ch.length === 1 || ch === "↩") {
				insertChar(ch);
			}
		} else if (typeof ev.code_insert === "string") {
			for (const ch of ev.code_insert) insertChar(ch);
		}
	}
}

function processData(raw) {
	const events = raw.events || raw.keyPresses || [];
	if (!events.length) {
		alert("No events found.");
		return null;
	}

	let editor = "main";
	for (const ev of events) {
		if (ev.switch_editor) editor = ev.switch_editor;
		else if (ev.move_to === "DEV") editor = "dev";
		else if (ev.move_to === "MAIN") editor = "main";
		if (ev._editor == null) ev._editor = editor;
	}

	_annotateRemovedLengths(events);

	const sessionStart = events[0].timestamp / 1000;
	const sessionEnd = events[events.length - 1].timestamp / 1000;
	const charEvents = events.filter((e) => e.char != null);
	const devChars = charEvents.filter((e) => e._editor === "dev");
	const allCharsCount = charEvents.length;
	const mainCharEvents = charEvents.filter(
		(e) => e._editor !== "dev" && !DELETE_CHARS.has(e.char),
	);
	const totalChars = mainCharEvents.length;

	const cumulative = mainCharEvents.map((e, i) => ({
		ts: e.timestamp / 1000,
		count: i + 1,
		event: e,
	}));

	const anchorEvs = events
		.filter((e) => e.anchor != null)
		.map((e) => ({ ...e, _virtualType: "anchor", _target: e.anchor }));
	const moveEvs = events
		.filter(
			(e) =>
				(e.move_to && e.move_to !== "DEV" && e.move_to !== "MAIN") ||
				e.move ||
				e.jump_to,
		)
		.map((e) => ({
			...e,
			_virtualType: "move",
			_target: e.move_to || e.move || e.jump_to,
		}));
	const codeInsertEvs = events
		.filter((e) => e.code_insert != null)
		.map((e) => ({ ...e, _virtualType: "code_insert" }));
	const allTypingEvs = [
		...charEvents,
		...anchorEvs,
		...moveEvs,
		...codeInsertEvs,
	].sort((a, b) => a.timestamp - b.timestamp);

	const { bursts: rawBursts, singletons } = computeBursts(allTypingEvs);

	const sessionRate = allCharsCount / ((sessionEnd - sessionStart) / 60) || 0;
	let totalC = 0,
		totalS = 0;
	for (const b of rawBursts) {
		totalC += b.chars;
		totalS += b.dur || 1;
	}
	const activeRate = totalC > 0 ? (totalC / totalS) * 60 : 0;

	const bursts = [];
	for (const b of rawBursts) {
		const devCharEvs = b.evs.filter(
			(e) => !e._virtualType && e._editor === "dev",
		);
		const nonDevEvs = b.evs
			.filter((e) => e._virtualType || e._editor !== "dev")
			.sort((a, b_) => a.timestamp - b_.timestamp);
		if (devCharEvs.length > 0 && nonDevEvs.length > 0) {
			bursts.push(makeBurst(devCharEvs));
			bursts.push(makeBurst(nonDevEvs));
		} else {
			bursts.push(b);
		}
	}

	const burstGroups = [];
	for (const burst of bursts) {
		const si = lowerBound(cumulative, burst.startTs, (c) => c.ts);
		const ei = upperBound(cumulative, burst.endTs, (c) => c.ts);
		if (ei - si > 1) {
			const idxs = [];
			for (let i = si; i < ei; i++) idxs.push(i);
			burstGroups.push({ burst, idxs });
		}
	}

	const codeInserts = events.filter((e) => e.code_insert != null);
	const deletes = charEvents.filter((e) => DELETE_CHARS.has(e.char));

	const CLOSING_TAGS = ["</html>", "</style>", "</script>"];
	const structuralDeleteTs = new Set();
	for (const b of bursts) {
		if (b.isClosingTagBurst) {
			for (const e of b.evs) {
				if (DELETE_CHARS.has(e.char)) structuralDeleteTs.add(e.timestamp);
			}
		}
	}
	for (const kp of singletons) {
		if (!DELETE_CHARS.has(kp.char)) continue;
		const fwdChars = events
			.filter(
				(e) =>
					e.timestamp > kp.timestamp &&
					e.timestamp < kp.timestamp + 15000 &&
					e.char &&
					!DELETE_CHARS.has(e.char),
			)
			.slice(0, 30)
			.map((e) => e.char)
			.join("");
		if (CLOSING_TAGS.some((t) => fwdChars.includes(t)))
			structuralDeleteTs.add(kp.timestamp);
	}
	for (const e of deletes) {
		if (structuralDeleteTs.has(e.timestamp)) e._isStructuralDelete = true;
	}

	const anchorMap = new Map();
	for (const ev of events) {
		if (ev.anchor == null) continue;
		const key = String(ev.timestamp);
		if (!anchorMap.has(key))
			anchorMap.set(key, { ts: ev.timestamp, ids: [] });
		anchorMap.get(key).ids.push(ev.anchor);
	}
	const anchors = [...anchorMap.values()];

	const moves = [];
	for (const ev of events) {
		if (ev.move_to && ev.move_to !== "DEV" && ev.move_to !== "MAIN")
			moves.push({ ts: ev.timestamp, target: ev.move_to });
		else if (ev.move || ev.jump_to)
			moves.push({ ts: ev.timestamp, target: ev.move || ev.jump_to });
	}

	const interactions = extractInteractions(events);

	const replay = _buildReplayIndex(events, raw.lessonFile || "");

	return {
		sessionStart,
		sessionEnd,
		sessionRate,
		activeRate,
		eventCount: events.length,
		allCharsCount,
		totalChars,
		bursts,
		singletons,
		cumulative,
		burstGroups,
		codeInserts,
		deletes,
		devChars,
		anchors,
		moves,
		interactions,
		events,
		lessonFile: raw.lessonFile || "",
		replay,
	};
}

function _replayFileExt(filename, lessonFile) {
	const m = (filename || "").toLowerCase().match(/\.[^./\\]+$/);
	if (m) return m[0];
	const LP = window.LanguageProfiles;
	if (LP && LP.lessonFileExtension) {
		const ext = LP.lessonFileExtension(lessonFile);
		if (ext) return ext;
	}
	return ".html";
}

function _buildReplayIndex(events, lessonFile) {
	if (typeof headlessReplay !== "function") return null;
	let result;
	try {
		result = headlessReplay(events, lessonFile);
	} catch (e) {
		console.warn("[Timeline] headlessReplay failed:", e);
		return null;
	}
	const LP = window.LanguageProfiles;
	const commentRangesByFile = new Map();
	if (LP) {
		for (const [filename, st] of result.files) {
			const ext = _replayFileExt(filename, lessonFile);
			const profile = ext ? LP.getProfile(ext) : null;
			if (profile) {
				try {
					commentRangesByFile.set(
						filename,
						LP.commentRangesOf(profile, st.text),
					);
				} catch (e) {
					console.warn(
						"[Timeline] commentRangesOf failed for",
						filename,
						e,
					);
				}
			}
		}
	}
	return {
		files: result.files,
		dev: result.dev,
		tsToPos: result.tsToPos,
		commentRangesByFile,
	};
}

function computeBursts(typingEvs) {
	if (!typingEvs.length) return { bursts: [], singletons: [] };
	const bursts = [],
		singletons = [];
	let cur = [typingEvs[0]];
	for (let i = 1; i < typingEvs.length; i++) {
		const gap = (typingEvs[i].timestamp - typingEvs[i - 1].timestamp) / 1000;
		if (gap < CFG.BURST_GAP) {
			cur.push(typingEvs[i]);
		} else {
			if (cur.length >= CFG.MIN_BURST) bursts.push(makeBurst(cur));
			else singletons.push(...cur);
			cur = [typingEvs[i]];
		}
	}
	if (cur.length >= CFG.MIN_BURST) bursts.push(makeBurst(cur));
	else singletons.push(...cur);
	return { bursts, singletons };
}

function makeBurst(evs) {
	const startTs = evs[0].timestamp / 1000;
	const endTs = evs[evs.length - 1].timestamp / 1000;
	const dur = endTs - startTs || 1;
	const charEvs = evs.filter((e) => !e._virtualType);
	const chars = charEvs.length;
	const rate = (chars / dur) * 60;
	const centerTs = (startTs + endTs) / 2;
	const textParts = evs.map(_singletonToTextPart);
	const hasCodeInserts = evs.some((e) => e._virtualType === "code_insert");
	const hasAnchors = evs.some((e) => e._virtualType === "anchor");
	const hasMoves = evs.some((e) => e._virtualType === "move");
	let devCnt = 0,
		remCnt = 0;
	let hasDeleteLine = false;
	for (const e of charEvs) {
		if (e._editor === "dev") devCnt++;
		else if (DELETE_CHARS.has(e.char)) {
			remCnt++;
			if (e.char === "\u26d4") hasDeleteLine = true;
		}
	}
	const forwardText = charEvs
		.filter((e) => !DELETE_CHARS.has(e.char))
		.map((e) => e.char)
		.join("");
	const tokens = (forwardText.match(newTokenRegex()) || []).length;
	const isClosingTagBurst = ["</html>", "</style>", "</script>"].some((t) =>
		forwardText.includes(t),
	);
	const colorType =
		chars === 0
			? "normal"
			: devCnt >= chars / 2
				? "dev"
				: (remCnt > 0 || hasDeleteLine) && !isClosingTagBurst
					? "remove"
					: "normal";
	return {
		startTs,
		endTs,
		centerTs,
		dur,
		chars,
		tokens,
		rate,
		textParts,
		colorType,
		isClosingTagBurst,
		hasCodeInserts,
		hasAnchors,
		hasMoves,
		evs,
	};
}

function extractInteractions(events) {
	const res = {
		"teacher-question": [],
		"student-question": [],
		"providing-help": [],
	};

	function parseField(fieldValue) {
		if (fieldValue == null) return "";
		if (typeof fieldValue === "number") return fieldValue;
		const str = String(fieldValue).trim();
		if (!str) return "";
		const n = Number(str);
		return Number.isInteger(n) && String(n) === str ? n : str;
	}

	for (const ev of events) {
		if (ev.interaction && res[ev.interaction]) {
			const answeredByRaw = ev.answered_by;
			const answeredBy = Array.isArray(answeredByRaw)
				? answeredByRaw
				: answeredByRaw != null
					? String(answeredByRaw)
							.split(",")
							.map((s) => s.trim())
							.filter((s) => s !== "")
							.map((s) => {
								const n = Number(s);
								return Number.isInteger(n) && String(n) === s ? n : s;
							})
					: [];
			res[ev.interaction].push({
				timestamp: ev.timestamp / 1000,
				info: ev.info || "",
				asked_by: parseField(ev.asked_by),
				answered_by: answeredBy,
				student: parseField(ev.student),
				closed_at: ev.closed_at != null ? ev.closed_at / 1000 : null,
			});
		}
	}
	return res;
}

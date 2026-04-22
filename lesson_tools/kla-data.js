"use strict";

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

	const sessionStart = events[0].timestamp / 1000;
	const sessionEnd = events[events.length - 1].timestamp / 1000;
	const charEvents = events.filter((e) => e.char != null);
	const devChars = charEvents.filter((e) => e._editor === "dev");
	const allCharsCount = charEvents.length;
	// Forward-progress chars only: exclude dev editor and delete chars
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
		const nonDevCharEvs = b.evs.filter(
			(e) => !e._virtualType && e._editor !== "dev",
		);
		if (devCharEvs.length > 0 && nonDevCharEvs.length > 0) {
			// Dev-only bar
			bursts.push(makeBurst(devCharEvs));
			// Non-dev bar: retains virtual events (anchors, moves, inserts)
			const nonDevEvs = b.evs
				.filter((e) => e._virtualType || e._editor !== "dev")
				.sort((a, b_) => a.timestamp - b_.timestamp);
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
	const textParts = evs.map((e) => {
		if (e._virtualType === "anchor") return { t: e._target, type: "anchor" };
		if (e._virtualType === "move") return { t: e._target, type: "move" };
		if (e._virtualType === "code_insert")
			return { t: e.code_insert || "", type: "code_insert" };
		return { t: e.char || "", type: "char" };
	});
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
	for (const ev of events) {
		if (ev.interaction && res[ev.interaction]) {
			res[ev.interaction].push({
				timestamp: ev.timestamp / 1000,
				info: ev.info || "",
				asked_by: ev.asked_by || "",
				answered_by: ev.answered_by
					? String(ev.answered_by)
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)
					: [],
				student: ev.student || "",
				closed_at: ev.closed_at != null ? ev.closed_at / 1000 : null,
			});
		}
	}
	return res;
}

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
	const totalChars = charEvents.length;

	const cumulative = charEvents.map((e, i) => ({
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

	const { bursts, singletons } = computeBursts(allTypingEvs);

	const sessionRate = totalChars / ((sessionEnd - sessionStart) / 60) || 0;
	let totalC = 0,
		totalS = 0;
	for (const b of bursts) {
		totalC += b.chars;
		totalS += b.dur || 1;
	}
	const activeRate = totalC > 0 ? (totalC / totalS) * 60 : 0;

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
	const devChars = charEvents.filter((e) => e._editor === "dev");

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
	const colorType =
		chars === 0
			? "normal"
			: devCnt >= chars / 2
				? "dev"
				: hasDeleteLine || remCnt >= chars / 2
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
		hasCodeInserts,
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

const {
	TextState,
	applyTypedText,
	applyAtomicText,
	replayOpensCloses,
} = require("../../lesson_tools/shared/simulator-model");
const { initProfiles } = require("../../lesson_tools/languages/profiles");
const {
	classifyMoveToTarget,
	moveToDisplayName,
} = require("../shared/move-to-target");
const { getBlockKind, stripBlockPrefix } = require("../shared/blocks");
const {
	HL_COLORS,
	buildHighlightSpans,
} = require("../../lesson_tools/shared/simulator-highlight");

initProfiles();

function typingOpts(name) {
	return { getOpensCloses: replayOpensCloses(name, null) };
}

function highlightType(name) {
	const m = /\.([^.]+)$/.exec(name || "");
	return m ? m[1].toLowerCase() : "html";
}

function editorTarget(name) {
	if (name === "main") return "MAIN";
	if (name === "dev") return "DEV";
	return name;
}

function openEditor(editors, name) {
	if (!editors[name]) editors[name] = new TextState();
	return editors[name];
}

function applyBlock(editors, active, block, tag = 0) {
	if (!block) return active;
	if (block.type === "code") {
		openEditor(editors, active);
		applyTypedText(
			editors[active],
			block.text || "",
			tag,
			typingOpts(active),
		);
		return active;
	}
	if (block.type === "move-to") {
		const t = classifyMoveToTarget(block.target || "");
		if (t.mode === "main") {
			openEditor(editors, "main");
			return "main";
		}
		if (t.mode === "dev") {
			openEditor(editors, "dev");
			return "dev";
		}
		if (t.mode === "file") {
			openEditor(editors, t.target);
			return t.target;
		}
		for (const [name, st] of Object.entries(editors)) {
			if (st.anchors[t.inner] != null) {
				st.jumpToAnchor(t.inner);
				return name;
			}
		}
		return active;
	}
	if (block.type === "comment" && getBlockKind(block.text) === "snippet") {
		openEditor(editors, active);
		applyAtomicText(
			editors[active],
			stripBlockPrefix(block.text || ""),
			tag,
			typingOpts(active),
		);
	}
	return active;
}

function replayPlan(blocks, stopAt = Infinity) {
	const editors = { main: new TextState() };
	let active = "main";
	const stop = Math.min(stopAt, blocks.length);
	for (let i = 0; i < stop; i++) {
		active = applyBlock(editors, active, blocks[i]);
	}
	return { editors, active };
}

function filesOf(editors) {
	return Object.entries(editors)
		.filter(([, state]) => state.text)
		.map(([name, state]) => ({
			name,
			label: moveToDisplayName(editorTarget(name)),
			text: state.text,
		}));
}

function typedPrefix(text, caret) {
	let cut = Math.max(0, Math.min(caret, text.length));
	for (const m of text.matchAll(/⚓\d*⚓/g)) {
		if (m.index < cut && cut < m.index + m[0].length) cut = m.index;
	}
	return text.slice(0, cut);
}

const CARET_TAG = "caret";

function markCaret(state, tag) {
	const after = state.cursor > 0;
	const at = after ? state.cursor - 1 : 0;
	if (at >= state.charTs.length) return null;
	const own = state.charTs[at] === tag;
	state.charTs[at] = CARET_TAG;
	return { after, own };
}

function marksIn(state, tag, caretMark) {
	const ranges = [];
	let caret = null;
	let lastHead = -1;
	let firstTail = -1;
	state.charTs.forEach((t, i) => {
		let mine = t === tag || t === -tag;
		if (t === CARET_TAG) {
			caret = caretMark.after ? i + 1 : i;
			mine = caretMark.own;
		}
		if (t === tag) lastHead = i;
		if (t === -tag && firstTail < 0) firstTail = i;
		if (!mine) return;
		const last = ranges[ranges.length - 1];
		if (last && last[1] === i) last[1] = i + 1;
		else ranges.push([i, i + 1]);
	});
	if (caret === null && caretMark) {
		if (lastHead >= 0) caret = lastHead + 1;
		else if (firstTail >= 0) caret = firstTail;
	}
	return { ranges, caret };
}

function replayMarked(blocks, focus = null) {
	const editors = { main: new TextState() };
	let active = "main";
	const tag = focus ? focus.index + 1 : null;
	let caretMark = null;
	blocks.forEach((block, i) => {
		const split =
			i + 1 === tag &&
			block &&
			block.type === "code" &&
			Number.isInteger(focus.caret);
		if (!split) {
			active = applyBlock(editors, active, block, i + 1);
			return;
		}
		const text = block.text || "";
		const head = typedPrefix(text, focus.caret);
		active = applyBlock(editors, active, { ...block, text: head }, tag);
		caretMark = markCaret(editors[active], tag) || {
			after: false,
			own: false,
		};
		const tail = { ...block, text: text.slice(head.length) };
		active = applyBlock(editors, active, tail, -tag);
	});

	const marks = {};
	let marked = null;
	if (tag !== null) {
		for (const [name, state] of Object.entries(editors)) {
			const found = marksIn(state, tag, caretMark);
			if (!found.ranges.length && found.caret === null) continue;
			marks[name] = found;
			if (!marked) marked = name;
		}
	}
	return { files: filesOf(editors), active, marks, marked };
}

function fileColoredLines(name, text) {
	const lines = text.split("\n");
	return buildColoredLines(
		text,
		0,
		lines.length - 1,
		lines,
		highlightType(name),
	);
}

function buildColoredLines(
	fullText,
	fromLineIdx,
	toLineIdx,
	lines,
	fileType = "html",
) {
	const allLines = lines || fullText.split("\n");
	const lineStarts = [0];
	for (let i = 0; i < allLines.length; i++) {
		lineStarts.push(lineStarts[i] + allLines[i].length + 1);
	}

	let spans = [];
	try {
		spans = buildHighlightSpans(fullText, fileType);
	} catch (_) {
		return null;
	}

	const result = [];
	let spanIdx = 0;
	for (let li = fromLineIdx; li <= toLineIdx; li++) {
		const lineStart = lineStarts[li];
		const lineEnd = lineStart + allLines[li].length;
		const segs = [];
		let cursor = lineStart;
		while (spanIdx < spans.length && spans[spanIdx].end <= lineStart) {
			spanIdx++;
		}
		let sIdx = spanIdx;
		while (sIdx < spans.length && spans[sIdx].start < lineEnd) {
			const span = spans[sIdx];
			const sStart = Math.max(span.start, lineStart);
			const sEnd = Math.min(span.end, lineEnd);
			if (cursor < sStart) {
				segs.push({ text: fullText.slice(cursor, sStart), color: null });
			}
			segs.push({
				text: fullText.slice(sStart, sEnd),
				color: HL_COLORS[span.cls] || null,
			});
			cursor = sEnd;
			sIdx++;
		}
		if (cursor < lineEnd) {
			segs.push({ text: fullText.slice(cursor, lineEnd), color: null });
		}
		result.push(segs);
	}
	return result;
}

function snippetAt(name, state, pos, before, after) {
	const beforeText = state.text.slice(0, pos);
	const lineIdx = (beforeText.match(/\n/g) || []).length;
	const lineStart = beforeText.lastIndexOf("\n") + 1;
	const col = pos - lineStart;

	const lines = state.text.split("\n");
	const start = Math.max(0, lineIdx - before);
	const end = Math.min(lines.length - 1, lineIdx + after);
	return {
		lines: lines.slice(start, end + 1),
		colored: buildColoredLines(
			state.text,
			start,
			end,
			lines,
			highlightType(name),
		),
		arrowIdx: lineIdx - start,
		anchorCol: col,
	};
}

function computeSnippetFor(target, editors, active, before, after) {
	const t = classifyMoveToTarget(target);

	if (t.mode !== "anchor") {
		const name = t.mode === "file" ? t.target : t.mode;
		const state = editors[name];
		if (!state || !state.text) return null;
		return {
			...snippetAt(name, state, state.cursor, before, after),
			file: editorTarget(name),
			switchTo: null,
		};
	}

	const id = t.inner;
	let found = null;
	if (editors[active] && editors[active].anchors[id] != null) {
		found = active;
	} else {
		for (const [name, st] of Object.entries(editors)) {
			if (st.anchors[id] != null) {
				found = name;
				break;
			}
		}
	}
	if (found === null) return null;
	const state = editors[found];
	return {
		...snippetAt(found, state, state.anchors[id], before, after),
		file: editorTarget(found),
		switchTo: found === active ? null : editorTarget(found),
	};
}

function extractAnchorSnippet(
	target,
	currentBlockIdx,
	blocks,
	before = 5,
	after = 5,
) {
	const { editors, active } = replayPlan(blocks, currentBlockIdx);
	return computeSnippetFor(target, editors, active, before, after);
}

function computeMoveToSnippets(blocks, before = 5, after = 5) {
	const editors = { main: new TextState() };
	let active = "main";
	const snippets = new Map();

	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		if (!block) continue;
		if (block.type === "move-to") {
			snippets.set(
				i,
				computeSnippetFor(
					block.target || "MAIN",
					editors,
					active,
					before,
					after,
				),
			);
		}
		active = applyBlock(editors, active, block);
	}
	return snippets;
}

module.exports = {
	extractAnchorSnippet,
	computeMoveToSnippets,
	buildColoredLines,
	replayPlan,
	replayMarked,
	fileColoredLines,
};

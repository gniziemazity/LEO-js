const {
	TextState,
	applyTypedText,
	applyAtomicText,
} = require("../../lesson_tools/shared/simulator-model");
const { classifyMoveToTarget } = require("../shared/move-to-target");
const { getBlockKind, stripBlockPrefix } = require("../shared/blocks");
const {
	HL_COLORS,
	buildHighlightSpans,
} = require("../../lesson_tools/shared/simulator-highlight");

function editorTarget(name) {
	if (name === "main") return "MAIN";
	if (name === "dev") return "DEV";
	return name;
}

function openEditor(editors, name) {
	if (!editors[name]) editors[name] = new TextState();
	return editors[name];
}

function applyBlock(editors, active, block) {
	if (!block) return active;
	if (block.type === "code") {
		openEditor(editors, active);
		applyTypedText(editors[active], block.text || "");
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
		applyAtomicText(editors[active], stripBlockPrefix(block.text || ""));
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

function buildColoredLines(fullText, fromLineIdx, toLineIdx, lines) {
	const allLines = lines || fullText.split("\n");
	const lineStarts = [0];
	for (let i = 0; i < allLines.length; i++) {
		lineStarts.push(lineStarts[i] + allLines[i].length + 1);
	}

	let spans = [];
	try {
		spans = buildHighlightSpans(fullText, "html");
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

function snippetAt(state, pos, before, after) {
	const beforeText = state.text.slice(0, pos);
	const lineIdx = (beforeText.match(/\n/g) || []).length;
	const lineStart = beforeText.lastIndexOf("\n") + 1;
	const col = pos - lineStart;

	const lines = state.text.split("\n");
	const start = Math.max(0, lineIdx - before);
	const end = Math.min(lines.length - 1, lineIdx + after);
	return {
		lines: lines.slice(start, end + 1),
		colored: buildColoredLines(state.text, start, end, lines),
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
			...snippetAt(state, state.cursor, before, after),
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
		...snippetAt(state, state.anchors[id], before, after),
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
};

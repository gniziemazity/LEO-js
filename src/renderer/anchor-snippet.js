const {
	TextState,
	applyTypedText,
	applyAtomicText,
} = require("../../lesson_tools/shared/simulator-model");
const {
	classifyMoveToTarget,
	isFileName,
} = require("../shared/move-to-target");
const {
	HL_COLORS,
	buildHighlightSpans,
} = require("../../lesson_tools/shared/simulator-highlight");

function editorTarget(name) {
	if (name === "main") return "MAIN";
	if (name === "dev") return "DEV";
	return name;
}

function extractAnchorSnippet(
	target,
	currentBlockIdx,
	blocks,
	before = 5,
	after = 5,
) {
	const anchor = classifyMoveToTarget(target);
	if (anchor.mode !== "anchor") return null;
	const id = anchor.inner;

	const editors = { main: new TextState() };
	let active = "main";
	const stop = Math.min(currentBlockIdx, blocks.length);
	for (let i = 0; i < stop; i++) {
		const b = blocks[i];
		if (!b) continue;
		if (b.type === "code") {
			if (!editors[active]) editors[active] = new TextState();
			applyTypedText(editors[active], b.text || "");
		} else if (b.type === "move-to") {
			const t = b.target || "";
			if (t === "MAIN") {
				if (!editors.main) editors.main = new TextState();
				active = "main";
			} else if (t === "DEV") {
				if (!editors.dev) editors.dev = new TextState();
				active = "dev";
			} else {
				const { wrapped, inner } = classifyMoveToTarget(t);
				if (isFileName(inner)) {
					if (!editors[inner]) editors[inner] = new TextState();
					active = inner;
				} else if (wrapped) {
					for (const [name, st] of Object.entries(editors)) {
						if (st.anchors[inner] != null) {
							active = name;
							st.jumpToAnchor(inner);
							break;
						}
					}
				}
			}
		} else if (b.type === "comment") {
			const txt = (b.text || "").trim();
			if (txt.startsWith("📋")) {
				if (!editors[active]) editors[active] = new TextState();
				const stripped = (b.text || "").replace(/^📋\s?/, "");
				applyAtomicText(editors[active], stripped);
			}
		}
	}

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

	const pos = state.anchors[id];
	const beforeText = state.text.slice(0, pos);
	const lineIdx = (beforeText.match(/\n/g) || []).length;
	const lineStart = beforeText.lastIndexOf("\n") + 1;
	const col = pos - lineStart;

	const lines = state.text.split("\n");
	const start = Math.max(0, lineIdx - before);
	const end = Math.min(lines.length - 1, lineIdx + after);
	const sliceLines = lines.slice(start, end + 1);
	const colored = buildColoredLines(state.text, start, end);
	return {
		lines: sliceLines,
		colored,
		arrowIdx: lineIdx - start,
		anchorCol: col,
		switchTo: found === active ? null : editorTarget(found),
	};
}

function buildColoredLines(fullText, fromLineIdx, toLineIdx) {
	let spans = [];
	try {
		spans = buildHighlightSpans(fullText, "html");
	} catch (_) {
		return null;
	}
	const lines = fullText.split("\n");
	const lineStarts = [0];
	for (let i = 0; i < lines.length; i++) {
		lineStarts.push(lineStarts[i] + lines[i].length + 1);
	}
	const result = [];
	let spanIdx = 0;
	for (let li = fromLineIdx; li <= toLineIdx; li++) {
		const lineStart = lineStarts[li];
		const lineEnd = lineStart + lines[li].length;
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

module.exports = { extractAnchorSnippet, buildColoredLines };

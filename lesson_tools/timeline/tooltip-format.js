"use strict";

const _NBSP = "\u00A0";

function textPartsToHtml(parts, partColors, evs, replay) {
	const colors = partColors || null;
	const deco = _computeBurstDecorations(parts, evs, replay);
	let html = "";
	let pendingBuf = "";
	let pendingColor = null;
	let pendingDeco = null;
	const flushPending = () => {
		if (!pendingBuf) return;
		if (pendingColor) {
			html += `<span class="tt-emph" style="color:${pendingColor}">${pendingBuf}</span>`;
		} else {
			const open = _decoSpanOpen(pendingDeco);
			html += open ? `${open}${pendingBuf}</span>` : pendingBuf;
		}
		pendingBuf = "";
		pendingColor = null;
		pendingDeco = null;
	};
	for (let i = 0; i < parts.length; i++) {
		const p = parts[i];
		if (p.type === "anchor") {
			flushPending();
			html += `<span class="tt-anchor">${escHtml(p.t)}</span>`;
		} else if (p.type === "move") {
			flushPending();
			html += `<span class="tt-move">→${escHtml(p.t)}</span>`;
		} else if (p.type === "code_insert") {
			flushPending();
			const display = _displayCodeInsert(p.t);
			const offsetColors = colors ? colors.get(i) : null;
			const offsetColorsMap =
				offsetColors instanceof Map ? offsetColors : null;
			let curColor = null;
			let curDeco = null;
			let curBuf = "";
			const flushSeg = () => {
				if (!curBuf) return;
				if (curColor) {
					html += `<span class="tt-emph tt-pasted" style="color:${curColor}">${escHtml(curBuf)}</span>`;
				} else if (curDeco === "ghost") {
					html += `<span class="tt-mark-ghost tt-pasted">${escHtml(curBuf)}</span>`;
				} else if (curDeco === "comment") {
					html += `<span class="tt-mark-comment tt-pasted">${escHtml(curBuf)}</span>`;
				} else {
					html += `<span class="tt-mark-extra tt-pasted">${escHtml(curBuf)}</span>`;
				}
				curBuf = "";
			};
			for (let k = 0; k < display.length; k++) {
				const c = offsetColorsMap ? offsetColorsMap.get(k) || null : null;
				const d = c ? null : _decoForInsertOffset(deco, i, k);
				if (c !== curColor || d !== curDeco) {
					flushSeg();
					curColor = c;
					curDeco = d;
				}
				curBuf += display[k];
			}
			flushSeg();
		} else {
			{
				const ch = p.t;
				if (DELETE_CHARS.has(ch)) {
					flushPending();
					let isPaleRed = false;
					if (ch === "\u232b") {
						const nextChars = parts
							.slice(i + 1)
							.filter((x) => x.type === "char")
							.slice(0, 4)
							.map((x) => x.t)
							.join("");
						isPaleRed = nextChars.startsWith("</");
					}
					const cls = isPaleRed ? "tt-delete-pale" : "tt-delete";
					html += `<span class="${cls}">${escHtml(ch)}</span>`;
				} else {
					const color = colors ? colors.get(i) || null : null;
					const d = color ? null : _decoForChar(deco, i);
					const rendered = escHtml(ch === "↩" ? "\n" : ch);
					if (color !== pendingColor || d !== pendingDeco) {
						flushPending();
						pendingColor = color;
						pendingDeco = d;
					}
					pendingBuf += rendered;
				}
			}
		}
	}
	flushPending();
	return html;
}

function _buildPartColorsForMismatches(b, mismatches) {
	const parts = b.textParts || [];
	const evs = b.evs || [];
	const codeChars = [];
	let needsBoundary = false;
	for (let pi = 0; pi < parts.length; pi++) {
		const p = parts[pi];
		if (p.type === "move") {
			needsBoundary = true;
			continue;
		}
		if (p.type !== "char" && p.type !== "code_insert") continue;
		if (p.type === "char" && DELETE_CHARS.has(p.t)) {
			needsBoundary = true;
			continue;
		}
		let text;
		if (p.type === "char") {
			text = p.t === "↩" ? "\n" : p.t || "";
		} else {
			text = _displayCodeInsert(p.t);
		}
		if (!text) continue;
		if (needsBoundary && codeChars.length > 0) {
			codeChars.push({ partIdx: -1, partOffset: -1, ch: " ", ts: 0 });
		}
		needsBoundary = false;
		const baseTs = (evs[pi]?.timestamp ?? 0) / 1000;
		const secPerChar = CFG.CODE_INSERT_MS_PER_CHAR / 1000;
		const perCharBump = p.type === "code_insert" ? secPerChar : 0;
		for (let k = 0; k < text.length; k++) {
			const ts = baseTs + k * perCharBump;
			codeChars.push({ partIdx: pi, partOffset: k, ch: text[k], ts });
		}
	}
	const codeStr = codeChars.map((c) => c.ch).join("");
	const tokenRe = newTokenRegex();
	const burstTokens = [];
	let m;
	while ((m = tokenRe.exec(codeStr)) !== null) {
		const tok = m[0];
		const startIdx = m.index;
		const endIdx = m.index + tok.length;
		if (endIdx - 1 >= codeChars.length) break;
		const ts = codeChars[endIdx - 1].ts;
		burstTokens.push({
			token: tok,
			startIdx,
			endIdx,
			ts,
			claimed: false,
		});
	}
	const candidates = [];
	const candKeys = new Set();
	for (const mm of mismatches || []) {
		if (mm.kind !== "missing") continue;
		const tok = mm.token || mm.label || "";
		if (!tok || mm.ts == null) continue;
		const key = `${tok}\0${mm.ts}`;
		if (candKeys.has(key)) continue;
		candKeys.add(key);
		candidates.push({
			token: tok,
			ts: mm.ts,
			lang: mm.lang || null,
			claimed: false,
		});
	}
	const maxCodeInsertChars = parts.reduce((acc, p) => {
		if (p.type !== "code_insert") return acc;
		const len = _displayCodeInsert(p.t || "").length;
		return Math.max(acc, len);
	}, 0);
	const tolerance =
		1 + (maxCodeInsertChars * CFG.CODE_INSERT_MS_PER_CHAR) / 1000;
	const pairs = [];
	for (let bi = 0; bi < burstTokens.length; bi++) {
		for (let ci = 0; ci < candidates.length; ci++) {
			if (burstTokens[bi].token !== candidates[ci].token) continue;
			const diff = burstTokens[bi].ts - candidates[ci].ts;
			if (diff < -tolerance || diff > tolerance) continue;
			pairs.push({ bi, ci, diff });
		}
	}
	pairs.sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
	const partColors = new Map();
	const fallbackColor = _cssVar("--clr-mark-missing");
	for (const pair of pairs) {
		if (burstTokens[pair.bi].claimed || candidates[pair.ci].claimed) continue;
		burstTokens[pair.bi].claimed = true;
		candidates[pair.ci].claimed = true;
		const bt = burstTokens[pair.bi];
		const cand = candidates[pair.ci];
		const color = _langBarColorOf(cand.lang) || fallbackColor;
		for (let j = bt.startIdx; j < bt.endIdx; j++) {
			const cc = codeChars[j];
			const part = parts[cc.partIdx];
			if (part.type === "code_insert") {
				let m = partColors.get(cc.partIdx);
				if (!(m instanceof Map)) {
					m = new Map();
					partColors.set(cc.partIdx, m);
				}
				m.set(cc.partOffset, color);
			} else {
				partColors.set(cc.partIdx, color);
			}
		}
	}
	return partColors;
}

function _langClassFor(lang) {
	return _langBarColorOf(lang)
		? `tt-lang-${lang.toLowerCase()}`
		: "tt-lang-unk";
}

function _tokenSpansHtml(evs) {
	return (evs || [])
		.map((e) => {
			const tok = e.token != null ? e.token : e.label || "";
			const cls = _langClassFor(e.lang);
			const ghost = e.kind === "extra-star" ? " tt-ghost" : "";
			return `<span class="${cls}${ghost}">${escHtml(tok)}</span>`;
		})
		.join(" ");
}

function _renderStudentGrid(sorted, blockLangs, perLangCounts, maxLangWidths) {
	const maxIdLen = sorted.reduce(
		(m, { s }) => Math.max(m, (s.id || "").length),
		0,
	);
	const hasLangCells = blockLangs && blockLangs.length > 0;
	let grid = '<div class="tt-grid">';
	sorted.forEach(({ s, evs }, i) => {
		const langCellsHtml = hasLangCells
			? blockLangs
					.map((l, ci) => {
						const num = perLangCounts[i][ci].padStart(
							maxLangWidths[ci],
							_NBSP,
						);
						return `<span class="${_langClassFor(l)}">${escHtml(num)}</span>`;
					})
					.join('<span class="tt-lang-sep">+</span>')
			: "";
		const idPadded = (s.id || "").padStart(maxIdLen, _NBSP);
		const idPrefix = s.id ? `${escHtml(idPadded)}: ` : "";
		grid +=
			`<div><span data-bar-student-idx="${i}" class="tt-student">${idPrefix}${escHtml(s.name)}</span></div>` +
			`<div class="tt-langcell">${langCellsHtml}</div>` +
			`<div class="tt-tokens">${_tokenSpansHtml(evs)}</div>`;
	});
	grid += "</div>";
	return grid;
}

function _wrapBarTooltip(headerHtml, gridHtml) {
	return [
		`<div class="tt-bar-fixed">${headerHtml}</div>`,
		`<div class="tt-bar-fixed">──────────</div>`,
		`<div class="tt-bar-scroll">${gridHtml}</div>`,
	].join("");
}

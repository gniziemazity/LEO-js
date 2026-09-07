(function (root) {
	const ANCHOR_RE = /⚓[^⚓]*⚓/g;

	function createCharSpan(char, stepIndex, holdLine) {
		let el = document.createElement("span");
		el.className = "char";
		if (char === "\n") {
			if (holdLine) {
				el.classList.add("trailing-newline");
				el.textContent = "\u200b";
			} else {
				el = document.createElement("br");
			}
		} else if (char === " ") {
			el.innerHTML = "&nbsp;";
		} else {
			el.textContent = char;
		}
		el.dataset.stepIndex = stepIndex;
		return el;
	}

	function createAnchorSpan(value, stepIndex) {
		const span = document.createElement("span");
		span.className = "char anchor-token";
		span.textContent = value;
		span.dataset.stepIndex = stepIndex;
		return span;
	}

	function isEmptyLineBlock(el) {
		return el.childNodes.length === 1 && el.childNodes[0].nodeName === "BR";
	}

	function readCodeText(el) {
		let text = "";
		const append = (node) => {
			for (const child of node.childNodes) {
				if (child.nodeType === 3) {
					text += child.data;
				} else if (child.dataset && child.dataset.blockOpt) {
					continue;
				} else if (child.nodeName === "BR") {
					text += "\n";
				} else {
					text += "\n";
					if (!isEmptyLineBlock(child)) append(child);
				}
			}
		};
		append(el);
		return text;
	}

	function writeCodeText(el, text) {
		el.textContent = "";
		const body = text.replace(/\n+$/, "");
		if (body) el.appendChild(document.createTextNode(body));
		for (let i = body.length; i < text.length; i++) {
			const line = document.createElement("div");
			line.appendChild(document.createElement("br"));
			el.appendChild(line);
		}
	}

	function splitAnchorSegments(text) {
		const segments = [];
		let lastIndex = 0;
		let match;
		ANCHOR_RE.lastIndex = 0;
		while ((match = ANCHOR_RE.exec(text)) !== null) {
			if (match.index > lastIndex) {
				segments.push({
					type: "text",
					value: text.slice(lastIndex, match.index),
				});
			}
			segments.push({ type: "anchor", value: match[0] });
			lastIndex = match.index + match[0].length;
		}
		if (lastIndex < text.length) {
			segments.push({ type: "text", value: text.slice(lastIndex) });
		}
		return segments;
	}

	function normalizeEdgeNewlines(text) {
		const s = String(text == null ? "" : text);
		const lead = s.length - s.replace(/^\n+/, "").length;
		const body = s.slice(lead);
		const trail = body.length - body.replace(/\n+$/, "").length;
		return (
			"↩".repeat(lead) +
			body.slice(0, body.length - trail) +
			"↩".repeat(trail)
		);
	}

	function stripAnchors(text) {
		return splitAnchorSegments(String(text || ""))
			.filter((seg) => seg.type === "text")
			.map((seg) => seg.value)
			.join("");
	}

	function buildCodeText(text, container, startIndex, onStep) {
		let stepIndex = startIndex;
		const segments = splitAnchorSegments(text);
		const trailingFrom = text.replace(/\n+$/, "").length;
		let offset = 0;
		for (const seg of segments) {
			if (seg.type === "anchor") {
				const span = createAnchorSpan(seg.value, stepIndex);
				container.appendChild(span);
				if (onStep)
					onStep({
						type: "anchor",
						element: span,
						value: seg.value,
						globalIndex: stepIndex,
					});
				stepIndex++;
				offset += seg.value.length;
			} else {
				for (const char of seg.value) {
					const isTrailingNewline =
						char === "\n" && offset >= trailingFrom;
					const span = createCharSpan(char, stepIndex, isTrailingNewline);
					if (isTrailingNewline)
						container.appendChild(document.createElement("br"));
					container.appendChild(span);
					if (onStep)
						onStep({
							type: "char",
							element: span,
							char: char,
							globalIndex: stepIndex,
						});
					stepIndex++;
					offset += char.length;
				}
			}
		}
		return stepIndex;
	}

	const api = {
		readCodeText,
		writeCodeText,
		stripAnchors,
		normalizeEdgeNewlines,
		buildCodeText,
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
	root.CodeTextRenderer = api;
})(typeof window !== "undefined" ? window : this);

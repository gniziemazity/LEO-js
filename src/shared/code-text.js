(function (root) {
	const ANCHOR_RE = /⚓[^⚓]*⚓/g;

	function createCharSpan(char, stepIndex) {
		let el = document.createElement("span");
		el.className = "char";
		if (char === "\n") {
			el = document.createElement("br");
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

	function buildCodeText(text, container, startIndex, onStep) {
		let stepIndex = startIndex;
		const segments = splitAnchorSegments(text);
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
			} else {
				for (const char of seg.value) {
					const span = createCharSpan(char, stepIndex);
					container.appendChild(span);
					if (onStep)
						onStep({
							type: "char",
							element: span,
							char: char,
							globalIndex: stepIndex,
						});
					stepIndex++;
				}
			}
		}
		return stepIndex;
	}

	const api = {
		ANCHOR_RE,
		createCharSpan,
		createAnchorSpan,
		splitAnchorSegments,
		buildCodeText,
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
	root.CodeTextRenderer = api;
})(typeof window !== "undefined" ? window : this);

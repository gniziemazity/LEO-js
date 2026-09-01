(function (root) {
	function makeSegSpan(text, color) {
		const span = document.createElement("span");
		span.textContent = text;
		if (color) span.style.color = color;
		return span;
	}

	function makeCursorSpan() {
		const cursor = document.createElement("span");
		cursor.className = "mt-modal-anchor-cursor";
		cursor.textContent = " ";
		return cursor;
	}

	function renderLine(row, segs) {
		for (const seg of segs) row.appendChild(makeSegSpan(seg.text, seg.color));
	}

	function renderLineWithArrow(row, segs, col) {
		let consumed = 0;
		let inserted = false;
		for (const seg of segs) {
			if (!inserted && consumed + seg.text.length >= col) {
				const cut = col - consumed;
				if (cut > 0)
					row.appendChild(makeSegSpan(seg.text.slice(0, cut), seg.color));
				row.appendChild(makeCursorSpan());
				if (cut < seg.text.length)
					row.appendChild(makeSegSpan(seg.text.slice(cut), seg.color));
				inserted = true;
			} else {
				row.appendChild(makeSegSpan(seg.text, seg.color));
			}
			consumed += seg.text.length;
		}
		if (!inserted) row.appendChild(makeCursorSpan());
	}

	function segsFor(colored, lines, i) {
		if (colored && colored[i]) return colored[i];
		return [{ text: lines[i] || "", color: null }];
	}

	function renderSnippet(container, snippet) {
		container.innerHTML = "";
		if (!snippet || !snippet.lines || !snippet.lines.length) return false;
		const col = Math.max(0, snippet.anchorCol || 0);
		snippet.lines.forEach((line, i) => {
			const row = document.createElement("div");
			row.className = "mt-modal-line";
			const segs = segsFor(snippet.colored, snippet.lines, i);
			if (i === snippet.arrowIdx) renderLineWithArrow(row, segs, col);
			else renderLine(row, segs);
			container.appendChild(row);
		});
		return true;
	}

	function renderLines(container, text, colored) {
		container.innerHTML = "";
		const lines = String(text == null ? "" : text).split("\n");
		lines.forEach((line, i) => {
			const row = document.createElement("div");
			row.className = "mt-modal-line";
			renderLine(row, segsFor(colored, lines, i));
			container.appendChild(row);
		});
	}

	function renderTypedName(container, name, typed) {
		container.innerHTML = "";
		const text = String(name == null ? "" : name);
		if (typed == null) {
			container.textContent = text;
			return;
		}
		const chars = [...text, "↩"];
		chars.forEach((ch, i) => {
			const span = document.createElement("span");
			span.textContent = ch;
			if (i === typed) span.className = "mt-modal-anchor-cursor";
			else if (i < typed) span.className = "mto-name-typed";
			container.appendChild(span);
		});
	}

	const api = {
		renderSnippet,
		renderLines,
		renderTypedName,
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
	root.SnippetView = api;
})(typeof window !== "undefined" ? window : this);

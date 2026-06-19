class MoveToOverlay extends RemoteOverlay {
	constructor() {
		super("moveToOverlay");
	}

	makeSegSpan(text, color) {
		const span = document.createElement("span");
		span.textContent = text;
		if (color) span.style.color = color;
		return span;
	}

	makeCursorSpan() {
		const cursor = document.createElement("span");
		cursor.className = "mt-modal-anchor-cursor";
		cursor.textContent = " ";
		return cursor;
	}

	renderLine(row, segs) {
		for (const seg of segs)
			row.appendChild(this.makeSegSpan(seg.text, seg.color));
	}

	renderLineWithArrow(row, segs, col) {
		let consumed = 0;
		let inserted = false;
		for (const seg of segs) {
			if (!inserted && consumed + seg.text.length >= col) {
				const cut = col - consumed;
				if (cut > 0)
					row.appendChild(
						this.makeSegSpan(seg.text.slice(0, cut), seg.color),
					);
				row.appendChild(this.makeCursorSpan());
				if (cut < seg.text.length)
					row.appendChild(
						this.makeSegSpan(seg.text.slice(cut), seg.color),
					);
				inserted = true;
			} else {
				row.appendChild(this.makeSegSpan(seg.text, seg.color));
			}
			consumed += seg.text.length;
		}
		if (!inserted) row.appendChild(this.makeCursorSpan());
	}

	show(payload) {
		const { mode, target, snippet } = payload || {};
		const overlay = this.el;
		const emojiEl = document.getElementById("mtoEmoji");
		const titleEl = document.getElementById("mtoTitle");
		const targetEl = document.getElementById("mtoTarget");
		const snippetEl = document.getElementById("mtoSnippet");
		if (!overlay) return;

		if (emojiEl) emojiEl.style.display = "none";
		if (titleEl) titleEl.textContent = "Go to:";

		snippetEl.style.display = "none";
		snippetEl.innerHTML = "";
		targetEl.style.display = "none";
		targetEl.textContent = "";

		if (mode === "dev") {
			targetEl.style.display = "";
			targetEl.textContent = "Dev Tools";
		} else if (mode === "main") {
			targetEl.style.display = "";
			targetEl.textContent = "Main Editor";
		} else if (mode === "file") {
			targetEl.style.display = "";
			const fname =
				target && target.startsWith("⚓") && target.endsWith("⚓")
					? target.slice(1, -1)
					: target || "";
			targetEl.textContent = fname;
		} else if (mode === "anchor") {
			if (snippet && snippet.lines && snippet.lines.length) {
				snippetEl.style.display = "block";
				const col = Math.max(0, snippet.anchorCol || 0);
				const colored = snippet.colored || null;
				snippet.lines.forEach((line, i) => {
					const row = document.createElement("div");
					row.className = "mt-modal-line";
					const segs =
						colored && colored[i]
							? colored[i]
							: [{ text: line || "", color: null }];
					if (i === snippet.arrowIdx) {
						this.renderLineWithArrow(row, segs, col);
					} else {
						this.renderLine(row, segs);
					}
					snippetEl.appendChild(row);
				});
			} else {
				targetEl.style.display = "";
				targetEl.textContent = target || "";
				snippetEl.style.display = "block";
				const div = document.createElement("div");
				div.className = "mt-modal-empty";
				div.textContent =
					"(Anchor not found in plan — move to the matching position.)";
				snippetEl.appendChild(div);
			}
		} else {
			targetEl.style.display = "";
			targetEl.textContent = target || "";
		}

		this.open("var(--clr-moveto-bg)");

		const modal = document.getElementById("mtModal");
		if (modal) {
			const snippetVisible = snippetEl.style.display !== "none";
			if (snippetVisible) {
				requestAnimationFrame(() => {
					if (snippetEl.offsetHeight > 0) {
						const center =
							snippetEl.offsetTop + snippetEl.offsetHeight / 2;
						modal.style.setProperty("--mt-confirm-top", center + "px");
					} else {
						modal.style.removeProperty("--mt-confirm-top");
					}
				});
			} else {
				modal.style.removeProperty("--mt-confirm-top");
			}
		}
	}

	closeUI() {
		this.close();
	}

	confirm() {
		sendMessage("move-to-confirmed", {});
		this.closeUI();
	}
}

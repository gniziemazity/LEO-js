(function (root) {
	const BLOCK_SUBTYPES = [
		["❓", "question-comment"],
		["🖼️", "image-comment"],
		["🌐", "web-comment"],
		["📋", "code-insert-comment"],
	];

	function getBlockSubtype(text) {
		const t = String(text == null ? "" : text).trim();
		for (const [prefix, subtype] of BLOCK_SUBTYPES) {
			if (t.startsWith(prefix)) return subtype;
		}
		return null;
	}

	function isMultilineCodeInsert(text) {
		return (
			getBlockSubtype(text) === "code-insert-comment" &&
			String(text).includes("\n")
		);
	}

	function collapsedLabel(text) {
		return String(text).split("\n")[0] + "...";
	}

	function stripBlockPrefix(text) {
		const s = String(text == null ? "" : text);
		for (const [prefix] of BLOCK_SUBTYPES) {
			const at = s.indexOf(prefix);
			if (at !== -1 && s.slice(0, at).trim() === "") {
				return s.slice(at + prefix.length).replace(/^\s/, "");
			}
		}
		return s;
	}

	function splitPinToken(text) {
		const s = String(text == null ? "" : text);
		const body = stripBlockPrefix(s);
		const prefix = s.slice(0, s.length - body.length);
		const parts = body.trim().split(/\s+/).filter(Boolean);
		const kept = parts.filter((p, i) => i === 0 || p.toLowerCase() !== "pin");
		return { text: prefix + kept.join(" "), pin: kept.length < parts.length };
	}

	function buildSettingsCSS(settings) {
		const c = settings.colors;
		return `
			body { font-size: ${settings.fontSize}px; }
			.comment-block, .code-block { color: ${c.textColor}; }
			.comment-block { background: ${c.commentNormal}; }
			.code-block { background: ${c.codeBlockColor}; }
			.comment-block.question-comment { background: ${c.questionCommentColor}; }
			.comment-block.image-comment,
			.comment-block.web-comment { background: ${c.imageBlockColor}; }
			.comment-block.code-insert-comment { background: ${c.codeInsertBlockColor}; }
			.comment-block.move-to-comment { background: ${c.moveToBlockColor}; color: ${c.moveToTextColor}; }
			.move-to-note,
			.mt-modal-note { background: ${c.commentNormal}; color: ${c.textColor}; }
			.move-to-note::placeholder { color: ${c.textColor}; }
			.comment-block.active-comment {
				background: ${c.commentActive};
				color: ${c.commentActiveText};
			}
			.block.selected {
				background-color: ${c.commentSelected};
				border-left-color: ${c.selectedBorder};
			}
			.char.cursor { background: ${c.cursor}; }
			.anchor-token.cursor { background: ${c.cursor}; }
			.bt-option[data-value="question-comment"] { background: ${c.questionCommentColor}; }
			.bt-option[data-value="image-comment"],
			.bt-option[data-value="web-comment"] { background: ${c.imageBlockColor}; }
			.bt-option[data-value="code-insert-comment"] { background: ${c.codeInsertBlockColor}; }
			.bt-option[data-value="null"] { background: ${c.commentNormal}; }
			.bt-option { color: ${c.textColor}; }
			.block-add-btn[data-add-type="move-to"] { background: ${c.moveToBlockColor}; color: ${c.moveToTextColor}; }
			.block-add-btn[data-add-type="comment"] { background: ${c.commentNormal}; color: #333; }
			.block-add-btn[data-add-type="code"] { background: ${c.codeBlockColor}; color: #333; }
		`;
	}

	const api = {
		BLOCK_SUBTYPES,
		getBlockSubtype,
		stripBlockPrefix,
		isMultilineCodeInsert,
		collapsedLabel,
		splitPinToken,
		buildSettingsCSS,
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
	root.LeoBlocks = api;
})(typeof window !== "undefined" ? window : this);

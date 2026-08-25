(function (root) {
	const BLOCK_SUBTYPES = [
		["❓", "question-comment"],
		["🖼️", "image-comment"],
		["🌐", "web-comment"],
		["📋", "code-insert-comment"],
		["➡️", "move-to-comment"],
	];

	function getBlockSubtype(text) {
		const t = String(text == null ? "" : text).trim();
		for (const [prefix, subtype] of BLOCK_SUBTYPES) {
			if (t.startsWith(prefix)) return subtype;
		}
		return null;
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
			#addQuestionCommentBtn { background: ${c.questionCommentColor}; }
			#addImageCommentBtn { background: ${c.imageBlockColor}; }
			#addWebCommentBtn { background: ${c.imageBlockColor}; }
			#addCodeInsertBlockBtn { background: ${c.codeInsertBlockColor}; }
			#addMoveToBlockBtn { background: ${c.moveToBlockColor}; color: ${c.moveToTextColor}; }
			#addCommentBtn { background: ${c.commentNormal}; color: #333; }
			#addCodeBtn { background: ${c.codeBlockColor}; color: #333; }
		`;
	}

	const api = { BLOCK_SUBTYPES, getBlockSubtype, buildSettingsCSS };

	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
	root.LeoBlocks = api;
})(typeof window !== "undefined" ? window : this);

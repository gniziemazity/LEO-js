(function (root) {
	const NOTE_KIND = "note";
	const MOVE_TO_KIND = "move-to";
	const CODE_KIND = "code";

	const BLOCK_KINDS = [
		["❓", "question"],
		["🖼️", "image"],
		["🌐", "web"],
		["📋", "snippet"],
	];

	const SUPPORT_KINDS = [
		NOTE_KIND,
		...BLOCK_KINDS.map(([, kind]) => kind),
		MOVE_TO_KIND,
	];

	const PICKABLE_KINDS = [NOTE_KIND, CODE_KIND, ...SUPPORT_KINDS.slice(1)];

	const POPUP_TITLES = {
		note: "Note:",
		image: "Image:",
		web: "Web page:",
	};

	function kindClass(kind) {
		return `${kind}-block`;
	}

	function kindPrefix(kind) {
		const found = BLOCK_KINDS.find(([, name]) => name === kind);
		return found ? found[0] : "";
	}

	function withKindPrefix(kind, body) {
		const prefix = kindPrefix(kind);
		return prefix ? `${prefix} ${body}` : body;
	}

	function getBlockKind(text) {
		const t = String(text == null ? "" : text).trim();
		for (const [prefix, kind] of BLOCK_KINDS) {
			if (t.startsWith(prefix)) return kind;
		}
		return NOTE_KIND;
	}

	function isMultilineSnippet(text) {
		return getBlockKind(text) === "snippet" && String(text).includes("\n");
	}

	function collapsedLabel(text) {
		return String(text).split("\n")[0] + "...";
	}

	function startingCodeLabel(files) {
		const n = Number(files) || 0;
		return `Starting Code (${n} ${n === 1 ? "file" : "files"})`;
	}

	function stripBlockPrefix(text) {
		const s = String(text == null ? "" : text);
		for (const [prefix] of BLOCK_KINDS) {
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

	function addKindRule(kind, background, color) {
		const own = `.block-tool-add[data-add-kind="${kind}"]`;
		const text = color ? ` color: ${color};` : "";
		return `${own},
			${own}:hover:not(:disabled) { background: ${background};${text} }`;
	}

	function buildSettingsCSS(settings) {
		const c = settings.colors;
		const all = SUPPORT_KINDS.map((k) => "." + kindClass(k)).join(
			",\n\t\t\t",
		);
		const active = SUPPORT_KINDS.map(
			(k) => `.${kindClass(k)}.active-block`,
		).join(",\n\t\t\t");
		return `
			:root { --clr-question-bg: ${c.questionColor}; }
			body { font-size: ${settings.fontSize}px; }
			${all},
			.code-block { color: ${c.textColor}; }
			.note-block { background: ${c.noteColor}; }
			.code-block { background: ${c.codeBlockColor}; }
			.question-block { background: ${c.questionColor}; }
			.image-block,
			.web-block { background: ${c.imageBlockColor}; }
			.snippet-block { background: ${c.snippetColor}; }
			.move-to-block { background: ${c.moveToBlockColor}; color: ${c.moveToTextColor}; }
			.move-to-note,
			.mt-modal-note { background: ${c.noteColor}; color: ${c.textColor}; }
			.media-modal-panel { background: ${c.imageBlockColor}; }
			.move-to-note::placeholder { color: ${c.textColor}; }
			${active} {
				background: ${c.activeBlockColor};
				color: ${c.activeBlockTextColor};
			}
			.block.selected {
				background-color: ${c.selectedBlockColor};
				border-left-color: ${c.selectedBorder};
			}
			.char.cursor { background: ${c.cursor}; }
			.anchor-token.cursor { background: ${c.cursor}; }
			.bt-option[data-value="note"] { background: ${c.noteColor}; }
			.bt-option[data-value="question"] { background: ${c.questionColor}; }
			.bt-option[data-value="image"],
			.bt-option[data-value="web"] { background: ${c.imageBlockColor}; }
			.bt-option[data-value="snippet"] { background: ${c.snippetColor}; }
			.bt-option[data-value="code"] { background: ${c.codeBlockColor}; }
			.bt-option[data-value="move-to"] { background: ${c.moveToBlockColor}; color: ${c.moveToTextColor}; }
			.bt-option { color: ${c.textColor}; }
			${addKindRule("note", c.noteColor)}
			${addKindRule("code", c.codeBlockColor)}
			${addKindRule("question", c.questionColor)}
			${addKindRule("image", c.imageBlockColor)}
			${addKindRule("web", c.imageBlockColor)}
			${addKindRule("snippet", c.snippetColor)}
			${addKindRule("move-to", c.moveToBlockColor, c.moveToTextColor)}
		`;
	}

	const api = {
		BLOCK_KINDS,
		SUPPORT_KINDS,
		PICKABLE_KINDS,
		NOTE_KIND,
		MOVE_TO_KIND,
		CODE_KIND,
		POPUP_TITLES,
		kindClass,
		kindPrefix,
		withKindPrefix,
		getBlockKind,
		stripBlockPrefix,
		isMultilineSnippet,
		collapsedLabel,
		startingCodeLabel,
		splitPinToken,
		buildSettingsCSS,
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
	root.LeoBlocks = api;
})(typeof window !== "undefined" ? window : this);

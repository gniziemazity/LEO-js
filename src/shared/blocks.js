(function (root) {
	const NOTE_TYPE = "note";
	const GO_TO_TYPE = "go-to";
	const CODE_TYPE = "code";

	const BLOCK_TYPES = [
		["❓", "question"],
		["🖼️", "image"],
		["🌐", "web"],
		["📋", "snippet"],
	];

	const SUPPORT_TYPES = [
		NOTE_TYPE,
		...BLOCK_TYPES.map(([, type]) => type),
		GO_TO_TYPE,
	];

	const PICKABLE_TYPES = [NOTE_TYPE, CODE_TYPE, ...SUPPORT_TYPES.slice(1)];

	const POPUP_TITLES = {
		note: "Note:",
		image: "Image:",
		web: "Web page:",
	};

	function typeClass(type) {
		return `${type}-block`;
	}

	function typePrefix(type) {
		const found = BLOCK_TYPES.find(([, name]) => name === type);
		return found ? found[0] : "";
	}

	function withTypePrefix(type, body) {
		const prefix = typePrefix(type);
		return prefix ? `${prefix} ${body}` : body;
	}

	function getBlockType(text) {
		const t = String(text == null ? "" : text).trim();
		for (const [prefix, type] of BLOCK_TYPES) {
			if (t.startsWith(prefix)) return type;
		}
		return NOTE_TYPE;
	}

	function blockTypeOf(block) {
		if (block.type === "comment") return getBlockType(block.text);
		if (block.type === GO_TO_TYPE) return GO_TO_TYPE;
		return block.type;
	}

	function hasBlockControls(block) {
		return !!block && !block.fromStart && block.type !== "include";
	}

	function isMultilineSnippet(text) {
		return getBlockType(text) === "snippet" && String(text).includes("\n");
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
		for (const [prefix] of BLOCK_TYPES) {
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

	function addTypeRule(type, background, color) {
		const own = `.block-tool-add[data-add-type="${type}"]`;
		const text = color ? ` color: ${color};` : "";
		return `${own},
			${own}:hover:not(:disabled) { background: ${background};${text} }`;
	}

	function buildSettingsCSS(settings) {
		const c = settings.colors;
		const all = SUPPORT_TYPES.map((k) => "." + typeClass(k)).join(
			",\n\t\t\t",
		);
		const active = SUPPORT_TYPES.map(
			(k) => `.${typeClass(k)}.active-block`,
		).join(",\n\t\t\t");
		return `
			:root { --clr-question-bg: ${c.questionColor}; }
			body { font-size: ${settings.fontSize}px; }
			${all},
			.code-block { color: ${c.textColor}; }
			.note-block { background: ${c.noteColor}; }
			.code-block { background: ${c.codeColor}; }
			.question-block { background: ${c.questionColor}; }
			.image-block,
			.web-block { background: ${c.imageColor}; }
			.snippet-block { background: ${c.snippetColor}; }
			.go-to-block { background: ${c.goToColor}; color: ${c.goToTextColor}; }
			.go-to-note,
			.popup-note { background: ${c.noteColor}; color: ${c.textColor}; }
			.media-modal-panel { background: ${c.imageColor}; }
			.go-to-note::placeholder { color: ${c.textColor}; }
			${active} {
				background: ${c.activeBlockColor};
				color: ${c.activeBlockTextColor};
			}
			.block.selected,
			.block.multi-selected {
				background-color: ${c.selectedBlockColor};
				border-left-color: ${c.selectedBorder};
			}
			.char.cursor { background: ${c.cursor}; }
			.anchor-token.cursor { background: ${c.cursor}; }
			.type-option[data-value="note"] { background: ${c.noteColor}; }
			.type-option[data-value="question"] { background: ${c.questionColor}; }
			.type-option[data-value="image"],
			.type-option[data-value="web"] { background: ${c.imageColor}; }
			.type-option[data-value="snippet"] { background: ${c.snippetColor}; }
			.type-option[data-value="code"] { background: ${c.codeColor}; }
			.type-option[data-value="go-to"] { background: ${c.goToColor}; color: ${c.goToTextColor}; }
			.type-option { color: ${c.textColor}; }
			${addTypeRule("note", c.noteColor)}
			${addTypeRule("code", c.codeColor)}
			${addTypeRule("question", c.questionColor)}
			${addTypeRule("image", c.imageColor)}
			${addTypeRule("web", c.imageColor)}
			${addTypeRule("snippet", c.snippetColor)}
			${addTypeRule("go-to", c.goToColor, c.goToTextColor)}
		`;
	}

	function applySettingsCSS(settings) {
		const id = "dynamic-settings-styles";
		let style = document.getElementById(id);
		if (!style) {
			style = document.createElement("style");
			style.id = id;
			document.head.appendChild(style);
		}
		style.textContent = buildSettingsCSS(settings);
	}

	const api = {
		BLOCK_TYPES,
		SUPPORT_TYPES,
		PICKABLE_TYPES,
		NOTE_TYPE,
		GO_TO_TYPE,
		CODE_TYPE,
		POPUP_TITLES,
		typeClass,
		typePrefix,
		withTypePrefix,
		getBlockType,
		blockTypeOf,
		hasBlockControls,
		stripBlockPrefix,
		isMultilineSnippet,
		collapsedLabel,
		startingCodeLabel,
		splitPinToken,
		buildSettingsCSS,
		applySettingsCSS,
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
	root.LeoBlocks = api;
})(typeof window !== "undefined" ? window : this);

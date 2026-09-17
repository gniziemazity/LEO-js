const { BLOCK_SUBTYPES } = require("../shared/blocks");

const ALL_MODES = ["record", "classroom", "scientific"];

const SUBTYPE_META = {
	"question-comment": {
		label: "Question",
		modes: ["classroom", "scientific"],
	},
	"image-comment": { label: "Image", modes: ["classroom", "scientific"] },
	"web-comment": { label: "Web page", modes: ["classroom", "scientific"] },
	"code-insert-comment": { label: "Code insert", modes: ["scientific"] },
};

const PLAIN_CHOICE = {
	subtype: null,
	glyph: "💬",
	label: "Comment",
	modes: ALL_MODES,
};

const SUBTYPE_CHOICES = [
	PLAIN_CHOICE,
	...BLOCK_SUBTYPES.map(([glyph, subtype]) => ({
		subtype,
		glyph,
		label: SUBTYPE_META[subtype].label,
		modes: SUBTYPE_META[subtype].modes,
	})),
];

const ADD_CHOICES = [
	{ type: "comment", glyph: "💬", label: "Comment", modes: ALL_MODES },
	{ type: "code", glyph: "⌨", label: "Code", modes: ALL_MODES },
	{
		type: "move-to",
		glyph: "➡️",
		label: "Move to",
		modes: ["scientific"],
		initialText: "MAIN",
	},
];

function currentMode(body) {
	const el = body || (typeof document !== "undefined" ? document.body : null);
	if (!el || !el.classList) return "scientific";
	for (const mode of ALL_MODES) {
		if (el.classList.contains(`mode-${mode}`)) return mode;
	}
	return "scientific";
}

function forMode(choices, mode) {
	return choices.filter((c) => c.modes.includes(mode));
}

function subtypeChoices(mode) {
	return forMode(SUBTYPE_CHOICES, mode);
}

function addChoices(mode) {
	return forMode(ADD_CHOICES, mode);
}

function subtypeGlyph(subtype) {
	const found = SUBTYPE_CHOICES.find((c) => c.subtype === (subtype || null));
	return (found || PLAIN_CHOICE).glyph;
}

module.exports = {
	ALL_MODES,
	SUBTYPE_CHOICES,
	ADD_CHOICES,
	currentMode,
	subtypeChoices,
	addChoices,
	subtypeGlyph,
};

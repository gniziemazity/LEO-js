const { BLOCK_KINDS, NOTE_KIND, MOVE_TO_KIND } = require("../shared/blocks");

const KIND_LABELS = {
	note: "Note",
	question: "Question",
	image: "Image",
	web: "Web page",
	snippet: "Code snippet",
	"move-to": "Move to",
};

const KIND_CHOICES = [
	{ kind: NOTE_KIND, glyph: "💬", label: KIND_LABELS[NOTE_KIND] },
	...BLOCK_KINDS.map(([glyph, kind]) => ({
		kind,
		glyph,
		label: KIND_LABELS[kind],
	})),
	{ kind: MOVE_TO_KIND, glyph: "➡️", label: KIND_LABELS[MOVE_TO_KIND] },
];

const ADD_CHOICES = [
	{ kind: NOTE_KIND, type: "comment", glyph: "💬", label: "Note" },
	{ kind: "code", type: "code", glyph: "⌨", label: "Code" },
	{
		kind: MOVE_TO_KIND,
		type: "move-to",
		glyph: "➡️",
		label: "Move to",
		initialText: "MAIN",
	},
];

function kindChoices() {
	return KIND_CHOICES;
}

function addChoices() {
	return ADD_CHOICES;
}

function kindGlyph(kind) {
	const found = KIND_CHOICES.find((c) => c.kind === kind);
	return (found || KIND_CHOICES[0]).glyph;
}

module.exports = {
	KIND_CHOICES,
	ADD_CHOICES,
	KIND_LABELS,
	kindChoices,
	addChoices,
	kindGlyph,
};

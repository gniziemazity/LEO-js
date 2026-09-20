const {
	BLOCK_KINDS,
	NOTE_KIND,
	MOVE_TO_KIND,
	CODE_KIND,
	kindPrefix,
} = require("../shared/blocks");

const KIND_LABELS = {
	note: "Note",
	code: "Code",
	question: "Question",
	image: "Image",
	web: "Web page",
	snippet: "Code snippet",
	"move-to": "Move to",
};

const KIND_CHOICES = [
	{ kind: CODE_KIND, glyph: "⌨", label: KIND_LABELS[CODE_KIND] },
	{ kind: NOTE_KIND, glyph: "💬", label: KIND_LABELS[NOTE_KIND] },
	...BLOCK_KINDS.map(([glyph, kind]) => ({
		kind,
		glyph,
		label: KIND_LABELS[kind],
	})),
	{ kind: MOVE_TO_KIND, glyph: "➡️", label: KIND_LABELS[MOVE_TO_KIND] },
];

const KIND_PLACEHOLDERS = {
	note: "Type note here",
	code: "Type code here",
	question: "Type the question here",
	image: "Image file name (put the image in the images folder)",
	web: "Web address",
	snippet: "Type or paste code here",
};

function addChoice({ kind, glyph, label }) {
	if (kind === CODE_KIND) return { kind, type: "code", glyph, label };
	if (kind === MOVE_TO_KIND) {
		return { kind, type: "move-to", glyph, label, initialText: "MAIN" };
	}
	const prefix = kindPrefix(kind);
	const choice = { kind, type: "comment", glyph, label };
	if (prefix) choice.initialText = `${prefix} `;
	return choice;
}

const ADD_CHOICES = KIND_CHOICES.map(addChoice);

function kindChoices() {
	return KIND_CHOICES;
}

function addChoices() {
	return ADD_CHOICES;
}

function kindGlyph(kind) {
	const found = KIND_CHOICES.find((c) => c.kind === kind);
	return (found || KIND_CHOICES.find((c) => c.kind === NOTE_KIND)).glyph;
}

module.exports = {
	KIND_CHOICES,
	ADD_CHOICES,
	KIND_LABELS,
	KIND_PLACEHOLDERS,
	kindChoices,
	addChoices,
	kindGlyph,
};

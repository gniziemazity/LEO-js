const {
	BLOCK_TYPES,
	NOTE_TYPE,
	GO_TO_TYPE,
	CODE_TYPE,
	typePrefix,
} = require("../shared/blocks");

const TYPE_LABELS = {
	note: "Note",
	code: "Code",
	question: "Question",
	image: "Image",
	web: "Web page",
	snippet: "Code snippet",
	"go-to": "Go to",
};

const TYPE_CHOICES = [
	{ type: CODE_TYPE, glyph: "⌨", label: TYPE_LABELS[CODE_TYPE] },
	{ type: NOTE_TYPE, glyph: "💬", label: TYPE_LABELS[NOTE_TYPE] },
	...BLOCK_TYPES.map(([glyph, type]) => ({
		type,
		glyph,
		label: TYPE_LABELS[type],
	})),
	{ type: GO_TO_TYPE, glyph: "➡️", label: TYPE_LABELS[GO_TO_TYPE] },
];

const TYPE_PLACEHOLDERS = {
	note: "Type note here",
	code: "Type code here",
	question: "Type the question here",
	image: "Image file name (put the image in the images folder)",
	web: "Web address",
	snippet: "Type or paste code here",
};

function addChoice({ type, glyph, label }) {
	if (type === CODE_TYPE) return { type, storedType: "code", glyph, label };
	if (type === GO_TO_TYPE) {
		return { type, storedType: "go-to", glyph, label, initialText: "MAIN" };
	}
	const prefix = typePrefix(type);
	const choice = { type, storedType: "comment", glyph, label };
	if (prefix) choice.initialText = `${prefix} `;
	return choice;
}

const ADD_CHOICES = TYPE_CHOICES.map(addChoice);

function typeChoices() {
	return TYPE_CHOICES;
}

function addChoices() {
	return ADD_CHOICES;
}

function typeGlyph(type) {
	const found = TYPE_CHOICES.find((c) => c.type === type);
	return (found || TYPE_CHOICES.find((c) => c.type === NOTE_TYPE)).glyph;
}

module.exports = {
	TYPE_CHOICES,
	TYPE_PLACEHOLDERS,
	typeChoices,
	addChoices,
	typeGlyph,
};

const { getBlockSubtype } = require("../shared/constants");

function buildArtificialLogEvents(executionSteps) {
	const KEYS_PER_MINUTE = 70;
	const intervalMs = Math.round(60000 / KEYS_PER_MINUTE);
	const startTime = Date.now();
	const events = [];

	let seenCodeInsert = null;
	let seenMoveTo = null;

	executionSteps.forEach((step, i) => {
		const t = startTime + i * intervalMs;
		if (step.type === "char") {
			seenCodeInsert = null;
			seenMoveTo = null;
			events.push({ timestamp: t, char: step.char });
		} else if (step.type === "anchor") {
			seenCodeInsert = null;
			seenMoveTo = null;
			events.push({ timestamp: t, anchor: step.value });
		} else if (step.type === "block") {
			if (step.subtype === "move-to") {
				if (seenMoveTo !== step.globalIndex) {
					seenMoveTo = step.globalIndex;
					seenCodeInsert = null;
					events.push({ timestamp: t, move_to: step.target || "MAIN" });
				}
				return;
			}
			const blockText = step.element ? step.element.innerText.trim() : "";
			const subtype = getBlockSubtype(blockText);
			if (subtype === "code-insert-comment") {
				if (seenCodeInsert !== step.globalIndex) {
					seenCodeInsert = step.globalIndex;
					seenMoveTo = null;
					const fullText = step.element
						? step.element.title || step.element.innerText
						: "";
					const text = fullText.replace(/^📋 ?/, "");
					events.push({ timestamp: t, code_insert: text });
				}
			} else if (subtype === "move-to-comment") {
				if (seenMoveTo !== step.globalIndex) {
					seenMoveTo = step.globalIndex;
					seenCodeInsert = null;
					const text = step.element
						? step.element.innerText.replace(/^➡️ ?/, "")
						: "";
					events.push({ timestamp: t, move_to: text });
				}
			} else {
				seenCodeInsert = null;
				seenMoveTo = null;
			}
		}
	});

	return events;
}

module.exports = { buildArtificialLogEvents };

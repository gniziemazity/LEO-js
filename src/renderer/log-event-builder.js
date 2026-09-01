const { getBlockSubtype, stripBlockPrefix } = require("../shared/blocks");

function stepToLogEvents(step) {
	if (!step) return [];
	if (step.subtype === "move-to") {
		const out = [];
		const switchTo = step.snippet && step.snippet.switchTo;
		if (switchTo) out.push({ move_to: switchTo });
		out.push({ move_to: step.target || "MAIN" });
		return out;
	}
	const el = step.element;
	const raw = el ? el.dataset.fullText || el.innerText || "" : "";
	if (getBlockSubtype(raw) === "code-insert-comment") {
		return [{ code_insert: stripBlockPrefix(raw) }];
	}
	return [];
}

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
					for (const e of stepToLogEvents(step))
						events.push({ timestamp: t, ...e });
				}
				return;
			}
			const entries = stepToLogEvents(step);
			if (entries.length) {
				if (seenCodeInsert !== step.globalIndex) {
					seenCodeInsert = step.globalIndex;
					seenMoveTo = null;
					for (const e of entries) events.push({ timestamp: t, ...e });
				}
			} else {
				seenCodeInsert = null;
				seenMoveTo = null;
			}
		}
	});

	return events;
}

module.exports = { buildArtificialLogEvents, stepToLogEvents };

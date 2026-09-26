const { getBlockKind, stripBlockPrefix } = require("../shared/blocks");

function stepToLogEvents(step) {
	if (!step) return [];
	if (step.kind === "move-to") {
		const out = [];
		const switchTo = step.snippet && step.snippet.switchTo;
		if (switchTo) out.push({ move_to: switchTo });
		out.push({ move_to: step.target || "MAIN" });
		return out;
	}
	const raw = String(step.text || "");
	if (getBlockKind(raw) === "snippet") {
		return [{ code_insert: stripBlockPrefix(raw) }];
	}
	return [];
}

function buildArtificialLogEvents(executionSteps) {
	const KEYS_PER_MINUTE = 70;
	const intervalMs = Math.round(60000 / KEYS_PER_MINUTE);
	const startTime = Date.now();
	const events = [];

	executionSteps.forEach((step, i) => {
		const t = startTime + i * intervalMs;
		if (step.type === "char") {
			events.push({ timestamp: t, char: step.char });
		} else if (step.type === "anchor") {
			events.push({ timestamp: t, anchor: step.value });
		} else if (step.type === "block") {
			for (const e of stepToLogEvents(step))
				events.push({ timestamp: t, ...e });
		}
	});

	return events;
}

module.exports = { buildArtificialLogEvents, stepToLogEvents };

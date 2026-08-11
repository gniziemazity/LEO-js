const MARKER_RE = /(^|\s)([A-Za-z]|\d+)([).])/g;

function _isLetter(token) {
	return /^[A-Za-z]$/.test(token);
}

function _isDigits(token) {
	return /^\d+$/.test(token);
}

function _expectedLetter(index) {
	return String.fromCharCode(97 + index);
}

function _sequenceFrom(candidates, start) {
	const first = candidates[start];
	const isDigit = _isDigits(first.token);
	const isLetter = _isLetter(first.token);
	if (isDigit && first.token !== "1") return null;
	if (isLetter && first.token.toLowerCase() !== "a") return null;
	if (!isDigit && !isLetter) return null;

	const run = [first];
	let next = isDigit ? 2 : 1;
	for (let j = start + 1; j < candidates.length; j++) {
		const c = candidates[j];
		if (c.delim !== first.delim) break;
		if (isDigit) {
			if (!_isDigits(c.token) || parseInt(c.token, 10) !== next) break;
		} else {
			if (
				!_isLetter(c.token) ||
				c.token.toLowerCase() !== _expectedLetter(next)
			)
				break;
		}
		run.push(c);
		next++;
	}
	return run;
}

function parseQuestionOptions(raw) {
	const input = typeof raw === "string" ? raw : "";
	const candidates = [];
	let m;
	MARKER_RE.lastIndex = 0;
	while ((m = MARKER_RE.exec(input)) !== null) {
		const markerStart = m.index + m[1].length;
		candidates.push({
			token: m[2],
			delim: m[3],
			markerStart,
			markerEnd: markerStart + m[2].length + 1,
		});
	}

	for (let i = 0; i < candidates.length; i++) {
		const run = _sequenceFrom(candidates, i);
		if (run && run.length >= 2) {
			const text = input.slice(0, run[0].markerStart).trim();
			const options = run.map((c, idx) => {
				const bodyEnd =
					idx + 1 < run.length ? run[idx + 1].markerStart : input.length;
				return {
					label: input.slice(c.markerStart, c.markerEnd),
					text: input.slice(c.markerEnd, bodyEnd).trim(),
				};
			});
			return { text, options };
		}
	}

	return { text: input.trim(), options: [] };
}

module.exports = { parseQuestionOptions };

"use strict";

function niceStep(range, targetSteps) {
	const raw = range / targetSteps;
	const mag = Math.pow(10, Math.floor(Math.log10(raw)));
	const norm = raw / mag;
	let nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
	return nice * mag;
}

function _boxStats(values, coef = 1.5) {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const n = sorted.length;
	const q = (p) => {
		const pos = p * (n - 1);
		const lo = Math.floor(pos);
		const hi = Math.ceil(pos);
		return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
	};
	const q1 = q(0.25);
	const median = q(0.5);
	const q3 = q(0.75);
	const iqr = q3 - q1;
	const lo = q1 - coef * iqr;
	const hi = q3 + coef * iqr;
	const whiskerMin = sorted.find((v) => v >= lo) ?? sorted[0];
	const whiskerMax =
		[...sorted].reverse().find((v) => v <= hi) ?? sorted[n - 1];
	const outliers = sorted.filter((v) => v < lo || v > hi);
	return { q1, median, q3, whiskerMin, whiskerMax, outliers };
}

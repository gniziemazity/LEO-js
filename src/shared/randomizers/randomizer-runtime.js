const RANDOMIZERS = {};

function registerRandomizer(name, runFn) {
	RANDOMIZERS[name] = runFn;
}

function listRandomizers() {
	return Object.keys(RANDOMIZERS);
}

function runRandomizerStyle(style, container, names, onDone) {
	const all = listRandomizers();
	if (!all.length) return;
	const fn = RANDOMIZERS[RANDOMIZERS[style] ? style : all[0]];
	if (typeof fn !== "function" || !container) return;
	container.innerHTML = "";
	fn(
		container,
		Array.isArray(names) ? names : [],
		typeof onDone === "function" ? onDone : () => {},
	);
}

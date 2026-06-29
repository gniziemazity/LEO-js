const RANDOMIZERS = {};
let _activeRandomizer = null;

function registerRandomizer(name, runFn) {
	RANDOMIZERS[name] = runFn;
	if (!_activeRandomizer) _activeRandomizer = name;
}

function setActiveRandomizer(name) {
	if (RANDOMIZERS[name]) _activeRandomizer = name;
}

function listRandomizers() {
	return Object.keys(RANDOMIZERS);
}

function runRandomizer(container, names, onDone) {
	const fn = RANDOMIZERS[_activeRandomizer];
	if (typeof fn !== "function" || !container) return;
	container.innerHTML = "";
	fn(
		container,
		Array.isArray(names) ? names : [],
		typeof onDone === "function" ? onDone : () => {},
	);
}

function runRandomizerStyle(style, container, names, onDone) {
	const all = listRandomizers();
	if (!all.length) return;
	const name = RANDOMIZERS[style] ? style : all[0];
	_activeRandomizer = name;
	runRandomizer(container, names, onDone);
}

const LEO_EFFECTS = {};

function registerEffect(name, run) {
	LEO_EFFECTS[name] = run;
}

function listEffects() {
	return Object.keys(LEO_EFFECTS);
}

function playEffect(name) {
	const run = LEO_EFFECTS[name];
	if (typeof run !== "function") return;
	const dpr = window.devicePixelRatio || 1;
	const w = window.innerWidth;
	const h = window.innerHeight;
	const canvas = document.createElement("canvas");
	canvas.className = "leo-effect-canvas";
	canvas.style.cssText =
		"position:fixed;inset:0;width:100%;height:100%;z-index:9999;pointer-events:none;display:block;";
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.max(1, Math.round(h * dpr));
	document.body.appendChild(canvas);
	const ctx = canvas.getContext("2d");
	ctx.scale(dpr, dpr);
	const done = () => {
		if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
	};
	run(ctx, w, h, done);
}

function playEffectSetting(setting) {
	if (!setting || setting === "none") return;
	playEffect(setting);
}

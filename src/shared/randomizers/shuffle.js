registerRandomizer("shuffle", (container, names, onDone) => {
	const field = document.createElement("div");
	field.style.cssText =
		"font-weight:800;font-size:clamp(28px,8vw,72px);color:inherit;" +
		"text-align:center;padding:0 16px;word-break:break-word;line-height:1.2;";
	container.appendChild(field);

	if (!names.length) {
		field.textContent = "No students";
		return;
	}

	const duration = 2000;
	const t0 = performance.now();

	function tick() {
		const elapsed = performance.now() - t0;
		if (elapsed >= duration) {
			const idx = Math.floor(Math.random() * names.length);
			field.textContent = names[idx];
			onDone(idx);
			return;
		}
		field.textContent = names[Math.floor(Math.random() * names.length)];
		const delay = 40 + 240 * Math.pow(elapsed / duration, 3);
		setTimeout(tick, delay);
	}

	tick();
});

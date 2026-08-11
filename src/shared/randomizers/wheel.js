registerRandomizer("wheel", (container, names, onDone) => {
	const COLORS = [
		"#e74c3c",
		"#3498db",
		"#2ecc71",
		"#f1c40f",
		"#9b59b6",
		"#e67e22",
		"#1abc9c",
		"#ff6b9d",
	];

	if (!names.length) {
		const msg = document.createElement("div");
		msg.textContent = "No students";
		msg.style.cssText = "font-weight:700;font-size:24px;color:inherit;";
		container.appendChild(msg);
		return;
	}

	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	container.appendChild(canvas);

	let size = 0;
	let radius = 0;
	let cx = 0;
	let cy = 0;

	function layout() {
		const dpr = window.devicePixelRatio || 1;
		const w = container.clientWidth || window.innerWidth - 32;
		const h = container.clientHeight || window.innerHeight - 32;
		size = Math.max(120, Math.floor(Math.min(w, h) - 16));
		radius = size / 2 - size * 0.02;
		cx = size / 2;
		cy = size / 2;
		canvas.width = Math.round(size * dpr);
		canvas.height = Math.round(size * dpr);
		canvas.style.width = size + "px";
		canvas.style.height = size + "px";
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	const seg = (2 * Math.PI) / names.length;
	let rot = -Math.PI / 2;

	function label(name) {
		const first = String(name).split(/\s+/)[0];
		return first.length > 10 ? first.slice(0, 9) + "…" : first;
	}

	function draw() {
		const fontSize = Math.max(11, Math.round(size * 0.045));
		const hubR = size * 0.05;
		const pw = size * 0.045;
		const ph = size * 0.085;
		const py = size * 0.007;

		ctx.clearRect(0, 0, size, size);
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(rot);
		for (let i = 0; i < names.length; i++) {
			const start = i * seg;
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.arc(0, 0, radius, start, start + seg);
			ctx.closePath();
			ctx.fillStyle = COLORS[i % COLORS.length];
			ctx.fill();
			ctx.strokeStyle = "rgba(0,0,0,0.2)";
			ctx.stroke();
			ctx.save();
			ctx.rotate(start + seg / 2);
			ctx.fillStyle = "#ffffff";
			ctx.font = `700 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
			ctx.textAlign = "right";
			ctx.textBaseline = "middle";
			ctx.fillText(label(names[i]), radius - size * 0.035, 0);
			ctx.restore();
		}
		ctx.restore();

		ctx.beginPath();
		ctx.arc(cx, cy, hubR, 0, 2 * Math.PI);
		ctx.fillStyle = "#ffffff";
		ctx.fill();

		ctx.beginPath();
		ctx.moveTo(cx - pw, py);
		ctx.lineTo(cx + pw, py);
		ctx.lineTo(cx, py + ph);
		ctx.closePath();
		ctx.fillStyle = "#2c3e50";
		ctx.fill();
	}

	function onResize() {
		if (!canvas.isConnected) {
			window.removeEventListener("resize", onResize);
			return;
		}
		layout();
		draw();
	}
	window.addEventListener("resize", onResize);

	const target = Math.floor(Math.random() * names.length);
	const center = (target + 0.5) * seg;
	const pointer = -Math.PI / 2;
	const finalMod =
		(((pointer - center) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
	const startRot = rot;
	const startMod = ((startRot % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
	let delta = finalMod - startMod;
	if (delta < 0) delta += 2 * Math.PI;
	const endRot = startRot + delta + 2 * Math.PI * 6;
	const duration = 4200;
	const t0 = performance.now();

	function frame(now) {
		if (!canvas.isConnected) return;
		const p = Math.min(1, (now - t0) / duration);
		const e = 1 - Math.pow(1 - p, 3);
		rot = startRot + (endRot - startRot) * e;
		draw();
		if (p < 1) {
			requestAnimationFrame(frame);
		} else {
			rot = endRot;
			draw();
			onDone(target);
		}
	}

	layout();
	draw();
	requestAnimationFrame(frame);
});

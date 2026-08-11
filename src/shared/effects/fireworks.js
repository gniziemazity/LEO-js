registerEffect("fireworks", (ctx, w, h, done) => {
	const COLORS = [
		"#ff0000",
		"#ff8800",
		"#00dd00",
		"#00ddff",
		"#0000ff",
		"#4400ff",
	];
	const particles = [];

	function burst() {
		const x = w * (0.15 + Math.random() * 0.7);
		const y = h * (0.1 + Math.random() * 0.45);
		const color = COLORS[Math.floor(Math.random() * COLORS.length)];
		for (let i = 0; i < 80; i++) {
			const angle = Math.random() * Math.PI * 2;
			const speed = 1.5 + Math.random() * 7;
			particles.push({
				x,
				y,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				color,
				life: 1,
				decay: 0.011 + Math.random() * 0.014,
				r: 2 + Math.random() * 2.5,
			});
		}
	}

	let burstsDone = 0;
	burst();
	const iv = setInterval(() => {
		burst();
		if (++burstsDone >= 6) clearInterval(iv);
	}, 380);

	function animate() {
		ctx.clearRect(0, 0, w, h);
		let alive = false;
		for (const p of particles) {
			if (p.life <= 0) continue;
			alive = true;
			p.x += p.vx;
			p.y += p.vy;
			p.vy += 0.13;
			p.vx *= 0.99;
			p.life -= p.decay;
			ctx.globalAlpha = Math.max(0, p.life);
			ctx.fillStyle = p.color;
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.globalAlpha = 1;
		if (alive || burstsDone < 6) requestAnimationFrame(animate);
		else done();
	}

	animate();
});

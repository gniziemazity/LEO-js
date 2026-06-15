"use strict";

const _DEFAULT_MANUAL_A_PARTITIONS = [
	"80, 81, 78, 50, 55, 23, 82, 20, 24",
	"70, 77, 48, 72, 18, 30, 76, 67, 4, 74, 58, 34, 69, 35, 8",
	"61, 29, 25, 11, 44, 63, 71, 31, 47, 45, 36, 65, 10, 41, 38, 28, 17, 62, 73, 84, 59, 66, 15, 22, 53",
	"rest",
].join("\n");

const _MANUAL_LS_KEYS = {
	A: "cluster_manual_text_a_v1",
};
const _MANUAL_DEFAULTS = {
	A: _DEFAULT_MANUAL_A_PARTITIONS,
};

const _MANUAL_CLUSTER_DESCS = [
	"Type 1:Follow well from the start",
	"Type 2: Learned to follow along",
	"We can't tell. Could be Type 1 or Type 2",
	"Others",
];

function _clusterMode() {
	const v = document.getElementById("cluster-mode")?.value;
	return v === "manualA" ? "manualA" : "kmeans";
}

function _manualSlot() {
	return "A";
}

function _clusterOpts() {
	return {
		k: Math.max(
			1,
			Math.min(25, +document.getElementById("cluster-k")?.value || 1),
		),
	};
}

function _parseManualPartitions(text, students) {
	const lines = String(text || "")
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length);
	const idMap = new Map();
	students.forEach((s, i) => {
		if (s.id != null && s.id !== "") idMap.set(String(s.id).trim(), i);
	});
	const labels = new Array(students.length).fill(-1);
	let restLineIdx = -1;
	lines.forEach((line, ci) => {
		if (/^rest$/i.test(line)) {
			restLineIdx = ci;
			return;
		}
		const tokens = line.split(/[\s,;]+/).filter(Boolean);
		for (const t of tokens) {
			const idx = idMap.get(t);
			if (idx != null && labels[idx] === -1) labels[idx] = ci;
		}
	});
	if (restLineIdx === -1) restLineIdx = lines.length;
	for (let i = 0; i < labels.length; i++) {
		if (labels[i] === -1) labels[i] = restLineIdx;
	}
	const numClusters = Math.max(
		lines.length,
		restLineIdx === lines.length ? lines.length + 1 : 0,
	);
	return { labels, numClusters };
}

function _applyClusterModeUI() {
	const mode = _clusterMode();
	document
		.querySelectorAll(".cluster-kmeans-only")
		.forEach((el) => (el.style.display = mode === "kmeans" ? "" : "none"));
	const panel = document.getElementById("cluster-manual-panel");
	if (panel) panel.style.display = "none";
}

function _buildClusterFeatures(students, opts) {
	const numOrNull = (v) => (v == null || isNaN(v) ? null : +v);
	const rows = [];
	for (const s of students) {
		const row = [];
		for (const l of s.lessons) {
			if (opts.useFollow) {
				row.push(l.hasFollowCol ? numOrNull(l.follow) : null);
			}
			if (opts.useGrade) row.push(numOrNull(l.grade));
			if (opts.useLang) {
				for (const { entryKey } of LANG_FOLLOW_KEYS) {
					row.push(l.hasFollowCol ? numOrNull(l[entryKey]) : null);
				}
			}
		}
		rows.push(row);
	}
	const nCols = rows[0]?.length || 0;
	for (let c = 0; c < nCols; c++) {
		let hi = 0;
		for (const r of rows) {
			const v = r[c];
			if (v != null && v > hi) hi = v;
		}
		if (hi <= 0) {
			for (const r of rows) r[c] = 0;
			continue;
		}
		for (const r of rows) {
			const v = r[c];
			r[c] = v == null ? -1 : v / hi;
		}
	}
	return rows;
}

const _IMPROVEMENT_WEIGHT = 2.5;

function _kmeansImprovement(s) {
	const vs = s.lessons
		.filter((l) => l.hasFollowCol && l.follow != null)
		.map((l) => l.follow);
	if (!vs.length) return 0;
	return Math.max(...vs) - vs[0];
}

function _buildKmeans2DFeatures(students) {
	const raw = students.map((s) => {
		const af = followAvg(s);
		return { follow: af >= 0 ? af : null, improve: _kmeansImprovement(s) };
	});
	const known = raw.map((r) => r.follow).filter((v) => v != null);
	const followMean = known.length
		? known.reduce((a, b) => a + b, 0) / known.length
		: 0;
	const cols = [
		raw.map((r) => (r.follow == null ? followMean : r.follow)),
		raw.map((r) => r.improve),
	];
	const norm = cols.map((col) => {
		const lo = Math.min(...col);
		const span = Math.max(...col) - lo;
		return col.map((v) => (span > 0 ? (v - lo) / span : 0));
	});
	return students.map((_, i) => [
		norm[0][i],
		_IMPROVEMENT_WEIGHT * norm[1][i],
	]);
}

function _seededRng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 0x100000000;
	};
}

function _sqDist(a, b) {
	let d = 0;
	for (let i = 0; i < a.length; i++) {
		const v = a[i] - b[i];
		d += v * v;
	}
	return d;
}

function _kmeansPlusPlusInit(points, k, rng) {
	const n = points.length;
	const centroids = [points[Math.floor(rng() * n)].slice()];
	while (centroids.length < k) {
		const d2 = points.map((p) => {
			let m = Infinity;
			for (const c of centroids) {
				const d = _sqDist(p, c);
				if (d < m) m = d;
			}
			return m;
		});
		const sum = d2.reduce((a, b) => a + b, 0);
		if (!sum) {
			centroids.push(points[Math.floor(rng() * n)].slice());
			continue;
		}
		let r = rng() * sum;
		let picked = n - 1;
		for (let i = 0; i < n; i++) {
			r -= d2[i];
			if (r <= 0) {
				picked = i;
				break;
			}
		}
		centroids.push(points[picked].slice());
	}
	return centroids;
}

function _kmeans(points, k, maxIter = 10000, seed = 42) {
	if (!points.length) return { labels: [], centroids: [] };
	if (points.length <= k) {
		return {
			labels: points.map((_, i) => i),
			centroids: points.map((p) => p.slice()),
		};
	}
	const rng = _seededRng(seed);
	let centroids = _kmeansPlusPlusInit(points, k, rng);
	const labels = new Array(points.length).fill(0);
	for (let iter = 0; iter < maxIter; iter++) {
		let changed = false;
		for (let i = 0; i < points.length; i++) {
			let best = 0,
				bestD = Infinity;
			for (let c = 0; c < k; c++) {
				const d = _sqDist(points[i], centroids[c]);
				if (d < bestD) {
					bestD = d;
					best = c;
				}
			}
			if (labels[i] !== best) {
				labels[i] = best;
				changed = true;
			}
		}
		const sums = Array.from({ length: k }, () =>
			new Array(points[0].length).fill(0),
		);
		const counts = new Array(k).fill(0);
		for (let i = 0; i < points.length; i++) {
			const c = labels[i];
			counts[c]++;
			for (let j = 0; j < points[0].length; j++) sums[c][j] += points[i][j];
		}
		for (let c = 0; c < k; c++) {
			if (counts[c] === 0) {
				const farthest = points
					.map((p, i) => ({
						i,
						d: _sqDist(p, centroids[labels[i]]),
					}))
					.sort((a, b) => b.d - a.d)[0];
				centroids[c] = points[farthest.i].slice();
			} else {
				for (let j = 0; j < points[0].length; j++)
					centroids[c][j] = sums[c][j] / counts[c];
			}
		}
		if (!changed) break;
	}
	return { labels, centroids };
}

function renderClusters() {
	_clusterCharts.forEach((c) => {
		try {
			c.destroy();
		} catch {}
	});
	_clusterCharts = [];

	const body = document.getElementById("clusters-body");
	if (!body) return;
	body.innerHTML = "";
	const students = visibleStudents();
	if (!students.length) {
		_refreshChartDownloadBtns();
		return;
	}

	const mode = _clusterMode();
	const labelsX = ASSIGNMENTS.map((a) => a.name);
	let labels, centroids, k;

	if (mode === "manualA") {
		const slot = _manualSlot();
		const ta = document.querySelector(`[data-manual-text="${slot}"]`);
		const text = (ta && ta.value) || _MANUAL_DEFAULTS[slot];
		const parsed = _parseManualPartitions(text, students);
		labels = parsed.labels;
		k = parsed.numClusters;
		const opts = { useFollow: true, useGrade: true, useLang: true };
		const features = _buildClusterFeatures(students, opts);
		const nCols = features[0]?.length || 0;
		centroids = Array.from({ length: k }, () => new Array(nCols).fill(0));
		const counts = new Array(k).fill(0);
		for (let i = 0; i < students.length; i++) {
			const c = labels[i];
			counts[c]++;
			for (let j = 0; j < nCols; j++) centroids[c][j] += features[i][j];
		}
		for (let c = 0; c < k; c++) {
			if (counts[c] === 0) continue;
			for (let j = 0; j < nCols; j++) centroids[c][j] /= counts[c];
		}
	} else {
		const opts = _clusterOpts();
		const features = _buildKmeans2DFeatures(students);
		k = Math.min(opts.k, students.length);
		const res = _kmeans(features, k, 10000, _clusterSeed);
		labels = res.labels;
		centroids = res.centroids;
	}

	const buckets = Array.from({ length: k }, () => []);
	students.forEach((s, i) => {
		buckets[labels[i]].push(s);
	});

	const centroidMean = (c) =>
		c && c.length ? c.reduce((a, b) => a + b, 0) / c.length : 0;
	const ordered = buckets
		.map((bucket, idx) => ({
			idx,
			bucket,
			score: centroidMean(centroids[idx]),
		}))
		.filter((b) => b.bucket.length)
		.sort((a, b) => b.score - a.score);

	ordered.forEach((entry, displayIdx) => {
		const { bucket } = entry;
		const section = el("div", "cluster-section");
		const header = el("div", "cluster-header");
		const h3 = el("h3");
		h3.textContent = `Cluster ${displayIdx + 1}`;
		if (mode === "manualA" && _MANUAL_CLUSTER_DESCS[entry.idx]) {
			h3.textContent += ` (${_MANUAL_CLUSTER_DESCS[entry.idx]})`;
		}
		header.appendChild(h3);
		const meta = el("span", "cluster-meta");
		const followVals = bucket.map(followAvg).filter((v) => v >= 0);
		meta.textContent =
			`${bucket.length} student${bucket.length === 1 ? "" : "s"}` +
			(followVals.length
				? ` (follow ${Math.min(...followVals).toFixed(1)}–${Math.max(...followVals).toFixed(1)}%)`
				: "");
		header.appendChild(meta);
		if (ordered.length > 1) section.appendChild(header);
		const grid = el("div", "cluster-grid");
		const sortedBucket = _sortStudents(bucket, _clusterSort);
		for (const s of sortedBucket) {
			const { card, chart } = _buildStudentProgressCard(s, labelsX);
			grid.appendChild(card);
			_clusterCharts.push(chart);
		}
		section.appendChild(grid);
		body.appendChild(section);
	});

	const llmStudents = _students.filter((s) => s.ai_flagged);
	if (llmStudents.length && !_hideArtefacts) {
		const section = el("div", "cluster-section");
		const header = el("div", "cluster-header");
		const h3 = el("h3");
		h3.textContent = "LLM Probes";
		header.appendChild(h3);
		const meta = el("span", "cluster-meta");
		meta.textContent = `${llmStudents.length} probe${
			llmStudents.length === 1 ? "" : "s"
		}`;
		header.appendChild(meta);
		section.appendChild(header);
		const grid = el("div", "cluster-grid");
		for (const s of _sortStudents(llmStudents, _clusterSort)) {
			const { card, chart } = _buildStudentProgressCard(s, labelsX);
			grid.appendChild(card);
			_clusterCharts.push(chart);
		}
		section.appendChild(grid);
		body.appendChild(section);
	}

	_addProgressFollowBoxplot(body, students);

	_refreshChartDownloadBtns();
}

document.getElementById("cluster-k")?.addEventListener("change", () => {
	if (_students.length) renderClusters();
});

(function _initClusterModeUI() {
	const ta = document.querySelector('[data-manual-text="A"]');
	if (ta && !ta.value) {
		let saved = null;
		try {
			saved = localStorage.getItem(_MANUAL_LS_KEYS.A);
		} catch {}
		ta.value = saved || _MANUAL_DEFAULTS.A;
	}
	_applyClusterModeUI();
})();

document.getElementById("cluster-mode")?.addEventListener("change", () => {
	_applyClusterModeUI();
	if (_students.length) renderClusters();
});

document
	.getElementById("cluster-manual-apply")
	?.addEventListener("click", () => {
		const slot = _manualSlot();
		const ta = document.querySelector(`[data-manual-text="${slot}"]`);
		try {
			if (ta) localStorage.setItem(_MANUAL_LS_KEYS[slot], ta.value);
		} catch {}
		if (_students.length) renderClusters();
	});

document.querySelectorAll(".cluster-sort[data-cluster-sort]").forEach((btn) => {
	btn.addEventListener("click", () => {
		_clusterSort = btn.dataset.clusterSort;
		document
			.querySelectorAll(".cluster-sort[data-cluster-sort]")
			.forEach((b) => b.classList.toggle("active", b === btn));
		if (_students.length) renderClusters();
	});
});

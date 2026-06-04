"use strict";

const _DEFAULT_MANUAL_A_PARTITIONS = [
	"80, 81, 78, 50, 55, 23, 82, 20, 24, 3",
	"70, 77, 48, 72, 18, 30, 76, 67, 4, 74, 58, 34, 69, 35, 49, 8",
	"61, 29, 25, 11, 44, 63, 71, 31, 47, 45, 36, 65, 10, 41, 38, 60, 28, 17, 62, 73, 84, 13, 59, 66, 15, 22, 53",
	"rest",
].join("\n");

const _DEFAULT_MANUAL_B_PARTITIONS = [
	"80, 81, 78, 23, 20, 30, 61, 29, 44, 70, 50, 4",
	"24, 3, 72, 18, 11, 63, 45, 38, 10, 53, 59, 47, 74, 60, 34",
	"rest",
].join("\n");

const _MANUAL_LS_KEYS = {
	A: "cluster_manual_text_a_v1",
	B: "cluster_manual_text_b_v1",
};
const _MANUAL_DEFAULTS = {
	A: _DEFAULT_MANUAL_A_PARTITIONS,
	B: _DEFAULT_MANUAL_B_PARTITIONS,
};

function _clusterMode() {
	const v = document.getElementById("cluster-mode")?.value;
	return v === "manualA" || v === "manualB" ? v : "kmeans";
}

function _manualSlot() {
	return _clusterMode() === "manualB" ? "B" : "A";
}

function _clusterOpts() {
	return {
		k: Math.max(
			2,
			Math.min(25, +document.getElementById("cluster-k")?.value || 4),
		),
		useFollow:
			document.getElementById("cluster-feat-follow")?.checked ?? true,
		useGrade: document.getElementById("cluster-feat-grade")?.checked ?? true,
		useLang: document.getElementById("cluster-feat-lang")?.checked ?? true,
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
	const isManual = mode === "manualA" || mode === "manualB";
	document
		.querySelectorAll(".cluster-kmeans-only")
		.forEach((el) => (el.style.display = mode === "kmeans" ? "" : "none"));
	const panel = document.getElementById("cluster-manual-panel");
	if (panel) panel.style.display = isManual ? "" : "none";
	const slot = _manualSlot();
	document
		.querySelectorAll("[data-manual]")
		.forEach(
			(el) => (el.style.display = el.dataset.manual === slot ? "" : "none"),
		);
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
	if (!_students.length) return;

	const mode = _clusterMode();
	const labelsX = ASSIGNMENTS.map((a) => a.name);
	let labels, centroids, k;

	if (mode === "manualA" || mode === "manualB") {
		const slot = _manualSlot();
		const ta = document.querySelector(`[data-manual-text="${slot}"]`);
		const text = (ta && ta.value) || _MANUAL_DEFAULTS[slot];
		const parsed = _parseManualPartitions(text, _students);
		labels = parsed.labels;
		k = parsed.numClusters;
		const opts = { useFollow: true, useGrade: true, useLang: true };
		const features = _buildClusterFeatures(_students, opts);
		const nCols = features[0]?.length || 0;
		centroids = Array.from({ length: k }, () => new Array(nCols).fill(0));
		const counts = new Array(k).fill(0);
		for (let i = 0; i < _students.length; i++) {
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
		if (!opts.useFollow && !opts.useGrade && !opts.useLang) {
			body.innerHTML =
				'<div class="cluster-empty">Pick at least one feature to cluster on.</div>';
			return;
		}
		const features = _buildClusterFeatures(_students, opts);
		k = Math.min(opts.k, _students.length);
		const res = _kmeans(features, k, 10000, _clusterSeed);
		labels = res.labels;
		centroids = res.centroids;
	}

	const buckets = Array.from({ length: k }, () => []);
	_students.forEach((s, i) => {
		if (_hideExcluded && s.excluded) return;
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
		header.appendChild(h3);
		const meta = el("span", "cluster-meta");
		const followVals = bucket.map(followAvg).filter((v) => v >= 0);
		const gradeVals = bucket
			.map((s) => s.avg_assignments)
			.filter((v) => v != null);
		const summarize = (vals, digits, suffix) => {
			if (!vals.length) return "—";
			const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
			const mn = Math.min(...vals);
			const mx = Math.max(...vals);
			return `${avg.toFixed(digits)}${suffix} (${mn.toFixed(digits)}–${mx.toFixed(digits)})`;
		};
		meta.textContent = `${bucket.length} student${bucket.length === 1 ? "" : "s"} · follow ${summarize(followVals, 1, "%")} · grade ${summarize(gradeVals, 2, "")}`;
		header.appendChild(meta);
		section.appendChild(header);
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
}

document.getElementById("cluster-k")?.addEventListener("change", () => {
	if (_students.length) renderClusters();
});
document.getElementById("cluster-recluster")?.addEventListener("click", () => {
	_clusterSeed = (_clusterSeed * 1103515245 + 12345) >>> 0;
	if (_students.length) renderClusters();
});
["cluster-feat-follow", "cluster-feat-grade", "cluster-feat-lang"].forEach(
	(id) => {
		document.getElementById(id)?.addEventListener("change", () => {
			if (_students.length) renderClusters();
		});
	},
);

(function _initClusterModeUI() {
	let legacy = null;
	try {
		legacy = localStorage.getItem("cluster_manual_text_v2");
	} catch {}
	for (const slot of ["A", "B"]) {
		const ta = document.querySelector(`[data-manual-text="${slot}"]`);
		if (!ta || ta.value) continue;
		let saved = null;
		try {
			saved = localStorage.getItem(_MANUAL_LS_KEYS[slot]);
		} catch {}
		if (!saved && slot === "A" && legacy) {
			saved = legacy;
			try {
				localStorage.setItem(_MANUAL_LS_KEYS.A, legacy);
				localStorage.removeItem("cluster_manual_text_v2");
			} catch {}
		}
		ta.value = saved || _MANUAL_DEFAULTS[slot];
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

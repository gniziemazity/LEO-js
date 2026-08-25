(function (root) {
	const FILE_RE = /\.[a-z0-9]+$/i;
	const ANCHOR_WRAP = "⚓";

	function unwrapAnchor(target) {
		const t = typeof target === "string" ? target : "";
		const wrapped =
			t.length >= 3 && t.startsWith(ANCHOR_WRAP) && t.endsWith(ANCHOR_WRAP);
		return { wrapped, inner: wrapped ? t.slice(1, -1) : t };
	}

	function wrapAnchor(id) {
		return `${ANCHOR_WRAP}${id}${ANCHOR_WRAP}`;
	}

	function isFileName(name) {
		return typeof name === "string" && FILE_RE.test(name);
	}

	function classifyMoveToTarget(target) {
		const raw = typeof target === "string" && target ? target : "MAIN";
		if (raw === "MAIN") {
			return { mode: "main", target: raw, inner: raw, wrapped: false };
		}
		if (raw === "DEV") {
			return { mode: "dev", target: raw, inner: raw, wrapped: false };
		}
		const { wrapped, inner } = unwrapAnchor(raw);
		if (isFileName(inner)) {
			return { mode: "file", target: inner, inner, wrapped };
		}
		if (wrapped) {
			return { mode: "anchor", target: raw, inner, wrapped };
		}
		return { mode: "main", target: raw, inner, wrapped };
	}

	function moveToFileName(target) {
		const t = classifyMoveToTarget(target);
		return t.mode === "file" ? t.target : null;
	}

	function moveToDisplayName(target) {
		const t = classifyMoveToTarget(target);
		if (t.mode === "main")
			return t.target === "MAIN" ? "Main Editor" : t.target;
		if (t.mode === "dev") return "Dev Tools";
		if (t.mode === "file") return t.target;
		return wrapAnchor(t.inner);
	}

	function moveToTargetLabel(target) {
		const t = classifyMoveToTarget(target);
		const name = moveToDisplayName(target);
		return t.mode === "file" ? `📄 ${name}` : name;
	}

	const api = {
		ANCHOR_WRAP,
		FILE_RE,
		unwrapAnchor,
		wrapAnchor,
		isFileName,
		classifyMoveToTarget,
		moveToFileName,
		moveToDisplayName,
		moveToTargetLabel,
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
	root.MoveToTarget = api;
})(typeof window !== "undefined" ? window : this);

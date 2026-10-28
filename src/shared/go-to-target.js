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

	function anchorIdPattern() {
		return /⚓(\d+)⚓/g;
	}

	function isFileName(name) {
		return typeof name === "string" && FILE_RE.test(name);
	}

	function classifyGoToTarget(target) {
		const raw = typeof target === "string" && target ? target : "MAIN";
		if (raw === "MAIN") {
			return { mode: "main", target: raw, inner: raw, wrapped: false };
		}
		if (raw === "DEV") {
			return { mode: "dev", target: raw, inner: raw, wrapped: false };
		}
		if (isFileName(raw)) {
			return { mode: "file", target: raw, inner: raw, wrapped: false };
		}
		const { wrapped, inner } = unwrapAnchor(raw);
		if (wrapped) {
			return { mode: "anchor", target: raw, inner, wrapped };
		}
		return { mode: "main", target: raw, inner, wrapped };
	}

	function goToFileName(target) {
		const t = classifyGoToTarget(target);
		return t.mode === "file" ? t.target : null;
	}

	function goToDisplayName(target) {
		const t = classifyGoToTarget(target);
		if (t.mode === "main")
			return t.target === "MAIN" ? "Main Editor" : t.target;
		if (t.mode === "dev") return "Dev Tools";
		if (t.mode === "file") return t.target;
		return wrapAnchor(t.inner);
	}

	function goToTargetLabel(target) {
		const t = classifyGoToTarget(target);
		const name = goToDisplayName(target);
		return t.mode === "file" ? `📄 ${name}` : name;
	}

	function goToPopupTitle({ mode, excerpt, typeName }) {
		if (mode === "file" && !!typeName) return "Create file:";
		const switchTo = mode === "anchor" && excerpt ? excerpt.switchTo : null;
		return switchTo ? `Go to (${goToDisplayName(switchTo)}):` : "Go to:";
	}

	const api = {
		wrapAnchor,
		anchorIdPattern,
		isFileName,
		classifyGoToTarget,
		goToFileName,
		goToDisplayName,
		goToTargetLabel,
		goToPopupTitle,
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
	root.GoToTarget = api;
})(typeof window !== "undefined" ? window : this);

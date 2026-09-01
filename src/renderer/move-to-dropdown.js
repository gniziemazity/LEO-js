const GAP = 4;

let open = null;

function isOpen() {
	return !!open;
}

function closeDropdown() {
	if (!open) return;
	const { list, onKey, onOutside, onScroll } = open;
	document.removeEventListener("keydown", onKey, true);
	document.removeEventListener("mousedown", onOutside, true);
	document.removeEventListener("scroll", onScroll, true);
	window.removeEventListener("resize", closeDropdown);
	list.remove();
	open = null;
}

function items() {
	return open ? [...open.list.children] : [];
}

function keepInView(el) {
	const list = open.list;
	const top = el.offsetTop;
	const bottom = top + el.offsetHeight;
	if (top < list.scrollTop) list.scrollTop = top;
	else if (bottom > list.scrollTop + list.clientHeight) {
		list.scrollTop = bottom - list.clientHeight;
	}
}

function setActive(idx) {
	const els = items();
	if (!els.length) return;
	const next = Math.max(0, Math.min(els.length - 1, idx));
	els.forEach((el, i) => el.classList.toggle("active", i === next));
	open.index = next;
	const el = els[next];
	keepInView(el);
	// A keyboard move should preview like a hover does.
	el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
}

function place(list, anchorEl) {
	const a = anchorEl.getBoundingClientRect();
	const box = list.getBoundingClientRect();
	let top = a.bottom + GAP;
	if (top + box.height > window.innerHeight - GAP) {
		const above = a.top - box.height - GAP;
		top =
			above >= GAP
				? above
				: Math.max(GAP, window.innerHeight - box.height - GAP);
	}
	let left = a.left;
	const overflow = left + box.width - window.innerWidth + GAP;
	if (overflow > 0) left -= overflow;
	list.style.top = `${Math.max(GAP, top)}px`;
	list.style.left = `${Math.max(GAP, left)}px`;
}

function openDropdown({ anchorEl, blockIdx, options, value, onPick }) {
	closeDropdown();

	const list = document.createElement("div");
	list.className = "mt-options";
	list.dataset.blockIndex = String(blockIdx);

	const pick = (v) => {
		closeDropdown();
		onPick(v);
	};

	options.forEach((o) => {
		const item = document.createElement("div");
		item.className = "mt-option";
		item.dataset.value = o.value;
		item.textContent = o.label;
		if (o.value === value) item.classList.add("selected");
		item.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		item.addEventListener("click", (e) => {
			e.stopPropagation();
			pick(o.value);
		});
		item.addEventListener("mouseover", () => {
			const els = items();
			els.forEach((el) => el.classList.toggle("active", el === item));
			open.index = els.indexOf(item);
		});
		list.appendChild(item);
	});

	document.body.appendChild(list);

	const HANDLED = new Set([
		"ArrowDown",
		"ArrowUp",
		"Home",
		"End",
		"Enter",
		" ",
		"Escape",
		"Tab",
	]);
	const onKey = (e) => {
		if (HANDLED.has(e.key)) e.stopPropagation();
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActive(open.index + 1);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActive(open.index - 1);
		} else if (e.key === "Home") {
			e.preventDefault();
			setActive(0);
		} else if (e.key === "End") {
			e.preventDefault();
			setActive(items().length - 1);
		} else if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			const el = items()[open.index];
			if (el) pick(el.dataset.value);
		} else if (e.key === "Escape" || e.key === "Tab") {
			e.preventDefault();
			closeDropdown();
		}
	};
	const onOutside = (e) => {
		if (!list.contains(e.target) && e.target !== anchorEl) closeDropdown();
	};
	const onScroll = (e) => {
		if (!list.contains(e.target)) closeDropdown();
	};

	open = { list, anchorEl, index: -1, onKey, onOutside, onScroll };

	document.addEventListener("keydown", onKey, true);
	document.addEventListener("mousedown", onOutside, true);
	document.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", closeDropdown);

	place(list, anchorEl);
	const selected = items().findIndex((el) =>
		el.classList.contains("selected"),
	);
	open.index = selected < 0 ? 0 : selected;
	const el = items()[open.index];
	if (el) {
		el.classList.add("active");
		keepInView(el);
	}
	return list;
}

module.exports = { openDropdown, closeDropdown, isOpen };

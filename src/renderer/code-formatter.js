function formatCodeForAutoTyping(code) {
	let text = code.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	text = text.replace(/↑►/g, "");

	const tags = ["html", "head", "body", "script", "style", "div"];
	const specialClose = new Set(["html", "script"]);
	for (const tag of tags) {
		text = text.replace(new RegExp("</" + tag + ">", "g"), "↓►");
		const prefix = specialClose.has(tag) ? "↢" : "";
		text = text.replace(
			new RegExp("<" + tag + ">", "g"),
			"<" + tag + ">\n" + prefix + "</" + tag + ">↑►",
		);
	}

	text = text.replace(/ +/g, " ");
	text = text.replace(/\n +/g, "\n");
	text = text.replace(/[ \t]+$/gm, "");

	text = applyBlockMatching(text);

	text = text.replace(/\n↓►/g, "↓►");
	text = text.replace(/↓💾/g, "💾");
	text = text.replace(/↑►↓►/g, "↑►");
	text = text.replace(/(?:↓►)+$/, "");

	return text;
}

function applyBlockMatching(text) {
	const lines = text.split("\n");
	const stack = [];
	const closesAfter = new Map();
	const closeLineIdxs = new Set();

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		let registered = false;
		for (let j = 0; j < line.length; j++) {
			const c = line[j];
			if (c === "{" || c === "(") {
				stack.push({ type: c, lineIdx: i, charIdx: j });
			} else if (c === "}" || c === ")") {
				const expected = c === "}" ? "{" : "(";
				if (
					stack.length === 0 ||
					stack[stack.length - 1].type !== expected
				) {
					continue;
				}
				const open = stack.pop();
				if (registered) continue;
				if (open.lineIdx === i) continue;
				const openLine = lines[open.lineIdx];
				const openTrimmed = openLine.replace(/\s+$/, "");
				const openAtEnd =
					openTrimmed.endsWith(open.type) &&
					openTrimmed.length === open.charIdx + 1;
				if (!openAtEnd) continue;
				if (line.slice(0, j).trim() !== "") continue;
				if (closesAfter.has(open.lineIdx)) continue;
				closesAfter.set(open.lineIdx, line.trim());
				closeLineIdxs.add(i);
				registered = true;
			}
		}
	}

	const out = [];
	for (let i = 0; i < lines.length; i++) {
		if (closeLineIdxs.has(i)) {
			if (out.length > 0) out[out.length - 1] += "↓►";
			continue;
		}
		out.push(lines[i]);
		if (closesAfter.has(i)) {
			out.push(closesAfter.get(i) + "↑►");
		}
	}

	return out.join("\n");
}

module.exports = { formatCodeForAutoTyping };

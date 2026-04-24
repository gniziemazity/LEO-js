"use strict";

const { linesDiffComputers } = require("vscode-diff");

const computer = linesDiffComputers.getDefault();

function lineStartOffsets(text) {
	const starts = [0];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") starts.push(i + 1);
	}
	return starts;
}

function rangeToOffset(lineStarts, lineNumber, column) {
	const idx = Math.min(lineNumber - 1, lineStarts.length - 1);
	return lineStarts[idx] + column - 1;
}

function addLineMark(marks, lineStarts, lines, lineIdx, label) {
	const lineRaw = lines[lineIdx];
	if (!lineRaw || !lineRaw.trim()) return;
	const rawStart = lineStarts[lineIdx] ?? 0;
	const ls = lineRaw.length - lineRaw.trimStart().length;
	const le = lineRaw.trimEnd().length;
	const start = rawStart + ls;
	const end = rawStart + le;
	if (start < end) marks.push({ label, start, end, line: true });
}

function computeFileDiff(tText, sText) {
	const tNorm = tText.replace(/\r\n/g, "\n");
	const sNorm = sText.replace(/\r\n/g, "\n");
	const tLines = tNorm.split("\n");
	const sLines = sNorm.split("\n");
	const tStarts = lineStartOffsets(tNorm);
	const sStarts = lineStartOffsets(sNorm);

	let nTotal = 0;
	for (const l of tLines) if (l.trim()) nTotal++;

	const diffResult = computer.computeDiff(tLines, sLines, {
		ignoreTrimWhitespace: true,
		maxComputationTimeMs: 5000,
		computeMoves: true,
	});

	const tMarks = [];
	const sMarks = [];
	const alignment = [];
	let nMissing = 0;
	let tCursor = 0;
	let sCursor = 0;

	for (const change of diffResult.changes) {
		const origStart = change.original.startLineNumber - 1;
		const origEnd = change.original.endLineNumberExclusive - 1;
		const modStart = change.modified.startLineNumber - 1;
		const modEnd = change.modified.endLineNumberExclusive - 1;

		while (tCursor < origStart) {
			alignment.push([tCursor, sCursor]);
			tCursor++;
			sCursor++;
		}

		const nOrig = origEnd - origStart;
		const nMod = modEnd - modStart;
		const nPaired = Math.min(nOrig, nMod);

		if (nOrig > 0 && nMod > 0) {
			for (let i = 0; i < nOrig; i++)
				if (tLines[origStart + i].trim()) nMissing++;

			if (change.innerChanges && change.innerChanges.length > 0) {
				for (const rm of change.innerChanges) {
					const or = rm.originalRange;
					const mr = rm.modifiedRange;
					const tStart = rangeToOffset(
						tStarts,
						or.startLineNumber,
						or.startColumn,
					);
					const tEnd = rangeToOffset(
						tStarts,
						or.endLineNumber,
						or.endColumn,
					);
					const sStart = rangeToOffset(
						sStarts,
						mr.startLineNumber,
						mr.startColumn,
					);
					const sEnd = rangeToOffset(
						sStarts,
						mr.endLineNumber,
						mr.endColumn,
					);
					if (tStart < tEnd)
						tMarks.push({ label: "missing", start: tStart, end: tEnd });
					if (sStart < sEnd)
						sMarks.push({ label: "extra", start: sStart, end: sEnd });
				}
			} else {
				for (let i = 0; i < nOrig; i++)
					addLineMark(tMarks, tStarts, tLines, origStart + i, "missing");
				for (let i = 0; i < nMod; i++)
					addLineMark(sMarks, sStarts, sLines, modStart + i, "extra");
			}
		} else if (nOrig > 0) {
			for (let i = 0; i < nOrig; i++) {
				if (tLines[origStart + i].trim()) nMissing++;
				addLineMark(tMarks, tStarts, tLines, origStart + i, "missing");
			}
		} else {
			for (let i = 0; i < nMod; i++)
				addLineMark(sMarks, sStarts, sLines, modStart + i, "extra");
		}

		for (let i = 0; i < nPaired; i++)
			alignment.push([origStart + i, modStart + i]);
		for (let i = nPaired; i < nOrig; i++)
			alignment.push([origStart + i, null]);
		for (let i = nPaired; i < nMod; i++) alignment.push([null, modStart + i]);

		tCursor = origEnd;
		sCursor = modEnd;
	}

	while (tCursor < tLines.length || sCursor < sLines.length) {
		alignment.push([
			tCursor < tLines.length ? tCursor : null,
			sCursor < sLines.length ? sCursor : null,
		]);
		if (tCursor < tLines.length) tCursor++;
		if (sCursor < sLines.length) sCursor++;
	}

	const score =
		nTotal > 0
			? Math.round(((nTotal - nMissing) / nTotal) * 1000) / 10
			: null;
	return { tMarks, sMarks, alignment, score, nTotal, nMissing };
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
	try {
		const input = JSON.parse(raw);
		const teacherFiles = input.teacherFiles || {};
		const studentFiles = input.studentFiles || {};
		const tNames = Object.keys(teacherFiles);
		const sNames = Object.keys(studentFiles);

		const teacherResult = {};
		const studentResult = {};
		const alignments = {};
		let totalTeacher = 0;
		let totalMissing = 0;

		for (const tName of tNames) {
			let sName = sNames.find((n) => n === tName);
			if (!sName) {
				const tExt = tName.split(".").pop().toLowerCase();
				sName = sNames.find(
					(n) => n.split(".").pop().toLowerCase() === tExt,
				);
			}
			const tText = teacherFiles[tName] || "";
			const sText = sName ? studentFiles[sName] : "";
			const { tMarks, sMarks, alignment, nTotal, nMissing } =
				computeFileDiff(tText, sText);

			if (tMarks.length) teacherResult[tName] = tMarks;
			const resolvedSName = sName || tName;
			if (sMarks.length) studentResult[resolvedSName] = sMarks;
			alignments[tName] = alignment;
			if (resolvedSName !== tName) alignments[resolvedSName] = alignment;
			totalTeacher += nTotal;
			totalMissing += nMissing;
		}

		const score =
			totalTeacher > 0
				? Math.round(
						((totalTeacher - totalMissing) / totalTeacher) * 1000,
					) / 10
				: null;

		const output = {
			format_version: 4,
			token_matching: "line-vscode",
			case_sensitive: true,
			teacher_files: teacherResult,
			student_files: studentResult,
			alignments,
		};
		if (score !== null) output.score = score;
		process.stdout.write(JSON.stringify(output));
	} catch (e) {
		process.stderr.write(String(e));
		process.exit(1);
	}
});

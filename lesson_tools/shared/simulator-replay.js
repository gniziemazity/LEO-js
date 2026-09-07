"use strict";

function headlessReplay(events, lessonFile = null) {
	const ctx = makeReplayContext(lessonFile);

	for (const act of expandEvents(events)) replayStep(ctx, act);

	const tsToPos = new Map();
	for (const [filename, st] of ctx.files) {
		for (let i = 0; i < st.charTs.length; i++) {
			const ts = st.charTs[i];
			let arr = tsToPos.get(ts);
			if (!arr) {
				arr = [];
				tsToPos.set(ts, arr);
			}
			arr.push({ file: filename, pos: i });
		}
	}

	return { files: ctx.files, dev: ctx.dev, tsToPos };
}

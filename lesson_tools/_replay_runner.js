"use strict";

(async () => {
	const fs = require("fs");
	const path = require("path");

	const logPath = process.argv[2];
	if (!logPath) {
		console.error("usage: node _replay_runner.js <log.json>");
		process.exit(2);
	}

	const here = __dirname;
	const LP = require(path.join(here, "languages", "profiles.js"));
	await LP.initProfiles();
	global.window = { LanguageProfiles: LP };

	const modelSrc = fs.readFileSync(
		path.join(here, "shared/simulator-model.js"),
		"utf-8",
	);
	const replaySrc = fs.readFileSync(
		path.join(here, "shared/simulator-replay.js"),
		"utf-8",
	);
	const make = new Function(
		"window",
		`${modelSrc}\n${replaySrc}\nreturn { headlessReplay };`,
	);
	const api = make(global.window);

	const log = JSON.parse(fs.readFileSync(logPath, "utf-8"));
	const result = api.headlessReplay(log.events, log.lessonFile);
	const main = result.files.get("MAIN");
	process.stdout.write(main.text);
})().catch((e) => {
	console.error(e.stack || e.message);
	process.exit(3);
});

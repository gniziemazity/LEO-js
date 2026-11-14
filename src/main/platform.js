const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isMacOS(settingsManager) {
	return settingsManager.get("platform") === "macos";
}

function primaryModifier(settingsManager, Key) {
	return isMacOS(settingsManager) ? Key.LeftCmd : Key.LeftControl;
}

function typesInOneStep(settingsManager) {
	return process.platform === "win32" && !isMacOS(settingsManager);
}

module.exports = { sleep, isMacOS, primaryModifier, typesInOneStep };

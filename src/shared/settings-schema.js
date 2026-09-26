const COLOR_SETTINGS = [
	{ key: "codeBlockColor", domId: "codeBlockColor", value: "#ffffff" },
	{ key: "noteColor", domId: "noteColor", value: "#fff9c4" },
	{ key: "questionColor", domId: "questionColor", value: "#facaca" },
	{ key: "imageBlockColor", domId: "imageBlockColor", value: "#bbdefb" },
	{ key: "snippetColor", domId: "snippetColor", value: "#f0f0f0" },
	{ key: "moveToBlockColor", domId: "moveToBlockColor", value: "#424242" },
	{ key: "moveToTextColor", domId: "moveToTextColor", value: "#3498db" },
	{ key: "activeBlockColor", domId: "activeBlockColor", value: "#2c3e50" },
	{ key: "selectedBlockColor", domId: "selectedBlockColor", value: "#f0f8ff" },
	{
		key: "activeBlockTextColor",
		domId: "activeBlockTextColor",
		value: "#f1c40f",
	},
	{ key: "cursor", domId: "cursorColor", value: "#e74c3c" },
	{ key: "selectedBorder", domId: "selectedBorderColor", value: "#3498db" },
	{ key: "textColor", domId: "textColor", value: "#333333" },
];

const HOTKEY_SETTINGS = [
	{
		key: "toggleActive",
		domId: "toggleActiveKey",
		value: "CommandOrControl+P",
		channel: "hotkey-toggle-active",
	},
	{
		key: "stepBackward",
		domId: "stepBackwardKey",
		value: "CommandOrControl+Left",
		channel: "hotkey-step-backward",
		step: -1,
	},
	{
		key: "stepForward",
		domId: "stepForwardKey",
		value: "CommandOrControl+Right",
		channel: "hotkey-step-forward",
		step: 1,
	},
	{
		key: "alwaysOnTop",
		domId: "alwaysOnTopKey",
		value: "CommandOrControl+Shift+Space",
	},
	{
		key: "toggleTransparency",
		domId: "toggleTransparencyKey",
		value: "CommandOrControl+Shift+T",
	},
	{
		key: "toggleWindow",
		domId: "toggleWindowKey",
		value: "CommandOrControl+L",
	},
	{
		key: "confirmPopup",
		domId: "confirmPopupKey",
		value: "CommandOrControl+Enter",
	},
];

function defaultsFrom(settings) {
	const out = {};
	for (const s of settings) out[s.key] = s.value;
	return out;
}

function domFieldsFor(settings) {
	return settings.map((s) => [s.domId, s.key]);
}

module.exports = {
	COLOR_SETTINGS,
	HOTKEY_SETTINGS,
	defaultsFrom,
	domFieldsFor,
};

const COLOR_SETTINGS = [
	{ key: "codeBlockColor", domId: "codeBlockColor", value: "#ffffff" },
	{ key: "commentNormal", domId: "commentNormalColor", value: "#fff9c4" },
	{
		key: "questionCommentColor",
		domId: "questionCommentColor",
		value: "#facaca",
	},
	{ key: "imageBlockColor", domId: "imageBlockColor", value: "#bbdefb" },
	{
		key: "codeInsertBlockColor",
		domId: "codeInsertBlockColor",
		value: "#f0f0f0",
	},
	{ key: "moveToBlockColor", domId: "moveToBlockColor", value: "#424242" },
	{ key: "moveToTextColor", domId: "moveToTextColor", value: "#3498db" },
	{ key: "commentActive", domId: "commentActiveColor", value: "#2c3e50" },
	{ key: "commentSelected", domId: "commentSelectedColor", value: "#f0f8ff" },
	{
		key: "commentActiveText",
		domId: "commentActiveTextColor",
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
	},
	{
		key: "stepForward",
		domId: "stepForwardKey",
		value: "CommandOrControl+Right",
		channel: "hotkey-step-forward",
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

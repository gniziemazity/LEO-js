const { app, Menu } = require("electron");
const { settingsManager } = require("./context");
const state = require("./state");
const {
	LESSON_TOOLS,
	getCourseMenuState,
	openLessonTool,
	launchExternalApp,
	launchVSCode,
} = require("./lesson-tools");

const send = (ch, ...args) => state.send(ch, ...args);

function setMenuMode(mode) {
	settingsManager.set("mode", mode);
	send("apply-mode", mode);
	createApplicationMenu();
}

function createApplicationMenu() {
	const courseMenuState = getCourseMenuState();
	const currentMode = settingsManager.get("mode") || "record";

	const template = [
		{
			label: "File",
			submenu: [
				{
					label: "New Course",
					click: () => send("new-course"),
				},
				{
					label: "Open Course",
					click: () => send("open-course"),
				},
				{
					label: "Save Course",
					click: () => send("save-course"),
				},
				...(courseMenuState.open
					? [
							{
								label: "Close Course",
								click: () => send("close-course"),
							},
						]
					: []),
				{ type: "separator" },
				...(courseMenuState.open
					? []
					: [
							{
								label: "New Plan",
								accelerator: "CmdOrCtrl+N",
								click: () => send("new-plan"),
							},
						]),
				{
					label: "Save Plan",
					accelerator: "CmdOrCtrl+S",
					click: () => send("save-plan"),
				},
				...(courseMenuState.open
					? []
					: [
							{
								label: "Load Plan",
								accelerator: "CmdOrCtrl+O",
								click: () => send("load-plan"),
							},
						]),
				{ type: "separator" },
				{
					label: "Add Students…",
					click: () => send("add-students"),
				},
				{ type: "separator" },
				{
					label: "Exit",
					accelerator: "CmdOrCtrl+Q",
					click: () => {
						app.isQuitting = true;
						app.quit();
					},
				},
			],
		},
		{
			label: "Edit",
			submenu: [
				{
					label: "Undo",
					accelerator: "CmdOrCtrl+Z",
					click: () => send("undo"),
				},
				{
					label: "Redo",
					accelerator: "CmdOrCtrl+Shift+Z",
					click: () => send("redo"),
				},
				{ type: "separator" },
				{
					label: "Settings",
					accelerator: "CmdOrCtrl+,",
					click: () => send("open-settings"),
				},
				{ type: "separator" },
				{
					label: "Toggle Developer Tools",
					accelerator: "CmdOrCtrl+I",
					click: () => state.mainWindow.webContents.toggleDevTools(),
				},
			],
		},
		{
			label: "Mode",
			submenu: ["record", "classroom", "scientific"].map((m) => ({
				label: m[0].toUpperCase() + m.slice(1),
				type: "radio",
				checked: currentMode === m,
				click: () => setMenuMode(m),
			})),
		},
		{
			label: "Tools",
			submenu: [
				{ label: "VSCode", click: launchVSCode },
				{ label: "Chrome", click: () => launchExternalApp("chrome") },
				...(courseMenuState.open
					? [
							{ type: "separator" },
							...LESSON_TOOLS.map((t) => ({
								label: t.label,
								click: () => openLessonTool(t),
							})),
						]
					: []),
			],
		},
	];

	if (courseMenuState.open) {
		const planItems = courseMenuState.plans.length
			? courseMenuState.plans.map((p) => ({
					label: p.name,
					type: "radio",
					checked: p.path === courseMenuState.currentPath,
					click: () => send("open-plan-file", p.path),
				}))
			: [{ label: "(no plans yet)", enabled: false }];
		template.splice(1, 0, {
			label: "Plans",
			submenu: [
				{
					label: "Add Plan",
					accelerator: "CmdOrCtrl+N",
					click: () => send("new-plan"),
				},
				{ type: "separator" },
				...planItems,
			],
		});
	}

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { createApplicationMenu, setMenuMode };

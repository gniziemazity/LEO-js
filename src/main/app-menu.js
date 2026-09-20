const { app, Menu } = require("electron");
const state = require("./state");
const {
	LESSON_TOOLS,
	getCourseMenuState,
	toolAvailability,
	openSimulator,
	openLessonTool,
	launchChrome,
	launchVSCode,
} = require("./lesson-tools");

const send = (ch, ...args) => state.send(ch, ...args);

function toolsSubmenu(courseMenuState, availability, actions) {
	const items = [
		{ label: "VSCode", click: actions.launchVSCode },
		{ label: "Chrome", click: actions.launchChrome },
	];
	const tools = [];
	for (const tool of LESSON_TOOLS) {
		if (tool.needs === null) {
			if (courseMenuState.currentPath) {
				tools.push({ label: tool.label, click: actions.openSimulator });
			}
		} else if (courseMenuState.open && availability[tool.needs]) {
			tools.push({
				label: tool.label,
				click: () => actions.openLessonTool(tool),
			});
		}
	}
	if (tools.length) items.push({ type: "separator" }, ...tools);
	return items;
}

function createApplicationMenu() {
	const courseMenuState = getCourseMenuState();
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
			label: "Tools",
			submenu: toolsSubmenu(courseMenuState, toolAvailability(), {
				launchVSCode,
				launchChrome,
				openLessonTool,
				openSimulator: () => openSimulator(send),
			}),
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

module.exports = { createApplicationMenu, toolsSubmenu };

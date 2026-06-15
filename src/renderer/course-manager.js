const fs = require("fs");
const path = require("path");
const LessonManager = require("./lesson-manager");
const { assignAlterEgos, ALTER_EGO_POOL } = require("../shared/alter-egos");

const COURSE_META_FILE = ".leo-course";
const STUDENTS_CSV = "students.csv";
const ALTER_EGO_FILE = "alter-egos.txt";
const STUDENTS_HEADER = "Student ID;Student Name;Student Number;Alter Ego";
const COURSE_DIRS = ["plans", "lessons", "assignments"];
const INVALID_FS_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

class CourseManager {
	constructor() {
		this.rootPath = "";
		this.name = "";
		this.lastPlan = "";
	}

	isOpen() {
		return !!this.rootPath;
	}

	getName() {
		return this.name;
	}

	getRootPath() {
		return this.rootPath;
	}

	plansDir() {
		return path.join(this.rootPath, "plans");
	}

	defaultPlanPath(fileName) {
		return path.join(this.plansDir(), fileName);
	}

	_metaPath() {
		return path.join(this.rootPath, COURSE_META_FILE);
	}

	_studentsCsvPath() {
		return path.join(this.rootPath, STUDENTS_CSV);
	}

	_ensureDirs() {
		for (const dir of COURSE_DIRS) {
			fs.mkdirSync(path.join(this.rootPath, dir), { recursive: true });
		}
	}

	create(rootPath, name) {
		fs.mkdirSync(rootPath, { recursive: true });
		this.rootPath = rootPath;
		this.name = name || path.basename(rootPath);
		this.lastPlan = "";
		this._ensureDirs();
		this.saveCourseMeta();
	}

	open(rootPath) {
		if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
			throw new Error("Folder does not exist");
		}
		const hasStructure = COURSE_DIRS.some((dir) =>
			fs.existsSync(path.join(rootPath, dir)),
		);
		const metaPath = path.join(rootPath, COURSE_META_FILE);
		if (!hasStructure && !fs.existsSync(metaPath)) {
			throw new Error(
				"Missing plans/lessons/assignments folders and .leo-course",
			);
		}
		this.rootPath = rootPath;
		try {
			const meta = this._readMeta();
			this.name = meta.name || path.basename(rootPath);
			this.lastPlan = meta.lastPlan || "";
			this._ensureDirs();
		} catch (e) {
			this.rootPath = "";
			this.name = "";
			this.lastPlan = "";
			throw e;
		}
	}

	_readMeta() {
		try {
			const parsed = JSON.parse(fs.readFileSync(this._metaPath(), "utf8"));
			return parsed && typeof parsed === "object" ? parsed : {};
		} catch {
			return {};
		}
	}

	saveCourseMeta() {
		const meta = { name: this.name };
		if (this.lastPlan) meta.lastPlan = this.lastPlan;
		fs.writeFileSync(
			this._metaPath(),
			JSON.stringify(meta, null, 2) + "\n",
			"utf8",
		);
	}

	setLastPlan(planName) {
		if (this.lastPlan === planName) return false;
		this.lastPlan = planName;
		this.saveCourseMeta();
		return true;
	}

	planToOpen() {
		const plans = this.listPlans();
		if (!plans.length) return null;
		if (this.lastPlan) {
			const match = plans.find((p) => p.name === this.lastPlan);
			if (match) return match.path;
		}
		return plans[0].path;
	}

	_safeName(name) {
		return name.replace(INVALID_FS_CHARS, "").trim().replace(/\.+$/, "");
	}

	ensurePlanFolders(planName) {
		const safe = this._safeName(planName);
		fs.mkdirSync(path.join(this.rootPath, "lessons", safe), {
			recursive: true,
		});
		fs.mkdirSync(path.join(this.rootPath, "assignments", safe), {
			recursive: true,
		});
	}

	addPlan(planName, sourceFilePath = null) {
		const safe = this._safeName(planName);
		if (!safe) throw new Error("Invalid plan name");
		const srcExt = sourceFilePath
			? path.extname(sourceFilePath).toLowerCase()
			: "";
		const ext = srcExt === ".json" ? ".json" : ".leo";
		const planPath = path.join(this.plansDir(), `${safe}${ext}`);
		let content;
		if (sourceFilePath) {
			content = fs.readFileSync(sourceFilePath, "utf8");
			let parsed = null;
			try {
				parsed = JSON.parse(content);
			} catch {
				parsed = null;
			}
			if (!Array.isArray(parsed)) {
				throw new Error("Source file is not a valid LEO plan");
			}
		} else {
			content = JSON.stringify(LessonManager.defaultBlocks(), null, 2);
		}
		fs.writeFileSync(planPath, content, "utf8");
		this.ensurePlanFolders(safe);
		return planPath;
	}

	isInPlans(filePath) {
		const fileDir = path.resolve(path.dirname(filePath));
		const plansDir = path.resolve(this.plansDir());
		return process.platform === "win32"
			? fileDir.toLowerCase() === plansDir.toLowerCase()
			: fileDir === plansDir;
	}

	listPlans() {
		const dir = this.plansDir();
		if (!fs.existsSync(dir)) return [];
		return fs
			.readdirSync(dir)
			.filter((f) => /\.(leo|json)$/i.test(f))
			.sort((a, b) => a.localeCompare(b))
			.map((f) => ({
				name: f.replace(/\.(leo|json)$/i, ""),
				path: path.join(dir, f),
			}));
	}

	_parseStudentNames(csvText) {
		const lines = csvText
			.replace(/^﻿/, "")
			.split(/\r?\n/)
			.filter((l) => l.trim().length > 0);
		if (!lines.length) return [];
		const header = lines[0].split(";").map((h) => h.trim());
		const nameIdx = header.indexOf("Student Name");
		if (nameIdx === -1) return [];
		return lines
			.slice(1)
			.map((line) => (line.split(";")[nameIdx] || "").trim())
			.filter(Boolean);
	}

	getStudentNames() {
		const csvPath = this._studentsCsvPath();
		if (!fs.existsSync(csvPath)) return [];
		try {
			return this._parseStudentNames(fs.readFileSync(csvPath, "utf8"));
		} catch {
			return [];
		}
	}

	readStudentsRaw() {
		return this.getStudentNames().join("\n");
	}

	writeStudentsCsv(pastedText) {
		const names = pastedText
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean)
			.sort((a, b) => a.localeCompare(b));

		const assigned = assignAlterEgos(names);
		const rows = assigned.map((s, i) => `${i + 1};${s.name};;${s.alterEgo}`);
		const csv = "﻿" + [STUDENTS_HEADER, ...rows].join("\r\n") + "\r\n";
		fs.writeFileSync(this._studentsCsvPath(), csv, "utf8");
		fs.writeFileSync(
			path.join(this.rootPath, ALTER_EGO_FILE),
			ALTER_EGO_POOL.join("\n") + "\n",
			"utf8",
		);
		return { count: names.length };
	}
}

module.exports = CourseManager;

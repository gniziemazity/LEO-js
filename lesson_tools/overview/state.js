"use strict";

let COL = {};
let ASSIGNMENTS = [];

let _students = [];
let _globalStudentMap = {};
let _realToAlterMap = {};
let _lessonHandles = {};
let _assignHandles = {};
let _submittedIds = {};
let _scatterCharts = [];
let _barCharts = [];
let _pyStats = null;
let _artefactSchema = {};
let _lessonStats = null;
const COL_HIDE_KEYS = [
	{ key: "id", label: "ID" },
	{ key: "name", label: "Name" },
	{ key: "num", label: "Number" },
];
const _hiddenCols = new Set(["num"]);
let _hideExcluded = false;
let _hideCopiers = false;

let _clusterCharts = [];
let _clusterSeed = 42;
let _clusterSort = "id";

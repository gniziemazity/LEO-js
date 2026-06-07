"use strict";

let COL = {};
let ASSIGNMENTS = [];

let _students = [];
let _globalStudentMap = {};
let _realToAlterMap = {};
let _lessonHandles = {};
let _assignHandles = {};
let _scatterCharts = [];
let _barCharts = [];
let _pyStats = null;
let _artefactSchema = {};
let _lessonStats = null;
let _anonMode = "name";
let _hideExcluded = false;

let _clusterCharts = [];
let _clusterSeed = 42;
let _clusterSort = "id";

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
let _progressCharts = [];
let _pyStats = null;
let _artefactSchema = {};
let _lessonStats = null;
let _curSort = "name";
let _anonMode = "name";
let _hideExcluded = false;

let _clusterCharts = [];
let _clusterSeed = 42;
let _clusterSort = "total-follow";

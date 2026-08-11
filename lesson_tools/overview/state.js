"use strict";

let COL = {};
let ASSIGNMENTS = [];
let _extraColumns = { before: [], after: [], pairs: [] };
let _extraColIdx = {};

let _students = [];
let _lessonHandles = {};
let _assignHandles = {};
let _submittedIds = {};
let _scatterCharts = [];
let _barCharts = [];
let _pyStats = null;
let _artefactSchema = {};
let _lessonStats = null;
const _hideExcluded = true;
let _hideCopiers = true;
let _hideArtefacts = true;

let _overviewDs = null;
let _basisFiles = new Map();
let _activeBasis = null;
let _baseFollowSnapshot = null;

let _clusterCharts = [];
let _clusterSort = "total-follow";

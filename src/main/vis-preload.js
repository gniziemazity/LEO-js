"use strict";

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("__LOG_DATA_PRELOAD__", null);

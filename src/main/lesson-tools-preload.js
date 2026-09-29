const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("leoTools", {
	exportFiles: (files) => ipcRenderer.invoke("tool-export-files", files),
	openFolder: () => ipcRenderer.invoke("tool-open-export-folder"),
});

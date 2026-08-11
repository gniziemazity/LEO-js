"use strict";

class FsDataSource extends DataSource {
	constructor({ lowercaseKeys = true } = {}) {
		super();
		this._lowercaseKeys = lowercaseKeys;
	}
	async open() {
		const handle = await pickFolder();
		this.rootHandle = handle;
		this.rootName = handle.name;
		return handle;
	}
	async load(subPath = "") {
		if (!this.rootHandle) throw new Error("FsDataSource: no root handle");
		this.files.clear();
		const flatFiles = [];
		const startHandle = subPath
			? await _resolveSubHandle(this.rootHandle, subPath)
			: this.rootHandle;
		const prefix = subPath ? subPath.replace(/\/+$/, "") : "";
		await readDirHandle(startHandle, prefix, this.files, flatFiles, {
			lowercaseKeys: this._lowercaseKeys,
		});
		return flatFiles;
	}
	async lessonFiles() {
		return null;
	}
}

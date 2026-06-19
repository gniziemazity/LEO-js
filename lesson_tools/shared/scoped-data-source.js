"use strict";

class ScopedDataSource extends DataSource {
	constructor({
		files,
		name,
		isReadOnly = false,
		rootHandle = null,
		serverWritable = false,
	}) {
		super();
		this.files = files;
		this.rootName = name;
		this.rootHandle = rootHandle;
		this.isReadOnly = isReadOnly;
		this.serverWritable = serverWritable;
	}
	async load() {
		return [...this.files.values()];
	}
}

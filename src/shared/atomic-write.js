const fs = require("fs");

function writeFileAtomicSync(target, text, suffix = ".tmp") {
	const temp = `${target}${suffix}`;
	try {
		fs.writeFileSync(temp, text);
		fs.renameSync(temp, target);
	} catch (error) {
		try {
			fs.unlinkSync(temp);
		} catch (_) {}
		throw error;
	}
}

function writeFileAtomic(target, text, suffix, callback) {
	const temp = `${target}${suffix}`;
	fs.writeFile(temp, text, (err) => {
		if (err) {
			callback(err);
			return;
		}
		fs.rename(temp, target, (renameErr) => {
			if (renameErr) fs.unlink(temp, () => {});
			callback(renameErr || null);
		});
	});
}

module.exports = { writeFileAtomicSync, writeFileAtomic };

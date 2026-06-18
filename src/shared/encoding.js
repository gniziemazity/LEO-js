const fs = require("fs");

function stripBom(text) {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function decodeBuffer(buf) {
	if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
		return buf.toString("utf16le", 2);
	}
	if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
		return Buffer.from(buf).swap16().toString("utf16le", 2);
	}
	try {
		return stripBom(new TextDecoder("utf-8", { fatal: true }).decode(buf));
	} catch (e) {}
	try {
		return stripBom(new TextDecoder("windows-1252").decode(buf));
	} catch (e) {}
	return stripBom(new TextDecoder("latin1").decode(buf));
}

function readTextFileSync(filePath) {
	return decodeBuffer(fs.readFileSync(filePath));
}

module.exports = { readTextFileSync, decodeBuffer, stripBom };

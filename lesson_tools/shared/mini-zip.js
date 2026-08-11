"use strict";

const _CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[i] = c;
	}
	return t;
})();

function _crc32(bytes) {
	let crc = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) {
		crc = _CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

async function _inflateRaw(bytes) {
	const ds = new DecompressionStream("deflate-raw");
	const w = ds.writable.getWriter();
	w.write(bytes);
	w.close();
	return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

async function _deflateRaw(bytes) {
	const cs = new CompressionStream("deflate-raw");
	const w = cs.writable.getWriter();
	w.write(bytes);
	w.close();
	return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

async function miniZipParse(bytes) {
	if (bytes.byteOffset || bytes.length !== bytes.buffer.byteLength) {
		const copy = new Uint8Array(bytes.length);
		copy.set(bytes);
		bytes = copy;
	}
	const dv = new DataView(bytes.buffer);
	const max = bytes.length;
	let eocd = -1;
	const minOff = Math.max(0, max - 0xffff - 22);
	for (let i = max - 22; i >= minOff; i--) {
		if (dv.getUint32(i, true) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error("zip: EOCD not found");
	const cdCount = dv.getUint16(eocd + 10, true);
	const cdOff = dv.getUint32(eocd + 16, true);

	const files = new Map();
	const order = [];
	let off = cdOff;
	const decName = new TextDecoder("utf-8");

	for (let i = 0; i < cdCount; i++) {
		if (dv.getUint32(off, true) !== 0x02014b50)
			throw new Error("zip: bad CD entry at " + off);
		const method = dv.getUint16(off + 10, true);
		const compSize = dv.getUint32(off + 20, true);
		const nameLen = dv.getUint16(off + 28, true);
		const extraLen = dv.getUint16(off + 30, true);
		const commentLen = dv.getUint16(off + 32, true);
		const lfhOff = dv.getUint32(off + 42, true);
		const name = decName.decode(bytes.subarray(off + 46, off + 46 + nameLen));
		off += 46 + nameLen + extraLen + commentLen;

		if (dv.getUint32(lfhOff, true) !== 0x04034b50)
			throw new Error("zip: bad LFH for " + name);
		const lfhNameLen = dv.getUint16(lfhOff + 26, true);
		const lfhExtraLen = dv.getUint16(lfhOff + 28, true);
		const dataOff = lfhOff + 30 + lfhNameLen + lfhExtraLen;
		const compData = bytes.subarray(dataOff, dataOff + compSize);

		let uncomp;
		if (method === 0) {
			uncomp = compData.slice();
		} else if (method === 8) {
			uncomp = await _inflateRaw(compData);
		} else {
			throw new Error("zip: unsupported method " + method + " for " + name);
		}
		files.set(name, uncomp);
		order.push(name);
	}
	return { files, order };
}

async function miniZipBuild(files, order) {
	const enc = new TextEncoder();
	const chunks = [];
	const cds = [];
	let offset = 0;
	const names = order || Array.from(files.keys());

	for (const name of names) {
		const data = files.get(name);
		if (!data) continue;
		const nameBytes = enc.encode(name);
		const crc = _crc32(data);
		const compData = data.length
			? await _deflateRaw(data)
			: new Uint8Array(0);
		const useStore = compData.length >= data.length;
		const finalData = useStore ? data : compData;
		const method = useStore ? 0 : 8;

		const lfh = new Uint8Array(30 + nameBytes.length);
		const ldv = new DataView(lfh.buffer);
		ldv.setUint32(0, 0x04034b50, true);
		ldv.setUint16(4, 20, true);
		ldv.setUint16(6, 0x0800, true);
		ldv.setUint16(8, method, true);
		ldv.setUint16(10, 0, true);
		ldv.setUint16(12, 0x21, true);
		ldv.setUint32(14, crc, true);
		ldv.setUint32(18, finalData.length, true);
		ldv.setUint32(22, data.length, true);
		ldv.setUint16(26, nameBytes.length, true);
		ldv.setUint16(28, 0, true);
		lfh.set(nameBytes, 30);
		chunks.push(lfh, finalData);

		const cd = new Uint8Array(46 + nameBytes.length);
		const cdv = new DataView(cd.buffer);
		cdv.setUint32(0, 0x02014b50, true);
		cdv.setUint16(4, 20, true);
		cdv.setUint16(6, 20, true);
		cdv.setUint16(8, 0x0800, true);
		cdv.setUint16(10, method, true);
		cdv.setUint16(12, 0, true);
		cdv.setUint16(14, 0x21, true);
		cdv.setUint32(16, crc, true);
		cdv.setUint32(20, finalData.length, true);
		cdv.setUint32(24, data.length, true);
		cdv.setUint16(28, nameBytes.length, true);
		cdv.setUint16(30, 0, true);
		cdv.setUint16(32, 0, true);
		cdv.setUint16(34, 0, true);
		cdv.setUint16(36, 0, true);
		cdv.setUint32(38, 0, true);
		cdv.setUint32(42, offset, true);
		cd.set(nameBytes, 46);
		cds.push(cd);

		offset += lfh.length + finalData.length;
	}

	const cdStart = offset;
	let cdSize = 0;
	for (const cd of cds) {
		chunks.push(cd);
		cdSize += cd.length;
	}

	const eocd = new Uint8Array(22);
	const edv = new DataView(eocd.buffer);
	edv.setUint32(0, 0x06054b50, true);
	edv.setUint16(4, 0, true);
	edv.setUint16(6, 0, true);
	edv.setUint16(8, cds.length, true);
	edv.setUint16(10, cds.length, true);
	edv.setUint32(12, cdSize, true);
	edv.setUint32(16, cdStart, true);
	edv.setUint16(20, 0, true);
	chunks.push(eocd);

	let total = 0;
	for (const c of chunks) total += c.length;
	const out = new Uint8Array(total);
	let pos = 0;
	for (const c of chunks) {
		out.set(c, pos);
		pos += c.length;
	}
	return out;
}

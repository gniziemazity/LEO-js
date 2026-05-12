"use strict";

function inlineFilesInHtml(html, filesMap) {
	if (!html || !filesMap || !Object.keys(filesMap).length) return html;
	const _basename = (s) =>
		String(s).trim().replace(/\\/g, "/").split("/").pop().trim();
	let result = html.replace(
		/<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi,
		(match) => {
			const m = match.match(/\bhref\s*=\s*["']([^"']+)["']/i);
			if (!m) return match;
			const content = filesMap[_basename(m[1])];
			return content != null ? `<style>\n${content}\n</style>` : match;
		},
	);
	result = result.replace(
		/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi,
		(match, src) => {
			const content = filesMap[_basename(src)];
			return content != null ? `<script>\n${content}\n</script>` : match;
		},
	);
	result = result.replace(
		/(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
		(match, pre, src, post) => {
			const dataUri = filesMap[_basename(src)];
			return dataUri != null ? `${pre}${dataUri}${post}` : match;
		},
	);
	return result;
}

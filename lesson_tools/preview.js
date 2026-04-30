"use strict";

function inlineFilesInHtml(html, filesMap) {
	if (!html || !filesMap || !Object.keys(filesMap).length) return html;
	let result = html.replace(
		/<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi,
		(match) => {
			const m = match.match(/\bhref\s*=\s*["']([^"']+)["']/i);
			if (!m) return match;
			const basename = m[1].replace(/\\/g, "/").split("/").pop();
			const content = filesMap[basename];
			return content != null ? `<style>\n${content}\n</style>` : match;
		},
	);
	result = result.replace(
		/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi,
		(match, src) => {
			const basename = src.replace(/\\/g, "/").split("/").pop();
			const content = filesMap[basename];
			return content != null ? `<script>\n${content}\n</script>` : match;
		},
	);
	result = result.replace(
		/(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
		(match, pre, src, post) => {
			const basename = src.replace(/\\/g, "/").split("/").pop();
			const dataUri = filesMap[basename];
			return dataUri != null ? `${pre}${dataUri}${post}` : match;
		},
	);
	return result;
}

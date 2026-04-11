"use strict";

/**
 * Inlines linked CSS/JS files and images into an HTML string.
 * @param {string} html - raw HTML content
 * @param {Object<string,string>} filesMap - map of basename → text content (CSS/JS) or data: URI (images)
 * @returns {string} HTML with <link stylesheet>, <script src>, and <img src> replaced by inline equivalents
 */
function inlineFilesInHtml(html, filesMap) {
	if (!html || !filesMap || !Object.keys(filesMap).length) return html;
	let result = html.replace(
		/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi,
		(match) => {
			const m = match.match(/\bhref=["']([^"']+)["']/i);
			if (!m) return match;
			const basename = m[1].replace(/\\/g, "/").split("/").pop();
			const content = filesMap[basename];
			return content != null ? `<style>\n${content}\n</style>` : match;
		},
	);
	result = result.replace(
		/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
		(match, src) => {
			const basename = src.replace(/\\/g, "/").split("/").pop();
			const content = filesMap[basename];
			return content != null ? `<script>\n${content}\n</script>` : match;
		},
	);
	// Replace image src attributes with data URIs when available
	result = result.replace(
		/(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi,
		(match, pre, src, post) => {
			const basename = src.replace(/\\/g, "/").split("/").pop();
			const dataUri = filesMap[basename];
			return dataUri != null ? `${pre}${dataUri}${post}` : match;
		},
	);
	return result;
}

/**
 * Reads image files from a Map<path, File> and returns a basename→dataURI map.
 * @param {Map<string,File>} allFiles - all files in the folder (lowercase paths)
 * @param {string[]} [filterPaths] - optional subset of paths to include (e.g. only teacher or student dir)
 * @returns {Promise<Object<string,string>>}
 */
async function readImageDataUris(allFiles, filterPaths) {
	const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i;
	const result = {};
	const entries = filterPaths
		? filterPaths.map((p) => [p, allFiles.get(p)]).filter(([, f]) => f)
		: [...allFiles.entries()];
	await Promise.all(
		entries.map(([path, file]) => {
			if (!IMAGE_EXT.test(path)) return;
			return new Promise((res) => {
				const reader = new FileReader();
				reader.onload = (e) => {
					const basename = path.replace(/\\/g, "/").split("/").pop();
					result[basename] = e.target.result;
					res();
				};
				reader.onerror = res;
				reader.readAsDataURL(file);
			});
		}),
	);
	return result;
}

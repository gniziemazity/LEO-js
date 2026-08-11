"use strict";

function inlineFilesInHtml(html, filesMap) {
	if (!html || !filesMap || !Object.keys(filesMap).length) return html;
	const _basename = (s) =>
		String(s).trim().replace(/\\/g, "/").split("/").pop().trim();
	const _isAbsolute = (s) =>
		/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith("//");
	let result = html.replace(
		/<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi,
		(match) => {
			const m = match.match(/\bhref\s*=\s*["']([^"']+)["']/i);
			if (!m || _isAbsolute(m[1])) return match;
			const content = filesMap[_basename(m[1])];
			return content != null ? `<style>\n${content}\n</style>` : match;
		},
	);
	const deferredScripts = [];
	result = result.replace(
		/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi,
		(match, src) => {
			if (_isAbsolute(src)) return match;
			const content = filesMap[_basename(src)];
			if (content == null) return match;
			if (/\bdefer\b/i.test(match)) {
				deferredScripts.push(content);
				return "";
			}
			return `<script>\n${content}\n</script>`;
		},
	);
	if (deferredScripts.length) {
		const combined = deferredScripts.join("\n");
		const injected = `<script>\ndocument.addEventListener('DOMContentLoaded', function(){\n${combined}\n});\n</script>`;
		if (/<\/body>/i.test(result)) {
			result = result.replace(/<\/body>/i, `${injected}\n</body>`);
		} else {
			result += injected;
		}
	}
	result = result.replace(
		/(<(?:img|audio|video|source)\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
		(match, pre, src, post) => {
			if (_isAbsolute(src)) return match;
			const url = filesMap[_basename(src)];
			return url != null ? `${pre}${url}${post}` : match;
		},
	);
	return result;
}

function buildPreviewSrcdoc(html, filesMap, mediaUris, baseUrl) {
	let out = String(html || "");
	const inject = [];
	if (baseUrl) inject.push(`<base href="${baseUrl}">`);
	const mediaMap = {};
	for (const [name, url] of Object.entries(mediaUris || {})) {
		if (/^(?:blob|https?):/i.test(url)) mediaMap[name] = url;
	}
	if (Object.keys(mediaMap).length) {
		const json = JSON.stringify(mediaMap).replace(
			/<\/script/gi,
			"<\\/script",
		);
		inject.push(
			"<script>(function(){const __M=" +
				json +
				";function _b(s){return String(s).split(/[/\\\\]/).pop();}" +
				"const _OA=window.Audio;" +
				"window.Audio=function(src){const m=typeof src==='string'?__M[_b(src)]:null;return new _OA(m||src);};" +
				"window.Audio.prototype=_OA.prototype;" +
				"})();</script>",
		);
	}
	if (inject.length) {
		const snippet = inject.join("\n");
		if (/<head\b[^>]*>/i.test(out)) {
			out = out.replace(/(<head\b[^>]*>)/i, `$1\n${snippet}`);
		} else if (/<html\b[^>]*>/i.test(out)) {
			out = out.replace(/(<html\b[^>]*>)/i, `$1\n<head>${snippet}</head>`);
		} else {
			out = `<head>${snippet}</head>${out}`;
		}
	}
	const map = { ...(mediaUris || {}), ...(filesMap || {}) };
	return inlineFilesInHtml(out, map) || out;
}

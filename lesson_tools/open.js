"use strict";
// Opens a lesson_tools HTML file in the default browser with optional URL query params.
// Usage: node lesson_tools/open.js <filename> [param=value ...]
// Example: node lesson_tools/open.js students.html anon=name
const { exec } = require("child_process");
const path = require("path");
const [, , tool = "students.html", ...params] = process.argv;
const absPath = path.resolve(__dirname, tool);
const qs = params.length ? "?" + params.join("&") : "";
const url = "file:///" + absPath.replace(/\\/g, "/") + qs;
exec(`start "" "${url}"`, (err) => {
	if (err) console.error(err.message);
});

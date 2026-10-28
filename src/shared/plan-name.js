const path = require("path");

const PLAN_EXT_RE = /\.(leo|json)$/i;

function planName(file) {
	return path.basename(file).replace(PLAN_EXT_RE, "");
}

module.exports = { PLAN_EXT_RE, planName };

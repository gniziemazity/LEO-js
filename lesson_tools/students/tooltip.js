"use strict";

const _studentsTip = new Tooltip({
	el: document.getElementById("tip"),
	manageWhiteSpace: true,
});

function setupTip(el, text, noWrap = false) {
	_studentsTip.attachText(el, text, { noWrap });
}

function setupTipHtml(el, html) {
	_studentsTip.attachHtml(el, html);
}

function showTipHtml(e, html) {
	_studentsTip.show(e, html, { html: true });
}

function moveTip(e) {
	_studentsTip.move(e);
}

function hideTip() {
	_studentsTip.hide();
}

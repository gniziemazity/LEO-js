"use strict";

const tipEl = document.getElementById("tip");

function setupTip(el, text, noWrap = false) {
	el.addEventListener("mouseenter", (e) => showTip(e, text, noWrap));
	el.addEventListener("mousemove", (e) => moveTip(e));
	el.addEventListener("mouseleave", () => hideTip());
}

function setupTipHtml(el, html) {
	el.addEventListener("mouseenter", (e) => showTipHtml(e, html));
	el.addEventListener("mousemove", (e) => moveTip(e));
	el.addEventListener("mouseleave", () => hideTip());
}

function showTip(e, text, noWrap = false) {
	tipEl.textContent = text;
	tipEl.style.whiteSpace = noWrap ? "pre" : "pre-wrap";
	tipEl.style.display = "block";
	moveTip(e);
}

function showTipHtml(e, html) {
	tipEl.innerHTML = html;
	tipEl.style.whiteSpace = "pre-wrap";
	tipEl.style.display = "block";
	moveTip(e);
}
function moveTip(e) {
	const tw = tipEl.offsetWidth,
		th = tipEl.offsetHeight;
	let tx = e.clientX + 14,
		ty = e.clientY - 8;
	if (tx + tw > window.innerWidth - 8) tx = e.clientX - tw - 14;
	if (ty + th > window.innerHeight - 8) ty = e.clientY - th - 8;
	tipEl.style.left = tx + "px";
	tipEl.style.top = ty + "px";
}

function hideTip() {
	tipEl.style.display = "none";
}

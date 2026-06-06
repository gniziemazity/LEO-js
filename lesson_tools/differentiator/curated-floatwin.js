"use strict";

function _curatedShowFloatWin(title, bodyEl) {
	if (!_curatedFloatWin) {
		const win = document.createElement("div");
		win.className = "curated-float-win float-win";
		win.id = "curated-float-win";

		const header = document.createElement("div");
		header.className = "float-win__header";
		const dragHint = document.createElement("span");
		dragHint.className = "float-win__drag";
		dragHint.textContent = "⠿";
		header.appendChild(dragHint);
		const titleEl = document.createElement("span");
		titleEl.className = "float-win__title";
		header.appendChild(titleEl);
		const closeBtn = document.createElement("button");
		closeBtn.className = "float-win__close";
		closeBtn.textContent = "×";
		closeBtn.addEventListener("click", () => {
			win.style.display = "none";
		});
		header.appendChild(closeBtn);

		const body = document.createElement("div");
		body.className = "float-win__body";

		win.appendChild(header);
		win.appendChild(body);
		document.body.appendChild(win);

		makeDraggable(header, win);

		_curatedFloatWin = { win, titleEl, body };
	}
	_curatedFloatWin.titleEl.textContent = title;
	_curatedFloatWin.body.innerHTML = "";
	_curatedFloatWin.body.appendChild(bodyEl);
	_curatedFloatWin.win.style.display = "flex";
	if (!_curatedFloatWin.win.style.left) {
		_curatedFloatWin.win.style.left = "100px";
		_curatedFloatWin.win.style.top = "100px";
	}
}

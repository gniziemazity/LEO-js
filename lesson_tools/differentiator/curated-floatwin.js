"use strict";

function _curatedShowFloatWin(title, bodyEl) {
	if (!_curatedFloatWin) {
		const fw = _makeFloatWin({
			id: "curated-float-win",
			className: "curated-float-win float-win",
			onClose: () => {
				if (_curatedFloatWin) _curatedFloatWin.win.style.display = "none";
			},
		});
		_curatedFloatWin = { win: fw.win, titleEl: fw.titleEl, body: fw.body };
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

const reader = new Html5Qrcode("camera");

let scannerOn = false;

function toggleScanner() {
	scannerOn = !scannerOn;
	if (scannerOn) {
		startScanner();
		btn.innerText = "CANCEL";
		mapContainer.style.display = "none";
	} else {
		stopScanner();
		btn.innerText = "SCAN";
		mapContainer.style.display = "block";
	}
}

function startScanner() {
	reader.start(
		{ facingMode: "environment" },
		{},
		function (text) {
			const place = JSON.parse(text);
			showMarkerAt(place.top, place.left);
			toggleScanner();
		}
	).catch(function (err) {
		console.error(err);
	});
}

function stopScanner() {
	reader.stop();
}

function showMarkerAt(top, left) {
	marker.style.top = top;
	marker.style.left = left;
}
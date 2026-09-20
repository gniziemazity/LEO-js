const DEFAULT_GRACE_MS = 5000;

function createAutoPilot({
	state,
	broadcastServer,
	graceMs = DEFAULT_GRACE_MS,
}) {
	let graceTimer = null;
	let resumeWithTyping = false;

	function cancelGrace() {
		if (!graceTimer) return;
		clearTimeout(graceTimer);
		graceTimer = null;
	}

	function apply(next) {
		if (next === state.autoPilot) return;
		state.autoPilot = next;
		broadcastServer.updateAutoPilot(next);
		state.send("auto-pilot", next);
	}

	function set(on) {
		resumeWithTyping = false;
		apply(
			on === true &&
				state.isActive === true &&
				broadcastServer.clientCount() > 0,
		);
	}

	function onActiveChanged() {
		if (!state.isActive) {
			if (state.autoPilot) resumeWithTyping = true;
			apply(false);
			return;
		}
		const resume = resumeWithTyping;
		resumeWithTyping = false;
		if (resume) apply(broadcastServer.clientCount() > 0);
	}

	function reportRemotes() {
		state.send("remote-count", broadcastServer.clientCount());
	}

	function onClientConnected() {
		cancelGrace();
		reportRemotes();
	}

	function onClientDisconnected() {
		reportRemotes();
		if (!state.autoPilot || broadcastServer.clientCount() > 0) return;
		cancelGrace();
		graceTimer = setTimeout(() => {
			graceTimer = null;
			if (broadcastServer.clientCount() === 0) set(false);
		}, graceMs);
	}

	function sync() {
		reportRemotes();
		state.send("auto-pilot", state.autoPilot);
	}

	return {
		set,
		onActiveChanged,
		onClientConnected,
		onClientDisconnected,
		sync,
	};
}

module.exports = { createAutoPilot, DEFAULT_GRACE_MS };

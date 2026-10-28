const DEFAULT_GRACE_MS = 5000;

function createAutoPilot({
	state,
	broadcastServer,
	graceMs = DEFAULT_GRACE_MS,
}) {
	let graceTimer = null;
	let resumeWithAutoTyping = false;

	function cancelGrace() {
		if (!graceTimer) return;
		clearTimeout(graceTimer);
		graceTimer = null;
	}

	function apply(next) {
		if (next === state.autoPilot) return;
		state.autoPilot = next;
		broadcastServer.updateAutoPilot(next);
	}

	function set(on) {
		resumeWithAutoTyping = false;
		apply(
			on === true &&
				state.isActive === true &&
				broadcastServer.clientCount() > 0,
		);
	}

	function onActiveChanged() {
		if (!state.isActive) {
			if (state.autoPilot) resumeWithAutoTyping = true;
			apply(false);
			return;
		}
		const resume = resumeWithAutoTyping;
		resumeWithAutoTyping = false;
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

	return {
		set,
		onActiveChanged,
		onClientConnected,
		onClientDisconnected,
		sync: reportRemotes,
	};
}

module.exports = { createAutoPilot };

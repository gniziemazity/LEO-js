let currentStudents = [];

function setInteractionBtnsVisible(visible) {
	document
		.querySelectorAll(".mode-side-btn-question, .mode-side-btn-help")
		.forEach((btn) => (btn.style.display = visible ? "" : "none"));
}

function setStudents(students) {
	currentStudents = students || [];
}

const questionOverlay = new QuestionOverlay();
const interactionOverlay = new InteractionOverlay();
const goToOverlay = new GoToOverlay();
const snippetOverlay = new SnippetOverlay();
const noteOverlay = new NoteOverlay();
const mediaOverlay = new MediaOverlay();

function showQuestionOverlay(question, students, bgColor, options) {
	questionOverlay.show(question, students, bgColor, options);
}

function showQuestionToTeacher(animate) {
	questionOverlay.showToTeacher(animate);
}

function revealQuestionOverlay() {
	questionOverlay.reveal();
}

function closeQuestionOverlayUI() {
	questionOverlay.closeUI();
}

function handleInteractionBtn(interactionType) {
	interactionOverlay.handleBtn(interactionType);
}

function interactionMic() {
	interactionOverlay.toggleDictation();
}

function interactionAsk() {
	interactionOverlay.ask();
}

function showGoToOverlay(payload) {
	goToOverlay.show(payload);
}

function closeGoToOverlayUI() {
	goToOverlay.closeUI();
}

function closeGoToOverlay() {
	goToOverlay.confirm();
}

function showSnippetOverlay(payload) {
	snippetOverlay.show(payload);
}

function closeSnippetOverlayUI() {
	snippetOverlay.closeUI();
}

function closeSnippetOverlay() {
	snippetOverlay.confirm();
}

function snippetPaste() {
	snippetOverlay.paste();
}

function showNoteOverlay(payload) {
	noteOverlay.show(payload);
}

function closeNoteOverlayUI() {
	noteOverlay.closeUI();
}

function closeNoteOverlay() {
	noteOverlay.confirm();
}

function showMediaOverlay(payload) {
	mediaOverlay.show(payload);
}

function closeMediaOverlayUI() {
	mediaOverlay.closeUI();
}

function closeMediaOverlay() {
	mediaOverlay.confirm();
}

function pinMediaWindow() {
	mediaOverlay.pin();
}

function setPinnedWindows(pinned) {
	mediaOverlay.setPinned(pinned);
	const btn = document.getElementById("modeBtnPin");
	if (btn)
		btn.classList.toggle(
			"pin-visible",
			!!(pinned && (pinned.image || pinned.web)),
		);
	syncTouchpadToolbar();
}

function resyncOverlays(state) {
	const host = [
		[questionOverlay, state.activeQuestion],
		[goToOverlay, state.activeGoTo],
		[snippetOverlay, state.activeSnippet],
		[noteOverlay, state.activeNote],
		[mediaOverlay, state.activeMedia],
	];
	for (const [overlay, live] of host) {
		if (!live) overlay.close();
	}
}

function unpinWindows() {
	sendMessage("unpin-windows", {});
}

function goToTypeName() {
	goToOverlay.typeName();
}

function onRandomizerResult(index, name) {
	questionOverlay.showRandomResult(index, name);
	interactionOverlay.showRandomResult(index, name);
}

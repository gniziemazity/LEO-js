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
const moveToOverlay = new MoveToOverlay();
const codeInsertOverlay = new CodeInsertOverlay();
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

function showMoveToOverlay(payload) {
	moveToOverlay.show(payload);
}

function closeMoveToOverlayUI() {
	moveToOverlay.closeUI();
}

function closeMoveToOverlay() {
	moveToOverlay.confirm();
}

function showCodeInsertOverlay(payload) {
	codeInsertOverlay.show(payload);
}

function closeCodeInsertOverlayUI() {
	codeInsertOverlay.closeUI();
}

function closeCodeInsertOverlay() {
	codeInsertOverlay.confirm();
}

function codeInsertPaste() {
	codeInsertOverlay.paste();
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
		[moveToOverlay, state.activeMoveTo],
		[codeInsertOverlay, state.activeCodeInsert],
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

function moveToTypeName() {
	moveToOverlay.typeName();
}

function onRandomizerResult(index, name) {
	questionOverlay.showRandomResult(index, name);
}

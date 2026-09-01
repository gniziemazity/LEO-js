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

function showQuestionOverlay(question, students, bgColor, options) {
	questionOverlay.show(question, students, bgColor, options);
}

function showQuestionToTeacher(animate) {
	questionOverlay.showToTeacher(animate);
}

function closeQuestionOverlayUI() {
	questionOverlay.closeUI();
}

function closeQuestionOverlay() {
	questionOverlay.dismiss();
}

function handleInteractionBtn(interactionType) {
	interactionOverlay.handleBtn(interactionType);
}

function closeInteractionOverlay() {
	interactionOverlay.closeOverlay();
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

function moveToTypeName() {
	moveToOverlay.typeName();
}

function onRandomizerResult(index, name) {
	questionOverlay.showRandomResult(index, name);
}

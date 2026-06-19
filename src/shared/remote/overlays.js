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

function showQuestionOverlay(question, students, bgColor) {
	questionOverlay.show(question, students, bgColor);
}

function showQuestionToTeacher() {
	questionOverlay.showToTeacher();
}

function onStudentAnswered(idx) {
	questionOverlay.studentAnswered(idx);
}

function closeQuestionOverlayUI() {
	questionOverlay.closeUI();
}

function closeQuestionOverlay() {
	questionOverlay.dismiss();
}

function clearAutoCloseTimer() {
	questionOverlay.clearTimer();
}

function handleInteractionBtn(interactionType) {
	interactionOverlay.handleBtn(interactionType);
}

function showInteractionOverlay(title, students, type) {
	interactionOverlay.show(title, students, type);
}

function onStudentSelected(idx, type, questionText) {
	interactionOverlay.studentSelected(idx, type, questionText);
}

function closeInteractionOverlay() {
	interactionOverlay.closeOverlay();
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

const { broadcastServer, hotkeyManager } = require("./context");
const state = require("./state");
const {
	floatState,
	_questionFloat,
	animateQuestionWindowOnScreen,
} = require("./float-windows");

function questionAwaitingShow() {
	return (
		floatState.questionWindowIsLesson &&
		!floatState.questionShown &&
		_questionFloat.isAlive() &&
		state.pauseReasons.has("question")
	);
}

function showQuestion(animate) {
	floatState.questionShown = true;
	hotkeyManager.unregisterConfirmPopup();
	if (animate) animateQuestionWindowOnScreen();
	broadcastServer.broadcastQuestionShown();
	state.send("question-shown");
}

function armQuestionShow() {
	hotkeyManager.registerConfirmPopup(() => {
		if (questionAwaitingShow()) showQuestion(true);
	});
}

function rearmQuestionShow() {
	if (questionAwaitingShow()) armQuestionShow();
}

function endQuestion() {
	state.unpause("question");
	hotkeyManager.unregisterConfirmPopup();
}

module.exports = {
	questionAwaitingShow,
	showQuestion,
	armQuestionShow,
	rearmQuestionShow,
	endQuestion,
};

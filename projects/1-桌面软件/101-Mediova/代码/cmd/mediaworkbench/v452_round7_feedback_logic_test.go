package main

import (
	"testing"

	"mediaworkbench/internal/model"
)

func TestRound7FeedbackHeldTaskRemainsEditable(t *testing.T) {
	if !round7FeedbackTaskEditable(model.StatusHeld) {
		t.Fatal("held task must be editable")
	}
	if !round7FeedbackTaskEditable(model.StatusReady) {
		t.Fatal("ready task must be editable")
	}
	for _, status := range []model.Status{model.StatusQueued, model.StatusProcessing, model.StatusPaused} {
		if round7FeedbackTaskEditable(status) {
			t.Fatalf("%s must remain locked", status)
		}
	}
}

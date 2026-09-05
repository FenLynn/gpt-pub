package main

import "mediaworkbench/internal/model"

func round7FeedbackTaskEditable(status model.Status) bool {
	switch status {
	case model.StatusQueued, model.StatusProcessing, model.StatusPaused:
		return false
	default:
		return true
	}
}

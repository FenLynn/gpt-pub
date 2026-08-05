package main

import (
	"os"
	"strings"
	"testing"
)

func TestRound7FeedbackSourceContracts(t *testing.T) {
	var combined strings.Builder
	for _, name := range []string{
		"v452_round7_feedback_common_windows.go",
		"v452_round7_feedback_columns_windows.go",
		"v452_round7_feedback_scroll_windows.go",
		"v452_round7_feedback_visual_windows.go",
		"v452_round7_feedback_editor_windows.go",
		"v452_round7_feedback_timeline_windows.go",
	} {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		combined.Write(data)
		combined.WriteByte('\n')
	}
	source := combined.String()
	for _, required := range []string{
		"round7FeedbackScrollDelay = 500",
		"round7FeedbackColumnProfiles",
		"ui-column-widths-v452.json",
		"round7FeedbackTaskEditable(task.Status)",
		"task.Status == model.StatusHeld",
		"round7FeedbackDrawFlatLamp",
		"const samples = 8",
		"round7FeedbackDrawFlatToolbarButton",
		"round7FeedbackDrawAllDefault",
		"round7FeedbackPaintTimeline",
		"round7FeedbackCreateCompatibleBmp",
		"case WM_ERASEBKGND:",
		"rangeTop := trackY - scaleDPI(20)",
		"round7FeedbackArmEditorHook()",
		"round7FeedbackUnhookWinEvent.Call(round7FeedbackEditorHook)",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("missing feedback contract %q", required)
		}
	}
	for _, forbidden := range []string{
		"time.NewTicker",
		"for {\n\t\tprocInvalidateRect",
		"radial :=",
		"highlight :=",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("forbidden repeated-refresh or textured-lamp path %q", forbidden)
		}
	}
}

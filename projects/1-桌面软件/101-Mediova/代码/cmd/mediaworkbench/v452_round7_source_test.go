package main

import (
	"os"
	"strings"
	"testing"
)

func round7ReadSource(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile(name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return string(data)
}

func TestRound7MainHasNoCompetingWindowHook(t *testing.T) {
	legacy := round7ReadSource(t, "v452_round7_main_windows.go")
	for _, forbidden := range []string{"func init()", "SetWinEventHook", "case WM_SIZE:", "round7LayoutFooter"} {
		if strings.Contains(legacy, forbidden) {
			t.Fatalf("legacy round7 main still owns window state: %q", forbidden)
		}
	}
	common := round7ReadSource(t, "v452_round7_feedback_common_windows.go")
	for _, required := range []string{
		"round7FeedbackMainInstalled.Load()",
		"round7FeedbackUnhookWinEvent.Call(round7FeedbackMainHook)",
		"round7FeedbackWMFinalizeSwitch",
		"round7FeedbackLayoutFooter(a)",
		"BeginDeferWindowPos",
	} {
		if !strings.Contains(common, required) {
			t.Fatalf("missing unified main-window contract: %q", required)
		}
	}
}

func TestRound7VisualsUseSingleSupersampledPath(t *testing.T) {
	legacy := round7ReadSource(t, "v452_round7_main_windows.go")
	visual := round7ReadSource(t, "v452_round7_feedback_visual_windows.go")
	if strings.Count(legacy, "round7FeedbackDrawFlatLamp") != 1 {
		t.Fatal("legacy lamp compatibility must delegate exactly once")
	}
	for _, required := range []string{
		"const samples = 8",
		"round7FeedbackDrawFooterButton",
		"round7FeedbackDrawOverallProgress",
		"fraction > 0",
		"cx + scaleDPI(6)",
	} {
		if !strings.Contains(visual, required) {
			t.Fatalf("missing unified visual contract: %q", required)
		}
	}
	if strings.Contains(visual, "minimum := int32(4)") {
		t.Fatal("overall progress must not draw a fake zero-percent start tick")
	}
}

func TestRound7EditorUsesTrimNameAndSeparatedMarkers(t *testing.T) {
	editor := round7ReadSource(t, "v452_round7_feedback_editor_windows.go")
	timeline := round7ReadSource(t, "v452_round7_feedback_timeline_windows.go")
	for _, required := range []string{
		"剪裁",
		"setText(decor.timeTitle, \"剪辑\")",
		"setText(e.hStartLabel, \"起始时间\")",
		"setText(e.hEndLabel, \"结束时间\")",
		"setText(e.hSourceRange",
		"round7FeedbackPaintCanvas",
		"GenerateProcessedFrame",
	} {
		if !strings.Contains(editor, required) {
			t.Fatalf("missing editor convergence contract: %q", required)
		}
	}
	for _, required := range []string{
		"formatSecondsClock(0)",
		"formatSecondsClock(e.dialog.task.Duration)",
		"startFlag",
		"endFlag",
		"currentFlag",
		"当前  " + "\"+formatSecondsClock",
	} {
		if !strings.Contains(timeline, required) {
			t.Fatalf("missing separated timeline marker contract: %q", required)
		}
	}
	for _, forbidden := range []string{"源起点\", rect", "源终点\", rect", "round7FeedbackCanvasSubclassProc"} {
		if strings.Contains(timeline, forbidden) {
			t.Fatalf("old overlapping timeline/canvas path remains: %q", forbidden)
		}
	}
}

func TestRound7CurrentPreviewIsReleasedNotMouseMoveGenerated(t *testing.T) {
	source := round7ReadSource(t, "v452_round7_editor_windows.go")
	moveStart := strings.Index(source, "case WM_MOUSEMOVE:")
	moveEnd := strings.Index(source[moveStart:], "case WM_LBUTTONUP:")
	if moveStart < 0 || moveEnd < 0 {
		t.Fatal("timeline mouse handlers missing")
	}
	moveBlock := source[moveStart : moveStart+moveEnd]
	if strings.Contains(moveBlock, "generatePreviewFrame") {
		t.Fatal("preview generation during timeline WM_MOUSEMOVE would cause flashing")
	}
	upStart := strings.Index(source, "case WM_LBUTTONUP:")
	upEnd := strings.Index(source[upStart:], "result, _, _ := procDefWindowProcW")
	if upStart < 0 || upEnd < 0 {
		t.Fatal("timeline mouse-up block missing")
	}
	upBlock := source[upStart : upStart+upEnd]
	if !strings.Contains(upBlock, "if drag == round7DragCurrent") || !strings.Contains(upBlock, "generatePreviewFrame") {
		t.Fatal("current preview must be generated once after current cursor release")
	}
}

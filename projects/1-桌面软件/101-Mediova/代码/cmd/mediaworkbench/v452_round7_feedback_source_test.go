package main

import (
	"os"
	"strings"
	"testing"
)

func TestRound7FeedbackSourceContracts(t *testing.T) {
	files := map[string]string{}
	var combined strings.Builder
	for _, name := range []string{
		"v452_round7_feedback_common_windows.go",
		"v452_round7_feedback_columns_windows.go",
		"v452_round7_feedback_scroll_windows.go",
		"v452_round7_feedback_visual_windows.go",
		"v452_round7_feedback_editor_windows.go",
		"v452_round7_feedback_timeline_windows.go",
		"v452_round7_list_overlay_windows.go",
		"v452_round7_editor_layout_windows.go",
	} {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		files[name] = string(data)
		combined.Write(data)
		combined.WriteByte('\n')
	}
	source := combined.String()
	for _, required := range []string{
		"round7FeedbackScrollDelay = 500",
		"GetScrollInfo",
		"round7FeedbackDrawOverlayScrollbars",
		"round7FeedbackColumnProfiles",
		"ui-column-widths-v452.json",
		"round7FeedbackApplyingColumns",
		"round7FeedbackTaskEditable(task.Status)",
		"task.Status == model.StatusHeld",
		"round7FeedbackDrawFlatLamp",
		"const samples = 8",
		"round7FeedbackDrawFlatToolbarButton",
		"round7FeedbackDrawAllDefault",
		"round7FeedbackDrawFooterButton",
		"round7FeedbackDrawOverallProgress",
		"round7FeedbackPaintTimeline",
		"round7FeedbackPaintCanvas",
		"round7FeedbackCreateCompatibleBmp",
		"case WM_ERASEBKGND:",
		"round7FeedbackArmEditorHook()",
		"round7FeedbackUnhookWinEvent.Call(round7FeedbackEditorHook)",
		"round7FeedbackWMFinalizeSwitch",
		"GetComboBoxInfo",
		"HideCaret",
		"BeginDeferWindowPos",
		"剪裁",
		"GenerateProcessedFrame",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("missing feedback convergence contract %q", required)
		}
	}
	for _, forbidden := range []string{
		"ShowScrollBar",
		"a.settings.TaskColumnWidths =",
		"time.NewTicker",
		"for {\n\t\tprocInvalidateRect",
		"radial :=",
		"highlight :=",
		"round7ListEventHook",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("forbidden duplicate-control or repeated-refresh path %q", forbidden)
		}
	}
	if strings.Contains(files["v452_round7_editor_layout_windows.go"], "SetWinEventHook") {
		t.Fatal("editor layout compatibility file must not install another event hook")
	}
	if strings.Contains(files["v452_round7_list_overlay_windows.go"], "SetWindowSubclass") {
		t.Fatal("list overlay must be paint-only and use the unified list subclass")
	}
}

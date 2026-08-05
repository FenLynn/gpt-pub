package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func round9ReadSource(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(".", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestV452Round11ScrollContract(t *testing.T) {
	logic := round9ReadSource(t, "v452_round9_logic.go")
	for _, required := range []string{
		"round9OverlayHidden", "round9OverlayPending", "round9OverlayVisible", "round9OverlayDragging",
		"func (m *round9OverlayMachine) Move", "func (m *round9OverlayMachine) ShowTimeout",
	} {
		if !strings.Contains(logic, required) {
			t.Fatalf("scroll state-machine contract missing %q", required)
		}
	}
	scroll := round9ReadSource(t, "v452_round7_feedback_scroll_windows.go")
	for _, required := range []string{
		"MWRound9ScrollCover", "round9ScrollWndProc", "round7FeedbackScrollDelay",
		"round9FeedbackHideDelay", "round9OverlayCursorInside", "round9SetScrollFromOverlay",
	} {
		if !strings.Contains(scroll, required) {
			t.Fatalf("scroll surface contract missing %q", required)
		}
	}
	for _, forbidden := range []string{"ShowScrollBar", "round7FeedbackDrawOverlayScrollbars", "procInvalidateRect.Call(app.hList, 0, 0)"} {
		if strings.Contains(scroll, forbidden) {
			t.Fatalf("scroll contract contains unstable list repaint path %q", forbidden)
		}
	}
	closeout := round9ReadSource(t, "v452_round11_flicker_closeout_windows.go")
	for _, required := range []string{
		"round11PositionOverlayStable", "previous == geometry && overlay.visible",
		"round11EnsureStableScrollGeometry", "round11ListSubclassProc",
		"v452RemoveSubclass.Call(a.hList, round7FeedbackListSubclassCB",
	} {
		if !strings.Contains(closeout, required) {
			t.Fatalf("round11 stable scroll contract missing %q", required)
		}
	}
	paintCase := closeout[strings.Index(closeout, "case WM_PAINT:"):]
	if end := strings.Index(paintCase, "case round7FeedbackWMPrint"); end >= 0 {
		paintCase = paintCase[:end]
	}
	if strings.Contains(paintCase, "round11EnsureStableScrollGeometry") || strings.Contains(paintCase, "round9EnsureScrollOverlays") {
		t.Fatal("list WM_PAINT still drives scroll-cover geometry")
	}
	cover := round9ReadSource(t, "v452_round10_scroll_cover_windows.go")
	if strings.Contains(cover, "WM_PAINT") || strings.Contains(cover, "MoveWindow") || strings.Contains(cover, "InvalidateRect") {
		t.Fatal("round10 compatibility layer still owns repaint or geometry")
	}
	guard := round9ReadSource(t, "v452_round8_list_style_guard_windows.go")
	if strings.Contains(guard, "SetWinEventHook") || strings.Contains(guard, "EventObjectCreate") {
		t.Fatal("list style guard still depends on asynchronous WinEvent installation")
	}
}

func TestV452Round9PreviewAndOutputContract(t *testing.T) {
	preview := round9ReadSource(t, "v452_round7_list_overlay_windows.go")
	for _, required := range []string{"ThumbnailIndex", "视频", "图片", "preview"} {
		if !strings.Contains(preview, required) {
			t.Fatalf("preview contract missing %q", required)
		}
	}
	life := round9ReadSource(t, "v452_round9_thumbnail_lifecycle_windows.go")
	for _, required := range []string{"round9EnsureVisibleThumbnails", "Attempts >= 3", "a.queueThumbnail"} {
		if !strings.Contains(life, required) {
			t.Fatalf("thumbnail lifecycle missing %q", required)
		}
	}
	output := round9ReadSource(t, "v452_round9_output_display_windows.go")
	for _, required := range []string{"round9EMSetReadOnly", "round9PaintOutputDisplay", "round9WMSetFocus"} {
		if !strings.Contains(output, required) {
			t.Fatalf("output display contract missing %q", required)
		}
	}
	if strings.Contains(output, "EM_SETSEL") || strings.Contains(output, "round7FeedbackEMSetSel") {
		t.Fatal("output display regressed to post-hoc selection clearing")
	}
}

func TestV452Round11EditorContract(t *testing.T) {
	installer := round9ReadSource(t, "v452_round8_editor_install_windows.go")
	for _, required := range []string{"round11InstallEditor(e)", "not installed", "single-owner chain"} {
		if !strings.Contains(installer, required) {
			t.Fatalf("round11 editor installer missing %q", required)
		}
	}
	for _, forbidden := range []string{"round7FeedbackApplyEditorLayout(e)", "round9InstallEditorCloseout(e)"} {
		if strings.Contains(installer, forbidden) {
			t.Fatalf("editor installer still enables competing layout %q", forbidden)
		}
	}
	closeout := round9ReadSource(t, "v452_round11_flicker_closeout_windows.go")
	for _, required := range []string{
		"round11ApplyEditorLayout", "state.clientWidth == width && state.clientHeight == height",
		"round11SetTextIfChanged", "round11ApplyMoves", "标题：", "round11CanvasPaintSubclassProc",
		"v452RemoveSubclass.Call(e.hwnd, round7FeedbackEditorSubclassCB",
	} {
		if !strings.Contains(closeout, required) {
			t.Fatalf("round11 editor contract missing %q", required)
		}
	}
	if strings.Contains(closeout, "procMoveWindow.Call(e.hwnd") {
		t.Fatal("editor layout still resizes its own window from WM_SIZE")
	}
	info := round9ReadSource(t, "v452_round9_info_guard_windows.go")
	for _, required := range []string{"round9InfoSubclassProc", "预览帧", "round9SetPreviewStatus"} {
		if !strings.Contains(info, required) {
			t.Fatalf("editor info guard missing %q", required)
		}
	}
	timeline := round9ReadSource(t, "v452_round9_timeline_windows.go")
	for _, required := range []string{"barBottom = barTop + scaleDPI(12)", "startBlue", "endBlue", "arrowBaseY", "formatSecondsClock(e.dialog.currentAt)", "nearCurrent && (nearStart || nearEnd)", "tolerance := scaleDPI(12)"} {
		if !strings.Contains(timeline, required) {
			t.Fatalf("timeline contract missing %q", required)
		}
	}
	if strings.Contains(timeline, "剪辑起点") || strings.Contains(timeline, "剪辑终点") || strings.Contains(timeline, "当前 ") {
		t.Fatal("timeline contains forbidden permanent marker labels")
	}
	crop := round9ReadSource(t, "v452_round9_crop_interaction_windows.go")
	for _, required := range []string{"round9CropResizeNW", "round9CropResizeSE", "round9CropMove", "round9CropCreate", "round9CropHitTest"} {
		if !strings.Contains(crop, required) {
			t.Fatalf("crop interaction contract missing %q", required)
		}
	}
	if strings.Contains(crop, "Width: 2, Height: 2") {
		t.Fatal("crop interaction still unconditionally resets to a 2x2 rectangle")
	}
}

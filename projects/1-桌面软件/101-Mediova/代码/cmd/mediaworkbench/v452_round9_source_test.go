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

func TestV452Round9ScrollContract(t *testing.T) {
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
		"MWRound9ScrollCover", "round9EnsureScrollOverlays", "round9ScrollWndProc",
		"round7FeedbackScrollDelay", "round9FeedbackHideDelay", "round9OverlayCursorInside",
		"round9SetScrollFromOverlay", "round9PaintScrollOverlay",
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
	guard := round9ReadSource(t, "v452_round8_list_style_guard_windows.go")
	if strings.Contains(guard, "SetWinEventHook") || strings.Contains(guard, "EventObjectCreate") {
		t.Fatal("list style guard still depends on asynchronous WinEvent installation")
	}
	if strings.Count(guard, "round7FeedbackSWPFrameChanged") != 1 {
		t.Fatalf("list style guard frame-change count=%d want=1", strings.Count(guard, "round7FeedbackSWPFrameChanged"))
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

func TestV452Round9EditorContract(t *testing.T) {
	layout := round9ReadSource(t, "v452_round9_editor_layout_windows.go")
	for _, required := range []string{
		"procShowWindow.Call(e.hInstruction, 0)",
		"procShowWindow.Call(e.hSourceRange, 0)",
		"procShowWindow.Call(e.hApplySelected, 0)",
		"标题：", "剪裁预览", "恢复全画面", "setText(e.hApplyCurrent, \"应用\")",
		"round9EnsureInfoGuard", "round9LayoutPreviewStatus",
	} {
		if !strings.Contains(layout, required) {
			t.Fatalf("editor layout contract missing %q", required)
		}
	}
	info := round9ReadSource(t, "v452_round9_info_guard_windows.go")
	for _, required := range []string{"round9InfoSubclassProc", "预览帧", "round9SetPreviewStatus"} {
		if !strings.Contains(info, required) {
			t.Fatalf("editor info guard missing %q", required)
		}
	}
	timeline := round9ReadSource(t, "v452_round9_timeline_windows.go")
	for _, required := range []string{"barBottom = barTop + scaleDPI(12)", "startBlue", "endBlue", "arrowBaseY", "formatSecondsClock(e.dialog.currentAt)", "barBottom+scaleDPI(2)", "tolerance := scaleDPI(12)"} {
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

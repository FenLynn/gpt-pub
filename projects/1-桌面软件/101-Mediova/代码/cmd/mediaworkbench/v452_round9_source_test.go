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

func TestV452NativeListScrollContract(t *testing.T) {
	install := round9ReadSource(t, "v452_round11_install_order_windows.go")
	for _, required := range []string{
		"round12InstallNativeListScroll",
		"round7FeedbackWSHScroll|round7FeedbackWSVScroll",
		"LVS_EX_DOUBLEBUFFER",
		"round12InstallFinalUIOwners",
	} {
		if !strings.Contains(install, required) {
			t.Fatalf("native ListView scroll contract missing %q", required)
		}
	}

	common := round9ReadSource(t, "v452_round7_feedback_common_windows.go")
	combined := install + common + round9ReadSource(t, "v452_round11_flicker_closeout_windows.go")
	for _, retired := range []string{
		"MWRound9ScrollCover",
		"MWRound11StableScrollSurface",
		"MWRound12ThumbVisual",
		"MWRound12FrozenNumber",
		"round9OverlayMachine",
		"round7FeedbackListSubclassProc",
		"round8EnsureListStyleGuard",
		"round12InlineListSubclassProc",
	} {
		if strings.Contains(combined, retired) {
			t.Fatalf("retired custom scroll owner remains: %q", retired)
		}
	}
}

func TestV452Round9PreviewAndOutputContract(t *testing.T) {
	preview := round9ReadSource(t, "v452_round12_selection_owner_windows.go") + round9ReadSource(t, "v452_round12_list_draw_windows.go") + round9ReadSource(t, "v452_round12_preview_windows.go")
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
	installer := round9ReadSource(t, "v452_round11_install_order_windows.go")
	headerOwner := round9ReadSource(t, "v452_round12_header_owner_windows.go")
	if !strings.Contains(installer, "round9EnsureVisibleThumbnails") || !strings.Contains(headerOwner, "round9EnsureVisibleThumbnails") {
		t.Fatal("visible thumbnail recovery is not wired into startup and native ListView observation")
	}
	for _, required := range []string{"round12WMThumbnailScan", "procPostMessageW.Call", "round12ThumbnailScanPosted.CompareAndSwap"} {
		if !strings.Contains(headerOwner, required) {
			t.Fatalf("thumbnail observer must defer and coalesce work outside native ListView messages; missing %q", required)
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
	if !strings.Contains(installer, "round9EnsureOutputDisplay") {
		t.Fatal("output display is not installed by the deterministic final owner chain")
	}
}

func TestV452Round11EditorContract(t *testing.T) {
	installer := round9ReadSource(t, "v452_round8_editor_install_windows.go")
	for _, required := range []string{"round11InstallEditor(e)", "not installed", "two-layout WM_SIZE loop"} {
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

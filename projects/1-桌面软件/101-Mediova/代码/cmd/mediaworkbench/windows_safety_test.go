//go:build windows

package main

import (
	"testing"
	"unsafe"

	"mediaworkbench/internal/model"
)

func TestLayoutSafeBeforeControls(t *testing.T) {
	a := &application{}
	// WM_SIZE can arrive before WM_CREATE has finished. This must always be a no-op.
	a.layout(1650, 900)
	a.controlsReady = true
	a.layout(1650, 900)
}

func TestFileDialogFilterKeepsDoubleNUL(t *testing.T) {
	filter := "媒体文件\x00*.mp4;*.jpg\x00所有文件\x00*.*\x00\x00"
	buf := utf16Multi(filter)
	if len(buf) < 2 || buf[len(buf)-1] != 0 || buf[len(buf)-2] != 0 {
		t.Fatalf("filter must end in double NUL: %#v", buf)
	}
}

func TestSplitUTF16Multi(t *testing.T) {
	buf := utf16Multi("C:\\media\x00a.mp4\x00b.jpg\x00\x00")
	parts := splitUTF16Multi(buf)
	if len(parts) != 3 || parts[0] != `C:\media` || parts[1] != "a.mp4" || parts[2] != "b.jpg" {
		t.Fatalf("unexpected parts: %#v", parts)
	}
}

func TestSyntheticDropHandleRoundTrip(t *testing.T) {
	paths := []string{`C:\媒体\测试视频.mp4`, `D:\图片\样张.jpg`}
	hdrop := makeSelfTestDropHandle(paths)
	if hdrop == 0 {
		t.Fatal("failed to allocate synthetic HDROP")
	}
	got, err := queryDroppedFiles(hdrop)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(paths) || got[0] != paths[0] || got[1] != paths[1] {
		t.Fatalf("unexpected dropped paths: %#v", got)
	}
}

func TestOutputResolutionTextMatchesActualPixels(t *testing.T) {
	a := &application{settings: model.DefaultSettings()}
	task := &model.Task{Kind: model.KindVideo, Width: 1920, Height: 960}
	opts := model.TaskOptions{Resolution: "1080P", Rotation: "自动"}
	if got := a.outputResolutionText(task, opts); got != "1920×960" {
		t.Fatalf("output resolution = %q, want 1920×960", got)
	}
	task.Width, task.Height, task.Rotation = 3840, 2160, 90
	if got := a.outputResolutionText(task, opts); got != "1080×1920" {
		t.Fatalf("rotated output resolution = %q, want 1080×1920", got)
	}
}

func TestProbeInfoCanBeReused(t *testing.T) {
	task := &model.Task{Width: 1920, Height: 1080, Duration: 12.5, FPS: 30, VideoCodec: "h264", AudioStreams: 1}
	info, ok := probeInfoFromTask(task)
	if !ok || info.Width != 1920 || info.Height != 1080 || !info.HasAudio {
		t.Fatalf("unexpected reusable probe info: ok=%v info=%+v", ok, info)
	}
	if _, ok := probeInfoFromTask(&model.Task{Width: 1920, Height: 1080}); ok {
		t.Fatal("incomplete metadata must not be reused")
	}
}

func TestTaskCellMetrics(t *testing.T) {
	task := &model.Task{InputSize: 1000, OutputSize: 250, Progress: 60.6}
	fraction, label, active := compressionCellMetrics(task)
	if !active || fraction != 0.25 || label != "250 B (25.0%)" {
		t.Fatalf("compression metrics = %v %q active=%v", fraction, label, active)
	}
	progress, progressLabel := progressCellMetrics(task)
	if progress < 0.605 || progress > 0.607 || progressLabel != "60.6%" {
		t.Fatalf("progress metrics = %v %q", progress, progressLabel)
	}
}

func TestListViewCustomDrawLayout(t *testing.T) {
	var cd nmListViewCustomDraw
	if got := unsafe.Offsetof(cd.ISubItem); got != 88 {
		t.Fatalf("NMLVCUSTOMDRAW iSubItem offset = %d, want 88", got)
	}
}

func TestTaskPathList(t *testing.T) {
	tasks := []*model.Task{
		{Input: `C:\src\a.mp4`, OutputPath: `D:\out\a.mp4`},
		{Input: `C:\src\b.mp4`},
		{Input: `C:\src\a.mp4`, OutputPath: `D:\out\a.mp4`},
	}
	got := taskPathList(tasks, []int{0, 1, 2}, false)
	if len(got) != 2 || got[0] != `C:\src\a.mp4` || got[1] != `C:\src\b.mp4` {
		t.Fatalf("source paths = %#v", got)
	}
	out := taskPathList(tasks, []int{0, 1, 2}, true)
	if len(out) != 1 || out[0] != `D:\out\a.mp4` {
		t.Fatalf("output paths = %#v", out)
	}
}

func TestCopyTrimCropToTargetsPreservesOtherOptions(t *testing.T) {
	settings := model.DefaultSettings()
	source := &model.Task{
		Kind:     model.KindVideo,
		Width:    1000,
		Height:   500,
		Duration: 20,
		Options: model.TaskOptions{
			FollowDefaults: false,
			Resolution:     "720P",
			Codec:          "H.264",
			Quality:        "低",
			Rotation:       "自动",
			TrimStart:      2,
			TrimEnd:        10,
			Crop:           model.Crop{Enabled: true, X: 100, Y: 50, Width: 400, Height: 200},
		},
	}
	target := &model.Task{
		Kind:       model.KindVideo,
		Width:      2000,
		Height:     1000,
		Duration:   8,
		Status:     model.StatusDone,
		OutputPath: `D:\out\done.mp4`,
		OutputSize: 123,
		Options: model.TaskOptions{
			FollowDefaults: false,
			Resolution:     "4K",
			Codec:          "H.265",
			Quality:        "高",
			Rotation:       "自动",
		},
	}
	if got := copyTrimCropToTargets(settings, []*model.Task{source, target}, []int{0, 1}); got != 1 {
		t.Fatalf("copied = %d, want 1", got)
	}
	if target.Options.Resolution != "4K" || target.Options.Codec != "H.265" || target.Options.Quality != "高" || target.Options.Rotation != "自动" {
		t.Fatalf("unrelated options changed: %+v", target.Options)
	}
	if target.Options.TrimStart != 2 || target.Options.TrimEnd != 8 {
		t.Fatalf("trim = %.1f..%.1f, want 2..8", target.Options.TrimStart, target.Options.TrimEnd)
	}
	wantCrop := (model.Crop{Enabled: true, X: 200, Y: 100, Width: 800, Height: 400})
	if target.Options.Crop != wantCrop {
		t.Fatalf("crop = %+v, want %+v", target.Options.Crop, wantCrop)
	}
	if target.Status != model.StatusReady || target.OutputPath != "" || target.OutputSize != 0 {
		t.Fatalf("completed target was not reset: %+v", target)
	}
}

func TestCopyTrimCropToImageClearsTrimAndScalesCrop(t *testing.T) {
	settings := model.DefaultSettings()
	source := &model.Task{
		Kind:   model.KindImage,
		Width:  100,
		Height: 200,
		Options: model.TaskOptions{
			FollowDefaults: false,
			ImageFormat:    "JPG",
			ImageSize:      "保持原尺寸",
			Rotation:       "自动",
			TrimStart:      1,
			TrimEnd:        2,
			Crop:           model.Crop{Enabled: true, X: 10, Y: 20, Width: 50, Height: 100},
		},
	}
	target := &model.Task{
		Kind:   model.KindImage,
		Width:  200,
		Height: 400,
		Options: model.TaskOptions{
			FollowDefaults: false,
			ImageFormat:    "PNG",
			ImageSize:      "最大边 1920px",
			Quality:        "中",
			Rotation:       "自动",
		},
	}
	if got := copyTrimCropToTargets(settings, []*model.Task{source, target}, []int{0, 1}); got != 1 {
		t.Fatalf("copied = %d, want 1", got)
	}
	if target.Options.ImageFormat != "PNG" || target.Options.ImageSize != "最大边 1920px" || target.Options.Quality != "中" {
		t.Fatalf("image output options changed: %+v", target.Options)
	}
	if target.Options.TrimStart != 0 || target.Options.TrimEnd != 0 {
		t.Fatalf("image trim should be cleared: %.1f..%.1f", target.Options.TrimStart, target.Options.TrimEnd)
	}
	wantCrop := (model.Crop{Enabled: true, X: 20, Y: 40, Width: 100, Height: 200})
	if target.Options.Crop != wantCrop {
		t.Fatalf("crop = %+v, want %+v", target.Options.Crop, wantCrop)
	}
}

func TestCopyTrimCropSkipsActiveTargets(t *testing.T) {
	settings := model.DefaultSettings()
	source := &model.Task{Kind: model.KindVideo, Width: 100, Height: 100, Duration: 10, Options: model.TaskOptions{FollowDefaults: false, TrimStart: 1, TrimEnd: 5}}
	target := &model.Task{Kind: model.KindVideo, Width: 100, Height: 100, Duration: 10, Status: model.StatusProcessing, Options: model.TaskOptions{FollowDefaults: true}}
	if got := copyTrimCropToTargets(settings, []*model.Task{source, target}, []int{0, 1}); got != 0 {
		t.Fatalf("copied active target = %d, want 0", got)
	}
	if !target.Options.FollowDefaults {
		t.Fatal("active target options changed")
	}
}

func TestShortcutActionMapping(t *testing.T) {
	if got := shortcutAction('F', true, false, false, false); got != -1 {
		t.Fatalf("Ctrl+F=%d", got)
	}
	if got := shortcutAction('O', true, false, false, false); got != ID_FILE_ADD {
		t.Fatalf("Ctrl+O=%d", got)
	}
	if got := shortcutAction('O', true, true, false, false); got != ID_FILE_FOLDER {
		t.Fatalf("Ctrl+Shift+O=%d", got)
	}
	if got := shortcutAction('A', true, false, true, false); got != ID_EDIT_SELECT_ALL {
		t.Fatalf("Ctrl+A list=%d", got)
	}
	if got := shortcutAction('A', true, false, false, true); got != 0 {
		t.Fatalf("Ctrl+A search must pass through, got %d", got)
	}
	if got := shortcutAction(VK_DELETE, false, false, true, false); got != ID_FILE_REMOVE {
		t.Fatalf("Delete=%d", got)
	}
	if got := shortcutAction(VK_ESCAPE, false, false, false, false); got != -2 {
		t.Fatalf("Escape=%d", got)
	}
}

func TestPrepareTaskForRetrySafety(t *testing.T) {
	running := &model.Task{Status: model.StatusProcessing, Progress: 42}
	if prepareTaskForRetry(running) {
		t.Fatal("processing task must not be reset")
	}
	if running.Progress != 42 {
		t.Fatal("processing task was modified")
	}
	failed := &model.Task{Status: model.StatusFailed, Progress: 80, Error: "x", OutputPath: "bad.mp4", OutputSize: 10}
	if !prepareTaskForRetry(failed) {
		t.Fatal("failed task should be reset")
	}
	if failed.Status != model.StatusReady || failed.Progress != 0 || failed.Error != "" || failed.OutputPath != "" || failed.OutputSize != 0 {
		t.Fatalf("unexpected retry state: %+v", failed)
	}
	if !recoverableTaskStatus(model.StatusFailed) || !recoverableTaskStatus(model.StatusSkipped) || !recoverableTaskStatus(model.StatusCancelled) {
		t.Fatal("recoverable statuses missing")
	}
	if recoverableTaskStatus(model.StatusDone) {
		t.Fatal("done task must not be batch-recovered")
	}
}

func TestCompareTaskColumn(t *testing.T) {
	a := &model.Task{Input: `C:\x\b.mp4`, InputSize: 20, OutputSize: 4, Progress: 80, Status: model.StatusDone, Width: 1920, Height: 1080}
	b := &model.Task{Input: `C:\x\a.mp4`, InputSize: 10, OutputSize: 8, Progress: 10, Status: model.StatusFailed, Width: 1280, Height: 720}
	if compareTaskColumn(a, b, 0) <= 0 {
		t.Fatal("filename sort failed")
	}
	if compareTaskColumn(a, b, 6) <= 0 {
		t.Fatal("input-size sort failed")
	}
	if compareTaskColumn(a, b, 8) <= 0 {
		t.Fatal("progress sort failed")
	}
	if compareTaskColumn(a, b, 9) <= 0 {
		t.Fatal("status rank sort failed")
	}
	if taskSortLabel(7) != "输出体积" {
		t.Fatal("sort label mismatch")
	}
}

func TestSelectionRowsPreserveIDsAfterSort(t *testing.T) {
	tasks := []model.Task{{ID: 30}, {ID: 10}, {ID: 20}}
	rows := selectionRows(tasks, map[int64]bool{10: true, 20: true, 99: true})
	if len(rows) != 2 || rows[0] != 1 || rows[1] != 2 {
		t.Fatalf("unexpected restored rows: %#v", rows)
	}
	if rows := selectionRows(tasks, nil); len(rows) != 0 {
		t.Fatalf("nil selection should restore nothing: %#v", rows)
	}
}

func TestNormalizedTaskColumnWidths(t *testing.T) {
	got := normalizedTaskColumnWidths([]int{400, 10, 901, 160})
	want := []int{400, 105, 74, 160, 60, 94, 96, 140, 105, 124}
	if len(got) != len(want) {
		t.Fatalf("column widths len=%d want=%d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("column width[%d]=%d want=%d", i, got[i], want[i])
		}
	}
}

func TestWorkspaceFocusKind(t *testing.T) {
	if got := workspaceFocusKind(2, 0, model.KindImage); got != model.KindVideo {
		t.Fatalf("video focus=%s", got)
	}
	if got := workspaceFocusKind(0, 3, model.KindVideo); got != model.KindImage {
		t.Fatalf("image focus=%s", got)
	}
	if got := workspaceFocusKind(1, 1, model.KindImage); got != model.KindImage {
		t.Fatalf("mixed focus=%s", got)
	}
}

func TestReorderTaskBlockPreservesRelativeOrderAndOtherWorkspace(t *testing.T) {
	v1 := &model.Task{ID: 1, Kind: model.KindVideo}
	i1 := &model.Task{ID: 2, Kind: model.KindImage}
	v2 := &model.Task{ID: 3, Kind: model.KindVideo}
	v3 := &model.Task{ID: 4, Kind: model.KindVideo}
	v4 := &model.Task{ID: 5, Kind: model.KindVideo}
	base := []*model.Task{v1, i1, v2, v3, v4}
	got := reorderTaskBlock(base, map[int64]bool{3: true, 5: true}, model.KindVideo, true)
	want := []int64{3, 2, 5, 1, 4}
	for i, id := range want {
		if got[i].ID != id {
			t.Fatalf("front[%d]=%d want=%d", i, got[i].ID, id)
		}
	}
	got = reorderTaskBlock(base, map[int64]bool{1: true, 4: true}, model.KindVideo, false)
	want = []int64{3, 2, 5, 1, 4}
	for i, id := range want {
		if got[i].ID != id {
			t.Fatalf("bottom[%d]=%d want=%d", i, got[i].ID, id)
		}
	}
}

func TestCleanupTaskListCurrentWorkspaceOnly(t *testing.T) {
	tasks := []*model.Task{
		{ID: 1, Kind: model.KindVideo, Status: model.StatusDone},
		{ID: 2, Kind: model.KindVideo, Status: model.StatusFailed},
		{ID: 3, Kind: model.KindVideo, Status: model.StatusProcessing},
		{ID: 4, Kind: model.KindImage, Status: model.StatusDone},
	}
	kept, removed := cleanupTaskList(tasks, model.KindVideo, "finished")
	if removed != 2 {
		t.Fatalf("removed=%d", removed)
	}
	if len(kept) != 2 || kept[0].ID != 3 || kept[1].ID != 4 {
		t.Fatalf("kept=%v", []int64{kept[0].ID, kept[1].ID})
	}
	if cleanupMatches(model.StatusProcessing, "finished") {
		t.Fatal("active task matched cleanup")
	}
}

func TestTopToolbarResponsiveBandsKeepSearchGap(t *testing.T) {
	for _, width := range []int32{980, 1050, 1119, 1120, 1200, 1280, 1319, 1320, 1499, 1500, 1640, 1920} {
		band := topBandForWidth(width)
		if len(band.toolWidths) != 10 {
			t.Fatalf("width=%d toolbar buttons=%d", width, len(band.toolWidths))
		}
		toggleW := int32(32)
		if width < 1120 {
			toggleW = 28
		}
		toggleX := width - 8 - toggleW
		gridX := toggleX - 7 - band.statusGridW
		filterX := gridX - 8 - band.filterW
		searchRight := filterX - 7
		searchLeft := toolbarRightEdge(band) + 8
		if available := searchRight - searchLeft; available < 90 {
			t.Fatalf("width=%d leaves only %d px between toolbar and filter", width, available)
		}
	}
}

func TestFullCellBarsUseRowHeightAndCompressionRatio(t *testing.T) {
	checkCentered := func(name string, row rect) {
		t.Helper()
		bar := fullCellBarRect(row)
		insets := listCellBarInsets()
		wantLeft := row.Left + scaleDPI(insets.Horizontal)
		wantRight := row.Right - scaleDPI(insets.Horizontal)
		available := row.Bottom - row.Top - 2*scaleDPI(insets.Vertical)
		wantHeight := scaleDPI(24)
		if wantHeight > available {
			wantHeight = available
		}
		if minimum := scaleDPI(insets.MinimumHeight); wantHeight < minimum && available >= minimum {
			wantHeight = minimum
		}
		if wantHeight < 1 {
			wantHeight = 1
		}
		topGap := bar.Top - row.Top
		bottomGap := row.Bottom - bar.Bottom
		gapDelta := topGap - bottomGap
		if gapDelta < 0 {
			gapDelta = -gapDelta
		}
		if bar.Left != wantLeft || bar.Right != wantRight || bar.Bottom-bar.Top != wantHeight || gapDelta > 1 {
			t.Fatalf("%s bar=%+v row=%+v gaps=%d/%d, want horizontal inset, height %d and vertical centring", name, bar, row, topGap, bottomGap, wantHeight)
		}
	}
	checkCentered("synthetic-50px-row", rect{Left: 800, Top: 100, Right: 940, Bottom: 150})
	checkCentered("realistic-30px-row", rect{Left: 800, Top: 100, Right: 940, Bottom: 130})
	task := &model.Task{InputSize: 100, OutputSize: 50}
	fraction, label, active := compressionCellMetrics(task)
	if !active || fraction != .5 || label != "50 B (50.0%)" {
		t.Fatalf("compression metrics=%v %q active=%v", fraction, label, active)
	}
	inputShare := float64(task.InputSize) / float64(task.InputSize+task.OutputSize)
	if inputShare < .666 || inputShare > .667 {
		t.Fatalf("input/output split=%f, want 2:1", inputShare)
	}
}

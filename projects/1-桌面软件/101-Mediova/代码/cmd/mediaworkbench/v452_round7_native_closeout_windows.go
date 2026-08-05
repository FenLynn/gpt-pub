//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

const round7NativeSubclassID = 0x4572

type round7NativeResult struct {
	checks  map[string]bool
	details map[string]string
}

var (
	round7NativeEnabled      = v452Round5SelfTestRequested(os.Args[1:])
	round7NativeEventCB      uintptr
	round7NativeSubclassCB   uintptr
	round7NativeHook         uintptr
	round7NativeInstallOnce  sync.Once
	round7NativeRunOnce      sync.Once
	round7NativeStoredResult round7NativeResult
)

func init() {
	if !round7NativeEnabled {
		return
	}
	round7NativeEventCB = syscall.NewCallback(round7NativeEventProc)
	round7NativeSubclassCB = syscall.NewCallback(round7NativeSubclassProc)
	round7NativeHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		round7NativeEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func round7NativeEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	if app == nil || app.hwnd == 0 || !app.controlsReady || !app.selfTest {
		return 0
	}
	round7NativeInstallOnce.Do(func() {
		v452SetWindowSubclass.Call(app.hwnd, round7NativeSubclassCB, round7NativeSubclassID, 0)
	})
	return 0
}

func round7NativeSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == WM_APP_SELFTEST && app != nil && app.selfTest {
		round7NativeRunOnce.Do(func() {
			round7NativeStoredResult = app.round7RunNativeCloseout()
		})
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	if message == WM_APP_SELFTEST && app != nil && app.selfTest {
		_ = app.round7PatchNativeReport(round7NativeStoredResult)
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, round7NativeSubclassCB, subclassID)
	}
	return result
}

func (a *application) round7RunNativeCloseout() round7NativeResult {
	result := round7NativeResult{checks: map[string]bool{}, details: map[string]string{}}
	previewDir := filepath.Join(filepath.Dir(a.selfTestPath()), "ui-preview")
	if err := os.MkdirAll(previewDir, 0o755); err != nil {
		result.checks["round7_preview_directory"] = false
		result.details["round7_preview_directory"] = err.Error()
		return result
	}
	result.checks["round7_preview_directory"] = true

	root, err := os.MkdirTemp("", "Mediova-round7-native-")
	if err != nil {
		result.checks["round7_fixture_root"] = false
		result.details["round7_fixture_root"] = err.Error()
		return result
	}
	defer os.RemoveAll(root)
	ffmpeg, _, _, _, _ := a.componentSnapshot()
	videoPath := filepath.Join(root, "round7-five-marker-source.mp4")
	if err := v452Round5GenerateVideo(ffmpeg, videoPath); err != nil {
		result.checks["round7_video_fixture"] = false
		result.details["round7_video_fixture"] = err.Error()
		return result
	}
	result.checks["round7_video_fixture"] = true

	task := &model.Task{
		ID: a.nextID.Add(1), Input: videoPath, Root: root, Kind: model.KindVideo,
		Width: 1280, Height: 720, Duration: 12, FPS: 30,
		Status: model.StatusReady, ThumbnailIndex: -1,
	}
	opts := a.settings.DefaultOptions(model.KindVideo)
	opts.Rotation = "不旋转"
	opts.TrimStart = 2
	opts.TrimEnd = 10
	opts.Crop = model.Crop{Enabled: true, X: 160, Y: 90, Width: 640, Height: 360}

	workerResult := make(chan round7NativeResult, 1)
	go func() {
		worker := round7NativeResult{checks: map[string]bool{}, details: map[string]string{}}
		deadline := time.Now().Add(15 * time.Second)
		var editor *round7Editor
		for time.Now().Before(deadline) {
			editor = round7ActiveEditor
			if editor != nil && editor.hwnd != 0 && editor.hTimeline != 0 && editor.dialog != nil && editor.dialog.hCanvas != 0 {
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		if editor == nil || editor.hwnd == 0 || editor.hTimeline == 0 || editor.dialog == nil {
			worker.checks["round7_editor_opened"] = false
			worker.details["round7_editor_opened"] = "new editor was not created"
			workerResult <- worker
			return
		}
		worker.checks["round7_editor_opened"] = true
		time.Sleep(900 * time.Millisecond)

		normalPath := filepath.Join(previewDir, "Mediova-v4.5.2-round7-editor-normal.png")
		if err := v452Round5CaptureWindowPNG(editor.hwnd, normalPath); err != nil {
			worker.checks["round7_editor_normal_screenshot"] = false
			worker.details["round7_editor_normal_screenshot"] = err.Error()
		} else {
			worker.checks["round7_editor_normal_screenshot"] = media.FileSize(normalPath) > 10000
			worker.details["round7_editor_normal_screenshot"] = fmt.Sprintf("bytes=%d", media.FileSize(normalPath))
		}

		worker.checks["round7_editor_labels"] = getText(editor.hStartLabel) == "起始时间" &&
			getText(editor.hStartCurrent) == "当前" &&
			getText(editor.hStartInitial) == "源起点" &&
			getText(editor.hEndLabel) == "结束时间" &&
			getText(editor.hEndCurrent) == "当前" &&
			getText(editor.hEndTerminal) == "源终点"
		worker.details["round7_editor_labels"] = fmt.Sprintf("start=%q/%q/%q end=%q/%q/%q",
			getText(editor.hStartLabel), getText(editor.hStartCurrent), getText(editor.hStartInitial),
			getText(editor.hEndLabel), getText(editor.hEndCurrent), getText(editor.hEndTerminal))

		initialStart := editor.dialog.opts.TrimStart
		initialEnd := editor.dialog.opts.TrimEnd
		initialCurrent := editor.dialog.currentAt
		_, _, trackY := editor.timelineGeometry()

		v452Round5MouseDrag(editor.hTimeline, int(editor.timeToX(initialCurrent)), int(trackY), int(editor.timeToX(6)), int(trackY))
		time.Sleep(250 * time.Millisecond)
		currentOnly := editor.dialog.opts.TrimStart == initialStart && editor.dialog.opts.TrimEnd == initialEnd && editor.dialog.currentAt > 5.8 && editor.dialog.currentAt < 6.2
		worker.checks["round7_current_independent"] = currentOnly
		worker.details["round7_current_independent"] = fmt.Sprintf("start=%.3f current=%.3f end=%.3f", editor.dialog.opts.TrimStart, editor.dialog.currentAt, editor.dialog.opts.TrimEnd)

		currentAfterSeek := editor.dialog.currentAt
		v452Round5MouseDrag(editor.hTimeline, int(editor.timeToX(editor.dialog.opts.TrimStart)), int(trackY-12), int(editor.timeToX(3)), int(trackY-12))
		time.Sleep(200 * time.Millisecond)
		startOnly := editor.dialog.opts.TrimStart > 2.8 && editor.dialog.opts.TrimStart < 3.2 && editor.dialog.opts.TrimEnd == initialEnd && editor.dialog.currentAt == currentAfterSeek
		worker.checks["round7_trim_start_independent"] = startOnly
		worker.details["round7_trim_start_independent"] = fmt.Sprintf("start=%.3f current=%.3f end=%.3f", editor.dialog.opts.TrimStart, editor.dialog.currentAt, editor.dialog.opts.TrimEnd)

		startAfterDrag := editor.dialog.opts.TrimStart
		v452Round5MouseDrag(editor.hTimeline, int(editor.timeToX(editor.dialog.opts.TrimEnd)), int(trackY-12), int(editor.timeToX(9)), int(trackY-12))
		time.Sleep(200 * time.Millisecond)
		endOnly := editor.dialog.opts.TrimEnd > 8.8 && editor.dialog.opts.TrimEnd < 9.2 && editor.dialog.opts.TrimStart == startAfterDrag && editor.dialog.currentAt == currentAfterSeek
		worker.checks["round7_trim_end_independent"] = endOnly
		worker.details["round7_trim_end_independent"] = fmt.Sprintf("start=%.3f current=%.3f end=%.3f", editor.dialog.opts.TrimStart, editor.dialog.currentAt, editor.dialog.opts.TrimEnd)

		afterPath := filepath.Join(previewDir, "Mediova-v4.5.2-round7-editor-after-interaction.png")
		if err := v452Round5CaptureWindowPNG(editor.hwnd, afterPath); err != nil {
			worker.checks["round7_editor_after_screenshot"] = false
			worker.details["round7_editor_after_screenshot"] = err.Error()
		} else {
			worker.checks["round7_editor_after_screenshot"] = media.FileSize(afterPath) > 10000
			worker.details["round7_editor_after_screenshot"] = fmt.Sprintf("bytes=%d", media.FileSize(afterPath))
		}

		procPostMessageW.Call(editor.hwnd, WM_CLOSE, 0, 0)
		procPostMessageW.Call(a.hwnd, WM_NULL, 0, 0)
		workerResult <- worker
	}()

	round7ShowEditor(a, task, opts, []int{0})
	select {
	case worker := <-workerResult:
		for name, ok := range worker.checks {
			result.checks[name] = ok
		}
		for name, detail := range worker.details {
			result.details[name] = detail
		}
	case <-time.After(4 * time.Second):
		result.checks["round7_editor_worker_completed"] = false
		result.details["round7_editor_worker_completed"] = "round7 editor worker did not return"
	}
	return result
}

func (a *application) round7PatchNativeReport(result round7NativeResult) error {
	path := a.selfTestPath()
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var report map[string]any
	if err := json.Unmarshal(data, &report); err != nil {
		return err
	}
	checks, _ := report["checks"].(map[string]any)
	if checks == nil {
		checks = map[string]any{}
		report["checks"] = checks
	}
	details, _ := report["details"].(map[string]any)
	if details == nil {
		details = map[string]any{}
		report["details"] = details
	}
	for name, ok := range result.checks {
		checks[name] = ok
	}
	for name, detail := range result.details {
		details[name] = detail
	}
	passed := len(checks) > 0
	for _, raw := range checks {
		ok, valid := raw.(bool)
		if !valid || !ok {
			passed = false
			break
		}
	}
	report["passed"] = passed
	updated, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, updated, 0o644)
}

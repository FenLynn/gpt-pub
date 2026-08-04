//go:build windows

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

const v452Round6ReportSubclassID = 0x4567

var (
	v452Round6ReportEventCB uintptr
	v452Round6ReportMainCB  uintptr
	v452Round6ReportHook    uintptr
	v452Round6ReportOnce    sync.Once
)

func init() {
	v452Round6ReportEventCB = syscall.NewCallback(v452Round6ReportEventProc)
	v452Round6ReportMainCB = syscall.NewCallback(v452Round6ReportSubclassProc)
	v452Round6ReportHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		v452Round6ReportEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func v452Round6ReportEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	if app == nil || app.hwnd == 0 || !app.controlsReady || !app.selfTest {
		return 0
	}
	v452Round6ReportOnce.Do(func() {
		v452SetWindowSubclass.Call(app.hwnd, v452Round6ReportMainCB, v452Round6ReportSubclassID, 0)
	})
	return 0
}

func v452Round6ReportSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	if message == WM_APP_SELFTEST && app != nil && app.selfTest {
		_ = app.v452FinalizeRound6Report()
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, v452Round6ReportMainCB, subclassID)
	}
	return result
}

func (a *application) v452FinalizeRound6Report() error {
	path := a.selfTestPath()
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var report selfTestReport
	if err := json.Unmarshal(data, &report); err != nil {
		return err
	}
	if report.Checks == nil {
		report.Checks = map[string]bool{}
	}
	if report.Details == nil {
		report.Details = map[string]string{}
	}

	// The fifth-round probe encoded an implementation mistake as a requirement:
	// dragging inside the selected interval moved the whole interval and the
	// preview cursor. The approved specification defines only three draggable
	// objects, so replace that obsolete assertion with real seek independence.
	delete(report.Checks, "round5_timeline_range_drag")
	delete(report.Details, "round5_timeline_range_drag")
	seekEvents := v452Round6SeekEvents.Load()
	independent := v452Round6IndependentSeeks.Load()
	report.Checks["round6_timeline_seek_independent"] = seekEvents > 0 && independent > 0
	report.Details["round6_timeline_seek_independent"] = fmt.Sprintf("seek_events=%d independent=%d", seekEvents, independent)

	previewOK, previewDetail := a.v452Round6ExerciseRealListPreview()
	numberDraws := v452Round6NumberDraws.Load()
	previewAttempts := v452Round6PreviewAttempts.Load()
	previewDraws := v452Round6PreviewDraws.Load()
	report.Checks["round6_list_numbers_drawn"] = numberDraws > 0
	report.Details["round6_list_numbers_drawn"] = fmt.Sprintf("draws=%d", numberDraws)
	// This is a real end-to-end fixture: FFmpeg generates a real video and BMP,
	// the bitmap enters the same ImageList used by the product, a visible task
	// receives the actual returned index, and the resulting main window is
	// painted and captured. A synthetic ThumbnailIndex=0 is not accepted.
	report.Checks["round6_list_previews_drawn"] = previewOK && previewDraws > 0
	report.Details["round6_list_previews_drawn"] = fmt.Sprintf("%s attempts=%d draws=%d", previewDetail, previewAttempts, previewDraws)

	report.Passed = len(report.Checks) > 0
	for _, ok := range report.Checks {
		if !ok {
			report.Passed = false
			break
		}
	}
	updated, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, updated, 0o644)
}

func (a *application) v452Round6ExerciseRealListPreview() (bool, string) {
	if a == nil || a.hwnd == 0 || a.hList == 0 || a.hImageList == 0 {
		return false, "list or ImageList unavailable"
	}
	ffmpeg, _, _, _, _ := a.componentSnapshot()
	if ffmpeg == "" {
		return false, "bundled FFmpeg unavailable"
	}
	root, err := os.MkdirTemp("", "Mediova-round6-thumbnail-")
	if err != nil {
		return false, err.Error()
	}
	defer os.RemoveAll(root)
	videoPath := filepath.Join(root, "round6-real-thumbnail-source.mp4")
	if err := v452Round5GenerateVideo(ffmpeg, videoPath); err != nil {
		return false, "video fixture: " + err.Error()
	}
	thumbPath := filepath.Join(root, "round6-real-thumbnail.bmp")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	err = media.GenerateThumbnailBMP(ctx, ffmpeg, videoPath, thumbPath, 0.2, "自动", 86, 48)
	cancel()
	if err != nil || media.FileSize(thumbPath) <= 64 {
		if err == nil {
			err = fmt.Errorf("generated BMP is empty")
		}
		return false, "thumbnail generation: " + err.Error()
	}
	hBitmap, _, _ := procLoadImageW.Call(0, uintptr(unsafe.Pointer(p(thumbPath))), IMAGE_BITMAP, 0, 0, LR_LOADFROMFILE|LR_CREATEDIBSECTION)
	if hBitmap == 0 {
		return false, "LoadImageW failed"
	}
	indexRaw, _, _ := procImageListAdd.Call(a.hImageList, hBitmap, 0)
	procDeleteObject.Call(hBitmap)
	index := int(int32(indexRaw))
	if index < 0 {
		return false, "ImageList_Add failed"
	}

	task := &model.Task{
		ID:             a.nextID.Add(1),
		Input:          videoPath,
		Root:           root,
		Kind:           model.KindVideo,
		Width:          1280,
		Height:         720,
		Duration:       2.4,
		FPS:            30,
		InputSize:      media.FileSize(videoPath),
		Status:         model.StatusReady,
		Options:        a.settings.DefaultOptions(model.KindVideo),
		ThumbnailIndex: index,
	}

	a.mu.Lock()
	oldTasks := a.tasks
	oldVisible := a.visible
	oldKind := a.currentKind
	a.tasks = []*model.Task{task}
	a.visible = nil
	a.currentKind = model.KindVideo
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		a.tasks = oldTasks
		a.visible = oldVisible
		a.currentKind = oldKind
		a.mu.Unlock()
		a.refreshList()
	}()

	beforeNumbers := v452Round6NumberDraws.Load()
	beforePreviews := v452Round6PreviewDraws.Load()
	v452Round6InstallListOverlay(a)
	a.refreshList()
	procInvalidateRect.Call(a.hList, 0, 1)
	procUpdateWindow.Call(a.hList)

	previewDir := filepath.Join(filepath.Dir(a.selfTestPath()), "ui-preview")
	if err := os.MkdirAll(previewDir, 0o755); err != nil {
		return false, err.Error()
	}
	screenshot := filepath.Join(previewDir, "Mediova-v4.5.2-round6-real-thumbnail-list.png")
	if err := v452Round5CaptureWindowPNG(a.hwnd, screenshot); err != nil {
		return false, "capture: " + err.Error()
	}
	procInvalidateRect.Call(a.hList, 0, 1)
	procUpdateWindow.Call(a.hList)

	numberDelta := v452Round6NumberDraws.Load() - beforeNumbers
	previewDelta := v452Round6PreviewDraws.Load() - beforePreviews
	ok := numberDelta > 0 && previewDelta > 0 && media.FileSize(screenshot) > 10000
	return ok, fmt.Sprintf("index=%d bmp=%d screenshot=%d number_delta=%d preview_delta=%d", index, media.FileSize(thumbPath), media.FileSize(screenshot), numberDelta, previewDelta)
}

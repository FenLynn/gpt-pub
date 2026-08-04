//go:build windows

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

const (
	v452Round5MainSubclassID       = 0x4551
	v452Round5ToastCloseSubclassID = 0x4552
	v452Round5PMRemove             = 0x0001
	v452Round5SWMaximize           = 3
)

var (
	v452Round5Enabled           = v452Round5SelfTestRequested(os.Args[1:])
	v452Round5EventCB           uintptr
	v452Round5MainCB            uintptr
	v452Round5ToastCloseCB      uintptr
	v452Round5Hook              uintptr
	v452Round5MainInstalled     sync.Once
	v452Round5Patched           sync.Once
	v452Round5ToastCloseWindows sync.Map
	v452Round5GetParent         = user32.NewProc("GetParent")
	v452Round5PeekMessage       = user32.NewProc("PeekMessageW")
	v452Round5GetDC             = user32.NewProc("GetDC")
	v452Round5ReleaseDC         = user32.NewProc("ReleaseDC")
	v452Round5PrintWindow       = user32.NewProc("PrintWindow")
	v452Round5CreateDIBSection  = gdi32.NewProc("CreateDIBSection")
)

type v452Round5BitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

type v452Round5BitmapInfo struct {
	Header v452Round5BitmapInfoHeader
	Colors [1]uint32
}

type v452Round5TrimResult struct {
	checks  map[string]bool
	details map[string]string
}

func init() {
	if !v452Round5Enabled {
		return
	}
	v452Round5EventCB = syscall.NewCallback(v452Round5EventProc)
	v452Round5MainCB = syscall.NewCallback(v452Round5MainSubclassProc)
	v452Round5ToastCloseCB = syscall.NewCallback(v452Round5ToastCloseSubclassProc)
	v452Round5Hook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		v452Round5EventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func v452Round5SelfTestRequested(args []string) bool {
	for _, raw := range args {
		arg := strings.TrimSpace(raw)
		if arg == "--self-test" || strings.HasPrefix(arg, "--self-test-output=") || arg == "--self-test-output" || arg == "--self-test-out" {
			return true
		}
	}
	return false
}

func v452Round5EventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	if app == nil || app.hwnd == 0 || !app.controlsReady || !app.selfTest {
		return 0
	}
	v452Round5MainInstalled.Do(func() {
		v452SetWindowSubclass.Call(app.hwnd, v452Round5MainCB, v452Round5MainSubclassID, 0)
	})
	return 0
}

func v452Round5MainSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == WM_APP_SELFTEST && app != nil && app.selfTest {
		v452Round5Patched.Do(func() {
			started := time.Now()
			checks, details := app.v452RunRound5Closeout()
			details["round5_closeout_elapsed"] = time.Since(started).String()
			if err := app.v452PatchRound5SelfTest(checks, details, time.Since(started)); err != nil {
				failure := selfTestReport{
					Version: appVersion,
					Time:    time.Now().Format(time.RFC3339),
					Passed:  false,
					Checks:  map[string]bool{"round5_report_patch": false},
					Details: map[string]string{"round5_report_patch": err.Error()},
				}
				if data, marshalErr := json.MarshalIndent(failure, "", "  "); marshalErr == nil {
					_ = os.WriteFile(app.selfTestPath(), data, 0o644)
				}
			}
		})
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, v452Round5MainCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func (a *application) v452RunRound5Closeout() (map[string]bool, map[string]string) {
	checks := map[string]bool{}
	details := map[string]string{}
	previewDir := filepath.Join(filepath.Dir(a.selfTestPath()), "ui-preview")
	if err := os.MkdirAll(previewDir, 0o755); err != nil {
		checks["round5_preview_directory"] = false
		details["round5_preview_directory"] = err.Error()
		return checks, details
	}
	checks["round5_preview_directory"] = true

	root, err := os.MkdirTemp("", "Mediova-round5-closeout-")
	if err != nil {
		checks["round5_fixture_root"] = false
		details["round5_fixture_root"] = err.Error()
		return checks, details
	}
	defer os.RemoveAll(root)
	checks["round5_fixture_root"] = true

	ffmpeg, ffprobe, _, _, _ := a.componentSnapshot()
	videoPath := filepath.Join(root, "round5-trim-source.mp4")
	imagePath := filepath.Join(root, "round5-trim-source.png")
	checks["round5_video_fixture"] = v452Round5GenerateVideo(ffmpeg, videoPath) == nil
	if !checks["round5_video_fixture"] {
		details["round5_video_fixture"] = "unable to generate real 1280x720 fixture with bundled FFmpeg"
	}
	checks["round5_image_fixture"] = v452Round5GenerateImage(imagePath) == nil
	if !checks["round5_image_fixture"] {
		details["round5_image_fixture"] = "unable to generate real 1200x800 PNG fixture"
	}

	videoResult := a.v452Round5ExerciseTrimDialog(model.KindVideo, videoPath, previewDir)
	v452Round5MergeResult(checks, details, videoResult)
	imageResult := a.v452Round5ExerciseTrimDialog(model.KindImage, imagePath, previewDir)
	v452Round5MergeResult(checks, details, imageResult)

	toastChecks, toastDetails := a.v452Round5ExerciseImportToast(previewDir)
	for name, ok := range toastChecks {
		checks[name] = ok
	}
	for name, detail := range toastDetails {
		details[name] = detail
	}

	matrixChecks, matrixDetails := v452Round5FFmpegMatrix(ffmpeg, ffprobe, root, previewDir)
	for name, ok := range matrixChecks {
		checks[name] = ok
	}
	for name, detail := range matrixDetails {
		details[name] = detail
	}
	return checks, details
}

func v452Round5MergeResult(checks map[string]bool, details map[string]string, result v452Round5TrimResult) {
	for name, ok := range result.checks {
		checks[name] = ok
	}
	for name, detail := range result.details {
		details[name] = detail
	}
}

func v452Round5GenerateVideo(ffmpeg, path string) error {
	if strings.TrimSpace(ffmpeg) == "" {
		return fmt.Errorf("ffmpeg unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffmpeg,
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30",
		"-t", "2.4", "-c:v", "libx264", "-pix_fmt", "yuv420p", path,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
	}
	if media.FileSize(path) < 1024 {
		return fmt.Errorf("generated video is empty")
	}
	return nil
}

func v452Round5GenerateImage(path string) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	img := image.NewRGBA(image.Rect(0, 0, 1200, 800))
	for y := 0; y < 800; y++ {
		for x := 0; x < 1200; x++ {
			img.SetRGBA(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: uint8((x + y) % 256), A: 255})
		}
	}
	return png.Encode(file, img)
}

func (a *application) v452Round5ExerciseTrimDialog(kind model.Kind, input, previewDir string) v452Round5TrimResult {
	prefix := "round5_trim_video"
	width, height := 1280, 720
	duration, fps := 12.0, 30.0
	if kind == model.KindImage {
		prefix = "round5_trim_image"
		width, height = 1200, 800
		duration, fps = 0, 0
	}
	resultCh := make(chan v452Round5TrimResult, 1)
	task := &model.Task{
		ID:             a.nextID.Add(1),
		Input:          input,
		Kind:           kind,
		Width:          width,
		Height:         height,
		Duration:       duration,
		FPS:            fps,
		Status:         model.StatusReady,
		ThumbnailIndex: -1,
	}
	opts := a.settings.DefaultOptions(kind)
	opts.Rotation = "不旋转"
	opts.Crop = model.Crop{Enabled: true, X: 160, Y: 90, Width: 640, Height: 360}
	if kind == model.KindVideo {
		opts.TrimStart = 2
		opts.TrimEnd = 10
	}

	go func() {
		result := v452Round5TrimResult{checks: map[string]bool{}, details: map[string]string{}}
		deadline := time.Now().Add(12 * time.Second)
		var d *trimDialog
		for time.Now().Before(deadline) {
			d = activeTrim
			if d != nil && d.hwnd != 0 && d.hCanvas != 0 && d.hTrack != 0 {
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		if d == nil || d.hwnd == 0 {
			result.checks[prefix+"_opened"] = false
			result.details[prefix+"_opened"] = "trim dialog was not created"
			resultCh <- result
			return
		}
		result.checks[prefix+"_opened"] = true
		time.Sleep(1400 * time.Millisecond)
		normalPath := filepath.Join(previewDir, "Mediova-v4.5.2-"+strings.ReplaceAll(prefix, "_", "-")+"-normal.png")
		if err := v452Round5CaptureWindowPNG(d.hwnd, normalPath); err != nil {
			result.checks[prefix+"_normal_screenshot"] = false
			result.details[prefix+"_normal_screenshot"] = err.Error()
		} else {
			result.checks[prefix+"_normal_screenshot"] = media.FileSize(normalPath) > 10000
		}

		if kind == model.KindVideo {
			v452Round5ExerciseTimeline(d, &result)
		} else {
			enabled, _, _ := user32.NewProc("IsWindowEnabled").Call(d.hTrack)
			result.checks[prefix+"_timeline_disabled"] = enabled == 0
		}
		v452Round5ExerciseCropHandles(d, prefix, &result)

		procShowWindow.Call(d.hwnd, v452Round5SWMaximize)
		time.Sleep(400 * time.Millisecond)
		maxPath := filepath.Join(previewDir, "Mediova-v4.5.2-"+strings.ReplaceAll(prefix, "_", "-")+"-maximized.png")
		if err := v452Round5CaptureWindowPNG(d.hwnd, maxPath); err != nil {
			result.checks[prefix+"_maximized_screenshot"] = false
			result.details[prefix+"_maximized_screenshot"] = err.Error()
		} else {
			result.checks[prefix+"_maximized_screenshot"] = media.FileSize(maxPath) > 10000
		}
		procShowWindow.Call(d.hwnd, SW_RESTORE)
		time.Sleep(300 * time.Millisecond)
		afterPath := filepath.Join(previewDir, "Mediova-v4.5.2-"+strings.ReplaceAll(prefix, "_", "-")+"-after-interaction.png")
		if err := v452Round5CaptureWindowPNG(d.hwnd, afterPath); err != nil {
			result.checks[prefix+"_after_screenshot"] = false
			result.details[prefix+"_after_screenshot"] = err.Error()
		} else {
			result.checks[prefix+"_after_screenshot"] = media.FileSize(afterPath) > 10000
		}
		result.checks[prefix+"_restore_survived"] = func() bool {
			visible, _, _ := procIsWindowVisible.Call(d.hwnd)
			return visible != 0
		}()
		send(d.hwnd, WM_CLOSE, 0, 0)
		procPostMessageW.Call(a.hwnd, WM_NULL, 0, 0)
		resultCh <- result
	}()

	showTrimCropDialog(a, task, opts)
	select {
	case result := <-resultCh:
		return result
	case <-time.After(3 * time.Second):
		return v452Round5TrimResult{
			checks:  map[string]bool{prefix + "_automation_completed": false},
			details: map[string]string{prefix + "_automation_completed": "automation worker did not return"},
		}
	}
}

func v452Round5ExerciseTimeline(d *trimDialog, result *v452Round5TrimResult) {
	_, left, right := v452TrimTimelineGeometry(d.hTrack)
	if right <= left || d.task.Duration <= 0 {
		result.checks["round5_timeline_geometry"] = false
		return
	}
	result.checks["round5_timeline_geometry"] = true
	y := 28
	initial := v452ReadTrimRange(d)
	startX := media.TimelineTimeToX(initial.Start, d.task.Duration, left, right)
	endX := media.TimelineTimeToX(initial.End, d.task.Duration, left, right)
	v452Round5MouseDrag(d.hTrack, startX, y, media.TimelineTimeToX(initial.Start+1, d.task.Duration, left, right), y)
	afterStart := v452ReadTrimRange(d)
	result.checks["round5_timeline_start_drag"] = afterStart.Start > initial.Start+0.8

	v452Round5MouseDrag(d.hTrack, endX, y, media.TimelineTimeToX(initial.End-1, d.task.Duration, left, right), y)
	afterEnd := v452ReadTrimRange(d)
	result.checks["round5_timeline_end_drag"] = afterEnd.End < initial.End-0.8

	playX := media.TimelineTimeToX(1, d.task.Duration, left, right)
	v452Round5MouseDrag(d.hTrack, playX, y, playX, y)
	afterPlay := v452ReadTrimRange(d)
	result.checks["round5_timeline_playhead_drag"] = afterPlay.Playhead > 0.8 && afterPlay.Playhead < 1.2

	beforeRange := afterPlay
	anchorTime := (beforeRange.Start + beforeRange.End) / 2
	anchorX := media.TimelineTimeToX(anchorTime, d.task.Duration, left, right)
	targetX := media.TimelineTimeToX(anchorTime+1, d.task.Duration, left, right)
	v452Round5MouseDrag(d.hTrack, anchorX, y, targetX, y)
	afterRange := v452ReadTrimRange(d)
	result.checks["round5_timeline_range_drag"] = afterRange.Start > beforeRange.Start+0.8 && afterRange.End > beforeRange.End+0.8
	result.details["round5_timeline_values"] = fmt.Sprintf("initial=%+v afterStart=%+v afterEnd=%+v afterPlay=%+v afterRange=%+v", initial, afterStart, afterEnd, afterPlay, afterRange)
}

func v452Round5ExerciseCropHandles(d *trimDialog, prefix string, result *v452Round5TrimResult) {
	initial := model.Crop{Enabled: true, X: 160, Y: 90, Width: 640, Height: 360}
	tests := []struct {
		name   string
		handle media.CropHandle
		dx, dy int
	}{
		{"north", media.CropHandleNorth, 0, 24},
		{"north_east", media.CropHandleNorthEast, 24, 24},
		{"east", media.CropHandleEast, 24, 0},
		{"south_east", media.CropHandleSouthEast, 24, 24},
		{"south", media.CropHandleSouth, 0, 24},
		{"south_west", media.CropHandleSouthWest, 24, 24},
		{"west", media.CropHandleWest, 24, 0},
		{"north_west", media.CropHandleNorthWest, 24, 24},
	}
	for _, tc := range tests {
		d.opts.Crop = initial
		d.cropToControls()
		anchorX, anchorY := v452Round5CropHandlePoint(initial, tc.handle)
		startX, startY := v452Round5FrameToCanvas(d, anchorX, anchorY)
		endX, endY := v452Round5FrameToCanvas(d, anchorX+tc.dx, anchorY+tc.dy)
		v452Round5MouseDrag(d.hCanvas, startX, startY, endX, endY)
		actual := d.opts.Crop
		valid := actual.Enabled && actual.Width >= 2 && actual.Height >= 2 && actual.X >= 0 && actual.Y >= 0 && actual.X+actual.Width <= d.frameW && actual.Y+actual.Height <= d.frameH
		result.checks[prefix+"_crop_"+tc.name] = valid && actual != initial
		if !result.checks[prefix+"_crop_"+tc.name] {
			result.details[prefix+"_crop_"+tc.name] = fmt.Sprintf("initial=%+v actual=%+v", initial, actual)
		}
	}

	d.opts.Crop = initial
	d.cropToControls()
	centerX, centerY := initial.X+initial.Width/2, initial.Y+initial.Height/2
	startX, startY := v452Round5FrameToCanvas(d, centerX, centerY)
	endX, endY := v452Round5FrameToCanvas(d, centerX+48, centerY+32)
	v452Round5MouseDrag(d.hCanvas, startX, startY, endX, endY)
	moved := d.opts.Crop
	result.checks[prefix+"_crop_move"] = moved.X > initial.X+30 && moved.Y > initial.Y+20 && moved.Width == initial.Width && moved.Height == initial.Height
	if !result.checks[prefix+"_crop_move"] {
		result.details[prefix+"_crop_move"] = fmt.Sprintf("initial=%+v moved=%+v", initial, moved)
	}
}

func v452Round5CropHandlePoint(crop model.Crop, handle media.CropHandle) (int, int) {
	left, top := crop.X, crop.Y
	right, bottom := crop.X+crop.Width, crop.Y+crop.Height
	midX, midY := (left+right)/2, (top+bottom)/2
	switch handle {
	case media.CropHandleNorth:
		return midX, top
	case media.CropHandleNorthEast:
		return right, top
	case media.CropHandleEast:
		return right, midY
	case media.CropHandleSouthEast:
		return right, bottom
	case media.CropHandleSouth:
		return midX, bottom
	case media.CropHandleSouthWest:
		return left, bottom
	case media.CropHandleWest:
		return left, midY
	default:
		return left, top
	}
}

func v452Round5FrameToCanvas(d *trimDialog, x, y int) (int, int) {
	draw := d.previewDrawRect(d.hCanvas)
	width := int(draw.Right - draw.Left)
	height := int(draw.Bottom - draw.Top)
	if width < 1 || height < 1 || d.frameW < 1 || d.frameH < 1 {
		return 0, 0
	}
	return int(draw.Left) + x*width/d.frameW, int(draw.Top) + y*height/d.frameH
}

func v452Round5MouseDrag(hwnd uintptr, startX, startY, endX, endY int) {
	send(hwnd, WM_LBUTTONDOWN, 1, v452Round5MouseLParam(startX, startY))
	if startX != endX || startY != endY {
		send(hwnd, WM_MOUSEMOVE, 1, v452Round5MouseLParam(endX, endY))
	}
	send(hwnd, WM_LBUTTONUP, 0, v452Round5MouseLParam(endX, endY))
	time.Sleep(80 * time.Millisecond)
}

func v452Round5MouseLParam(x, y int) uintptr {
	return uintptr(uint16(int16(x))) | uintptr(uint16(int16(y)))<<16
}

func (a *application) v452Round5ExerciseImportToast(previewDir string) (map[string]bool, map[string]string) {
	checks := map[string]bool{}
	details := map[string]string{}
	v452ShowImportFeedbackToast(a, "导入完成：视频 2 个，图片 3 个；重复 1 个。")
	if v452ImportToastWindow == 0 {
		checks["round5_import_toast_opened"] = false
		return checks, details
	}
	checks["round5_import_toast_opened"] = true
	v452Round5InstallToastClose(v452ImportToastWindow)
	time.Sleep(250 * time.Millisecond)
	path := filepath.Join(previewDir, "Mediova-v4.5.2-round5-import-toast.png")
	if err := v452Round5CaptureWindowPNG(v452ImportToastWindow, path); err != nil {
		checks["round5_import_toast_screenshot"] = false
		details["round5_import_toast_screenshot"] = err.Error()
	} else {
		checks["round5_import_toast_screenshot"] = media.FileSize(path) > 4000
	}
	value, ok := v452ImportToastStates.Load(v452ImportToastWindow)
	if !ok {
		checks["round5_import_toast_manual_close"] = false
		return checks, details
	}
	state := value.(*v452ImportToastState)
	v452Round5MouseDrag(state.close, 5, 5, 5, 5)
	deadline := time.Now().Add(1500 * time.Millisecond)
	for time.Now().Before(deadline) && v452ImportToastWindow != 0 {
		v452Round5PumpMessages(20 * time.Millisecond)
	}
	checks["round5_import_toast_manual_close"] = v452ImportToastWindow == 0
	if !checks["round5_import_toast_manual_close"] {
		details["round5_import_toast_manual_close"] = "toast remained after direct close-button mouse messages"
		if v452ImportToastWindow != 0 {
			v452DestroyImportToast(v452ImportToastWindow)
		}
	}
	return checks, details
}

func v452Round5InstallToastClose(hwnd uintptr) {
	value, ok := v452ImportToastStates.Load(hwnd)
	if !ok {
		return
	}
	state := value.(*v452ImportToastState)
	if state.close == 0 {
		return
	}
	if _, loaded := v452Round5ToastCloseWindows.LoadOrStore(state.close, true); loaded {
		return
	}
	v452SetWindowSubclass.Call(state.close, v452Round5ToastCloseCB, v452Round5ToastCloseSubclassID, 0)
}

func v452Round5ToastCloseSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case WM_LBUTTONUP:
		parent, _, _ := v452Round5GetParent.Call(hwnd)
		if parent != 0 {
			v452BeginImportToastClose(parent)
		}
		return 0
	case WM_KEYDOWN:
		if wParam == VK_RETURN || wParam == VK_SPACE {
			parent, _, _ := v452Round5GetParent.Call(hwnd)
			if parent != 0 {
				v452BeginImportToastClose(parent)
			}
			return 0
		}
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, v452Round5ToastCloseCB, subclassID)
		v452Round5ToastCloseWindows.Delete(hwnd)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func v452Round5PumpMessages(duration time.Duration) {
	deadline := time.Now().Add(duration)
	for time.Now().Before(deadline) {
		var message msg
		for {
			hasMessage, _, _ := v452Round5PeekMessage.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0, v452Round5PMRemove)
			if hasMessage == 0 {
				break
			}
			procTranslateMessage.Call(uintptr(unsafe.Pointer(&message)))
			procDispatchMessageW.Call(uintptr(unsafe.Pointer(&message)))
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func v452Round5FFmpegMatrix(ffmpeg, ffprobe, root, previewDir string) (map[string]bool, map[string]string) {
	checks := map[string]bool{}
	details := map[string]string{}
	if ffmpeg == "" || ffprobe == "" {
		checks["round5_ffmpeg_matrix"] = false
		details["round5_ffmpeg_matrix"] = "bundled FFmpeg pair unavailable"
		return checks, details
	}
	source := filepath.Join(root, "round5-matrix-source.mp4")
	if err := v452Round5GenerateMatrixSource(ffmpeg, source); err != nil {
		checks["round5_ffmpeg_matrix"] = false
		details["round5_ffmpeg_matrix"] = err.Error()
		return checks, details
	}
	probe, err := media.Probe(ffprobe, source)
	if err != nil {
		checks["round5_ffmpeg_matrix"] = false
		details["round5_ffmpeg_matrix"] = err.Error()
		return checks, details
	}
	settings := model.DefaultSettings()
	settings.UseGPU = false
	settings.SmartStreamCopy = false
	settings.AudioMode = "静音"
	settings.AllowUpscale = false
	cases := []struct {
		name, rotation string
		crop           model.Crop
		width, height  int
	}{
		{"r0", "不旋转", model.Crop{Enabled: true, X: 40, Y: 30, Width: 320, Height: 180}, 320, 180},
		{"r90", "90°右转", model.Crop{Enabled: true, X: 30, Y: 40, Width: 180, Height: 320}, 180, 320},
		{"r180", "180°", model.Crop{Enabled: true, X: 40, Y: 30, Width: 320, Height: 180}, 320, 180},
		{"r270", "90°左转", model.Crop{Enabled: true, X: 30, Y: 40, Width: 180, Height: 320}, 180, 320},
	}
	all := true
	for _, tc := range cases {
		opts := settings.EffectiveOptions(&model.Task{Kind: model.KindVideo})
		opts.Rotation = tc.rotation
		opts.Resolution = "原尺寸"
		opts.Codec = "H.264"
		opts.Quality = "低"
		opts.TrimEnd = 1
		opts.Crop = tc.crop
		output := filepath.Join(root, "round5-matrix-"+tc.name+".mp4")
		req := media.ConvertRequest{Input: source, Output: output, Kind: model.KindVideo, Probe: probe, Options: opts, Settings: settings}
		filters := media.BuildFilters(req)
		cropAt := strings.Index(filters, "crop=")
		rotationAt := -1
		if strings.Contains(tc.rotation, "90°") {
			rotationAt = strings.Index(filters, "transpose=")
		} else if tc.rotation == "180°" {
			rotationAt = strings.Index(filters, "hflip,vflip")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		_, convertErr := media.Convert(ctx, ffmpeg, req, nil)
		cancel()
		actual, probeErr := media.Probe(ffprobe, output)
		ok := cropAt >= 0 && (rotationAt < 0 || rotationAt < cropAt) && convertErr == nil && probeErr == nil && actual.Width == tc.width && actual.Height == tc.height && actual.Duration > 0.8
		checks["round5_ffmpeg_matrix_"+tc.name] = ok
		all = all && ok
		details["round5_ffmpeg_matrix_"+tc.name] = fmt.Sprintf("filters=%q convert=%v probe=%v output=%dx%d duration=%.3f", filters, convertErr, probeErr, actual.Width, actual.Height, actual.Duration)
		frame := filepath.Join(previewDir, "Mediova-v4.5.2-round5-ffmpeg-"+tc.name+".png")
		ctx, cancel = context.WithTimeout(context.Background(), 30*time.Second)
		cmd := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", output, "-frames:v", "1", frame)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
		frameOutput, frameErr := cmd.CombinedOutput()
		cancel()
		frameOK := frameErr == nil && media.FileSize(frame) > 1024
		checks["round5_ffmpeg_frame_"+tc.name] = frameOK
		all = all && frameOK
		if !frameOK {
			details["round5_ffmpeg_frame_"+tc.name] = fmt.Sprintf("%v: %s", frameErr, strings.TrimSpace(string(frameOutput)))
		}
	}
	checks["round5_ffmpeg_matrix"] = all
	return checks, details
}

func v452Round5GenerateMatrixSource(ffmpeg, path string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffmpeg,
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
		"-t", "1.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", path,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func (a *application) v452PatchRound5SelfTest(checks map[string]bool, details map[string]string, elapsed time.Duration) error {
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
	for name, ok := range checks {
		report.Checks[name] = ok
	}
	for name, detail := range details {
		report.Details[name] = detail
	}
	report.ElapsedMillis += elapsed.Milliseconds()
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

func v452Round5CaptureWindowPNG(hwnd uintptr, path string) error {
	var window rect
	if ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&window))); ok == 0 {
		return fmt.Errorf("GetWindowRect failed")
	}
	width := int(window.Right - window.Left)
	height := int(window.Bottom - window.Top)
	if width < 10 || height < 10 {
		return fmt.Errorf("invalid window size %dx%d", width, height)
	}
	dc, _, _ := v452Round5GetDC.Call(hwnd)
	if dc == 0 {
		return fmt.Errorf("GetDC failed")
	}
	defer v452Round5ReleaseDC.Call(hwnd, dc)
	memoryDC, _, _ := procCreateCompatibleDC.Call(dc)
	if memoryDC == 0 {
		return fmt.Errorf("CreateCompatibleDC failed")
	}
	defer procDeleteDC.Call(memoryDC)
	info := v452Round5BitmapInfo{Header: v452Round5BitmapInfoHeader{
		Size:        uint32(unsafe.Sizeof(v452Round5BitmapInfoHeader{})),
		Width:       int32(width),
		Height:      -int32(height),
		Planes:      1,
		BitCount:    32,
		Compression: 0,
	}}
	var bits uintptr
	bitmap, _, _ := v452Round5CreateDIBSection.Call(dc, uintptr(unsafe.Pointer(&info)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if bitmap == 0 || bits == 0 {
		return fmt.Errorf("CreateDIBSection failed")
	}
	defer procDeleteObject.Call(bitmap)
	old, _, _ := procSelectObject.Call(memoryDC, bitmap)
	if old != 0 {
		defer procSelectObject.Call(memoryDC, old)
	}
	if ok, _, _ := v452Round5PrintWindow.Call(hwnd, memoryDC, 2); ok == 0 {
		return fmt.Errorf("PrintWindow failed")
	}
	raw := unsafe.Slice((*byte)(unsafe.Pointer(bits)), width*height*4)
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for i := 0; i < width*height; i++ {
		source := i * 4
		target := i * 4
		img.Pix[target] = raw[source+2]
		img.Pix[target+1] = raw[source+1]
		img.Pix[target+2] = raw[source]
		img.Pix[target+3] = 255
	}
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return png.Encode(file, img)
}

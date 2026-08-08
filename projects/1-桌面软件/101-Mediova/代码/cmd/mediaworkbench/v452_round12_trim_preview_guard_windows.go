//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"mediaworkbench/internal/config"
)

const (
	round12TrimPreviewEditorSubclassID   = 0x45D1
	round12TrimPreviewTimelineSubclassID = 0x45D2
	round12EventObjectCreate             = 0x8000
	round12EventObjectShow               = 0x8002
	round12WinEventOutOfContext          = 0x0000
	round12CreateNoWindow                = 0x08000000
)

type round12TrimPreviewGuardState struct {
	mu         sync.Mutex
	generation int64
	cancel     context.CancelFunc
}

var (
	round12TrimPreviewEventHook uintptr
	round12TrimPreviewHookMu    sync.Mutex
	round12TrimPreviewStates    sync.Map
	round12TrimPreviewEventCB   uintptr
	round12TrimPreviewEditorCB  uintptr
	round12TrimPreviewTimelineCB uintptr
	round12SetWinEventHook      = user32.NewProc("SetWinEventHook")
	round12UnhookWinEvent       = user32.NewProc("UnhookWinEvent")
)

func init() {
	round12TrimPreviewEventCB = syscall.NewCallback(round12TrimPreviewEventProc)
	round12TrimPreviewEditorCB = syscall.NewCallback(round12TrimPreviewEditorSubclassProc)
	round12TrimPreviewTimelineCB = syscall.NewCallback(round12TrimPreviewTimelineSubclassProc)
}

func round12ArmTrimPreviewHook() {
	round12TrimPreviewHookMu.Lock()
	defer round12TrimPreviewHookMu.Unlock()
	if round12TrimPreviewEventHook != 0 {
		return
	}
	hook, _, _ := round12SetWinEventHook.Call(
		round12EventObjectCreate,
		round12EventObjectShow,
		0,
		round12TrimPreviewEventCB,
		0,
		0,
		round12WinEventOutOfContext,
	)
	round12TrimPreviewEventHook = hook
}

func round12TrimPreviewEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	e := round7ActiveEditor
	if e == nil || e.hwnd == 0 || e.hTimeline == 0 || e.dialog == nil || e.dialog.hCanvas == 0 {
		return 0
	}
	v452SetWindowSubclass.Call(e.hwnd, round12TrimPreviewEditorCB, round12TrimPreviewEditorSubclassID, 0)
	v452SetWindowSubclass.Call(e.hTimeline, round12TrimPreviewTimelineCB, round12TrimPreviewTimelineSubclassID, 0)
	round12ScheduleTrimPreviewWatch(e)

	round12TrimPreviewHookMu.Lock()
	if round12TrimPreviewEventHook != 0 {
		round12UnhookWinEvent.Call(round12TrimPreviewEventHook)
		round12TrimPreviewEventHook = 0
	}
	round12TrimPreviewHookMu.Unlock()
	return 0
}

func round12TrimPreviewEditorSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	e := round7ActiveEditor
	switch message {
	case WM_COMMAND:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if e != nil && e.hwnd == hwnd && round12PreviewCommandChangesFrame(int(loWord(wParam))) {
			round12ScheduleTrimPreviewWatch(e)
		}
		return result
	case WM_KEYDOWN:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if e != nil && e.hwnd == hwnd && (int(wParam) == 0x25 || int(wParam) == 0x27) {
			round12ScheduleTrimPreviewWatch(e)
		}
		return result
	case v452WMNCDestroy:
		round12CancelTrimPreviewGuard(hwnd)
		v452RemoveSubclass.Call(hwnd, round12TrimPreviewEditorCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round12TrimPreviewTimelineSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	e := round7ActiveEditor
	if message == WM_LBUTTONUP {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if e != nil && e.hTimeline == hwnd {
			round12ScheduleTrimPreviewWatch(e)
		}
		return result
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, round12TrimPreviewTimelineCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round12PreviewCommandChangesFrame(id int) bool {
	switch id {
	case IDC_JUMP_TIME, IDC_SEEK_MINUS_SEC, IDC_SEEK_PLUS_SEC, IDC_SEEK_MINUS_FRAME, IDC_SEEK_PLUS_FRAME:
		return true
	default:
		return false
	}
}

func round12TrimPreviewState(hwnd uintptr) *round12TrimPreviewGuardState {
	value, _ := round12TrimPreviewStates.LoadOrStore(hwnd, &round12TrimPreviewGuardState{})
	return value.(*round12TrimPreviewGuardState)
}

func round12ScheduleTrimPreviewWatch(e *round7Editor) {
	if e == nil || e.hwnd == 0 || e.owner == nil || e.dialog == nil || e.dialog.task == nil || e.dialog.task.Kind != 0 {
		return
	}
	state := round12TrimPreviewState(e.hwnd)
	state.mu.Lock()
	state.generation++
	generation := state.generation
	if state.cancel != nil {
		state.cancel()
		state.cancel = nil
	}
	state.mu.Unlock()

	time.AfterFunc(2500*time.Millisecond, func() {
		e.owner.postUI(func() {
			if round7ActiveEditor != e || e.done || e.dialog == nil || e.dialog.closed.Load() {
				return
			}
			state.mu.Lock()
			current := state.generation == generation
			state.mu.Unlock()
			if !current || !round12TrimPreviewNeedsRecovery(e) {
				return
			}
			round12StartTrimPreviewRecovery(e, state, generation)
		})
	})
}

func round12TrimPreviewNeedsRecovery(e *round7Editor) bool {
	if e == nil || e.dialog == nil {
		return false
	}
	info := getText(e.dialog.hInfo)
	return e.dialog.bitmap == 0 || strings.Contains(info, "预览帧生成失败") || strings.Contains(info, "预览帧加载失败")
}

func round12StartTrimPreviewRecovery(e *round7Editor, state *round12TrimPreviewGuardState, generation int64) {
	d := e.dialog
	if d == nil || d.owner == nil || d.owner.ffmpeg == "" || d.task == nil {
		return
	}
	state.mu.Lock()
	if state.generation != generation {
		state.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	state.cancel = cancel
	state.mu.Unlock()

	seq := d.previewSeq.Add(1) // invalidate the failed/stale normal preview
	dir, err := config.TempDir()
	if err != nil {
		cancel()
		return
	}
	out := filepath.Join(dir, fmt.Sprintf("trim_frame_recovery_%d_%d.bmp", d.task.ID, seq))
	input := d.task.Input
	at := d.currentAt
	duration := d.task.Duration
	fps := d.safeFPS()
	rotation := d.opts.Rotation
	ffmpeg := d.owner.ffmpeg
	setText(e.hInstruction, "预览取帧失败，正在自动恢复…")

	go func() {
		err := round12GenerateRecoveredPreview(ctx, ffmpeg, input, out, at, duration, fps, rotation)
		e.owner.postUI(func() {
			defer os.Remove(out)
			cancel()
			state.mu.Lock()
			if state.cancel == cancel {
				state.cancel = nil
			}
			current := state.generation == generation
			state.mu.Unlock()
			if !current || round7ActiveEditor != e || d.closed.Load() || d.previewSeq.Load() != seq {
				return
			}
			if err != nil {
				setText(d.hInfo, "预览帧自动恢复失败："+short(err.Error(), 220))
				setText(e.hInstruction, "预览取帧失败；移动当前时间后将自动重试。")
				return
			}
			h, _, _ := procLoadImageW.Call(0, uintptr(unsafe.Pointer(p(out))), IMAGE_BITMAP, 0, 0, LR_LOADFROMFILE|LR_CREATEDIBSECTION)
			if h == 0 {
				setText(d.hInfo, "预览帧自动恢复后加载失败。")
				return
			}
			if d.bitmap != 0 {
				procDeleteObject.Call(d.bitmap)
			}
			d.bitmap = h
			var bm bitmapInfo
			procGetObjectW.Call(h, unsafe.Sizeof(bm), uintptr(unsafe.Pointer(&bm)))
			d.bitmapW, d.bitmapH = bm.Width, bm.Height
			e.updateInfo()
			setText(e.hInstruction, "预览已自动恢复；拖动红色游标继续预览画面。")
			procInvalidateRect.Call(d.hCanvas, 0, 1)
		})
	}()
}

func round12CancelTrimPreviewGuard(hwnd uintptr) {
	value, ok := round12TrimPreviewStates.LoadAndDelete(hwnd)
	if !ok {
		return
	}
	state := value.(*round12TrimPreviewGuardState)
	state.mu.Lock()
	if state.cancel != nil {
		state.cancel()
		state.cancel = nil
	}
	state.generation++
	state.mu.Unlock()
}

func round12GenerateRecoveredPreview(parent context.Context, ffmpeg, input, output string, at, duration, fps float64, rotation string) error {
	if fps < 1 {
		fps = 25
	}
	step := 1 / fps
	if step < 0.04 {
		step = 0.04
	}
	safeAt := at
	if safeAt < 0 {
		safeAt = 0
	}
	if duration > 0 && safeAt >= duration-step/2 {
		safeAt = duration - step
		if safeAt < 0 {
			safeAt = 0
		}
	}

	attempts := []struct {
		at       float64
		accurate bool
		fromEnd  bool
	}{
		{at: safeAt},
		{at: safeAt, accurate: true},
		{at: maxFloat64(0, safeAt-maxFloat64(0.25, step*2))},
	}
	if duration > 0 && at >= duration-step*2 {
		attempts = append(attempts, struct {
			at       float64
			accurate bool
			fromEnd  bool
		}{fromEnd: true})
	}

	var lastErr error
	for _, attempt := range attempts {
		_ = os.Remove(output)
		ctx, cancel := context.WithTimeout(parent, 10*time.Second)
		err := round12RunPreviewAttempt(ctx, ffmpeg, input, output, attempt.at, rotation, attempt.accurate, attempt.fromEnd)
		cancel()
		if err == nil {
			if info, statErr := os.Stat(output); statErr == nil && info.Size() > 1024 {
				return nil
			}
			err = fmt.Errorf("FFmpeg returned success without a usable preview frame")
		}
		lastErr = err
		if parent.Err() != nil {
			return parent.Err()
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no preview recovery attempt completed")
	}
	return lastErr
}

func round12RunPreviewAttempt(ctx context.Context, ffmpeg, input, output string, at float64, rotation string, accurate, fromEnd bool) error {
	args := []string{"-hide_banner", "-loglevel", "error", "-y"}
	if fromEnd {
		args = append(args, "-sseof", "-0.200")
	} else if !accurate {
		args = append(args, "-ss", fmt.Sprintf("%.3f", at))
	}
	if rotation != "自动" {
		args = append(args, "-noautorotate")
	}
	args = append(args, "-i", input)
	if accurate && !fromEnd {
		args = append(args, "-ss", fmt.Sprintf("%.3f", at))
	}
	args = append(args, "-frames:v", "1")
	filters := round12PreviewFilters(rotation)
	if filters != "" {
		args = append(args, "-vf", filters)
	}
	args = append(args, output)
	cmd := exec.CommandContext(ctx, ffmpeg, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: round12CreateNoWindow}
	outputBytes, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}
	message := strings.TrimSpace(string(outputBytes))
	if len(message) > 900 {
		message = message[len(message)-900:]
	}
	if message == "" {
		message = err.Error()
	}
	return fmt.Errorf("preview seek failed: %s", message)
}

func round12PreviewFilters(rotation string) string {
	filters := make([]string, 0, 2)
	switch rotation {
	case "90°右转":
		filters = append(filters, "transpose=1")
	case "90°左转":
		filters = append(filters, "transpose=2")
	case "180°":
		filters = append(filters, "hflip,vflip")
	case "左右翻转":
		filters = append(filters, "hflip")
	case "上下翻转":
		filters = append(filters, "vflip")
	}
	filters = append(filters, "scale='min(iw,960)':'min(ih,680)':force_original_aspect_ratio=decrease:flags=lanczos")
	return strings.Join(filters, ",")
}

func maxFloat64(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

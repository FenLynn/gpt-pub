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
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/model"
)

const (
	round12EventObjectCreate    = 0x8000
	round12EventObjectShow      = 0x8002
	round12WinEventOutOfContext = 0x0000
	round12CreateNoWindow       = 0x08000000
)

type round12TrimPreviewGuardState struct {
	mu         sync.Mutex
	stopped    atomic.Bool
	generation int64
	lastSeq    int64
	ownSeq     int64
	cancel     context.CancelFunc
}

var (
	round12TrimPreviewEventHook uintptr
	round12TrimPreviewHookMu    sync.Mutex
	round12TrimPreviewStates    sync.Map
	round12TrimPreviewEventCB   uintptr
	round12SetWinEventHook      = user32.NewProc("SetWinEventHook")
	round12UnhookWinEvent       = user32.NewProc("UnhookWinEvent")
)

func init() {
	round12TrimPreviewEventCB = syscall.NewCallback(round12TrimPreviewEventProc)
}

func round12ArmTrimPreviewHook() {
	round12TrimPreviewHookMu.Lock()
	if round12TrimPreviewEventHook == 0 {
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
	round12TrimPreviewHookMu.Unlock()

	// Keep a bounded fallback install loop because the inherited Round7 editor
	// also uses a WinEvent hook. All editor inspection remains on the UI thread.
	a := app
	if a == nil {
		return
	}
	done := &atomic.Bool{}
	go func() {
		for attempt := 0; attempt < 240 && !done.Load(); attempt++ {
			a.postUI(func() {
				if done.Load() {
					return
				}
				e := round7ActiveEditor
				if e != nil && e.hwnd != 0 && e.dialog != nil && e.dialog.hCanvas != 0 {
					round12InstallTrimPreviewWatcher(e)
					done.Store(true)
				}
			})
			time.Sleep(50 * time.Millisecond)
		}
	}()
}

func round12TrimPreviewEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	e := round7ActiveEditor
	if e == nil || e.hwnd == 0 || e.dialog == nil || e.dialog.hCanvas == 0 {
		return 0
	}
	round12InstallTrimPreviewWatcher(e)
	return 0
}

func round12InstallTrimPreviewWatcher(e *round7Editor) {
	if e == nil || e.hwnd == 0 || e.owner == nil || e.dialog == nil || e.dialog.task == nil || e.dialog.task.Kind != model.KindVideo {
		return
	}
	d := e.dialog
	state := &round12TrimPreviewGuardState{lastSeq: d.previewSeq.Load()}
	actual, loaded := round12TrimPreviewStates.LoadOrStore(e.hwnd, state)
	if loaded {
		_ = actual
		return
	}

	round12TrimPreviewHookMu.Lock()
	if round12TrimPreviewEventHook != 0 {
		round12UnhookWinEvent.Call(round12TrimPreviewEventHook)
		round12TrimPreviewEventHook = 0
	}
	round12TrimPreviewHookMu.Unlock()

	// If installation happens before the inherited initial frame has become a
	// usable bitmap, take ownership immediately. Otherwise keep the valid first
	// frame and take over only subsequent previewSeq changes.
	if d.bitmap == 0 || round12TrimPreviewHasFailure(d) {
		round12TakeOverTrimPreview(e, state)
	}

	go func() {
		ticker := time.NewTicker(50 * time.Millisecond)
		defer ticker.Stop()
		for range ticker.C {
			if state.stopped.Load() {
				return
			}
			e.owner.postUI(func() {
				round12PollTrimPreview(e, state)
			})
		}
	}()
}

func round12PollTrimPreview(e *round7Editor, state *round12TrimPreviewGuardState) {
	if e == nil || state == nil || state.stopped.Load() || e.dialog == nil || e.done || e.dialog.closed.Load() || round7ActiveEditor != e {
		if e != nil {
			round12StopTrimPreviewWatcher(e.hwnd)
		}
		return
	}
	seq := e.dialog.previewSeq.Load()

	state.mu.Lock()
	lastSeq := state.lastSeq
	ownSeq := state.ownSeq
	state.mu.Unlock()

	if seq == lastSeq || (ownSeq != 0 && seq == ownSeq) {
		return
	}

	// Any external sequence change is a new user preview request. Take ownership
	// immediately instead of waiting for the inherited fast-seek worker to fail.
	// Incrementing previewSeq inside takeover invalidates that inherited worker's
	// callback, so only the robust Round12 frame can become visible.
	round12TakeOverTrimPreview(e, state)
}

func round12TrimPreviewHasFailure(d *trimDialog) bool {
	if d == nil {
		return false
	}
	info := getText(d.hInfo)
	return strings.Contains(info, "预览帧生成失败") ||
		strings.Contains(info, "预览帧加载失败") ||
		strings.Contains(info, "预览帧自动恢复失败") ||
		strings.Contains(info, "预览帧自动恢复后加载失败")
}

func round12TakeOverTrimPreview(e *round7Editor, state *round12TrimPreviewGuardState) {
	if e == nil || state == nil || state.stopped.Load() || e.dialog == nil || e.dialog.owner == nil || e.dialog.owner.ffmpeg == "" || e.dialog.task == nil {
		return
	}
	d := e.dialog

	state.mu.Lock()
	if state.stopped.Load() {
		state.mu.Unlock()
		return
	}
	if state.cancel != nil {
		state.cancel()
		state.cancel = nil
	}
	state.generation++
	generation := state.generation
	ctx, cancel := context.WithCancel(context.Background())
	state.cancel = cancel
	// This is the core ownership hand-off: the inherited worker carries the
	// previous seq, while Round12 owns a fresh one. Its legacy callback will
	// therefore fail the existing previewSeq equality check and do nothing.
	ownSeq := d.previewSeq.Add(1)
	state.lastSeq = ownSeq
	state.ownSeq = ownSeq
	state.mu.Unlock()

	dir, err := config.TempDir()
	if err != nil {
		cancel()
		round12FinishOwnedPreview(state, generation, ownSeq)
		return
	}
	out := filepath.Join(dir, fmt.Sprintf("trim_frame_round12_%d_%d.bmp", d.task.ID, ownSeq))
	input := d.task.Input
	at := d.currentAt
	duration := d.task.Duration
	fps := d.safeFPS()
	rotation := d.opts.Rotation
	ffmpeg := d.owner.ffmpeg
	setText(d.hInfo, "正在更新预览帧…")
	setText(e.hInstruction, "正在更新当前位置预览…")

	go func() {
		err := round12GenerateRecoveredPreview(ctx, ffmpeg, input, out, at, duration, fps, rotation)
		e.owner.postUI(func() {
			defer os.Remove(out)
			cancel()
			if !round12OwnedPreviewCurrent(state, generation, ownSeq) || round7ActiveEditor != e || d.closed.Load() || d.previewSeq.Load() != ownSeq {
				return
			}
			if err != nil {
				round12FinishOwnedPreview(state, generation, ownSeq)
				setText(d.hInfo, "预览帧生成失败："+short(err.Error(), 220))
				setText(e.hInstruction, "当前位置预览失败；移动时间后将重新取帧。")
				return
			}
			h, _, _ := procLoadImageW.Call(0, uintptr(unsafe.Pointer(p(out))), IMAGE_BITMAP, 0, 0, LR_LOADFROMFILE|LR_CREATEDIBSECTION)
			if h == 0 {
				round12FinishOwnedPreview(state, generation, ownSeq)
				setText(d.hInfo, "预览帧加载失败。")
				setText(e.hInstruction, "当前位置预览失败；移动时间后将重新取帧。")
				return
			}
			if d.bitmap != 0 {
				procDeleteObject.Call(d.bitmap)
			}
			d.bitmap = h
			var bm bitmapInfo
			procGetObjectW.Call(h, unsafe.Sizeof(bm), uintptr(unsafe.Pointer(&bm)))
			d.bitmapW, d.bitmapH = bm.Width, bm.Height
			round12FinishOwnedPreview(state, generation, ownSeq)
			e.updateInfo()
			setText(e.hInstruction, "拖动红色游标预览画面；拖动蓝色旗标调整剪辑范围。")
			procInvalidateRect.Call(d.hCanvas, 0, 1)
		})
	}()
}

func round12OwnedPreviewCurrent(state *round12TrimPreviewGuardState, generation, ownSeq int64) bool {
	if state == nil || state.stopped.Load() {
		return false
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	return state.generation == generation && state.ownSeq == ownSeq
}

func round12FinishOwnedPreview(state *round12TrimPreviewGuardState, generation, ownSeq int64) {
	if state == nil {
		return
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.generation != generation || state.ownSeq != ownSeq {
		return
	}
	state.cancel = nil
	state.ownSeq = 0
	state.lastSeq = ownSeq
}

func round12StopTrimPreviewWatcher(hwnd uintptr) {
	value, ok := round12TrimPreviewStates.LoadAndDelete(hwnd)
	if !ok {
		return
	}
	state := value.(*round12TrimPreviewGuardState)
	if !state.stopped.CompareAndSwap(false, true) {
		return
	}
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
	if filters := round12PreviewFilters(rotation); filters != "" {
		args = append(args, "-vf", filters)
	}
	args = append(args, "-c:v", "bmp", "-pix_fmt", "bgr24", output)
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

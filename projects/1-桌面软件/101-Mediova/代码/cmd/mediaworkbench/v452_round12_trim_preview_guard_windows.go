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
	mu              sync.Mutex
	stopped         atomic.Bool
	generation      int64
	lastSeq         int64
	originSeq       int64
	ownSeq          int64
	attemptedOrigin int64
	bitmapAtRequest uintptr
	deadline        time.Time
	settled         bool
	cancel          context.CancelFunc
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

	// WinEvent delivery is normally immediate, but do not make reliability
	// depend on callback ordering between the inherited Round7 editor hook and
	// this Round12 hook. Probe from a helper goroutine while all actual editor
	// reads/install work remains marshalled onto the UI thread.
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
	state := &round12TrimPreviewGuardState{
		lastSeq:         d.previewSeq.Load(),
		originSeq:       d.previewSeq.Load(),
		bitmapAtRequest: d.bitmap,
		deadline:        time.Now().Add(2500 * time.Millisecond),
		settled:         d.bitmap != 0 && !round12TrimPreviewHasFailure(d),
	}
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

	go func() {
		ticker := time.NewTicker(150 * time.Millisecond)
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
	d := e.dialog
	seq := d.previewSeq.Load()
	now := time.Now()

	state.mu.Lock()
	if seq != state.lastSeq {
		if state.ownSeq != 0 && seq == state.ownSeq {
			state.lastSeq = seq
		} else {
			if state.cancel != nil {
				state.cancel()
				state.cancel = nil
			}
			state.generation++
			state.lastSeq = seq
			state.originSeq = seq
			state.ownSeq = 0
			state.attemptedOrigin = 0
			state.bitmapAtRequest = d.bitmap
			state.deadline = now.Add(2500 * time.Millisecond)
			state.settled = false
		}
	}
	origin := state.originSeq
	ownSeq := state.ownSeq
	attempted := state.attemptedOrigin
	bitmapAtRequest := state.bitmapAtRequest
	deadline := state.deadline
	settled := state.settled
	state.mu.Unlock()

	failure := round12TrimPreviewHasFailure(d)
	if settled {
		// The inherited preview worker writes an error into hInfo but does not
		// clear an older error after a later usable bitmap becomes current.
		// A settled request with a valid bitmap must therefore reconcile the
		// visible status back to the normal information card.
		if failure && d.bitmap != 0 {
			e.updateInfo()
			setText(e.hInstruction, "拖动红色游标预览画面；拖动蓝色旗标调整剪辑范围。")
		}
		return
	}
	if ownSeq != 0 {
		return
	}

	// A new bitmap is the strongest normal-path success signal. Also clear
	// stale failure text left by an earlier request.
	if d.bitmap != 0 && d.bitmap != bitmapAtRequest {
		state.mu.Lock()
		if state.originSeq == origin && state.ownSeq == 0 {
			state.settled = true
		}
		state.mu.Unlock()
		if failure {
			e.updateInfo()
			setText(e.hInstruction, "拖动红色游标预览画面；拖动蓝色旗标调整剪辑范围。")
		}
		return
	}

	if attempted == origin {
		return
	}
	if failure || (!deadline.IsZero() && !now.Before(deadline)) {
		round12StartTrimPreviewRecovery(e, state, origin)
	}
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

func round12StartTrimPreviewRecovery(e *round7Editor, state *round12TrimPreviewGuardState, origin int64) {
	d := e.dialog
	if d == nil || d.owner == nil || d.owner.ffmpeg == "" || d.task == nil {
		return
	}
	state.mu.Lock()
	if state.stopped.Load() || state.originSeq != origin || state.ownSeq != 0 || state.attemptedOrigin == origin {
		state.mu.Unlock()
		return
	}
	if state.cancel != nil {
		state.cancel()
	}
	state.generation++
	generation := state.generation
	state.attemptedOrigin = origin
	ctx, cancel := context.WithCancel(context.Background())
	state.cancel = cancel
	seq := d.previewSeq.Add(1) // invalidate failed/stale legacy worker result
	state.ownSeq = seq
	state.lastSeq = seq
	state.mu.Unlock()

	dir, err := config.TempDir()
	if err != nil {
		cancel()
		state.mu.Lock()
		if state.generation == generation && state.ownSeq == seq {
			state.cancel = nil
			state.ownSeq = 0
			state.settled = false
		}
		state.mu.Unlock()
		return
	}
	out := filepath.Join(dir, fmt.Sprintf("trim_frame_recovery_%d_%d.bmp", d.task.ID, seq))
	input := d.task.Input
	at := d.currentAt
	duration := d.task.Duration
	fps := d.safeFPS()
	rotation := d.opts.Rotation
	ffmpeg := d.owner.ffmpeg
	// Replace the stale inherited error immediately with an explicit transient
	// recovery state. Only a successfully loaded replacement bitmap can mark
	// this request settled.
	setText(d.hInfo, "预览帧异常，正在自动恢复…")
	setText(e.hInstruction, "预览取帧失败，正在自动恢复…")

	go func() {
		err := round12GenerateRecoveredPreview(ctx, ffmpeg, input, out, at, duration, fps, rotation)
		e.owner.postUI(func() {
			defer os.Remove(out)
			cancel()
			state.mu.Lock()
			current := !state.stopped.Load() && state.generation == generation && state.ownSeq == seq
			if current {
				state.cancel = nil
			}
			state.mu.Unlock()
			if !current || round7ActiveEditor != e || d.closed.Load() || d.previewSeq.Load() != seq {
				return
			}
			if err != nil {
				state.mu.Lock()
				if state.generation == generation && state.ownSeq == seq {
					state.ownSeq = 0
					state.settled = false
				}
				state.mu.Unlock()
				setText(d.hInfo, "预览帧自动恢复失败："+short(err.Error(), 220))
				setText(e.hInstruction, "预览取帧失败；移动当前时间后将自动重试。")
				return
			}
			h, _, _ := procLoadImageW.Call(0, uintptr(unsafe.Pointer(p(out))), IMAGE_BITMAP, 0, 0, LR_LOADFROMFILE|LR_CREATEDIBSECTION)
			if h == 0 {
				state.mu.Lock()
				if state.generation == generation && state.ownSeq == seq {
					state.ownSeq = 0
					state.settled = false
				}
				state.mu.Unlock()
				setText(d.hInfo, "预览帧自动恢复后加载失败。")
				setText(e.hInstruction, "预览取帧失败；移动当前时间后将自动重试。")
				return
			}
			if d.bitmap != 0 {
				procDeleteObject.Call(d.bitmap)
			}
			d.bitmap = h
			var bm bitmapInfo
			procGetObjectW.Call(h, unsafe.Sizeof(bm), uintptr(unsafe.Pointer(&bm)))
			d.bitmapW, d.bitmapH = bm.Width, bm.Height
			state.mu.Lock()
			if state.generation == generation && state.ownSeq == seq {
				state.ownSeq = 0
				state.settled = true
			}
			state.mu.Unlock()
			e.updateInfo()
			setText(e.hInstruction, "预览已自动恢复；拖动红色游标继续预览画面。")
			procInvalidateRect.Call(d.hCanvas, 0, 1)
		})
	}()
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
	// Force a Windows LoadImage-compatible BMP rather than accepting whatever
	// pixel format the current FFmpeg build chooses for a .bmp extension.
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

//go:build windows

package main

import (
	"context"
	"fmt"
	"math"
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
	targetAt   float64
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

// round12ArmTrimPreviewHook only discovers the final Round7 editor. It never
// subclasses navigation messages. Round7 remains the single input owner and
// advances trimDialog.previewSeq for every real preview request; Round12 only
// observes that monotonic request fact and replaces the inherited fast-seek
// worker with one cancellable robust request.
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
	// WinEvent callbacks are out-of-context and can arrive on a worker thread.
	// Never read mutable dialog state or install preview ownership from that
	// callback. Marshal discovery back to the application's UI thread so the
	// watcher observes currentAt/bitmap/previewSeq as one coherent UI state.
	a := app
	if a == nil {
		return 0
	}
	a.postUI(func() {
		e := round7ActiveEditor
		if e == nil || e.hwnd == 0 || e.dialog == nil || e.dialog.hCanvas == 0 {
			return
		}
		round12InstallTrimPreviewWatcher(e)
	})
	return 0
}

func round12InstallTrimPreviewWatcher(e *round7Editor) {
	if e == nil || e.hwnd == 0 || e.owner == nil || e.dialog == nil || e.dialog.task == nil || e.dialog.task.Kind != model.KindVideo {
		return
	}
	d := e.dialog
	candidate := &round12TrimPreviewGuardState{lastSeq: d.previewSeq.Load(), targetAt: d.currentAt}
	actual, loaded := round12TrimPreviewStates.LoadOrStore(e.hwnd, candidate)
	state := actual.(*round12TrimPreviewGuardState)
	if loaded {
		return
	}

	round12TrimPreviewHookMu.Lock()
	if round12TrimPreviewEventHook != 0 {
		round12UnhookWinEvent.Call(round12TrimPreviewEventHook)
		round12TrimPreviewEventHook = 0
	}
	round12TrimPreviewHookMu.Unlock()

	// Always establish Round12 ownership for the current target when the watcher
	// is first installed. The old conditional could adopt an in-flight legacy
	// previewSeq as "already seen" while a usable bitmap from the previous target
	// remained on screen. If that exact-end worker then produced no new frame,
	// no later sequence change existed for the watcher to notice. One immediate
	// takeover closes that installation window and invalidates any inherited
	// worker deterministically.
	round12TakeOverTrimPreview(e, state, d.currentAt)

	// Poll only the atomic request sequence off the UI thread. A UI callback is
	// posted solely when the sequence actually changes, so an idle editor has no
	// 20 Hz UI churn. Closing the dialog cancels the active FFmpeg immediately.
	go func(hwnd uintptr, dialog *trimDialog) {
		ticker := time.NewTicker(50 * time.Millisecond)
		defer ticker.Stop()
		for range ticker.C {
			if state.stopped.Load() {
				return
			}
			if dialog == nil || dialog.closed.Load() {
				round12StopTrimPreviewWatcher(hwnd)
				return
			}
			seq := dialog.previewSeq.Load()
			state.mu.Lock()
			lastSeq := state.lastSeq
			ownSeq := state.ownSeq
			state.mu.Unlock()
			if seq == lastSeq || (ownSeq != 0 && seq == ownSeq) {
				continue
			}
			e.owner.postUI(func() { round12PollTrimPreview(e, state) })
		}
	}(e.hwnd, d)
}

func round12TrimPreviewCommandChangesFrame(id int) bool {
	switch id {
	case IDC_JUMP_TIME, IDC_SEEK_MINUS_SEC, IDC_SEEK_PLUS_SEC, IDC_SEEK_MINUS_FRAME, IDC_SEEK_PLUS_FRAME:
		return true
	default:
		return false
	}
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
	state.mu.Lock()
	lastSeq := state.lastSeq
	ownSeq := state.ownSeq
	state.mu.Unlock()
	if seq == lastSeq || (ownSeq != 0 && seq == ownSeq) {
		return
	}
	round12TakeOverTrimPreview(e, state, d.currentAt)
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

func round12TakeOverTrimPreview(e *round7Editor, state *round12TrimPreviewGuardState, targetAt float64) {
	if e == nil || state == nil || state.stopped.Load() || e.dialog == nil || e.dialog.owner == nil || e.dialog.owner.ffmpeg == "" || e.dialog.task == nil {
		return
	}
	d := e.dialog
	if targetAt < 0 {
		targetAt = 0
	}
	if d.task.Duration > 0 && targetAt > d.task.Duration {
		targetAt = d.task.Duration
	}

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
	// Supersede the inherited fast-seek worker by advancing the same sequence
	// it already checks before installing its bitmap. From this point there is
	// exactly one accepted request generation for targetAt.
	ownSeq := d.previewSeq.Add(1)
	state.lastSeq = ownSeq
	state.ownSeq = ownSeq
	state.targetAt = targetAt
	state.mu.Unlock()

	dir, err := config.TempDir()
	if err != nil {
		cancel()
		round12FinishOwnedPreview(state, generation, ownSeq)
		return
	}
	out := filepath.Join(dir, fmt.Sprintf("trim_frame_round12_%d_%d.bmp", d.task.ID, ownSeq))
	input := d.task.Input
	duration := d.task.Duration
	fps := d.safeFPS()
	rotation := d.opts.Rotation
	ffmpeg := d.owner.ffmpeg
	setText(d.hInfo, "正在更新预览帧…")
	if e.hInstruction != 0 {
		setText(e.hInstruction, "正在更新当前位置预览…")
	}

	go func() {
		err := round12GenerateRecoveredPreview(ctx, ffmpeg, input, out, targetAt, duration, fps, rotation)
		e.owner.postUI(func() {
			defer os.Remove(out)
			cancel()
			if !round12OwnedPreviewCurrent(state, generation, ownSeq, targetAt) || round7ActiveEditor != e || d.closed.Load() || d.previewSeq.Load() != ownSeq || math.Abs(d.currentAt-targetAt) > 1e-6 {
				return
			}
			if err != nil {
				round12FinishOwnedPreview(state, generation, ownSeq)
				setText(d.hInfo, "预览帧生成失败："+short(err.Error(), 220))
				if e.hInstruction != 0 {
					setText(e.hInstruction, "当前位置预览失败；移动时间后将重新取帧。")
				}
				return
			}
			h, _, _ := procLoadImageW.Call(0, uintptr(unsafe.Pointer(p(out))), IMAGE_BITMAP, 0, 0, LR_LOADFROMFILE|LR_CREATEDIBSECTION)
			if h == 0 {
				round12FinishOwnedPreview(state, generation, ownSeq)
				setText(d.hInfo, "预览帧加载失败。")
				if e.hInstruction != 0 {
					setText(e.hInstruction, "当前位置预览失败；移动时间后将重新取帧。")
				}
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
			if e.hInstruction != 0 {
				setText(e.hInstruction, "拖动红色游标预览画面；拖动蓝色旗标调整剪辑范围。")
			}
			procInvalidateRect.Call(d.hCanvas, 0, 1)
		})
	}()
}

func round12OwnedPreviewCurrent(state *round12TrimPreviewGuardState, generation, ownSeq int64, targetAt float64) bool {
	if state == nil || state.stopped.Load() {
		return false
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	return state.generation == generation && state.ownSeq == ownSeq && math.Abs(state.targetAt-targetAt) <= 1e-6
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
	if step < 1.0/240.0 {
		step = 1.0 / 240.0
	}
	if step > 0.25 {
		step = 0.25
	}
	safeAt := at
	if safeAt < 0 {
		safeAt = 0
	}
	if duration > 0 {
		lastFrame := duration - step
		if lastFrame < 0 {
			lastFrame = 0
		}
		if safeAt > lastFrame {
			safeAt = lastFrame
		}
	}

	type previewAttempt struct {
		at       float64
		accurate bool
	}
	attempts := []previewAttempt{{at: safeAt}, {at: safeAt, accurate: true}}
	if safeAt > 0 {
		back := safeAt - step
		if back < 0 {
			back = 0
		}
		if math.Abs(back-safeAt) > 1e-9 {
			attempts = append(attempts, previewAttempt{at: back, accurate: true})
		}
	}

	var lastErr error
	for _, attempt := range attempts {
		_ = os.Remove(output)
		ctx, cancel := context.WithTimeout(parent, 10*time.Second)
		err := round12RunPreviewAttempt(ctx, ffmpeg, input, output, attempt.at, rotation, attempt.accurate)
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

func round12RunPreviewAttempt(ctx context.Context, ffmpeg, input, output string, at float64, rotation string, accurate bool) error {
	args := []string{"-hide_banner", "-loglevel", "error", "-y"}
	if !accurate {
		args = append(args, "-ss", fmt.Sprintf("%.3f", at))
	}
	if rotation != "自动" {
		args = append(args, "-noautorotate")
	}
	args = append(args, "-i", input)
	if accurate {
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

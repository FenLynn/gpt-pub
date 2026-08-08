//go:build windows

package main

import (
	"context"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/model"
)

const (
	round12TrimPreviewOwnerEditorSubclassID   = 0x45D2
	round12TrimPreviewOwnerTimelineSubclassID = 0x45D3
)

type round12TrimPreviewOwnerState struct {
	mu         sync.Mutex
	stopped    atomic.Bool
	generation int64
	seq        int64
	targetAt   float64
	cancel     context.CancelFunc
}

var (
	round12TrimPreviewOwnerHook       uintptr
	round12TrimPreviewOwnerHookMu     sync.Mutex
	round12TrimPreviewOwnerEventCB    uintptr
	round12TrimPreviewOwnerEditorCB   uintptr
	round12TrimPreviewOwnerTimelineCB uintptr
	round12TrimPreviewOwnerPending    sync.Map
	round12TrimPreviewOwnerStates     sync.Map
)

func init() {
	round12TrimPreviewOwnerEventCB = syscall.NewCallback(round12TrimPreviewOwnerEventProc)
	round12TrimPreviewOwnerEditorCB = syscall.NewCallback(round12TrimPreviewOwnerEditorSubclassProc)
	round12TrimPreviewOwnerTimelineCB = syscall.NewCallback(round12TrimPreviewOwnerTimelineSubclassProc)
	round12TrimPreviewOwnerHookMu.Lock()
	if round12TrimPreviewOwnerHook == 0 {
		hook, _, _ := round12SetWinEventHook.Call(
			round12EventObjectCreate,
			round12EventObjectShow,
			0,
			round12TrimPreviewOwnerEventCB,
			0,
			0,
			round12WinEventOutOfContext,
		)
		round12TrimPreviewOwnerHook = hook
	}
	round12TrimPreviewOwnerHookMu.Unlock()
}

func round12TrimPreviewOwnerEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	e := round7ActiveEditor
	if e == nil || e.hwnd == 0 || e.owner == nil || e.dialog == nil || e.dialog.task == nil || e.dialog.task.Kind != model.KindVideo {
		return 0
	}
	if _, installed := round12TrimPreviewOwnerStates.Load(e.hwnd); installed {
		return 0
	}
	round12ScheduleExclusiveTrimPreviewOwner(e)
	return 0
}

func round12ScheduleExclusiveTrimPreviewOwner(e *round7Editor) {
	if e == nil || e.hwnd == 0 || e.owner == nil {
		return
	}
	key := e.hwnd
	if _, installed := round12TrimPreviewOwnerStates.Load(key); installed {
		return
	}
	if _, loaded := round12TrimPreviewOwnerPending.LoadOrStore(key, struct{}{}); loaded {
		return
	}
	go func() {
		defer round12TrimPreviewOwnerPending.Delete(key)
		for attempt := 0; attempt < 280; attempt++ {
			if e.owner == nil {
				return
			}
			e.owner.postUI(func() {
				if round7ActiveEditor != e || e.done || e.hwnd == 0 || e.dialog == nil || e.dialog.closed.Load() {
					return
				}
				round12InstallExclusiveTrimPreviewOwner(e)
			})
			time.Sleep(50 * time.Millisecond)
			if _, installed := round12TrimPreviewOwnerStates.Load(key); installed {
				return
			}
			if e.dialog == nil || e.dialog.closed.Load() {
				return
			}
		}
	}()
}

func round12InstallExclusiveTrimPreviewOwner(e *round7Editor) {
	if e == nil || e.hwnd == 0 || e.dialog == nil || e.dialog.hCanvas == 0 || e.hTimeline == 0 || e.dialog.task == nil || e.dialog.task.Kind != model.KindVideo {
		return
	}

	// Retire the previous "run legacy first, invalidate afterwards" bridge.
	// Navigation below is intercepted before the inherited handler, so no
	// competing legacy FFmpeg worker is created for the same seek operation.
	round12StopTrimPreviewWatcher(e.hwnd)
	v452RemoveSubclass.Call(e.hwnd, round12TrimPreviewEditorCB, round12TrimPreviewEditorSubclassID)

	candidate := &round12TrimPreviewOwnerState{}
	actual, loaded := round12TrimPreviewOwnerStates.LoadOrStore(e.hwnd, candidate)
	state := actual.(*round12TrimPreviewOwnerState)
	if state.stopped.Load() {
		round12TrimPreviewOwnerStates.Delete(e.hwnd)
		actual, _ = round12TrimPreviewOwnerStates.LoadOrStore(e.hwnd, &round12TrimPreviewOwnerState{})
		state = actual.(*round12TrimPreviewOwnerState)
		loaded = false
	}

	v452SetWindowSubclass.Call(e.hwnd, round12TrimPreviewOwnerEditorCB, round12TrimPreviewOwnerEditorSubclassID, 0)
	v452SetWindowSubclass.Call(e.hTimeline, round12TrimPreviewOwnerTimelineCB, round12TrimPreviewOwnerTimelineSubclassID, 0)

	if !loaded && (e.dialog.bitmap == 0 || round12TrimPreviewHasFailure(e.dialog)) {
		round12RequestExclusiveTrimPreview(e, state)
	}
}

func round12TrimPreviewOwnerEditorSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	e := round7ActiveEditor
	if e != nil && e.hwnd == hwnd {
		switch message {
		case WM_COMMAND:
			id := int(loWord(wParam))
			if round12TrimPreviewCommandChangesFrame(id) {
				round12HandleExclusiveTrimPreviewCommand(e, id)
				return 0
			}
		case WM_KEYDOWN:
			if int(wParam) == 0x25 || int(wParam) == 0x27 {
				round12HandleExclusiveTrimPreviewKey(e, int(wParam))
				return 0
			}
		case v452WMNCDestroy:
			round12StopExclusiveTrimPreviewOwner(hwnd, e.hTimeline)
			v452RemoveSubclass.Call(hwnd, round12TrimPreviewOwnerEditorCB, subclassID)
		}
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round12TrimPreviewOwnerTimelineSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	e := round7ActiveEditor
	if e != nil && e.hTimeline == hwnd {
		switch message {
		case WM_LBUTTONUP:
			if e.drag != round7DragNone {
				pt := mousePoint(lParam)
				drag := e.drag
				e.updateTimelineDrag(int(pt.X), true)
				e.drag = round7DragNone
				procReleaseCapture.Call()
				if drag == round7DragCurrent {
					e.lastPreviewAt = time.Now()
					round12RequestExclusiveTrimPreviewForActiveEditor(e)
				}
				return 0
			}
		case v452WMNCDestroy:
			v452RemoveSubclass.Call(hwnd, round12TrimPreviewOwnerTimelineCB, subclassID)
		}
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round12HandleExclusiveTrimPreviewCommand(e *round7Editor, id int) {
	if e == nil || e.dialog == nil || e.dialog.task == nil || e.dialog.task.Kind != model.KindVideo {
		return
	}
	d := e.dialog
	value := d.currentAt
	switch id {
	case IDC_JUMP_TIME:
		parsed, err := parseTimeValue(getText(d.hNow))
		if err != nil {
			messageBox(e.hwnd, "当前时间", "无法识别当前时间。", MB_OK|MB_ICONERROR)
			return
		}
		value = parsed
	case IDC_SEEK_MINUS_SEC:
		value -= 1
	case IDC_SEEK_PLUS_SEC:
		value += 1
	case IDC_SEEK_MINUS_FRAME:
		value -= 1 / d.safeFPS()
	case IDC_SEEK_PLUS_FRAME:
		value += 1 / d.safeFPS()
	default:
		return
	}
	round12SetExclusiveTrimPreviewCurrent(e, value)
}

func round12HandleExclusiveTrimPreviewKey(e *round7Editor, key int) {
	if e == nil || e.dialog == nil || e.dialog.task == nil || e.dialog.task.Kind != model.KindVideo {
		return
	}
	shiftState, _, _ := procGetKeyState.Call(0x10)
	shifted := int16(shiftState&0xffff) < 0
	step := 1 / e.dialog.safeFPS()
	if shifted {
		step = 1
	}
	if key == 0x25 {
		step = -step
	}
	round12SetExclusiveTrimPreviewCurrent(e, e.dialog.currentAt+step)
}

func round12SetExclusiveTrimPreviewCurrent(e *round7Editor, value float64) {
	if e == nil || e.dialog == nil || e.dialog.task == nil {
		return
	}
	d := e.dialog
	if value < 0 {
		value = 0
	}
	if value > d.task.Duration {
		value = d.task.Duration
	}
	d.currentAt = value
	e.withUpdate(func() { setText(d.hNow, formatSecondsClock(value)) })
	procInvalidateRect.Call(e.hTimeline, 0, 1)
	e.lastPreviewAt = time.Now()
	round12RequestExclusiveTrimPreviewForActiveEditor(e)
}

func round12RequestExclusiveTrimPreviewForActiveEditor(e *round7Editor) {
	if e == nil || e.hwnd == 0 {
		return
	}
	value, ok := round12TrimPreviewOwnerStates.Load(e.hwnd)
	if !ok {
		round12InstallExclusiveTrimPreviewOwner(e)
		value, ok = round12TrimPreviewOwnerStates.Load(e.hwnd)
	}
	if !ok {
		return
	}
	round12RequestExclusiveTrimPreview(e, value.(*round12TrimPreviewOwnerState))
}

func round12RequestExclusiveTrimPreview(e *round7Editor, state *round12TrimPreviewOwnerState) {
	if e == nil || state == nil || state.stopped.Load() || e.dialog == nil || e.dialog.owner == nil || e.dialog.owner.ffmpeg == "" || e.dialog.task == nil {
		return
	}
	d := e.dialog
	requestedAt := d.currentAt

	state.mu.Lock()
	if state.stopped.Load() {
		state.mu.Unlock()
		return
	}
	if state.cancel != nil {
		state.cancel()
	}
	state.generation++
	generation := state.generation
	ctx, cancel := context.WithCancel(context.Background())
	state.cancel = cancel
	seq := d.previewSeq.Add(1)
	state.seq = seq
	state.targetAt = requestedAt
	state.mu.Unlock()

	dir, err := config.TempDir()
	if err != nil {
		cancel()
		round12FinishExclusiveTrimPreview(state, generation, seq)
		return
	}
	out := filepath.Join(dir, fmt.Sprintf("trim_frame_round12_owner_%d_%d.bmp", d.task.ID, seq))
	input := d.task.Input
	duration := d.task.Duration
	fps := d.safeFPS()
	rotation := d.opts.Rotation
	ffmpeg := d.owner.ffmpeg
	setText(d.hInfo, "正在更新预览帧…")
	setText(e.hInstruction, "正在更新当前位置预览…")

	go func() {
		err := round12GenerateExclusiveTrimPreview(ctx, ffmpeg, input, out, requestedAt, duration, fps, rotation)
		e.owner.postUI(func() {
			defer os.Remove(out)
			cancel()
			if !round12ExclusiveTrimPreviewCurrent(state, generation, seq, requestedAt) || round7ActiveEditor != e || d.closed.Load() || d.previewSeq.Load() != seq || math.Abs(d.currentAt-requestedAt) > 1e-6 {
				return
			}
			if err != nil {
				round12FinishExclusiveTrimPreview(state, generation, seq)
				setText(d.hInfo, "预览帧生成失败："+short(err.Error(), 220))
				setText(e.hInstruction, "当前位置预览失败；移动时间后将重新取帧。")
				return
			}
			h, _, _ := procLoadImageW.Call(0, uintptr(unsafe.Pointer(p(out))), IMAGE_BITMAP, 0, 0, LR_LOADFROMFILE|LR_CREATEDIBSECTION)
			if h == 0 {
				round12FinishExclusiveTrimPreview(state, generation, seq)
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
			round12FinishExclusiveTrimPreview(state, generation, seq)
			e.updateInfo()
			setText(e.hInstruction, "拖动红色游标预览画面；拖动蓝色旗标调整剪辑范围。")
			procInvalidateRect.Call(d.hCanvas, 0, 1)
		})
	}()
}

func round12ExclusiveTrimPreviewCurrent(state *round12TrimPreviewOwnerState, generation, seq int64, requestedAt float64) bool {
	if state == nil || state.stopped.Load() {
		return false
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	return state.generation == generation && state.seq == seq && math.Abs(state.targetAt-requestedAt) <= 1e-6
}

func round12FinishExclusiveTrimPreview(state *round12TrimPreviewOwnerState, generation, seq int64) {
	if state == nil {
		return
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.generation != generation || state.seq != seq {
		return
	}
	state.cancel = nil
}

func round12StopExclusiveTrimPreviewOwner(hwnd, timeline uintptr) {
	value, ok := round12TrimPreviewOwnerStates.LoadAndDelete(hwnd)
	if ok {
		state := value.(*round12TrimPreviewOwnerState)
		state.stopped.Store(true)
		state.mu.Lock()
		if state.cancel != nil {
			state.cancel()
			state.cancel = nil
		}
		state.generation++
		state.mu.Unlock()
	}
	if timeline != 0 {
		v452RemoveSubclass.Call(timeline, round12TrimPreviewOwnerTimelineCB, round12TrimPreviewOwnerTimelineSubclassID)
	}
}

func round12GenerateExclusiveTrimPreview(parent context.Context, ffmpeg, input, output string, at, duration, fps float64, rotation string) error {
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
		lastEstimate := duration - step
		if lastEstimate < 0 {
			lastEstimate = 0
		}
		if safeAt > lastEstimate {
			safeAt = lastEstimate
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
		err := round12RunPreviewAttempt(ctx, ffmpeg, input, output, attempt.at, rotation, attempt.accurate, false)
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
		lastErr = fmt.Errorf("no preview attempt completed")
	}
	return lastErr
}

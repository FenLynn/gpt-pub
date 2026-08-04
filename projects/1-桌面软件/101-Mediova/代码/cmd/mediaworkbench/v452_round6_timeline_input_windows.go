//go:build windows

package main

import (
	"sync"
	"syscall"

	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

const v452Round6TimelineInputSubclassID = 0x4564

type v452Round6TimelineInputState struct {
	dragging bool
	hit      media.TrimTimelineHit
	initial  media.TrimRangeState
}

var (
	v452Round6TimelineInputEventCB uintptr
	v452Round6TimelineInputCB      uintptr
	v452Round6TimelineInputHook    uintptr
	v452Round6TimelineInputs       sync.Map // map[uintptr]*v452Round6TimelineInputState
	v452Round6TimelineInstalled    sync.Map // map[uintptr]bool
)

func init() {
	v452Round6TimelineInputEventCB = syscall.NewCallback(v452Round6TimelineInputEventProc)
	v452Round6TimelineInputCB = syscall.NewCallback(v452Round6TimelineInputSubclassProc)
	v452Round6TimelineInputHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		v452Round6TimelineInputEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func v452Round6TimelineInputEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	d := activeTrim
	if d == nil || d.hTrack == 0 {
		return 0
	}
	// Ensure the visual layer is present first, then place this input layer at
	// the front of the subclass chain. The older fourth-round range-drag code
	// therefore never receives timeline mouse-down messages.
	v452Round6InstallTrimDialog(d)
	if _, loaded := v452Round6TimelineInstalled.LoadOrStore(d.hTrack, true); !loaded {
		v452SetWindowSubclass.Call(d.hTrack, v452Round6TimelineInputCB, v452Round6TimelineInputSubclassID, 0)
	}
	return 0
}

func v452Round6TimelineInputStateFor(hwnd uintptr) *v452Round6TimelineInputState {
	if value, ok := v452Round6TimelineInputs.Load(hwnd); ok {
		return value.(*v452Round6TimelineInputState)
	}
	state := &v452Round6TimelineInputState{}
	actual, _ := v452Round6TimelineInputs.LoadOrStore(hwnd, state)
	return actual.(*v452Round6TimelineInputState)
}

func v452Round6TimelineInputSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	d := activeTrim
	if d == nil || d.hTrack != hwnd {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}

	switch message {
	case WM_LBUTTONDOWN:
		if d.task.Kind == model.KindImage || d.task.Duration <= 0 {
			return 0
		}
		x := int(mousePoint(lParam).X)
		state := v452Round6TimelineInputStateFor(hwnd)
		state.dragging = true
		state.initial = v452ReadTrimRange(d)
		state.hit = v452Round6TimelineHit(state.initial, d.task.Duration, x, hwnd)
		procSetCapture.Call(hwnd)
		v452Round6ApplyTimelineInput(d, state, x, false)
		return 0
	case WM_MOUSEMOVE:
		state := v452Round6TimelineInputStateFor(hwnd)
		if state.dragging {
			v452Round6ApplyTimelineInput(d, state, int(mousePoint(lParam).X), false)
			return 0
		}
	case WM_LBUTTONUP:
		state := v452Round6TimelineInputStateFor(hwnd)
		if state.dragging {
			v452Round6ApplyTimelineInput(d, state, int(mousePoint(lParam).X), true)
			state.dragging = false
			procReleaseCapture.Call()
			return 0
		}
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, v452Round6TimelineInputCB, subclassID)
		v452Round6TimelineInputs.Delete(hwnd)
		v452Round6TimelineInstalled.Delete(hwnd)
	}

	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func v452Round6TimelineHit(state media.TrimRangeState, duration float64, x int, hwnd uintptr) media.TrimTimelineHit {
	_, left, right := v452TrimTimelineGeometry(hwnd)
	startX := media.TimelineTimeToX(state.Start, duration, left, right)
	endX := media.TimelineTimeToX(state.End, duration, left, right)
	playX := media.TimelineTimeToX(state.Playhead, duration, left, right)
	const boundaryHit = 11
	startDistance := v452Round6AbsInt(x - startX)
	endDistance := v452Round6AbsInt(x - endX)
	if startDistance <= boundaryHit || endDistance <= boundaryHit {
		if startDistance <= endDistance {
			return media.TrimTimelineStart
		}
		return media.TrimTimelineEnd
	}
	if v452Round6AbsInt(x-playX) <= 8 {
		return media.TrimTimelinePlayhead
	}
	// The specification has no whole-range drag. Every other point on the
	// track is a seek target for the independent preview playhead.
	return media.TrimTimelinePlayhead
}

func v452Round6ApplyTimelineInput(d *trimDialog, drag *v452Round6TimelineInputState, x int, final bool) {
	if d == nil || drag == nil || d.task == nil || d.task.Duration <= 0 {
		return
	}
	_, left, right := v452TrimTimelineGeometry(d.hTrack)
	target := media.TimelineXToTime(float64(x), d.task.Duration, left, right)
	next := drag.initial
	minimum := media.MinimumTrimSpan(d.task.Duration, d.safeFPS())
	switch drag.hit {
	case media.TrimTimelineStart:
		maximum := next.End - minimum
		if maximum < 0 {
			maximum = 0
		}
		if target < 0 {
			target = 0
		}
		if target > maximum {
			target = maximum
		}
		next.Start = target
	case media.TrimTimelineEnd:
		minimumEnd := next.Start + minimum
		if target < minimumEnd {
			target = minimumEnd
		}
		if target > d.task.Duration {
			target = d.task.Duration
		}
		next.End = target
	default:
		next.Playhead = target
	}
	next = media.NormalizeTrimRange(d.task.Duration, d.safeFPS(), next)
	generate := final && drag.hit == media.TrimTimelinePlayhead
	v452WriteTrimRange(d, next, generate)
}

func v452Round6AbsInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

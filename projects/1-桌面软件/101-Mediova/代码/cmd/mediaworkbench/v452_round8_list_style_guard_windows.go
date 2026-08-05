//go:build windows

package main

import (
	"sync"
	"syscall"
	"unsafe"
)

const (
	round8ListStyleGuardSubclassID = 0x4590
	round8WMStyleChanging          = 0x007C
)

type round8StyleStruct struct {
	StyleOld uint32
	StyleNew uint32
}

var (
	round8ListStyleGuardCB   = syscall.NewCallback(round8ListStyleGuardSubclassProc)
	round8ListStyleGuardMu   sync.Mutex
	round8ListStyleGuardHwnd uintptr
)

// round8EnsureListStyleGuard is called synchronously from the ListView's own
// UI-thread subclass. It installs exactly once for the current ListView and
// prevents Windows from restoring native scrollbars or the old 3-D client
// edge. The one-time frame change is performed only during installation;
// routine refreshes never toggle styles or recalculate the non-client area.
func round8EnsureListStyleGuard(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	round8ListStyleGuardMu.Lock()
	defer round8ListStyleGuardMu.Unlock()
	if round8ListStyleGuardHwnd == hwnd {
		return
	}
	if ok, _, _ := v452SetWindowSubclass.Call(hwnd, round8ListStyleGuardCB, round8ListStyleGuardSubclassID, 0); ok == 0 {
		return
	}

	style, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle)
	newStyle := style &^ uintptr(round7FeedbackWSHScroll|round7FeedbackWSVScroll|round7FeedbackWSBorder)
	exStyle, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLExStyle)
	newExStyle := exStyle &^ uintptr(round7FeedbackWSExClientEdge)
	changed := false
	if newStyle != style {
		round7FeedbackSetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle, newStyle)
		changed = true
	}
	if newExStyle != exStyle {
		round7FeedbackSetWindowLongPtr.Call(hwnd, round7FeedbackGWLExStyle, newExStyle)
		changed = true
	}
	if changed {
		round7FeedbackSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0,
			round7FeedbackSWPNoMove|round7FeedbackSWPNoSize|round7FeedbackSWPNoZOrder|round7FeedbackSWPNoActivate|round7FeedbackSWPFrameChanged)
	}
	round8ListStyleGuardHwnd = hwnd
}

func round8ListStyleGuardSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == round8WMStyleChanging && lParam != 0 {
		styles := (*round8StyleStruct)(unsafe.Pointer(lParam))
		switch wParam {
		case round7FeedbackGWLStyle:
			styles.StyleNew &^= uint32(round7FeedbackWSHScroll | round7FeedbackWSVScroll | round7FeedbackWSBorder)
		case round7FeedbackGWLExStyle:
			styles.StyleNew &^= uint32(round7FeedbackWSExClientEdge)
		}
	}
	if message == v452WMNCDestroy {
		round8ListStyleGuardMu.Lock()
		if round8ListStyleGuardHwnd == hwnd {
			round8ListStyleGuardHwnd = 0
		}
		round8ListStyleGuardMu.Unlock()
		v452RemoveSubclass.Call(hwnd, round8ListStyleGuardCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

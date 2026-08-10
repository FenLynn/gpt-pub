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
	round8WMStyleChanged           = 0x007D
)

type round8StyleStruct struct {
	StyleOld uint32
	StyleNew uint32
}

var (
	round8ListStyleGuardCB   uintptr
	round8ListStyleGuardMu   sync.Mutex
	round8ListStyleGuardHwnd uintptr
	round8ListStyleRepairing bool
)

func init() {
	round8ListStyleGuardCB = syscall.NewCallback(round8ListStyleGuardSubclassProc)
}

// round8RepairListStyle verifies the style that Windows actually committed.
// WM_STYLECHANGING remains the first line of defense, but some ListView scroll
// paths can restore non-client scroll bits after that proposal was filtered.
// Repairing from WM_STYLECHANGED keeps the correction in the same style-change
// transaction, before a later non-client paint can expose a second scrollbar.
func round8RepairListStyle(hwnd uintptr) bool {
	if hwnd == 0 || round8ListStyleRepairing {
		return false
	}
	style, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle)
	newStyle := style &^ uintptr(round7FeedbackWSHScroll|round7FeedbackWSVScroll|round7FeedbackWSBorder)
	exStyle, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLExStyle)
	newExStyle := exStyle &^ uintptr(round7FeedbackWSExClientEdge)
	if newStyle == style && newExStyle == exStyle {
		return false
	}

	round8ListStyleRepairing = true
	defer func() { round8ListStyleRepairing = false }()
	if newStyle != style {
		round7FeedbackSetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle, newStyle)
	}
	if newExStyle != exStyle {
		round7FeedbackSetWindowLongPtr.Call(hwnd, round7FeedbackGWLExStyle, newExStyle)
	}
	round7FeedbackSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0,
		round7FeedbackSWPNoMove|round7FeedbackSWPNoSize|round7FeedbackSWPNoZOrder|round7FeedbackSWPNoActivate|round7FeedbackSWPFrameChanged)
	return true
}

// round8EnsureListStyleGuard is called synchronously from the ListView's own
// UI-thread subclass. It installs exactly once for the current ListView and
// prevents Windows from restoring native scrollbars or the old 3-D client
// edge. If an older v4.5.2 path removed the subclass without clearing the
// ownership marker, calling SetWindowSubclass again repairs that stale marker
// without creating a duplicate subclass entry.
func round8EnsureListStyleGuard(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	round8ListStyleGuardMu.Lock()
	if round8ListStyleGuardHwnd == hwnd {
		round8ListStyleGuardMu.Unlock()
		// SetWindowSubclass updates the existing entry when present and restores
		// it when a retired path removed the callback but left our marker stale.
		v452SetWindowSubclass.Call(hwnd, round8ListStyleGuardCB, round8ListStyleGuardSubclassID, 0)
		round8RepairListStyle(hwnd)
		return
	}
	if ok, _, _ := v452SetWindowSubclass.Call(hwnd, round8ListStyleGuardCB, round8ListStyleGuardSubclassID, 0); ok == 0 {
		round8ListStyleGuardMu.Unlock()
		return
	}
	// Publish ownership before changing styles: SetWindowLongPtr synchronously
	// emits WM_STYLECHANGING, which re-enters the ListView subclass. The early
	// marker makes that nested call a no-op instead of deadlocking on this mutex.
	round8ListStyleGuardHwnd = hwnd
	round8ListStyleGuardMu.Unlock()
	round8RepairListStyle(hwnd)
}

func round8ListStyleGuardSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == round12WMDeferredScrollScrub {
		round12PerformDeferredNativeScrollScrub(hwnd)
		return 0
	}
	if message == round8WMStyleChanging && lParam != 0 {
		styles := (*round8StyleStruct)(unsafe.Pointer(lParam))
		switch wParam {
		case round7FeedbackGWLStyle:
			styles.StyleNew &^= uint32(round7FeedbackWSHScroll | round7FeedbackWSVScroll | round7FeedbackWSBorder)
		case round7FeedbackGWLExStyle:
			styles.StyleNew &^= uint32(round7FeedbackWSExClientEdge)
		}
	}
	if message == round8WMStyleChanged {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round8RepairListStyle(hwnd)
		return result
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

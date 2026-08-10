//go:build windows

package main

// Round12 no longer creates any scrollbar child window. This file only keeps
// native ListView scrollbar suppression and compatibility entry points used by
// the surrounding v4.5.2 code. The visible thumb is painted directly by the
// ListView subclass in v452_round12_scroll_function_windows.go.

const (
	round12ScrollSBBoth = 3
)

var round12ShowScrollBar = user32.NewProc("ShowScrollBar")

// round12ScrubNativeListScrollStyles is deliberately a light interaction-time
// style scrub. The one-time Round8 style guard already performed the required
// frame recalculation during installation. Repeating SWP_FRAMECHANGED while
// dragging makes SysListView32 recalculate overflow and can restore native
// scroll styles again. This helper therefore changes style bits only.
func round12ScrubNativeListScrollStyles(hwnd uintptr) bool {
	if hwnd == 0 {
		return false
	}
	style, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle)
	cleanStyle := style &^ uintptr(round7FeedbackWSHScroll|round7FeedbackWSVScroll)
	if cleanStyle == style {
		return false
	}
	round7FeedbackSetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle, cleanStyle)
	return true
}

// Style bits are not a sufficient visual contract for SysListView32. The
// common control can retain a standard scrollbar in its non-client geometry
// even after GetWindowLongPtr already reports clean style bits. Always call the
// canonical hide API at normal installation/paint/guard points so that both
// standard bars are actually hidden, even when the style scrub is a no-op.
func round12HideNativeListScrollbars(hwnd uintptr) bool {
	if hwnd == 0 {
		return false
	}
	round8EnsureListStyleGuard(hwnd)
	changed := round12ScrubNativeListScrollStyles(hwnd)
	round12ShowScrollBar.Call(hwnd, round12ScrollSBBoth, 0)
	return changed
}

// Compatibility bridge for older Round12 callers. No overlay or child HWND is
// created. Installation is delegated to the single in-place ListView owner.
func round12InstallTransparentScrollOverlays(a *application) {
	round12InstallInlineListScroll(a)
}

func round12SyncAllCoverRegions()   {}
func round12DriveScrollHover() bool { return false }

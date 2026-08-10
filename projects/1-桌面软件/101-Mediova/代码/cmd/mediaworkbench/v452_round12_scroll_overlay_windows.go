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
	round7FeedbackSetWindowPos.Call(
		hwnd, 0, 0, 0, 0, 0,
		round7FeedbackSWPNoMove|round7FeedbackSWPNoSize|round7FeedbackSWPNoZOrder|
			round7FeedbackSWPNoActivate|round7FeedbackSWPFrameChanged,
	)
	return true
}

func round12HideNativeListScrollbars(hwnd uintptr) bool {
	if hwnd == 0 {
		return false
	}
	round8EnsureListStyleGuard(hwnd)
	changed := round12ScrubNativeListScrollStyles(hwnd)
	if changed {
		round12ShowScrollBar.Call(hwnd, round12ScrollSBBoth, 0)
	}
	return changed
}

// Compatibility bridge for older Round12 callers. No overlay or child HWND is
// created. Installation is delegated to the single in-place ListView owner.
func round12InstallTransparentScrollOverlays(a *application) {
	round12InstallInlineListScroll(a)
}

func round12SyncAllCoverRegions()   {}
func round12DriveScrollHover() bool { return false }

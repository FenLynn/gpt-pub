//go:build windows

package main

// Round12 no longer creates, resizes, clips, layers, or regions any scrollbar
// window. The task ListView keeps its normal layout rectangle. Native H/V
// scrollbar styles are rejected by the existing style guard and the only
// visible scrollbar object is the thumb painted directly into the ListView
// client area by v452_round12_scroll_function_windows.go.

const round12ScrollSBBoth = 3

// Kept only for compatibility with older source contracts. The rebuilt scroll
// owner does not call ShowScrollBar because toggling native scrollbar state is
// itself a source of non-client relayout and visible flashing.
var round12ShowScrollBar = user32.NewProc("ShowScrollBar")

func round12ScrubNativeListScrollStyles(hwnd uintptr) bool {
	if hwnd == 0 {
		return false
	}
	round8EnsureListStyleGuard(hwnd)

	style, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle)
	newStyle := style &^ uintptr(round7FeedbackWSHScroll|round7FeedbackWSVScroll|round7FeedbackWSBorder)
	exStyle, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLExStyle)
	newExStyle := exStyle &^ uintptr(round7FeedbackWSExClientEdge)
	if newStyle == style && newExStyle == exStyle {
		return false
	}

	if newStyle != style {
		round7FeedbackSetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle, newStyle)
	}
	if newExStyle != exStyle {
		round7FeedbackSetWindowLongPtr.Call(hwnd, round7FeedbackGWLExStyle, newExStyle)
	}
	round7FeedbackSetWindowPos.Call(
		hwnd,
		0,
		0,
		0,
		0,
		0,
		round7FeedbackSWPNoMove|round7FeedbackSWPNoSize|round7FeedbackSWPNoZOrder|
			round7FeedbackSWPNoActivate|round7FeedbackSWPFrameChanged,
	)
	return true
}

func round12HideNativeListScrollbars(hwnd uintptr) bool {
	return round12ScrubNativeListScrollStyles(hwnd)
}

// Compatibility entrypoint retained for callers created during earlier
// v4.5.2 rounds. It now installs only the in-place ListView owner.
func round12InstallTransparentScrollOverlays(a *application) {
	round12InstallInlineListScroll(a)
}

// Retired child-window overlay hooks. They intentionally do nothing.
func round12SyncAllCoverRegions()   {}
func round12DriveScrollHover() bool { return false }

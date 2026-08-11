//go:build windows

package main

import "sync/atomic"

// Round12 no longer creates, resizes, clips, layers, or regions any scrollbar
// window. The task ListView keeps its normal layout rectangle. Native H/V
// scrollbar styles are rejected by the existing style guard and the only
// visible scrollbar object is the thumb painted directly into the ListView
// client area by v452_round12_scroll_function_windows.go.

const (
	round12ScrollSBBoth          = 3
	round12WMDeferredScrollScrub = WM_APP + 0x5CF
)

var round12DeferredScrollScrubPending atomic.Bool

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

func round12QueueDeferredNativeScrollScrub(hwnd uintptr) {
	if hwnd == 0 || !round12DeferredScrollScrubPending.CompareAndSwap(false, true) {
		return
	}
	if ok, _, _ := procPostMessageW.Call(hwnd, uintptr(round12WMDeferredScrollScrub), 0, 0); ok == 0 {
		round12DeferredScrollScrubPending.Store(false)
	}
}

func round12PerformDeferredNativeScrollScrub(hwnd uintptr) {
	round12DeferredScrollScrubPending.Store(false)
	round12ScrubNativeListScrollStyles(hwnd)

	// LVM_SCROLL can move already-painted client pixels and leave the inline
	// thumb partially covered by the ListView's later exposed-row repaint. Flush
	// that pending client paint at the queue tail, then draw the single inline
	// thumb once more so it is always the final visual owner for its track.
	axis := round12InlineState.visibleAxis
	if round12InlineState.dragging {
		axis = round12InlineState.dragAxis
	}
	if axis == round9AxisNone {
		return
	}
	round12InlineInvalidateAxis(hwnd, axis)
	procUpdateWindow.Call(hwnd)
	hdc, _, _ := round7ListGetDC.Call(hwnd)
	if hdc != 0 {
		round12InlineDrawThumb(hwnd, hdc)
		round7ListReleaseDC.Call(hwnd, hdc)
	}
}

func round12HideNativeListScrollbars(hwnd uintptr) bool {
	changed := round12ScrubNativeListScrollStyles(hwnd)
	// LVM_SCROLL may queue an internal non-client update that restores native
	// H/V style bits after the synchronous call returns. Post one coalesced
	// cleanup behind those already-queued updates. No timer and no extra scroll
	// owner are involved.
	round12QueueDeferredNativeScrollScrub(hwnd)
	return changed
}

// Compatibility entrypoint retained for callers created during earlier
// v4.5.2 rounds. It now installs only the in-place ListView owner.
func round12InstallTransparentScrollOverlays(a *application) {
	round12InstallInlineListScroll(a)
}

// Retired child-window overlay hooks. They intentionally do nothing.
func round12SyncAllCoverRegions()   {}
func round12DriveScrollHover() bool { return false }

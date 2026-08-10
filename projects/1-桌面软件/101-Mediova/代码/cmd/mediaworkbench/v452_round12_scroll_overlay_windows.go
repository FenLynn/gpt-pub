//go:build windows

package main

import "unsafe"

// The rebuilt Round12 scrollbar no longer tries to suppress SysListView32's
// native scrollbars. The ListView is made physically larger than its intended
// viewport by one scrollbar gutter on the right and bottom. A window region
// exposes only the original viewport. Native H/V bars therefore remain outside
// the visible/hit-test region while the custom thumb is painted inside the
// visible ListView client.

const round12ScrollSBBoth = 3

var (
	round12ShowScrollBar            = user32.NewProc("ShowScrollBar")
	round12ViewportCreateRectRgn   = gdi32.NewProc("CreateRectRgn")
	round12ViewportSetWindowRgn    = user32.NewProc("SetWindowRgn")
	round12ViewportWidth           int32
	round12ViewportHeight          int32
	round12ViewportRegionWidth     int32
	round12ViewportRegionHeight    int32
	round12ViewportApplying        bool
)

func round12ViewportGutter() int32 {
	gutter := scaleDPI(17)
	if gutter < 17 {
		gutter = 17
	}
	return gutter
}

func round12ViewportReset() {
	round12ViewportWidth = 0
	round12ViewportHeight = 0
	round12ViewportRegionWidth = 0
	round12ViewportRegionHeight = 0
	round12ViewportApplying = false
}

// round12ViewportEnsure makes the native scrollbar geometry unreachable
// instead of racing its hide/show lifecycle. It is idempotent during paints
// and scrolling. SetWindowRgn is only repeated when the intended viewport size
// actually changes.
func round12ViewportEnsure(hwnd uintptr) bool {
	if hwnd == 0 || round12ViewportApplying {
		return false
	}

	var wr rect
	if ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&wr))); ok == 0 {
		return false
	}
	actualWidth := wr.Right - wr.Left
	actualHeight := wr.Bottom - wr.Top
	if actualWidth <= 0 || actualHeight <= 0 {
		return false
	}

	gutter := round12ViewportGutter()
	if round12ViewportWidth <= 0 || round12ViewportHeight <= 0 {
		round12ViewportWidth = actualWidth
		round12ViewportHeight = actualHeight
	} else {
		expectedWidth := round12ViewportWidth + gutter
		expectedHeight := round12ViewportHeight + gutter
		if actualWidth != expectedWidth || actualHeight != expectedHeight {
			// The normal main-window layout has just supplied a new intended
			// viewport size. Adopt that size, then move the native scrollbar
			// gutter back outside the visible region.
			round12ViewportWidth = actualWidth
			round12ViewportHeight = actualHeight
		}
	}

	viewportWidth := round12ViewportWidth
	viewportHeight := round12ViewportHeight
	if viewportWidth <= 0 || viewportHeight <= 0 {
		return false
	}
	targetWidth := viewportWidth + gutter
	targetHeight := viewportHeight + gutter

	// Round8's style guard belonged to the rejected hide/show architecture.
	// Remove it permanently for this HWND, then deliberately retain native H/V
	// scrollbar styles. Their non-client geometry is clipped outside the
	// viewport and never becomes visible or clickable.
	v452RemoveSubclass.Call(hwnd, round8ListStyleGuardCB, round8ListStyleGuardSubclassID)
	style, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle)
	newStyle := (style | uintptr(round7FeedbackWSHScroll|round7FeedbackWSVScroll)) &^ uintptr(round7FeedbackWSBorder)
	exStyle, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLExStyle)
	newExStyle := exStyle &^ uintptr(round7FeedbackWSExClientEdge)
	styleChanged := newStyle != style || newExStyle != exStyle

	round12ViewportApplying = true
	defer func() { round12ViewportApplying = false }()

	if newStyle != style {
		round7FeedbackSetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle, newStyle)
	}
	if newExStyle != exStyle {
		round7FeedbackSetWindowLongPtr.Call(hwnd, round7FeedbackGWLExStyle, newExStyle)
	}

	resized := actualWidth != targetWidth || actualHeight != targetHeight
	if styleChanged || resized {
		flags := uintptr(round7FeedbackSWPNoMove | round7FeedbackSWPNoZOrder | round7FeedbackSWPNoActivate)
		if styleChanged {
			flags |= uintptr(round7FeedbackSWPFrameChanged)
		}
		round7FeedbackSetWindowPos.Call(hwnd, 0, 0, 0, uintptr(targetWidth), uintptr(targetHeight), flags)
	}

	regionChanged := round12ViewportRegionWidth != viewportWidth || round12ViewportRegionHeight != viewportHeight
	if regionChanged {
		rgn, _, _ := round12ViewportCreateRectRgn.Call(0, 0, uintptr(viewportWidth), uintptr(viewportHeight))
		if rgn != 0 {
			ok, _, _ := round12ViewportSetWindowRgn.Call(hwnd, rgn, 0)
			if ok != 0 {
				round12ViewportRegionWidth = viewportWidth
				round12ViewportRegionHeight = viewportHeight
			} else {
				procDeleteObject.Call(rgn)
			}
		}
	}

	return styleChanged || resized || regionChanged
}

// Compatibility names retained for the surrounding v4.5.2 owner. They now
// establish the clipped viewport; they never hide/show a native scrollbar.
func round12ScrubNativeListScrollStyles(hwnd uintptr) bool {
	return round12ViewportEnsure(hwnd)
}

func round12HideNativeListScrollbars(hwnd uintptr) bool {
	return round12ViewportEnsure(hwnd)
}

func round12InstallTransparentScrollOverlays(a *application) {
	round12InstallInlineListScroll(a)
}

func round12SyncAllCoverRegions()   {}
func round12DriveScrollHover() bool { return false }

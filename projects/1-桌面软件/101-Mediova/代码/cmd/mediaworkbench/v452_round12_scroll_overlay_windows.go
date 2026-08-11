//go:build windows

package main

import (
	"sync/atomic"
	"syscall"
	"unsafe"
)

// Round12 no longer creates, resizes, clips, layers, or regions any scrollbar
// window. The task ListView keeps its normal layout rectangle. Native H/V
// scrollbar styles are rejected by the existing style guard and the only
// visible scrollbar object is the thumb painted directly into the ListView
// client area by v452_round12_scroll_function_windows.go.

const (
	round12ScrollSBBoth                    = 3
	round12WMDeferredScrollScrub           = WM_APP + 0x5CF
	round12PostPaintMainSubclassID         = 0x45CE
	round12CDDSPostPaint           uint32  = 0x00000002
	round12CDRFNotifyPostPaint     uintptr = 0x00000010
)

var (
	round12DeferredScrollScrubPending atomic.Bool
	round12PostPaintMainCB            uintptr
)

func init() {
	round12PostPaintMainCB = syscall.NewCallback(round12PostPaintMainSubclassProc)
}

// Kept only for compatibility with older source contracts. The rebuilt scroll
// owner does not call ShowScrollBar because toggling native scrollbar state is
// itself a source of non-client relayout and visible flashing.
var round12ShowScrollBar = user32.NewProc("ShowScrollBar")

func round12InstallPostPaintOwner(a *application) {
	if a == nil || a.hwnd == 0 || a.hList == 0 {
		return
	}
	v452RemoveSubclass.Call(a.hwnd, round12PostPaintMainCB, round12PostPaintMainSubclassID)
	v452SetWindowSubclass.Call(a.hwnd, round12PostPaintMainCB, round12PostPaintMainSubclassID, 0)
}

func round12PostPaintMainSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == WM_NOTIFY && lParam != 0 {
		a := app
		if a != nil && a.hList != 0 {
			hdr := (*nmhdr)(unsafe.Pointer(lParam))
			if hdr.HwndFrom == a.hList && hdr.Code == NM_CUSTOMDRAW {
				cd := (*nmListViewCustomDraw)(unsafe.Pointer(lParam))
				switch cd.NMCD.DrawStage {
				case CDDS_PREPAINT:
					result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
					// Keep the existing per-item custom draw contract and ask the
					// ListView for one final callback after the whole control paint.
					return result | round12CDRFNotifyPostPaint
				case round12CDDSPostPaint:
					// Preserve the existing main-window custom-draw handler first.
					// The inline thumb is then the final ListView paint layer.
					result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
					round12InlineDrawThumb(a.hList, cd.NMCD.HDC)
					return result
				}
			}
		}
	}

	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, round12PostPaintMainCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

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
}

func round12FinalizeInlineScrollVisual(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	axis := round12InlineState.visibleAxis
	if round12InlineState.dragging {
		axis = round12InlineState.dragAxis
	}
	if axis == round9AxisNone {
		return
	}

	// LVM_SCROLL can move ListView client pixels before its paint cycle settles.
	// Invalidate only the transparent edge track and complete that paint now.
	// The parent post-paint owner draws the thumb after the ListView finishes.
	round12InlineInvalidateAxis(hwnd, axis)
	procUpdateWindow.Call(hwnd)
}

func round12HideNativeListScrollbars(hwnd uintptr) bool {
	changed := round12ScrubNativeListScrollStyles(hwnd)

	// Callers such as round12InlineScrollPixels invoke this immediately after
	// LVM_SCROLL, so the edge track is repainted in that same scroll transaction.
	round12FinalizeInlineScrollVisual(hwnd)

	// LVM_SCROLL may still queue a non-client update that restores native H/V
	// style bits. The queued path is style cleanup only and never paints.
	round12QueueDeferredNativeScrollScrub(hwnd)
	return changed
}

// Compatibility entrypoint retained for callers created during earlier
// v4.5.2 rounds. It now installs only the in-place ListView owner.
func round12InstallTransparentScrollOverlays(a *application) {
	round12InstallInlineListScroll(a)
	round12InstallPostPaintOwner(a)
}

// Retired child-window overlay hooks. They intentionally do nothing.
func round12SyncAllCoverRegions()   {}
func round12DriveScrollHover() bool { return false }

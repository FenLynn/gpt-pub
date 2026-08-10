//go:build windows

package main

import (
	"syscall"
	"time"
	"unsafe"
)

const (
	round12ScrollOverlaySubclassID = 0x45C9
	round12ScrollListSubclassID    = 0x45CA
	round12ScrollHideWatchTimer    = 0x45CB
	round12ScrollHideWatchDelay    = 60

	// Retired layered/color-key constants are retained for the Round12 source
	// contract. The final owner no longer relies on layered child transparency.
	round12ScrollWSExLayered     = 0x00080000
	round12ScrollWSExTransparent = 0x00000020
	round12ScrollLWAColorKey     = 0x00000001
	round12ScrollSBBoth          = 3
)

var (
	round12ScrollOverlayCallback uintptr
	round12ScrollListCallback    uintptr
	// Retained for source-contract compatibility only. Window regions now own
	// transparency, so SetLayeredWindowAttributes is intentionally unused.
	round12ScrollSetLayered     = user32.NewProc("SetLayeredWindowAttributes")
	round12ShowScrollBar        = user32.NewProc("ShowScrollBar")
	round12ScrollTransparentKey = colorRef(1, 2, 3)
	round12ScrollSetWindowRgn   = user32.NewProc("SetWindowRgn")
	round12ScrollCreateRectRgn  = gdi32.NewProc("CreateRectRgn")
)

func init() {
	round12ScrollOverlayCallback = syscall.NewCallback(round12ScrollOverlaySubclassProc)
	round12ScrollListCallback = syscall.NewCallback(round12ScrollListSubclassProc)
	go func() {
		for attempt := 0; attempt < 800; attempt++ {
			a := app
			if a != nil && a.hwnd != 0 && a.hList != 0 && a.controlsReady &&
				round11StableCoverH != nil && round11StableCoverV != nil &&
				round11StableCoverH.hwnd != 0 && round11StableCoverV.hwnd != 0 {
				a.postUI(func() {
					round12InstallTransparentScrollOverlays(a)
				})
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
}

func round12ScrubNativeListScrollStyles(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	style, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle)
	cleanStyle := style &^ uintptr(round7FeedbackWSHScroll|round7FeedbackWSVScroll)
	if cleanStyle == style {
		return
	}
	round7FeedbackSetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle, cleanStyle)
	round7FeedbackSetWindowPos.Call(
		hwnd, 0, 0, 0, 0, 0,
		round7FeedbackSWPNoMove|round7FeedbackSWPNoSize|round7FeedbackSWPNoZOrder|
			round7FeedbackSWPNoActivate|round7FeedbackSWPFrameChanged,
	)
}

func round12HideNativeListScrollbars(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	round8EnsureListStyleGuard(hwnd)
	round12ScrubNativeListScrollStyles(hwnd)
	round12ShowScrollBar.Call(hwnd, round12ScrollSBBoth, 0)
}

func round12StopCoverTimers(cover *round11StableCover) {
	if cover == nil || cover.hwnd == 0 {
		return
	}
	// Round12 owns the lifecycle completely. Kill both Round11 timers so a
	// delayed 500 ms show or legacy 220 ms hide can never race the new Region.
	procKillTimer.Call(cover.hwnd, round11StableCoverShowTimer)
	procKillTimer.Call(cover.hwnd, round11StableCoverHideTimer)
	procKillTimer.Call(cover.hwnd, round12ScrollHideWatchTimer)
}

func round12ArmCoverHideWatch(cover *round11StableCover) {
	if cover == nil || cover.hwnd == 0 || cover.phase != round11CoverVisible {
		return
	}
	procSetTimer.Call(cover.hwnd, round12ScrollHideWatchTimer, round12ScrollHideWatchDelay, 0)
}

func round12HideCoverNow(cover *round11StableCover) {
	if cover == nil || cover.hwnd == 0 {
		return
	}
	procKillTimer.Call(cover.hwnd, round12ScrollHideWatchTimer)
	cover.phase = round11CoverHidden
	cover.dragOffset = 0
	round12ApplyCoverRegion(cover)
}

// round12ApplyCoverRegion is the final visual ownership rule for task-list
// scrolling. The old Round11 child HWND keeps its full 17 px bounding geometry
// only so hit testing and tests can locate the edge strip. Its actual Windows
// region is either empty or exactly the rounded thumb. There is therefore no
// broad transparent child surface left for DWM to composite or flash.
func round12ApplyCoverRegion(cover *round11StableCover) {
	if cover == nil || cover.hwnd == 0 {
		return
	}

	var region uintptr
	if cover.phase == round11CoverVisible || cover.phase == round11CoverDragging {
		if thumb, ok := round12FunctionalThumbForCover(cover); ok {
			radius := scaleDPI(6)
			region, _, _ = procCreateRoundRectRgn.Call(
				uintptr(thumb.Left), uintptr(thumb.Top), uintptr(thumb.Right), uintptr(thumb.Bottom),
				uintptr(radius), uintptr(radius),
			)
		}
	}
	if region == 0 {
		region, _, _ = round12ScrollCreateRectRgn.Call(0, 0, 0, 0)
	}
	if region == 0 {
		// Fail closed. A missing region must never reveal the old wide surface.
		procShowWindow.Call(cover.hwnd, SW_HIDE)
		return
	}
	applied, _, _ := round12ScrollSetWindowRgn.Call(cover.hwnd, region, 1)
	if applied == 0 {
		procDeleteObject.Call(region)
		procShowWindow.Call(cover.hwnd, SW_HIDE)
		return
	}
	// SetWindowRgn takes ownership of region on success. Keep WS_VISIBLE so the
	// existing full edge-strip geometry remains available for hit calculation;
	// only the empty/rounded region can ever reach the desktop.
	procShowWindow.Call(cover.hwnd, SW_SHOWNOACTIVATE)
}

func round12SyncAllCoverRegions() {
	round12ApplyCoverRegion(round11StableCoverH)
	round12ApplyCoverRegion(round11StableCoverV)
}

// Round11's full-width cover windows are retained only as geometry containers.
// Layered/color-key transparency is explicitly removed. Window-region clipping
// guarantees that only one thumb-shaped object can ever be composited.
func round12InstallTransparentScrollOverlays(a *application) {
	if a == nil || a.hList == 0 {
		return
	}
	round12HideNativeListScrollbars(a.hList)

	// Establish the full edge-strip rectangles once, then disable Round11's
	// independent reposition/input owners. Round12 is the only scrolling owner.
	round11PositionStableScrollSurfaces(a)
	v452RemoveSubclass.Call(a.hwnd, round11StableCoverMainCB, round11StableCoverMainSubclassID)
	v452RemoveSubclass.Call(a.hList, round11StableCoverListCB, round11StableCoverListSubclassID)

	for _, cover := range []*round11StableCover{round11StableCoverH, round11StableCoverV} {
		if cover == nil || cover.hwnd == 0 {
			continue
		}
		hwnd := cover.hwnd
		round12StopCoverTimers(cover)
		cover.phase = round11CoverHidden
		cover.dragOffset = 0
		// Collapse the visual region before removing WS_EX_LAYERED, so there is
		// no single startup frame in which the 17 px geometry can become opaque.
		round12ApplyCoverRegion(cover)

		exStyle, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLExStyle)
		newExStyle := (exStyle &^ uintptr(round12ScrollWSExLayered)) | uintptr(round12ScrollWSExTransparent)
		if newExStyle != exStyle {
			round7FeedbackSetWindowLongPtr.Call(hwnd, round7FeedbackGWLExStyle, newExStyle)
			round7FeedbackSetWindowPos.Call(
				hwnd, 0, 0, 0, 0, 0,
				round7FeedbackSWPNoMove|round7FeedbackSWPNoSize|round7FeedbackSWPNoZOrder|
					round7FeedbackSWPNoActivate|round7FeedbackSWPFrameChanged,
			)
		}
		v452RemoveSubclass.Call(hwnd, round12ScrollOverlayCallback, round12ScrollOverlaySubclassID)
		v452SetWindowSubclass.Call(hwnd, round12ScrollOverlayCallback, round12ScrollOverlaySubclassID, uintptr(cover.axis))
	}

	// The temporary Round12 overlay ListView subclass is retired as well. The
	// functional subclass installed by v452_round12_scroll_function_windows.go
	// owns hover, dragging, wheel input and content movement.
	v452RemoveSubclass.Call(a.hList, round12ScrollListCallback, round12ScrollListSubclassID)
	round12SyncAllCoverRegions()
	round12HideNativeListScrollbars(a.hList)
}

func round12ScrollOverlaySubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	raw, ok := round11StableCoverByHWND.Load(hwnd)
	if !ok {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
	cover := raw.(*round11StableCover)
	switch message {
	case WM_PAINT:
		var ps paintStruct
		hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		if hdc != 0 {
			if cover.phase == round11CoverVisible || cover.phase == round11CoverDragging {
				if thumb, thumbOK := round12FunctionalThumbForCover(cover); thumbOK {
					color := colorRef(160, 171, 184)
					if cover.phase == round11CoverDragging {
						color = colorRef(110, 132, 158)
					}
					brush, _, _ := procCreateSolidBrush.Call(color)
					oldBrush, _, _ := procSelectObject.Call(hdc, brush)
					oldPen, _, _ := procSelectObject.Call(hdc, procGetStockObjectNullPen())
					radius := scaleDPI(6)
					procRoundRect.Call(
						hdc,
						uintptr(thumb.Left), uintptr(thumb.Top), uintptr(thumb.Right), uintptr(thumb.Bottom),
						uintptr(radius), uintptr(radius),
					)
					if oldPen != 0 {
						procSelectObject.Call(hdc, oldPen)
					}
					if oldBrush != 0 {
						procSelectObject.Call(hdc, oldBrush)
					}
					procDeleteObject.Call(brush)
				}
			}
			procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		}
		return 0
	case WM_ERASEBKGND:
		return 1
	case WM_NCHITTEST:
		// Always pass pointer ownership through to the ListView underneath.
		return ^uintptr(0) // HTTRANSPARENT == -1
	case WM_TIMER:
		switch wParam {
		case round11StableCoverShowTimer, round11StableCoverHideTimer:
			// Round11 timers are permanently retired once Round12 owns the HWND.
			procKillTimer.Call(hwnd, wParam)
			return 0
		case round12ScrollHideWatchTimer:
			if cover.phase == round11CoverDragging {
				return 0
			}
			if cover.phase != round11CoverVisible {
				procKillTimer.Call(hwnd, round12ScrollHideWatchTimer)
				return 0
			}
			_, inside := round12ScrollCursorPoint(cover)
			if !inside {
				round12HideCoverNow(cover)
			}
			return 0
		}
	case round7FeedbackWMMouseLeave:
		// The overlay itself is HTTRANSPARENT, so MouseLeave is not guaranteed on
		// every desktop. The 60 ms watch is authoritative and works even when the
		// pointer leaves the ListView entirely.
		round12ArmCoverHideWatch(cover)
		return 0
	case v452WMNCDestroy:
		round12StopCoverTimers(cover)
		v452RemoveSubclass.Call(hwnd, round12ScrollOverlayCallback, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func procGetStockObjectNullPen() uintptr {
	value, _, _ := procGetStockObject.Call(8)
	return value
}

func round12ScrollCursorPoint(cover *round11StableCover) (point, bool) {
	if cover == nil || cover.hwnd == 0 {
		return point{}, false
	}
	var pt point
	if ok, _, _ := round9FeedbackGetCursorPos.Call(uintptr(unsafe.Pointer(&pt))); ok == 0 {
		return point{}, false
	}
	if ok, _, _ := round9FeedbackScreenToClient.Call(cover.hwnd, uintptr(unsafe.Pointer(&pt))); ok == 0 {
		return point{}, false
	}
	var rc rect
	procGetClientRect.Call(cover.hwnd, uintptr(unsafe.Pointer(&rc)))
	return pt, pt.X >= rc.Left && pt.Y >= rc.Top && pt.X < rc.Right && pt.Y < rc.Bottom
}

// Kept for compatibility with the earlier overlay owner. The functional owner
// uses round12FunctionalDriveScrollHover; this path follows the same region
// rules if it is ever reached during startup convergence.
func round12DriveScrollHover() bool {
	dragging := false
	for _, cover := range []*round11StableCover{round11StableCoverH, round11StableCoverV} {
		if cover == nil || cover.hwnd == 0 {
			continue
		}
		pt, inside := round12ScrollCursorPoint(cover)
		if cover.phase == round11CoverDragging {
			coordinate := int(pt.X)
			if cover.axis == round9AxisVertical {
				coordinate = int(pt.Y)
			}
			round12FunctionalSetScrollFromCover(cover, coordinate)
			dragging = true
			continue
		}
		if inside {
			if cover.phase != round11CoverVisible {
				cover.phase = round11CoverVisible
				round12ApplyCoverRegion(cover)
			}
			round12ArmCoverHideWatch(cover)
			continue
		}
		if cover.phase == round11CoverVisible || cover.phase == round11CoverPending {
			round12HideCoverNow(cover)
		}
	}
	return dragging
}

func round12BeginScrollDrag(listHWND uintptr) bool {
	for _, cover := range []*round11StableCover{round11StableCoverH, round11StableCoverV} {
		if cover == nil || cover.hwnd == 0 || cover.phase != round11CoverVisible {
			continue
		}
		pt, inside := round12ScrollCursorPoint(cover)
		if !inside {
			continue
		}
		thumb, ok := round12FunctionalThumbForCover(cover)
		if !ok || !round7FeedbackPointInRect(pt, thumb) {
			continue
		}
		procKillTimer.Call(cover.hwnd, round12ScrollHideWatchTimer)
		cover.phase = round11CoverDragging
		if cover.axis == round9AxisVertical {
			cover.dragOffset = int(pt.Y - thumb.Top)
		} else {
			cover.dragOffset = int(pt.X - thumb.Left)
		}
		procSetCapture.Call(listHWND)
		round12ApplyCoverRegion(cover)
		return true
	}
	return false
}

func round12FinishScrollDrag(releaseCapture bool) bool {
	finished := false
	for _, cover := range []*round11StableCover{round11StableCoverH, round11StableCoverV} {
		if cover == nil || cover.hwnd == 0 || cover.phase != round11CoverDragging {
			continue
		}
		cover.phase = round11CoverVisible
		round12ApplyCoverRegion(cover)
		round12ArmCoverHideWatch(cover)
		finished = true
	}
	if finished && releaseCapture {
		procReleaseCapture.Call()
	}
	return finished
}

// Startup-only fallback. The final functional ListView subclass replaces this
// owner, but keeping it region-safe prevents a broad surface even in the short
// convergence window.
func round12ScrollListSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case WM_PAINT, round7FeedbackWMPrint, round7FeedbackWMPrintClient:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	case WM_MOUSEMOVE:
		if round12DriveScrollHover() {
			return 0
		}
	case round7FeedbackWMLButtonDown:
		if round12BeginScrollDrag(hwnd) {
			return 0
		}
	case WM_LBUTTONUP:
		if round12FinishScrollDrag(true) {
			return 0
		}
	case round7FeedbackWMCaptureChanged:
		round12FinishScrollDrag(false)
	case WM_SIZE, round9FeedbackWMWindowPosChanged, LVM_SETCOLUMNWIDTH, LVM_INSERTITEMW, LVM_DELETEALLITEMS:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round11PositionStableScrollSurfaces(app)
		round12HideNativeListScrollbars(hwnd)
		round12SyncAllCoverRegions()
		return result
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round12ScrollListCallback, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

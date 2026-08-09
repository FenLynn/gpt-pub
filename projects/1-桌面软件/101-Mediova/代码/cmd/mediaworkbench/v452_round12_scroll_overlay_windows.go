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
	round12ScrollWSExLayered       = 0x00080000
	round12ScrollWSExTransparent   = 0x00000020
	round12ScrollLWAColorKey       = 0x00000001
	round12ScrollSBBoth            = 3
)

var (
	round12ScrollOverlayCallback uintptr
	round12ScrollListCallback    uintptr
	round12ScrollSetLayered      = user32.NewProc("SetLayeredWindowAttributes")
	round12ShowScrollBar         = user32.NewProc("ShowScrollBar")
	round12ScrollTransparentKey  = colorRef(1, 2, 3)
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

func round12HideNativeListScrollbars(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	// The ListView can recreate standard bars after report-column geometry
	// changes even when WS_HSCROLL/WS_VSCROLL have already been removed. Keep
	// the style guard, then explicitly hide both standard bars so only the
	// transparent Round12 overlay thumb remains user-visible.
	round8EnsureListStyleGuard(hwnd)
	round12ShowScrollBar.Call(hwnd, round12ScrollSBBoth, 0)
}

// Round11's cover windows are retained as the hit geometry and timer lifecycle,
// but Round12 makes their visual track truly transparent. Pointer ownership is
// moved to the ListView, so the layered cover windows are free to be click-
// through and only the delayed thumb itself is composited above list content.
func round12InstallTransparentScrollOverlays(a *application) {
	if a == nil || a.hList == 0 {
		return
	}
	round12HideNativeListScrollbars(a.hList)
	for _, cover := range []*round11StableCover{round11StableCoverH, round11StableCoverV} {
		if cover == nil || cover.hwnd == 0 {
			continue
		}
		hwnd := cover.hwnd
		exStyle, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLExStyle)
		newExStyle := exStyle | uintptr(round12ScrollWSExLayered|round12ScrollWSExTransparent)
		if newExStyle != exStyle {
			round7FeedbackSetWindowLongPtr.Call(hwnd, round7FeedbackGWLExStyle, newExStyle)
			round7FeedbackSetWindowPos.Call(
				hwnd, 0, 0, 0, 0, 0,
				round7FeedbackSWPNoMove|round7FeedbackSWPNoSize|round7FeedbackSWPNoZOrder|
					round7FeedbackSWPNoActivate|round7FeedbackSWPFrameChanged,
			)
		}
		round12ScrollSetLayered.Call(
			hwnd,
			round12ScrollTransparentKey,
			255,
			round12ScrollLWAColorKey,
		)
		v452RemoveSubclass.Call(hwnd, round12ScrollOverlayCallback, round12ScrollOverlaySubclassID)
		v452SetWindowSubclass.Call(hwnd, round12ScrollOverlayCallback, round12ScrollOverlaySubclassID, uintptr(cover.axis))
		procInvalidateRect.Call(hwnd, 0, 1)
	}
	v452RemoveSubclass.Call(a.hList, round12ScrollListCallback, round12ScrollListSubclassID)
	v452SetWindowSubclass.Call(a.hList, round12ScrollListCallback, round12ScrollListSubclassID, 0)
	round11PositionStableScrollSurfaces(a)
}

// Paint the full cover in the color-key transparency color and then add only
// the thumb when its delayed state is visible. No rail, gutter or extra list
// boundary is drawn here.
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
			var rc rect
			procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
			fillSolid(hdc, rc, round12ScrollTransparentKey)
			if cover.phase == round11CoverVisible || cover.phase == round11CoverDragging {
				if thumb, thumbOK := round11StableCoverThumb(cover); thumbOK {
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
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round12ScrollOverlayCallback, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func procGetStockObjectNullPen() uintptr {
	// NULL_PEN is stock object 8. It produces a clean filled thumb with no
	// one-pixel outline and scales without introducing a second edge.
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
			round11SetScrollFromStableCover(cover, coordinate)
			dragging = true
			continue
		}
		if inside {
			if cover.phase == round11CoverHidden {
				cover.phase = round11CoverPending
				procKillTimer.Call(cover.hwnd, round11StableCoverShowTimer)
				procSetTimer.Call(cover.hwnd, round11StableCoverShowTimer, round11StableCoverShowDelay, 0)
			} else if cover.phase == round11CoverVisible {
				// Keep a polling hide timer alive even when the pointer leaves the
				// ListView directly through an outer edge and no later mouse-move
				// message is delivered to the list.
				round11ArmStableCoverHideWatch(cover)
			}
			continue
		}
		if cover.phase == round11CoverPending {
			procKillTimer.Call(cover.hwnd, round11StableCoverShowTimer)
			cover.phase = round11CoverHidden
		} else if cover.phase == round11CoverVisible {
			round11ArmStableCoverHideWatch(cover)
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
		thumb, ok := round11StableCoverThumb(cover)
		if !ok || !round7FeedbackPointInRect(pt, thumb) {
			continue
		}
		cover.phase = round11CoverDragging
		procKillTimer.Call(cover.hwnd, round11StableCoverShowTimer)
		procKillTimer.Call(cover.hwnd, round11StableCoverHideTimer)
		if cover.axis == round9AxisVertical {
			cover.dragOffset = int(pt.Y - thumb.Top)
		} else {
			cover.dragOffset = int(pt.X - thumb.Left)
		}
		procSetCapture.Call(listHWND)
		procInvalidateRect.Call(cover.hwnd, 0, 0)
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
		procInvalidateRect.Call(cover.hwnd, 0, 0)
		round11ArmStableCoverHideWatch(cover)
		finished = true
	}
	if finished && releaseCapture {
		procReleaseCapture.Call()
	}
	return finished
}

func round12ScrollListSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case WM_PAINT, round7FeedbackWMPrint, round7FeedbackWMPrintClient:
		// Hide before the lower ListView owner paints so the standard arrows,
		// rail and corner can never enter the rendered frame.
		round12HideNativeListScrollbars(hwnd)
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
		round12HideNativeListScrollbars(hwnd)
		round11PositionStableScrollSurfaces(app)
		return result
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round12ScrollListCallback, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

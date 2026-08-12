//go:build windows

package main

import (
	"syscall"
	"time"
	"unsafe"
)

const round12StripScrollVisualFinalizerSubclassID = 0x45D2

var round12StripScrollVisualFinalizerCB uintptr

func round12StripRectIntersection(left, right rect) (rect, bool) {
	intersection := rect{
		Left:   left.Left,
		Top:    left.Top,
		Right:  left.Right,
		Bottom: left.Bottom,
	}
	if right.Left > intersection.Left {
		intersection.Left = right.Left
	}
	if right.Top > intersection.Top {
		intersection.Top = right.Top
	}
	if right.Right < intersection.Right {
		intersection.Right = right.Right
	}
	if right.Bottom < intersection.Bottom {
		intersection.Bottom = right.Bottom
	}
	if intersection.Right <= intersection.Left || intersection.Bottom <= intersection.Top {
		return rect{}, false
	}
	return intersection, true
}

func round12RedrawReleasedThumbRect(listHwnd uintptr, released rect) bool {
	if listHwnd == 0 || released.Right <= released.Left || released.Bottom <= released.Top {
		return false
	}
	procRedrawWindow.Call(
		listHwnd,
		uintptr(unsafe.Pointer(&released)),
		0,
		RDW_INVALIDATE|RDW_ERASE|RDW_UPDATENOW,
	)
	return true
}

func round12InvalidateReleasedThumbStrips(
	listHwnd uintptr,
	oldRect rect,
	oldOK bool,
	newRect rect,
	newOK bool,
) bool {
	if listHwnd == 0 || !oldOK {
		return false
	}
	if !newOK {
		return round12RedrawReleasedThumbRect(listHwnd, oldRect)
	}
	intersection, overlaps := round12StripRectIntersection(oldRect, newRect)
	if !overlaps {
		return round12RedrawReleasedThumbRect(listHwnd, oldRect)
	}

	// Clear only old minus new. The previous full-old erase removed stale pixels,
	// but could also clear a narrow overlap of the thumb at its new position.
	// These four non-overlapping strips never touch a current thumb pixel.
	strips := [4]rect{
		{Left: oldRect.Left, Top: oldRect.Top, Right: oldRect.Right, Bottom: intersection.Top},
		{Left: oldRect.Left, Top: intersection.Bottom, Right: oldRect.Right, Bottom: oldRect.Bottom},
		{Left: oldRect.Left, Top: intersection.Top, Right: intersection.Left, Bottom: intersection.Bottom},
		{Left: intersection.Right, Top: intersection.Top, Right: oldRect.Right, Bottom: intersection.Bottom},
	}
	repaint := false
	for index := range strips {
		strip := strips[index]
		if strip.Right <= strip.Left || strip.Bottom <= strip.Top {
			continue
		}
		if round12RedrawReleasedThumbRect(listHwnd, strip) {
			repaint = true
		}
	}
	return repaint
}

func round12StripRepaintReleasedThumbFootprint(
	listHwnd uintptr,
	oldH rect,
	oldHOK bool,
	oldV rect,
	oldVOK bool,
) {
	if listHwnd == 0 {
		return
	}
	newH, newHOK := round12ThumbVisualListRect(listHwnd, round9AxisHorizontal)
	newV, newVOK := round12ThumbVisualListRect(listHwnd, round9AxisVertical)

	round12InvalidateReleasedThumbStrips(listHwnd, oldH, oldHOK, newH, newHOK)
	round12InvalidateReleasedThumbStrips(listHwnd, oldV, oldVOK, newV, newVOK)
}

func round12InstallStripScrollVisualFinalizer(a *application) {
	if a == nil || a.hList == 0 {
		return
	}

	// Replace the earlier full-footprint finalizer rather than stacking another
	// paint owner. The sibling thumb remains the sole pixel owner.
	v452RemoveSubclass.Call(
		a.hList,
		round12ScrollVisualFinalizerCB,
		round12ScrollVisualFinalizerSubclassID,
	)
	v452RemoveSubclass.Call(
		a.hList,
		round12StripScrollVisualFinalizerCB,
		round12StripScrollVisualFinalizerSubclassID,
	)
	v452SetWindowSubclass.Call(
		a.hList,
		round12StripScrollVisualFinalizerCB,
		round12StripScrollVisualFinalizerSubclassID,
		0,
	)
	round12SyncThumbVisual(a.hList)
}

func round12StripScrollVisualFinalizerSubclassProc(
	hwnd uintptr,
	message uint32,
	wParam, lParam uintptr,
	subclassID, refData uintptr,
) uintptr {
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, round12StripScrollVisualFinalizerCB, subclassID)
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}

	trackFootprint := round12MessageCanMoveThumbFootprint(message)
	oldH, oldHOK := rect{}, false
	oldV, oldVOK := rect{}, false
	if trackFootprint {
		oldH, oldHOK = round12ThumbVisualListRect(hwnd, round9AxisHorizontal)
		oldV, oldVOK = round12ThumbVisualListRect(hwnd, round9AxisVertical)
	}

	wasDragging := round12InlineState.dragging
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)

	if message == LVM_SETITEMSTATE {
		round12SyncFrozenNumberVisual(hwnd)
	}
	if message == WM_MOUSEMOVE && (wasDragging || round12InlineState.dragging) {
		round12FinalizeInlineScrollVisual(hwnd)
	}
	if trackFootprint {
		round12StripRepaintReleasedThumbFootprint(hwnd, oldH, oldHOK, oldV, oldVOK)
	}
	return result
}

func init() {
	round12StripScrollVisualFinalizerCB = syscall.NewCallback(round12StripScrollVisualFinalizerSubclassProc)

	go func() {
		for attempt := 0; attempt < 800; attempt++ {
			a := app
			if a != nil && a.hwnd != 0 && a.hList != 0 && a.controlsReady &&
				round12ThumbVisualH != 0 && round12ThumbVisualV != 0 {
				a.postUI(func() {
					if app == a && a.hList != 0 {
						round12InstallStripScrollVisualFinalizer(a)
					}
				})
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
}

//go:build windows

package main

import (
	"syscall"
	"time"
	"unsafe"
)

const round12StripScrollVisualFinalizerSubclassID = 0x45D2

var round12StripScrollVisualFinalizerCB uintptr

func round12RedrawOldThumbRect(listHwnd uintptr, oldRect rect) bool {
	if listHwnd == 0 || oldRect.Right <= oldRect.Left || oldRect.Bottom <= oldRect.Top {
		return false
	}
	procRedrawWindow.Call(
		listHwnd,
		uintptr(unsafe.Pointer(&oldRect)),
		0,
		RDW_INVALIDATE|RDW_ERASE|RDW_UPDATENOW,
	)
	return true
}

func round12ThumbFootprintMoved(oldRect rect, oldOK bool, newRect rect, newOK bool) bool {
	if !oldOK {
		return false
	}
	return !newOK || !round12ThumbRectEqual(oldRect, newRect)
}

func round12RestoreReleasedThumbBackground(
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
	movedH := round12ThumbFootprintMoved(oldH, oldHOK, newH, newHOK)
	movedV := round12ThumbFootprintMoved(oldV, oldVOK, newV, newVOK)
	if !movedH && !movedV {
		return
	}

	// Restore the complete old footprint while no thumb child is visible. This
	// is deliberately transactional. Redrawing old-minus-new while the current
	// sibling remains visible lets the ListView custom-draw post-paint path
	// re-enter thumb synchronization and can clip either the old or new edge.
	// Temporarily remove only that post-paint bridge, hide the tiny thumb
	// siblings, synchronously restore the ListView pixels, then commit the current
	// thumb geometry once. The UI thread cannot expose an intermediate state.
	a := app
	postPaintDetached := false
	if a != nil && a.hwnd != 0 && a.hList == listHwnd {
		v452RemoveSubclass.Call(a.hwnd, round12PostPaintMainCB, round12PostPaintMainSubclassID)
		postPaintDetached = true
	}

	round12HideThumbVisuals()
	if movedH {
		round12RedrawOldThumbRect(listHwnd, oldH)
	}
	if movedV {
		round12RedrawOldThumbRect(listHwnd, oldV)
	}

	if postPaintDetached && a != nil && a.hwnd != 0 && a.hList == listHwnd {
		v452SetWindowSubclass.Call(a.hwnd, round12PostPaintMainCB, round12PostPaintMainSubclassID, 0)
	}
	round12SyncThumbVisual(listHwnd)
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
		round12RestoreReleasedThumbBackground(hwnd, oldH, oldHOK, oldV, oldVOK)
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

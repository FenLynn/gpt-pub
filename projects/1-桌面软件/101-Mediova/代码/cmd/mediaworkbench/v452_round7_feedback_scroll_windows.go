//go:build windows

package main

import "unsafe"

var round7FeedbackScrollHiding bool

func round7FeedbackHideScrollbars(hwnd uintptr) {
	if hwnd == 0 || round7FeedbackScrollHiding {
		return
	}
	round7FeedbackScrollHiding = true
	round7FeedbackShowScrollBar.Call(hwnd, round7FeedbackSBBoth, 0)
	round7FeedbackScrollHiding = false
	round7FeedbackScroll.wantH = false
	round7FeedbackScroll.wantV = false
	round7FeedbackScroll.visibleH = false
	round7FeedbackScroll.visibleV = false
	procKillTimer.Call(hwnd, round7FeedbackScrollTimer)
}

func round7FeedbackListNeedsVertical(hwnd uintptr) bool {
	count := int(send(hwnd, LVM_GETITEMCOUNT, 0, 0))
	perPage := int(send(hwnd, round7FeedbackLVMCountPerPage, 0, 0))
	return count > 0 && perPage > 0 && count > perPage
}

func round7FeedbackListNeedsHorizontal(hwnd uintptr) bool {
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	total := int32(0)
	for i := range taskListColumns {
		total += int32(send(hwnd, LVM_GETCOLUMNWIDTH, uintptr(i), 0))
	}
	return total > rc.Right-rc.Left
}

func round7FeedbackListMouse(hwnd uintptr, x, y int) {
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	edge := int(scaleDPI(18))
	showH, showV := round7FeedbackHoverIntent(
		int(rc.Right-rc.Left),
		int(rc.Bottom-rc.Top),
		x,
		y,
		edge,
		round7FeedbackListNeedsHorizontal(hwnd),
		round7FeedbackListNeedsVertical(hwnd),
	)
	round7FeedbackScroll.wantH = showH
	round7FeedbackScroll.wantV = showV

	track := round7FeedbackTrackMouseEvent{
		CbSize:    uint32(unsafe.Sizeof(round7FeedbackTrackMouseEvent{})),
		DwFlags:   round7FeedbackTMELeave,
		HwndTrack: hwnd,
	}
	round7FeedbackTrackMouseEventProc.Call(uintptr(unsafe.Pointer(&track)))

	if !showH && !showV {
		procKillTimer.Call(hwnd, round7FeedbackScrollTimer)
		if !round7FeedbackScroll.dragging {
			round7FeedbackHideScrollbars(hwnd)
		}
		return
	}
	if (showH && round7FeedbackScroll.visibleH) || (showV && round7FeedbackScroll.visibleV) {
		return
	}
	procKillTimer.Call(hwnd, round7FeedbackScrollTimer)
	procSetTimer.Call(hwnd, round7FeedbackScrollTimer, round7FeedbackScrollDelay, 0)
}

func round7FeedbackShowRequestedScrollbars(hwnd uintptr) {
	showH := round7FeedbackScroll.wantH && round7FeedbackListNeedsHorizontal(hwnd)
	showV := round7FeedbackScroll.wantV && round7FeedbackListNeedsVertical(hwnd)
	round7FeedbackShowScrollBar.Call(hwnd, round7FeedbackSBHorz, round7FeedbackBool(showH))
	round7FeedbackShowScrollBar.Call(hwnd, round7FeedbackSBVert, round7FeedbackBool(showV))
	round7FeedbackScroll.visibleH = showH
	round7FeedbackScroll.visibleV = showV
}

func round7FeedbackBool(value bool) uintptr {
	if value {
		return 1
	}
	return 0
}

func round7FeedbackCursorInsideWindow(hwnd uintptr) bool {
	var pt point
	if ok, _, _ := procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt))); ok == 0 {
		return false
	}
	var wr rect
	procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&wr)))
	return pt.X >= wr.Left && pt.X < wr.Right && pt.Y >= wr.Top && pt.Y < wr.Bottom
}

func round7FeedbackListSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	postHide := message == WM_SIZE || message == LVM_INSERTITEMW || message == LVM_DELETEALLITEMS || message == LVM_SETCOLUMNWIDTH
	switch message {
	case WM_MOUSEMOVE:
		pt := mousePoint(lParam)
		round7FeedbackListMouse(hwnd, int(pt.X), int(pt.Y))
	case WM_TIMER:
		if wParam == round7FeedbackScrollTimer {
			procKillTimer.Call(hwnd, round7FeedbackScrollTimer)
			round7FeedbackShowRequestedScrollbars(hwnd)
			return 0
		}
	case round7FeedbackWMMouseLeave:
		if !round7FeedbackScroll.dragging && !round7FeedbackCursorInsideWindow(hwnd) {
			round7FeedbackHideScrollbars(hwnd)
		}
	case round7FeedbackWMNCMouseMove:
		hit := int(wParam)
		if hit == round7FeedbackHTHScroll {
			round7FeedbackScroll.visibleH = true
		} else if hit == round7FeedbackHTVScroll {
			round7FeedbackScroll.visibleV = true
		} else if !round7FeedbackScroll.dragging {
			round7FeedbackHideScrollbars(hwnd)
		}
	case round7FeedbackWMNCLButtonDown:
		hit := int(wParam)
		if hit == round7FeedbackHTHScroll || hit == round7FeedbackHTVScroll {
			round7FeedbackScroll.dragging = true
		}
	case round7FeedbackWMNCLButtonUp:
		round7FeedbackScroll.dragging = false
	case WM_HSCROLL, round7FeedbackWMVScroll:
		// Scrolling remains fully functional while the visual bars are hidden.
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round7FeedbackListSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	if postHide && !round7FeedbackScrollHiding && !round7FeedbackScroll.wantH && !round7FeedbackScroll.wantV && !round7FeedbackScroll.dragging {
		round7FeedbackHideScrollbars(hwnd)
	}
	return result
}

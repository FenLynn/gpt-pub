//go:build windows

package main

import "unsafe"

const (
	round7FeedbackSBHorz          = 0
	round7FeedbackSBVert          = 1
	round7FeedbackSIFAll          = 0x0017
	round7FeedbackSIFPos          = 0x0004
	round7FeedbackSBThumbPosition = 4
	round7FeedbackSBThumbTrack    = 5
	round7FeedbackWMVScroll       = 0x0115
	round7FeedbackWMMouseWheel    = 0x020A
	round7FeedbackWMCaptureChanged = 0x0215
)

type round7FeedbackScrollInfo struct {
	CbSize    uint32
	FMask     uint32
	NMin      int32
	NMax      int32
	NPage     uint32
	NPos      int32
	NTrackPos int32
}

type round7FeedbackScrollState struct {
	wantH, wantV       bool
	visibleH, visibleV bool
	timerArmed         bool
	draggingH, draggingV bool
	dragOffset         int
}

var (
	round7FeedbackScroll             round7FeedbackScrollState
	round7FeedbackGetScrollInfo      = user32.NewProc("GetScrollInfo")
	round7FeedbackSetScrollInfo      = user32.NewProc("SetScrollInfo")
)

func round7FeedbackHideScrollbars(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	wasVisible := round7FeedbackScroll.visibleH || round7FeedbackScroll.visibleV
	round7FeedbackScroll.wantH = false
	round7FeedbackScroll.wantV = false
	round7FeedbackScroll.visibleH = false
	round7FeedbackScroll.visibleV = false
	round7FeedbackScroll.timerArmed = false
	procKillTimer.Call(hwnd, round7FeedbackScrollTimer)
	if wasVisible {
		procInvalidateRect.Call(hwnd, 0, 0)
	}
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

func round7FeedbackScrollInfoFor(hwnd uintptr, bar int) (round7FeedbackScrollInfo, bool) {
	info := round7FeedbackScrollInfo{CbSize: uint32(unsafe.Sizeof(round7FeedbackScrollInfo{})), FMask: round7FeedbackSIFAll}
	ok, _, _ := round7FeedbackGetScrollInfo.Call(hwnd, uintptr(bar), uintptr(unsafe.Pointer(&info)))
	if ok != 0 && info.NMax >= info.NMin {
		return info, true
	}
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	if bar == round7FeedbackSBVert {
		count := int32(send(hwnd, LVM_GETITEMCOUNT, 0, 0))
		page := int32(send(hwnd, round7FeedbackLVMCountPerPage, 0, 0))
		pos := int32(send(hwnd, round7FeedbackLVMGetTopIndex, 0, 0))
		if count <= 0 || page <= 0 {
			return info, false
		}
		info.NMin, info.NMax, info.NPage, info.NPos = 0, count-1, uint32(page), pos
		return info, true
	}
	total := int32(0)
	for i := range taskListColumns {
		total += int32(send(hwnd, LVM_GETCOLUMNWIDTH, uintptr(i), 0))
	}
	if total <= rc.Right-rc.Left {
		return info, false
	}
	info.NMin, info.NMax, info.NPage, info.NPos = 0, total-1, uint32(rc.Right-rc.Left), 0
	return info, true
}

func round7FeedbackVerticalThumb(hwnd uintptr) (rect, bool) {
	if !round7FeedbackListNeedsVertical(hwnd) {
		return rect{}, false
	}
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	margin := int(scaleDPI(4))
	barW := int(scaleDPI(7))
	bottomReserve := 0
	if round7FeedbackListNeedsHorizontal(hwnd) {
		bottomReserve = int(scaleDPI(11))
	}
	trackStart := margin
	trackLength := int(rc.Bottom-rc.Top) - margin*2 - bottomReserve
	info, ok := round7FeedbackScrollInfoFor(hwnd, round7FeedbackSBVert)
	if !ok {
		return rect{}, false
	}
	start, length := round7FeedbackThumbGeometry(trackStart, trackLength, int(info.NMin), int(info.NMax), int(info.NPage), int(info.NPos))
	right := int(rc.Right) - int(scaleDPI(3))
	return rect{Left: int32(right - barW), Top: int32(start), Right: int32(right), Bottom: int32(start + length)}, true
}

func round7FeedbackHorizontalThumb(hwnd uintptr) (rect, bool) {
	if !round7FeedbackListNeedsHorizontal(hwnd) {
		return rect{}, false
	}
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	margin := int(scaleDPI(4))
	barH := int(scaleDPI(7))
	rightReserve := 0
	if round7FeedbackListNeedsVertical(hwnd) {
		rightReserve = int(scaleDPI(11))
	}
	trackStart := margin
	trackLength := int(rc.Right-rc.Left) - margin*2 - rightReserve
	info, ok := round7FeedbackScrollInfoFor(hwnd, round7FeedbackSBHorz)
	if !ok {
		return rect{}, false
	}
	start, length := round7FeedbackThumbGeometry(trackStart, trackLength, int(info.NMin), int(info.NMax), int(info.NPage), int(info.NPos))
	bottom := int(rc.Bottom) - int(scaleDPI(3))
	return rect{Left: int32(start), Top: int32(bottom - barH), Right: int32(start + length), Bottom: int32(bottom)}, true
}

func round7FeedbackPointInRect(pt point, rc rect) bool {
	return pt.X >= rc.Left && pt.X < rc.Right && pt.Y >= rc.Top && pt.Y < rc.Bottom
}

func round7FeedbackArmScrollTimer(hwnd uintptr, wantH, wantV bool) {
	round7FeedbackScroll.wantH = wantH
	round7FeedbackScroll.wantV = wantV
	if !wantH && !wantV {
		round7FeedbackHideScrollbars(hwnd)
		return
	}
	if round7FeedbackScroll.visibleH || round7FeedbackScroll.visibleV || round7FeedbackScroll.timerArmed {
		return
	}
	round7FeedbackScroll.timerArmed = true
	procSetTimer.Call(hwnd, round7FeedbackScrollTimer, round7FeedbackScrollDelay, 0)
}

func round7FeedbackListMouse(hwnd uintptr, x, y int) {
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	edge := int(scaleDPI(18))
	showH, showV := round7FeedbackHoverIntent(
		int(rc.Right-rc.Left), int(rc.Bottom-rc.Top), x, y, edge,
		round7FeedbackListNeedsHorizontal(hwnd), round7FeedbackListNeedsVertical(hwnd),
	)
	track := round7FeedbackTrackMouseEvent{
		CbSize: uint32(unsafe.Sizeof(round7FeedbackTrackMouseEvent{})),
		DwFlags: round7FeedbackTMELeave,
		HwndTrack: hwnd,
	}
	round7FeedbackTrackMouseEventProc.Call(uintptr(unsafe.Pointer(&track)))
	round7FeedbackArmScrollTimer(hwnd, showH, showV)
}

func round7FeedbackSetScrollFromMouse(hwnd uintptr, vertical bool, coordinate int) {
	bar := round7FeedbackSBHorz
	thumb, ok := round7FeedbackHorizontalThumb(hwnd)
	trackStart := int(scaleDPI(4))
	trackLength := 0
	if vertical {
		bar = round7FeedbackSBVert
		thumb, ok = round7FeedbackVerticalThumb(hwnd)
		var rc rect
		procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
		trackLength = int(rc.Bottom) - trackStart*2
		coordinate -= round7FeedbackScroll.dragOffset
	} else {
		var rc rect
		procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
		trackLength = int(rc.Right) - trackStart*2
		coordinate -= round7FeedbackScroll.dragOffset
	}
	if !ok {
		return
	}
	thumbLength := int(thumb.Bottom-thumb.Top)
	if !vertical {
		thumbLength = int(thumb.Right-thumb.Left)
	}
	info, ok := round7FeedbackScrollInfoFor(hwnd, bar)
	if !ok {
		return
	}
	maxPos := int(info.NMax) - int(info.NPage) + 1
	if maxPos < int(info.NMin) {
		maxPos = int(info.NMin)
	}
	movable := trackLength - thumbLength
	if movable <= 0 {
		return
	}
	relative := coordinate - trackStart
	if relative < 0 {
		relative = 0
	}
	if relative > movable {
		relative = movable
	}
	position := int(info.NMin)
	if maxPos > int(info.NMin) {
		position += relative * (maxPos-int(info.NMin)) / movable
	}
	setInfo := round7FeedbackScrollInfo{CbSize: uint32(unsafe.Sizeof(round7FeedbackScrollInfo{})), FMask: round7FeedbackSIFPos, NPos: int32(position)}
	round7FeedbackSetScrollInfo.Call(hwnd, uintptr(bar), uintptr(unsafe.Pointer(&setInfo)), 1)
	code := round7FeedbackSBThumbTrack
	message := uint32(WM_HSCROLL)
	if vertical {
		message = round7FeedbackWMVScroll
	}
	packed := uintptr(uint16(code)) | uintptr(uint16(position))<<16
	send(hwnd, message, packed, 0)
	procInvalidateRect.Call(hwnd, 0, 0)
}

func round7FeedbackDrawOverlayScrollbars(hwnd, hdc uintptr) {
	if hwnd == 0 || hdc == 0 {
		return
	}
	thumbColor := colorRef(157, 169, 184)
	if round7FeedbackScroll.draggingH || round7FeedbackScroll.draggingV {
		thumbColor = colorRef(112, 133, 158)
	}
	if round7FeedbackScroll.visibleV {
		if thumb, ok := round7FeedbackVerticalThumb(hwnd); ok {
			fillSolid(hdc, thumb, thumbColor)
		}
	}
	if round7FeedbackScroll.visibleH {
		if thumb, ok := round7FeedbackHorizontalThumb(hwnd); ok {
			fillSolid(hdc, thumb, thumbColor)
		}
	}
}

func round7FeedbackListSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case WM_PAINT:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		hdc, _, _ := round7ListGetDC.Call(hwnd)
		if hdc != 0 {
			round7DrawListOverlay(app, hdc)
			round7FeedbackDrawOverlayScrollbars(hwnd, hdc)
			round7ListReleaseDC.Call(hwnd, hdc)
		}
		return result
	case round7FeedbackWMPrint, round7FeedbackWMPrintClient:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if wParam != 0 {
			round7DrawListOverlay(app, wParam)
			round7FeedbackDrawOverlayScrollbars(hwnd, wParam)
		}
		return result
	case WM_MOUSEMOVE:
		pt := mousePoint(lParam)
		if round7FeedbackScroll.draggingV {
			round7FeedbackSetScrollFromMouse(hwnd, true, int(pt.Y))
			return 0
		}
		if round7FeedbackScroll.draggingH {
			round7FeedbackSetScrollFromMouse(hwnd, false, int(pt.X))
			return 0
		}
		round7FeedbackListMouse(hwnd, int(pt.X), int(pt.Y))
	case round7FeedbackWMLButtonDown:
		pt := mousePoint(lParam)
		if round7FeedbackScroll.visibleV {
			if thumb, ok := round7FeedbackVerticalThumb(hwnd); ok && round7FeedbackPointInRect(pt, thumb) {
				round7FeedbackScroll.draggingV = true
				round7FeedbackScroll.dragOffset = int(pt.Y - thumb.Top)
				procSetCapture.Call(hwnd)
				return 0
			}
		}
		if round7FeedbackScroll.visibleH {
			if thumb, ok := round7FeedbackHorizontalThumb(hwnd); ok && round7FeedbackPointInRect(pt, thumb) {
				round7FeedbackScroll.draggingH = true
				round7FeedbackScroll.dragOffset = int(pt.X - thumb.Left)
				procSetCapture.Call(hwnd)
				return 0
			}
		}
	case WM_LBUTTONUP:
		if round7FeedbackScroll.draggingH || round7FeedbackScroll.draggingV {
			round7FeedbackScroll.draggingH = false
			round7FeedbackScroll.draggingV = false
			procReleaseCapture.Call()
			procInvalidateRect.Call(hwnd, 0, 0)
			return 0
		}
	case round7FeedbackWMCaptureChanged:
		round7FeedbackScroll.draggingH = false
		round7FeedbackScroll.draggingV = false
	case WM_TIMER:
		if wParam == round7FeedbackScrollTimer {
			procKillTimer.Call(hwnd, round7FeedbackScrollTimer)
			round7FeedbackScroll.timerArmed = false
			round7FeedbackScroll.visibleH = round7FeedbackScroll.wantH && round7FeedbackListNeedsHorizontal(hwnd)
			round7FeedbackScroll.visibleV = round7FeedbackScroll.wantV && round7FeedbackListNeedsVertical(hwnd)
			procInvalidateRect.Call(hwnd, 0, 0)
			return 0
		}
	case round7FeedbackWMMouseLeave:
		if !round7FeedbackScroll.draggingH && !round7FeedbackScroll.draggingV {
			round7FeedbackHideScrollbars(hwnd)
		}
	case round7FeedbackWMMouseWheel, WM_HSCROLL, round7FeedbackWMVScroll:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if round7FeedbackScroll.visibleH || round7FeedbackScroll.visibleV {
			procInvalidateRect.Call(hwnd, 0, 0)
		}
		return result
	case WM_SIZE, LVM_INSERTITEMW, LVM_DELETEALLITEMS, LVM_SETCOLUMNWIDTH:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if app != nil {
			round7FeedbackStripListChrome(app)
		}
		procInvalidateRect.Call(hwnd, 0, 0)
		return result
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round7FeedbackListSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

//go:build windows

package main

import "unsafe"

const (
	round7FeedbackSBHorz           = 0
	round7FeedbackSBVert           = 1
	round7FeedbackSIFAll           = 0x0017
	round7FeedbackSIFPos           = 0x0004
	round7FeedbackSBThumbTrack     = 5
	round7FeedbackWMVScroll        = 0x0115
	round7FeedbackWMMouseWheel     = 0x020A
	round7FeedbackWMCaptureChanged = 0x0215
	round9FeedbackHideTimer        = 0x4593
	round9FeedbackHideDelay        = 220
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
	machine    round9OverlayMachine
	dragOffset int
	lastH      rect
	lastV      rect
	haveH      bool
	haveV      bool
}

var (
	round7FeedbackScroll         round7FeedbackScrollState
	round7FeedbackGetScrollInfo  = user32.NewProc("GetScrollInfo")
	round7FeedbackSetScrollInfo  = user32.NewProc("SetScrollInfo")
	round9FeedbackGetCursorPos   = user32.NewProc("GetCursorPos")
	round9FeedbackScreenToClient = user32.NewProc("ScreenToClient")
)

func round7FeedbackHideScrollbars(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	round9FeedbackInvalidateStoredThumbs(hwnd)
	procKillTimer.Call(hwnd, round7FeedbackScrollTimer)
	procKillTimer.Call(hwnd, round9FeedbackHideTimer)
	round7FeedbackScroll.machine = round9OverlayMachine{}
	round7FeedbackScroll.haveH = false
	round7FeedbackScroll.haveV = false
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
	margin := int(scaleDPI(5))
	barW := int(scaleDPI(7))
	bottomReserve := 0
	if round7FeedbackListNeedsHorizontal(hwnd) {
		bottomReserve = int(scaleDPI(12))
	}
	trackStart := margin
	trackLength := int(rc.Bottom-rc.Top) - margin*2 - bottomReserve
	info, ok := round7FeedbackScrollInfoFor(hwnd, round7FeedbackSBVert)
	if !ok || trackLength <= 0 {
		return rect{}, false
	}
	start, length := round7FeedbackThumbGeometry(trackStart, trackLength, int(info.NMin), int(info.NMax), int(info.NPage), int(info.NPos))
	right := int(rc.Right) - int(scaleDPI(4))
	return rect{Left: int32(right - barW), Top: int32(start), Right: int32(right), Bottom: int32(start + length)}, true
}

func round7FeedbackHorizontalThumb(hwnd uintptr) (rect, bool) {
	if !round7FeedbackListNeedsHorizontal(hwnd) {
		return rect{}, false
	}
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	margin := int(scaleDPI(5))
	barH := int(scaleDPI(7))
	rightReserve := 0
	if round7FeedbackListNeedsVertical(hwnd) {
		rightReserve = int(scaleDPI(12))
	}
	trackStart := margin
	trackLength := int(rc.Right-rc.Left) - margin*2 - rightReserve
	info, ok := round7FeedbackScrollInfoFor(hwnd, round7FeedbackSBHorz)
	if !ok || trackLength <= 0 {
		return rect{}, false
	}
	start, length := round7FeedbackThumbGeometry(trackStart, trackLength, int(info.NMin), int(info.NMax), int(info.NPage), int(info.NPos))
	bottom := int(rc.Bottom) - int(scaleDPI(4))
	return rect{Left: int32(start), Top: int32(bottom - barH), Right: int32(start + length), Bottom: int32(bottom)}, true
}

func round7FeedbackPointInRect(pt point, rc rect) bool {
	return pt.X >= rc.Left && pt.X < rc.Right && pt.Y >= rc.Top && pt.Y < rc.Bottom
}

func round9FeedbackCursorAxis(hwnd uintptr) uint8 {
	var pt point
	if ok, _, _ := round9FeedbackGetCursorPos.Call(uintptr(unsafe.Pointer(&pt))); ok == 0 {
		return round9AxisNone
	}
	if ok, _, _ := round9FeedbackScreenToClient.Call(hwnd, uintptr(unsafe.Pointer(&pt))); ok == 0 {
		return round9AxisNone
	}
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	if pt.X < 0 || pt.Y < 0 || pt.X >= rc.Right || pt.Y >= rc.Bottom {
		return round9AxisNone
	}
	edge := int32(scaleDPI(18))
	axis := round9AxisNone
	if round7FeedbackListNeedsHorizontal(hwnd) && pt.Y >= rc.Bottom-edge {
		axis |= round9AxisHorizontal
	}
	if round7FeedbackListNeedsVertical(hwnd) && pt.X >= rc.Right-edge {
		axis |= round9AxisVertical
	}
	return axis
}

func round9FeedbackApplyAction(hwnd uintptr, action round9OverlayAction) {
	switch action {
	case round9OverlayArmShow:
		procKillTimer.Call(hwnd, round7FeedbackScrollTimer)
		procSetTimer.Call(hwnd, round7FeedbackScrollTimer, round7FeedbackScrollDelay, 0)
	case round9OverlayCancelShow:
		procKillTimer.Call(hwnd, round7FeedbackScrollTimer)
	case round9OverlayArmHide:
		procKillTimer.Call(hwnd, round9FeedbackHideTimer)
		procSetTimer.Call(hwnd, round9FeedbackHideTimer, round9FeedbackHideDelay, 0)
	case round9OverlayCancelHide:
		procKillTimer.Call(hwnd, round9FeedbackHideTimer)
	}
}

func round7FeedbackListMouse(hwnd uintptr, x, y int) {
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	edge := int(scaleDPI(18))
	showH, showV := round7FeedbackHoverIntent(
		int(rc.Right-rc.Left), int(rc.Bottom-rc.Top), x, y, edge,
		round7FeedbackListNeedsHorizontal(hwnd), round7FeedbackListNeedsVertical(hwnd),
	)
	axis := round9AxisNone
	if showH {
		axis |= round9AxisHorizontal
	}
	if showV {
		axis |= round9AxisVertical
	}
	track := round7FeedbackTrackMouseEvent{
		CbSize:   uint32(unsafe.Sizeof(round7FeedbackTrackMouseEvent{})),
		DwFlags:  round7FeedbackTMELeave,
		HwndTrack: hwnd,
	}
	round7FeedbackTrackMouseEventProc.Call(uintptr(unsafe.Pointer(&track)))
	before := round7FeedbackScroll.machine.Axis
	action := round7FeedbackScroll.machine.Move(axis)
	round9FeedbackApplyAction(hwnd, action)
	if round7FeedbackScroll.machine.Phase == round9OverlayVisible && before != round7FeedbackScroll.machine.Axis {
		round9FeedbackInvalidateStoredThumbs(hwnd)
		round9FeedbackRememberThumbs(hwnd)
	}
}

func round9FeedbackInvalidateRect(hwnd uintptr, r rect) {
	if r.Right <= r.Left || r.Bottom <= r.Top {
		return
	}
	r.Left -= scaleDPI(2)
	r.Top -= scaleDPI(2)
	r.Right += scaleDPI(2)
	r.Bottom += scaleDPI(2)
	procInvalidateRect.Call(hwnd, uintptr(unsafe.Pointer(&r)), 0)
}

func round9FeedbackInvalidateStoredThumbs(hwnd uintptr) {
	if round7FeedbackScroll.haveH {
		round9FeedbackInvalidateRect(hwnd, round7FeedbackScroll.lastH)
	}
	if round7FeedbackScroll.haveV {
		round9FeedbackInvalidateRect(hwnd, round7FeedbackScroll.lastV)
	}
}

func round9FeedbackRememberThumbs(hwnd uintptr) {
	axis := round7FeedbackScroll.machine.Axis
	round7FeedbackScroll.haveH = false
	round7FeedbackScroll.haveV = false
	if axis&round9AxisHorizontal != 0 {
		if thumb, ok := round7FeedbackHorizontalThumb(hwnd); ok {
			round7FeedbackScroll.lastH = thumb
			round7FeedbackScroll.haveH = true
			round9FeedbackInvalidateRect(hwnd, thumb)
		}
	}
	if axis&round9AxisVertical != 0 {
		if thumb, ok := round7FeedbackVerticalThumb(hwnd); ok {
			round7FeedbackScroll.lastV = thumb
			round7FeedbackScroll.haveV = true
			round9FeedbackInvalidateRect(hwnd, thumb)
		}
	}
}

func round7FeedbackSetScrollFromMouse(hwnd uintptr, vertical bool, coordinate int) {
	bar := round7FeedbackSBHorz
	thumb, ok := round7FeedbackHorizontalThumb(hwnd)
	trackStart := int(scaleDPI(5))
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
	thumbLength := int(thumb.Bottom - thumb.Top)
	if !vertical {
		thumbLength = int(thumb.Right - thumb.Left)
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
	round7FeedbackSetScrollInfo.Call(hwnd, uintptr(bar), uintptr(unsafe.Pointer(&setInfo)), 0)
	message := uint32(WM_HSCROLL)
	if vertical {
		message = round7FeedbackWMVScroll
	}
	packed := uintptr(uint16(round7FeedbackSBThumbTrack)) | uintptr(uint16(position))<<16
	round9FeedbackInvalidateStoredThumbs(hwnd)
	send(hwnd, message, packed, 0)
	round9FeedbackRememberThumbs(hwnd)
}

func round7FeedbackDrawOverlayScrollbars(hwnd, hdc uintptr) {
	if hwnd == 0 || hdc == 0 {
		return
	}
	phase := round7FeedbackScroll.machine.Phase
	if phase != round9OverlayVisible && phase != round9OverlayDragging {
		return
	}
	thumbColor := colorRef(160, 171, 184)
	if phase == round9OverlayDragging {
		thumbColor = colorRef(110, 132, 158)
	}
	axis := round7FeedbackScroll.machine.Axis
	if axis&round9AxisVertical != 0 {
		if thumb, ok := round7FeedbackVerticalThumb(hwnd); ok {
			fillSolid(hdc, thumb, thumbColor)
		}
	}
	if axis&round9AxisHorizontal != 0 {
		if thumb, ok := round7FeedbackHorizontalThumb(hwnd); ok {
			fillSolid(hdc, thumb, thumbColor)
		}
	}
}

func round9FeedbackDrawListBoundary(hwnd, hdc uintptr) {
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	line := colorRef(207, 214, 223)
	fillSolid(hdc, rect{Left: rc.Left, Top: rc.Top, Right: rc.Right, Bottom: rc.Top + 1}, line)
	fillSolid(hdc, rect{Left: rc.Left, Top: rc.Bottom - 1, Right: rc.Right, Bottom: rc.Bottom}, line)
	fillSolid(hdc, rect{Left: rc.Left, Top: rc.Top, Right: rc.Left + 1, Bottom: rc.Bottom}, line)
	fillSolid(hdc, rect{Left: rc.Right - 1, Top: rc.Top, Right: rc.Right, Bottom: rc.Bottom}, line)
}

func round7FeedbackListSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	round8EnsureListStyleGuard(hwnd)
	round9EnsureOutputDisplay()
	switch message {
	case WM_PAINT:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		hdc, _, _ := round7ListGetDC.Call(hwnd)
		if hdc != 0 {
			round7DrawListOverlay(app, hdc)
			round7FeedbackDrawOverlayScrollbars(hwnd, hdc)
			round9FeedbackDrawListBoundary(hwnd, hdc)
			round7ListReleaseDC.Call(hwnd, hdc)
		}
		round9EnsureVisibleThumbnails(app, hwnd)
		return result
	case round7FeedbackWMPrint, round7FeedbackWMPrintClient:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if wParam != 0 {
			round7DrawListOverlay(app, wParam)
			round7FeedbackDrawOverlayScrollbars(hwnd, wParam)
			round9FeedbackDrawListBoundary(hwnd, wParam)
		}
		return result
	case WM_MOUSEMOVE:
		pt := mousePoint(lParam)
		if round7FeedbackScroll.machine.Phase == round9OverlayDragging {
			if round7FeedbackScroll.machine.Axis == round9AxisVertical {
				round7FeedbackSetScrollFromMouse(hwnd, true, int(pt.Y))
			} else {
				round7FeedbackSetScrollFromMouse(hwnd, false, int(pt.X))
			}
			return 0
		}
		round7FeedbackListMouse(hwnd, int(pt.X), int(pt.Y))
	case round7FeedbackWMLButtonDown:
		pt := mousePoint(lParam)
		if round7FeedbackScroll.machine.Phase == round9OverlayVisible {
			if round7FeedbackScroll.machine.Axis&round9AxisVertical != 0 {
				if thumb, ok := round7FeedbackVerticalThumb(hwnd); ok && round7FeedbackPointInRect(pt, thumb) {
					if round7FeedbackScroll.machine.BeginDrag(round9AxisVertical) {
						round7FeedbackScroll.dragOffset = int(pt.Y - thumb.Top)
						procKillTimer.Call(hwnd, round9FeedbackHideTimer)
						procSetCapture.Call(hwnd)
						return 0
					}
				}
			}
			if round7FeedbackScroll.machine.Axis&round9AxisHorizontal != 0 {
				if thumb, ok := round7FeedbackHorizontalThumb(hwnd); ok && round7FeedbackPointInRect(pt, thumb) {
					if round7FeedbackScroll.machine.BeginDrag(round9AxisHorizontal) {
						round7FeedbackScroll.dragOffset = int(pt.X - thumb.Left)
						procKillTimer.Call(hwnd, round9FeedbackHideTimer)
						procSetCapture.Call(hwnd)
						return 0
					}
				}
			}
		}
	case WM_LBUTTONUP:
		if round7FeedbackScroll.machine.Phase == round9OverlayDragging {
			axis := round9FeedbackCursorAxis(hwnd)
			if axis == round9AxisNone {
				axis = round7FeedbackScroll.machine.Axis
			}
			round7FeedbackScroll.machine.EndDrag(axis)
			procReleaseCapture.Call()
			round9FeedbackRememberThumbs(hwnd)
			return 0
		}
	case round7FeedbackWMCaptureChanged:
		if round7FeedbackScroll.machine.Phase == round9OverlayDragging {
			round7FeedbackScroll.machine.EndDrag(round7FeedbackScroll.machine.Axis)
		}
	case WM_TIMER:
		switch wParam {
		case round7FeedbackScrollTimer:
			procKillTimer.Call(hwnd, round7FeedbackScrollTimer)
			axis := round9FeedbackCursorAxis(hwnd)
			if round7FeedbackScroll.machine.ShowTimeout(axis) {
				round9FeedbackRememberThumbs(hwnd)
			}
			return 0
		case round9FeedbackHideTimer:
			procKillTimer.Call(hwnd, round9FeedbackHideTimer)
			axis := round9FeedbackCursorAxis(hwnd)
			if round7FeedbackScroll.machine.HideTimeout(axis) {
				round9FeedbackInvalidateStoredThumbs(hwnd)
				round7FeedbackScroll.haveH = false
				round7FeedbackScroll.haveV = false
			}
			return 0
		}
	case round7FeedbackWMMouseLeave:
		if round7FeedbackScroll.machine.Phase == round9OverlayPending {
			round9FeedbackApplyAction(hwnd, round7FeedbackScroll.machine.Move(round9AxisNone))
		} else if round7FeedbackScroll.machine.Phase == round9OverlayVisible {
			round9FeedbackApplyAction(hwnd, round7FeedbackScroll.machine.Move(round9AxisNone))
		}
	case round7FeedbackWMMouseWheel, WM_HSCROLL, round7FeedbackWMVScroll:
		round9FeedbackInvalidateStoredThumbs(hwnd)
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if round7FeedbackScroll.machine.Phase == round9OverlayVisible || round7FeedbackScroll.machine.Phase == round9OverlayDragging {
			round9FeedbackRememberThumbs(hwnd)
		}
		return result
	case WM_SIZE, LVM_INSERTITEMW, LVM_DELETEALLITEMS, LVM_SETCOLUMNWIDTH:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round9FeedbackInvalidateStoredThumbs(hwnd)
		if round7FeedbackScroll.machine.Phase == round9OverlayVisible {
			round9FeedbackRememberThumbs(hwnd)
		}
		round9EnsureVisibleThumbnails(app, hwnd)
		return result
	case v452WMNCDestroy:
		procKillTimer.Call(hwnd, round7FeedbackScrollTimer)
		procKillTimer.Call(hwnd, round9FeedbackHideTimer)
		v452RemoveSubclass.Call(hwnd, round7FeedbackListSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

//go:build windows

package main

import (
	"sync"
	"syscall"
	"unsafe"
)

const (
	round7FeedbackSBHorz             = 0
	round7FeedbackSBVert             = 1
	round7FeedbackSIFAll             = 0x0017
	round7FeedbackSIFPos             = 0x0004
	round7FeedbackSBThumbTrack       = 5
	round7FeedbackWMVScroll          = 0x0115
	round7FeedbackWMMouseWheel       = 0x020A
	round7FeedbackWMCaptureChanged   = 0x0215
	round9FeedbackHideTimer          = 0x4593
	round9FeedbackHideDelay          = 220
	round9FeedbackLVMGetOrigin       = LVM_FIRST + 41
	round9FeedbackWMWindowPosChanged = 0x0047
	round9FeedbackSWPShowWindow      = 0x0040
	round9FeedbackSWHide             = 0
	round9FeedbackSWShow             = 5
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

type round9ScrollOverlay struct {
	hwnd       uintptr
	axis       uint8
	machine    round9OverlayMachine
	dragOffset int
	visible    bool
}

var (
	round7FeedbackGetScrollInfo  = user32.NewProc("GetScrollInfo")
	round7FeedbackSetScrollInfo  = user32.NewProc("SetScrollInfo")
	round9FeedbackGetCursorPos   = user32.NewProc("GetCursorPos")
	round9FeedbackScreenToClient = user32.NewProc("ScreenToClient")

	round9ScrollClassOnce sync.Once
	round9ScrollWndProcCB uintptr
	round9ScrollMu        sync.Mutex
	round9ScrollH         *round9ScrollOverlay
	round9ScrollV         *round9ScrollOverlay
	round9ScrollByHWND    sync.Map
)

func round7FeedbackHideScrollbars(hwnd uintptr) {
	round9ScrollMu.Lock()
	overlays := []*round9ScrollOverlay{round9ScrollH, round9ScrollV}
	round9ScrollMu.Unlock()
	for _, overlay := range overlays {
		if overlay == nil || overlay.hwnd == 0 {
			continue
		}
		procKillTimer.Call(overlay.hwnd, round7FeedbackScrollTimer)
		procKillTimer.Call(overlay.hwnd, round9FeedbackHideTimer)
		overlay.machine = round9OverlayMachine{}
		procInvalidateRect.Call(overlay.hwnd, 0, 0)
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
	if ok != 0 && info.NMax >= info.NMin && info.NPage > 0 {
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
	var origin point
	send(hwnd, round9FeedbackLVMGetOrigin, 0, uintptr(unsafe.Pointer(&origin)))
	info.NMin, info.NMax, info.NPage, info.NPos = 0, total-1, uint32(rc.Right-rc.Left), origin.X
	return info, true
}

func round9RegisterScrollClass() {
	round9ScrollWndProcCB = syscall.NewCallback(round9ScrollWndProc)
	hInst, _, _ := procGetModuleHandleW.Call(0)
	cursor, _, _ := procLoadCursorW.Call(0, 32512)
	wc := wndClassEx{
		CbSize:        uint32(unsafe.Sizeof(wndClassEx{})),
		LpfnWndProc:   round9ScrollWndProcCB,
		HInstance:     hInst,
		HCursor:       cursor,
		HbrBackground: COLOR_WINDOW + 1,
		LpszClassName: p("MWRound9ScrollCover"),
	}
	procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
}

func round9CreateScrollOverlay(parent uintptr, axis uint8) *round9ScrollOverlay {
	round9ScrollClassOnce.Do(round9RegisterScrollClass)
	hInst, _, _ := procGetModuleHandleW.Call(0)
	hwnd, _, _ := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(p("MWRound9ScrollCover"))),
		uintptr(unsafe.Pointer(p(""))),
		WS_CHILD|WS_VISIBLE|WS_CLIPSIBLINGS,
		0, 0, 1, 1,
		parent, 0, hInst, 0,
	)
	if hwnd == 0 {
		return nil
	}
	overlay := &round9ScrollOverlay{hwnd: hwnd, axis: axis, visible: true}
	round9ScrollByHWND.Store(hwnd, overlay)
	return overlay
}

func round9EnsureScrollOverlays(a *application) {
	if a == nil || a.hwnd == 0 || a.hList == 0 {
		return
	}
	round9ScrollMu.Lock()
	if round9ScrollH == nil || round9ScrollH.hwnd == 0 {
		round9ScrollH = round9CreateScrollOverlay(a.hwnd, round9AxisHorizontal)
	}
	if round9ScrollV == nil || round9ScrollV.hwnd == 0 {
		round9ScrollV = round9CreateScrollOverlay(a.hwnd, round9AxisVertical)
	}
	hOverlay, vOverlay := round9ScrollH, round9ScrollV
	round9ScrollMu.Unlock()
	if hOverlay == nil || vOverlay == nil {
		return
	}

	var wr rect
	if ok, _, _ := procGetWindowRect.Call(a.hList, uintptr(unsafe.Pointer(&wr))); ok == 0 {
		return
	}
	tl := point{X: wr.Left, Y: wr.Top}
	br := point{X: wr.Right, Y: wr.Bottom}
	round9FeedbackScreenToClient.Call(a.hwnd, uintptr(unsafe.Pointer(&tl)))
	round9FeedbackScreenToClient.Call(a.hwnd, uintptr(unsafe.Pointer(&br)))
	width := br.X - tl.X
	height := br.Y - tl.Y
	if width <= 0 || height <= 0 {
		return
	}
	thickness := scaleDPI(17)
	if thickness < 14 {
		thickness = 14
	}
	needH := round7FeedbackListNeedsHorizontal(a.hList)
	needV := round7FeedbackListNeedsVertical(a.hList)

	round9PositionOverlay(hOverlay, tl.X+1, br.Y-thickness, width-1, thickness, needH)
	vHeight := height - 1
	if needH {
		vHeight -= thickness
	}
	round9PositionOverlay(vOverlay, br.X-thickness, tl.Y+1, thickness, vHeight, needV)
}

func round9PositionOverlay(overlay *round9ScrollOverlay, x, y, width, height int32, show bool) {
	if overlay == nil || overlay.hwnd == 0 {
		return
	}
	if width < 1 {
		width = 1
	}
	if height < 1 {
		height = 1
	}
	if !show {
		if overlay.visible {
			procShowWindow.Call(overlay.hwnd, round9FeedbackSWHide)
			overlay.visible = false
			overlay.machine = round9OverlayMachine{}
		}
		return
	}
	procMoveWindow.Call(overlay.hwnd, uintptr(x), uintptr(y), uintptr(width), uintptr(height), 1)
	round7FeedbackSetWindowPos.Call(overlay.hwnd, 0, uintptr(x), uintptr(y), uintptr(width), uintptr(height),
		round7FeedbackSWPNoActivate|round9FeedbackSWPShowWindow)
	if !overlay.visible {
		procShowWindow.Call(overlay.hwnd, round9FeedbackSWShow)
		overlay.visible = true
	}
	procInvalidateRect.Call(overlay.hwnd, 0, 0)
}

func round9DestroyScrollOverlays() {
	round9ScrollMu.Lock()
	overlays := []*round9ScrollOverlay{round9ScrollH, round9ScrollV}
	round9ScrollH, round9ScrollV = nil, nil
	round9ScrollMu.Unlock()
	for _, overlay := range overlays {
		if overlay != nil && overlay.hwnd != 0 {
			round9ScrollByHWND.Delete(overlay.hwnd)
			procDestroyWindow.Call(overlay.hwnd)
		}
	}
}

func round9InvalidateScrollOverlays() {
	round9ScrollMu.Lock()
	overlays := []*round9ScrollOverlay{round9ScrollH, round9ScrollV}
	round9ScrollMu.Unlock()
	for _, overlay := range overlays {
		if overlay != nil && overlay.hwnd != 0 && overlay.visible {
			procInvalidateRect.Call(overlay.hwnd, 0, 0)
		}
	}
}

func round9ScrollThumb(overlay *round9ScrollOverlay) (rect, bool) {
	if overlay == nil || overlay.hwnd == 0 || app == nil || app.hList == 0 {
		return rect{}, false
	}
	var rc rect
	procGetClientRect.Call(overlay.hwnd, uintptr(unsafe.Pointer(&rc)))
	margin := int(scaleDPI(3))
	trackStart := margin
	trackLength := 0
	bar := round7FeedbackSBHorz
	if overlay.axis == round9AxisVertical {
		bar = round7FeedbackSBVert
		trackLength = int(rc.Bottom-rc.Top) - margin*2
	} else {
		trackLength = int(rc.Right-rc.Left) - margin*2
	}
	if trackLength <= 0 {
		return rect{}, false
	}
	info, ok := round7FeedbackScrollInfoFor(app.hList, bar)
	if !ok {
		return rect{}, false
	}
	start, length := round7FeedbackThumbGeometry(trackStart, trackLength, int(info.NMin), int(info.NMax), int(info.NPage), int(info.NPos))
	thickness := scaleDPI(7)
	if overlay.axis == round9AxisVertical {
		x := (rc.Right - thickness) / 2
		return rect{Left: x, Top: int32(start), Right: x + thickness, Bottom: int32(start + length)}, true
	}
	y := (rc.Bottom - thickness) / 2
	return rect{Left: int32(start), Top: y, Right: int32(start + length), Bottom: y + thickness}, true
}

func round7FeedbackPointInRect(pt point, rc rect) bool {
	return pt.X >= rc.Left && pt.X < rc.Right && pt.Y >= rc.Top && pt.Y < rc.Bottom
}

func round9OverlayCursorInside(hwnd uintptr) bool {
	var pt point
	if ok, _, _ := round9FeedbackGetCursorPos.Call(uintptr(unsafe.Pointer(&pt))); ok == 0 {
		return false
	}
	if ok, _, _ := round9FeedbackScreenToClient.Call(hwnd, uintptr(unsafe.Pointer(&pt))); ok == 0 {
		return false
	}
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	return pt.X >= rc.Left && pt.Y >= rc.Top && pt.X < rc.Right && pt.Y < rc.Bottom
}

func round9TrackOverlayMouse(hwnd uintptr) {
	track := round7FeedbackTrackMouseEvent{
		CbSize:   uint32(unsafe.Sizeof(round7FeedbackTrackMouseEvent{})),
		DwFlags:  round7FeedbackTMELeave,
		HwndTrack: hwnd,
	}
	round7FeedbackTrackMouseEventProc.Call(uintptr(unsafe.Pointer(&track)))
}

func round9ApplyOverlayAction(overlay *round9ScrollOverlay, action round9OverlayAction) {
	if overlay == nil || overlay.hwnd == 0 {
		return
	}
	switch action {
	case round9OverlayArmShow:
		procKillTimer.Call(overlay.hwnd, round7FeedbackScrollTimer)
		procSetTimer.Call(overlay.hwnd, round7FeedbackScrollTimer, round7FeedbackScrollDelay, 0)
	case round9OverlayCancelShow:
		procKillTimer.Call(overlay.hwnd, round7FeedbackScrollTimer)
	case round9OverlayArmHide:
		procKillTimer.Call(overlay.hwnd, round9FeedbackHideTimer)
		procSetTimer.Call(overlay.hwnd, round9FeedbackHideTimer, round9FeedbackHideDelay, 0)
	case round9OverlayCancelHide:
		procKillTimer.Call(overlay.hwnd, round9FeedbackHideTimer)
	}
}

func round9SetScrollFromOverlay(overlay *round9ScrollOverlay, coordinate int) {
	if overlay == nil || app == nil || app.hList == 0 {
		return
	}
	thumb, ok := round9ScrollThumb(overlay)
	if !ok {
		return
	}
	var rc rect
	procGetClientRect.Call(overlay.hwnd, uintptr(unsafe.Pointer(&rc)))
	margin := int(scaleDPI(3))
	trackLength := int(rc.Right-rc.Left) - margin*2
	thumbLength := int(thumb.Right - thumb.Left)
	bar := round7FeedbackSBHorz
	message := uint32(WM_HSCROLL)
	if overlay.axis == round9AxisVertical {
		bar = round7FeedbackSBVert
		message = round7FeedbackWMVScroll
		trackLength = int(rc.Bottom-rc.Top) - margin*2
		thumbLength = int(thumb.Bottom - thumb.Top)
	}
	info, ok := round7FeedbackScrollInfoFor(app.hList, bar)
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
	relative := coordinate - overlay.dragOffset - margin
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
	round7FeedbackSetScrollInfo.Call(app.hList, uintptr(bar), uintptr(unsafe.Pointer(&setInfo)), 0)
	packed := uintptr(uint16(round7FeedbackSBThumbTrack)) | uintptr(uint16(position))<<16
	send(app.hList, message, packed, 0)
	procInvalidateRect.Call(overlay.hwnd, 0, 0)
}

func round9PaintScrollOverlay(overlay *round9ScrollOverlay, hwnd, hdc uintptr) {
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	fillSolid(hdc, rc, colorRef(255, 255, 255))
	boundary := colorRef(207, 214, 223)
	if overlay.axis == round9AxisVertical {
		fillSolid(hdc, rect{Left: rc.Right - 1, Top: rc.Top, Right: rc.Right, Bottom: rc.Bottom}, boundary)
	} else {
		fillSolid(hdc, rect{Left: rc.Left, Top: rc.Bottom - 1, Right: rc.Right, Bottom: rc.Bottom}, boundary)
	}
	if overlay.machine.Phase != round9OverlayVisible && overlay.machine.Phase != round9OverlayDragging {
		return
	}
	thumb, ok := round9ScrollThumb(overlay)
	if !ok {
		return
	}
	color := colorRef(160, 171, 184)
	if overlay.machine.Phase == round9OverlayDragging {
		color = colorRef(110, 132, 158)
	}
	fillSolid(hdc, thumb, color)
}

func round9ScrollWndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	raw, ok := round9ScrollByHWND.Load(hwnd)
	if !ok {
		result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
	overlay := raw.(*round9ScrollOverlay)
	switch message {
	case WM_PAINT:
		var ps paintStruct
		hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		if hdc != 0 {
			round9PaintScrollOverlay(overlay, hwnd, hdc)
			procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		}
		return 0
	case WM_ERASEBKGND:
		return 1
	case WM_MOUSEMOVE:
		round9TrackOverlayMouse(hwnd)
		pt := mousePoint(lParam)
		if overlay.machine.Phase == round9OverlayDragging {
			coordinate := int(pt.X)
			if overlay.axis == round9AxisVertical {
				coordinate = int(pt.Y)
			}
			round9SetScrollFromOverlay(overlay, coordinate)
			return 0
		}
		round9ApplyOverlayAction(overlay, overlay.machine.Move(overlay.axis))
		return 0
	case round7FeedbackWMLButtonDown:
		if overlay.machine.Phase == round9OverlayVisible {
			pt := mousePoint(lParam)
			if thumb, ok := round9ScrollThumb(overlay); ok && round7FeedbackPointInRect(pt, thumb) && overlay.machine.BeginDrag(overlay.axis) {
				if overlay.axis == round9AxisVertical {
					overlay.dragOffset = int(pt.Y - thumb.Top)
				} else {
					overlay.dragOffset = int(pt.X - thumb.Left)
				}
				procKillTimer.Call(hwnd, round9FeedbackHideTimer)
				procSetCapture.Call(hwnd)
				procInvalidateRect.Call(hwnd, 0, 0)
			}
		}
		return 0
	case WM_LBUTTONUP:
		if overlay.machine.Phase == round9OverlayDragging {
			overlay.machine.EndDrag(overlay.axis)
			procReleaseCapture.Call()
			procInvalidateRect.Call(hwnd, 0, 0)
		}
		return 0
	case round7FeedbackWMCaptureChanged:
		if overlay.machine.Phase == round9OverlayDragging {
			overlay.machine.EndDrag(overlay.axis)
			procInvalidateRect.Call(hwnd, 0, 0)
		}
		return 0
	case WM_TIMER:
		switch wParam {
		case round7FeedbackScrollTimer:
			procKillTimer.Call(hwnd, round7FeedbackScrollTimer)
			current := round9AxisNone
			if round9OverlayCursorInside(hwnd) {
				current = overlay.axis
			}
			if overlay.machine.ShowTimeout(current) {
				procInvalidateRect.Call(hwnd, 0, 0)
			}
			return 0
		case round9FeedbackHideTimer:
			procKillTimer.Call(hwnd, round9FeedbackHideTimer)
			current := round9AxisNone
			if round9OverlayCursorInside(hwnd) {
				current = overlay.axis
			}
			if overlay.machine.HideTimeout(current) {
				procInvalidateRect.Call(hwnd, 0, 0)
			}
			return 0
		}
	case round7FeedbackWMMouseLeave:
		round9ApplyOverlayAction(overlay, overlay.machine.Move(round9AxisNone))
		return 0
	case v452WMNCDestroy:
		round9ScrollByHWND.Delete(hwnd)
	}
	result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return result
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
			round9FeedbackDrawListBoundary(hwnd, hdc)
			round7ListReleaseDC.Call(hwnd, hdc)
		}
		round9EnsureVisibleThumbnails(app, hwnd)
		round9EnsureScrollOverlays(app)
		return result
	case round7FeedbackWMPrint, round7FeedbackWMPrintClient:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if wParam != 0 {
			round7DrawListOverlay(app, wParam)
			round9FeedbackDrawListBoundary(hwnd, wParam)
		}
		return result
	case round7FeedbackWMMouseWheel, WM_HSCROLL, round7FeedbackWMVScroll:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round9InvalidateScrollOverlays()
		return result
	case WM_SIZE, round9FeedbackWMWindowPosChanged, LVM_INSERTITEMW, LVM_DELETEALLITEMS, LVM_SETCOLUMNWIDTH:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round9EnsureScrollOverlays(app)
		round9EnsureVisibleThumbnails(app, hwnd)
		return result
	case v452WMNCDestroy:
		round9DestroyScrollOverlays()
		v452RemoveSubclass.Call(hwnd, round7FeedbackListSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

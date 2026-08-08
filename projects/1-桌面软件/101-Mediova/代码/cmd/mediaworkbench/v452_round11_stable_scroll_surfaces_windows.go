//go:build windows

package main

import (
	"sync"
	"syscall"
	"unsafe"
)

const (
	round11StableCoverMainSubclassID = 0x45B5
	round11StableCoverListSubclassID = 0x45B6
	round11StableCoverShowTimer      = 0x45B7
	round11StableCoverHideTimer      = 0x45B8
	round11StableCoverShowDelay      = 500
	round11StableCoverHideDelay      = 220
)

type round11StableCoverPhase uint8

const (
	round11CoverHidden round11StableCoverPhase = iota
	round11CoverPending
	round11CoverVisible
	round11CoverDragging
)

type round11StableCover struct {
	hwnd       uintptr
	axis       uint8
	phase      round11StableCoverPhase
	dragOffset int
	geometry   round11OverlayGeometry
}

var (
	round11StableCoverOnce     sync.Once
	round11StableCoverWndProc  uintptr
	round11StableCoverMainCB   uintptr
	round11StableCoverListCB   uintptr
	round11StableCoverByHWND   sync.Map
	round11StableCoverH        *round11StableCover
	round11StableCoverV        *round11StableCover
)

func init() {
	round11StableCoverWndProc = syscall.NewCallback(round11StableCoverProc)
	round11StableCoverMainCB = syscall.NewCallback(round11StableCoverMainSubclassProc)
	round11StableCoverListCB = syscall.NewCallback(round11StableCoverListSubclassProc)
}

func round11RegisterStableCoverClass() {
	hInst, _, _ := procGetModuleHandleW.Call(0)
	cursor, _, _ := procLoadCursorW.Call(0, 32512)
	wc := wndClassEx{
		CbSize:        uint32(unsafe.Sizeof(wndClassEx{})),
		LpfnWndProc:   round11StableCoverWndProc,
		HInstance:     hInst,
		HCursor:       cursor,
		HbrBackground: COLOR_WINDOW + 1,
		LpszClassName: p("MWRound11StableScrollSurface"),
	}
	procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
}

func round11CreateStableCover(parent uintptr, axis uint8) *round11StableCover {
	round11StableCoverOnce.Do(round11RegisterStableCoverClass)
	hInst, _, _ := procGetModuleHandleW.Call(0)
	hwnd, _, _ := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(p("MWRound11StableScrollSurface"))),
		uintptr(unsafe.Pointer(p(""))),
		WS_CHILD|WS_VISIBLE|WS_CLIPSIBLINGS,
		0, 0, 1, 1,
		parent, 0, hInst, 0,
	)
	if hwnd == 0 {
		return nil
	}
	cover := &round11StableCover{hwnd: hwnd, axis: axis, phase: round11CoverHidden}
	round11StableCoverByHWND.Store(hwnd, cover)
	return cover
}

func round11HideLegacyScrollOverlays() {
	round9ScrollMu.Lock()
	legacy := []*round9ScrollOverlay{round9ScrollH, round9ScrollV}
	round9ScrollMu.Unlock()
	for _, overlay := range legacy {
		if overlay == nil || overlay.hwnd == 0 {
			continue
		}
		procKillTimer.Call(overlay.hwnd, round7FeedbackScrollTimer)
		procKillTimer.Call(overlay.hwnd, round9FeedbackHideTimer)
		procShowWindow.Call(overlay.hwnd, round9FeedbackSWHide)
		overlay.visible = false
		overlay.machine = round9OverlayMachine{}
	}
}

func round11InstallStableScrollSurfaces(a *application) {
	if a == nil || a.hwnd == 0 || a.hList == 0 {
		return
	}
	v452RemoveSubclass.Call(a.hwnd, round11StableCoverMainCB, round11StableCoverMainSubclassID)
	v452RemoveSubclass.Call(a.hList, round11StableCoverListCB, round11StableCoverListSubclassID)
	v452SetWindowSubclass.Call(a.hwnd, round11StableCoverMainCB, round11StableCoverMainSubclassID, 0)
	v452SetWindowSubclass.Call(a.hList, round11StableCoverListCB, round11StableCoverListSubclassID, 0)
	if round11StableCoverH == nil || round11StableCoverH.hwnd == 0 {
		round11StableCoverH = round11CreateStableCover(a.hwnd, round9AxisHorizontal)
	}
	if round11StableCoverV == nil || round11StableCoverV.hwnd == 0 {
		round11StableCoverV = round11CreateStableCover(a.hwnd, round9AxisVertical)
	}
	round11PositionStableScrollSurfaces(a)
}

func round11SetStableCoverGeometry(cover *round11StableCover, x, y, width, height int32) {
	if cover == nil || cover.hwnd == 0 || width <= 0 || height <= 0 {
		return
	}
	geometry := round11OverlayGeometry{x: x, y: y, width: width, height: height, valid: true}
	if cover.geometry == geometry {
		round7FeedbackSetWindowPos.Call(
			cover.hwnd, 0, 0, 0, 0, 0,
			round7FeedbackSWPNoMove|round7FeedbackSWPNoSize|round7FeedbackSWPNoActivate|round9FeedbackSWPShowWindow,
		)
		return
	}
	cover.geometry = geometry
	round7FeedbackSetWindowPos.Call(
		cover.hwnd, 0,
		uintptr(x), uintptr(y), uintptr(width), uintptr(height),
		round7FeedbackSWPNoActivate|round9FeedbackSWPShowWindow,
	)
}

func round11PositionStableScrollSurfaces(a *application) {
	if a == nil || a.hwnd == 0 || a.hList == 0 || round11StableCoverH == nil || round11StableCoverV == nil {
		return
	}
	round11HideLegacyScrollOverlays()
	var wr rect
	if ok, _, _ := procGetWindowRect.Call(a.hList, uintptr(unsafe.Pointer(&wr))); ok == 0 {
		return
	}
	topLeft := point{X: wr.Left, Y: wr.Top}
	bottomRight := point{X: wr.Right, Y: wr.Bottom}
	round9FeedbackScreenToClient.Call(a.hwnd, uintptr(unsafe.Pointer(&topLeft)))
	round9FeedbackScreenToClient.Call(a.hwnd, uintptr(unsafe.Pointer(&bottomRight)))
	width := bottomRight.X - topLeft.X
	height := bottomRight.Y - topLeft.Y
	if width <= 0 || height <= 0 {
		return
	}
	thickness := scaleDPI(17)
	if thickness < 14 {
		thickness = 14
	}
	round11SetStableCoverGeometry(round11StableCoverH, topLeft.X+1, bottomRight.Y-thickness, width-1, thickness)
	verticalHeight := height - thickness - 1
	if verticalHeight < 1 {
		verticalHeight = 1
	}
	round11SetStableCoverGeometry(round11StableCoverV, bottomRight.X-thickness, topLeft.Y+1, thickness, verticalHeight)
}

func round11StableCoverMainSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	switch message {
	case WM_SIZE:
		round11PositionStableScrollSurfaces(app)
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round11StableCoverMainCB, subclassID)
	}
	return result
}

func round11StableCoverListSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	switch message {
	case WM_SIZE, round9FeedbackWMWindowPosChanged, LVM_SETCOLUMNWIDTH, LVM_INSERTITEMW, LVM_DELETEALLITEMS:
		round11PositionStableScrollSurfaces(app)
	case round7FeedbackWMMouseWheel, WM_HSCROLL, round7FeedbackWMVScroll:
		round11InvalidateStableCoverThumbs()
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round11StableCoverListCB, subclassID)
	}
	return result
}

func round11StableCoverThumb(cover *round11StableCover) (rect, bool) {
	if cover == nil || cover.hwnd == 0 || app == nil || app.hList == 0 {
		return rect{}, false
	}
	var rc rect
	procGetClientRect.Call(cover.hwnd, uintptr(unsafe.Pointer(&rc)))
	margin := int(scaleDPI(3))
	trackLength := int(rc.Right-rc.Left) - margin*2
	bar := round7FeedbackSBHorz
	if cover.axis == round9AxisVertical {
		bar = round7FeedbackSBVert
		trackLength = int(rc.Bottom-rc.Top) - margin*2
	}
	if trackLength <= 0 {
		return rect{}, false
	}
	info, ok := round7FeedbackScrollInfoFor(app.hList, bar)
	if !ok {
		return rect{}, false
	}
	start, length := round7FeedbackThumbGeometry(margin, trackLength, int(info.NMin), int(info.NMax), int(info.NPage), int(info.NPos))
	thickness := scaleDPI(7)
	if cover.axis == round9AxisVertical {
		x := (rc.Right - thickness) / 2
		return rect{Left: x, Top: int32(start), Right: x + thickness, Bottom: int32(start + length)}, true
	}
	y := (rc.Bottom - thickness) / 2
	return rect{Left: int32(start), Top: y, Right: int32(start + length), Bottom: y + thickness}, true
}

func round11PaintStableCover(cover *round11StableCover, hwnd, hdc uintptr) {
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	fillSolid(hdc, rc, colorRef(255, 255, 255))
	line := colorRef(207, 214, 223)
	if cover.axis == round9AxisVertical {
		fillSolid(hdc, rect{Left: rc.Right - 1, Top: rc.Top, Right: rc.Right, Bottom: rc.Bottom}, line)
	} else {
		fillSolid(hdc, rect{Left: rc.Left, Top: rc.Bottom - 1, Right: rc.Right, Bottom: rc.Bottom}, line)
	}
	if cover.phase != round11CoverVisible && cover.phase != round11CoverDragging {
		return
	}
	thumb, ok := round11StableCoverThumb(cover)
	if !ok {
		return
	}
	color := colorRef(160, 171, 184)
	if cover.phase == round11CoverDragging {
		color = colorRef(110, 132, 158)
	}
	fillSolid(hdc, thumb, color)
}

func round11StableCoverCursorInside(hwnd uintptr) bool {
	return round9OverlayCursorInside(hwnd)
}

func round11TrackStableCoverMouse(hwnd uintptr) {
	round9TrackOverlayMouse(hwnd)
}

func round11ArmStableCoverHideWatch(cover *round11StableCover) {
	if cover == nil || cover.hwnd == 0 || cover.phase != round11CoverVisible {
		return
	}
	procSetTimer.Call(cover.hwnd, round11StableCoverHideTimer, round11StableCoverHideDelay, 0)
}

func round11InvalidateStableCoverThumbs() {
	for _, cover := range []*round11StableCover{round11StableCoverH, round11StableCoverV} {
		if cover != nil && cover.hwnd != 0 {
			procInvalidateRect.Call(cover.hwnd, 0, 0)
		}
	}
}

func round11SetScrollFromStableCover(cover *round11StableCover, coordinate int) {
	if cover == nil || app == nil || app.hList == 0 {
		return
	}
	thumb, ok := round11StableCoverThumb(cover)
	if !ok {
		return
	}
	var rc rect
	procGetClientRect.Call(cover.hwnd, uintptr(unsafe.Pointer(&rc)))
	margin := int(scaleDPI(3))
	trackLength := int(rc.Right-rc.Left) - margin*2
	thumbLength := int(thumb.Right - thumb.Left)
	bar := round7FeedbackSBHorz
	message := uint32(WM_HSCROLL)
	if cover.axis == round9AxisVertical {
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
	relative := coordinate - cover.dragOffset - margin
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
	procInvalidateRect.Call(cover.hwnd, 0, 0)
}

func round11StableCoverProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	raw, ok := round11StableCoverByHWND.Load(hwnd)
	if !ok {
		result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
	cover := raw.(*round11StableCover)
	switch message {
	case WM_PAINT:
		var ps paintStruct
		hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		if hdc != 0 {
			round11PaintStableCover(cover, hwnd, hdc)
			procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		}
		return 0
	case WM_ERASEBKGND:
		return 1
	case WM_MOUSEMOVE:
		round11TrackStableCoverMouse(hwnd)
		pt := mousePoint(lParam)
		if cover.phase == round11CoverDragging {
			coordinate := int(pt.X)
			if cover.axis == round9AxisVertical {
				coordinate = int(pt.Y)
			}
			round11SetScrollFromStableCover(cover, coordinate)
			return 0
		}
		procKillTimer.Call(hwnd, round11StableCoverHideTimer)
		if cover.phase == round11CoverHidden {
			cover.phase = round11CoverPending
			procSetTimer.Call(hwnd, round11StableCoverShowTimer, round11StableCoverShowDelay, 0)
		} else if cover.phase == round11CoverVisible {
			round11ArmStableCoverHideWatch(cover)
		}
		return 0
	case round7FeedbackWMLButtonDown:
		if cover.phase == round11CoverVisible {
			pt := mousePoint(lParam)
			if thumb, ok := round11StableCoverThumb(cover); ok && round7FeedbackPointInRect(pt, thumb) {
				cover.phase = round11CoverDragging
				procKillTimer.Call(hwnd, round11StableCoverHideTimer)
				if cover.axis == round9AxisVertical {
					cover.dragOffset = int(pt.Y - thumb.Top)
				} else {
					cover.dragOffset = int(pt.X - thumb.Left)
				}
				procSetCapture.Call(hwnd)
				procInvalidateRect.Call(hwnd, 0, 0)
			}
		}
		return 0
	case WM_LBUTTONUP:
		if cover.phase == round11CoverDragging {
			cover.phase = round11CoverVisible
			procReleaseCapture.Call()
			procInvalidateRect.Call(hwnd, 0, 0)
			round11ArmStableCoverHideWatch(cover)
		}
		return 0
	case round7FeedbackWMCaptureChanged:
		if cover.phase == round11CoverDragging {
			cover.phase = round11CoverVisible
			procInvalidateRect.Call(hwnd, 0, 0)
			round11ArmStableCoverHideWatch(cover)
		}
		return 0
	case WM_TIMER:
		switch wParam {
		case round11StableCoverShowTimer:
			procKillTimer.Call(hwnd, round11StableCoverShowTimer)
			if cover.phase == round11CoverPending {
				if round11StableCoverCursorInside(hwnd) {
					cover.phase = round11CoverVisible
					procInvalidateRect.Call(hwnd, 0, 0)
					round11ArmStableCoverHideWatch(cover)
				} else {
					cover.phase = round11CoverHidden
				}
			}
			return 0
		case round11StableCoverHideTimer:
			procKillTimer.Call(hwnd, round11StableCoverHideTimer)
			if cover.phase == round11CoverVisible {
				if !round11StableCoverCursorInside(hwnd) {
					cover.phase = round11CoverHidden
					procInvalidateRect.Call(hwnd, 0, 0)
				} else {
					round11ArmStableCoverHideWatch(cover)
				}
			}
			return 0
		}
	case round7FeedbackWMMouseLeave:
		procKillTimer.Call(hwnd, round11StableCoverShowTimer)
		if cover.phase == round11CoverPending {
			cover.phase = round11CoverHidden
		} else if cover.phase == round11CoverVisible {
			round11ArmStableCoverHideWatch(cover)
		}
		return 0
	case v452WMNCDestroy:
		procKillTimer.Call(hwnd, round11StableCoverShowTimer)
		procKillTimer.Call(hwnd, round11StableCoverHideTimer)
		round11StableCoverByHWND.Delete(hwnd)
	}
	result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

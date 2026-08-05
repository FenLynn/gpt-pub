//go:build windows

package main

import "unsafe"

func round7FeedbackTimelineSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case WM_PAINT:
		e := round7ActiveEditor
		if e != nil && e.hTimeline == hwnd {
			round7FeedbackPaintTimeline(e, hwnd)
			return 0
		}
	case WM_ERASEBKGND:
		return 1
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round7FeedbackTimelineCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round7FeedbackCanvasSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case WM_ERASEBKGND:
		// The preview class paints the complete frame itself. Suppressing the
		// background erase removes the white flash seen while releasing a drag.
		return 1
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round7FeedbackCanvasCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round7FeedbackPaintTimeline(e *round7Editor, hwnd uintptr) {
	var ps paintStruct
	hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	if hdc == 0 {
		return
	}
	defer procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	width := rc.Right - rc.Left
	height := rc.Bottom - rc.Top
	if width <= 0 || height <= 0 {
		return
	}

	target := hdc
	memDC, _, _ := procCreateCompatibleDC.Call(hdc)
	var bitmap, oldBitmap uintptr
	if memDC != 0 {
		bitmap, _, _ = round7FeedbackCreateCompatibleBmp.Call(hdc, uintptr(width), uintptr(height))
		if bitmap != 0 {
			oldBitmap, _, _ = procSelectObject.Call(memDC, bitmap)
			target = memDC
		}
	}
	round7FeedbackDrawTimelineSurface(e, target, rc)
	if target == memDC && memDC != 0 && bitmap != 0 {
		round7FeedbackBitBlt.Call(hdc, 0, 0, uintptr(width), uintptr(height), memDC, 0, 0, SRCCOPY)
		procSelectObject.Call(memDC, oldBitmap)
		procDeleteObject.Call(bitmap)
		procDeleteDC.Call(memDC)
	} else if memDC != 0 {
		procDeleteDC.Call(memDC)
	}
}

func round7FeedbackDrawTimelineSurface(e *round7Editor, hdc uintptr, rc rect) {
	fillSolid(hdc, rc, colorRef(250, 251, 253))
	left, right, trackY := e.timelineGeometry()
	startX := e.timeToX(e.dialog.opts.TrimStart)
	endX := e.timeToX(e.dialog.opts.TrimEnd)
	currentX := e.timeToX(e.dialog.currentAt)

	track := rect{Left: left, Top: trackY - scaleDPI(3), Right: right, Bottom: trackY + scaleDPI(4)}
	fillSolid(hdc, track, colorRef(226, 231, 237))
	round7TimelineLine(hdc, left, trackY, right, trackY, colorRef(142, 153, 168), 1)

	rangeTop := trackY - scaleDPI(20)
	rangeBottom := trackY - scaleDPI(8)
	rangeAll := rect{Left: left, Top: rangeTop, Right: right, Bottom: rangeBottom}
	fillSolid(hdc, rangeAll, colorRef(237, 240, 244))
	rangeSelected := rangeAll
	rangeSelected.Left = startX
	rangeSelected.Right = endX
	fillSolid(hdc, rangeSelected, colorRef(187, 213, 245))

	blue := colorRef(43, 105, 190)
	for _, x := range []int32{startX, endX} {
		handle := rect{
			Left:   x - scaleDPI(5),
			Top:    rangeTop - scaleDPI(3),
			Right:  x + scaleDPI(6),
			Bottom: rangeBottom + scaleDPI(3),
		}
		fillSolid(hdc, handle, blue)
		round7TimelineLine(hdc, x, rangeBottom, x, trackY+scaleDPI(14), blue, 2)
	}

	gray := colorRef(91, 101, 114)
	round7TimelineLine(hdc, left, trackY-scaleDPI(8), left, trackY+scaleDPI(13), gray, 2)
	round7TimelineLine(hdc, right, trackY-scaleDPI(8), right, trackY+scaleDPI(13), gray, 2)

	red := colorRef(214, 61, 54)
	round7TimelineLine(hdc, currentX, trackY-scaleDPI(26), currentX, trackY+scaleDPI(24), red, 2)
	points := []point{
		{X: currentX - scaleDPI(6), Y: trackY + scaleDPI(17)},
		{X: currentX + scaleDPI(6), Y: trackY + scaleDPI(17)},
		{X: currentX, Y: trackY + scaleDPI(26)},
	}
	round7FillPolygon(hdc, points, red)

	round7TimelineText(hdc, "剪辑起点", round7MarkerLabelRect(startX, rc.Right, 0), DT_CENTER, blue)
	round7TimelineText(hdc, "剪辑终点", round7MarkerLabelRect(endX, rc.Right, 0), DT_CENTER, blue)
	round7TimelineText(hdc, "源起点", rect{Left: left, Top: trackY + scaleDPI(27), Right: left + scaleDPI(72), Bottom: rc.Bottom}, DT_LEFT, gray)
	round7TimelineText(hdc, "源终点", rect{Left: right - scaleDPI(72), Top: trackY + scaleDPI(27), Right: right, Bottom: rc.Bottom}, DT_RIGHT, gray)
	round7TimelineText(hdc, "当前", round7MarkerLabelRect(currentX, rc.Right, trackY+scaleDPI(27)), DT_CENTER, red)
}

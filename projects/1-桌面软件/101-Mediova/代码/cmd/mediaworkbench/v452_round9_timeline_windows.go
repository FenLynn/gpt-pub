//go:build windows

package main

import (
	"unsafe"

	"mediaworkbench/internal/model"
)

func round9TimelineGeometry(hwnd uintptr) (left, right, barTop, barBottom int32) {
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	left = 1
	right = rc.Right - 1
	if right <= left {
		right = left + 1
	}
	barTop = scaleDPI(25)
	barBottom = barTop + scaleDPI(12)
	return
}

func round9TimelineTimeToX(e *round7Editor, value float64) int32 {
	left, right, _, _ := round9TimelineGeometry(e.hTimeline)
	duration := e.dialog.task.Duration
	if duration <= 0 {
		return left
	}
	if value < 0 {
		value = 0
	}
	if value > duration {
		value = duration
	}
	return left + int32(value/duration*float64(right-left))
}

func round9TimelineXToTime(e *round7Editor, x int32) float64 {
	left, right, _, _ := round9TimelineGeometry(e.hTimeline)
	if x < left {
		x = left
	}
	if x > right {
		x = right
	}
	if right <= left || e.dialog.task.Duration <= 0 {
		return 0
	}
	return float64(x-left) / float64(right-left) * e.dialog.task.Duration
}

func round9TimelineHit(e *round7Editor, x int32) round7TimelineDrag {
	tolerance := scaleDPI(9)
	startX := round9TimelineTimeToX(e, e.dialog.opts.TrimStart)
	endX := round9TimelineTimeToX(e, e.dialog.opts.TrimEnd)
	abs := func(v int32) int32 {
		if v < 0 {
			return -v
		}
		return v
	}
	if abs(x-startX) <= tolerance {
		return round7DragTrimStart
	}
	if abs(x-endX) <= tolerance {
		return round7DragTrimEnd
	}
	return round7DragCurrent
}

func round9PaintTimeline(e *round7Editor, hwnd uintptr) {
	var ps paintStruct
	hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	if hdc == 0 {
		return
	}
	defer procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	width, height := rc.Right, rc.Bottom
	if width <= 0 || height <= 0 {
		return
	}
	memDC, _, _ := procCreateCompatibleDC.Call(hdc)
	bitmap, _, _ := round7FeedbackCreateCompatibleBmp.Call(hdc, uintptr(width), uintptr(height))
	if memDC == 0 || bitmap == 0 {
		return
	}
	oldBitmap, _, _ := procSelectObject.Call(memDC, bitmap)
	fillSolid(memDC, rc, colorRef(250, 251, 253))
	if e == nil || e.dialog == nil || e.dialog.task == nil || e.dialog.task.Kind == model.KindImage {
		drawCenteredText(memDC, "图片任务无时间轴", rc, uiFontSmall, colorRef(133, 143, 156))
	} else {
		left, right, barTop, barBottom := round9TimelineGeometry(hwnd)
		startX := round9TimelineTimeToX(e, e.dialog.opts.TrimStart)
		endX := round9TimelineTimeToX(e, e.dialog.opts.TrimEnd)
		currentX := round9TimelineTimeToX(e, e.dialog.currentAt)
		gray := colorRef(224, 229, 235)
		startBlue := colorRef(109, 174, 235)
		endBlue := colorRef(38, 101, 188)
		red := colorRef(218, 57, 51)
		round7TimelineText(memDC, formatSecondsClock(0), rect{Left: left, Top: 0, Right: left + scaleDPI(132), Bottom: scaleDPI(20)}, DT_LEFT, colorRef(105, 116, 130))
		round7TimelineText(memDC, formatSecondsClock(e.dialog.task.Duration), rect{Left: right - scaleDPI(132), Top: 0, Right: right, Bottom: scaleDPI(20)}, DT_RIGHT, colorRef(105, 116, 130))
		fillSolid(memDC, rect{Left: left, Top: barTop, Right: right, Bottom: barBottom}, gray)
		fillSolid(memDC, rect{Left: startX, Top: barTop, Right: endX, Bottom: barBottom}, colorRef(145, 194, 241))
		round7TimelineLine(memDC, startX, barTop-scaleDPI(5), startX, barBottom+scaleDPI(5), startBlue, 2)
		round7TimelineLine(memDC, endX, barTop-scaleDPI(5), endX, barBottom+scaleDPI(5), endBlue, 2)
		arrowBaseY := barBottom + scaleDPI(11)
		arrow := []point{{X: currentX, Y: barBottom}, {X: currentX - scaleDPI(6), Y: arrowBaseY}, {X: currentX + scaleDPI(6), Y: arrowBaseY}}
		round7FillPolygon(memDC, arrow, red)
		labelW := scaleDPI(124)
		labelLeft := currentX - labelW/2
		if labelLeft < left {
			labelLeft = currentX + scaleDPI(8)
		}
		if labelLeft+labelW > right {
			labelLeft = currentX - labelW - scaleDPI(8)
		}
		if labelLeft < left {
			labelLeft = left
		}
		round7TimelineText(memDC, formatSecondsClock(e.dialog.currentAt), rect{Left: labelLeft, Top: arrowBaseY + scaleDPI(2), Right: labelLeft + labelW, Bottom: rc.Bottom}, DT_CENTER, red)
	}
	round7FeedbackBitBlt.Call(hdc, 0, 0, uintptr(width), uintptr(height), memDC, 0, 0, SRCCOPY)
	procSelectObject.Call(memDC, oldBitmap)
	procDeleteObject.Call(bitmap)
	procDeleteDC.Call(memDC)
}

func round9TimelineSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	e := round7ActiveEditor
	if e == nil || e.hTimeline != hwnd {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
	switch message {
	case WM_PAINT:
		round9PaintTimeline(e, hwnd)
		return 0
	case WM_ERASEBKGND:
		return 1
	case WM_LBUTTONDOWN:
		if e.dialog.task.Kind == model.KindImage {
			return 0
		}
		pt := mousePoint(lParam)
		e.drag = round9TimelineHit(e, pt.X)
		procSetCapture.Call(hwnd)
		value := round9TimelineXToTime(e, pt.X)
		switch e.drag {
		case round7DragTrimStart:
			e.setTrimStart(value)
		case round7DragTrimEnd:
			e.setTrimEnd(value)
		default:
			e.setCurrent(value, false)
		}
		round7FeedbackRefreshInfoCard(e)
		return 0
	case WM_MOUSEMOVE:
		if e.drag != round7DragNone {
			pt := mousePoint(lParam)
			value := round9TimelineXToTime(e, pt.X)
			switch e.drag {
			case round7DragTrimStart:
				e.setTrimStart(value)
			case round7DragTrimEnd:
				e.setTrimEnd(value)
			default:
				e.setCurrent(value, false)
			}
			round7FeedbackRefreshInfoCard(e)
			return 0
		}
	case WM_LBUTTONUP:
		if e.drag != round7DragNone {
			drag := e.drag
			e.drag = round7DragNone
			procReleaseCapture.Call()
			if drag == round7DragCurrent {
				e.dialog.generatePreviewFrame()
			}
			round7FeedbackRefreshInfoCard(e)
			return 0
		}
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round9TimelineSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

//go:build windows

package main

import (
	"path/filepath"
	"unsafe"

	"mediaworkbench/internal/model"
)

func round7FeedbackTimelineSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case WM_PAINT:
		e := round7ActiveEditor
		if e != nil && e.hTimeline == hwnd {
			if e.dialog != nil && e.dialog.task != nil && e.hFileLabel != 0 {
				name := filepath.Base(e.dialog.task.Input)
				if getText(e.hFileLabel) != name {
					setText(e.hFileLabel, name)
				}
			}
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

func round7FeedbackPaintTimeline(e *round7Editor, hwnd uintptr) {
	var ps paintStruct
	hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	if hdc == 0 {
		return
	}
	defer procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	width, height := rc.Right-rc.Left, rc.Bottom-rc.Top
	if width <= 0 || height <= 0 {
		return
	}

	memDC, _, _ := procCreateCompatibleDC.Call(hdc)
	bitmap, _, _ := round7FeedbackCreateCompatibleBmp.Call(hdc, uintptr(width), uintptr(height))
	if memDC == 0 || bitmap == 0 {
		if memDC != 0 {
			procDeleteDC.Call(memDC)
		}
		if bitmap != 0 {
			procDeleteObject.Call(bitmap)
		}
		round7FeedbackDrawTimelineSurface(e, hdc, rc)
		return
	}
	oldBitmap, _, _ := procSelectObject.Call(memDC, bitmap)
	round7FeedbackDrawTimelineSurface(e, memDC, rc)
	round7FeedbackBitBlt.Call(hdc, 0, 0, uintptr(width), uintptr(height), memDC, 0, 0, SRCCOPY)
	procSelectObject.Call(memDC, oldBitmap)
	procDeleteObject.Call(bitmap)
	procDeleteDC.Call(memDC)
}

func round7FeedbackDrawTimelineSurface(e *round7Editor, hdc uintptr, rc rect) {
	fillSolid(hdc, rc, colorRef(250, 251, 253))
	if e == nil || e.dialog == nil || e.dialog.task == nil || e.dialog.task.Kind == model.KindImage {
		drawCenteredText(hdc, "图片任务无时间轴", rc, uiFontSmall, colorRef(133, 143, 156))
		return
	}

	left, right, trackY := e.timelineGeometry()
	startX := e.timeToX(e.dialog.opts.TrimStart)
	endX := e.timeToX(e.dialog.opts.TrimEnd)
	currentX := e.timeToX(e.dialog.currentAt)

	gray := colorRef(111, 122, 136)
	blue := colorRef(42, 108, 197)
	red := colorRef(215, 62, 55)

	timeTop := int32(1)
	round7TimelineText(hdc, formatSecondsClock(0), rect{Left: left, Top: timeTop, Right: left + scaleDPI(132), Bottom: timeTop + scaleDPI(22)}, DT_LEFT, gray)
	round7TimelineText(hdc, formatSecondsClock(e.dialog.task.Duration), rect{Left: right - scaleDPI(132), Top: timeTop, Right: right, Bottom: timeTop + scaleDPI(22)}, DT_RIGHT, gray)

	track := rect{Left: left, Top: trackY - scaleDPI(3), Right: right, Bottom: trackY + scaleDPI(4)}
	fillSolid(hdc, track, colorRef(225, 231, 238))
	round7TimelineLine(hdc, left, trackY, right, trackY, colorRef(149, 160, 174), 1)

	bandTop := trackY - scaleDPI(18)
	bandBottom := trackY - scaleDPI(8)
	fillSolid(hdc, rect{Left: left, Top: bandTop, Right: right, Bottom: bandBottom}, colorRef(237, 241, 246))
	fillSolid(hdc, rect{Left: startX, Top: bandTop, Right: endX, Bottom: bandBottom}, colorRef(184, 213, 248))

	round7TimelineLine(hdc, startX, bandTop-scaleDPI(3), startX, trackY+scaleDPI(8), blue, 2)
	startFlag := []point{{X: startX, Y: bandTop - scaleDPI(4)}, {X: startX + scaleDPI(14), Y: bandTop + scaleDPI(2)}, {X: startX, Y: bandTop + scaleDPI(8)}}
	round7FillPolygon(hdc, startFlag, blue)

	round7TimelineLine(hdc, endX, bandTop-scaleDPI(3), endX, trackY+scaleDPI(8), blue, 2)
	endFlag := []point{{X: endX, Y: bandTop - scaleDPI(4)}, {X: endX - scaleDPI(14), Y: bandTop + scaleDPI(2)}, {X: endX, Y: bandTop + scaleDPI(8)}}
	round7FillPolygon(hdc, endFlag, blue)

	startLabel := round7FeedbackTimelineLabelRect(startX, rc.Right, trackY-scaleDPI(42), scaleDPI(72))
	endLabel := round7FeedbackTimelineLabelRect(endX, rc.Right, trackY-scaleDPI(42), scaleDPI(72))
	if round7FeedbackRectsOverlap(startLabel, endLabel, scaleDPI(6)) {
		startLabel.Top -= scaleDPI(16)
		startLabel.Bottom -= scaleDPI(16)
	}
	round7TimelineText(hdc, "剪辑起点", startLabel, DT_CENTER, blue)
	round7TimelineText(hdc, "剪辑终点", endLabel, DT_CENTER, blue)

	round7TimelineLine(hdc, currentX, trackY-scaleDPI(5), currentX, trackY+scaleDPI(18), red, 2)
	currentFlag := []point{{X: currentX - scaleDPI(6), Y: trackY + scaleDPI(13)}, {X: currentX + scaleDPI(6), Y: trackY + scaleDPI(13)}, {X: currentX, Y: trackY + scaleDPI(22)}}
	round7FillPolygon(hdc, currentFlag, red)
	currentLabel := round7FeedbackTimelineLabelRect(currentX, rc.Right, trackY+scaleDPI(24), scaleDPI(108))
	round7TimelineText(hdc, "当前  "+formatSecondsClock(e.dialog.currentAt), currentLabel, DT_CENTER, red)
}

func round7FeedbackTimelineLabelRect(center, clientRight, top, width int32) rect {
	left := center - width/2
	if left < 0 {
		left = 0
	}
	if left+width > clientRight {
		left = clientRight - width
	}
	if left < 0 {
		left = 0
	}
	return rect{Left: left, Top: top, Right: left + width, Bottom: top + scaleDPI(20)}
}

func round7FeedbackRectsOverlap(left, right rect, gap int32) bool {
	return left.Left < right.Right+gap && left.Right+gap > right.Left && left.Top < right.Bottom && left.Bottom > right.Top
}

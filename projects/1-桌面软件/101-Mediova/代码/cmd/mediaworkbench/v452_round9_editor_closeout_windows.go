//go:build windows

package main

import (
	"path/filepath"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

const (
	round9EditorSubclassID   = 0x4595
	round9TimelineSubclassID = 0x4596
	round9CanvasSubclassID   = 0x4597
	round9WMSetCursor        = 0x0020
)

type round9EditorDecor struct {
	previewTitle uintptr
}

type round9CanvasDragState struct {
	active      bool
	started     bool
	mode        round9CropMode
	startImage  point
	startClient point
	original    round9CropBox
	lastSync    time.Time
}

var (
	round9EditorSubclassCB   = syscall.NewCallback(round9EditorSubclassProc)
	round9TimelineSubclassCB = syscall.NewCallback(round9TimelineSubclassProc)
	round9CanvasSubclassCB   = syscall.NewCallback(round9CanvasSubclassProc)
	round9EditorDecorMap     sync.Map
	round9CanvasDragMap      sync.Map
	round9SetCursor          = user32.NewProc("SetCursor")
)

func round9InstallEditorCloseout(e *round7Editor) {
	if e == nil || e.hwnd == 0 || e.hTimeline == 0 || e.dialog == nil || e.dialog.hCanvas == 0 {
		return
	}
	v452SetWindowSubclass.Call(e.hwnd, round9EditorSubclassCB, round9EditorSubclassID, 0)
	v452SetWindowSubclass.Call(e.hTimeline, round9TimelineSubclassCB, round9TimelineSubclassID, 0)
	v452SetWindowSubclass.Call(e.dialog.hCanvas, round9CanvasSubclassCB, round9CanvasSubclassID, 0)
	round9ApplyEditorLayout(e)
}

func round9EnsureEditorDecor(e *round7Editor) *round9EditorDecor {
	if e == nil || e.hwnd == 0 {
		return nil
	}
	if value, ok := round9EditorDecorMap.Load(e.hwnd); ok {
		return value.(*round9EditorDecor)
	}
	decor := &round9EditorDecor{
		previewTitle: createControl("STATIC", "剪裁预览", WS_CHILD|WS_VISIBLE, 0, 0, 90, 22, e.hwnd, 0),
	}
	send(decor.previewTitle, WM_SETFONT, uiFontBold, 1)
	round9EditorDecorMap.Store(e.hwnd, decor)
	return decor
}

func round9ApplyEditorLayout(e *round7Editor) {
	if e == nil || e.hwnd == 0 || e.dialog == nil {
		return
	}
	d := e.dialog
	var client rect
	procGetClientRect.Call(e.hwnd, uintptr(unsafe.Pointer(&client)))
	margin, gap, rightW := int32(14), int32(16), int32(400)
	leftW := client.Right - margin*2 - gap - rightW
	if leftW < 560 {
		rightW = 372
		leftW = client.Right - margin*2 - gap - rightW
	}
	if leftW < 500 {
		leftW = 500
	}
	rightX := margin + leftW + gap
	previewH := client.Bottom - 330
	if previewH > 410 {
		previewH = 410
	}
	if previewH < 330 {
		previewH = 330
	}

	procShowWindow.Call(e.hInstruction, 0)
	procShowWindow.Call(e.hSourceRange, 0)
	procShowWindow.Call(e.hApplySelected, 0)

	round7FeedbackMove(d.hCanvas, margin, 14, leftW, previewH)
	currentY := int32(26) + previewH
	round7FeedbackMove(e.hCurrentLabel, margin, currentY+4, 68, 28)
	round7FeedbackMove(d.hNow, margin+70, currentY, 140, 30)
	round7FeedbackMove(e.hJump, margin+216, currentY, 62, 30)
	timelineY := currentY + 38
	round7FeedbackMove(e.hTimeline, margin, timelineY, leftW, 86)
	seekY := timelineY + 92
	buttonW := int32(76)
	totalSeek := buttonW*4 + 8*3
	seekX := margin + (leftW-totalSeek)/2
	round7FeedbackMove(e.hSeekMinusSec, seekX, seekY, buttonW, 30)
	round7FeedbackMove(e.hSeekMinusFrame, seekX+buttonW+8, seekY, buttonW, 30)
	round7FeedbackMove(e.hSeekPlusFrame, seekX+(buttonW+8)*2, seekY, buttonW, 30)
	round7FeedbackMove(e.hSeekPlusSec, seekX+(buttonW+8)*3, seekY, buttonW, 30)

	decor := round7FeedbackEnsureDecor(e)
	procShowWindow.Call(decor.timeLine, 0)
	procShowWindow.Call(decor.cropLine, 0)
	round7FeedbackMove(e.hFileLabel, rightX, 14, rightW, 26)
	setText(e.hFileLabel, "标题："+filepath.Base(d.task.Input))

	clipTop := int32(54)
	round7FeedbackMove(decor.timeTitle, rightX+12, clipTop-11, 64, 24)
	round7FeedbackMove(e.hStartLabel, rightX+14, clipTop+22, 64, 28)
	round7FeedbackMove(d.hStart, rightX+80, clipTop+18, 124, 30)
	round7FeedbackMove(e.hStartCurrent, rightX+212, clipTop+18, 54, 30)
	round7FeedbackMove(e.hStartInitial, rightX+274, clipTop+18, 72, 30)
	round7FeedbackMove(e.hEndLabel, rightX+14, clipTop+60, 64, 28)
	round7FeedbackMove(d.hEnd, rightX+80, clipTop+56, 124, 30)
	round7FeedbackMove(e.hEndCurrent, rightX+212, clipTop+56, 54, 30)
	round7FeedbackMove(e.hEndTerminal, rightX+274, clipTop+56, 72, 30)

	cropTop := int32(184)
	round7FeedbackMove(decor.cropTitle, rightX+12, cropTop-11, 64, 24)
	round7FeedbackMove(d.hCrop, rightX+14, cropTop+20, 150, 28)
	pairW := (rightW - 28) / 4
	shortLabels := []string{"左", "上", "宽", "高"}
	for i := range e.cropLabels {
		x := rightX + 14 + int32(i)*pairW
		round7FeedbackMove(e.cropLabels[i], x, cropTop+61, 22, 26)
		setText(e.cropLabels[i], shortLabels[i])
	}
	round7FeedbackMove(d.hX, rightX+36, cropTop+57, pairW-28, 30)
	round7FeedbackMove(d.hY, rightX+14+pairW+22, cropTop+57, pairW-28, 30)
	round7FeedbackMove(d.hW, rightX+14+pairW*2+22, cropTop+57, pairW-28, 30)
	round7FeedbackMove(d.hH, rightX+14+pairW*3+22, cropTop+57, pairW-28, 30)

	setText(e.hCropFrameLabel, "转正后尺寸  "+formatDimension(d.frameW, d.frameH))
	round7FeedbackMove(e.hCropFrameLabel, rightX+14, cropTop+99, 190, 28)
	setText(e.hAspectLabel, "比例")
	round7FeedbackMove(e.hAspectLabel, rightX+205, cropTop+99, 36, 28)
	round7FeedbackMove(d.hAspect, rightX+243, cropTop+94, 82, 160)
	setText(e.hCenter, "居中")
	round7FeedbackMove(e.hCenter, rightX+332, cropTop+94, 54, 30)

	r9decor := round9EnsureEditorDecor(e)
	if r9decor != nil {
		round7FeedbackMove(r9decor.previewTitle, rightX+14, cropTop+136, 90, 24)
	}
	setText(e.hPreview, "高清预览")
	setText(e.hFullFrame, "恢复全画面")
	round7FeedbackMove(e.hPreview, rightX+108, cropTop+132, 88, 32)
	round7FeedbackMove(e.hFullFrame, rightX+204, cropTop+132, 100, 32)

	infoTop := cropTop + 178
	infoBottom := client.Bottom - 70
	if infoBottom-infoTop < 108 {
		infoBottom = infoTop + 108
	}
	round7FeedbackMove(d.hInfo, rightX+14, infoTop, rightW-28, infoBottom-infoTop)
	round7FeedbackFlattenInfoControl(d.hInfo)

	bottomY := client.Bottom - 48
	setText(e.hApplyCurrent, "应用")
	round7FeedbackMove(e.hApplyCurrent, rightX+rightW-184, bottomY, 96, 38)
	round7FeedbackMove(e.hCancel, rightX+rightW-80, bottomY, 80, 38)
	setText(e.hCurrentLabel, "当前时间")
	setText(decor.timeTitle, "剪辑")
	setText(decor.cropTitle, "画面")
	setText(e.hStartLabel, "起始时间")
	setText(e.hEndLabel, "结束时间")
	setText(e.hStartCurrent, "当前")
	setText(e.hEndCurrent, "当前")
	setText(e.hStartInitial, "源起点")
	setText(e.hEndTerminal, "源终点")
	round7FeedbackRefreshInfoCard(e)
	procInvalidateRect.Call(e.hTimeline, 0, 0)
	procInvalidateRect.Call(e.hwnd, 0, 0)
}

func formatDimension(w, h int) string {
	return itoa(w) + " × " + itoa(h)
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	negative := v < 0
	if negative {
		v = -v
	}
	var buf [24]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if negative {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func round9DrawEditorGroups(e *round7Editor, hdc uintptr) {
	if e == nil || e.hwnd == 0 || hdc == 0 {
		return
	}
	var client rect
	procGetClientRect.Call(e.hwnd, uintptr(unsafe.Pointer(&client)))
	margin, gap, rightW := int32(14), int32(16), int32(400)
	leftW := client.Right - margin*2 - gap - rightW
	if leftW < 560 {
		rightW = 372
		leftW = client.Right - margin*2 - gap - rightW
	}
	rightX := margin + leftW + gap
	line := colorRef(211, 218, 227)
	drawRect := func(r rect) {
		fillSolid(hdc, rect{Left: r.Left, Top: r.Top, Right: r.Right, Bottom: r.Top + 1}, line)
		fillSolid(hdc, rect{Left: r.Left, Top: r.Bottom - 1, Right: r.Right, Bottom: r.Bottom}, line)
		fillSolid(hdc, rect{Left: r.Left, Top: r.Top, Right: r.Left + 1, Bottom: r.Bottom}, line)
		fillSolid(hdc, rect{Left: r.Right - 1, Top: r.Top, Right: r.Right, Bottom: r.Bottom}, line)
	}
	drawRect(rect{Left: rightX, Top: 54, Right: rightX + rightW, Bottom: 158})
	cropBottom := client.Bottom - 58
	if cropBottom < 500 {
		cropBottom = 500
	}
	drawRect(rect{Left: rightX, Top: 184, Right: rightX + rightW, Bottom: cropBottom})
}

func round9EditorSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case WM_SIZE:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if e := round7ActiveEditor; e != nil && e.hwnd == hwnd {
			round9ApplyEditorLayout(e)
		}
		return result
	case WM_PAINT:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if e := round7ActiveEditor; e != nil && e.hwnd == hwnd {
			hdc, _, _ := round7ListGetDC.Call(hwnd)
			if hdc != 0 {
				round9DrawEditorGroups(e, hdc)
				round7ListReleaseDC.Call(hwnd, hdc)
			}
		}
		return result
	case v452WMNCDestroy:
		round9EditorDecorMap.Delete(hwnd)
		v452RemoveSubclass.Call(hwnd, round9EditorSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

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

func round9CropClientRect(d *trimDialog) (rect, bool) {
	if d == nil || !d.opts.Crop.Enabled || d.frameW <= 0 || d.frameH <= 0 {
		return rect{}, false
	}
	dr := d.previewDrawRect(d.hCanvas)
	if dr.Right <= dr.Left || dr.Bottom <= dr.Top {
		return rect{}, false
	}
	c := d.opts.Crop
	sx := float64(dr.Right-dr.Left) / float64(d.frameW)
	sy := float64(dr.Bottom-dr.Top) / float64(d.frameH)
	return rect{
		Left:   dr.Left + int32(float64(c.X)*sx),
		Top:    dr.Top + int32(float64(c.Y)*sy),
		Right:  dr.Left + int32(float64(c.X+c.Width)*sx),
		Bottom: dr.Top + int32(float64(c.Y+c.Height)*sy),
	}, true
}

func round9CropHitTest(d *trimDialog, pt point) round9CropMode {
	r, ok := round9CropClientRect(d)
	if !ok {
		return round9CropCreate
	}
	tol := scaleDPI(8)
	nearX := func(x int32) bool { return pt.X >= x-tol && pt.X <= x+tol }
	nearY := func(y int32) bool { return pt.Y >= y-tol && pt.Y <= y+tol }
	if nearX(r.Left) && nearY(r.Top) {
		return round9CropResizeNW
	}
	if nearX(r.Right) && nearY(r.Top) {
		return round9CropResizeNE
	}
	if nearX(r.Left) && nearY(r.Bottom) {
		return round9CropResizeSW
	}
	if nearX(r.Right) && nearY(r.Bottom) {
		return round9CropResizeSE
	}
	if nearY(r.Top) && pt.X >= r.Left && pt.X <= r.Right {
		return round9CropResizeN
	}
	if nearY(r.Bottom) && pt.X >= r.Left && pt.X <= r.Right {
		return round9CropResizeS
	}
	if nearX(r.Left) && pt.Y >= r.Top && pt.Y <= r.Bottom {
		return round9CropResizeW
	}
	if nearX(r.Right) && pt.Y >= r.Top && pt.Y <= r.Bottom {
		return round9CropResizeE
	}
	if pt.X > r.Left && pt.X < r.Right && pt.Y > r.Top && pt.Y < r.Bottom {
		return round9CropMove
	}
	return round9CropCreate
}

func round9CropBoxFromModel(c model.Crop) round9CropBox {
	return round9CropBox{X: c.X, Y: c.Y, Width: c.Width, Height: c.Height}
}

func round9CropBoxToModel(box round9CropBox) model.Crop {
	return model.Crop{Enabled: true, X: box.X, Y: box.Y, Width: box.Width, Height: box.Height}
}

func round9UpdateCanvasDrag(e *round7Editor, hwnd, lParam uintptr, final bool) {
	value, ok := round9CanvasDragMap.Load(hwnd)
	if !ok || e == nil || e.dialog == nil {
		return
	}
	state := value.(*round9CanvasDragState)
	if !state.active {
		return
	}
	d := e.dialog
	clientPt := mousePoint(lParam)
	imagePt, valid := d.imagePointClamped(lParam)
	if !valid {
		return
	}
	if state.mode == round9CropCreate && !state.started {
		dx := clientPt.X - state.startClient.X
		dy := clientPt.Y - state.startClient.Y
		if dx < 0 {
			dx = -dx
		}
		if dy < 0 {
			dy = -dy
		}
		if dx < scaleDPI(3) && dy < scaleDPI(3) && !final {
			return
		}
		state.started = dx >= scaleDPI(3) || dy >= scaleDPI(3)
	}

	box := state.original
	switch state.mode {
	case round9CropCreate:
		if !state.started {
			box = state.original
			break
		}
		ratioW, ratioH, locked := d.selectedAspect()
		crop := media.DragCropWithAspect(d.frameW, d.frameH, int(state.startImage.X), int(state.startImage.Y), int(imagePt.X), int(imagePt.Y), ratioW, ratioH, locked)
		box = round9CropBoxFromModel(crop)
	case round9CropMove:
		box = round9MoveCropBox(state.original, int(imagePt.X-state.startImage.X), int(imagePt.Y-state.startImage.Y), d.frameW, d.frameH)
	default:
		box = round9ResizeCropBox(state.original, state.mode, int(imagePt.X), int(imagePt.Y), d.frameW, d.frameH)
	}
	if final {
		box = round9NormalizeEvenCrop(box, d.frameW, d.frameH)
	}
	d.opts.Crop = round9CropBoxToModel(box)
	send(d.hCrop, BM_SETCHECK, BST_CHECKED, 0)
	now := time.Now()
	if final || now.Sub(state.lastSync) >= 40*time.Millisecond {
		round7FeedbackSyncCropControls(e, final)
		state.lastSync = now
	}
	procInvalidateRect.Call(hwnd, 0, 0)
}

func round9SetCanvasCursor(mode round9CropMode) {
	id := uintptr(32515)
	switch mode {
	case round9CropMove:
		id = 32646
	case round9CropResizeN, round9CropResizeS:
		id = 32645
	case round9CropResizeW, round9CropResizeE:
		id = 32644
	case round9CropResizeNW, round9CropResizeSE:
		id = 32642
	case round9CropResizeNE, round9CropResizeSW:
		id = 32643
	}
	cursor, _, _ := procLoadCursorW.Call(0, id)
	if cursor != 0 {
		round9SetCursor.Call(cursor)
	}
}

func round9CanvasSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	e := round7ActiveEditor
	if e == nil || e.dialog == nil || e.dialog.hCanvas != hwnd {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
	d := e.dialog
	switch message {
	case WM_LBUTTONDOWN:
		imagePt, ok := d.imagePoint(lParam)
		if !ok {
			return 0
		}
		clientPt := mousePoint(lParam)
		state := &round9CanvasDragState{
			active:      true,
			mode:        round9CropHitTest(d, clientPt),
			startImage:  imagePt,
			startClient: clientPt,
			original:    round9CropBoxFromModel(d.opts.Crop),
		}
		round9CanvasDragMap.Store(hwnd, state)
		procSetCapture.Call(hwnd)
		round9SetCanvasCursor(state.mode)
		return 0
	case WM_MOUSEMOVE:
		if value, ok := round9CanvasDragMap.Load(hwnd); ok && value.(*round9CanvasDragState).active {
			round9UpdateCanvasDrag(e, hwnd, lParam, false)
			return 0
		}
		pt := mousePoint(lParam)
		round9SetCanvasCursor(round9CropHitTest(d, pt))
		return 0
	case WM_LBUTTONUP:
		if value, ok := round9CanvasDragMap.Load(hwnd); ok {
			state := value.(*round9CanvasDragState)
			if state.active {
				round9UpdateCanvasDrag(e, hwnd, lParam, true)
				state.active = false
				procReleaseCapture.Call()
				round9CanvasDragMap.Delete(hwnd)
				return 0
			}
		}
	case round9WMSetCursor:
		var pt point
		if ok, _, _ := round9FeedbackGetCursorPos.Call(uintptr(unsafe.Pointer(&pt))); ok != 0 {
			round9FeedbackScreenToClient.Call(hwnd, uintptr(unsafe.Pointer(&pt)))
			round9SetCanvasCursor(round9CropHitTest(d, pt))
			return 1
		}
	case v452WMNCDestroy:
		round9CanvasDragMap.Delete(hwnd)
		v452RemoveSubclass.Call(hwnd, round9CanvasSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

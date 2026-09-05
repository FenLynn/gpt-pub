//go:build windows

package main

import (
	"math"
	"sync"
	"syscall"
	"unsafe"

	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

const (
	v452TrimTimelineClassName = "MWTrimTimeline452"
	v452TrimHandlePixels      = 8
)

type v452TrimEditorState struct {
	timelineDragging bool
	timelineHit      media.TrimTimelineHit
	timelineInitial  media.TrimRangeState
	timelineAnchor   float64

	cropDragging bool
	cropHandle   media.CropHandle
	cropInitial  model.Crop
	cropAnchor   point
}

var (
	v452TrimTimelineRegistered bool
	v452TrimTimelineCB         = syscall.NewCallback(v452TrimTimelineWndProc)
	v452TrimStates             sync.Map // map[*trimDialog]*v452TrimEditorState
	v452SetCursor              = user32.NewProc("SetCursor")
	v452GetSysColorBrush       = user32.NewProc("GetSysColorBrush")
)

func v452RegisterTrimTimelineClass() {
	if v452TrimTimelineRegistered {
		return
	}
	hInst, _, _ := procGetModuleHandleW.Call(0)
	cursor, _, _ := procLoadCursorW.Call(0, 32512)
	wc := wndClassEx{
		CbSize:        uint32(unsafe.Sizeof(wndClassEx{})),
		LpfnWndProc:   v452TrimTimelineCB,
		HInstance:     hInst,
		HCursor:       cursor,
		HbrBackground: COLOR_WINDOW + 1,
		LpszClassName: p(v452TrimTimelineClassName),
	}
	procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
	v452TrimTimelineRegistered = true
}

func v452TrimStateFor(d *trimDialog) *v452TrimEditorState {
	if d == nil {
		return nil
	}
	if value, ok := v452TrimStates.Load(d); ok {
		return value.(*v452TrimEditorState)
	}
	state := &v452TrimEditorState{}
	actual, _ := v452TrimStates.LoadOrStore(d, state)
	return actual.(*v452TrimEditorState)
}

func v452ReleaseTrimState(d *trimDialog) {
	if d != nil {
		v452TrimStates.Delete(d)
	}
}

func v452ReadTrimRange(d *trimDialog) media.TrimRangeState {
	if d == nil || d.task == nil || d.task.Kind == model.KindImage {
		return media.TrimRangeState{}
	}
	start, _ := parseTimeValue(getText(d.hStart))
	end, _ := parseTimeValue(getText(d.hEnd))
	return media.NormalizeTrimRange(d.task.Duration, d.safeFPS(), media.TrimRangeState{
		Start:    start,
		End:      end,
		Playhead: d.currentAt,
	})
}

func v452WriteTrimRange(d *trimDialog, state media.TrimRangeState, generate bool) {
	if d == nil || d.task == nil || d.task.Kind == model.KindImage {
		return
	}
	state = media.NormalizeTrimRange(d.task.Duration, d.safeFPS(), state)
	d.currentAt = state.Playhead
	d.opts.TrimStart = state.Start
	d.opts.TrimEnd = state.End
	setText(d.hStart, formatSecondsClock(state.Start))
	setText(d.hEnd, formatSecondsClock(state.End))
	setText(d.hNow, formatSecondsClock(state.Playhead))
	procInvalidateRect.Call(d.hTrack, 0, 1)
	d.updateInfo()
	if generate {
		d.generatePreviewFrame()
	}
}

func v452InvalidateTrimTimeline(d *trimDialog) {
	if d != nil && d.hTrack != 0 {
		procInvalidateRect.Call(d.hTrack, 0, 1)
	}
}

func v452TrimTimelineGeometry(hwnd uintptr) (rect, int, int) {
	var client rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	left := int(client.Left) + 14
	right := int(client.Right) - 14
	if right <= left {
		right = left + 1
	}
	return client, left, right
}

func v452TrimTimelineWndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	d := activeTrim
	if d == nil || hwnd != d.hTrack {
		r, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
		return r
	}
	switch message {
	case WM_PAINT:
		v452PaintTrimTimeline(d, hwnd)
		return 0
	case WM_LBUTTONDOWN:
		if d.task.Kind == model.KindImage || d.task.Duration <= 0 {
			return 0
		}
		_, left, right := v452TrimTimelineGeometry(hwnd)
		x := int(mousePoint(lParam).X)
		initial := v452ReadTrimRange(d)
		hit := media.HitTrimTimeline(initial, d.task.Duration, x, left, right, 9)
		if hit == media.TrimTimelineNone {
			hit = media.TrimTimelinePlayhead
		}
		state := v452TrimStateFor(d)
		state.timelineDragging = true
		state.timelineHit = hit
		state.timelineInitial = initial
		state.timelineAnchor = media.TimelineXToTime(float64(x), d.task.Duration, left, right)
		procSetCapture.Call(hwnd)
		v452ApplyTimelineDrag(d, x, false)
		return 0
	case WM_MOUSEMOVE:
		state := v452TrimStateFor(d)
		if state != nil && state.timelineDragging {
			v452ApplyTimelineDrag(d, int(mousePoint(lParam).X), false)
		}
		return 0
	case WM_LBUTTONUP:
		state := v452TrimStateFor(d)
		if state != nil && state.timelineDragging {
			v452ApplyTimelineDrag(d, int(mousePoint(lParam).X), true)
			state.timelineDragging = false
			procReleaseCapture.Call()
		}
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return r
}

func v452ApplyTimelineDrag(d *trimDialog, x int, generate bool) {
	state := v452TrimStateFor(d)
	if state == nil {
		return
	}
	_, left, right := v452TrimTimelineGeometry(d.hTrack)
	target := media.TimelineXToTime(float64(x), d.task.Duration, left, right)
	updated := media.DragTrimTimeline(
		state.timelineInitial,
		d.task.Duration,
		d.safeFPS(),
		state.timelineHit,
		state.timelineAnchor,
		target,
	)
	v452WriteTrimRange(d, updated, generate)
}

func v452PaintTrimTimeline(d *trimDialog, hwnd uintptr) {
	var ps paintStruct
	hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	defer procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	client, left, right := v452TrimTimelineGeometry(hwnd)
	background, _, _ := procCreateSolidBrush.Call(rgb(250, 251, 252))
	procFillRect.Call(hdc, uintptr(unsafe.Pointer(&client)), background)
	procDeleteObject.Call(background)

	bar := rect{Left: int32(left), Top: 24, Right: int32(right), Bottom: 34}
	trackBrush, _, _ := procCreateSolidBrush.Call(rgb(224, 229, 235))
	procFillRect.Call(hdc, uintptr(unsafe.Pointer(&bar)), trackBrush)
	procDeleteObject.Call(trackBrush)

	if d.task.Kind == model.KindImage || d.task.Duration <= 0 {
		label := p("图片无时间轴")
		procSetBkMode.Call(hdc, TRANSPARENT)
		procSetTextColor.Call(hdc, rgb(126, 134, 144))
		procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(label)), ^uintptr(0), uintptr(unsafe.Pointer(&client)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
		return
	}

	state := v452ReadTrimRange(d)
	startX := media.TimelineTimeToX(state.Start, d.task.Duration, left, right)
	endX := media.TimelineTimeToX(state.End, d.task.Duration, left, right)
	playX := media.TimelineTimeToX(state.Playhead, d.task.Duration, left, right)
	selected := rect{Left: int32(startX), Top: 22, Right: int32(endX), Bottom: 36}
	selectedBrush, _, _ := procCreateSolidBrush.Call(rgb(62, 133, 241))
	procFillRect.Call(hdc, uintptr(unsafe.Pointer(&selected)), selectedBrush)
	procDeleteObject.Call(selectedBrush)

	handleBrush, _, _ := procCreateSolidBrush.Call(rgb(37, 103, 216))
	for _, x := range []int{startX, endX} {
		handle := rect{Left: int32(x - 5), Top: 15, Right: int32(x + 6), Bottom: 43}
		procFillRect.Call(hdc, uintptr(unsafe.Pointer(&handle)), handleBrush)
	}
	procDeleteObject.Call(handleBrush)

	playPen, _, _ := procCreatePen.Call(PS_SOLID, 2, rgb(223, 65, 65))
	oldPen, _, _ := procSelectObject.Call(hdc, playPen)
	procMoveToEx.Call(hdc, uintptr(playX), 11, 0)
	procLineTo.Call(hdc, uintptr(playX), 47)
	procSelectObject.Call(hdc, oldPen)
	procDeleteObject.Call(playPen)

	procSetBkMode.Call(hdc, TRANSPARENT)
	procSetTextColor.Call(hdc, rgb(82, 91, 103))
	leftLabel := rect{Left: int32(left), Top: 1, Right: int32(left + 170), Bottom: 20}
	rightLabel := rect{Left: int32(right - 170), Top: 1, Right: int32(right), Bottom: 20}
	startText := p(formatSecondsClock(state.Start))
	endText := p(formatSecondsClock(state.End))
	procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(startText)), ^uintptr(0), uintptr(unsafe.Pointer(&leftLabel)), DT_LEFT|DT_VCENTER|DT_SINGLELINE)
	procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(endText)), ^uintptr(0), uintptr(unsafe.Pointer(&rightLabel)), DT_RIGHT|DT_VCENTER|DT_SINGLELINE)
}

func v452TrimPreviewMouseDown(d *trimDialog, hwnd, lParam uintptr) bool {
	pt, ok := d.imagePoint(lParam)
	if !ok {
		return false
	}
	state := v452TrimStateFor(d)
	state.cropDragging = true
	state.cropInitial = d.opts.Crop
	state.cropAnchor = pt
	tolerance := v452CropHitTolerance(d)
	state.cropHandle = media.HitCropHandle(d.opts.Crop, int(pt.X), int(pt.Y), tolerance)
	if state.cropHandle == media.CropHandleNone {
		state.cropHandle = media.CropHandleCreate
		d.opts.Crop = model.Crop{Enabled: true, X: int(pt.X), Y: int(pt.Y), Width: 2, Height: 2}
		send(d.hCrop, BM_SETCHECK, BST_CHECKED, 0)
		d.cropToControls()
	}
	v452SetCropCursor(state.cropHandle)
	procSetCapture.Call(hwnd)
	return true
}

func v452TrimPreviewMouseMove(d *trimDialog, lParam uintptr) bool {
	state := v452TrimStateFor(d)
	if state != nil && state.cropDragging {
		pt, ok := d.imagePointClamped(lParam)
		if !ok {
			return true
		}
		dx := int(pt.X - state.cropAnchor.X)
		dy := int(pt.Y - state.cropAnchor.Y)
		ratioW, ratioH, locked := d.selectedAspect()
		if d.task.Kind == model.KindImage {
			switch state.cropHandle {
			case media.CropHandleCreate:
				d.opts.Crop = media.DragImageCropWithAspect(d.frameW, d.frameH, int(state.cropAnchor.X), int(state.cropAnchor.Y), int(pt.X), int(pt.Y), ratioW, ratioH, locked)
			case media.CropHandleMove:
				d.opts.Crop = media.MoveImageCrop(d.frameW, d.frameH, state.cropInitial, dx, dy)
			default:
				d.opts.Crop = media.ResizeImageCrop(d.frameW, d.frameH, state.cropInitial, state.cropHandle, dx, dy, ratioW, ratioH, locked)
			}
		} else {
			switch state.cropHandle {
			case media.CropHandleCreate:
				d.opts.Crop = media.DragCropWithAspect(d.frameW, d.frameH, int(state.cropAnchor.X), int(state.cropAnchor.Y), int(pt.X), int(pt.Y), ratioW, ratioH, locked)
			case media.CropHandleMove:
				d.opts.Crop = media.MoveCrop(d.frameW, d.frameH, state.cropInitial, dx, dy)
			default:
				d.opts.Crop = media.ResizeCrop(d.frameW, d.frameH, state.cropInitial, state.cropHandle, dx, dy, ratioW, ratioH, locked)
			}
		}
		d.cropToControls()
		return true
	}
	if pt, ok := d.imagePoint(lParam); ok {
		handle := media.HitCropHandle(d.opts.Crop, int(pt.X), int(pt.Y), v452CropHitTolerance(d))
		if handle == media.CropHandleNone {
			handle = media.CropHandleCreate
		}
		v452SetCropCursor(handle)
	}
	return false
}

func v452TrimPreviewMouseUp(d *trimDialog, lParam uintptr) bool {
	state := v452TrimStateFor(d)
	if state == nil || !state.cropDragging {
		return false
	}
	v452TrimPreviewMouseMove(d, lParam)
	state.cropDragging = false
	procReleaseCapture.Call()
	return true
}

func v452CropHitTolerance(d *trimDialog) int {
	dr := d.previewDrawRect(d.hCanvas)
	width := int(dr.Right - dr.Left)
	height := int(dr.Bottom - dr.Top)
	if width <= 0 || height <= 0 {
		return 8
	}
	xTolerance := int(math.Ceil(float64(v452TrimHandlePixels*d.frameW) / float64(width)))
	yTolerance := int(math.Ceil(float64(v452TrimHandlePixels*d.frameH) / float64(height)))
	if yTolerance > xTolerance {
		xTolerance = yTolerance
	}
	if xTolerance < 2 {
		xTolerance = 2
	}
	return xTolerance
}

func v452SetCropCursor(handle media.CropHandle) {
	cursorID := uintptr(32515) // crosshair/create
	switch handle {
	case media.CropHandleMove:
		cursorID = 32646
	case media.CropHandleNorth, media.CropHandleSouth:
		cursorID = 32645
	case media.CropHandleEast, media.CropHandleWest:
		cursorID = 32644
	case media.CropHandleNorthWest, media.CropHandleSouthEast:
		cursorID = 32642
	case media.CropHandleNorthEast, media.CropHandleSouthWest:
		cursorID = 32643
	}
	cursor, _, _ := procLoadCursorW.Call(0, cursorID)
	if cursor != 0 {
		v452SetCursor.Call(cursor)
	}
}

func v452PaintCropHandles(hdc uintptr, cropRect rect) {
	brush, _, _ := procCreateSolidBrush.Call(rgb(25, 205, 110))
	midX := (cropRect.Left + cropRect.Right) / 2
	midY := (cropRect.Top + cropRect.Bottom) / 2
	for _, pt := range []point{
		{cropRect.Left, cropRect.Top}, {midX, cropRect.Top}, {cropRect.Right, cropRect.Top},
		{cropRect.Left, midY}, {cropRect.Right, midY},
		{cropRect.Left, cropRect.Bottom}, {midX, cropRect.Bottom}, {cropRect.Right, cropRect.Bottom},
	} {
		handle := rect{Left: pt.X - 5, Top: pt.Y - 5, Right: pt.X + 6, Bottom: pt.Y + 6}
		procFillRect.Call(hdc, uintptr(unsafe.Pointer(&handle)), brush)
	}
	procDeleteObject.Call(brush)
}

func v452TrimStaticBrush(wParam uintptr) uintptr {
	if wParam != 0 {
		procSetBkMode.Call(wParam, TRANSPARENT)
		procSetTextColor.Call(wParam, rgb(55, 62, 72))
	}
	brush, _, _ := v452GetSysColorBrush.Call(COLOR_WINDOW)
	return brush
}

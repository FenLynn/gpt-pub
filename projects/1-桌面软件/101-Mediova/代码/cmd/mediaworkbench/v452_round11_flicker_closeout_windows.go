//go:build windows

package main

import (
	"path/filepath"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"
)

const (
	round11MainSubclassID        = 0x45B1
	round11ListSubclassID        = 0x45B2
	round11EditorSubclassID      = 0x45B3
	round11CanvasPaintSubclassID = 0x45B4
	round11WMFinalizeInstall     = WM_APP + 0x5B1
)

type round11OverlayGeometry struct {
	x, y, width, height int32
	valid               bool
}

type round11EditorLayoutState struct {
	clientWidth, clientHeight int32
	initialized               bool
	infoFlattened             bool
}

type round11MoveSpec struct {
	hwnd             uintptr
	x, y, width, height int32
}

var (
	round11MainEventCB        uintptr
	round11MainSubclassCB     uintptr
	round11ListSubclassCB     uintptr
	round11EditorSubclassCB   uintptr
	round11CanvasPaintCB      uintptr
	round11MainHook           uintptr
	round11MainInstalled      atomic.Bool
	round11OverlayGeometryMap sync.Map
	round11EditorStateMap     sync.Map
)

func init() {
	round11MainEventCB = syscall.NewCallback(round11MainEventProc)
	round11MainSubclassCB = syscall.NewCallback(round11MainSubclassProc)
	round11ListSubclassCB = syscall.NewCallback(round11ListSubclassProc)
	round11EditorSubclassCB = syscall.NewCallback(round11EditorSubclassProc)
	round11CanvasPaintCB = syscall.NewCallback(round11CanvasPaintSubclassProc)
	round11MainHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		round11MainEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func round11MainEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	a := app
	if a == nil || a.hwnd == 0 || a.hList == 0 || !a.controlsReady {
		return 0
	}
	if !round11MainInstalled.CompareAndSwap(false, true) {
		return 0
	}
	if ok, _, _ := v452SetWindowSubclass.Call(a.hwnd, round11MainSubclassCB, round11MainSubclassID, 0); ok == 0 {
		round11MainInstalled.Store(false)
		return 0
	}
	procPostMessageW.Call(a.hwnd, round11WMFinalizeInstall, 0, 0)
	return 0
}

func round11FinalizeMainInstall(a *application) {
	if a == nil || a.hwnd == 0 || a.hList == 0 {
		return
	}
	// The round-7 list subclass positioned scroll overlays from WM_PAINT.
	// Remove it before installing the single stable list owner.
	v452RemoveSubclass.Call(a.hList, round7FeedbackListSubclassCB, round7FeedbackListSubclassID)
	v452SetWindowSubclass.Call(a.hList, round11ListSubclassCB, round11ListSubclassID, 0)
	round11EnsureStableScrollGeometry(a)
	if round11MainHook != 0 {
		round7FeedbackUnhookWinEvent.Call(round11MainHook)
		round11MainHook = 0
	}
}

func round11MainSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case round11WMFinalizeInstall:
		round11FinalizeMainInstall(app)
		return 0
	case WM_SIZE:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round11EnsureStableScrollGeometry(app)
		return result
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round11MainSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round11ListSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
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
	case WM_SIZE, round9FeedbackWMWindowPosChanged, LVM_SETCOLUMNWIDTH:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round11EnsureStableScrollGeometry(app)
		round9EnsureVisibleThumbnails(app, hwnd)
		return result
	case LVM_INSERTITEMW, LVM_DELETEALLITEMS:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round9EnsureVisibleThumbnails(app, hwnd)
		round9InvalidateScrollOverlays()
		return result
	case v452WMNCDestroy:
		round9DestroyScrollOverlays()
		round11OverlayGeometryMap = sync.Map{}
		v452RemoveSubclass.Call(hwnd, round11ListSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round11EnsureOverlayInstances(a *application) (*round9ScrollOverlay, *round9ScrollOverlay) {
	if a == nil || a.hwnd == 0 {
		return nil, nil
	}
	round9ScrollMu.Lock()
	defer round9ScrollMu.Unlock()
	if round9ScrollH == nil || round9ScrollH.hwnd == 0 {
		round9ScrollH = round9CreateScrollOverlay(a.hwnd, round9AxisHorizontal)
	}
	if round9ScrollV == nil || round9ScrollV.hwnd == 0 {
		round9ScrollV = round9CreateScrollOverlay(a.hwnd, round9AxisVertical)
	}
	return round9ScrollH, round9ScrollV
}

func round11PositionOverlayStable(overlay *round9ScrollOverlay, x, y, width, height int32) {
	if overlay == nil || overlay.hwnd == 0 || width <= 0 || height <= 0 {
		return
	}
	geometry := round11OverlayGeometry{x: x, y: y, width: width, height: height, valid: true}
	if raw, ok := round11OverlayGeometryMap.Load(overlay.hwnd); ok {
		previous := raw.(round11OverlayGeometry)
		if previous == geometry && overlay.visible {
			return
		}
	}
	round11OverlayGeometryMap.Store(overlay.hwnd, geometry)
	round7FeedbackSetWindowPos.Call(
		overlay.hwnd,
		0,
		uintptr(x), uintptr(y), uintptr(width), uintptr(height),
		round7FeedbackSWPNoActivate|round9FeedbackSWPShowWindow,
	)
	overlay.visible = true
}

func round11EnsureStableScrollGeometry(a *application) {
	if a == nil || a.hwnd == 0 || a.hList == 0 {
		return
	}
	horizontal, vertical := round11EnsureOverlayInstances(a)
	if horizontal == nil || vertical == nil {
		return
	}
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
	round11PositionOverlayStable(horizontal, topLeft.X+1, bottomRight.Y-thickness, width-1, thickness)
	verticalHeight := height - thickness - 1
	if verticalHeight < 1 {
		verticalHeight = 1
	}
	round11PositionOverlayStable(vertical, bottomRight.X-thickness, topLeft.Y+1, thickness, verticalHeight)
}

func round11InstallEditor(e *round7Editor) {
	if e == nil || e.hwnd == 0 || e.hTimeline == 0 || e.dialog == nil || e.dialog.hCanvas == 0 {
		return
	}
	// Remove all inherited layout/paint/input owners before installing the
	// final single-owner chain.
	v452RemoveSubclass.Call(e.hwnd, round7FeedbackEditorSubclassCB, round7FeedbackEditorSubclassID)
	v452RemoveSubclass.Call(e.hTimeline, round7FeedbackTimelineCB, round7FeedbackTimelineSubclassID)
	v452RemoveSubclass.Call(e.dialog.hCanvas, round7FeedbackCanvasCB, round7FeedbackCanvasSubclassID)
	v452RemoveSubclass.Call(e.hwnd, round9EditorSubclassCB, round9EditorSubclassID)
	v452RemoveSubclass.Call(e.hTimeline, round9TimelineSubclassCB, round9TimelineSubclassID)
	v452RemoveSubclass.Call(e.dialog.hCanvas, round9CanvasSubclassCB, round9CanvasSubclassID)

	v452SetWindowSubclass.Call(e.hwnd, round11EditorSubclassCB, round11EditorSubclassID, 0)
	v452SetWindowSubclass.Call(e.hTimeline, round9TimelineSubclassCB, round9TimelineSubclassID, 0)
	v452SetWindowSubclass.Call(e.dialog.hCanvas, round9CanvasSubclassCB, round9CanvasSubclassID, 0)
	v452SetWindowSubclass.Call(e.dialog.hCanvas, round11CanvasPaintCB, round11CanvasPaintSubclassID, 0)
	round9EnsureInfoGuard(e)
	round11ApplyEditorLayout(e, true)
}

func round11SetTextIfChanged(hwnd uintptr, value string) bool {
	if hwnd == 0 || getText(hwnd) == value {
		return false
	}
	setText(hwnd, value)
	return true
}

func round11ControlRectMatches(hwnd, parent uintptr, x, y, width, height int32) bool {
	if hwnd == 0 {
		return true
	}
	current, ok := childClientRect(hwnd, parent)
	if !ok {
		return false
	}
	return current.Left == x && current.Top == y && current.Right-current.Left == width && current.Bottom-current.Top == height
}

func round11ApplyMoves(parent uintptr, specs []round11MoveSpec) bool {
	moves := make([]round11MoveSpec, 0, len(specs))
	for _, spec := range specs {
		if spec.hwnd == 0 || spec.width <= 0 || spec.height <= 0 {
			continue
		}
		if !round11ControlRectMatches(spec.hwnd, parent, spec.x, spec.y, spec.width, spec.height) {
			moves = append(moves, spec)
		}
	}
	if len(moves) == 0 {
		return false
	}
	hdwp, _, _ := round7FeedbackBeginDeferWindowPos.Call(uintptr(len(moves)))
	if hdwp == 0 {
		for _, spec := range moves {
			procMoveWindow.Call(spec.hwnd, uintptr(spec.x), uintptr(spec.y), uintptr(spec.width), uintptr(spec.height), 0)
		}
		return true
	}
	flags := uintptr(round7FeedbackSWPNoZOrder | round7FeedbackSWPNoActivate)
	for _, spec := range moves {
		next, _, _ := round7FeedbackDeferWindowPos.Call(
			hdwp, spec.hwnd, 0,
			uintptr(spec.x), uintptr(spec.y), uintptr(spec.width), uintptr(spec.height), flags,
		)
		if next != 0 {
			hdwp = next
		}
	}
	round7FeedbackEndDeferWindowPos.Call(hdwp)
	return true
}

func round11ApplyEditorLayout(e *round7Editor, force bool) {
	if e == nil || e.hwnd == 0 || e.dialog == nil {
		return
	}
	d := e.dialog
	var client rect
	procGetClientRect.Call(e.hwnd, uintptr(unsafe.Pointer(&client)))
	width, height := client.Right-client.Left, client.Bottom-client.Top
	if width <= 0 || height <= 0 {
		return
	}
	value, _ := round11EditorStateMap.LoadOrStore(e.hwnd, &round11EditorLayoutState{})
	state := value.(*round11EditorLayoutState)
	if !force && state.initialized && state.clientWidth == width && state.clientHeight == height {
		return
	}
	state.clientWidth, state.clientHeight = width, height

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

	procShowWindow.Call(e.hInstruction, round9FeedbackSWHide)
	procShowWindow.Call(e.hSourceRange, round9FeedbackSWHide)
	procShowWindow.Call(e.hApplySelected, round9FeedbackSWHide)

	decor := round7FeedbackEnsureDecor(e)
	procShowWindow.Call(decor.timeLine, round9FeedbackSWHide)
	procShowWindow.Call(decor.cropLine, round9FeedbackSWHide)
	r9decor := round9EnsureEditorDecor(e)

	currentY := int32(42) + previewH
	timelineY := currentY + 38
	seekY := timelineY + 92
	buttonW := int32(76)
	totalSeek := buttonW*4 + 8*3
	seekX := margin + (leftW-totalSeek)/2
	clipTop := int32(54)
	cropTop := int32(184)
	pairW := (rightW - 28) / 4
	infoTop := cropTop + 178
	infoBottom := client.Bottom - 70
	if infoBottom-infoTop < 108 {
		infoBottom = infoTop + 108
	}
	bottomY := client.Bottom - 48

	specs := []round11MoveSpec{
		{d.hCanvas, margin, 14, leftW, previewH},
		{e.hCurrentLabel, margin, currentY + 4, 68, 28},
		{d.hNow, margin + 70, currentY, 140, 30},
		{e.hJump, margin + 216, currentY, 62, 30},
		{e.hTimeline, margin, timelineY, leftW, 86},
		{e.hSeekMinusSec, seekX, seekY, buttonW, 30},
		{e.hSeekMinusFrame, seekX + buttonW + 8, seekY, buttonW, 30},
		{e.hSeekPlusFrame, seekX + (buttonW + 8) * 2, seekY, buttonW, 30},
		{e.hSeekPlusSec, seekX + (buttonW + 8) * 3, seekY, buttonW, 30},
		{e.hFileLabel, rightX, 14, rightW, 26},
		{decor.timeTitle, rightX + 12, clipTop - 11, 64, 24},
		{e.hStartLabel, rightX + 14, clipTop + 22, 64, 28},
		{d.hStart, rightX + 80, clipTop + 18, 124, 30},
		{e.hStartCurrent, rightX + 212, clipTop + 18, 54, 30},
		{e.hStartInitial, rightX + 274, clipTop + 18, 72, 30},
		{e.hEndLabel, rightX + 14, clipTop + 60, 64, 28},
		{d.hEnd, rightX + 80, clipTop + 56, 124, 30},
		{e.hEndCurrent, rightX + 212, clipTop + 56, 54, 30},
		{e.hEndTerminal, rightX + 274, clipTop + 56, 72, 30},
		{decor.cropTitle, rightX + 12, cropTop - 11, 64, 24},
		{d.hCrop, rightX + 14, cropTop + 20, 150, 28},
		{d.hX, rightX + 36, cropTop + 57, pairW - 28, 30},
		{d.hY, rightX + 14 + pairW + 22, cropTop + 57, pairW - 28, 30},
		{d.hW, rightX + 14 + pairW*2 + 22, cropTop + 57, pairW - 28, 30},
		{d.hH, rightX + 14 + pairW*3 + 22, cropTop + 57, pairW - 28, 30},
		{e.hCropFrameLabel, rightX + 14, cropTop + 99, 190, 28},
		{e.hAspectLabel, rightX + 205, cropTop + 99, 36, 28},
		{d.hAspect, rightX + 243, cropTop + 94, 82, 160},
		{e.hCenter, rightX + 332, cropTop + 94, 54, 30},
		{e.hPreview, rightX + 108, cropTop + 132, 88, 32},
		{e.hFullFrame, rightX + 204, cropTop + 132, 100, 32},
		{d.hInfo, rightX + 14, infoTop, rightW - 28, infoBottom - infoTop},
		{e.hApplyCurrent, rightX + rightW - 184, bottomY, 96, 38},
		{e.hCancel, rightX + rightW - 80, bottomY, 80, 38},
	}
	if r9decor != nil {
		specs = append(specs, round11MoveSpec{r9decor.previewTitle, rightX + 14, cropTop + 136, 90, 24})
	}
	for i := range e.cropLabels {
		x := rightX + 14 + int32(i)*pairW
		specs = append(specs, round11MoveSpec{e.cropLabels[i], x, cropTop + 61, 22, 26})
	}
	moved := round11ApplyMoves(e.hwnd, specs)

	textsChanged := false
	textsChanged = round11SetTextIfChanged(e.hFileLabel, "标题："+filepath.Base(d.task.Input)) || textsChanged
	textsChanged = round11SetTextIfChanged(e.hCurrentLabel, "当前时间") || textsChanged
	textsChanged = round11SetTextIfChanged(decor.timeTitle, "剪辑") || textsChanged
	textsChanged = round11SetTextIfChanged(decor.cropTitle, "画面") || textsChanged
	textsChanged = round11SetTextIfChanged(e.hStartLabel, "起始时间") || textsChanged
	textsChanged = round11SetTextIfChanged(e.hEndLabel, "结束时间") || textsChanged
	textsChanged = round11SetTextIfChanged(e.hStartCurrent, "当前") || textsChanged
	textsChanged = round11SetTextIfChanged(e.hEndCurrent, "当前") || textsChanged
	textsChanged = round11SetTextIfChanged(e.hStartInitial, "源起点") || textsChanged
	textsChanged = round11SetTextIfChanged(e.hEndTerminal, "源终点") || textsChanged
	textsChanged = round11SetTextIfChanged(e.hCropFrameLabel, "转正后尺寸  "+formatDimension(d.frameW, d.frameH)) || textsChanged
	textsChanged = round11SetTextIfChanged(e.hAspectLabel, "比例") || textsChanged
	textsChanged = round11SetTextIfChanged(e.hCenter, "居中") || textsChanged
	textsChanged = round11SetTextIfChanged(e.hPreview, "高清预览") || textsChanged
	textsChanged = round11SetTextIfChanged(e.hFullFrame, "恢复全画面") || textsChanged
	textsChanged = round11SetTextIfChanged(e.hApplyCurrent, "应用") || textsChanged
	shortLabels := []string{"左", "上", "宽", "高"}
	for i := range e.cropLabels {
		textsChanged = round11SetTextIfChanged(e.cropLabels[i], shortLabels[i]) || textsChanged
	}
	if !state.infoFlattened {
		round7FeedbackFlattenInfoControl(d.hInfo)
		state.infoFlattened = true
	}
	round9LayoutPreviewStatus(e)
	if !state.initialized {
		round7FeedbackRefreshInfoCard(e)
	}
	state.initialized = true
	if moved || textsChanged || force {
		procRedrawWindow.Call(e.hwnd, 0, 0, RDW_INVALIDATE|RDW_ALLCHILDREN)
	}
}

func round11PaintEditor(e *round7Editor, hwnd uintptr) {
	var ps paintStruct
	hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	if hdc == 0 {
		return
	}
	defer procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	fillSolid(hdc, rc, colorRef(250, 251, 253))
	round9DrawEditorGroups(e, hdc)
}

func round11EditorSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	e := round7ActiveEditor
	switch message {
	case WM_SIZE:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if e != nil && e.hwnd == hwnd {
			round11ApplyEditorLayout(e, false)
		}
		return result
	case WM_PAINT:
		if e != nil && e.hwnd == hwnd {
			round11PaintEditor(e, hwnd)
			return 0
		}
	case WM_ERASEBKGND:
		return 1
	case WM_COMMAND:
		if e != nil && e.hwnd == hwnd && int(loWord(wParam)) == IDC_FRAME_PREVIEW {
			round7FeedbackGenerateProcessedPreview(e)
			return 0
		}
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if e != nil && e.hwnd == hwnd && !e.done {
			round7FeedbackRefreshInfoCard(e)
		}
		return result
	case WM_CTLCOLORSTATIC:
		if wParam != 0 {
			procSetBkMode.Call(wParam, TRANSPARENT)
			procSetTextColor.Call(wParam, colorRef(52, 62, 76))
		}
		return round7FeedbackEditorBrush()
	case WM_CTLCOLOREDIT:
		if e != nil && e.dialog != nil && lParam == e.dialog.hInfo {
			procSetBkMode.Call(wParam, TRANSPARENT)
			procSetTextColor.Call(wParam, colorRef(76, 87, 101))
			return round7FeedbackEditorInfoBrush()
		}
	case v452WMNCDestroy:
		round11EditorStateMap.Delete(hwnd)
		round9EditorDecorMap.Delete(hwnd)
		v452RemoveSubclass.Call(hwnd, round11EditorSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round11CanvasPaintSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	e := round7ActiveEditor
	switch message {
	case WM_PAINT:
		if e != nil && e.dialog != nil && e.dialog.hCanvas == hwnd {
			round7FeedbackPaintCanvas(e, hwnd)
			return 0
		}
	case WM_ERASEBKGND:
		return 1
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round11CanvasPaintCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

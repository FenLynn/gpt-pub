//go:build windows

package main

import (
	"path/filepath"
	"sync"
	"syscall"
	"unsafe"
)

const (
	round11EditorSubclassID      = 0x45B3
	round11CanvasPaintSubclassID = 0x45B4
)

type round11EditorLayoutState struct {
	clientWidth, clientHeight int32
	initialized               bool
	infoFlattened             bool
}

type round11MoveSpec struct {
	hwnd                uintptr
	x, y, width, height int32
}

var (
	round11EditorSubclassCB uintptr
	round11CanvasPaintCB    uintptr
	round11EditorStateMap   sync.Map
)

func init() {
	round11EditorSubclassCB = syscall.NewCallback(round11EditorSubclassProc)
	round11CanvasPaintCB = syscall.NewCallback(round11CanvasPaintSubclassProc)
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

	procShowWindow.Call(e.hInstruction, SW_HIDE)
	procShowWindow.Call(e.hSourceRange, SW_HIDE)
	procShowWindow.Call(e.hApplySelected, SW_HIDE)

	decor := round7FeedbackEnsureDecor(e)
	procShowWindow.Call(decor.timeLine, SW_HIDE)
	procShowWindow.Call(decor.cropLine, SW_HIDE)
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
		{e.hSeekPlusFrame, seekX + (buttonW+8)*2, seekY, buttonW, 30},
		{e.hSeekPlusSec, seekX + (buttonW+8)*3, seekY, buttonW, 30},
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

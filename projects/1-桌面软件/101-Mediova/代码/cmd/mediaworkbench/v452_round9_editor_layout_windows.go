//go:build windows

package main

import (
	"path/filepath"
	"sync"
	"syscall"
	"time"
	"unsafe"
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
	round9EditorSubclassCB   uintptr
	round9TimelineSubclassCB uintptr
	round9CanvasSubclassCB   uintptr
	round9EditorDecorMap     sync.Map
	round9CanvasDragMap      sync.Map
	round9SetCursor          = user32.NewProc("SetCursor")
)

func init() {
	round9EditorSubclassCB = syscall.NewCallback(round9EditorSubclassProc)
	round9TimelineSubclassCB = syscall.NewCallback(round9TimelineSubclassProc)
	round9CanvasSubclassCB = syscall.NewCallback(round9CanvasSubclassProc)
}

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

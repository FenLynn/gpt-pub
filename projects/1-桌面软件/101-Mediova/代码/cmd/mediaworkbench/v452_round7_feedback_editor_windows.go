//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unsafe"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

type round7FeedbackCanvasState struct {
	lastControlSync time.Time
}

var (
	round7FeedbackCanvasStates sync.Map
	round7FeedbackInfoBrush uintptr
)

func round7FeedbackEditSelected(a *application) {
	if a == nil {
		return
	}
	idxs := a.selectedTaskIndices()
	if len(idxs) == 0 {
		messageBox(a.hwnd, "剪裁", "请先选择一个任务。", MB_OK|MB_ICONINFORMATION)
		return
	}

	a.mu.Lock()
	idx := idxs[0]
	if idx < 0 || idx >= len(a.tasks) || a.tasks[idx] == nil {
		a.mu.Unlock()
		return
	}
	task := a.tasks[idx]
	if !round7FeedbackTaskEditable(task.Status) {
		a.mu.Unlock()
		messageBox(a.hwnd, "剪裁", "该任务当前仍在队列、转换或暂停状态。请先通过右键“临时操作 → 搁置并修改参数”解锁。", MB_OK|MB_ICONINFORMATION)
		return
	}
	taskSnapshot := *task
	opts := a.settings.EffectiveOptions(task)
	held := task.Status == model.StatusHeld
	if held {
		opts = task.Options
	}
	a.mu.Unlock()

	round7FeedbackArmEditorHook()
	result, accepted, applySelected := round7ShowEditor(a, &taskSnapshot, opts, idxs)
	if !accepted {
		return
	}
	result.FollowDefaults = false

	a.mu.Lock()
	applied := 0
	if idx >= 0 && idx < len(a.tasks) && a.tasks[idx] != nil && round7FeedbackTaskEditable(a.tasks[idx].Status) {
		a.tasks[idx].Options = result
		if a.tasks[idx].Status != model.StatusHeld {
			resetTaskAfterOptionChange(a.tasks[idx])
		}
		applied++
	}
	if applySelected {
		for _, targetIndex := range idxs[1:] {
			if targetIndex < 0 || targetIndex >= len(a.tasks) || a.tasks[targetIndex] == nil {
				continue
			}
			target := a.tasks[targetIndex]
			if !round7FeedbackTaskEditable(target.Status) {
				continue
			}
			targetOpts := a.settings.EffectiveOptions(target)
			if target.Status == model.StatusHeld {
				targetOpts = target.Options
			}
			targetOpts.FollowDefaults = false
			targetOpts.TrimStart, targetOpts.TrimEnd = trimRangeForTarget(result, target)
			targetOpts.Crop = scaledCropForTarget(&taskSnapshot, result, target, targetOpts)
			target.Options = targetOpts
			if target.Status != model.StatusHeld {
				resetTaskAfterOptionChange(target)
			}
			applied++
		}
	}
	a.mu.Unlock()

	a.saveSession()
	a.refreshList()
	a.updateRightPanel()
	switch {
	case held:
		setText(a.hStatusText, "剪裁设置已保存到搁置任务；点击“应用并归队”或“应用并立即重启”后生效。")
	case applySelected:
		setText(a.hStatusText, fmt.Sprintf("剪裁设置已应用到 %d 个可修改任务。", applied))
	default:
		setText(a.hStatusText, "剪裁设置已应用到当前任务。")
	}
}

func round7FeedbackArmEditorHook() {
	round7FeedbackEditorHookMu.Lock()
	defer round7FeedbackEditorHookMu.Unlock()
	if round7FeedbackEditorHook != 0 {
		return
	}
	round7FeedbackEditorHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		round7FeedbackEditorEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func round7FeedbackEditorEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	e := round7ActiveEditor
	if e == nil || e.hwnd == 0 || e.hTimeline == 0 || e.dialog == nil || e.dialog.hCanvas == 0 || e.hApplyCurrent == 0 {
		return 0
	}
	if ok, _, _ := v452SetWindowSubclass.Call(e.hwnd, round7FeedbackEditorSubclassCB, round7FeedbackEditorSubclassID, 0); ok == 0 {
		return 0
	}
	v452SetWindowSubclass.Call(e.hTimeline, round7FeedbackTimelineCB, round7FeedbackTimelineSubclassID, 0)
	v452SetWindowSubclass.Call(e.dialog.hCanvas, round7FeedbackCanvasCB, round7FeedbackCanvasSubclassID, 0)
	procPostMessageW.Call(e.hwnd, round7FeedbackWMEditorInit, 0, 0)

	round7FeedbackEditorHookMu.Lock()
	if round7FeedbackEditorHook != 0 {
		round7FeedbackUnhookWinEvent.Call(round7FeedbackEditorHook)
		round7FeedbackEditorHook = 0
	}
	round7FeedbackEditorHookMu.Unlock()
	return 0
}

func round7FeedbackEditorBrush() uintptr {
	if uiCanvasBrush != 0 {
		return uiCanvasBrush
	}
	brush, _, _ := procCreateSolidBrush.Call(colorRef(250, 251, 253))
	return brush
}

func round7FeedbackEditorInfoBrush() uintptr {
	if round7FeedbackInfoBrush == 0 {
		round7FeedbackInfoBrush, _, _ = procCreateSolidBrush.Call(colorRef(243, 246, 249))
	}
	return round7FeedbackInfoBrush
}

func round7FeedbackEditorSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	e := round7ActiveEditor
	switch message {
	case round7FeedbackWMEditorInit:
		if e != nil && e.hwnd == hwnd {
			round7FeedbackApplyEditorLayout(e)
			procRedrawWindow.Call(hwnd, 0, 0, RDW_INVALIDATE|RDW_ALLCHILDREN|RDW_UPDATENOW)
		}
		return 0
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
	case WM_ERASEBKGND:
		if wParam != 0 {
			var rc rect
			procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
			fillSolid(wParam, rc, colorRef(250, 251, 253))
		}
		return 1
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
	case WM_SIZE:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if e != nil && e.hwnd == hwnd {
			round7FeedbackApplyEditorLayout(e)
		}
		return result
	case v452WMNCDestroy:
		round7FeedbackDecor.Delete(hwnd)
		v452RemoveSubclass.Call(hwnd, round7FeedbackEditorSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round7FeedbackApplyEditorLayout(e *round7Editor) {
	if e == nil || e.hwnd == 0 || e.dialog == nil {
		return
	}
	d := e.dialog
	var window rect
	procGetWindowRect.Call(e.hwnd, uintptr(unsafe.Pointer(&window)))
	width, height := int32(1080), int32(760)
	var work rect
	if ok, _, _ := procSystemParametersInfoW.Call(SPI_GETWORKAREA, 0, uintptr(unsafe.Pointer(&work)), 0); ok != 0 {
		if max := work.Right - work.Left - 20; width > max {
			width = max
		}
		if max := work.Bottom - work.Top - 20; height > max {
			height = max
		}
	}
	if width < 980 {
		width = 980
	}
	if height < 700 {
		height = 700
	}
	procMoveWindow.Call(e.hwnd, uintptr(window.Left), uintptr(window.Top), uintptr(width), uintptr(height), 1)

	var client rect
	procGetClientRect.Call(e.hwnd, uintptr(unsafe.Pointer(&client)))
	margin, gap, rightW := int32(16), int32(18), int32(400)
	leftW := client.Right - margin*2 - gap - rightW
	if leftW < 540 {
		rightW = 374
		leftW = client.Right - margin*2 - gap - rightW
	}
	rightX := margin + leftW + gap
	previewH := client.Bottom - 315
	if previewH > 390 {
		previewH = 390
	}
	if previewH < 340 {
		previewH = 340
	}

	round7FeedbackMove(d.hCanvas, margin, 18, leftW, previewH)
	instructionY := int32(26) + previewH
	round7FeedbackMove(e.hInstruction, margin, instructionY, leftW, 22)
	currentY := instructionY + 28
	round7FeedbackMove(e.hCurrentLabel, margin, currentY+4, 68, 28)
	round7FeedbackMove(d.hNow, margin+70, currentY, 140, 30)
	round7FeedbackMove(e.hJump, margin+216, currentY, 62, 30)
	round7FeedbackMove(e.hFileLabel, margin+290, currentY+4, leftW-290, 28)
	round7FeedbackMove(e.hSourceRange, margin, currentY+34, leftW, 24)
	timelineY := currentY + 62
	round7FeedbackMove(e.hTimeline, margin, timelineY, leftW, 108)
	seekY := timelineY + 114
	buttonW := int32(76)
	totalSeek := buttonW*4 + 8*3
	seekX := margin + (leftW-totalSeek)/2
	round7FeedbackMove(e.hSeekMinusSec, seekX, seekY, buttonW, 30)
	round7FeedbackMove(e.hSeekMinusFrame, seekX+buttonW+8, seekY, buttonW, 30)
	round7FeedbackMove(e.hSeekPlusFrame, seekX+(buttonW+8)*2, seekY, buttonW, 30)
	round7FeedbackMove(e.hSeekPlusSec, seekX+(buttonW+8)*3, seekY, buttonW, 30)

	decor := round7FeedbackEnsureDecor(e)
	round7FeedbackMove(decor.timeTitle, rightX, 18, rightW, 24)
	round7FeedbackMove(decor.timeLine, rightX, 43, rightW, 1)
	round7FeedbackMove(e.hStartLabel, rightX, 54, 70, 28)
	round7FeedbackMove(d.hStart, rightX+72, 50, 126, 30)
	round7FeedbackMove(e.hStartCurrent, rightX+204, 50, 58, 30)
	round7FeedbackMove(e.hStartInitial, rightX+268, 50, 76, 30)
	round7FeedbackMove(e.hEndLabel, rightX, 90, 70, 28)
	round7FeedbackMove(d.hEnd, rightX+72, 86, 126, 30)
	round7FeedbackMove(e.hEndCurrent, rightX+204, 86, 58, 30)
	round7FeedbackMove(e.hEndTerminal, rightX+268, 86, 76, 30)

	round7FeedbackMove(decor.cropTitle, rightX, 136, rightW, 24)
	round7FeedbackMove(decor.cropLine, rightX, 161, rightW, 1)
	round7FeedbackMove(d.hCrop, rightX, 170, 150, 28)

	pairW := (rightW - 18) / 4
	for i := range e.cropLabels {
		x := rightX + int32(i)*pairW
		round7FeedbackMove(e.cropLabels[i], x, 210, 24, 26)
	}
	round7FeedbackMove(d.hX, rightX+22, 206, pairW-28, 30)
	round7FeedbackMove(d.hY, rightX+pairW+22, 206, pairW-28, 30)
	round7FeedbackMove(d.hW, rightX+pairW*2+22, 206, pairW-28, 30)
	round7FeedbackMove(d.hH, rightX+pairW*3+22, 206, pairW-28, 30)

	round7FeedbackMove(e.hCropFrameLabel, rightX, 250, 150, 28)
	round7FeedbackMove(e.hAspectLabel, rightX+154, 250, 38, 28)
	round7FeedbackMove(d.hAspect, rightX+194, 244, 88, 180)
	round7FeedbackMove(e.hCenter, rightX+288, 244, 78, 30)
	round7FeedbackMove(e.hFullFrame, rightX, 282, 98, 30)

	round7FeedbackMove(d.hInfo, rightX, 324, rightW, 164)
	round7FeedbackFlattenInfoControl(d.hInfo)
	buttonY := int32(500)
	round7FeedbackMove(e.hPreview, rightX, buttonY, 88, 32)
	round7FeedbackMove(e.hApplySelected, rightX+96, buttonY, 112, 32)
	bottomY := client.Bottom - 48
	round7FeedbackMove(e.hApplyCurrent, rightX+rightW-232, bottomY, 142, 38)
	round7FeedbackMove(e.hCancel, rightX+rightW-82, bottomY, 82, 38)

	setText(decor.timeTitle, "剪辑")
	setText(decor.cropTitle, "画面")
	setText(e.hStartLabel, "起始时间")
	setText(e.hStartCurrent, "当前")
	setText(e.hStartInitial, "源起点")
	setText(e.hEndLabel, "结束时间")
	setText(e.hEndCurrent, "当前")
	setText(e.hEndTerminal, "源终点")
	setText(e.hInstruction, "拖动红色游标预览画面；拖动蓝色旗标调整剪辑范围。")
	setText(e.hCurrentLabel, "当前时间")
	setText(e.hSourceRange, "源范围  "+formatSecondsClock(0)+"  —  "+formatSecondsClock(d.task.Duration))
	setText(e.hCropFrameLabel, fmt.Sprintf("转正后 %d × %d", d.frameW, d.frameH))
	setText(e.hAspectLabel, "比例")
	setText(e.hFullFrame, "恢复全画面")
	setText(e.hCenter, "居中")
	setText(e.hPreview, "高清预览")
	setText(e.hApplySelected, "应用到已选")
	setText(e.hApplyCurrent, "应用当前")

	title := "剪裁 · " + filepath.Base(d.task.Input)
	setText(e.hwnd, title)
	round7FeedbackRefreshInfoCard(e)
	procInvalidateRect.Call(e.hTimeline, 0, 0)
	procInvalidateRect.Call(d.hCanvas, 0, 0)
}

func round7FeedbackFlattenInfoControl(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	style, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle)
	style &^= uintptr(round7FeedbackWSVScroll | round7FeedbackWSBorder)
	round7FeedbackSetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle, style)
	exStyle, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLExStyle)
	exStyle &^= uintptr(round7FeedbackWSExClientEdge)
	round7FeedbackSetWindowLongPtr.Call(hwnd, round7FeedbackGWLExStyle, exStyle)
	round7FeedbackSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0, round7FeedbackSWPNoMove|round7FeedbackSWPNoSize|round7FeedbackSWPNoZOrder|round7FeedbackSWPNoActivate|round7FeedbackSWPFrameChanged)
}

func round7FeedbackMove(hwnd uintptr, x, y, w, h int32) {
	if hwnd != 0 && w > 0 && h > 0 {
		procMoveWindow.Call(hwnd, uintptr(x), uintptr(y), uintptr(w), uintptr(h), 1)
	}
}

func round7FeedbackEnsureDecor(e *round7Editor) *round7FeedbackEditorDecor {
	if e == nil || e.hwnd == 0 {
		return &round7FeedbackEditorDecor{}
	}
	if cached, ok := round7FeedbackDecor.Load(e.hwnd); ok {
		return cached.(*round7FeedbackEditorDecor)
	}
	decor := &round7FeedbackEditorDecor{
		timeTitle: createControl("STATIC", "剪辑", WS_CHILD|WS_VISIBLE, 0, 0, 10, 10, e.hwnd, 0),
		timeLine: createControl("STATIC", "", WS_CHILD|WS_VISIBLE, 0, 0, 10, 1, e.hwnd, 0),
		cropTitle: createControl("STATIC", "画面", WS_CHILD|WS_VISIBLE, 0, 0, 10, 10, e.hwnd, 0),
		cropLine: createControl("STATIC", "", WS_CHILD|WS_VISIBLE, 0, 0, 10, 1, e.hwnd, 0),
	}
	send(decor.timeTitle, WM_SETFONT, uiFontBold, 1)
	send(decor.cropTitle, WM_SETFONT, uiFontBold, 1)
	round7FeedbackDecor.Store(e.hwnd, decor)
	return decor
}

func round7FeedbackRefreshInfoCard(e *round7Editor) {
	if e == nil || e.dialog == nil || e.dialog.hInfo == 0 {
		return
	}
	d := e.dialog
	crop := d.opts.Crop
	area := d.frameW * d.frameH
	keep := crop.Width * crop.Height
	percent := 100.0
	region := fmt.Sprintf("全画面 %d × %d", d.frameW, d.frameH)
	if crop.Enabled {
		if area > 0 {
			percent = float64(keep) / float64(area) * 100
		}
		region = fmt.Sprintf("%d × %d，位置 (%d, %d)", crop.Width, crop.Height, crop.X, crop.Y)
	}
	if d.task.Kind == model.KindImage {
		setText(d.hInfo, fmt.Sprintf("转正后尺寸    %d × %d\r\n保留区域      %s\r\n保留面积      %.1f%%\r\n处理顺序      转正 → 剪裁 → 缩放 → 编码", d.frameW, d.frameH, region, percent))
		return
	}
	start, _ := parseTimeValue(getText(d.hStart))
	end, _ := parseTimeValue(getText(d.hEnd))
	setText(d.hInfo, fmt.Sprintf("转正后尺寸    %d × %d\r\n保留区域      %s\r\n保留面积      %.1f%%\r\n输出时长      %s\r\n处理顺序      转正 → 剪裁 → 缩放", d.frameW, d.frameH, region, percent, formatSecondsClock(end-start)))
}

func round7FeedbackSyncCropControls(e *round7Editor, final bool) {
	if e == nil || e.dialog == nil {
		return
	}
	d := e.dialog
	setText(d.hX, strconv.Itoa(d.opts.Crop.X))
	setText(d.hY, strconv.Itoa(d.opts.Crop.Y))
	setText(d.hW, strconv.Itoa(d.opts.Crop.Width))
	setText(d.hH, strconv.Itoa(d.opts.Crop.Height))
	send(d.hCrop, BM_SETCHECK, BST_CHECKED, 0)
	if final {
		round7FeedbackRefreshInfoCard(e)
	}
}

func round7FeedbackCanvasSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	e := round7ActiveEditor
	if e == nil || e.dialog == nil || e.dialog.hCanvas != hwnd {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
	d := e.dialog
	stateValue, _ := round7FeedbackCanvasStates.LoadOrStore(hwnd, &round7FeedbackCanvasState{})
	state := stateValue.(*round7FeedbackCanvasState)
	switch message {
	case WM_PAINT:
		round7FeedbackPaintCanvas(e, hwnd)
		return 0
	case WM_ERASEBKGND:
		return 1
	case WM_LBUTTONDOWN:
		if pt, ok := d.imagePoint(lParam); ok {
			d.dragging = true
			d.dragStart = pt
			d.opts.Crop = model.Crop{Enabled: true, X: int(pt.X), Y: int(pt.Y), Width: 2, Height: 2}
			round7FeedbackSyncCropControls(e, false)
			procSetCapture.Call(hwnd)
			procInvalidateRect.Call(hwnd, 0, 0)
		}
		return 0
	case WM_MOUSEMOVE:
		if d.dragging {
			if pt, ok := d.imagePointClamped(lParam); ok {
				ratioW, ratioH, locked := d.selectedAspect()
				d.opts.Crop = media.DragCropWithAspect(d.frameW, d.frameH, int(d.dragStart.X), int(d.dragStart.Y), int(pt.X), int(pt.Y), ratioW, ratioH, locked)
				now := time.Now()
				if now.Sub(state.lastControlSync) >= 40*time.Millisecond {
					round7FeedbackSyncCropControls(e, false)
					state.lastControlSync = now
				}
				procInvalidateRect.Call(hwnd, 0, 0)
			}
			return 0
		}
	case WM_LBUTTONUP:
		if d.dragging {
			d.dragging = false
			procReleaseCapture.Call()
			if pt, ok := d.imagePointClamped(lParam); ok {
				ratioW, ratioH, locked := d.selectedAspect()
				d.opts.Crop = media.DragCropWithAspect(d.frameW, d.frameH, int(d.dragStart.X), int(d.dragStart.Y), int(pt.X), int(pt.Y), ratioW, ratioH, locked)
			}
			round7FeedbackSyncCropControls(e, true)
			procInvalidateRect.Call(hwnd, 0, 0)
			return 0
		}
	case v452WMNCDestroy:
		round7FeedbackCanvasStates.Delete(hwnd)
		v452RemoveSubclass.Call(hwnd, round7FeedbackCanvasCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round7FeedbackPaintCanvas(e *round7Editor, hwnd uintptr) {
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
		e.dialog.paintPreview(hwnd)
		return
	}
	oldBitmap, _, _ := procSelectObject.Call(memDC, bitmap)
	fillSolid(memDC, rc, colorRef(20, 24, 29))
	d := e.dialog
	if d.bitmap != 0 && d.bitmapW > 0 && d.bitmapH > 0 {
		dr := d.previewDrawRect(hwnd)
		sourceDC, _, _ := procCreateCompatibleDC.Call(memDC)
		oldSource, _, _ := procSelectObject.Call(sourceDC, d.bitmap)
		procSetStretchBltMode.Call(memDC, HALFTONE)
		procStretchBlt.Call(memDC, uintptr(dr.Left), uintptr(dr.Top), uintptr(dr.Right-dr.Left), uintptr(dr.Bottom-dr.Top), sourceDC, 0, 0, uintptr(d.bitmapW), uintptr(d.bitmapH), SRCCOPY)
		procSelectObject.Call(sourceDC, oldSource)
		procDeleteDC.Call(sourceDC)
		round7FeedbackDrawCropOverlay(d, memDC, dr)
	} else {
		message := "正在生成预览…"
		if d.owner == nil || d.owner.ffmpeg == "" {
			message = "未配置 FFmpeg，无法生成预览"
		} else if info := getText(d.hInfo); strings.Contains(info, "预览帧") {
			message = short(info, 90)
		}
		drawCenteredText(memDC, message, rc, uiFont, colorRef(196, 203, 212))
	}
	round7FeedbackBitBlt.Call(hdc, 0, 0, uintptr(width), uintptr(height), memDC, 0, 0, SRCCOPY)
	procSelectObject.Call(memDC, oldBitmap)
	procDeleteObject.Call(bitmap)
	procDeleteDC.Call(memDC)
}

func round7FeedbackDrawCropOverlay(d *trimDialog, hdc uintptr, dr rect) {
	if d == nil || !d.opts.Crop.Enabled || d.frameW <= 0 || d.frameH <= 0 {
		return
	}
	c := d.opts.Crop
	sx := float64(dr.Right-dr.Left) / float64(d.frameW)
	sy := float64(dr.Bottom-dr.Top) / float64(d.frameH)
	r := rect{Left: dr.Left + int32(float64(c.X)*sx), Top: dr.Top + int32(float64(c.Y)*sy), Right: dr.Left + int32(float64(c.X+c.Width)*sx), Bottom: dr.Top + int32(float64(c.Y+c.Height)*sy)}
	green := colorRef(25, 205, 110)
	pen, _, _ := procCreatePen.Call(PS_SOLID, 2, green)
	oldPen, _, _ := procSelectObject.Call(hdc, pen)
	nullBrush, _, _ := procGetStockObject.Call(NULL_BRUSH)
	oldBrush, _, _ := procSelectObject.Call(hdc, nullBrush)
	procRectangle.Call(hdc, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right), uintptr(r.Bottom))
	procSelectObject.Call(hdc, oldBrush)
	procSelectObject.Call(hdc, oldPen)
	procDeleteObject.Call(pen)
	handle := scaleDPI(5)
	for _, pt := range []point{{X: r.Left, Y: r.Top}, {X: r.Right, Y: r.Top}, {X: r.Left, Y: r.Bottom}, {X: r.Right, Y: r.Bottom}, {X: (r.Left+r.Right)/2, Y: r.Top}, {X: (r.Left+r.Right)/2, Y: r.Bottom}, {X: r.Left, Y: (r.Top+r.Bottom)/2}, {X: r.Right, Y: (r.Top+r.Bottom)/2}} {
		fillSolid(hdc, rect{Left: pt.X-handle, Top: pt.Y-handle, Right: pt.X+handle+1, Bottom: pt.Y+handle+1}, green)
	}
}

func round7FeedbackGenerateProcessedPreview(e *round7Editor) {
	if e == nil || e.dialog == nil || e.dialog.owner == nil {
		return
	}
	d := e.dialog
	if d.owner.ffmpeg == "" {
		messageBox(e.hwnd, "高清预览", "尚未配置 FFmpeg。", MB_OK|MB_ICONERROR)
		return
	}
	d.cropFromControls(true)
	seq := d.previewSeq.Add(1)
	dir, _ := config.TempDir()
	out := filepath.Join(dir, fmt.Sprintf("crop_preview_%d_%d.bmp", d.task.ID, seq))
	req := media.ConvertRequest{Input: d.task.Input, Output: out, Kind: d.task.Kind, Probe: media.ProbeInfo{Width: d.task.Width, Height: d.task.Height, Rotation: d.task.Rotation, Duration: d.task.Duration, FPS: d.task.FPS}, Options: d.opts, Settings: d.owner.settings}
	at := d.currentAt
	setText(e.hInstruction, "正在生成处理后高清预览…")
	go func() {
		err := media.GenerateProcessedFrame(context.Background(), d.owner.ffmpeg, req, at)
		d.owner.postUI(func() {
			defer os.Remove(out)
			if d.closed.Load() || d.previewSeq.Load() != seq {
				return
			}
			if err != nil {
				messageBox(e.hwnd, "高清预览", err.Error(), MB_OK|MB_ICONERROR)
				setText(e.hInstruction, "拖动红色游标预览画面；拖动蓝色旗标调整剪辑范围。")
				return
			}
			h, _, _ := procLoadImageW.Call(0, uintptr(unsafe.Pointer(p(out))), IMAGE_BITMAP, 0, 0, LR_LOADFROMFILE|LR_CREATEDIBSECTION)
			if h == 0 {
				messageBox(e.hwnd, "高清预览", "处理后预览加载失败。", MB_OK|MB_ICONERROR)
				return
			}
			if d.bitmap != 0 {
				procDeleteObject.Call(d.bitmap)
			}
			d.bitmap = h
			var bm bitmapInfo
			procGetObjectW.Call(h, unsafe.Sizeof(bm), uintptr(unsafe.Pointer(&bm)))
			d.bitmapW, d.bitmapH = bm.Width, bm.Height
			setText(e.hInstruction, "已显示处理后高清预览；移动当前时间后将恢复对应源帧预览。")
			procInvalidateRect.Call(d.hCanvas, 0, 0)
		})
	}()
}

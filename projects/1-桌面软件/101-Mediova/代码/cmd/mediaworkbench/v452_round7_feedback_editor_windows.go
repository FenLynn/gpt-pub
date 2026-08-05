//go:build windows

package main

import (
	"fmt"
	"path/filepath"
	"unsafe"

	"mediaworkbench/internal/model"
)

func round7FeedbackEditSelected(a *application) {
	if a == nil {
		return
	}
	idxs := a.selectedTaskIndices()
	if len(idxs) == 0 {
		messageBox(a.hwnd, "剪辑 / 画面", "请先选择一个任务。", MB_OK|MB_ICONINFORMATION)
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
		messageBox(a.hwnd, "剪辑 / 画面", "该任务当前仍在队列、转换或暂停状态。请先通过右键“临时操作 → 搁置并修改参数”解锁。", MB_OK|MB_ICONINFORMATION)
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
		setText(a.hStatusText, "剪辑 / 画面设置已保存到搁置任务；点击“应用并归队”或“应用并立即重启”后生效。")
	case applySelected:
		setText(a.hStatusText, fmt.Sprintf("剪辑 / 画面设置已应用到 %d 个可修改任务。", applied))
	default:
		setText(a.hStatusText, "剪辑 / 画面设置已应用到当前任务。")
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
	ok, _, _ := v452SetWindowSubclass.Call(e.hwnd, round7FeedbackEditorSubclassCB, round7FeedbackEditorSubclassID, 0)
	if ok == 0 {
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

func round7FeedbackEditorSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	e := round7ActiveEditor
	switch message {
	case round7FeedbackWMEditorInit:
		if e != nil && e.hwnd == hwnd {
			round7FeedbackApplyEditorLayout(e)
			procRedrawWindow.Call(hwnd, 0, 0, RDW_INVALIDATE|RDW_ALLCHILDREN|RDW_UPDATENOW)
		}
		return 0
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
	width := int32(1016)
	height := int32(748)
	var work rect
	if ok, _, _ := procSystemParametersInfoW.Call(SPI_GETWORKAREA, 0, uintptr(unsafe.Pointer(&work)), 0); ok != 0 {
		if max := work.Right - work.Left - 20; width > max {
			width = max
		}
		if max := work.Bottom - work.Top - 20; height > max {
			height = max
		}
	}
	if width < 960 {
		width = 960
	}
	if height < 700 {
		height = 700
	}
	procMoveWindow.Call(e.hwnd, uintptr(window.Left), uintptr(window.Top), uintptr(width), uintptr(height), 1)

	var client rect
	procGetClientRect.Call(e.hwnd, uintptr(unsafe.Pointer(&client)))
	margin := int32(18)
	gap := int32(17)
	rightW := int32(366)
	leftW := client.Right - margin*2 - gap - rightW
	if leftW < 540 {
		rightW = 344
		leftW = client.Right - margin*2 - gap - rightW
	}
	rightX := margin + leftW + gap
	previewH := int32(385)
	if client.Bottom < 700 {
		previewH = client.Bottom - 315
	}
	if previewH < 330 {
		previewH = 330
	}

	round7FeedbackMove(d.hCanvas, margin, 18, leftW, previewH)
	instructionY := int32(26) + previewH
	round7FeedbackMove(e.hInstruction, margin, instructionY, leftW, 24)
	currentY := instructionY + 32
	round7FeedbackMove(e.hCurrentLabel, margin, currentY+4, 72, 28)
	round7FeedbackMove(d.hNow, margin+74, currentY, 145, 30)
	round7FeedbackMove(e.hJump, margin+226, currentY, 70, 30)
	round7FeedbackMove(e.hFileLabel, margin+308, currentY+4, leftW-308, 28)
	timelineY := currentY + 38
	round7FeedbackMove(e.hTimeline, margin, timelineY, leftW, 100)
	seekY := timelineY + 108
	buttonW := int32(84)
	totalSeek := buttonW*4 + 8*3
	seekX := margin + (leftW-totalSeek)/2
	round7FeedbackMove(e.hSeekMinusSec, seekX, seekY, buttonW, 32)
	round7FeedbackMove(e.hSeekMinusFrame, seekX+buttonW+8, seekY, buttonW, 32)
	round7FeedbackMove(e.hSeekPlusFrame, seekX+(buttonW+8)*2, seekY, buttonW, 32)
	round7FeedbackMove(e.hSeekPlusSec, seekX+(buttonW+8)*3, seekY, buttonW, 32)

	decor := round7FeedbackEnsureDecor(e)
	round7FeedbackMove(decor.timeTitle, rightX, 15, rightW, 24)
	round7FeedbackMove(decor.timeLine, rightX, 39, rightW, 2)
	round7FeedbackMove(e.hStartLabel, rightX, 49, 96, 28)
	round7FeedbackMove(d.hStart, rightX+98, 45, 112, 30)
	round7FeedbackMove(e.hStartCurrent, rightX+216, 45, 70, 30)
	round7FeedbackMove(e.hStartInitial, rightX+292, 45, 70, 30)
	round7FeedbackMove(e.hEndLabel, rightX, 87, 96, 28)
	round7FeedbackMove(d.hEnd, rightX+98, 83, 112, 30)
	round7FeedbackMove(e.hEndCurrent, rightX+216, 83, 70, 30)
	round7FeedbackMove(e.hEndTerminal, rightX+292, 83, 70, 30)
	round7FeedbackMove(e.hSourceRange, rightX, 120, rightW, 28)

	round7FeedbackMove(decor.cropTitle, rightX, 153, rightW, 24)
	round7FeedbackMove(decor.cropLine, rightX, 177, rightW, 2)
	round7FeedbackMove(d.hCrop, rightX, 187, 160, 30)
	round7FeedbackMove(e.cropLabels[0], rightX, 229, 34, 26)
	round7FeedbackMove(d.hX, rightX+38, 225, 112, 30)
	round7FeedbackMove(e.cropLabels[1], rightX+158, 229, 34, 26)
	round7FeedbackMove(d.hY, rightX+196, 225, 108, 30)
	round7FeedbackMove(e.cropLabels[2], rightX, 267, 34, 26)
	round7FeedbackMove(d.hW, rightX+38, 263, 112, 30)
	round7FeedbackMove(e.cropLabels[3], rightX+158, 267, 34, 26)
	round7FeedbackMove(d.hH, rightX+196, 263, 108, 30)
	round7FeedbackMove(e.hCropFrameLabel, rightX, 304, 190, 40)
	round7FeedbackMove(e.hFullFrame, rightX+206, 304, 132, 32)
	round7FeedbackMove(e.hAspectLabel, rightX, 350, 68, 26)
	round7FeedbackMove(d.hAspect, rightX+70, 344, 118, 200)
	round7FeedbackMove(e.hCenter, rightX+204, 344, 132, 32)
	round7FeedbackMove(d.hInfo, rightX, 386, rightW, 124)
	round7FeedbackMove(e.hPreview, rightX, 520, rightW, 36)
	round7FeedbackMove(e.hApplySelected, rightX, 566, rightW, 36)
	round7FeedbackMove(e.hApplyCurrent, rightX, 616, rightW-142, 40)
	round7FeedbackMove(e.hCancel, rightX+rightW-134, 616, 134, 40)

	title := "剪辑 / 画面 · " + filepath.Base(d.task.Input)
	if d.task.Kind == model.KindImage {
		title = "画面调整 · " + filepath.Base(d.task.Input)
	}
	setText(e.hwnd, title)
	procInvalidateRect.Call(e.hTimeline, 0, 0)
	procInvalidateRect.Call(d.hCanvas, 0, 0)
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
		timeTitle: createControl("STATIC", "时间剪辑", WS_CHILD|WS_VISIBLE, 0, 0, 10, 10, e.hwnd, 0),
		timeLine:  createControl("STATIC", "", WS_CHILD|WS_VISIBLE|round7FeedbackSSEtchedHorz, 0, 0, 10, 2, e.hwnd, 0),
		cropTitle: createControl("STATIC", "画面选区", WS_CHILD|WS_VISIBLE, 0, 0, 10, 10, e.hwnd, 0),
		cropLine:  createControl("STATIC", "", WS_CHILD|WS_VISIBLE|round7FeedbackSSEtchedHorz, 0, 0, 10, 2, e.hwnd, 0),
	}
	send(decor.timeTitle, WM_SETFONT, uiFontBold, 1)
	send(decor.cropTitle, WM_SETFONT, uiFontBold, 1)
	send(decor.timeLine, WM_SETFONT, uiFontSmall, 1)
	send(decor.cropLine, WM_SETFONT, uiFontSmall, 1)
	round7FeedbackDecor.Store(e.hwnd, decor)
	return decor
}

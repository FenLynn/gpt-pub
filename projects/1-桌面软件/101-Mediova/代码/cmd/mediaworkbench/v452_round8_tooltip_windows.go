//go:build windows

package main

import (
	"sync/atomic"
	"syscall"
	"unsafe"
)

const (
	round8TooltipMainSubclassID = 0x4588
	round8TooltipTimer          = 0x4588
	round8TooltipDelay          = 420
	round8WMSetCursor           = 0x0020
	round8WMNCHitTest           = 0x0084
	round8HTTransparent         = ^uintptr(0)
	round8DTRCalcRect           = 0x00000400
	round8DTWordBreak           = 0x00000010
	round8DTNoPrefix            = 0x00000800
	round8SWPShowWindow         = 0x0040
	round8SWPHideWindow         = 0x0080
	round8WSExTopmost           = 0x00000008
	round8WSExNoActivate        = 0x08000000
)

type round8TooltipState struct {
	hwnd   uintptr
	target uintptr
	text   string
}

var (
	round8TooltipEventCB    uintptr
	round8TooltipMainCB     uintptr
	round8TooltipWndProcCB  uintptr
	round8TooltipHook       uintptr
	round8TooltipInstalled  atomic.Bool
	round8TooltipClassReady atomic.Bool
	round8Tooltip           round8TooltipState
	round8TooltipUnhook     = user32.NewProc("UnhookWinEvent")
	round8TooltipIsEnabled  = user32.NewProc("IsWindowEnabled")
)

func init() {
	round8TooltipEventCB = syscall.NewCallback(round8TooltipEventProc)
	round8TooltipMainCB = syscall.NewCallback(round8TooltipMainSubclassProc)
	round8TooltipWndProcCB = syscall.NewCallback(round8TooltipWndProc)
	round8TooltipHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		round8TooltipEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func round8TooltipEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	if round8TooltipInstalled.Load() || app == nil || app.hwnd == 0 || !app.controlsReady {
		return 0
	}
	if ok, _, _ := v452SetWindowSubclass.Call(app.hwnd, round8TooltipMainCB, round8TooltipMainSubclassID, 0); ok == 0 {
		return 0
	}
	round8TooltipRegisterClass()
	round8TooltipInstalled.Store(true)
	if round8TooltipHook != 0 {
		round8TooltipUnhook.Call(round8TooltipHook)
		round8TooltipHook = 0
	}
	return 0
}

func round8TooltipRegisterClass() {
	if round8TooltipClassReady.Load() {
		return
	}
	hInst, _, _ := procGetModuleHandleW.Call(0)
	cursor, _, _ := procLoadCursorW.Call(0, 32512)
	wc := wndClassEx{
		CbSize: uint32(unsafe.Sizeof(wndClassEx{})),
		LpfnWndProc: round8TooltipWndProcCB,
		HInstance: hInst,
		HCursor: cursor,
		HbrBackground: COLOR_WINDOW + 1,
		LpszClassName: p("MediovaRound8Tooltip"),
	}
	procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
	round8TooltipClassReady.Store(true)
}

func round8TooltipMainSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case round8WMSetCursor:
		round8TooltipSetTarget(hwnd, wParam)
	case WM_TIMER:
		if wParam == round8TooltipTimer {
			procKillTimer.Call(hwnd, round8TooltipTimer)
			round8TooltipShow(hwnd)
			return 0
		}
	case WM_COMMAND, WM_SIZE, WM_KILLFOCUS, WM_CLOSE, WM_DESTROY:
		round8TooltipHide(hwnd)
	case v452WMNCDestroy:
		round8TooltipHide(hwnd)
		if round8Tooltip.hwnd != 0 {
			procDestroyWindow.Call(round8Tooltip.hwnd)
			round8Tooltip.hwnd = 0
		}
		v452RemoveSubclass.Call(hwnd, round8TooltipMainCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round8TooltipSetTarget(owner, target uintptr) {
	text := round8TooltipText(target)
	if target == round8Tooltip.target && text == round8Tooltip.text {
		return
	}
	round8TooltipHide(owner)
	round8Tooltip.target = target
	round8Tooltip.text = text
	if text != "" {
		procSetTimer.Call(owner, round8TooltipTimer, round8TooltipDelay, 0)
	}
}

func round8TooltipText(target uintptr) string {
	if app == nil || target == 0 {
		return ""
	}
	text := ""
	switch target {
	case app.hFFStatus:
		text = "FFmpeg 状态｜点击查看或配置组件"
	case app.hGPUStatus:
		text = "硬件编码状态｜点击进行检测"
	case app.hPotStatus:
		text = "PotPlayer 状态｜点击选择播放器"
	case app.hConcurrencyStatus:
		text = "并行任务数量｜点击选择自动或固定数量"
	case app.hAllDefault:
		text = "恢复当前媒体类型的全部转换参数"
	case app.hTrimCrop:
		text = "剪裁视频片段或调整画面选区"
	case app.hRightToggle:
		text = "展开或收起右侧参数面板"
	case app.hPreview:
		text = "使用当前播放器预览所选任务"
	case app.hSingleOutput:
		text = "只输出当前选中的任务"
	case app.hRetry:
		text = "重新处理失败的已选任务"
	}
	if text != "" {
		if enabled, _, _ := round8TooltipIsEnabled.Call(target); enabled == 0 {
			text += "\r\n当前任务状态下暂不可用"
		}
	}
	return text
}

func round8TooltipEnsureWindow(owner uintptr) uintptr {
	if round8Tooltip.hwnd != 0 {
		return round8Tooltip.hwnd
	}
	round8TooltipRegisterClass()
	hInst, _, _ := procGetModuleHandleW.Call(0)
	hwnd, _, _ := procCreateWindowExW.Call(
		round8WSExTopmost|round8WSExNoActivate|WS_EX_TOOLWINDOW,
		uintptr(unsafe.Pointer(p("MediovaRound8Tooltip"))),
		uintptr(unsafe.Pointer(p(""))),
		WS_POPUP,
		0, 0, 10, 10,
		owner, 0, hInst, 0,
	)
	round8Tooltip.hwnd = hwnd
	return hwnd
}

func round8TooltipMeasure(text string) (int32, int32) {
	hdc, _, _ := procGetDC.Call(0)
	if hdc == 0 {
		return scaleDPI(220), scaleDPI(48)
	}
	defer procReleaseDC.Call(0, hdc)
	oldFont, _, _ := procSelectObject.Call(hdc, uiFontSmall)
	rc := rect{Left: 0, Top: 0, Right: scaleDPI(280), Bottom: scaleDPI(240)}
	procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(text))), ^uintptr(0), uintptr(unsafe.Pointer(&rc)), round8DTRCalcRect|round8DTWordBreak|round8DTNoPrefix)
	if oldFont != 0 {
		procSelectObject.Call(hdc, oldFont)
	}
	width := rc.Right - rc.Left + scaleDPI(24)
	height := rc.Bottom - rc.Top + scaleDPI(18)
	if width < scaleDPI(140) {
		width = scaleDPI(140)
	}
	return width, height
}

func round8TooltipShow(owner uintptr) {
	if round8Tooltip.text == "" || round8Tooltip.target == 0 {
		return
	}
	hwnd := round8TooltipEnsureWindow(owner)
	if hwnd == 0 {
		return
	}
	var pt point
	if ok, _, _ := procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt))); ok == 0 {
		return
	}
	width, height := round8TooltipMeasure(round8Tooltip.text)
	x, y := pt.X+scaleDPI(14), pt.Y+scaleDPI(18)
	var work rect
	if ok, _, _ := procSystemParametersInfoW.Call(SPI_GETWORKAREA, 0, uintptr(unsafe.Pointer(&work)), 0); ok != 0 {
		if x+width > work.Right {
			x = work.Right - width
		}
		if y+height > work.Bottom {
			y = pt.Y - height - scaleDPI(10)
		}
		if x < work.Left {
			x = work.Left
		}
		if y < work.Top {
			y = work.Top
		}
	}
	round7FeedbackSetWindowPos.Call(hwnd, ^uintptr(0), uintptr(x), uintptr(y), uintptr(width), uintptr(height), round7FeedbackSWPNoActivate|round8SWPShowWindow)
	procInvalidateRect.Call(hwnd, 0, 0)
}

func round8TooltipHide(owner uintptr) {
	if owner != 0 {
		procKillTimer.Call(owner, round8TooltipTimer)
	}
	if round8Tooltip.hwnd != 0 {
		round7FeedbackSetWindowPos.Call(round8Tooltip.hwnd, 0, 0, 0, 0, 0, round7FeedbackSWPNoMove|round7FeedbackSWPNoSize|round7FeedbackSWPNoZOrder|round7FeedbackSWPNoActivate|round8SWPHideWindow)
		procShowWindow.Call(round8Tooltip.hwnd, SW_HIDE)
	}
}

func round8TooltipWndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	switch message {
	case WM_PAINT:
		var ps paintStruct
		hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		if hdc != 0 {
			var rc rect
			procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
			withRoundedClip(hdc, rc, 6, func() { fillSolid(hdc, rc, colorRef(250, 251, 253)) })
			drawRoundedBorder(hdc, rc, 6, colorRef(198, 207, 218))
			textRC := rc
			textRC.Left += scaleDPI(12)
			textRC.Top += scaleDPI(8)
			textRC.Right -= scaleDPI(12)
			textRC.Bottom -= scaleDPI(8)
			oldFont, _, _ := procSelectObject.Call(hdc, uiFontSmall)
			procSetBkMode.Call(hdc, TRANSPARENT)
			procSetTextColor.Call(hdc, colorRef(48, 59, 73))
			procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(round8Tooltip.text))), ^uintptr(0), uintptr(unsafe.Pointer(&textRC)), DT_LEFT|DT_VCENTER|round8DTWordBreak|round8DTNoPrefix)
			if oldFont != 0 {
				procSelectObject.Call(hdc, oldFont)
			}
			procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		}
		return 0
	case WM_ERASEBKGND:
		return 1
	case round8WMNCHitTest:
		return round8HTTransparent
	}
	result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

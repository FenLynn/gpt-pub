//go:build windows

package main

import (
	"fmt"
	"syscall"
	"time"
	"unsafe"

	"mediaworkbench/internal/config"
)

const (
	IDC_FLOAT_CLOSE    = 4001
	IDC_TOAST_CLOSE    = 4011
	IDC_IMPORT_CLOSE   = 4021
	TIMER_MAIN_CLOCK   = 1
	TIMER_TOAST_CLOSE  = 2
	TIMER_TRAY_RETRY   = 3
	TIMER_IMPORT_CLOSE = 4
)

var (
	floatingClassName = p("MediovaFloating400")
	toastClassName    = p("MediovaToast400")
)

func registerAuxWindowClasses(hInst uintptr, hIcon uintptr) bool {
	cursor, _, _ := procLoadCursorW.Call(0, 32512)
	classes := []wndClassEx{
		{CbSize: uint32(unsafe.Sizeof(wndClassEx{})), LpfnWndProc: syscall.NewCallback(floatingWndProc), HInstance: hInst, HIcon: hIcon, HIconSm: hIcon, HCursor: cursor, HbrBackground: COLOR_WINDOW + 1, LpszClassName: floatingClassName},
		{CbSize: uint32(unsafe.Sizeof(wndClassEx{})), LpfnWndProc: syscall.NewCallback(toastWndProc), HInstance: hInst, HIcon: hIcon, HIconSm: hIcon, HCursor: cursor, HbrBackground: COLOR_WINDOW + 1, LpszClassName: toastClassName},
	}
	for i := range classes {
		if r, _, _ := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&classes[i]))); r == 0 {
			return false
		}
	}
	return true
}

//go:nocheckptr
func floatingWndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	switch message {
	case WM_CREATE:
		if app != nil {
			app.hFloating = hwnd
			app.hFloatingText = createControl("STATIC", "等待任务", WS_CHILD|WS_VISIBLE|SS_LEFT, 12, 8, 420, 42, hwnd, 0)
			app.hFloatingProgress = createControl("msctls_progress32", "", WS_CHILD|WS_VISIBLE, 12, 58, 422, 18, hwnd, 0)
			send(app.hFloatingProgress, PBM_SETRANGE32, 0, 1000)
			app.hFloatingClose = createControl("BUTTON", "×", WS_CHILD|WS_VISIBLE, 438, 7, 24, 24, hwnd, IDC_FLOAT_CLOSE)
		}
		return 0
	case WM_COMMAND:
		if int(loWord(wParam)) == IDC_FLOAT_CLOSE && app != nil {
			app.settings.ShowFloatingBar = false
			_ = config.Save(app.settings)
			app.syncMenuChecks()
			show(hwnd, false)
			return 0
		}
	case WM_CLOSE:
		if app != nil {
			app.settings.ShowFloatingBar = false
			_ = config.Save(app.settings)
			app.syncMenuChecks()
		}
		show(hwnd, false)
		return 0
	case WM_LBUTTONUP:
		if app != nil && app.hwnd != 0 {
			show(app.hwnd, true)
			procShowWindow.Call(app.hwnd, SW_RESTORE)
			procSetForegroundWindow.Call(app.hwnd)
		}
		return 0
	case WM_NCHITTEST:
		return HTCAPTION
	case WM_DESTROY:
		if app != nil {
			app.hFloating = 0
			app.hFloatingProgress = 0
			app.hFloatingText = 0
			app.hFloatingClose = 0
		}
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return r
}

//go:nocheckptr
func toastWndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	switch message {
	case WM_CREATE:
		if app != nil {
			app.hToast = hwnd
			app.hToastTitle = createControl("STATIC", "本次任务已完成", WS_CHILD|WS_VISIBLE|SS_LEFT, 14, 12, 350, 24, hwnd, 0)
			app.hToastText = createControl("STATIC", "", WS_CHILD|WS_VISIBLE|SS_LEFT, 14, 40, 390, 62, hwnd, 0)
			app.hToastClose = createControl("BUTTON", "×", WS_CHILD|WS_VISIBLE, 398, 8, 25, 25, hwnd, IDC_TOAST_CLOSE)
		}
		return 0
	case WM_COMMAND:
		if int(loWord(wParam)) == IDC_TOAST_CLOSE {
			procDestroyWindow.Call(hwnd)
			return 0
		}
	case WM_TIMER:
		if wParam == TIMER_TOAST_CLOSE {
			procKillTimer.Call(hwnd, TIMER_TOAST_CLOSE)
			procDestroyWindow.Call(hwnd)
			return 0
		}
	case WM_CLOSE:
		procDestroyWindow.Call(hwnd)
		return 0
	case WM_NCHITTEST:
		return HTCAPTION
	case WM_DESTROY:
		procKillTimer.Call(hwnd, TIMER_TOAST_CLOSE)
		if app != nil {
			app.hToast = 0
			app.hToastTitle = 0
			app.hToastText = 0
			app.hToastClose = 0
		}
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return r
}

func workArea() rect {
	var rc rect
	if r, _, _ := procSystemParametersInfoW.Call(SPI_GETWORKAREA, 0, uintptr(unsafe.Pointer(&rc)), 0); r == 0 {
		rc = rect{Left: 0, Top: 0, Right: 1920, Bottom: 1080}
	}
	return rc
}

func (a *application) ensureFloatingBar() {
	if a == nil || a.hFloating != 0 {
		return
	}
	hInst, _, _ := procGetModuleHandleW.Call(0)
	rc := workArea()
	const w, h = int32(474), int32(88)
	x, y := rc.Right-w-14, rc.Bottom-h-14
	hwnd, _, _ := procCreateWindowExW.Call(WS_EX_TOOLWINDOW|WS_EX_TOPMOST|WS_EX_NOACTIVATE, uintptr(unsafe.Pointer(floatingClassName)), uintptr(unsafe.Pointer(p("Mediova进度"))), WS_POPUP|WS_BORDER|WS_CLIPCHILDREN, uintptr(x), uintptr(y), uintptr(w), uintptr(h), 0, 0, hInst, 0)
	if hwnd != 0 {
		a.hFloating = hwnd
		procSetWindowPos.Call(hwnd, HWND_TOPMOST, uintptr(x), uintptr(y), uintptr(w), uintptr(h), SWP_NOACTIVATE)
	}
}

func (a *application) updateFloatingBar(pct float64, text string, visible bool) {
	if a == nil {
		return
	}
	if !a.settings.ShowFloatingBar || !visible {
		if a.hFloating != 0 {
			show(a.hFloating, false)
		}
		return
	}
	a.ensureFloatingBar()
	if a.hFloating == 0 {
		return
	}
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	setText(a.hFloatingText, text)
	send(a.hFloatingProgress, PBM_SETPOS, uintptr(int(pct*10)), 0)
	rc := workArea()
	const w, h = int32(474), int32(88)
	x, y := rc.Right-w-14, rc.Bottom-h-14
	procSetWindowPos.Call(a.hFloating, HWND_TOPMOST, uintptr(x), uintptr(y), uintptr(w), uintptr(h), SWP_NOACTIVATE)
	procShowWindow.Call(a.hFloating, SW_SHOWNOACTIVATE)
}

func (a *application) showCompletionToast(title, body string) {
	if a == nil || !a.settings.NotifyOnDone {
		return
	}
	if a.hToast != 0 {
		procDestroyWindow.Call(a.hToast)
	}
	hInst, _, _ := procGetModuleHandleW.Call(0)
	rc := workArea()
	const w, h = int32(438), int32(116)
	x := rc.Right - w - 14
	y := rc.Bottom - h - 14
	if a.hFloating != 0 {
		if r, _, _ := procIsWindowVisible.Call(a.hFloating); r != 0 {
			y -= 78
		}
	}
	hwnd, _, _ := procCreateWindowExW.Call(WS_EX_TOOLWINDOW|WS_EX_TOPMOST|WS_EX_NOACTIVATE, uintptr(unsafe.Pointer(toastClassName)), uintptr(unsafe.Pointer(p(title))), WS_POPUP|WS_BORDER|WS_CLIPCHILDREN, uintptr(x), uintptr(y), uintptr(w), uintptr(h), 0, 0, hInst, 0)
	if hwnd == 0 {
		return
	}
	a.hToast = hwnd
	setText(a.hToastTitle, title)
	setText(a.hToastText, body)
	procSetWindowPos.Call(hwnd, HWND_TOPMOST, uintptr(x), uintptr(y), uintptr(w), uintptr(h), SWP_NOACTIVATE)
	procShowWindow.Call(hwnd, SW_SHOWNOACTIVATE)
	seconds := a.settings.CompletionToastSeconds
	if seconds < 5 {
		seconds = 30
	}
	procSetTimer.Call(hwnd, TIMER_TOAST_CLOSE, uintptr(seconds*1000), 0)
}

func floatingProgressText(pct float64, completed, total int, elapsed, remaining time.Duration, speedLabel string, active int, engine string, paused bool) string {
	line1 := fmt.Sprintf("总进度 %d/%d · %.1f%%   已用 %s", completed, total, pct, formatDuration(elapsed))
	if remaining > 0 {
		line1 += "   剩余 " + formatDuration(remaining)
	}
	line2 := fmt.Sprintf("处理速度 %s   运行 %d", speedLabel, active)
	if engine != "" {
		line2 += "   " + engine
	}
	if paused {
		line2 += "   已暂停"
	}
	return line1 + "\r\n" + line2
}

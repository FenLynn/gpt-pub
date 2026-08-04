//go:build windows

package main

import (
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const (
	v452WMSetText                  = 0x000C
	v452ImportFeedbackDebounce    = 80 * time.Millisecond
	v452ImportToastAnimationTime  = 180 * time.Millisecond
	v452ImportToastVisibleTime    = 5 * time.Second
	v452ImportFeedbackTimer       = 0x4531
	v452ImportToastAnimationTimer = 0x4532
	v452ImportToastCloseTimer     = 0x4533
	v452WSExLayered               = 0x00080000
	v452LWAAlpha                  = 0x00000002
	v452ImportToastSubclassID     = 0x4523
	v452StatusSubclassID          = 0x4524
)

type v452ImportFeedbackState struct {
	app     *application
	pending string
}

type v452ImportToastState struct {
	app               *application
	text, close       uintptr
	targetX, targetY   int32
	shownAt, closingAt time.Time
	closing           bool
}

var (
	v452ImportFeedbackStates sync.Map // map[uintptr]*v452ImportFeedbackState
	v452ImportToastStates    sync.Map // map[uintptr]*v452ImportToastState
	v452ImportFeedbackCB     uintptr
	v452ImportToastCB        uintptr
	v452ImportToastWindow    uintptr
	v452SetLayeredAttributes = user32.NewProc("SetLayeredWindowAttributes")
)

func init() {
	v452ImportFeedbackCB = syscall.NewCallback(v452ImportFeedbackSubclassProc)
	v452ImportToastCB = syscall.NewCallback(v452ImportToastSubclassProc)
}

func v452InstallImportFeedback(a *application) {
	if a == nil || a.hStatusText == 0 {
		return
	}
	state := &v452ImportFeedbackState{app: a}
	v452ImportFeedbackStates.Store(a.hStatusText, state)
	v452SetWindowSubclass.Call(a.hStatusText, v452ImportFeedbackCB, v452StatusSubclassID, 0)
}

func v452ImportFeedbackSubclassProc(hwnd uintptr, msg uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if msg == WM_TIMER && wParam == v452ImportFeedbackTimer {
		procKillTimer.Call(hwnd, v452ImportFeedbackTimer)
		if value, ok := v452ImportFeedbackStates.Load(hwnd); ok {
			state := value.(*v452ImportFeedbackState)
			text := state.pending
			state.pending = ""
			if text != "" && state.app != nil && !state.app.selfTest {
				v452ShowImportFeedbackToast(state.app, text)
			}
		}
		return 0
	}
	if msg == v452WMNCDestroy {
		procKillTimer.Call(hwnd, v452ImportFeedbackTimer)
		v452RemoveSubclass.Call(hwnd, v452ImportFeedbackCB, subclassID)
		v452ImportFeedbackStates.Delete(hwnd)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(msg), wParam, lParam)
	if msg == v452WMSetText && lParam != 0 {
		text := utf16PtrString((*uint16)(unsafe.Pointer(lParam)))
		if normalized, ok := v452ImportFeedbackText(text); ok {
			if value, exists := v452ImportFeedbackStates.Load(hwnd); exists {
				state := value.(*v452ImportFeedbackState)
				state.pending = normalized
				procKillTimer.Call(hwnd, v452ImportFeedbackTimer)
				procSetTimer.Call(hwnd, v452ImportFeedbackTimer, uintptr(v452ImportFeedbackDebounce/time.Millisecond), 0)
			}
		}
	}
	return result
}

func v452ShowImportFeedbackToast(a *application, text string) {
	if a == nil || a.hwnd == 0 || text == "" {
		return
	}
	if v452ImportToastWindow != 0 {
		procDestroyWindow.Call(v452ImportToastWindow)
		v452ImportToastWindow = 0
	}
	hInst, _, _ := procGetModuleHandleW.Call(0)
	rc := workArea()
	const width, height = int32(432), int32(88)
	x := rc.Right - width - 14
	y := rc.Bottom - height - 14
	if a.hFloating != 0 {
		if visible, _, _ := procIsWindowVisible.Call(a.hFloating); visible != 0 {
			y -= 100
		}
	}
	if a.hToast != 0 {
		if visible, _, _ := procIsWindowVisible.Call(a.hToast); visible != 0 {
			y -= 126
		}
	}
	hwnd, _, _ := procCreateWindowExW.Call(
		uintptr(WS_EX_TOOLWINDOW|WS_EX_TOPMOST|WS_EX_NOACTIVATE|v452WSExLayered),
		uintptr(unsafe.Pointer(p("STATIC"))),
		uintptr(unsafe.Pointer(p(""))),
		uintptr(WS_POPUP|WS_BORDER|WS_CLIPCHILDREN|SS_NOTIFY),
		uintptr(x), uintptr(y+16), uintptr(width), uintptr(height),
		a.hwnd, 0, hInst, 0,
	)
	if hwnd == 0 {
		return
	}
	textHwnd := createControl("STATIC", text, WS_CHILD|WS_VISIBLE|SS_LEFT, 16, 13, 370, 58, hwnd, 0)
	closeHwnd := createControl("BUTTON", "×", WS_CHILD|WS_VISIBLE, 397, 8, 25, 25, hwnd, IDC_IMPORT_CLOSE)
	send(textHwnd, WM_SETFONT, uiFont, 1)
	send(closeHwnd, WM_SETFONT, uiFont, 1)
	state := &v452ImportToastState{
		app:     a,
		text:    textHwnd,
		close:   closeHwnd,
		targetX: x,
		targetY: y,
		shownAt: time.Now(),
	}
	v452ImportToastStates.Store(hwnd, state)
	v452SetWindowSubclass.Call(hwnd, v452ImportToastCB, v452ImportToastSubclassID, 0)
	v452ImportToastWindow = hwnd
	v452SetLayeredAttributes.Call(hwnd, 0, 0, v452LWAAlpha)
	procSetWindowPos.Call(hwnd, HWND_TOPMOST, uintptr(x), uintptr(y+16), uintptr(width), uintptr(height), SWP_NOACTIVATE)
	procShowWindow.Call(hwnd, SW_SHOWNOACTIVATE)
	procSetTimer.Call(hwnd, v452ImportToastAnimationTimer, 15, 0)
	procSetTimer.Call(hwnd, v452ImportToastCloseTimer, uintptr(v452ImportToastVisibleTime/time.Millisecond), 0)
}

func v452BeginImportToastClose(hwnd uintptr) {
	value, ok := v452ImportToastStates.Load(hwnd)
	if !ok {
		return
	}
	state := value.(*v452ImportToastState)
	if state.closing {
		return
	}
	state.closing = true
	state.closingAt = time.Now()
	procKillTimer.Call(hwnd, v452ImportToastCloseTimer)
	procSetTimer.Call(hwnd, v452ImportToastAnimationTimer, 15, 0)
}

func v452UpdateImportToastFrame(hwnd uintptr) {
	value, ok := v452ImportToastStates.Load(hwnd)
	if !ok {
		return
	}
	state := value.(*v452ImportToastState)
	elapsed := time.Since(state.shownAt)
	if state.closing {
		elapsed = time.Since(state.closingAt)
	}
	frame := v452ImportToastFrameAt(elapsed, v452ImportToastAnimationTime, state.closing)
	y := state.targetY + frame.OffsetY
	v452SetLayeredAttributes.Call(hwnd, 0, uintptr(frame.Alpha), v452LWAAlpha)
	procSetWindowPos.Call(hwnd, HWND_TOPMOST, uintptr(state.targetX), uintptr(y), 432, 88, SWP_NOACTIVATE)
	if !frame.Done {
		return
	}
	procKillTimer.Call(hwnd, v452ImportToastAnimationTimer)
	if state.closing {
		procDestroyWindow.Call(hwnd)
	}
}

func v452ImportToastSubclassProc(hwnd uintptr, msg uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch msg {
	case WM_COMMAND:
		if int(loWord(wParam)) == IDC_IMPORT_CLOSE {
			v452BeginImportToastClose(hwnd)
			return 0
		}
	case WM_TIMER:
		switch wParam {
		case v452ImportToastAnimationTimer:
			v452UpdateImportToastFrame(hwnd)
			return 0
		case v452ImportToastCloseTimer:
			v452BeginImportToastClose(hwnd)
			return 0
		}
	case WM_CLOSE:
		v452BeginImportToastClose(hwnd)
		return 0
	case WM_NCHITTEST:
		return HTCAPTION
	case v452WMNCDestroy:
		procKillTimer.Call(hwnd, v452ImportToastAnimationTimer)
		procKillTimer.Call(hwnd, v452ImportToastCloseTimer)
		v452RemoveSubclass.Call(hwnd, v452ImportToastCB, subclassID)
		v452ImportToastStates.Delete(hwnd)
		if v452ImportToastWindow == hwnd {
			v452ImportToastWindow = 0
		}
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(msg), wParam, lParam)
	return result
}

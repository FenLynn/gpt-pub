//go:build windows

package main

import (
	"sync"
	"syscall"
	"unsafe"
)

const (
	v452SBBoth        = 3
	v452ListFadeTimer = 0x4522
	v452FadeDelayMS   = 1500
	v452WMMouseWheel  = 0x020A
	v452WMVScroll     = 0x0115
	v452WMNCDestroy   = 0x0082
)

var (
	v452SetWindowSubclass = comctl32.NewProc("SetWindowSubclass")
	v452DefSubclassProc   = comctl32.NewProc("DefSubclassProc")
	v452RemoveSubclass    = comctl32.NewProc("RemoveWindowSubclass")
	v452ShowScrollBar     = user32.NewProc("ShowScrollBar")
	v452SetWindowTheme    = syscall.NewLazyDLL("uxtheme.dll").NewProc("SetWindowTheme")
	v452ListApps          sync.Map // map[uintptr]*application
	v452ListSubclassCB    = syscall.NewCallback(v452ListSubclassProc)
)

func v452InstallListVisuals(a *application) {
	if a == nil || a.hList == 0 {
		return
	}
	v452ListApps.Store(a.hList, a)
	v452SetWindowSubclass.Call(a.hList, v452ListSubclassCB, 1, 0)
	v452ShowScrollBar.Call(a.hList, v452SBBoth, 0)
	for _, hwnd := range []uintptr{
		a.hOutputEdit,
		a.hResolution, a.hCodec, a.hQuality, a.hSpeedMode, a.hVolume, a.hRotation,
		a.hTaskRes, a.hTaskCodec, a.hTaskQuality, a.hTaskVolume, a.hTaskRotation,
		a.hFilter,
	} {
		if hwnd != 0 {
			v452SetWindowTheme.Call(hwnd, uintptr(unsafe.Pointer(p("Explorer"))), 0)
			procInvalidateRect.Call(hwnd, 0, 1)
		}
	}
	if a.hHeaderLine != 0 {
		procSetWindowPos.Call(a.hHeaderLine, 0, 0, 0, 0, 0, SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE)
		procInvalidateRect.Call(a.hHeaderLine, 0, 1)
	}
}

func v452RevealListScrollbars(hwnd uintptr) {
	v452ShowScrollBar.Call(hwnd, v452SBBoth, 1)
	procSetTimer.Call(hwnd, v452ListFadeTimer, v452FadeDelayMS, 0)
}

func v452ListSubclassProc(hwnd uintptr, msg uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch msg {
	case WM_MOUSEMOVE, v452WMMouseWheel, WM_HSCROLL, v452WMVScroll:
		v452RevealListScrollbars(hwnd)
	case WM_TIMER:
		if wParam == v452ListFadeTimer {
			procKillTimer.Call(hwnd, v452ListFadeTimer)
			v452ShowScrollBar.Call(hwnd, v452SBBoth, 0)
			return 0
		}
	case v452WMNCDestroy:
		procKillTimer.Call(hwnd, v452ListFadeTimer)
		v452RemoveSubclass.Call(hwnd, v452ListSubclassCB, subclassID)
		v452ListApps.Delete(hwnd)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(msg), wParam, lParam)
	return result
}

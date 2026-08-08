//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

const (
	v452SBBoth        = 3
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
)

func v452InstallListVisuals(a *application) {
	if a == nil || a.hList == 0 {
		return
	}
	// Hide the native lanes once during initialization. Older builds installed
	// a ListView subclass that revealed both native scrollbars on every mouse
	// move and hid them again 1.5 seconds later. That timer fought the round-11
	// delayed custom surfaces and was the direct cause of continuous flashing.
	// No runtime mouse/timer path may call ShowScrollBar after this point.
	v452ShowScrollBar.Call(a.hList, v452SBBoth, 0)
	v452InstallImportFeedback(a)
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

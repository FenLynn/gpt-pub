//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

const (
	v452WMMouseWheel = 0x020A
	v452WMVScroll    = 0x0115
	v452WMNCDestroy  = 0x0082
)

var (
	v452SetWindowSubclass = comctl32.NewProc("SetWindowSubclass")
	v452DefSubclassProc   = comctl32.NewProc("DefSubclassProc")
	v452RemoveSubclass    = comctl32.NewProc("RemoveWindowSubclass")
	v452SetWindowTheme    = syscall.NewLazyDLL("uxtheme.dll").NewProc("SetWindowTheme")
)

func v452InstallListVisuals(a *application) {
	if a == nil || a.hList == 0 {
		return
	}
	// The ListView keeps its native scrollbars. Round12 previously hid them here
	// and rebuilt the thumb with sibling windows, which made scrolling depend on
	// synchronous repaint and z-order repair. Native non-client scrolling now
	// remains authoritative from control creation onward.
	// v452InstallImportFeedback(a) was the legacy path that mirrored ordinary
	// footer messages into desktop popups. Round12 keeps those messages in the
	// centred footer bar; only explicit completion notices may float.
	round12InstallFooterMessageFeedback(a)
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

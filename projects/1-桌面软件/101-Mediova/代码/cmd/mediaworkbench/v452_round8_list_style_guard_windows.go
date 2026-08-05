//go:build windows

package main

import (
	"sync/atomic"
	"syscall"
	"unsafe"
)

const (
	round8ListStyleGuardSubclassID = 0x4590
	round8WMStyleChanging          = 0x007C
)

type round8StyleStruct struct {
	StyleOld uint32
	StyleNew uint32
}

var (
	round8ListStyleGuardEventCB   uintptr
	round8ListStyleGuardCB        uintptr
	round8ListStyleGuardHook      uintptr
	round8ListStyleGuardInstalled atomic.Bool
)

func init() {
	round8ListStyleGuardEventCB = syscall.NewCallback(round8ListStyleGuardEventProc)
	round8ListStyleGuardCB = syscall.NewCallback(round8ListStyleGuardSubclassProc)
	round8ListStyleGuardHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		round8ListStyleGuardEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func round8ListStyleGuardEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	if round8ListStyleGuardInstalled.Load() || app == nil || app.hList == 0 || !app.controlsReady {
		return 0
	}
	if ok, _, _ := v452SetWindowSubclass.Call(app.hList, round8ListStyleGuardCB, round8ListStyleGuardSubclassID, 0); ok == 0 {
		return 0
	}
	round7FeedbackStripListChrome(app)
	round8ListStyleGuardInstalled.Store(true)
	if round8ListStyleGuardHook != 0 {
		round7FeedbackUnhookWinEvent.Call(round8ListStyleGuardHook)
		round8ListStyleGuardHook = 0
	}
	return 0
}

func round8ListStyleGuardSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == round8WMStyleChanging && lParam != 0 {
		styles := (*round8StyleStruct)(unsafe.Pointer(lParam))
		switch wParam {
		case round7FeedbackGWLStyle:
			styles.StyleNew &^= uint32(round7FeedbackWSHScroll | round7FeedbackWSVScroll | round7FeedbackWSBorder)
		case round7FeedbackGWLExStyle:
			styles.StyleNew &^= uint32(round7FeedbackWSExClientEdge)
		}
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, round8ListStyleGuardCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

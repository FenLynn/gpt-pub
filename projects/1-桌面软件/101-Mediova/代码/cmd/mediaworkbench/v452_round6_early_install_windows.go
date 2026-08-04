//go:build windows

package main

import (
	"sync"
	"sync/atomic"
	"syscall"
)

const v452Round6EarlyParentSubclassID = 0x4565

var (
	v452Round6EarlyEventCB uintptr
	v452Round6EarlyCBTCB   uintptr
	v452Round6EarlyParentCB uintptr
	v452Round6EarlyEventHook uintptr
	v452Round6EarlyCBTHook atomic.Uintptr
	v452Round6EarlyParents sync.Map
)

func init() {
	v452Round6EarlyEventCB = syscall.NewCallback(v452Round6EarlyEventProc)
	v452Round6EarlyCBTCB = syscall.NewCallback(v452Round6EarlyCBTProc)
	v452Round6EarlyParentCB = syscall.NewCallback(v452Round6EarlyParentSubclassProc)
	v452Round6EarlyEventHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		v452Round6EarlyEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func v452Round6EarlyEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	v452Round6EnsureEarlyCBTHook()
	if d := activeTrim; d != nil && d.hwnd != 0 {
		v452Round6InstallTrimDialog(d)
		v452Round6InstallTimelineInput(d)
	}
	return 0
}

func v452Round6EnsureEarlyCBTHook() {
	if v452Round6EarlyCBTHook.Load() != 0 || app == nil || app.hwnd == 0 {
		return
	}
	threadID, _, _ := v452CropSyncGetThreadID.Call()
	if threadID == 0 {
		return
	}
	hook, _, _ := v452CropSyncSetHook.Call(v452WHCBT, v452Round6EarlyCBTCB, 0, threadID)
	if hook == 0 {
		return
	}
	if !v452Round6EarlyCBTHook.CompareAndSwap(0, hook) {
		v452CropSyncUnhook.Call(hook)
	}
}

func v452Round6EarlyCBTProc(code int32, wParam, lParam uintptr) uintptr {
	if code == v452HCBTCreateWnd {
		if d := activeTrim; d != nil && d.hwnd == 0 && wParam != 0 {
			if _, loaded := v452Round6EarlyParents.LoadOrStore(wParam, true); !loaded {
				if ok, _, _ := v452SetWindowSubclass.Call(wParam, v452Round6EarlyParentCB, v452Round6EarlyParentSubclassID, 0); ok == 0 {
					v452Round6EarlyParents.Delete(wParam)
				}
			}
		}
	}
	if code == v452HCBTActivate {
		if d := activeTrim; d != nil && d.hwnd != 0 && d.hwnd == wParam {
			v452Round6InstallTrimDialog(d)
			v452Round6InstallTimelineInput(d)
		}
	}
	result, _, _ := v452CropSyncNextHook.Call(v452Round6EarlyCBTHook.Load(), uintptr(code), wParam, lParam)
	return result
}

func v452Round6EarlyParentSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == WM_CREATE {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if d := activeTrim; d != nil && d.hwnd == hwnd {
			v452Round6InstallTrimDialog(d)
			v452Round6InstallTimelineInput(d)
		}
		return result
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, v452Round6EarlyParentCB, subclassID)
		v452Round6EarlyParents.Delete(hwnd)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

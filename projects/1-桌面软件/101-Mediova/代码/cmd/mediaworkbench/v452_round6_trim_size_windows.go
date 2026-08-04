//go:build windows

package main

import (
	"sync"
	"syscall"
	"unsafe"
)

const (
	v452Round6TrimSizeSubclassID = 0x4569
	v452Round6WMGetMinMaxInfo    = 0x0024
	v452Round6SWPNoSize          = 0x0001
	v452Round6SWPNoMove          = 0x0002
	v452Round6SWPNoZOrder        = 0x0004
	v452Round6SWPNoActivate      = 0x0010
	v452Round6TrimOuterMinWidth  = 1240
	v452Round6TrimOuterMinHeight = 800
)

type v452Round6MinMaxInfo struct {
	Reserved     point
	MaxSize      point
	MaxPosition  point
	MinTrackSize point
	MaxTrackSize point
}

var (
	v452Round6TrimSizeEventCB uintptr
	v452Round6TrimSizeCB      uintptr
	v452Round6TrimSizeHook    uintptr
	v452Round6TrimSizeWindows sync.Map
	v452Round6TrimSizeBusy    sync.Map
	v452Round6TrimGetRect     = user32.NewProc("GetWindowRect")
	v452Round6TrimSetPos      = user32.NewProc("SetWindowPos")
)

func init() {
	v452Round6TrimSizeEventCB = syscall.NewCallback(v452Round6TrimSizeEventProc)
	v452Round6TrimSizeCB = syscall.NewCallback(v452Round6TrimSizeSubclassProc)
	v452Round6TrimSizeHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		v452Round6TrimSizeEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func v452Round6TrimSizeEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	d := activeTrim
	if d == nil || d.hwnd == 0 {
		return 0
	}
	v452Round6InstallTrimSize(d.hwnd)
	return 0
}

func v452Round6InstallTrimSize(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	if _, loaded := v452Round6TrimSizeWindows.LoadOrStore(hwnd, true); !loaded {
		if ok, _, _ := v452SetWindowSubclass.Call(hwnd, v452Round6TrimSizeCB, v452Round6TrimSizeSubclassID, 0); ok == 0 {
			v452Round6TrimSizeWindows.Delete(hwnd)
			return
		}
	}
	v452Round6EnsureTrimSize(hwnd)
}

func v452Round6EnsureTrimSize(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	if _, loaded := v452Round6TrimSizeBusy.LoadOrStore(hwnd, true); loaded {
		return
	}
	defer v452Round6TrimSizeBusy.Delete(hwnd)

	var bounds rect
	ok, _, _ := v452Round6TrimGetRect.Call(hwnd, uintptr(unsafe.Pointer(&bounds)))
	if ok == 0 {
		return
	}
	width := bounds.Right - bounds.Left
	height := bounds.Bottom - bounds.Top
	newWidth := width
	newHeight := height
	if newWidth < v452Round6TrimOuterMinWidth {
		newWidth = v452Round6TrimOuterMinWidth
	}
	if newHeight < v452Round6TrimOuterMinHeight {
		newHeight = v452Round6TrimOuterMinHeight
	}
	if newWidth == width && newHeight == height {
		return
	}
	v452Round6TrimSetPos.Call(
		hwnd,
		0,
		0,
		0,
		uintptr(newWidth),
		uintptr(newHeight),
		v452Round6SWPNoMove|v452Round6SWPNoZOrder|v452Round6SWPNoActivate,
	)
}

func v452Round6TrimSizeSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case v452Round6WMGetMinMaxInfo:
		if lParam != 0 {
			info := (*v452Round6MinMaxInfo)(unsafe.Pointer(lParam))
			if info.MinTrackSize.X < v452Round6TrimOuterMinWidth {
				info.MinTrackSize.X = v452Round6TrimOuterMinWidth
			}
			if info.MinTrackSize.Y < v452Round6TrimOuterMinHeight {
				info.MinTrackSize.Y = v452Round6TrimOuterMinHeight
			}
		}
	case WM_SIZE:
		v452Round6EnsureTrimSize(hwnd)
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, v452Round6TrimSizeCB, subclassID)
		v452Round6TrimSizeWindows.Delete(hwnd)
		v452Round6TrimSizeBusy.Delete(hwnd)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

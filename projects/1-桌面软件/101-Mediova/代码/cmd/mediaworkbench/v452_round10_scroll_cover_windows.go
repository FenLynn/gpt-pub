//go:build windows

package main

import (
	"sync/atomic"
	"syscall"
	"unsafe"
)

const (
	round10CoverMainSubclassID = 0x45A1
	round10CoverListSubclassID = 0x45A2
	round10WMInstallCover      = WM_APP + 0x5A1
)

var (
	round10CoverEventCB   uintptr
	round10CoverMainCB    uintptr
	round10CoverListCB    uintptr
	round10CoverHook      uintptr
	round10CoverInstalled atomic.Bool
)

func init() {
	round10CoverEventCB = syscall.NewCallback(round10CoverEventProc)
	round10CoverMainCB = syscall.NewCallback(round10CoverMainSubclassProc)
	round10CoverListCB = syscall.NewCallback(round10CoverListSubclassProc)
	round10CoverHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		round10CoverEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func round10CoverEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	a := app
	if a == nil || a.hwnd == 0 || a.hList == 0 || !a.controlsReady {
		return 0
	}
	if !round10CoverInstalled.CompareAndSwap(false, true) {
		return 0
	}
	mainOK, _, _ := v452SetWindowSubclass.Call(a.hwnd, round10CoverMainCB, round10CoverMainSubclassID, 0)
	listOK, _, _ := v452SetWindowSubclass.Call(a.hList, round10CoverListCB, round10CoverListSubclassID, 0)
	if mainOK == 0 || listOK == 0 {
		if mainOK != 0 {
			v452RemoveSubclass.Call(a.hwnd, round10CoverMainCB, round10CoverMainSubclassID)
		}
		if listOK != 0 {
			v452RemoveSubclass.Call(a.hList, round10CoverListCB, round10CoverListSubclassID)
		}
		round10CoverInstalled.Store(false)
		return 0
	}
	procPostMessageW.Call(a.hwnd, round10WMInstallCover, 0, 0)
	if round10CoverHook != 0 {
		round7FeedbackUnhookWinEvent.Call(round10CoverHook)
		round10CoverHook = 0
	}
	return 0
}

func round10CoverMainSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case round10WMInstallCover:
		round10CoverNativeScrollAreas(app)
		return 0
	case WM_SIZE, WM_APP_REFRESH:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round10CoverNativeScrollAreas(app)
		return result
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round10CoverMainCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round10CoverListSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	switch message {
	case WM_PAINT, WM_SIZE, WM_HSCROLL, round7FeedbackWMVScroll, round7FeedbackWMMouseWheel, round9FeedbackWMWindowPosChanged:
		round10CoverNativeScrollAreas(app)
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round10CoverListCB, subclassID)
	}
	return result
}

func round10CoverNativeScrollAreas(a *application) {
	if a == nil || a.hwnd == 0 || a.hList == 0 {
		return
	}
	round9EnsureScrollOverlays(a)

	var wr rect
	if ok, _, _ := procGetWindowRect.Call(a.hList, uintptr(unsafe.Pointer(&wr))); ok == 0 {
		return
	}
	topLeft := point{X: wr.Left, Y: wr.Top}
	bottomRight := point{X: wr.Right, Y: wr.Bottom}
	round9FeedbackScreenToClient.Call(a.hwnd, uintptr(unsafe.Pointer(&topLeft)))
	round9FeedbackScreenToClient.Call(a.hwnd, uintptr(unsafe.Pointer(&bottomRight)))
	width := bottomRight.X - topLeft.X
	height := bottomRight.Y - topLeft.Y
	if width <= 0 || height <= 0 {
		return
	}

	thickness := scaleDPI(17)
	if thickness < 14 {
		thickness = 14
	}
	round9ScrollMu.Lock()
	horizontal := round9ScrollH
	vertical := round9ScrollV
	round9ScrollMu.Unlock()

	round9PositionOverlay(horizontal, topLeft.X+1, bottomRight.Y-thickness, width-1, thickness, true)
	verticalHeight := height - thickness - 1
	if verticalHeight < 1 {
		verticalHeight = 1
	}
	round9PositionOverlay(vertical, bottomRight.X-thickness, topLeft.Y+1, thickness, verticalHeight, true)
}

//go:build windows

package main

import (
	"syscall"
	"time"
	"unsafe"
)

const round12HeaderTopSubclassID = 0x45C5

var round12HeaderTopCallback uintptr

func init() {
	round12HeaderTopCallback = syscall.NewCallback(round12HeaderTopSubclassProc)
	go func() {
		for attempt := 0; attempt < 800; attempt++ {
			a := app
			if a != nil && a.hwnd != 0 && a.hList != 0 && a.controlsReady && round12SelectionInstalled.Load() {
				a.postUI(func() {
					header := send(a.hList, LVM_GETHEADER, 0, 0)
					if header == 0 {
						return
					}
					// Round12 owns both horizontal header boundaries. Keep the
					// independent bottom line visible and remove only the retired
					// Round7 header painter.
					v452RemoveSubclass.Call(header, round7FeedbackHeaderSubclassCB, round7FeedbackHeaderSubclassID)
					v452RemoveSubclass.Call(header, round12HeaderTopCallback, round12HeaderTopSubclassID)
					v452SetWindowSubclass.Call(header, round12HeaderTopCallback, round12HeaderTopSubclassID, 0)
					send(header, WM_SETFONT, uiFontBold, 1)
					round12SyncHeaderLine(a)
					procInvalidateRect.Call(header, 0, 1)
				})
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
}

func round12HeaderTopSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case WM_PAINT, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round12PaintHeaderTopLine(hwnd)
		if app != nil {
			round12SyncHeaderLine(app)
		}
		return result
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round12HeaderTopCallback, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round12PaintHeaderTopLine(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	hdc, _, _ := round7ListGetDC.Call(hwnd)
	if hdc == 0 {
		return
	}
	defer round7ListReleaseDC.Call(hwnd, hdc)
	var rc rect
	if ok, _, _ := procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc))); ok == 0 || rc.Right <= rc.Left || rc.Bottom <= rc.Top {
		return
	}
	fillSolid(hdc, rect{Left: rc.Left, Top: rc.Top, Right: rc.Right, Bottom: rc.Top + 1}, round12HeaderBottomSeparator)
}

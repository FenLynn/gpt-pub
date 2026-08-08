//go:build windows

package main

import (
	"syscall"
	"time"
	"unsafe"
)

const (
	round12HeaderTopSubclassID = 0x45C5
	round12WMNCPaint            = 0x0085
)

var (
	round12HeaderTopCallback uintptr
	round12HeaderGetWindowDC = user32.NewProc("GetWindowDC")
)

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
	case WM_PAINT, round12WMNCPaint, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE:
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
	// The disappearing edge in the native pressed Header state is the window
	// top edge, not the Header client origin. Paint through GetWindowDC so the
	// one-pixel owner survives native non-client/pressed-state repaints.
	hdc, _, _ := round12HeaderGetWindowDC.Call(hwnd)
	if hdc == 0 {
		return
	}
	defer round7ListReleaseDC.Call(hwnd, hdc)
	var wr rect
	if ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&wr))); ok == 0 {
		return
	}
	width := wr.Right - wr.Left
	if width <= 0 || wr.Bottom <= wr.Top {
		return
	}
	fillSolid(hdc, rect{Left: 0, Top: 0, Right: width, Bottom: 1}, round12HeaderBottomSeparator)
}

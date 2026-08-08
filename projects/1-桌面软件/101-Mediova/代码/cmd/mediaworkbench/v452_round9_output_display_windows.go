//go:build windows

package main

import (
	"sync"
	"syscall"
	"unsafe"
)

const (
	round9OutputSubclassID = 0x4594
	round9WMSetFocus       = 0x0007
	round9WMSetText        = 0x000C
	round9WMPrintClient    = 0x0318
	round9EMSetReadOnly    = 0x00CF
	round9DTEndEllipsis    = 0x00008000
	round9DTNoPrefix       = 0x00000800
)

var (
	round9OutputSubclassCB    uintptr
	round9OutputMu            sync.Mutex
	round9OutputInstalledHwnd uintptr
)

func init() {
	round9OutputSubclassCB = syscall.NewCallback(round9OutputSubclassProc)
}

// round9EnsureOutputDisplay turns the ComboBox's internal edit into a visual
// path display. It keeps the surrounding ComboBox/history behavior, but the
// child never receives a caret or paints a selection, so the output path can
// never flash blue during media switching or programmatic updates.
func round9EnsureOutputDisplay() {
	if app == nil || app.hOutputEdit == 0 {
		return
	}
	edit := round7FeedbackOutputEdit(app.hOutputEdit)
	if edit == 0 {
		return
	}
	round9OutputMu.Lock()
	defer round9OutputMu.Unlock()
	if round9OutputInstalledHwnd == edit {
		return
	}
	if ok, _, _ := v452SetWindowSubclass.Call(edit, round9OutputSubclassCB, round9OutputSubclassID, 0); ok == 0 {
		return
	}
	send(edit, round9EMSetReadOnly, 1, 0)
	round7FeedbackHideCaret.Call(edit)
	round9OutputInstalledHwnd = edit
	procInvalidateRect.Call(edit, 0, 0)
}

func round9PaintOutputDisplay(hwnd, hdc uintptr) {
	if hwnd == 0 || hdc == 0 {
		return
	}
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	fillSolid(hdc, rc, colorRef(255, 255, 255))
	rc.Left += scaleDPI(5)
	rc.Right -= scaleDPI(4)
	oldFont, _, _ := procSelectObject.Call(hdc, uiFontSmall)
	procSetBkMode.Call(hdc, TRANSPARENT)
	procSetTextColor.Call(hdc, colorRef(43, 54, 68))
	text := getText(hwnd)
	procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(text))), ^uintptr(0), uintptr(unsafe.Pointer(&rc)),
		DT_LEFT|DT_VCENTER|DT_SINGLELINE|round9DTEndEllipsis|round9DTNoPrefix)
	if oldFont != 0 {
		procSelectObject.Call(hdc, oldFont)
	}
}

func round9OutputSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case WM_PAINT:
		var ps paintStruct
		hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		if hdc != 0 {
			round9PaintOutputDisplay(hwnd, hdc)
			procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		}
		return 0
	case round9WMPrintClient:
		if wParam != 0 {
			round9PaintOutputDisplay(hwnd, wParam)
		}
		return 0
	case WM_ERASEBKGND:
		return 1
	case round9WMSetFocus, round7FeedbackWMLButtonDown:
		round7FeedbackHideCaret.Call(hwnd)
		if app != nil {
			if app.hList != 0 {
				procSetFocus.Call(app.hList)
			} else if app.hVideo != 0 {
				procSetFocus.Call(app.hVideo)
			}
		}
		procInvalidateRect.Call(hwnd, 0, 0)
		return 0
	case round9WMSetText:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round7FeedbackHideCaret.Call(hwnd)
		procInvalidateRect.Call(hwnd, 0, 0)
		return result
	case v452WMNCDestroy:
		round9OutputMu.Lock()
		if round9OutputInstalledHwnd == hwnd {
			round9OutputInstalledHwnd = 0
		}
		round9OutputMu.Unlock()
		v452RemoveSubclass.Call(hwnd, round9OutputSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

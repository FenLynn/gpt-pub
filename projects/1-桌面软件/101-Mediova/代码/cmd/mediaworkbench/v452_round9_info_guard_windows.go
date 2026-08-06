//go:build windows

package main

import (
	"strings"
	"sync"
	"syscall"
	"unsafe"
)

const round9InfoSubclassID = 0x4598

type round9InfoBinding struct {
	editor *round7Editor
	status uintptr
}

var (
	round9InfoSubclassCB uintptr
	round9InfoByHWND     sync.Map
)

func init() {
	round9InfoSubclassCB = syscall.NewCallback(round9InfoSubclassProc)
}

func round9EnsureInfoGuard(e *round7Editor) {
	if e == nil || e.hwnd == 0 || e.dialog == nil || e.dialog.hInfo == 0 {
		return
	}
	if _, ok := round9InfoByHWND.Load(e.dialog.hInfo); ok {
		return
	}
	status := createControl("STATIC", "", WS_CHILD|WS_VISIBLE, 0, 0, 1, 1, e.hwnd, 0)
	send(status, WM_SETFONT, uiFontSmall, 1)
	binding := &round9InfoBinding{editor: e, status: status}
	round9InfoByHWND.Store(e.dialog.hInfo, binding)
	v452SetWindowSubclass.Call(e.dialog.hInfo, round9InfoSubclassCB, round9InfoSubclassID, 0)
}

func round9LayoutPreviewStatus(e *round7Editor) {
	if e == nil || e.dialog == nil || e.dialog.hInfo == 0 || e.dialog.hCanvas == 0 {
		return
	}
	raw, ok := round9InfoByHWND.Load(e.dialog.hInfo)
	if !ok {
		return
	}
	binding := raw.(*round9InfoBinding)
	canvas, ok := childClientRect(e.dialog.hCanvas, e.hwnd)
	if !ok {
		return
	}
	round7FeedbackMove(binding.status, canvas.Left, canvas.Bottom+2, canvas.Right-canvas.Left, 20)
}

func round9SetPreviewStatus(e *round7Editor, text string) {
	if e == nil || e.dialog == nil || e.dialog.hInfo == 0 {
		return
	}
	raw, ok := round9InfoByHWND.Load(e.dialog.hInfo)
	if !ok {
		return
	}
	binding := raw.(*round9InfoBinding)
	setText(binding.status, text)
	procInvalidateRect.Call(binding.status, 0, 0)
}

func round9UTF16Text(ptr uintptr) string {
	if ptr == 0 {
		return ""
	}
	units := make([]uint16, 0, 256)
	for index := uintptr(0); index < 4096; index++ {
		value := *(*uint16)(unsafe.Pointer(ptr + index*2))
		if value == 0 {
			break
		}
		units = append(units, value)
	}
	return syscall.UTF16ToString(units)
}

func round9InfoSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == round9WMSetText {
		text := round9UTF16Text(lParam)
		raw, _ := round9InfoByHWND.Load(hwnd)
		if raw != nil {
			binding := raw.(*round9InfoBinding)
			if strings.HasPrefix(text, "预览帧") || strings.HasPrefix(text, "正在生成") || strings.HasPrefix(text, "高清预览") {
				setText(binding.status, text)
				procInvalidateRect.Call(binding.status, 0, 0)
				return 1
			}
		}
	}
	if message == v452WMNCDestroy {
		if raw, ok := round9InfoByHWND.LoadAndDelete(hwnd); ok {
			binding := raw.(*round9InfoBinding)
			if binding.status != 0 {
				procDestroyWindow.Call(binding.status)
			}
		}
		v452RemoveSubclass.Call(hwnd, round9InfoSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

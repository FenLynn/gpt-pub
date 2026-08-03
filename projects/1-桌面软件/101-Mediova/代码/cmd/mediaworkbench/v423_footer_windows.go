//go:build windows

package main

import "unsafe"

func measureSingleLineWidth(hdc uintptr, text string, font uintptr) int32 {
	if text == "" {
		return 0
	}
	old, _, _ := procSelectObject.Call(hdc, font)
	if old != 0 {
		defer procSelectObject.Call(hdc, old)
	}
	rc := rect{Right: 32767, Bottom: 128}
	procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(text))), ^uintptr(0), uintptr(unsafe.Pointer(&rc)), DT_LEFT|DT_SINGLELINE|DT_CALCRECT)
	width := rc.Right - rc.Left
	if width < 0 {
		return 0
	}
	return width
}

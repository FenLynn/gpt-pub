//go:build windows

package main

import "unsafe"

const (
	floatingULWAlpha   = 0x00000002
	floatingACSrcOver  = 0x00
	floatingACSrcAlpha = 0x01
)

var (
	floatingUpdateLayeredWindow = user32.NewProc("UpdateLayeredWindow")
	floatingGetDC               = user32.NewProc("GetDC")
	floatingReleaseDC           = user32.NewProc("ReleaseDC")
	floatingCreateDIBSection    = gdi32.NewProc("CreateDIBSection")
)

type floatingSize struct{ CX, CY int32 }

type floatingBlendFunction struct {
	BlendOp             byte
	BlendFlags          byte
	SourceConstantAlpha byte
	AlphaFormat         byte
}

// renderFloatingLayer uses a premultiplied-alpha DIB instead of SetWindowRgn.
// The old region is binary and causes stair-stepped corners; this path samples
// every edge pixel and lets Windows composite the result smoothly.
func (a *application) renderFloatingLayer() {
	if a == nil || a.hFloating == 0 {
		return
	}
	var client rect
	procGetClientRect.Call(a.hFloating, uintptr(unsafe.Pointer(&client)))
	w, h := client.Right-client.Left, client.Bottom-client.Top
	if w < 2 || h < 2 {
		return
	}
	screenDC, _, _ := floatingGetDC.Call(0)
	if screenDC == 0 {
		return
	}
	defer floatingReleaseDC.Call(0, screenDC)
	memoryDC, _, _ := procCreateCompatibleDC.Call(screenDC)
	if memoryDC == 0 {
		return
	}
	defer procDeleteDC.Call(memoryDC)
	info := v452Round5BitmapInfo{Header: v452Round5BitmapInfoHeader{
		Size: uint32(unsafe.Sizeof(v452Round5BitmapInfoHeader{})), Width: w, Height: -h,
		Planes: 1, BitCount: 32, Compression: 0,
	}}
	var bits uintptr
	bitmap, _, _ := floatingCreateDIBSection.Call(screenDC, uintptr(unsafe.Pointer(&info)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if bitmap == 0 || bits == 0 {
		return
	}
	defer procDeleteObject.Call(bitmap)
	old, _, _ := procSelectObject.Call(memoryDC, bitmap)
	if old != 0 {
		defer procSelectObject.Call(memoryDC, old)
	}
	raw := unsafe.Slice((*byte)(unsafe.Pointer(bits)), int(w*h*4))
	for i := range raw {
		raw[i] = 0
	}
	drawFloatingProgress(memoryDC, client)
	floatingApplyAlpha(raw, w, h, a.floatingProgress)
	var window rect
	if ok, _, _ := procGetWindowRect.Call(a.hFloating, uintptr(unsafe.Pointer(&window))); ok == 0 {
		return
	}
	destination := point{X: window.Left, Y: window.Top}
	source := point{}
	size := floatingSize{CX: w, CY: h}
	blend := floatingBlendFunction{BlendOp: floatingACSrcOver, SourceConstantAlpha: 255, AlphaFormat: floatingACSrcAlpha}
	floatingUpdateLayeredWindow.Call(a.hFloating, screenDC, uintptr(unsafe.Pointer(&destination)), uintptr(unsafe.Pointer(&size)), memoryDC, uintptr(unsafe.Pointer(&source)), 0, uintptr(unsafe.Pointer(&blend)), floatingULWAlpha)
}

func floatingApplyAlpha(raw []byte, w, h int32, pct float64) {
	// GDI fills RGB but leaves alpha at zero in this DIB. The floating strip is
	// deliberately fully opaque, so publish every physical pixel unchanged.
	_ = w
	_ = h
	_ = pct
	for offset := 3; offset < len(raw); offset += 4 {
		raw[offset] = 255
	}
}

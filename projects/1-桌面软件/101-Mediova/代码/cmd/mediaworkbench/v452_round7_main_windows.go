//go:build windows

package main

import (
	"unsafe"
)

const (
	round7BI_RGB       = 0
	round7DIBRGBColors = 0
	round7SRCCOPY      = 0x00CC0020
)

type round7BitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

type round7BitmapInfo struct {
	Header round7BitmapInfoHeader
	Colors [1]uint32
}

var (
	round7StretchDIBits = gdi32.NewProc("StretchDIBits")
	round7Polygon       = gdi32.NewProc("Polygon")
)

// round7DrawAALamp remains as the compatibility entry used by earlier v4.5.2
// code, but the actual lamp surface is owned by the single feedback visual
// path. No main-window event hook or competing layout handler lives here.
func round7DrawAALamp(hdc uintptr, x, y, diameter int, lamp, back uintptr) {
	round7FeedbackDrawFlatLamp(hdc, x, y, diameter, lamp, back)
}

func round7FillPolygon(hdc uintptr, points []point, color uintptr) {
	if hdc == 0 || len(points) < 3 {
		return
	}
	brush, _, _ := procCreateSolidBrush.Call(color)
	pen, _, _ := procCreatePen.Call(PS_SOLID, 1, color)
	oldBrush, _, _ := procSelectObject.Call(hdc, brush)
	oldPen, _, _ := procSelectObject.Call(hdc, pen)
	round7Polygon.Call(hdc, uintptr(unsafe.Pointer(&points[0])), uintptr(len(points)))
	procSelectObject.Call(hdc, oldPen)
	procSelectObject.Call(hdc, oldBrush)
	procDeleteObject.Call(pen)
	procDeleteObject.Call(brush)
}

func round7BlendColor(left, right uintptr, ratio float64) uintptr {
	if ratio < 0 {
		ratio = 0
	}
	if ratio > 1 {
		ratio = 1
	}
	lr, lg, lb := float64(left&0xff), float64((left>>8)&0xff), float64((left>>16)&0xff)
	rr, rg, rb := float64(right&0xff), float64((right>>8)&0xff), float64((right>>16)&0xff)
	mix := func(a, b float64) byte { return byte(a + (b-a)*ratio + 0.5) }
	return colorRef(mix(lr, rr), mix(lg, rg), mix(lb, rb))
}

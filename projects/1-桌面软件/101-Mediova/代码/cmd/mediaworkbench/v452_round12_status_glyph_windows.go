//go:build windows

package main

import (
	"math"
	"sync"
	"unsafe"

	"mediaworkbench/internal/model"
)

type round12StatusGlyph uint8

const (
	round12GlyphRing round12StatusGlyph = iota + 1
	round12GlyphQueue
	round12GlyphPlay
	round12GlyphPause
	round12GlyphCircle
	round12GlyphCross
	round12GlyphSquare
)

type round12StatusGlyphKey struct {
	size       int
	glyph      round12StatusGlyph
	foreground uintptr
	background uintptr
}

var round12StatusGlyphCache sync.Map

func round12StatusGlyphFor(status model.Status) round12StatusGlyph {
	switch status {
	case model.StatusReady:
		return round12GlyphRing
	case model.StatusQueued:
		return round12GlyphQueue
	case model.StatusProcessing:
		return round12GlyphPlay
	case model.StatusPaused:
		return round12GlyphPause
	case model.StatusDone:
		return round12GlyphCircle
	case model.StatusFailed:
		return round12GlyphCross
	case model.StatusCancelled:
		return round12GlyphSquare
	default:
		// Held, skipped and future/unknown states intentionally share the
		// neutral ring. The shape means "other state", not "ready"; colour and
		// the adjacent label continue to carry the exact state semantics.
		return round12GlyphRing
	}
}

func round12DrawAAStatusGlyph(hdc uintptr, cell rect, status model.Status, foreground, background uintptr) {
	if hdc == 0 || cell.Right <= cell.Left || cell.Bottom <= cell.Top {
		return
	}
	size := int(scaleDPI(14))
	rowHeight := int(cell.Bottom - cell.Top)
	if size > rowHeight-6 {
		size = rowHeight - 6
	}
	if size < 10 {
		size = 10
	}
	x := int(cell.Left + scaleDPI(4))
	y := int(cell.Top) + (rowHeight-size)/2
	round12DrawAAGlyph(hdc, x, y, size, round12StatusGlyphFor(status), foreground, background)
}

func round12DrawAAGlyph(hdc uintptr, x, y, size int, glyph round12StatusGlyph, foreground, background uintptr) {
	if hdc == 0 || size <= 0 {
		return
	}
	key := round12StatusGlyphKey{size: size, glyph: glyph, foreground: foreground, background: background}
	pixels, ok := round12StatusGlyphCache.Load(key)
	if !ok {
		pixels = round12BuildAAGlyphPixels(size, glyph, foreground, background)
		round12StatusGlyphCache.Store(key, pixels)
	}
	data := pixels.([]byte)
	if len(data) == 0 {
		return
	}
	info := round7BitmapInfo{Header: round7BitmapInfoHeader{
		Size: uint32(unsafe.Sizeof(round7BitmapInfoHeader{})), Width: int32(size), Height: -int32(size),
		Planes: 1, BitCount: 32, Compression: round7BI_RGB, SizeImage: uint32(len(data)),
	}}
	round7StretchDIBits.Call(
		hdc, uintptr(x), uintptr(y), uintptr(size), uintptr(size),
		0, 0, uintptr(size), uintptr(size), uintptr(unsafe.Pointer(&data[0])),
		uintptr(unsafe.Pointer(&info)), round7DIBRGBColors, round7SRCCOPY,
	)
}

func round12BuildAAGlyphPixels(size int, glyph round12StatusGlyph, foreground, background uintptr) []byte {
	if size <= 0 {
		return nil
	}
	pixels := make([]byte, size*size*4)
	fr, fg, fb := float64(foreground&0xff), float64((foreground>>8)&0xff), float64((foreground>>16)&0xff)
	br, bg, bb := float64(background&0xff), float64((background>>8)&0xff), float64((background>>16)&0xff)
	const samples = 8
	for py := 0; py < size; py++ {
		for px := 0; px < size; px++ {
			inside := 0
			for sy := 0; sy < samples; sy++ {
				for sx := 0; sx < samples; sx++ {
					x := (float64(px)+(float64(sx)+0.5)/samples)/float64(size)*2 - 1
					y := (float64(py)+(float64(sy)+0.5)/samples)/float64(size)*2 - 1
					if round12GlyphContains(glyph, x, y) {
						inside++
					}
				}
			}
			coverage := float64(inside) / float64(samples*samples)
			offset := (py*size + px) * 4
			pixels[offset+0] = byte(math.Round(bb + (fb-bb)*coverage))
			pixels[offset+1] = byte(math.Round(bg + (fg-bg)*coverage))
			pixels[offset+2] = byte(math.Round(br + (fr-br)*coverage))
			pixels[offset+3] = 255
		}
	}
	return pixels
}

func round12GlyphContains(glyph round12StatusGlyph, x, y float64) bool {
	ax, ay := math.Abs(x), math.Abs(y)
	switch glyph {
	case round12GlyphRing:
		d2 := x*x + y*y
		return d2 <= .58 && d2 >= .30
	case round12GlyphQueue:
		for _, center := range []float64{-.50, 0, .50} {
			dx := x - center
			if dx*dx+y*y <= .035 {
				return true
			}
		}
		return false
	case round12GlyphPlay:
		return round12PointInTriangle(x, y, -.50, -.68, -.50, .68, .68, 0)
	case round12GlyphPause:
		return ay <= .66 && ((x >= -.56 && x <= -.18) || (x >= .18 && x <= .56))
	case round12GlyphCircle:
		return x*x+y*y <= .58
	case round12GlyphCross:
		return ax <= .68 && ay <= .68 && (math.Abs(x-y) <= .19 || math.Abs(x+y) <= .19)
	case round12GlyphSquare:
		return ax <= .55 && ay <= .55
	default:
		return x*x+y*y <= .20
	}
}

func round12PointInTriangle(px, py, ax, ay, bx, by, cx, cy float64) bool {
	s1 := (bx-ax)*(py-ay) - (by-ay)*(px-ax)
	s2 := (cx-bx)*(py-by) - (cy-by)*(px-bx)
	s3 := (ax-cx)*(py-cy) - (ay-cy)*(px-cx)
	hasNegative := s1 < 0 || s2 < 0 || s3 < 0
	hasPositive := s1 > 0 || s2 > 0 || s3 > 0
	return !(hasNegative && hasPositive)
}

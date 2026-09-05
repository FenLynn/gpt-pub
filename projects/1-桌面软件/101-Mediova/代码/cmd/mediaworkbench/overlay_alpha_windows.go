//go:build windows

package main

import (
	"math"
	"strings"
	"unsafe"
)

const (
	floatingULWAlpha   = 0x00000002
	floatingACSrcOver  = 0x00
	floatingACSrcAlpha = 0x01

	// Floating bar visual constants: 34px height stadium pill -> 17px radius
	floatingBarRadius = 17
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

// renderFloatingLayer uses a premultiplied-alpha DIB and UpdateLayeredWindow.
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

	// Compose the entire surface in pure Go with ultra-clean high-transparency
	raw := unsafe.Slice((*byte)(unsafe.Pointer(bits)), int(w*h*4))
	floatingFullCompose(memoryDC, screenDC, w, h, raw, a.floatingProgress, a.floatingText, a.floatingPaused,
		a.settings.FloatingTopmost)

	var window rect
	if ok, _, _ := procGetWindowRect.Call(a.hFloating, uintptr(unsafe.Pointer(&window))); ok == 0 {
		return
	}
	destination := point{X: window.Left, Y: window.Top}
	source := point{}
	size := floatingSize{CX: w, CY: h}
	blend := floatingBlendFunction{BlendOp: floatingACSrcOver, SourceConstantAlpha: 255, AlphaFormat: floatingACSrcAlpha}
	floatingUpdateLayeredWindow.Call(a.hFloating, screenDC,
		uintptr(unsafe.Pointer(&destination)),
		uintptr(unsafe.Pointer(&size)),
		memoryDC,
		uintptr(unsafe.Pointer(&source)),
		0,
		uintptr(unsafe.Pointer(&blend)),
		floatingULWAlpha)
}

// ─── pixel-level composition with ultra-clear minimal glassmorphism ──────────

// floatingComposeDIB writes the background and progress bar directly into the RGBA buffer.
// 1. Calm, readable glass background (~77%-85% opacity).
// 2. Progress starts directly from the very left edge (x=0) and smoothly sweeps rightward.
// 3. Dynamic Progress Color: Blue gradient when active, subtle light cool-grey gradient when paused!
// 4. Subtle central vertical divider line separating Quantity and Percentage parts.
// 5. Subtle 1px anti-aliased glass rim for premium feel.
func floatingComposeDIB(raw []byte, w, h int32, pct float64, label string, paused, pinned bool) {
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}

	radius := floatRadius(w, h)

	// Progress starts from the very left edge (x=0) to w
	fillEndX := float64(w) * (pct / 100.0)

	fh := float64(h)
	midX := float64(w) / 2.0

	for y := int32(0); y < h; y++ {
		yRatio := float64(y) / math.Max(fh-1, 1)

		// 1. Readable translucent glass background. The earlier 68-88 alpha
		// range disappeared into light wallpapers and made both progress and
		// text difficult to read.
		bgR := 255.0*(1.0-yRatio) + 238.0*yRatio
		bgG := 255.0*(1.0-yRatio) + 244.0*yRatio
		bgB := 255.0*(1.0-yRatio) + 250.0*yRatio
		bgA := 196.0*(1.0-yRatio) + 216.0*yRatio

		for x := int32(0); x < w; x++ {
			off := int((y*w + x) * 4)
			if off+3 >= len(raw) {
				continue
			}

			// Subpixel Corner coverage
			cov, distToEdge := cornerCoverageDist(x, y, w, h, radius)
			if cov <= 0 {
				raw[off], raw[off+1], raw[off+2], raw[off+3] = 0, 0, 0, 0
				continue
			}

			fx := float64(x) + 0.5

			var pr, pg, pb, pa float64

			// 2. Progress bar starting from leftmost edge (x=0)
			if fx < fillEndX && fillEndX > 0 {
				xProgressRatio := fx / fillEndX

				var fillBaseR, fillBaseG, fillBaseB, fillAlpha float64
				if pct >= 100.0 || strings.Contains(label, "完成") {
					// Success State: High-aesthetic Emerald Green fluid gradient (#10B981 -> #059669)
					fillBaseR = 16.0*(1.0-xProgressRatio) + 5.0*xProgressRatio
					fillBaseG = 185.0*(1.0-xProgressRatio) + 150.0*xProgressRatio
					fillBaseB = 129.0*(1.0-xProgressRatio) + 105.0*xProgressRatio
					fillAlpha = 0.70
				} else if paused {
					// Paused State: Elegant Cool Light-Grey / Slate gradient
					// Left (#CBD5E1: 203, 213, 225) -> Right (#94A3B8: 148, 163, 184)
					fillBaseR = 203.0*(1.0-xProgressRatio) + 148.0*xProgressRatio
					fillBaseG = 213.0*(1.0-xProgressRatio) + 163.0*xProgressRatio
					fillBaseB = 225.0*(1.0-xProgressRatio) + 184.0*xProgressRatio
					fillAlpha = 0.62
				} else {
					// Active State: Vibrant Apple Blue fluid gradient
					// Left (#60A5FA: 96, 165, 250) -> Right (#2563EB: 37, 99, 235)
					fillBaseR = 96.0*(1.0-xProgressRatio) + 37.0*xProgressRatio
					fillBaseG = 165.0*(1.0-xProgressRatio) + 99.0*xProgressRatio
					fillBaseB = 250.0*(1.0-xProgressRatio) + 235.0*xProgressRatio
					fillAlpha = 0.76
				}

				// Vertical subtle sheen
				fillSheen := 1.06 - 0.12*yRatio
				fR := math.Min(fillBaseR*fillSheen, 255)
				fG := math.Min(fillBaseG*fillSheen, 255)
				fB := math.Min(fillBaseB*fillSheen, 255)

				// Fluid translucent blend
				pr = bgR*(1.0-fillAlpha) + fR*fillAlpha
				pg = bgG*(1.0-fillAlpha) + fG*fillAlpha
				pb = bgB*(1.0-fillAlpha) + fB*fillAlpha
				pa = bgA + (245.0-bgA)*fillAlpha
			} else {
				pr, pg, pb, pa = bgR, bgG, bgB, bgA
			}

			// 3. Central subtle vertical divider (separating quantity & percentage parts)
			divDistX := math.Abs(fx - midX)
			if divDistX < 0.8 && float64(y) >= float64(scaleDPI(7)) && float64(y) <= fh-float64(scaleDPI(7)) {
				divFactor := (0.8 - divDistX) / 0.8
				// Light translucent charcoal divider line
				pr = pr*(1.0-0.12*divFactor) + 80.0*(0.12*divFactor)
				pg = pg*(1.0-0.12*divFactor) + 95.0*(0.12*divFactor)
				pb = pb*(1.0-0.12*divFactor) + 115.0*(0.12*divFactor)
				pa = math.Min(pa+25.0*divFactor, 255)
			}

			// 4. Delicate 1px Outer Glass Rim
			if distToEdge < 1.1 {
				edgeFactor := 1.0
				if distToEdge > 0.1 {
					edgeFactor = 1.1 - distToEdge
				}
				if float64(y) < fh/2.0 {
					// Top rim: subtle pure white glow
					pr = math.Min(pr+25.0*edgeFactor, 255)
					pg = math.Min(pg+25.0*edgeFactor, 255)
					pb = math.Min(pb+25.0*edgeFactor, 255)
					pa = math.Min(pa+30.0*edgeFactor, 255)
				} else {
					// Bottom rim: micro contrast
					darken := 1.0 - 0.05*edgeFactor
					pr *= darken
					pg *= darken
					pb *= darken
					pa = math.Min(pa+20.0*edgeFactor, 255)
				}
			}

			// Apply master corner coverage & Premultiply for UpdateLayeredWindow
			finalAlpha := pa * cov
			if finalAlpha > 255 {
				finalAlpha = 255
			}
			aByte := uint8(finalAlpha)
			raw[off+0] = uint8(pb * finalAlpha / 255.0) // B
			raw[off+1] = uint8(pg * finalAlpha / 255.0) // G
			raw[off+2] = uint8(pr * finalAlpha / 255.0) // R
			raw[off+3] = aByte                          // A
		}
	}
}

// floatingApplyAlpha is kept for legacy unit test compatibility.
func floatingApplyAlpha(raw []byte, w, h int32, pct float64) {
	_ = w
	_ = h
	_ = pct
	for offset := 3; offset < len(raw); offset += 4 {
		raw[offset] = 255
	}
}

// cornerCoverageDist returns (coverage, distToEdge)
func cornerCoverageDist(x, y, w, h int32, radius float64) (float64, float64) {
	px := float64(x) + 0.5
	py := float64(y) + 0.5
	fw := float64(w)
	fh := float64(h)

	// Distance to flat edges
	edgeDistX := px
	if px > fw/2 {
		edgeDistX = fw - px
	}
	edgeDistY := py
	if py > fh/2 {
		edgeDistY = fh - py
	}
	distToEdge := math.Min(edgeDistX, edgeDistY)

	if radius <= 0 {
		cov := 1.0
		if distToEdge < 0 {
			cov = 0
		} else if distToEdge < 1 {
			cov = distToEdge
		}
		return cov, distToEdge
	}

	inLeft := px < radius
	inRight := px > fw-radius
	inTop := py < radius
	inBottom := py > fh-radius

	if (!inLeft && !inRight) || (!inTop && !inBottom) {
		return 1, distToEdge
	}

	var cx, cy float64
	if inLeft {
		cx = radius
	} else {
		cx = fw - radius
	}
	if inTop {
		cy = radius
	} else {
		cy = fh - radius
	}

	distToCenter := math.Sqrt((px-cx)*(px-cx) + (py-cy)*(py-cy))
	cornerDistToEdge := radius - distToCenter

	cov := 1.0
	if cornerDistToEdge <= -0.5 {
		cov = 0
	} else if cornerDistToEdge < 0.5 {
		cov = cornerDistToEdge + 0.5
	}
	return cov, cornerDistToEdge
}

// floatRadius computes the actual corner radius in physical pixels
func floatRadius(w, h int32) float64 {
	r := float64(scaleDPI(floatingBarRadius))
	half := float64(min32(w, h)) / 2.0
	if r > half {
		r = half
	}
	return r
}

func min32(a, b int32) int32 {
	if a < b {
		return a
	}
	return b
}

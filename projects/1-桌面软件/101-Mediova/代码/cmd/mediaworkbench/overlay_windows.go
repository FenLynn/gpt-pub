//go:build windows

package main

import (
	"fmt"
	"math"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"mediaworkbench/internal/config"
)

const (
	IDC_TOAST_CLOSE      = 4011
	IDC_IMPORT_CLOSE     = 4021
	TIMER_MAIN_CLOCK     = 1
	TIMER_TOAST_CLOSE    = 2
	TIMER_TOAST_ANIMATE  = 6
	TIMER_TRAY_RETRY     = 3
	TIMER_IMPORT_CLOSE   = 4
	TIMER_PROGRESS_FLUSH = 5
)

var (
	floatingClassName = p("MediovaFloating400")
	toastClassName    = p("MediovaToast400")
)

func registerAuxWindowClasses(hInst uintptr, hIcon uintptr) bool {
	cursor, _, _ := procLoadCursorW.Call(0, 32512)
	classes := []wndClassEx{
		{CbSize: uint32(unsafe.Sizeof(wndClassEx{})), LpfnWndProc: syscall.NewCallback(floatingWndProc), HInstance: hInst, HIcon: hIcon, HIconSm: hIcon, HCursor: cursor, HbrBackground: 0, LpszClassName: floatingClassName},
		{CbSize: uint32(unsafe.Sizeof(wndClassEx{})), LpfnWndProc: syscall.NewCallback(toastWndProc), HInstance: hInst, HIcon: hIcon, HIconSm: hIcon, HCursor: cursor, HbrBackground: COLOR_WINDOW + 1, LpszClassName: toastClassName},
	}
	for i := range classes {
		if r, _, _ := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&classes[i]))); r == 0 {
			return false
		}
	}
	return true
}

var (
	floatingHoverLeft  bool
	floatingHoverRight bool
	floatingTracking   bool
)

//go:nocheckptr
func floatingWndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	switch message {
	case WM_CREATE:
		if app != nil {
			app.hFloating = hwnd
		}
		return 0
	case WM_CLOSE:
		show(hwnd, false)
		return 0
	case WM_PAINT:
		paintFloatingProgress(hwnd)
		return 0
	case WM_ERASEBKGND:
		return 1
	case WM_MOUSEMOVE:
		if !floatingTracking {
			var tme trackMouseEvent
			tme.CbSize = uint32(unsafe.Sizeof(tme))
			tme.DwFlags = TME_LEAVE
			tme.HwndTrack = hwnd
			procTrackMouseEvent.Call(uintptr(unsafe.Pointer(&tme)))
			floatingTracking = true
		}
		x := int32(int16(loWord(lParam)))
		var rc rect
		procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
		newLeft := x < scaleDPI(26)
		newRight := x >= rc.Right-scaleDPI(26)
		if newLeft != floatingHoverLeft || newRight != floatingHoverRight {
			floatingHoverLeft = newLeft
			floatingHoverRight = newRight
			if app != nil {
				app.renderFloatingLayer()
			}
		}
		return 0
	case WM_MOUSELEAVE:
		floatingTracking = false
		if floatingHoverLeft || floatingHoverRight {
			floatingHoverLeft = false
			floatingHoverRight = false
			if app != nil {
				app.renderFloatingLayer()
			}
		}
		return 0
	case WM_LBUTTONUP:
		if app != nil {
			x := int32(int16(loWord(lParam)))
			var rc rect
			procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
			if x < scaleDPI(26) {
				// Click on Left play/pause button
				app.togglePause()
			} else if x >= rc.Right-scaleDPI(26) {
				// Click on Right pin button: toggle topmost
				app.settings.FloatingTopmost = !app.settings.FloatingTopmost
				_ = config.Save(app.settings)
				app.syncMenuChecks()
				app.applyFloatingTopmost()
				app.renderFloatingLayer()
			}
		}
		return 0
	case WM_TIMER:
		if wParam == 0x4503 {
			procKillTimer.Call(hwnd, 0x4503)
			show(hwnd, false)
			return 0
		}
	case WM_NCHITTEST:
		var wr rect
		procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&wr)))
		x := int32(int16(loWord(lParam)))
		if x < wr.Left+scaleDPI(26) || x >= wr.Right-scaleDPI(26) {
			return HTCLIENT
		}
		return HTCAPTION
	case WM_EXITSIZEMOVE:
		if app != nil {
			var wr rect
			if ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&wr))); ok != 0 {
				w := wr.Right - wr.Left
				h := wr.Bottom - wr.Top
				x := wr.Left
				y := wr.Top

				// Magnetic edge snapping (snaps within 18px from desktop work area)
				var mi monitorInfo
				mi.CbSize = uint32(unsafe.Sizeof(mi))
				hMon, _, _ := procMonitorFromWindow.Call(hwnd, MONITOR_DEFAULTTONEAREST)
				if hMon != 0 {
					if ok, _, _ := procGetMonitorInfoW.Call(hMon, uintptr(unsafe.Pointer(&mi))); ok != 0 {
						wa := mi.RcWork
						snapDist := int32(18)
						if math.Abs(float64(x-wa.Left)) < float64(snapDist) {
							x = wa.Left + 4
						} else if math.Abs(float64(wa.Right-x-w)) < float64(snapDist) {
							x = wa.Right - w - 4
						}
						if math.Abs(float64(y-wa.Top)) < float64(snapDist) {
							y = wa.Top + 4
						} else if math.Abs(float64(wa.Bottom-y-h)) < float64(snapDist) {
							y = wa.Bottom - h - 4
						}
						// Ensure never outside screen
						if x < wa.Left {
							x = wa.Left + 4
						}
						if x+w > wa.Right {
							x = wa.Right - w - 4
						}
						if y < wa.Top {
							y = wa.Top + 4
						}
						if y+h > wa.Bottom {
							y = wa.Bottom - h - 4
						}
						procSetWindowPos.Call(hwnd, 0, uintptr(x), uintptr(y), 0, 0, SWP_NOSIZE|SWP_NOZORDER|SWP_NOACTIVATE)
					}
				}

				app.settings.FloatingPositionSet = true
				app.settings.FloatingX = int(x)
				app.settings.FloatingY = int(y)
				_ = config.Save(app.settings)
			}
		}
		return 0
	case WM_DESTROY:
		if app != nil {
			app.hFloating = 0
			app.hFloatingProgress = 0
			app.hFloatingText = 0
			app.hFloatingClose = 0
		}
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return r
}

func paintFloatingProgress(hwnd uintptr) {
	var ps paintStruct
	hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	if hdc == 0 {
		return
	}
	defer procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
}

// ─── floating bar full composition (Glass + HiDPI Text + Vector Icons) ───────

func floatingFullCompose(memDC, screenDC uintptr, w, h int32, raw []byte, pct float64, label string, paused, pinned bool) {
	// 1. Draw smooth frosted glass background & blue gradient progress bar
	floatingComposeDIB(raw, w, h, pct, label, paused, pinned)

	// 2. High-precision Text rendering with Exact Alpha Recovery (Smooth subpixel font blending)
	drawFloatingTextHiDPI(screenDC, w, h, raw, pct, label)

	// 3. High-precision Vector icons (Left Pause/Play + Right Pin) directly in subpixel anti-aliasing
	drawFloatingIcons(w, h, raw, paused, pinned)
}

// drawFloatingTextHiDPI renders text onto a black scratch buffer, extracts exact subpixel coverage,
// and alpha-blends it in deep navy onto the background with no jagged black edges.
func drawFloatingTextHiDPI(screenDC uintptr, w, h int32, raw []byte, pct float64, label string) {
	if screenDC == 0 || w <= 0 || h <= 0 {
		return
	}
	textDC, _, _ := procCreateCompatibleDC.Call(screenDC)
	if textDC == 0 {
		return
	}
	defer procDeleteDC.Call(textDC)

	info := v452Round5BitmapInfo{Header: v452Round5BitmapInfoHeader{
		Size: uint32(unsafe.Sizeof(v452Round5BitmapInfoHeader{})), Width: w, Height: -h,
		Planes: 1, BitCount: 32, Compression: 0,
	}}
	var bits uintptr
	hBmp, _, _ := floatingCreateDIBSection.Call(screenDC, uintptr(unsafe.Pointer(&info)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if hBmp == 0 || bits == 0 {
		return
	}
	defer procDeleteObject.Call(hBmp)
	oldBmp, _, _ := procSelectObject.Call(textDC, hBmp)
	if oldBmp != 0 {
		defer procSelectObject.Call(textDC, oldBmp)
	}

	// Clear text bitmap to pure black (0, 0, 0, 0)
	tRaw := unsafe.Slice((*byte)(unsafe.Pointer(bits)), int(w*h*4))
	for i := range tRaw {
		tRaw[i] = 0
	}

	procSetBkMode.Call(textDC, TRANSPARENT)
	procSetTextColor.Call(textDC, colorRef(255, 255, 255))
	oldFont, _, _ := procSelectObject.Call(textDC, uiFontSmall)
	if oldFont != 0 {
		defer procSelectObject.Call(textDC, oldFont)
	}

	if pct >= 100.0 || strings.Contains(label, "完成") {
		// Render unified "全部完成 ✓" centered across the capsule
		centerRC := rect{Left: scaleDPI(20), Top: 0, Right: w - scaleDPI(20), Bottom: h}
		procDrawTextW.Call(textDC, uintptr(unsafe.Pointer(p("全部完成 ✓"))), ^uintptr(0), uintptr(unsafe.Pointer(&centerRC)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
	} else {
		// Part 1: Quantity on Left part center (e.g. "0 / 4")
		leftRC := rect{Left: scaleDPI(24), Top: 0, Right: w/2 - scaleDPI(3), Bottom: h}
		// Part 2: Percentage on Right part center (e.g. "43%")
		rightRC := rect{Left: w/2 + scaleDPI(3), Top: 0, Right: w - scaleDPI(22), Bottom: h}

		procDrawTextW.Call(textDC, uintptr(unsafe.Pointer(p(label))), ^uintptr(0), uintptr(unsafe.Pointer(&leftRC)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
		procDrawTextW.Call(textDC, uintptr(unsafe.Pointer(p(floatingProgressPercent(pct)))), ^uintptr(0), uintptr(unsafe.Pointer(&rightRC)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
	}

	// A deeper navy remains legible over both the pale track and blue fill.
	tgtR, tgtG, tgtB := 24.0, 49.0, 78.0

	for i := 0; i+3 < len(raw); i += 4 {
		// Use green channel for font coverage intensity
		coverage := float64(tRaw[i+1]) / 255.0
		if coverage <= 0.005 {
			continue
		}

		bgA := float64(raw[i+3])
		if bgA <= 0.0 {
			continue
		}
		// Unpremultiply current background
		currB := float64(raw[i+0]) * 255.0 / bgA
		currG := float64(raw[i+1]) * 255.0 / bgA
		currR := float64(raw[i+2]) * 255.0 / bgA

		// Blend text color over current background
		outA := bgA + (255.0-bgA)*coverage
		outR := currR*(1.0-coverage) + tgtR*coverage
		outG := currG*(1.0-coverage) + tgtG*coverage
		outB := currB*(1.0-coverage) + tgtB*coverage

		if outA > 255 {
			outA = 255
		}

		// Re-premultiply
		raw[i+0] = uint8(outB * outA / 255.0)
		raw[i+1] = uint8(outG * outA / 255.0)
		raw[i+2] = uint8(outR * outA / 255.0)
		raw[i+3] = uint8(outA)
	}
}

// drawFloatingIcons draws left pause/play glyph and right pin directly via vector math.
func drawFloatingIcons(w, h int32, raw []byte, paused, pinned bool) {
	// Target icon colors: Dark Slate #334155 (R:51, G:65, B:85)
	iconR, iconG, iconB := 51.0, 65.0, 85.0

	// 1. Left Pause/Play Icon (centered at x=scaleDPI(16), y=h/2)
	cx := float64(scaleDPI(15))
	cy := float64(h) / 2.0

	for y := int32(0); y < h; y++ {
		fy := float64(y) + 0.5
		for x := int32(0); x < w; x++ {
			fx := float64(x) + 0.5
			off := int((y*w + x) * 4)
			if off+3 >= len(raw) {
				continue
			}

			// Left Glyph Coverage
			var glyphCov float64
			if paused {
				// Pause double bars (2px width, 2px gap, 9px height)
				barW := float64(scaleDPI(2))
				gap := float64(scaleDPI(2))
				barH := float64(scaleDPI(9))

				inBar1 := (fx >= cx-gap/2-barW && fx <= cx-gap/2 && math.Abs(fy-cy) <= barH/2)
				inBar2 := (fx >= cx+gap/2 && fx <= cx+gap/2+barW && math.Abs(fy-cy) <= barH/2)
				if inBar1 || inBar2 {
					glyphCov = 1.0
				}
			} else {
				// Play triangle (right-pointing, optically centered)
				triH := float64(scaleDPI(10))
				triW := float64(scaleDPI(9))
				xLeft := cx - triW/2 + float64(scaleDPI(1))
				xRight := xLeft + triW
				yTop := cy - triH/2
				yBot := cy + triH/2

				if fx >= xLeft && fx <= xRight && fy >= yTop && fy <= yBot {
					progress := (fx - xLeft) / triW
					halfHeightAtX := (triH / 2.0) * (1.0 - progress)
					distY := math.Abs(fy - cy)
					if distY <= halfHeightAtX {
						glyphCov = 1.0
					} else if distY < halfHeightAtX+0.8 {
						glyphCov = 1.0 - (distY-halfHeightAtX)/0.8
					}
				}
			}

			// Hover chip glow for left play/pause button
			if floatingHoverLeft {
				distLeft := math.Sqrt((fx-cx)*(fx-cx) + (fy-cy)*(fy-cy))
				chipRadius := float64(scaleDPI(11))
				if distLeft <= chipRadius {
					chipAlpha := 0.18 * (1.0 - distLeft/chipRadius*0.2)
					blendPixelOverRaw(raw, off, 255.0, 255.0, 255.0, chipAlpha)
				}
			}

			// Hover chip glow for right pin button
			pinX := float64(w - scaleDPI(13))
			pinY := cy
			if floatingHoverRight {
				distRight := math.Sqrt((fx-pinX)*(fx-pinX) + (fy-pinY)*(fy-pinY))
				chipRadius := float64(scaleDPI(11))
				if distRight <= chipRadius {
					chipAlpha := 0.18 * (1.0 - distRight/chipRadius*0.2)
					blendPixelOverRaw(raw, off, 255.0, 255.0, 255.0, chipAlpha)
				}
			}

			if glyphCov > 0 {
				blendPixelOverRaw(raw, off, iconR, iconG, iconB, glyphCov)
			}

			// 2. Right Pin Icon (centered at px=w-scaleDPI(13), py=h/2)
			var pinCov float64
			var pR, pG, pB, pAlpha float64
			if pinned {
				// Pinned: Solid Dark Slate #334155 (100% visible, distinct dark grey)
				pR, pG, pB, pAlpha = iconR, iconG, iconB, 1.0
			} else {
				// Unpinned: Almost hidden, subtle slate #64748B with ~0.20 opacity
				pR, pG, pB, pAlpha = 100.0, 116.0, 139.0, 0.20
			}

			dx := math.Abs(fx - pinX)
			dy := fy - pinY

			// Cap: dy in [-5.5, -4], halfW = 3.0
			if dy >= -float64(scaleDPI(6)) && dy <= -float64(scaleDPI(4)) && dx <= float64(scaleDPI(3)) {
				pinCov = 1.0
			}
			// Body: dy in [-4, -1], halfW from 1.0 to 3.0
			if dy > -float64(scaleDPI(4)) && dy <= -float64(scaleDPI(1)) {
				t := (dy + float64(scaleDPI(4))) / float64(scaleDPI(3))
				bw := float64(scaleDPI(1))*(1.0-t) + float64(scaleDPI(3))*t
				if dx <= bw {
					pinCov = 1.0
				}
			}
			// Collar: dy in [-1, 1], halfW = 3.5
			collarHalfW := float64(scaleDPI(7)) / 2.0
			if dy > -float64(scaleDPI(1)) && dy <= float64(scaleDPI(1)) && dx <= collarHalfW {
				pinCov = 1.0
			}
			// Needle: dy in [1, 5], dx <= 0.8
			needleHalfW := math.Max(float64(scaleDPI(1))*0.75, 0.75)
			if dy > float64(scaleDPI(1)) && dy <= float64(scaleDPI(5)) && dx <= needleHalfW {
				pinCov = 1.0
			}

			if pinCov > 0 {
				blendPixelOverRaw(raw, off, pR, pG, pB, pinCov*pAlpha)
			}
		}
	}
}

func blendPixelOverRaw(raw []byte, off int, r, g, b, cov float64) {
	if off+3 >= len(raw) || cov <= 0 {
		return
	}
	bgA := float64(raw[off+3])
	if bgA <= 0 {
		return
	}
	currB := float64(raw[off+0]) * 255.0 / bgA
	currG := float64(raw[off+1]) * 255.0 / bgA
	currR := float64(raw[off+2]) * 255.0 / bgA

	outA := bgA + (255.0-bgA)*cov
	outR := currR*(1.0-cov) + r*cov
	outG := currG*(1.0-cov) + g*cov
	outB := currB*(1.0-cov) + b*cov

	if outA > 255 {
		outA = 255
	}
	raw[off+0] = uint8(outB * outA / 255.0)
	raw[off+1] = uint8(outG * outA / 255.0)
	raw[off+2] = uint8(outR * outA / 255.0)
	raw[off+3] = uint8(outA)
}

// ─── legacy stub kept for test compatibility ─────────────────────────────────

func drawFloatingProgress(hdc uintptr, rc rect) {
	if app == nil {
		return
	}
	pct := app.floatingProgress
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	fillSolid(hdc, rc, colorRef(245, 248, 252))
	fill := rc
	fill.Right = fill.Left + int32(float64(rc.Right-rc.Left)*pct/100+.5)
	if fill.Right > fill.Left {
		fillSolid(hdc, fill, colorRef(90, 160, 245))
	}
}

// ─── toast notification ──────────────────────────────────────────────────────

//go:nocheckptr
func toastWndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	switch message {
	case WM_CREATE:
		if app != nil {
			app.hToast = hwnd
		}
		return 0
	case WM_COMMAND:
		if int(loWord(wParam)) == IDC_TOAST_CLOSE {
			beginCompletionToastClose(hwnd)
			return 0
		}
	case WM_TIMER:
		switch wParam {
		case TIMER_TOAST_ANIMATE:
			updateCompletionToastFrame(hwnd)
			return 0
		case TIMER_TOAST_CLOSE:
			procKillTimer.Call(hwnd, TIMER_TOAST_CLOSE)
			beginCompletionToastClose(hwnd)
			return 0
		}
	case WM_PAINT:
		var ps paintStruct
		hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		if hdc != 0 {
			var rc rect
			procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
			drawVerticalGradient(hdc, rc, colorRef(245, 250, 255), colorRef(221, 237, 255))
			drawRoundedBorder(hdc, rect{Left: 0, Top: 0, Right: rc.Right - 1, Bottom: rc.Bottom - 1}, scaleDPI(10), colorRef(152, 190, 229))
			if app != nil {
				titleRC := rect{Left: scaleDPI(18), Top: scaleDPI(10), Right: rc.Right - scaleDPI(48), Bottom: scaleDPI(38)}
				round12DrawVisuallyCenteredText(hdc, app.toastTitle, titleRC, uiFontBold, colorRef(25, 86, 158), DT_LEFT)
				bodyRC := rect{Left: scaleDPI(18), Top: scaleDPI(43), Right: rc.Right - scaleDPI(18), Bottom: rc.Bottom - scaleDPI(12)}
				oldFont, _, _ := procSelectObject.Call(hdc, uiFontSmall)
				procSetBkMode.Call(hdc, TRANSPARENT)
				procSetTextColor.Call(hdc, colorRef(67, 86, 109))
				procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(app.toastBody))), ^uintptr(0), uintptr(unsafe.Pointer(&bodyRC)), DT_LEFT)
				if oldFont != 0 {
					procSelectObject.Call(hdc, oldFont)
				}
				closeRC := rect{Left: rc.Right - scaleDPI(42), Top: scaleDPI(7), Right: rc.Right - scaleDPI(10), Bottom: scaleDPI(37)}
				drawCenteredText(hdc, "×", closeRC, uiFont, colorRef(81, 104, 131))
			}
		}
		procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		return 0
	case WM_ERASEBKGND:
		return 1
	case WM_LBUTTONUP:
		beginCompletionToastClose(hwnd)
		return 0
	case WM_CLOSE:
		beginCompletionToastClose(hwnd)
		return 0
	case WM_DESTROY:
		procKillTimer.Call(hwnd, TIMER_TOAST_CLOSE)
		procKillTimer.Call(hwnd, TIMER_TOAST_ANIMATE)
		if app != nil {
			app.hToast = 0
			app.hToastTitle = 0
			app.hToastText = 0
			app.hToastClose = 0
			app.toastClosing = false
			app.toastTitle = ""
			app.toastBody = ""
		}
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return r
}

func drawVerticalGradient(hdc uintptr, rc rect, top, bottom uintptr) {
	height := rc.Bottom - rc.Top
	if hdc == 0 || height <= 0 || rc.Right <= rc.Left {
		return
	}
	for y := int32(0); y < height; y += 2 {
		end := y + 2
		if end > height {
			end = height
		}
		t := 0.0
		if height > 1 {
			t = float64(y) / float64(height-1)
		}
		fillSolid(hdc, rect{Left: rc.Left, Top: rc.Top + y, Right: rc.Right, Bottom: rc.Top + end}, mixColor(top, bottom, t))
	}
}

func beginCompletionToastClose(hwnd uintptr) {
	if app == nil || hwnd == 0 || app.hToast != hwnd || app.toastClosing {
		return
	}
	app.toastClosing = true
	app.toastClosingAt = time.Now()
	procKillTimer.Call(hwnd, TIMER_TOAST_CLOSE)
	procSetTimer.Call(hwnd, TIMER_TOAST_ANIMATE, 15, 0)
}

func updateCompletionToastFrame(hwnd uintptr) {
	if app == nil || hwnd == 0 || app.hToast != hwnd {
		return
	}
	elapsed := time.Since(app.toastShownAt)
	if app.toastClosing {
		elapsed = time.Since(app.toastClosingAt)
	}
	frame := v452ImportToastFrameAt(elapsed, 180*time.Millisecond, app.toastClosing)
	y := app.toastTargetY + scaleDPI(frame.OffsetY)
	v452SetLayeredAttributes.Call(hwnd, 0, uintptr(frame.Alpha), v452LWAAlpha)
	procSetWindowPos.Call(hwnd, HWND_TOPMOST, uintptr(app.toastTargetX), uintptr(y), uintptr(scaleDPI(438)), uintptr(scaleDPI(116)), SWP_NOACTIVATE)
	if !frame.Done {
		return
	}
	procKillTimer.Call(hwnd, TIMER_TOAST_ANIMATE)
	if app.toastClosing {
		procDestroyWindow.Call(hwnd)
	}
}

func workArea() rect {
	var rc rect
	if r, _, _ := procSystemParametersInfoW.Call(SPI_GETWORKAREA, 0, uintptr(unsafe.Pointer(&rc)), 0); r == 0 {
		rc = rect{Left: 0, Top: 0, Right: 1920, Bottom: 1080}
	}
	return rc
}

func (a *application) ensureFloatingBar() {
	if a == nil || a.hFloating != 0 {
		return
	}
	hInst, _, _ := procGetModuleHandleW.Call(0)
	rc := workArea()
	// Compact modern pill shape: ~2/3 length (196 x 34)
	w, h := scaleDPI(196), scaleDPI(34)
	x, y := rc.Right-w-scaleDPI(48), rc.Top+scaleDPI(80)
	if a.settings.FloatingPositionSet {
		x, y = int32(a.settings.FloatingX), int32(a.settings.FloatingY)
	}
	margin := scaleDPI(8)
	if x < rc.Left+margin || x+w > rc.Right-margin || y < rc.Top+margin || y+h > rc.Bottom-margin {
		x, y = rc.Right-w-scaleDPI(48), rc.Top+scaleDPI(80)
	}
	exStyle := uintptr(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | v452WSExLayered)
	if a.settings.FloatingTopmost {
		exStyle |= WS_EX_TOPMOST
	}
	hwnd, _, _ := procCreateWindowExW.Call(exStyle, uintptr(unsafe.Pointer(floatingClassName)), uintptr(unsafe.Pointer(p("Mediova进度"))), WS_POPUP, uintptr(x), uintptr(y), uintptr(w), uintptr(h), 0, 0, hInst, 0)
	if hwnd != 0 {
		a.hFloating = hwnd
		a.applyFloatingTopmost()
		procSetWindowPos.Call(hwnd, 0, uintptr(x), uintptr(y), uintptr(w), uintptr(h), SWP_NOZORDER|SWP_NOACTIVATE)
	}
}

func (a *application) applyFloatingTopmost() {
	if a == nil || a.hFloating == 0 {
		return
	}
	insertAfter := HWND_NOTOPMOST
	if a.settings.FloatingTopmost {
		insertAfter = HWND_TOPMOST
	}
	procSetWindowPos.Call(a.hFloating, insertAfter, 0, 0, 0, 0, SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE)
}

func (a *application) updateFloatingBar(pct float64, text string, visible, paused bool) {
	if a == nil {
		return
	}
	if !a.settings.ShowFloatingBar || !visible {
		if a.hFloating != 0 {
			show(a.hFloating, false)
		}
		return
	}
	a.ensureFloatingBar()
	if a.hFloating == 0 {
		return
	}
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	changed := a.floatingText != text || a.floatingProgress != pct || a.floatingPaused != paused
	a.floatingText = text
	a.floatingProgress = pct
	a.floatingPaused = paused
	if changed {
		a.renderFloatingLayer()
	}
	procShowWindow.Call(a.hFloating, SW_SHOWNOACTIVATE)
}

func (a *application) showCompletionToast(title, body string) {
	if a == nil || !a.settings.NotifyOnDone {
		return
	}
	if a.hToast != 0 {
		procDestroyWindow.Call(a.hToast)
	}
	a.toastTitle = title
	a.toastBody = body
	hInst, _, _ := procGetModuleHandleW.Call(0)
	rc := workArea()
	w, h := scaleDPI(438), scaleDPI(116)
	x := rc.Right - w - scaleDPI(14)
	y := rc.Bottom - h - scaleDPI(14)
	if a.hFloating != 0 {
		if r, _, _ := procIsWindowVisible.Call(a.hFloating); r != 0 {
			y -= scaleDPI(84)
		}
	}
	hwnd, _, _ := procCreateWindowExW.Call(WS_EX_TOOLWINDOW|WS_EX_TOPMOST|WS_EX_NOACTIVATE|v452WSExLayered, uintptr(unsafe.Pointer(toastClassName)), uintptr(unsafe.Pointer(p(title))), WS_POPUP|WS_CLIPCHILDREN, uintptr(x), uintptr(y+scaleDPI(16)), uintptr(w), uintptr(h), 0, 0, hInst, 0)
	if hwnd == 0 {
		return
	}
	a.hToast = hwnd
	a.toastTargetX = x
	a.toastTargetY = y
	a.toastShownAt = time.Now()
	a.toastClosing = false
	rgn, _, _ := procCreateRoundRectRgn.Call(0, 0, uintptr(w+1), uintptr(h+1), uintptr(scaleDPI(12)), uintptr(scaleDPI(12)))
	if rgn != 0 {
		if ok, _, _ := procSetWindowRgn.Call(hwnd, rgn, 1); ok == 0 {
			procDeleteObject.Call(rgn)
		}
	}
	v452SetLayeredAttributes.Call(hwnd, 0, 0, v452LWAAlpha)
	procSetWindowPos.Call(hwnd, HWND_TOPMOST, uintptr(x), uintptr(y+scaleDPI(16)), uintptr(w), uintptr(h), SWP_NOACTIVATE)
	procShowWindow.Call(hwnd, SW_SHOWNOACTIVATE)
	procSetTimer.Call(hwnd, TIMER_TOAST_ANIMATE, 15, 0)
	procSetTimer.Call(hwnd, TIMER_TOAST_CLOSE, 2000, 0)
}

func floatingProgressText(pct float64, completed, total int, elapsed, remaining time.Duration, speedLabel string, active int, engine string, paused bool) string {
	return fmt.Sprintf("%d / %d", completed, total)
}

func floatingProgressPercent(pct float64) string {
	return fmt.Sprintf("%.0f%%", pct)
}

func drawFloatingRectBorder(hdc uintptr, rc rect, color uintptr) {
	if hdc == 0 || rc.Right <= rc.Left || rc.Bottom <= rc.Top {
		return
	}
	pen, _, _ := procCreatePen.Call(PS_SOLID, uintptr(maxInt32(scaleDPI(1), 1)), color)
	if pen == 0 {
		return
	}
	hollow, _, _ := procGetStockObject.Call(NULL_BRUSH)
	oldPen, _, _ := procSelectObject.Call(hdc, pen)
	oldBrush, _, _ := procSelectObject.Call(hdc, hollow)
	procRectangle.Call(hdc, uintptr(rc.Left), uintptr(rc.Top), uintptr(rc.Right), uintptr(rc.Bottom))
	if oldBrush != 0 {
		procSelectObject.Call(hdc, oldBrush)
	}
	if oldPen != 0 {
		procSelectObject.Call(hdc, oldPen)
	}
	procDeleteObject.Call(pen)
}

func maxInt32(a, b int32) int32 {
	if a > b {
		return a
	}
	return b
}

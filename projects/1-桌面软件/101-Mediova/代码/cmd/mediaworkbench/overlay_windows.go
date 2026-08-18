//go:build windows

package main

import (
	"fmt"
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
	TIMER_FLOAT_PIN_HIDE = 7
)

var (
	floatingClassName = p("MediovaFloating400")
	toastClassName    = p("MediovaToast400")
)

func registerAuxWindowClasses(hInst uintptr, hIcon uintptr) bool {
	cursor, _, _ := procLoadCursorW.Call(0, 32512)
	classes := []wndClassEx{
		// This window is drawn only through UpdateLayeredWindow. A COLOR_WINDOW
		// class brush can leak square white corners during native repaints.
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
		// UpdateLayeredWindow owns the visible pixels.  A normal GDI repaint here
		// would bypass the premultiplied-alpha surface and is the source of faint
		// remnants on the desktop after hover/click changes.
		paintFloatingProgress(hwnd)
		return 0
	case WM_ERASEBKGND:
		return 1
	case WM_MOUSEMOVE:
		if app != nil && !app.floatingPinVisible {
			app.floatingPinVisible = true
			app.renderFloatingLayer()
		}
		procKillTimer.Call(hwnd, TIMER_FLOAT_PIN_HIDE)
		procSetTimer.Call(hwnd, TIMER_FLOAT_PIN_HIDE, 1200, 0)
		return 0
	case WM_TIMER:
		if wParam == TIMER_FLOAT_PIN_HIDE && app != nil && !app.settings.FloatingTopmost {
			procKillTimer.Call(hwnd, TIMER_FLOAT_PIN_HIDE)
			app.floatingPinVisible = false
			app.renderFloatingLayer()
			return 0
		}
	case WM_LBUTTONUP:
		if app != nil {
			x := int32(int16(loWord(lParam)))
			var rc rect
			procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
			if x >= rc.Right-scaleDPI(32) {
				app.settings.FloatingTopmost = !app.settings.FloatingTopmost
				app.floatingPinVisible = app.settings.FloatingTopmost
				_ = config.Save(app.settings)
				app.syncMenuChecks()
				app.applyFloatingTopmost()
				app.renderFloatingLayer()
			}
		}
		return 0
	case WM_NCHITTEST:
		var wr rect
		procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&wr)))
		x := int32(int16(loWord(lParam)))
		if x >= wr.Right-scaleDPI(32) {
			return HTCLIENT
		}
		return HTCAPTION
	case WM_EXITSIZEMOVE:
		if app != nil {
			var wr rect
			if ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&wr))); ok != 0 {
				app.settings.FloatingPositionSet = true
				app.settings.FloatingX = int(wr.Left)
				app.settings.FloatingY = int(wr.Top)
				_ = config.Save(app.settings)
			}
		}
		return 0
	case WM_DESTROY:
		procKillTimer.Call(hwnd, TIMER_FLOAT_PIN_HIDE)
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
	// The layered DIB is already committed by renderFloatingLayer. Begin/EndPaint
	// merely validates the update region; drawing here would create an opaque
	// second rendering path.
}

func drawFloatingProgress(hdc uintptr, rc rect) {
	// This is intentionally an opaque rectangular strip. Wallpaper transparency
	// and soft corners made the state indistinct at small progress values.
	surface := rc
	fillSolid(hdc, surface, colorRef(211, 231, 248))
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
	// The fill owns the complete left edge: no inset, transparency or seam.
	fill := surface
	fill.Right = fill.Left + int32(float64(surface.Right-surface.Left)*pct/100+.5)
	if fill.Right > fill.Left {
		fillSolid(hdc, fill, colorRef(102, 169, 222))
	}
	iconRC := surface
	iconRC.Left += scaleDPI(8)
	iconRC.Right = iconRC.Left + scaleDPI(15)
	iconRC.Top += scaleDPI(5)
	iconRC.Bottom -= scaleDPI(5)
	drawFloatingStateGlyph(hdc, iconRC, app.floatingPaused, colorRef(12, 22, 32))
	textRC := surface
	textRC.Left += scaleDPI(32)
	textRC.Right -= scaleDPI(30)
	drawCenteredText(hdc, fmt.Sprintf("%s (%s)", app.floatingText, floatingProgressPercent(pct)), textRC, uiFontSmall, colorRef(0, 0, 0))
	// The true pushpin is always visible: blue when pinned, black otherwise.
	pinRC := surface
	pinRC.Left = surface.Right - scaleDPI(24)
	pinColor := colorRef(0, 0, 0)
	if app.settings.FloatingTopmost {
		pinColor = colorRef(16, 79, 155)
	}
	drawFloatingPushPin(hdc, pinRC, pinColor)
}

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
	// A short, deliberately taller desktop strip: it reads at least as clearly
	// as the high-DPI status lamps without returning to a large notification UI.
	w, h := scaleDPI(228), scaleDPI(26)
	x, y := rc.Right-w-scaleDPI(56), rc.Top+scaleDPI(86)
	if a.settings.FloatingPositionSet {
		x, y = int32(a.settings.FloatingX), int32(a.settings.FloatingY)
	}
	margin := scaleDPI(8)
	if x < rc.Left+margin || x+w > rc.Right-margin || y < rc.Top+margin || y+h > rc.Bottom-margin {
		x, y = rc.Right-w-scaleDPI(56), rc.Top+scaleDPI(86)
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
			y -= scaleDPI(78)
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
	return fmt.Sprintf("%d/%d", completed, total)
}

func floatingProgressPercent(pct float64) string {
	return fmt.Sprintf("%.0f%%", pct)
}

// drawFloatingPushPin draws the recognisable Windows-style pushpin silhouette
// directly instead of using a tiny font glyph or the old three-line marker.
func drawFloatingPushPin(hdc uintptr, rc rect, color uintptr) {
	pen, _, _ := procCreatePen.Call(PS_SOLID, uintptr(maxInt32(scaleDPI(1), 1)), color)
	if pen == 0 {
		return
	}
	old, _, _ := procSelectObject.Call(hdc, pen)
	defer func() {
		if old != 0 {
			procSelectObject.Call(hdc, old)
		}
		procDeleteObject.Call(pen)
	}()
	cx := (rc.Left + rc.Right) / 2
	top := rc.Top + scaleDPI(2)
	cap := maxInt32(scaleDPI(3), 2)
	collar := top + scaleDPI(3)
	body := collar + scaleDPI(2)
	tip := rc.Bottom - scaleDPI(2)

	// cap -> tapered body -> needle. This reads as a pushpin at 100% DPI and
	// remains a clean vector at scaled DPI settings.
	procMoveToEx.Call(hdc, uintptr(cx-cap), uintptr(top), 0)
	procLineTo.Call(hdc, uintptr(cx+cap), uintptr(top))
	procMoveToEx.Call(hdc, uintptr(cx-cap), uintptr(top), 0)
	procLineTo.Call(hdc, uintptr(cx-cap+scaleDPI(1)), uintptr(collar))
	procMoveToEx.Call(hdc, uintptr(cx+cap), uintptr(top), 0)
	procLineTo.Call(hdc, uintptr(cx+cap-scaleDPI(1)), uintptr(collar))
	procMoveToEx.Call(hdc, uintptr(cx-cap), uintptr(collar), 0)
	procLineTo.Call(hdc, uintptr(cx+cap), uintptr(collar))
	procMoveToEx.Call(hdc, uintptr(cx-cap), uintptr(collar), 0)
	procLineTo.Call(hdc, uintptr(cx-scaleDPI(2)), uintptr(body))
	procMoveToEx.Call(hdc, uintptr(cx+cap), uintptr(collar), 0)
	procLineTo.Call(hdc, uintptr(cx+scaleDPI(2)), uintptr(body))
	procMoveToEx.Call(hdc, uintptr(cx-scaleDPI(2)), uintptr(body), 0)
	procLineTo.Call(hdc, uintptr(cx+scaleDPI(2)), uintptr(body))
	procMoveToEx.Call(hdc, uintptr(cx), uintptr(body), 0)
	procLineTo.Call(hdc, uintptr(cx), uintptr(tip))
}

func drawFloatingStateGlyph(hdc uintptr, rc rect, paused bool, color uintptr) {
	if hdc == 0 || rc.Right <= rc.Left || rc.Bottom <= rc.Top {
		return
	}
	if paused {
		width := maxInt32(scaleDPI(2), 1)
		fillSolid(hdc, rect{Left: rc.Left, Top: rc.Top, Right: rc.Left + width, Bottom: rc.Bottom}, color)
		fillSolid(hdc, rect{Left: rc.Right - width, Top: rc.Top, Right: rc.Right, Bottom: rc.Bottom}, color)
		return
	}
	mid := (rc.Top + rc.Bottom) / 2
	// A filled native polygon avoids the jagged one-pixel outline that the
	// previous miniature play marker produced at normal 100% desktop scaling.
	round12FillPolygon(hdc, []point{{X: rc.Left, Y: rc.Top}, {X: rc.Right, Y: mid}, {X: rc.Left, Y: rc.Bottom}}, color)
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

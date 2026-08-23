//go:build windows

package main

import (
	"strings"
	"syscall"
	"unsafe"
)

const (
	round12FooterSubclassID  = 0x45C4
	round12MessageSubclassID = 0x45C5
	round12MessageTimer      = 0x45C6

	round12IconPlay = iota + 1
	round12IconPause
	round12IconStop
	round12IconCheck
	round12IconUndo
	round12IconCrop
	round12IconDownload
	round12IconRetry
	round12IconEye

	round12WMNCPaint    = 0x0085
	round12WMNCActivate = 0x0086
)

var (
	round12FooterCallback  uintptr
	round12MessageCallback uintptr
	round12Polygon         = gdi32.NewProc("Polygon")
	round12GetWindowDC     = user32.NewProc("GetWindowDC")
	round12ReleaseDC       = user32.NewProc("ReleaseDC")
)

func init() {
	// application.layout is the only geometry owner of the bottom action row.
	round7FeedbackInLayout = true
	round12FooterCallback = syscall.NewCallback(round12FooterSubclassProc)
	round12MessageCallback = syscall.NewCallback(round12MessageSubclassProc)
}

func round12InstallFooterOwner(a *application) {
	if a == nil || a.hwnd == 0 || round12FooterCallback == 0 {
		return
	}
	v452RemoveSubclass.Call(a.hwnd, round12FooterCallback, round12FooterSubclassID)
	v452SetWindowSubclass.Call(a.hwnd, round12FooterCallback, round12FooterSubclassID, 0)
	if a.hStatusText != 0 {
		v452RemoveSubclass.Call(a.hStatusText, round12MessageCallback, round12MessageSubclassID)
		v452SetWindowSubclass.Call(a.hStatusText, round12MessageCallback, round12MessageSubclassID, 0)
	}
	for _, hwnd := range []uintptr{
		a.hVideo, a.hImage, a.hAddFiles, a.hAddFolder, a.hRemove, a.hClear,
		a.hSelectAll, a.hInvert, a.hSourceDir, a.hOutputDir,
		a.hStart, a.hPause, a.hStop,
		a.hTaskApply, a.hTaskDefault, a.hPreview, a.hTrimCrop, a.hSingleOutput, a.hRetry,
		a.hStatusText, a.hTimeText,
	} {
		if hwnd != 0 {
			procInvalidateRect.Call(hwnd, 0, 1)
		}
	}
}

func round12InstallFooterMessageFeedback(a *application) {
	if a == nil {
		return
	}
	if v452ImportToastWindow != 0 {
		procDestroyWindow.Call(v452ImportToastWindow)
		v452ImportToastWindow = 0
	}
}

func round12FooterSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	a := app
	if a == nil || hwnd != a.hwnd {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
	switch message {
	case round12WMNCPaint, round12WMNCActivate:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round12PaintUnifiedMenuBoundary(hwnd)
		return result
	case WM_PAINT:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		// The menu owner can restore its separator after WM_NCPAINT while the
		// client is being redrawn. Re-apply the one-pixel blend last.
		round12PaintUnifiedMenuBoundary(hwnd)
		return result
	case WM_DRAWITEM:
		if lParam != 0 {
			dis := (*drawItemStruct)(unsafe.Pointer(lParam))
			if round12DrawToolbarAction(a, dis) || round12DrawMessageBar(a, dis) || round12DrawFooterTiming(a, dis) || round12DrawFooterAction(a, dis) || round12DrawSecondarySolidAction(a, dis) {
				return 1
			}
		}
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round12FooterCallback, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

// The native menu draws a one-pixel rule at the start of the client area.
// Painting that last non-client row with the toolbar canvas makes the menu and
// command strip read as one band without replacing the native keyboard menu.
func round12PaintUnifiedMenuBoundary(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	var window, client rect
	if ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&window))); ok == 0 {
		return
	}
	if ok, _, _ := procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client))); ok == 0 {
		return
	}
	procMapWindowPoints.Call(hwnd, 0, uintptr(unsafe.Pointer(&client)), 2)
	y := client.Top - window.Top - 1
	left := client.Left - window.Left
	right := client.Right - window.Left
	if y <= 0 || right <= left {
		return
	}
	hdc, _, _ := round12GetWindowDC.Call(hwnd)
	if hdc == 0 {
		return
	}
	// Classic USER32 menus use two boundary rows on this window style: the
	// actual gray rule and one white padding row. Cover both so DPI/theme
	// changes cannot leave a one-pixel remnant.
	fillSolid(hdc, rect{Left: left, Top: y - 1, Right: right, Bottom: y + 1}, colorRef(255, 255, 255))
	round12ReleaseDC.Call(hwnd, hdc)
}

func round12MessageSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	a := app
	if a == nil || hwnd != a.hStatusText {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
	switch message {
	case v452WMSetText:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		a.messageMarquee = 0
		a.messageMarqueeSpan = 0
		a.messageMarqueeHold = 25
		procSetTimer.Call(hwnd, round12MessageTimer, 40, 0)
		procInvalidateRect.Call(hwnd, 0, 0)
		return result
	case WM_LBUTTONUP, WM_CONTEXTMENU:
		// The status bar is owner-drawn and has more than one subclass layer.
		// Handle diagnostics here as well so its promised detail action cannot
		// be lost by a later visual subclass.
		if statusDiagnosticVisible {
			messageBox(a.hwnd, "运行状态详情", statusDiagnosticFullDetail(), MB_OK|MB_ICONINFORMATION)
			return 0
		}
	case WM_TIMER:
		if wParam == round12MessageTimer {
			if a.messageMarqueeSpan <= 0 {
				procKillTimer.Call(hwnd, round12MessageTimer)
				return 0
			}
			if a.messageMarqueeHold > 0 {
				a.messageMarqueeHold--
			} else {
				a.messageMarquee -= scaleDPI(1)
				if a.messageMarquee <= -a.messageMarqueeSpan {
					a.messageMarquee = 0
					a.messageMarqueeHold = 25
				}
			}
			procInvalidateRect.Call(hwnd, 0, 0)
			return 0
		}
	case v452WMNCDestroy:
		procKillTimer.Call(hwnd, round12MessageTimer)
		v452RemoveSubclass.Call(hwnd, round12MessageCallback, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

type round12ActionPalette struct {
	badge uintptr
	glyph uintptr
	text  uintptr
}

func round12ToolbarPalette(a *application, hwnd uintptr, active, disabled bool) round12ActionPalette {
	palette := round12ActionPalette{badge: colorRef(224, 235, 249), glyph: colorRef(43, 102, 173), text: colorRef(49, 61, 77)}
	switch hwnd {
	case a.hVideo:
		palette.badge, palette.glyph = colorRef(218, 235, 255), colorRef(33, 105, 196)
	case a.hImage:
		palette.badge, palette.glyph = colorRef(216, 242, 239), colorRef(23, 126, 113)
	case a.hAddFiles:
		palette.badge, palette.glyph = colorRef(224, 231, 252), colorRef(70, 91, 185)
	case a.hAddFolder:
		palette.badge, palette.glyph = colorRef(255, 238, 205), colorRef(174, 111, 15)
	case a.hRemove:
		palette.badge, palette.glyph = colorRef(252, 228, 228), colorRef(186, 67, 63)
	case a.hClear:
		palette.badge, palette.glyph = colorRef(250, 225, 231), colorRef(177, 62, 90)
	case a.hSelectAll:
		palette.badge, palette.glyph = colorRef(220, 243, 228), colorRef(36, 132, 76)
	case a.hInvert:
		palette.badge, palette.glyph = colorRef(238, 226, 250), colorRef(119, 72, 171)
	case a.hSourceDir:
		palette.badge, palette.glyph = colorRef(217, 241, 248), colorRef(25, 119, 148)
	case a.hOutputDir:
		palette.badge, palette.glyph = colorRef(218, 234, 252), colorRef(37, 105, 181)
	}
	if active {
		palette.badge = colorRef(41, 112, 204)
		palette.glyph = colorRef(22, 96, 184)
		palette.text = colorRef(18, 78, 154)
		if hwnd == a.hImage {
			palette.badge = colorRef(25, 132, 116)
			palette.glyph = colorRef(18, 116, 101)
			palette.text = colorRef(15, 96, 84)
		}
	}
	if disabled {
		palette.badge = colorRef(235, 238, 242)
		palette.glyph = colorRef(150, 159, 171)
		palette.text = colorRef(154, 162, 173)
	}
	return palette
}

func round12DrawToolbarAction(a *application, dis *drawItemStruct) bool {
	if a == nil || dis == nil {
		return false
	}
	glyph, label, active, ok := a.toolbarButtonSpec(dis.HwndItem)
	if !ok {
		return false
	}
	disabled := dis.ItemState&ODS_DISABLED != 0
	pressed := dis.ItemState&ODS_SELECTED != 0
	hovered := a.hovered(dis.HwndItem)
	canvas := colorRef(250, 251, 253)
	fillSolid(dis.HDC, dis.RcItem, canvas)
	inner := dis.RcItem
	inner.Left += scaleDPI(2)
	inner.Top += scaleDPI(2)
	inner.Right -= scaleDPI(2)
	inner.Bottom -= scaleDPI(2)
	if active || hovered || pressed {
		background := colorRef(244, 248, 253)
		if active {
			background = colorRef(239, 246, 255)
			if dis.HwndItem == a.hImage {
				background = colorRef(237, 249, 247)
			}
		}
		if pressed && !disabled {
			background = colorRef(229, 239, 251)
		}
		withRoundedClip(dis.HDC, inner, scaleDPI(5), func() { fillSolid(dis.HDC, inner, background) })
	}
	palette := round12ToolbarPalette(a, dis.HwndItem, active && !disabled, disabled)
	if dis.RcItem.Right-dis.RcItem.Left < scaleDPI(54) {
		drawCenteredText(dis.HDC, glyph, dis.RcItem, iconFont, palette.glyph)
		return true
	}

	iconBand := rect{
		Left:   dis.RcItem.Left,
		Top:    dis.RcItem.Top + scaleDPI(3),
		Right:  dis.RcItem.Right,
		Bottom: dis.RcItem.Top + scaleDPI(35),
	}
	drawCenteredText(dis.HDC, glyph, iconBand, iconFont, palette.glyph)
	labelRC := dis.RcItem
	labelRC.Top += scaleDPI(35)
	labelRC.Bottom -= scaleDPI(3)
	round12DrawVisuallyCenteredText(dis.HDC, label, labelRC, uiFontSmall, palette.text, DT_CENTER)
	if active && !disabled {
		border := colorRef(98, 151, 213)
		if dis.HwndItem == a.hImage {
			border = colorRef(91, 172, 157)
		}
		drawRoundedBorder(dis.HDC, inner, scaleDPI(5), border)
	}
	return true
}

func round12FillPolygon(hdc uintptr, points []point, color uintptr) {
	if hdc == 0 || len(points) < 3 {
		return
	}
	brush, _, _ := procCreateSolidBrush.Call(color)
	oldBrush, _, _ := procSelectObject.Call(hdc, brush)
	nullPen, _, _ := procGetStockObject.Call(8)
	oldPen, _, _ := procSelectObject.Call(hdc, nullPen)
	round12Polygon.Call(hdc, uintptr(unsafe.Pointer(&points[0])), uintptr(len(points)))
	if oldPen != 0 {
		procSelectObject.Call(hdc, oldPen)
	}
	if oldBrush != 0 {
		procSelectObject.Call(hdc, oldBrush)
	}
	procDeleteObject.Call(brush)
}

func round12DrawSolidIcon(hdc uintptr, kind int, rc rect, color uintptr) {
	if hdc == 0 || rc.Right <= rc.Left || rc.Bottom <= rc.Top {
		return
	}
	cx := (rc.Left + rc.Right) / 2
	cy := (rc.Top + rc.Bottom) / 2
	u := scaleDPI(1)
	if u < 1 {
		u = 1
	}
	fill := func(left, top, right, bottom int32) {
		fillSolid(hdc, rect{Left: left, Top: top, Right: right, Bottom: bottom}, color)
	}

	switch kind {
	case round12IconPlay:
		round12FillPolygon(hdc, []point{
			{X: cx - 4*u, Y: cy - 6*u},
			{X: cx - 4*u, Y: cy + 6*u},
			{X: cx + 6*u, Y: cy},
		}, color)
	case round12IconPause:
		fill(cx-5*u, cy-6*u, cx-1*u, cy+6*u)
		fill(cx+2*u, cy-6*u, cx+6*u, cy+6*u)
	case round12IconStop:
		fill(cx-5*u, cy-5*u, cx+5*u, cy+5*u)
	case round12IconCheck:
		round12FillPolygon(hdc, []point{
			{X: cx - 7*u, Y: cy - 1*u},
			{X: cx - 4*u, Y: cy - 4*u},
			{X: cx - 1*u, Y: cy + 1*u},
			{X: cx + 6*u, Y: cy - 7*u},
			{X: cx + 8*u, Y: cy - 4*u},
			{X: cx - 1*u, Y: cy + 6*u},
		}, color)
	case round12IconUndo:
		fill(cx-3*u, cy-3*u, cx+7*u, cy+1*u)
		fill(cx+4*u, cy-3*u, cx+8*u, cy+6*u)
		round12FillPolygon(hdc, []point{
			{X: cx - 8*u, Y: cy - 2*u},
			{X: cx - 2*u, Y: cy - 7*u},
			{X: cx - 2*u, Y: cy + 3*u},
		}, color)
	case round12IconCrop:
		fill(cx-7*u, cy-7*u, cx-4*u, cy+4*u)
		fill(cx-7*u, cy-7*u, cx+4*u, cy-4*u)
		fill(cx+4*u, cy-4*u, cx+7*u, cy+7*u)
		fill(cx-4*u, cy+4*u, cx+7*u, cy+7*u)
	case round12IconDownload:
		fill(cx-2*u, cy-7*u, cx+2*u, cy+2*u)
		round12FillPolygon(hdc, []point{
			{X: cx - 6*u, Y: cy},
			{X: cx + 6*u, Y: cy},
			{X: cx, Y: cy + 6*u},
		}, color)
		fill(cx-7*u, cy+7*u, cx+7*u, cy+10*u)
	case round12IconRetry:
		fill(cx-5*u, cy-6*u, cx+6*u, cy-3*u)
		fill(cx+3*u, cy-6*u, cx+6*u, cy+4*u)
		fill(cx-5*u, cy+3*u, cx+5*u, cy+6*u)
		round12FillPolygon(hdc, []point{
			{X: cx - 8*u, Y: cy - 5*u},
			{X: cx - 2*u, Y: cy - 9*u},
			{X: cx - 2*u, Y: cy - 1*u},
		}, color)
	}
}

func round12DrawSolidActionContent(hdc uintptr, label string, iconKind int, rc rect, font, textColor, background uintptr) {
	if hdc == 0 || rc.Right <= rc.Left || rc.Bottom <= rc.Top {
		return
	}
	labelWidth := measureSingleLineWidth(hdc, label, font)
	available := rc.Right - rc.Left
	if iconKind == 0 || labelWidth <= 0 {
		round12DrawVisuallyCenteredText(hdc, label, rc, font, textColor, DT_CENTER)
		return
	}

	iconWidth := scaleDPI(16)
	gap := scaleDPI(5)
	if iconWidth+gap+labelWidth > available {
		iconWidth = scaleDPI(14)
		gap = scaleDPI(3)
	}
	if iconWidth+gap+labelWidth > available {
		round12DrawVisuallyCenteredText(hdc, label, rc, font, textColor, DT_CENTER)
		return
	}

	total := iconWidth + gap + labelWidth
	left := rc.Left + (available-total)/2
	iconRC := rect{Left: left, Top: rc.Top, Right: left + iconWidth, Bottom: rc.Bottom}
	textRC := rect{Left: iconRC.Right + gap, Top: rc.Top, Right: iconRC.Right + gap + labelWidth, Bottom: rc.Bottom}
	if iconKind != round12IconPlay && iconKind != round12IconPause && iconKind != round12IconStop {
		round12DrawVisuallyCenteredText(hdc, label, rc, font, textColor, DT_CENTER)
		return
	}
	round12DrawSolidFooterGlyph(hdc, iconKind, iconRC, textColor, background)
	round12DrawVisuallyCenteredText(hdc, label, textRC, font, textColor, DT_CENTER)
}

func round12DrawSolidFooterGlyph(hdc uintptr, kind int, rc rect, foreground, background uintptr) {
	glyph := round12GlyphPlay
	switch kind {
	case round12IconPause:
		glyph = round12GlyphPause
	case round12IconStop:
		glyph = round12GlyphSquare
	}
	size := int(scaleDPI(15))
	maxSize := int(rc.Bottom - rc.Top - scaleDPI(4))
	if size > maxSize {
		size = maxSize
	}
	if size < 9 {
		size = 9
	}
	x := int(rc.Left) + (int(rc.Right-rc.Left)-size)/2
	y := int(rc.Top) + (int(rc.Bottom-rc.Top)-size)/2
	round12DrawAAGlyph(hdc, x, y, size, glyph, foreground, background)
}

func round12FooterIconKind(a *application, hwnd uintptr) int {
	if a == nil {
		return 0
	}
	switch hwnd {
	case a.hStart:
		return round12IconPlay
	case a.hPause:
		label := getText(hwnd)
		if strings.Contains(label, "继续") || strings.Contains(label, "恢复") {
			return round12IconPlay
		}
		return round12IconPause
	case a.hStop:
		return round12IconStop
	default:
		return 0
	}
}

func round12SecondaryIconKind(a *application, hwnd uintptr) int {
	if a == nil {
		return 0
	}
	switch hwnd {
	case a.hTaskApply:
		return round12IconCheck
	case a.hTaskDefault:
		return round12IconUndo
	case a.hPreview:
		return round12IconEye
	case a.hTrimCrop:
		return round12IconCrop
	case a.hSingleOutput:
		return round12IconPlay
	case a.hRetry:
		return round12IconRetry
	default:
		return 0
	}
}

func round12DrawFooterAction(a *application, dis *drawItemStruct) bool {
	if a == nil || dis == nil || (dis.HwndItem != a.hStart && dis.HwndItem != a.hPause && dis.HwndItem != a.hStop) {
		return false
	}
	pressed := dis.ItemState&ODS_SELECTED != 0
	disabled := dis.ItemState&ODS_DISABLED != 0
	hovered := a.hovered(dis.HwndItem)

	bg, border := colorRef(31, 111, 213), colorRef(23, 96, 190)
	if dis.HwndItem == a.hPause {
		label := getText(dis.HwndItem)
		if strings.Contains(label, "继续") || strings.Contains(label, "恢复") {
			// Paused state: show blue background & play icon for 'Continue' action
			bg, border = colorRef(31, 111, 213), colorRef(23, 96, 190)
		} else {
			// Active running state: show amber background for 'Pause' action
			bg, border = colorRef(218, 143, 28), colorRef(191, 119, 18)
		}
	} else if dis.HwndItem == a.hStop {
		bg, border = colorRef(202, 73, 67), colorRef(176, 57, 52)
	}
	textColor := colorRef(255, 255, 255)
	if hovered && !disabled {
		bg = mixColor(bg, colorRef(255, 255, 255), .10)
		border = mixColor(border, colorRef(255, 255, 255), .06)
	}
	if pressed && !disabled {
		bg = mixColor(bg, colorRef(0, 0, 0), .13)
		border = bg
	}
	if disabled {
		bg = colorRef(235, 238, 243)
		border = colorRef(196, 203, 213)
		textColor = colorRef(126, 136, 149)
	}

	rc := dis.RcItem
	fillSolid(dis.HDC, rc, colorRef(250, 251, 253))
	inner := rect{Left: rc.Left + 2, Top: rc.Top + 2, Right: rc.Right - 2, Bottom: rc.Bottom - 2}
	brush, _, _ := procCreateSolidBrush.Call(bg)
	pen, _, _ := procCreatePen.Call(PS_SOLID, 1, border)
	oldBrush, _, _ := procSelectObject.Call(dis.HDC, brush)
	oldPen, _, _ := procSelectObject.Call(dis.HDC, pen)
	procRoundRect.Call(dis.HDC, uintptr(inner.Left), uintptr(inner.Top), uintptr(inner.Right), uintptr(inner.Bottom), 6, 6)
	procSelectObject.Call(dis.HDC, oldBrush)
	procSelectObject.Call(dis.HDC, oldPen)
	procDeleteObject.Call(brush)
	procDeleteObject.Call(pen)

	content := inner
	content.Left += scaleDPI(7)
	content.Right -= scaleDPI(7)
	label := getText(dis.HwndItem)
	round12DrawSolidActionContent(dis.HDC, label, round12FooterIconKind(a, dis.HwndItem), content, uiFontSmall, textColor, bg)
	return true
}

func round12DrawMessageBar(a *application, dis *drawItemStruct) bool {
	if a == nil || dis == nil || dis.HwndItem != a.hStatusText {
		return false
	}
	rc := dis.RcItem
	fillSolid(dis.HDC, rc, colorRef(250, 251, 253))
	inner := rect{Left: rc.Left + scaleDPI(2), Top: rc.Top + scaleDPI(3), Right: rc.Right - scaleDPI(2), Bottom: rc.Bottom - scaleDPI(3)}
	iconRC := rect{Left: inner.Left + scaleDPI(5), Top: inner.Top, Right: inner.Left + scaleDPI(31), Bottom: inner.Bottom}
	drawCenteredText(dis.HDC, "\uE767", iconRC, iconFont, colorRef(36, 108, 190))
	textRC := inner
	textRC.Left = iconRC.Right + scaleDPI(6)
	textRC.Right -= scaleDPI(10)
	text := getText(dis.HwndItem)
	textWidth := measureSingleLineWidth(dis.HDC, text, uiFontSmall)
	available := textRC.Right - textRC.Left
	if textWidth <= available {
		a.messageMarquee = 0
		a.messageMarqueeSpan = 0
		procKillTimer.Call(dis.HwndItem, round12MessageTimer)
		round12DrawVisuallyCenteredText(dis.HDC, text, textRC, uiFontSmall, colorRef(70, 86, 106), DT_LEFT)
		return true
	}
	gap := scaleDPI(48)
	a.messageMarqueeSpan = textWidth + gap
	procSetTimer.Call(dis.HwndItem, round12MessageTimer, 40, 0)
	round12WithClip(dis.HDC, textRC, func() {
		first := textRC
		first.Left += a.messageMarquee
		first.Right = first.Left + textWidth + 2
		round12DrawVisuallyCenteredText(dis.HDC, text, first, uiFontSmall, colorRef(70, 86, 106), DT_LEFT)
		second := first
		second.Left += a.messageMarqueeSpan
		second.Right += a.messageMarqueeSpan
		round12DrawVisuallyCenteredText(dis.HDC, text, second, uiFontSmall, colorRef(70, 86, 106), DT_LEFT)
	})
	return true
}

func round12DrawFooterTiming(a *application, dis *drawItemStruct) bool {
	if a == nil || dis == nil || dis.HwndItem != a.hTimeText {
		return false
	}
	fillSolid(dis.HDC, dis.RcItem, colorRef(250, 251, 253))
	mid := (dis.RcItem.Left + dis.RcItem.Right) / 2
	left := rect{Left: dis.RcItem.Left, Top: dis.RcItem.Top, Right: mid - scaleDPI(4), Bottom: dis.RcItem.Bottom}
	right := rect{Left: mid + scaleDPI(4), Top: dis.RcItem.Top, Right: dis.RcItem.Right, Bottom: dis.RcItem.Bottom}
	round12DrawTimingPair(dis.HDC, left, "已耗时", a.footerElapsedText)
	round12DrawTimingPair(dis.HDC, right, "预计剩余", a.footerRemainingText)
	return true
}

func round12DrawTimingPair(hdc uintptr, rc rect, label, value string) {
	labelWidth := measureSingleLineWidth(hdc, label, uiFontProgress)
	valueWidth := measureSingleLineWidth(hdc, value, uiFontProgress)
	gap := scaleDPI(5)
	total := labelWidth + gap + valueWidth
	left := rc.Left + (rc.Right-rc.Left-total)/2
	labelRC := rect{Left: left, Top: rc.Top, Right: left + labelWidth, Bottom: rc.Bottom}
	valueRC := rect{Left: labelRC.Right + gap, Top: rc.Top, Right: labelRC.Right + gap + valueWidth, Bottom: rc.Bottom}
	round12DrawVisuallyCenteredText(hdc, label, labelRC, uiFontProgress, colorRef(123, 135, 150), DT_LEFT)
	round12DrawVisuallyCenteredText(hdc, value, valueRC, uiFontProgress, colorRef(49, 79, 116), DT_LEFT)
}

func round12SecondaryPalette(a *application, hwnd uintptr, disabled bool) round12ActionPalette {
	palette := round12ActionPalette{badge: colorRef(221, 235, 250), glyph: colorRef(43, 104, 177), text: colorRef(45, 59, 77)}
	switch hwnd {
	case a.hTaskApply:
		palette.badge, palette.glyph = colorRef(220, 243, 228), colorRef(35, 132, 76)
	case a.hTaskDefault:
		palette.badge, palette.glyph = colorRef(232, 237, 244), colorRef(83, 102, 127)
	case a.hPreview:
		palette.badge, palette.glyph = colorRef(222, 233, 252), colorRef(61, 91, 181)
	case a.hTrimCrop:
		palette.badge, palette.glyph = colorRef(239, 227, 250), colorRef(119, 71, 168)
	case a.hSingleOutput:
		palette.badge, palette.glyph = colorRef(217, 235, 255), colorRef(32, 105, 196)
	case a.hRetry:
		palette.badge, palette.glyph = colorRef(255, 237, 209), colorRef(175, 105, 13)
	}
	if disabled {
		palette.badge = colorRef(236, 239, 243)
		palette.glyph = colorRef(151, 160, 171)
		palette.text = colorRef(151, 160, 171)
	}
	return palette
}

func round12DrawSecondaryBadgeContent(hdc uintptr, label, glyph string, rc rect, font uintptr, palette round12ActionPalette, background uintptr) {
	if hdc == 0 || rc.Right <= rc.Left || rc.Bottom <= rc.Top {
		return
	}
	labelWidth := measureSingleLineWidth(hdc, label, font)
	gap := scaleDPI(5)
	available := rc.Right - rc.Left
	iconSize := scaleDPI(22)
	if iconSize+gap+labelWidth > available {
		iconSize = scaleDPI(18)
		gap = scaleDPI(3)
	}
	if glyph == "" || iconSize+gap+labelWidth > available {
		round12DrawVisuallyCenteredText(hdc, label, rc, font, palette.text, DT_CENTER)
		return
	}
	total := iconSize + gap + labelWidth
	left := rc.Left + (available-total)/2
	iconRC := rect{Left: left, Top: rc.Top + (rc.Bottom-rc.Top-iconSize)/2, Right: left + iconSize, Bottom: rc.Top + (rc.Bottom-rc.Top+iconSize)/2}
	drawCenteredText(hdc, glyph, iconRC, iconFont, palette.glyph)
	textRC := rect{Left: iconRC.Right + gap, Top: rc.Top, Right: iconRC.Right + gap + labelWidth, Bottom: rc.Bottom}
	round12DrawVisuallyCenteredText(hdc, label, textRC, font, palette.text, DT_CENTER)
}

func round12DrawSecondarySolidAction(a *application, dis *drawItemStruct) bool {
	if a == nil || dis == nil {
		return false
	}
	iconKind := round12SecondaryIconKind(a, dis.HwndItem)
	if iconKind == 0 {
		return false
	}
	pressed := dis.ItemState&ODS_SELECTED != 0
	disabled := dis.ItemState&ODS_DISABLED != 0
	hovered := a.hovered(dis.HwndItem)

	bg := colorRef(250, 251, 253)
	border := colorRef(221, 227, 234)
	if hovered && !disabled {
		bg = colorRef(242, 247, 253)
		border = colorRef(195, 209, 225)
	}
	if pressed && !disabled {
		bg = colorRef(231, 240, 251)
		border = colorRef(176, 197, 221)
	}
	if disabled {
		bg = colorRef(247, 248, 250)
		border = colorRef(229, 233, 238)
	}

	rc := dis.RcItem
	fillSolid(dis.HDC, rc, colorRef(250, 251, 253))
	inner := rect{Left: rc.Left + 1, Top: rc.Top + 1, Right: rc.Right - 1, Bottom: rc.Bottom - 1}
	brush, _, _ := procCreateSolidBrush.Call(bg)
	pen, _, _ := procCreatePen.Call(PS_SOLID, 1, border)
	oldBrush, _, _ := procSelectObject.Call(dis.HDC, brush)
	oldPen, _, _ := procSelectObject.Call(dis.HDC, pen)
	radius := scaleDPI(4)
	procRoundRect.Call(dis.HDC, uintptr(inner.Left), uintptr(inner.Top), uintptr(inner.Right), uintptr(inner.Bottom), uintptr(radius), uintptr(radius))
	procSelectObject.Call(dis.HDC, oldBrush)
	procSelectObject.Call(dis.HDC, oldPen)
	procDeleteObject.Call(brush)
	procDeleteObject.Call(pen)

	content := inner
	content.Left += scaleDPI(5)
	content.Right -= scaleDPI(5)
	glyph := secondaryButtonGlyph(dis.HwndItem)
	palette := round12SecondaryPalette(a, dis.HwndItem, disabled)
	round12DrawSecondaryBadgeContent(dis.HDC, getText(dis.HwndItem), glyph, content, uiFontSmall, palette, bg)
	return true
}

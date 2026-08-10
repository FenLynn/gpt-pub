//go:build windows

package main

import (
	"syscall"
	"time"
	"unsafe"
)

const (
	round12FooterSubclassID = 0x45C4

	round12IconPlay = iota + 1
	round12IconPause
	round12IconStop
	round12IconCheck
	round12IconUndo
	round12IconCrop
	round12IconDownload
	round12IconRetry
)

var (
	round12FooterCallback uintptr
	round12Polygon        = gdi32.NewProc("Polygon")
)

func init() {
	// application.layout is the only geometry owner of the bottom action row.
	round7FeedbackInLayout = true
	round12FooterCallback = syscall.NewCallback(round12FooterSubclassProc)
	go func() {
		for attempt := 0; attempt < 800; attempt++ {
			a := app
			if a != nil && a.hwnd != 0 && a.controlsReady && round12SelectionInstalled.Load() {
				a.postUI(func() {
					v452RemoveSubclass.Call(a.hwnd, round12FooterCallback, round12FooterSubclassID)
					v452SetWindowSubclass.Call(a.hwnd, round12FooterCallback, round12FooterSubclassID, 0)
					for _, hwnd := range []uintptr{
						a.hStart, a.hPause, a.hStop,
						a.hTaskApply, a.hTaskDefault, a.hPreview, a.hTrimCrop, a.hSingleOutput, a.hRetry,
					} {
						procInvalidateRect.Call(hwnd, 0, 1)
					}
				})
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
}

func round12FooterSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	a := app
	if a == nil || hwnd != a.hwnd {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
	switch message {
	case WM_DRAWITEM:
		if lParam != 0 {
			dis := (*drawItemStruct)(unsafe.Pointer(lParam))
			if round12DrawFooterAction(a, dis) || round12DrawSecondarySolidAction(a, dis) {
				return 1
			}
		}
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round12FooterCallback, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
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

func round12DrawSolidActionContent(hdc uintptr, label string, iconKind int, rc rect, font, textColor uintptr) {
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
	round12DrawSolidIcon(hdc, iconKind, iconRC, textColor)
	round12DrawVisuallyCenteredText(hdc, label, textRC, font, textColor, DT_CENTER)
}

func round12FooterIconKind(a *application, hwnd uintptr) int {
	if a == nil {
		return 0
	}
	switch hwnd {
	case a.hStart:
		return round12IconPlay
	case a.hPause:
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
		return round12IconPlay
	case a.hTrimCrop:
		return round12IconCrop
	case a.hSingleOutput:
		return round12IconDownload
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
		bg, border = colorRef(218, 143, 28), colorRef(191, 119, 18)
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
	round12DrawSolidActionContent(dis.HDC, label, round12FooterIconKind(a, dis.HwndItem), content, uiFontSmall, textColor)
	return true
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
	textColor := colorRef(45, 59, 77)
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
		textColor = colorRef(151, 160, 171)
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
	// The six right-panel actions now use the same scalable Segoe MDL2 vector
	// glyph path as the crisp top toolbar instead of integer-pixel GDI polygons.
	// This keeps their icon edges anti-aliased and DPI-stable while preserving
	// the existing button surfaces and labels.
	glyph := secondaryButtonGlyph(dis.HwndItem)
	round12DrawPolishedButtonContent(dis.HDC, getText(dis.HwndItem), glyph, content, uiFontSmall, textColor)
	return true
}

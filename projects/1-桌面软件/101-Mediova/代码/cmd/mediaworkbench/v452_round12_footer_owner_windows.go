//go:build windows

package main

import (
	"syscall"
	"time"
	"unsafe"
)

const round12FooterSubclassID = 0x45C4

var round12FooterCallback uintptr

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
					for _, hwnd := range []uintptr{a.hStart, a.hPause, a.hStop} {
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
		if lParam != 0 && round12DrawFooterAction(a, (*drawItemStruct)(unsafe.Pointer(lParam))) {
			return 1
		}
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round12FooterCallback, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round12FooterGlyph(a *application, hwnd uintptr) string {
	if a == nil {
		return ""
	}
	switch hwnd {
	case a.hStart:
		return "▶"
	case a.hPause:
		return "Ⅱ"
	case a.hStop:
		return "■"
	default:
		return ""
	}
}

// round12DrawSolidFooterContent keeps the Round12 text-priority contract but
// renders footer actions with filled TrueType symbols instead of MDL2 outline
// glyphs. The symbols scale through the normal UI font pipeline, so their
// interiors stay solid and their edges remain anti-aliased at high DPI.
func round12DrawSolidFooterContent(hdc uintptr, label, glyph string, rc rect, font, textColor uintptr) {
	if hdc == 0 || rc.Right <= rc.Left || rc.Bottom <= rc.Top {
		return
	}
	labelWidth := measureSingleLineWidth(hdc, label, font)
	available := rc.Right - rc.Left
	if glyph == "" || labelWidth <= 0 {
		round12DrawVisuallyCenteredText(hdc, label, rc, font, textColor, DT_CENTER)
		return
	}

	iconWidth := scaleDPI(15)
	gap := scaleDPI(4)
	if iconWidth+gap+labelWidth > available {
		iconWidth = scaleDPI(13)
		gap = scaleDPI(2)
	}
	if iconWidth+gap+labelWidth > available {
		round12DrawVisuallyCenteredText(hdc, label, rc, font, textColor, DT_CENTER)
		return
	}

	total := iconWidth + gap + labelWidth
	left := rc.Left + (available-total)/2
	iconRC := rect{Left: left, Top: rc.Top, Right: left + iconWidth, Bottom: rc.Bottom}
	textRC := rect{Left: iconRC.Right + gap, Top: rc.Top, Right: iconRC.Right + gap + labelWidth, Bottom: rc.Bottom}
	round12DrawVisuallyCenteredText(hdc, glyph, iconRC, uiFontBold, textColor, DT_CENTER)
	round12DrawVisuallyCenteredText(hdc, label, textRC, font, textColor, DT_CENTER)
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
	round12DrawSolidFooterContent(dis.HDC, label, round12FooterGlyph(a, dis.HwndItem), content, uiFontSmall, textColor)
	return true
}

//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

const (
	round12EditorPolishSubclassID = 0x45C8
	round12SWPFrameChanged        = 0x0020
)

var (
	round12EditorPolishCallback uintptr
	round12GetWindowLongPtrW    = user32.NewProc("GetWindowLongPtrW")
	round12SetWindowLongPtrW    = user32.NewProc("SetWindowLongPtrW")
)

func init() {
	round12EditorPolishCallback = syscall.NewCallback(round12EditorPolishSubclassProc)
}

// round12DrawVisuallyCenteredText centers by the measured single-line glyph
// box instead of trusting a control-specific baseline. Native buttons already
// center their text; all Round12 owner-drawn buttons use this helper so their
// labels share the same optical vertical center at every supported DPI.
func round12DrawVisuallyCenteredText(hdc uintptr, text string, rc rect, font, color, align uintptr) {
	if hdc == 0 || rc.Right <= rc.Left || rc.Bottom <= rc.Top {
		return
	}
	old, _, _ := procSelectObject.Call(hdc, font)
	procSetBkMode.Call(hdc, TRANSPARENT)
	procSetTextColor.Call(hdc, color)

	measure := rect{Left: 0, Top: 0, Right: scaleDPI(2000), Bottom: 0}
	procDrawTextW.Call(
		hdc,
		uintptr(unsafe.Pointer(p(text))),
		^uintptr(0),
		uintptr(unsafe.Pointer(&measure)),
		DT_CALCRECT|DT_SINGLELINE,
	)
	textH := measure.Bottom - measure.Top
	if textH <= 0 || textH > rc.Bottom-rc.Top {
		textH = rc.Bottom - rc.Top
	}
	textRC := rc
	textRC.Top = rc.Top + (rc.Bottom-rc.Top-textH)/2
	textRC.Bottom = textRC.Top + textH
	procDrawTextW.Call(
		hdc,
		uintptr(unsafe.Pointer(p(text))),
		^uintptr(0),
		uintptr(unsafe.Pointer(&textRC)),
		align|DT_VCENTER|DT_SINGLELINE,
	)
	if old != 0 {
		procSelectObject.Call(hdc, old)
	}
}

// round12DrawPolishedButtonContent gives text absolute priority over decoration.
// The caller has already supplied the desired visual padding in rc; do not add
// a second hidden padding layer here. If an icon cannot coexist with the full
// label, first compact the icon/gap and finally drop the icon rather than ever
// clipping or squeezing the label. This is especially important for the 90 px
// footer and ±1 second/frame controls.
func round12DrawPolishedButtonContent(hdc uintptr, label, glyph string, rc rect, font, textColor uintptr) {
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
		// Readability wins. A crisp icon is useful only when it does not steal
		// pixels from the complete action label.
		round12DrawVisuallyCenteredText(hdc, label, rc, font, textColor, DT_CENTER)
		return
	}

	total := iconWidth + gap + labelWidth
	left := rc.Left + (available-total)/2
	iconRC := rect{Left: left, Top: rc.Top, Right: left + iconWidth, Bottom: rc.Bottom}
	textRC := rect{Left: iconRC.Right + gap, Top: rc.Top, Right: iconRC.Right + gap + labelWidth, Bottom: rc.Bottom}
	// Segoe MDL2 Assets is a scalable Windows vector-outline font. It is the
	// same icon source used by the main toolbar and remains crisp at 100%-175%.
	drawCenteredText(hdc, glyph, iconRC, iconFont, textColor)
	round12DrawVisuallyCenteredText(hdc, label, textRC, font, textColor, DT_CENTER)
}

func round12SetOwnerDrawButton(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	style, _, _ := round12GetWindowLongPtrW.Call(hwnd, ^uintptr(15))
	newStyle := (style &^ uintptr(0x0F)) | BS_OWNERDRAW
	if newStyle != style {
		round12SetWindowLongPtrW.Call(hwnd, ^uintptr(15), newStyle)
		procSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0, SWP_NOMOVE|SWP_NOSIZE|SWP_NOZORDER|SWP_NOACTIVATE|round12SWPFrameChanged)
	}
	procInvalidateRect.Call(hwnd, 0, 1)
}

func round12InstallEditorPolish(e *round7Editor) {
	if e == nil || e.hwnd == 0 {
		return
	}
	v452RemoveSubclass.Call(e.hwnd, round12EditorPolishCallback, round12EditorPolishSubclassID)
	v452SetWindowSubclass.Call(e.hwnd, round12EditorPolishCallback, round12EditorPolishSubclassID, 0)

	for _, hwnd := range []uintptr{
		e.hJump,
		e.hSeekMinusSec, e.hSeekMinusFrame, e.hSeekPlusFrame, e.hSeekPlusSec,
		e.hPreview,
		e.hApplySelected, e.hApplyCurrent, e.hCancel,
	} {
		round12SetOwnerDrawButton(hwnd)
	}
}

func round12EditorPolishSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	e := round7ActiveEditor
	if e == nil || hwnd != e.hwnd {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
	switch message {
	case WM_DRAWITEM:
		if lParam != 0 && round12DrawEditorButton(e, (*drawItemStruct)(unsafe.Pointer(lParam))) {
			return 1
		}
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round12EditorPolishCallback, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round12EditorButtonGlyph(e *round7Editor, hwnd uintptr) (glyph string, primary bool, ok bool) {
	if e == nil || hwnd == 0 {
		return "", false, false
	}
	switch hwnd {
	case e.hJump:
		return "\uE72A", false, true // Forward
	case e.hSeekMinusSec, e.hSeekMinusFrame:
		return "\uE76B", false, true // ChevronLeft
	case e.hSeekPlusFrame, e.hSeekPlusSec:
		return "\uE76C", false, true // ChevronRight
	case e.hPreview:
		return "\uE768", false, true // Play
	case e.hApplySelected:
		return "\uE73E", false, true // Accept
	case e.hApplyCurrent:
		return "\uE73E", true, true // Accept
	case e.hCancel:
		return "\uE711", false, true // Cancel
	default:
		return "", false, false
	}
}

func round12DrawEditorButton(e *round7Editor, dis *drawItemStruct) bool {
	if e == nil || dis == nil {
		return false
	}
	glyph, primary, ok := round12EditorButtonGlyph(e, dis.HwndItem)
	if !ok {
		return false
	}
	pressed := dis.ItemState&ODS_SELECTED != 0
	disabled := dis.ItemState&ODS_DISABLED != 0

	bg := colorRef(250, 251, 253)
	border := colorRef(199, 207, 217)
	textColor := colorRef(47, 60, 76)
	if primary {
		bg = colorRef(49, 116, 207)
		border = colorRef(39, 101, 188)
		textColor = colorRef(255, 255, 255)
	}
	if pressed && !disabled {
		if primary {
			bg = colorRef(39, 96, 177)
			border = bg
		} else {
			bg = colorRef(234, 239, 246)
			border = colorRef(177, 190, 205)
		}
	}
	if disabled {
		bg = colorRef(239, 242, 246)
		border = colorRef(210, 216, 224)
		textColor = colorRef(143, 152, 164)
	}

	rc := dis.RcItem
	fillSolid(dis.HDC, rc, colorRef(250, 251, 253))
	inner := rect{Left: rc.Left + scaleDPI(1), Top: rc.Top + scaleDPI(1), Right: rc.Right - scaleDPI(1), Bottom: rc.Bottom - scaleDPI(1)}
	brush, _, _ := procCreateSolidBrush.Call(bg)
	pen, _, _ := procCreatePen.Call(PS_SOLID, 1, border)
	oldBrush, _, _ := procSelectObject.Call(dis.HDC, brush)
	oldPen, _, _ := procSelectObject.Call(dis.HDC, pen)
	radius := scaleDPI(5)
	procRoundRect.Call(dis.HDC, uintptr(inner.Left), uintptr(inner.Top), uintptr(inner.Right), uintptr(inner.Bottom), uintptr(radius), uintptr(radius))
	procSelectObject.Call(dis.HDC, oldBrush)
	procSelectObject.Call(dis.HDC, oldPen)
	procDeleteObject.Call(brush)
	procDeleteObject.Call(pen)

	content := inner
	content.Left += scaleDPI(4)
	content.Right -= scaleDPI(4)
	label := getText(dis.HwndItem)
	round12DrawPolishedButtonContent(dis.HDC, label, glyph, content, uiFontSmall, textColor)
	return true
}

//go:build windows

package main

import "unsafe"

var (
	round12SaveDC            = gdi32.NewProc("SaveDC")
	round12RestoreDC         = gdi32.NewProc("RestoreDC")
	round12IntersectClipRect = gdi32.NewProc("IntersectClipRect")
)

var round12HeaderBottomSeparator = colorRef(194, 203, 214)

// round12VisibleCellBounds is the single geometry source for final task-list
// painting. Win32 ListView subitem 0 is special: with a small-image list its
// reported left edge can begin at the icon/text inset instead of the physical
// first-column edge. Hidden columns can also continue to receive NM_CUSTOMDRAW
// notifications. Resolve both here so the paint path never guesses from
// NMCD.Rc and never leaves a narrow native strip visible inside the # column.
func round12VisibleCellBounds(a *application, row, column int) (rect, bool) {
	if a == nil || a.hList == 0 || row < 0 || column < 0 || column >= round12ColumnCount {
		return rect{}, false
	}
	width := int32(send(a.hList, LVM_GETCOLUMNWIDTH, uintptr(column), 0))
	if width <= 0 {
		return rect{}, false
	}

	cell, ok := listSubItemBounds(a.hList, row, column)
	if !ok {
		return rect{}, false
	}
	rowBounds := rect{Left: LVIR_BOUNDS}
	if send(a.hList, LVM_GETITEMRECT, uintptr(row), uintptr(unsafe.Pointer(&rowBounds))) != 0 {
		cell.Top = rowBounds.Top
		cell.Bottom = rowBounds.Bottom
	}
	if column == round12ColNumber {
		// LVM_GETSUBITEMRECT for subitem zero can begin after the native image
		// inset. The physical first column always begins at the report-view
		// origin, so derive that edge from LVM_GETORIGIN instead. This keeps the
		// whole # cell under one custom-draw owner at every horizontal offset.
		var origin point
		if send(a.hList, round9FeedbackLVMGetOrigin, 0, uintptr(unsafe.Pointer(&origin))) != 0 {
			cell.Left = -origin.X
		} else {
			cell.Left = 0
		}
	}
	// Use the actual current width for every physical column. This is mandatory
	// for column 0 and also prevents a stale pre-hide rectangle from painting a
	// zero-width column into its neighbour.
	cell.Right = cell.Left + width
	if cell.Right <= cell.Left || cell.Bottom <= cell.Top {
		return rect{}, false
	}
	return cell, true
}

func round12WithClip(hdc uintptr, clip rect, draw func()) {
	if hdc == 0 || draw == nil || clip.Right <= clip.Left || clip.Bottom <= clip.Top {
		return
	}
	saved, _, _ := round12SaveDC.Call(hdc)
	round12IntersectClipRect.Call(hdc, uintptr(clip.Left), uintptr(clip.Top), uintptr(clip.Right), uintptr(clip.Bottom))
	draw()
	if saved != 0 {
		round12RestoreDC.Call(hdc, saved)
	}
}

func round12PaintHeaderBottomLine(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	hdc, _, _ := round7ListGetDC.Call(hwnd)
	if hdc == 0 {
		return
	}
	defer round7ListReleaseDC.Call(hwnd, hdc)
	var rc rect
	if ok, _, _ := procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc))); ok == 0 || rc.Bottom <= rc.Top || rc.Right <= rc.Left {
		return
	}
	fillSolid(hdc, rect{Left: rc.Left, Top: rc.Bottom - 1, Right: rc.Right, Bottom: rc.Bottom}, round12HeaderBottomSeparator)
}

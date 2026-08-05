//go:build windows

package main

import (
	"path/filepath"
	"strconv"
	"unsafe"
)

const (
	round7LVMGetColumnWidth = 0x101D
	round7WMPrint           = 0x0317
	round7WMPrintClient     = 0x0318
)

var (
	round7ListGetDC      = user32.NewProc("GetDC")
	round7ListReleaseDC  = user32.NewProc("ReleaseDC")
	round7ImageListDraw  = comctl32.NewProc("ImageList_Draw")
	round7ImageListCount = comctl32.NewProc("ImageList_GetImageCount")
)

// round7DrawListOverlay is deliberately paint-only. Installation, scrolling,
// hover timing and lifetime are owned by round7FeedbackListSubclassProc so the
// ListView no longer has two competing subclasses that repaint the same area.
func round7DrawListOverlay(a *application, hdc uintptr) {
	if a == nil || a.hList == 0 || hdc == 0 {
		return
	}
	var client rect
	procGetClientRect.Call(a.hList, uintptr(unsafe.Pointer(&client)))
	count := int(send(a.hList, LVM_GETITEMCOUNT, 0, 0))
	numberWidth := int32(send(a.hList, round7LVMGetColumnWidth, uintptr(taskColNumber), 0))
	if numberWidth <= 0 {
		numberWidth = scaleDPI(48)
	}
	imageCount := 0
	if a.hImageList != 0 {
		raw, _, _ := round7ImageListCount.Call(a.hImageList)
		imageCount = int(raw)
	}
	for row := 0; row < count; row++ {
		fileCell, ok := listSubItemBounds(a.hList, row, taskColFile)
		if !ok || fileCell.Bottom < client.Top || fileCell.Top > client.Bottom {
			continue
		}
		task, ok := a.visibleTaskSnapshot(row)
		if !ok {
			continue
		}
		selected := listItemSelected(a.hList, row)
		focus, _, _ := procGetFocus.Call()
		activeSelection := selected && focus == a.hList
		background := colorRef(255, 255, 255)
		textColor := colorRef(52, 61, 74)
		if selected {
			background = colorRef(235, 244, 254)
			if activeSelection {
				background = colorRef(221, 237, 255)
			}
		}

		numberCell := rect{Left: fileCell.Left - numberWidth, Top: fileCell.Top, Right: fileCell.Left, Bottom: fileCell.Bottom}
		if numberCell.Right > client.Left && numberCell.Left < client.Right {
			fillSolid(hdc, numberCell, background)
			oldFont, _, _ := procSelectObject.Call(hdc, uiFontSmall)
			procSetBkMode.Call(hdc, TRANSPARENT)
			procSetTextColor.Call(hdc, textColor)
			label := strconv.Itoa(row + 1)
			procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(label))), ^uintptr(0), uintptr(unsafe.Pointer(&numberCell)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
			if oldFont != 0 {
				procSelectObject.Call(hdc, oldFont)
			}
		}

		if a.hImageList != 0 && task.ThumbnailIndex >= 0 && task.ThumbnailIndex < imageCount {
			fillSolid(hdc, fileCell, background)
			x := fileCell.Left + scaleDPI(5)
			y := (fileCell.Top + fileCell.Bottom - scaleDPI(48)) / 2
			if drawn, _, _ := round7ImageListDraw.Call(a.hImageList, uintptr(task.ThumbnailIndex), hdc, uintptr(x), uintptr(y), 0); drawn != 0 {
				textRect := fileCell
				textRect.Left += scaleDPI(98)
				textRect.Right -= scaleDPI(6)
				oldFont, _, _ := procSelectObject.Call(hdc, uiFontSmall)
				procSetBkMode.Call(hdc, TRANSPARENT)
				procSetTextColor.Call(hdc, textColor)
				label := filepath.Base(task.Input)
				procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(label))), ^uintptr(0), uintptr(unsafe.Pointer(&textRect)), DT_LEFT|DT_VCENTER|DT_SINGLELINE)
				if oldFont != 0 {
					procSelectObject.Call(hdc, oldFont)
				}
			}
		}

		separator := rect{Left: client.Left, Top: fileCell.Bottom - 1, Right: client.Right, Bottom: fileCell.Bottom}
		fillSolid(hdc, separator, colorRef(241, 244, 248))
	}
}

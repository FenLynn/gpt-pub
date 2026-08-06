//go:build windows

package main

import (
	"path/filepath"
	"strconv"
	"unsafe"

	"mediaworkbench/internal/model"
)

const (
	round7LVMGetColumnWidth = 0x101D
	round7WMPrint           = 0x0317
	round7WMPrintClient     = 0x0318
)

var (
	round7ListGetDC              = user32.NewProc("GetDC")
	round7ListReleaseDC          = user32.NewProc("ReleaseDC")
	round7ImageListDraw          = comctl32.NewProc("ImageList_Draw")
	round7ImageListCount         = comctl32.NewProc("ImageList_GetImageCount")
	round12ListIntersectClipRect = gdi32.NewProc("IntersectClipRect")
)

// round7DrawListOverlay owns the number and preview cells for unselected rows.
// Selected rows are painted by the round-12 single selection owner so every
// subitem receives exactly the same light-blue surface and dark text.
func round7DrawListOverlay(a *application, hdc uintptr) {
	if a == nil || a.hList == 0 || hdc == 0 {
		return
	}
	var client rect
	procGetClientRect.Call(a.hList, uintptr(unsafe.Pointer(&client)))
	clipTop := client.Top
	if header := send(a.hList, LVM_GETHEADER, 0, 0); header != 0 {
		if headerRect, ok := childClientRect(header, a.hList); ok && headerRect.Bottom > clipTop {
			clipTop = headerRect.Bottom
		}
	}
	saved, _, _ := procSaveDC.Call(hdc)
	if saved != 0 {
		round12ListIntersectClipRect.Call(hdc, uintptr(client.Left), uintptr(clipTop), uintptr(client.Right), uintptr(client.Bottom))
		defer procRestoreDC.Call(hdc, saved)
	}

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
		if !ok || fileCell.Bottom <= clipTop || fileCell.Top > client.Bottom {
			continue
		}
		// The round-12 custom-draw path has already painted every selected
		// subitem, including number, preview and filename. Never repaint those
		// cells with an active/inactive system selection variant.
		if listItemSelected(a.hList, row) {
			continue
		}
		task, ok := a.visibleTaskSnapshot(row)
		if !ok {
			continue
		}
		background := colorRef(255, 255, 255)
		textColor := colorRef(52, 61, 74)

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

		fillSolid(hdc, fileCell, background)
		preview := rect{Left: fileCell.Left + scaleDPI(6), Top: fileCell.Top + scaleDPI(4), Right: fileCell.Left + scaleDPI(88), Bottom: fileCell.Bottom - scaleDPI(4)}
		if preview.Bottom-preview.Top > scaleDPI(48) {
			preview.Top = (fileCell.Top + fileCell.Bottom - scaleDPI(48)) / 2
			preview.Bottom = preview.Top + scaleDPI(48)
		}
		drawn := false
		if a.hImageList != 0 && task.ThumbnailIndex >= 0 && task.ThumbnailIndex < imageCount {
			x := preview.Left
			y := (preview.Top + preview.Bottom - scaleDPI(48)) / 2
			ok, _, _ := round7ImageListDraw.Call(a.hImageList, uintptr(task.ThumbnailIndex), hdc, uintptr(x), uintptr(y), 0)
			drawn = ok != 0
		}
		if !drawn {
			fillSolid(hdc, preview, colorRef(241, 244, 248))
			border := colorRef(211, 218, 227)
			fillSolid(hdc, rect{Left: preview.Left, Top: preview.Top, Right: preview.Right, Bottom: preview.Top + 1}, border)
			fillSolid(hdc, rect{Left: preview.Left, Top: preview.Bottom - 1, Right: preview.Right, Bottom: preview.Bottom}, border)
			fillSolid(hdc, rect{Left: preview.Left, Top: preview.Top, Right: preview.Left + 1, Bottom: preview.Bottom}, border)
			fillSolid(hdc, rect{Left: preview.Right - 1, Top: preview.Top, Right: preview.Right, Bottom: preview.Bottom}, border)
			kind := "图片"
			if task.Kind == model.KindVideo {
				kind = "视频"
			}
			drawCenteredText(hdc, kind, preview, uiFontSmall, colorRef(132, 144, 158))
		}

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

		separator := rect{Left: client.Left + 1, Top: fileCell.Bottom - 1, Right: client.Right - 1, Bottom: fileCell.Bottom}
		fillSolid(hdc, separator, colorRef(241, 244, 248))
	}
}

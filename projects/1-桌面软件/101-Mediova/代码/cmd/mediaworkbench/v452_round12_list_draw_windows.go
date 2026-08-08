//go:build windows

package main

import (
	"strconv"
	"unsafe"

	"mediaworkbench/internal/model"
)

func round12DrawTaskListCell(a *application, cd *nmListViewCustomDraw) uintptr {
	if a == nil || cd == nil {
		return CDRF_DODEFAULT
	}
	switch cd.NMCD.DrawStage {
	case CDDS_PREPAINT:
		return CDRF_NOTIFYITEMDRAW
	case CDDS_ITEMPREPAINT:
		row := int(cd.NMCD.ItemSpec)
		background := colorRef(255, 255, 255)
		if listItemSelected(a.hList, row) {
			background = round12SelectionBackground
		}
		// Paint the complete physical row before any subitem content. ListView
		// can optimize selection invalidation around text-bearing subitems; that
		// used to leave the old blue background behind in empty/hidden trailing
		// columns when selection moved. One row surface makes selection atomic.
		round12DrawRowBackground(a, cd.NMCD.HDC, row, background)
		return CDRF_NOTIFYSUBITEMDRAW
	case CDDS_ITEMPREPAINT | CDDS_SUBITEM:
		row := int(cd.NMCD.ItemSpec)
		column := int(cd.ISubItem)
		task, ok := a.visibleTaskSnapshot(row)
		if !ok || column < 0 || column >= round12ColumnCount {
			return CDRF_DODEFAULT
		}
		cell, visible := round12VisibleCellBounds(a, row, column)
		if !visible {
			// A zero-width/hidden column can still receive NM_CUSTOMDRAW on some
			// comctl32 versions. Never let stale NMCD.Rc content leak into a
			// neighbouring visible cell.
			return CDRF_SKIPDEFAULT
		}
		selected := listItemSelected(a.hList, row)
		background := colorRef(255, 255, 255)
		if selected {
			background = round12SelectionBackground
		}
		round12DrawPhysicalCell(a, cd.NMCD.HDC, cell, row, column, &task, selected, background)
		return CDRF_SKIPDEFAULT
	}
	return CDRF_DODEFAULT
}

func round12DrawRowBackground(a *application, hdc uintptr, row int, background uintptr) {
	if a == nil || a.hList == 0 || hdc == 0 || row < 0 {
		return
	}
	rowBounds := rect{Left: LVIR_BOUNDS}
	if send(a.hList, LVM_GETITEMRECT, uintptr(row), uintptr(unsafe.Pointer(&rowBounds))) == 0 || rowBounds.Bottom <= rowBounds.Top {
		return
	}
	var client rect
	if ok, _, _ := procGetClientRect.Call(a.hList, uintptr(unsafe.Pointer(&client))); ok == 0 || client.Right <= client.Left {
		return
	}
	rowBounds.Left = client.Left
	rowBounds.Right = client.Right
	fillSolid(hdc, rowBounds, background)
	round12DrawSeparator(hdc, rowBounds)
}

func round12DrawPhysicalCell(a *application, hdc uintptr, cell rect, row, column int, task *model.Task, selected bool, background uintptr) {
	legacy := a.taskTexts(task)
	switch column {
	case round12ColNumber:
		round12DrawTextCell(hdc, cell, strconv.Itoa(row+1), background, round12SelectionText, true)
	case round12ColPreview:
		round12DrawPreviewCell(a, hdc, cell, task, background)
	case round12ColFile:
		round12DrawTextCell(hdc, cell, round12LegacyText(legacy, 0), background, round12SelectionText, false)
	case round12ColOutputSize:
		_, label, _ := compressionCellMetrics(task)
		round12DrawCompressionCell(hdc, cell, task, label, background)
	case round12ColProgress:
		fraction, label := progressCellMetrics(task)
		round12DrawProgressCell(hdc, cell, fraction, label, background)
	case round12ColStatus:
		color := round12SelectionText
		if !selected {
			color = taskStatusColor(task.Status)
		}
		round12DrawTextCell(hdc, cell, round12LegacyText(legacy, 10), background, color, false)
	case round12ColTimeCrop:
		round12DrawTimeCropCell(a, hdc, cell, task, background)
	case round12ColPictureCrop:
		opts := a.settings.EffectiveOptions(task)
		round12DrawTextCell(hdc, cell, round12PictureCropText(task, opts), background, round12SelectionText, true)
	default:
		legacyIndex := column - 2
		round12DrawTextCell(hdc, cell, round12LegacyText(legacy, legacyIndex), background, round12SelectionText, true)
	}
	round12FillTrailingRowArea(a, hdc, cell, column, background)
}

func round12LegacyText(values []string, index int) string {
	if index < 0 || index >= len(values) {
		return ""
	}
	return values[index]
}

func round12DrawTextCell(hdc uintptr, cell rect, label string, background, textColor uintptr, centered bool) {
	fillSolid(hdc, cell, background)
	textRect := cell
	flags := uintptr(DT_CENTER | DT_VCENTER | DT_SINGLELINE)
	if !centered {
		flags = DT_LEFT | DT_VCENTER | DT_SINGLELINE
		textRect.Left += scaleDPI(8)
		textRect.Right -= scaleDPI(5)
	}
	old, _, _ := procSelectObject.Call(hdc, uiFontSmall)
	procSetBkMode.Call(hdc, TRANSPARENT)
	procSetTextColor.Call(hdc, textColor)
	procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(label))), ^uintptr(0), uintptr(unsafe.Pointer(&textRect)), flags)
	if old != 0 {
		procSelectObject.Call(hdc, old)
	}
	round12DrawSeparator(hdc, cell)
}

func round12DrawSeparator(hdc uintptr, cell rect) {
	if cell.Bottom > cell.Top {
		fillSolid(hdc, rect{Left: cell.Left, Top: cell.Bottom - 1, Right: cell.Right, Bottom: cell.Bottom}, round12CellSeparator)
	}
}

func round12FillTrailingRowArea(a *application, hdc uintptr, cell rect, column int, background uintptr) {
	if a == nil || a.hList == 0 || hdc == 0 || cell.Bottom <= cell.Top {
		return
	}
	for next := column + 1; next < round12ColumnCount; next++ {
		if int32(send(a.hList, LVM_GETCOLUMNWIDTH, uintptr(next), 0)) > 0 {
			return
		}
	}
	var client rect
	if ok, _, _ := procGetClientRect.Call(a.hList, uintptr(unsafe.Pointer(&client))); ok == 0 {
		return
	}
	if cell.Right >= client.Right {
		return
	}
	tail := rect{Left: cell.Right, Top: cell.Top, Right: client.Right, Bottom: cell.Bottom}
	fillSolid(hdc, tail, background)
	round12DrawSeparator(hdc, tail)
}

func round12DrawPreviewCell(a *application, hdc uintptr, cell rect, task *model.Task, background uintptr) {
	fillSolid(hdc, cell, background)
	preview := rect{Left: cell.Left + scaleDPI(6), Top: cell.Top + scaleDPI(3), Right: cell.Right - scaleDPI(6), Bottom: cell.Bottom - scaleDPI(3)}
	wantW, wantH := scaleDPI(86), scaleDPI(48)
	if preview.Right-preview.Left > wantW {
		center := (preview.Left + preview.Right) / 2
		preview.Left, preview.Right = center-wantW/2, center-wantW/2+wantW
	}
	if preview.Bottom-preview.Top > wantH {
		center := (preview.Top + preview.Bottom) / 2
		preview.Top, preview.Bottom = center-wantH/2, center-wantH/2+wantH
	}
	drawn := false
	if task != nil && a.hImageList != 0 && task.ThumbnailIndex >= 0 {
		count, _, _ := round7ImageListCount.Call(a.hImageList)
		if task.ThumbnailIndex < int(count) {
			// ImageList_Draw always uses the native bitmap size. Clip it to the
			// physical preview cell so a 48px thumbnail can never paint into the
			// Header or the adjacent row on a compact ListView.
			round12WithClip(hdc, preview, func() {
				result, _, _ := round7ImageListDraw.Call(a.hImageList, uintptr(task.ThumbnailIndex), hdc, uintptr(preview.Left), uintptr(preview.Top), 0)
				drawn = result != 0
			})
		}
	}
	if !drawn {
		fillSolid(hdc, preview, colorRef(244, 247, 250))
		border := colorRef(211, 219, 228)
		fillSolid(hdc, rect{Left: preview.Left, Top: preview.Top, Right: preview.Right, Bottom: preview.Top + 1}, border)
		fillSolid(hdc, rect{Left: preview.Left, Top: preview.Bottom - 1, Right: preview.Right, Bottom: preview.Bottom}, border)
		fillSolid(hdc, rect{Left: preview.Left, Top: preview.Top, Right: preview.Left + 1, Bottom: preview.Bottom}, border)
		fillSolid(hdc, rect{Left: preview.Right - 1, Top: preview.Top, Right: preview.Right, Bottom: preview.Bottom}, border)
		kind := "图片"
		if task != nil && task.Kind == model.KindVideo {
			kind = "视频"
		}
		drawCenteredText(hdc, kind, preview, uiFontSmall, colorRef(126, 139, 154))
	}
	round12DrawSeparator(hdc, cell)
}

func round12DrawTimeCropCell(a *application, hdc uintptr, cell rect, task *model.Task, background uintptr) {
	fillSolid(hdc, cell, background)
	opts := a.settings.EffectiveOptions(task)
	top, bottom, active := round12TimeCropLines(task, opts)
	if !active {
		drawCenteredText(hdc, top, cell, uiFontSmall, round12SelectionText)
		round12DrawSeparator(hdc, cell)
		return
	}
	mid := (cell.Top + cell.Bottom) / 2
	topRect, bottomRect := cell, cell
	topRect.Bottom, bottomRect.Top = mid+1, mid-1
	old, _, _ := procSelectObject.Call(hdc, uiFontSmall)
	procSetBkMode.Call(hdc, TRANSPARENT)
	procSetTextColor.Call(hdc, round12SelectionText)
	procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(top))), ^uintptr(0), uintptr(unsafe.Pointer(&topRect)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
	procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(bottom))), ^uintptr(0), uintptr(unsafe.Pointer(&bottomRect)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
	if old != 0 {
		procSelectObject.Call(hdc, old)
	}
	round12DrawSeparator(hdc, cell)
}

func round12DrawProgressCell(hdc uintptr, cell rect, fraction float64, label string, background uintptr) {
	fillSolid(hdc, cell, background)
	fraction = clamp01(fraction)
	bar := fullCellBarRect(cell)
	fillSolid(hdc, bar, colorRef(239, 243, 248))
	fill := rect{Left: bar.Left, Top: bar.Top, Right: bar.Left, Bottom: bar.Bottom}
	if fraction > 0 {
		fill = bar
		fill.Right = fill.Left + int32(float64(fill.Right-fill.Left)*fraction)
		if fill.Right < fill.Left+3 {
			fill.Right = fill.Left + 3
		}
		drawHorizontalGradient(hdc, fill, colorRef(169, 204, 243), colorRef(76, 138, 220))
	}
	drawContrastCenteredText(hdc, label, bar, fill, uiFontSmall)
	round12DrawSeparator(hdc, cell)
}

func round12DrawCompressionCell(hdc uintptr, cell rect, task *model.Task, label string, background uintptr) {
	fillSolid(hdc, cell, background)
	bar := fullCellBarRect(cell)
	fillSolid(hdc, bar, colorRef(239, 243, 248))
	if task != nil && task.InputSize > 0 && task.OutputSize > 0 {
		visual := compressionVisualFor(task.InputSize, task.OutputSize)
		split := bar.Left + int32(float64(bar.Right-bar.Left)*visual.InputFraction)
		if split <= bar.Left {
			split = bar.Left + 1
		}
		if split >= bar.Right {
			split = bar.Right - 1
		}
		left, right := bar, bar
		left.Right, right.Left = split, split
		fillSolid(hdc, left, colorRef(228, 233, 239))
		start, finish := compressionColorPair(visual)
		drawHorizontalGradient(hdc, right, start, finish)
	}
	drawCenteredText(hdc, label, bar, uiFontSmall, colorRef(35, 51, 70))
	round12DrawSeparator(hdc, cell)
}

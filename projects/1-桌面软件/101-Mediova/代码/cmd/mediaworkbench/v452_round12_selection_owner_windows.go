//go:build windows

package main

import (
	"fmt"
	"path/filepath"
	"strconv"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

const round12SelectionSubclassID = 0x45C2

var (
	round12SelectionBackground = colorRef(233, 244, 254)
	round12SelectionText       = colorRef(52, 64, 77)
	round12SelectionInstalled  atomic.Bool
	round12SelectionCallback   = syscall.NewCallback(round12SelectionMainSubclassProc)
)

func init() {
	go func() {
		for attempt := 0; attempt < 800; attempt++ {
			a := app
			if a != nil && a.hwnd != 0 && a.hList != 0 && a.controlsReady && round7FeedbackMainInstalled.Load() {
				a.postUI(func() {
					if round12SelectionInstalled.Load() || a.hwnd == 0 || a.hList == 0 {
						return
					}
					if ok, _, _ := v452SetWindowSubclass.Call(a.hwnd, round12SelectionCallback, round12SelectionSubclassID, 0); ok != 0 {
						round12SelectionInstalled.Store(true)
						procInvalidateRect.Call(a.hList, 0, 0)
					}
				})
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
}

func round12SelectionMainSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	a := app
	if a != nil && hwnd == a.hwnd && message == WM_NOTIFY && lParam != 0 {
		hdr := (*nmhdr)(unsafe.Pointer(lParam))
		if hdr.HwndFrom == a.hList && hdr.Code == NM_CUSTOMDRAW {
			cd := (*nmListViewCustomDraw)(unsafe.Pointer(lParam))
			switch cd.NMCD.DrawStage {
			case CDDS_PREPAINT:
				return CDRF_NOTIFYITEMDRAW
			case CDDS_ITEMPREPAINT:
				return CDRF_NOTIFYSUBITEMDRAW
			case CDDS_ITEMPREPAINT | CDDS_SUBITEM:
				row := int(cd.NMCD.ItemSpec)
				if listItemSelected(a.hList, row) {
					if round12DrawSelectedSubItem(a, cd, row) {
						return CDRF_SKIPDEFAULT
					}
				}
			}
		}
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, round12SelectionCallback, subclassID)
		round12SelectionInstalled.Store(false)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round12DrawSelectedSubItem(a *application, cd *nmListViewCustomDraw, row int) bool {
	if a == nil || cd == nil || row < 0 {
		return false
	}
	task, ok := a.visibleTaskSnapshot(row)
	if !ok {
		return false
	}
	column := int(cd.ISubItem)
	cell := cd.NMCD.Rc
	if exact, exactOK := listSubItemBounds(a.hList, row, column); exactOK {
		cell.Left = exact.Left
		cell.Right = exact.Right
	}
	fillSolid(cd.NMCD.HDC, cell, round12SelectionBackground)

	switch column {
	case taskColNumber:
		drawCenteredText(cd.NMCD.HDC, strconv.Itoa(row+1), cell, uiFontSmall, round12SelectionText)
	case taskColFile:
		round12DrawSelectedPreviewAndFile(a, cd.NMCD.HDC, cell, &task)
	case taskColOutputSize:
		_, label, _ := compressionCellMetrics(&task)
		round12DrawSelectedCompression(cd.NMCD.HDC, cell, &task, label)
	case taskColProgress:
		fraction, label := progressCellMetrics(&task)
		round12DrawSelectedProgress(cd.NMCD.HDC, cell, fraction, label)
	case taskColStatus:
		texts := a.taskTexts(&task)
		label := ""
		if taskColStatus-1 >= 0 && taskColStatus-1 < len(texts) {
			label = texts[taskColStatus-1]
		}
		textRect := cell
		textRect.Left += scaleDPI(8)
		old, _, _ := procSelectObject.Call(cd.NMCD.HDC, uiFontSmall)
		procSetBkMode.Call(cd.NMCD.HDC, TRANSPARENT)
		procSetTextColor.Call(cd.NMCD.HDC, taskStatusColor(task.Status))
		procDrawTextW.Call(cd.NMCD.HDC, uintptr(unsafe.Pointer(p(label))), ^uintptr(0), uintptr(unsafe.Pointer(&textRect)), DT_LEFT|DT_VCENTER|DT_SINGLELINE)
		if old != 0 {
			procSelectObject.Call(cd.NMCD.HDC, old)
		}
	default:
		texts := append([]string{fmt.Sprintf("%d", row+1)}, a.taskTexts(&task)...)
		label := ""
		if column >= 0 && column < len(texts) {
			label = texts[column]
		}
		textRect := cell
		textRect.Left += scaleDPI(8)
		textRect.Right -= scaleDPI(5)
		old, _, _ := procSelectObject.Call(cd.NMCD.HDC, uiFontSmall)
		procSetBkMode.Call(cd.NMCD.HDC, TRANSPARENT)
		procSetTextColor.Call(cd.NMCD.HDC, round12SelectionText)
		procDrawTextW.Call(cd.NMCD.HDC, uintptr(unsafe.Pointer(p(label))), ^uintptr(0), uintptr(unsafe.Pointer(&textRect)), DT_LEFT|DT_VCENTER|DT_SINGLELINE)
		if old != 0 {
			procSelectObject.Call(cd.NMCD.HDC, old)
		}
	}
	return true
}

func round12DrawSelectedPreviewAndFile(a *application, hdc uintptr, cell rect, task *model.Task) {
	if a == nil || task == nil || hdc == 0 {
		return
	}
	preview := rect{
		Left:   cell.Left + scaleDPI(6),
		Top:    cell.Top + scaleDPI(4),
		Right:  cell.Left + scaleDPI(88),
		Bottom: cell.Bottom - scaleDPI(4),
	}
	if preview.Bottom-preview.Top > scaleDPI(48) {
		preview.Top = (cell.Top + cell.Bottom - scaleDPI(48)) / 2
		preview.Bottom = preview.Top + scaleDPI(48)
	}
	drawn := false
	if a.hImageList != 0 && task.ThumbnailIndex >= 0 {
		count, _, _ := round7ImageListCount.Call(a.hImageList)
		if task.ThumbnailIndex < int(count) {
			ok, _, _ := round7ImageListDraw.Call(a.hImageList, uintptr(task.ThumbnailIndex), hdc, uintptr(preview.Left), uintptr(preview.Top), 0)
			drawn = ok != 0
		}
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
	textRect := cell
	textRect.Left += scaleDPI(98)
	textRect.Right -= scaleDPI(6)
	old, _, _ := procSelectObject.Call(hdc, uiFontSmall)
	procSetBkMode.Call(hdc, TRANSPARENT)
	procSetTextColor.Call(hdc, round12SelectionText)
	label := filepath.Base(task.Input)
	procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(label))), ^uintptr(0), uintptr(unsafe.Pointer(&textRect)), DT_LEFT|DT_VCENTER|DT_SINGLELINE)
	if old != 0 {
		procSelectObject.Call(hdc, old)
	}
}

func round12DrawSelectedProgress(hdc uintptr, rc rect, fraction float64, label string) {
	fillSolid(hdc, rc, round12SelectionBackground)
	fraction = clamp01(fraction)
	bar := fullCellBarRect(rc)
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
	drawRoundedBorder(hdc, bar, 3, colorRef(218, 225, 234))
	drawContrastCenteredText(hdc, label, bar, fill, uiFontSmall)
}

func round12DrawSelectedCompression(hdc uintptr, rc rect, task *model.Task, label string) {
	fillSolid(hdc, rc, round12SelectionBackground)
	bar := fullCellBarRect(rc)
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
		left := bar
		left.Right = split
		right := bar
		right.Left = split
		fillSolid(hdc, left, colorRef(228, 233, 239))
		start, finish := compressionColorPair(visual)
		drawHorizontalGradient(hdc, right, start, finish)
	}
	drawRoundedBorder(hdc, bar, 3, colorRef(218, 225, 234))
	drawCenteredText(hdc, label, bar, uiFontSmall, colorRef(35, 51, 70))
}

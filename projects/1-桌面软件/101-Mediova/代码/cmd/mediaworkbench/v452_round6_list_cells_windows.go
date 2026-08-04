//go:build windows

package main

import (
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"
)

const v452Round6ListCellsSubclassID = 0x4566

var (
	v452Round6ListCellsEventCB uintptr
	v452Round6ListCellsMainCB  uintptr
	v452Round6ListCellsHook    uintptr
	v452Round6ListCellsOnce    sync.Once
	v452Round6NumberDraws      atomic.Int32
	v452Round6PreviewDraws     atomic.Int32
	v452Round6PreviewAttempts  atomic.Int32
	v452Round6ImageListDraw    = comctl32.NewProc("ImageList_Draw")
	v452Round6ImageListCount   = comctl32.NewProc("ImageList_GetImageCount")
)

func init() {
	v452Round6ListCellsEventCB = syscall.NewCallback(v452Round6ListCellsEventProc)
	v452Round6ListCellsMainCB = syscall.NewCallback(v452Round6ListCellsMainSubclassProc)
	v452Round6ListCellsHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		v452Round6ListCellsEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func v452Round6ListCellsEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	if app == nil || app.hwnd == 0 || app.hList == 0 || !app.controlsReady {
		return 0
	}
	v452Round6ListCellsOnce.Do(func() {
		v452SetWindowSubclass.Call(app.hwnd, v452Round6ListCellsMainCB, v452Round6ListCellsSubclassID, 0)
	})
	procInvalidateRect.Call(app.hList, 0, 0)
	return 0
}

func v452Round6ListCellsMainSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	// Custom-draw notifications must be handled before the original parent
	// procedure returns to the ListView. Drawing after DefSubclassProc means the
	// control has already completed the paint stage and the HDC is no longer a
	// valid custom-draw surface; counters increase but nothing appears on screen.
	if message == WM_NOTIFY && app != nil && lParam != 0 {
		hdr := (*nmhdr)(unsafe.Pointer(lParam))
		if hdr.HwndFrom == app.hList && hdr.Code == NM_CUSTOMDRAW {
			if handled, drawResult := v452Round6DrawListCell(app, (*nmListViewCustomDraw)(unsafe.Pointer(lParam))); handled {
				return drawResult
			}
		}
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, v452Round6ListCellsMainCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func v452Round6DrawListCell(a *application, cd *nmListViewCustomDraw) (bool, uintptr) {
	if a == nil || cd == nil || cd.NMCD.DrawStage != CDDS_ITEMPREPAINT|CDDS_SUBITEM {
		return false, CDRF_DODEFAULT
	}
	column := int(cd.ISubItem)
	if column != taskColNumber && column != taskColFile {
		return false, CDRF_DODEFAULT
	}
	row := int(cd.NMCD.ItemSpec)
	task, ok := a.visibleTaskSnapshot(row)
	if !ok {
		return false, CDRF_DODEFAULT
	}
	cell := cd.NMCD.Rc
	if exact, ok := listSubItemBounds(a.hList, row, column); ok {
		cell.Left = exact.Left
		cell.Right = exact.Right
	}
	selected := listItemSelected(a.hList, row)
	focus, _, _ := procGetFocus.Call()
	activeSelection := selected && focus == a.hList

	background := colorRef(255, 255, 255)
	textColor := colorRef(52, 61, 74)
	if selected {
		if activeSelection {
			background, _, _ = procGetSysColor.Call(COLOR_HIGHLIGHT)
			textColor, _, _ = procGetSysColor.Call(COLOR_HIGHLIGHTTEXT)
		} else {
			background = colorRef(240, 244, 249)
		}
	}
	fillSolid(cd.NMCD.HDC, cell, background)

	old, _, _ := procSelectObject.Call(cd.NMCD.HDC, uiFontSmall)
	procSetBkMode.Call(cd.NMCD.HDC, TRANSPARENT)
	procSetTextColor.Call(cd.NMCD.HDC, textColor)
	defer func() {
		if old != 0 {
			procSelectObject.Call(cd.NMCD.HDC, old)
		}
	}()

	if column == taskColNumber {
		label := strconv.Itoa(row + 1)
		procDrawTextW.Call(cd.NMCD.HDC, uintptr(unsafe.Pointer(p(label))), ^uintptr(0), uintptr(unsafe.Pointer(&cell)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
		v452Round6NumberDraws.Add(1)
		return true, CDRF_SKIPDEFAULT
	}

	textRect := cell
	textRect.Left += scaleDPI(8)
	if a.hImageList != 0 && task.ThumbnailIndex >= 0 {
		count, _, _ := v452Round6ImageListCount.Call(a.hImageList)
		if task.ThumbnailIndex < int(count) {
			v452Round6PreviewAttempts.Add(1)
			x := cell.Left + scaleDPI(5)
			y := (cell.Top+cell.Bottom-scaleDPI(48))/2
			drawn, _, _ := v452Round6ImageListDraw.Call(a.hImageList, uintptr(task.ThumbnailIndex), cd.NMCD.HDC, uintptr(x), uintptr(y), 0)
			if drawn != 0 {
				textRect.Left += scaleDPI(92)
				v452Round6PreviewDraws.Add(1)
			}
		}
	}
	textRect.Right -= scaleDPI(6)
	label := filepath.Base(task.Input)
	procDrawTextW.Call(cd.NMCD.HDC, uintptr(unsafe.Pointer(p(label))), ^uintptr(0), uintptr(unsafe.Pointer(&textRect)), DT_LEFT|DT_VCENTER|DT_SINGLELINE)
	return true, CDRF_SKIPDEFAULT
}

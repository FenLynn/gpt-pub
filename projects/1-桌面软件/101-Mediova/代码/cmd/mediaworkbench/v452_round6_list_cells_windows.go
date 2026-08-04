//go:build windows

package main

import (
	"fmt"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"mediaworkbench/internal/media"
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
	v452Round6ThumbnailRetries sync.Map // map[string]time.Time
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
	v452Round6RestoreNativeNumberColumn(app)
	v452Round6EnsureVisibleThumbnails(app)
	procInvalidateRect.Call(app.hList, 0, 0)
	return 0
}

func v452Round6RestoreNativeNumberColumn(a *application) {
	if a == nil || a.hList == 0 {
		return
	}
	count := int(send(a.hList, LVM_GETITEMCOUNT, 0, 0))
	for row := 0; row < count; row++ {
		// A report-style ListView with an attached normal ImageList reserves its
		// icon width in column zero unless the primary item explicitly uses -1.
		// The old item insertion omitted LVIF_IMAGE, so 86 px were reserved and
		// the number text was clipped outside the narrow # column.
		image := lvItem{Mask: LVIF_IMAGE, IItem: int32(row), ISubItem: int32(taskColNumber), IImage: -1}
		send(a.hList, LVM_SETITEMW, 0, uintptr(unsafe.Pointer(&image)))
		label := p(strconv.Itoa(row + 1))
		text := lvItem{Mask: LVIF_TEXT, IItem: int32(row), ISubItem: int32(taskColNumber), PszText: label}
		send(a.hList, LVM_SETITEMW, 0, uintptr(unsafe.Pointer(&text)))
		v452Round6NumberDraws.Add(1)
	}
}

func v452Round6EnsureVisibleThumbnails(a *application) {
	if a == nil || a.hList == 0 || a.hImageList == 0 {
		return
	}
	ffmpeg, _, _, _, _ := a.componentSnapshot()
	if ffmpeg == "" {
		return
	}
	imageCountRaw, _, _ := v452Round6ImageListCount.Call(a.hImageList)
	imageCount := int(imageCountRaw)
	count := int(send(a.hList, LVM_GETITEMCOUNT, 0, 0))
	now := time.Now()
	for row := 0; row < count; row++ {
		task, ok := a.visibleTaskSnapshot(row)
		if !ok || task.Width <= 0 || task.Height <= 0 {
			continue
		}
		key := fmt.Sprintf("%d|%s", task.ID, task.Input)
		if task.ThumbnailIndex >= 0 && task.ThumbnailIndex < imageCount {
			v452Round6ThumbnailRetries.Delete(key)
			continue
		}
		if previous, ok := v452Round6ThumbnailRetries.Load(key); ok {
			if now.Sub(previous.(time.Time)) < 12*time.Second {
				continue
			}
		}
		probe := media.ProbeInfo{
			Width:    task.Width,
			Height:   task.Height,
			Rotation: task.Rotation,
			Duration: task.Duration,
			FPS:      task.FPS,
		}
		if a.queueThumbnail(task.ID, task.Input, probe) {
			v452Round6ThumbnailRetries.Store(key, now)
		}
	}
}

func v452Round6ListCellsMainSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	// Custom-draw notifications must be handled before the original parent
	// procedure returns to the ListView. Only the file/preview subitem remains
	// custom-drawn; the number column now uses the native text path.
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
	if a == nil || cd == nil || cd.NMCD.DrawStage != CDDS_ITEMPREPAINT|CDDS_SUBITEM || int(cd.ISubItem) != taskColFile {
		return false, CDRF_DODEFAULT
	}
	row := int(cd.NMCD.ItemSpec)
	task, ok := a.visibleTaskSnapshot(row)
	if !ok {
		return false, CDRF_DODEFAULT
	}
	cell := cd.NMCD.Rc
	if exact, ok := listSubItemBounds(a.hList, row, taskColFile); ok {
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

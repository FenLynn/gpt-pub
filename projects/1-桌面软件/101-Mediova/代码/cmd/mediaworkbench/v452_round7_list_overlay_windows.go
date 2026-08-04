//go:build windows

package main

import (
	"path/filepath"
	"strconv"
	"sync/atomic"
	"syscall"
	"unsafe"
)

const (
	round7ListSubclassID      = 0x4573
	round7LVMGetColumnWidth   = 0x101D
	round7WMPrint             = 0x0317
	round7WMPrintClient       = 0x0318
)

var (
	round7ListEventCB       uintptr
	round7ListSubclassCB    uintptr
	round7ListEventHook     uintptr
	round7ListInstalled     atomic.Bool
	round7ListUnhookEvent   = user32.NewProc("UnhookWinEvent")
	round7ListGetDC         = user32.NewProc("GetDC")
	round7ListReleaseDC     = user32.NewProc("ReleaseDC")
	round7ImageListDraw     = comctl32.NewProc("ImageList_Draw")
	round7ImageListCount    = comctl32.NewProc("ImageList_GetImageCount")
)

func init() {
	round7ListEventCB = syscall.NewCallback(round7ListEventProc)
	round7ListSubclassCB = syscall.NewCallback(round7ListSubclassProc)
	round7ListEventHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		round7ListEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func round7ListEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	if round7ListInstalled.Load() || app == nil || app.hList == 0 || !app.controlsReady {
		return 0
	}
	ok, _, _ := v452SetWindowSubclass.Call(app.hList, round7ListSubclassCB, round7ListSubclassID, 0)
	if ok == 0 {
		return 0
	}
	round7ListInstalled.Store(true)
	if round7ListEventHook != 0 {
		round7ListUnhookEvent.Call(round7ListEventHook)
		round7ListEventHook = 0
	}
	return 0
}

func round7ListSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case WM_PAINT:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		hdc, _, _ := round7ListGetDC.Call(hwnd)
		if hdc != 0 {
			round7DrawListOverlay(app, hdc)
			round7ListReleaseDC.Call(hwnd, hdc)
		}
		return result
	case round7WMPrint, round7WMPrintClient:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if wParam != 0 {
			round7DrawListOverlay(app, wParam)
		}
		return result
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round7ListSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

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
			if activeSelection {
				background, _, _ = procGetSysColor.Call(COLOR_HIGHLIGHT)
				textColor, _, _ = procGetSysColor.Call(COLOR_HIGHLIGHTTEXT)
			} else {
				background = colorRef(240, 244, 249)
			}
		}

		// Win32 does not return a reliable subitem rectangle for column zero.
		// Derive it from the file column and the actual # column width.
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

		if a.hImageList == 0 || task.ThumbnailIndex < 0 || task.ThumbnailIndex >= imageCount {
			continue
		}
		fillSolid(hdc, fileCell, background)
		x := fileCell.Left + scaleDPI(5)
		y := (fileCell.Top + fileCell.Bottom - scaleDPI(48)) / 2
		drawn, _, _ := round7ImageListDraw.Call(a.hImageList, uintptr(task.ThumbnailIndex), hdc, uintptr(x), uintptr(y), 0)
		if drawn == 0 {
			continue
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
	}
}

//go:build windows

package main

import (
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"unsafe"
)

const (
	v452Round6ListOverlaySubclassID = 0x4568
	v452Round6WMPrint               = 0x0317
	v452Round6WMPrintClient         = 0x0318
	v452Round6LVMGetColumnWidth     = 0x101D
)

var (
	v452Round6ListOverlayEventCB uintptr
	v452Round6ListOverlayCB      uintptr
	v452Round6ListOverlayHook    uintptr
	v452Round6ListOverlayOnce    sync.Once
	v452Round6OverlayGetDC       = user32.NewProc("GetDC")
	v452Round6OverlayReleaseDC   = user32.NewProc("ReleaseDC")
)

func init() {
	v452Round6ListOverlayEventCB = syscall.NewCallback(v452Round6ListOverlayEventProc)
	v452Round6ListOverlayCB = syscall.NewCallback(v452Round6ListOverlaySubclassProc)
	v452Round6ListOverlayHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		v452Round6ListOverlayEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func v452Round6ListOverlayEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	v452Round6InstallListOverlay(app)
	return 0
}

func v452Round6InstallListOverlay(a *application) {
	if a == nil || a.hList == 0 || !a.controlsReady {
		return
	}
	v452Round6ListOverlayOnce.Do(func() {
		v452SetWindowSubclass.Call(a.hList, v452Round6ListOverlayCB, v452Round6ListOverlaySubclassID, 0)
	})
}

func v452Round6ListOverlaySubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case WM_PAINT:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		hdc, _, _ := v452Round6OverlayGetDC.Call(hwnd)
		if hdc != 0 {
			v452Round6DrawListOverlay(app, hdc)
			v452Round6OverlayReleaseDC.Call(hwnd, hdc)
		}
		return result
	case v452Round6WMPrint, v452Round6WMPrintClient:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if wParam != 0 {
			v452Round6DrawListOverlay(app, wParam)
		}
		return result
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, v452Round6ListOverlayCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func v452Round6DrawListOverlay(a *application, hdc uintptr) {
	if a == nil || a.hList == 0 || hdc == 0 {
		return
	}
	var client rect
	procGetClientRect.Call(a.hList, uintptr(unsafe.Pointer(&client)))
	count := int(send(a.hList, LVM_GETITEMCOUNT, 0, 0))
	numberWidth := int32(send(a.hList, v452Round6LVMGetColumnWidth, uintptr(taskColNumber), 0))
	if numberWidth <= 0 {
		numberWidth = int32(scaleDPI(48))
	}
	imageCount := 0
	if a.hImageList != 0 {
		raw, _, _ := v452Round6ImageListCount.Call(a.hImageList)
		imageCount = int(raw)
	}
	for row := 0; row < count; row++ {
		fileCell, ok := listSubItemBounds(a.hList, row, taskColFile)
		if !ok || fileCell.Bottom < client.Top || fileCell.Top > client.Bottom {
			continue
		}
		// Win32 does not return a real subitem rectangle for column zero. Derive
		// it from the first ordinary subitem and the actual # column width so the
		// number cannot drift into later columns.
		numberCell := rect{Left: fileCell.Left - numberWidth, Top: fileCell.Top, Right: fileCell.Left, Bottom: fileCell.Bottom}
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

		if numberCell.Right > client.Left && numberCell.Left < client.Right {
			fillSolid(hdc, numberCell, background)
			old, _, _ := procSelectObject.Call(hdc, uiFontSmall)
			procSetBkMode.Call(hdc, TRANSPARENT)
			procSetTextColor.Call(hdc, textColor)
			label := strconv.Itoa(row + 1)
			procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(label))), ^uintptr(0), uintptr(unsafe.Pointer(&numberCell)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
			if old != 0 {
				procSelectObject.Call(hdc, old)
			}
			v452Round6NumberDraws.Add(1)
		}

		if task.ThumbnailIndex < 0 || task.ThumbnailIndex >= imageCount || a.hImageList == 0 {
			continue
		}
		fillSolid(hdc, fileCell, background)
		x := fileCell.Left + scaleDPI(5)
		y := (fileCell.Top + fileCell.Bottom - scaleDPI(48)) / 2
		v452Round6PreviewAttempts.Add(1)
		drawn, _, _ := v452Round6ImageListDraw.Call(a.hImageList, uintptr(task.ThumbnailIndex), hdc, uintptr(x), uintptr(y), 0)
		if drawn == 0 {
			continue
		}
		v452Round6PreviewDraws.Add(1)
		textRect := fileCell
		textRect.Left += scaleDPI(98)
		textRect.Right -= scaleDPI(6)
		old, _, _ := procSelectObject.Call(hdc, uiFontSmall)
		procSetBkMode.Call(hdc, TRANSPARENT)
		procSetTextColor.Call(hdc, textColor)
		label := filepath.Base(task.Input)
		procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(label))), ^uintptr(0), uintptr(unsafe.Pointer(&textRect)), DT_LEFT|DT_VCENTER|DT_SINGLELINE)
		if old != 0 {
			procSelectObject.Call(hdc, old)
		}
	}
}

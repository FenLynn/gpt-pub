//go:build windows

package main

import (
	"syscall"
	"time"
	"unsafe"
)

const (
	round12CDISHot                    = 0x0040
	round12HeaderVisualSubclassID     = 0x45C6
	round12HeaderVisualInstallRetries = 800
)

var (
	round12HeaderTopSeparator   = colorRef(207, 214, 223)
	round12HeaderBackground     = colorRef(245, 246, 248)
	round12HeaderHotBackground  = colorRef(248, 250, 252)
	round12HeaderDownBackground = colorRef(231, 243, 255)
	round12HeaderText           = colorRef(28, 39, 52)
	round12HeaderVisualCallback uintptr
)

func init() {
	round12HeaderVisualCallback = syscall.NewCallback(round12HeaderListSubclassProc)
	go func() {
		for attempt := 0; attempt < round12HeaderVisualInstallRetries; attempt++ {
			a := app
			if a != nil && a.hwnd != 0 && a.hList != 0 && a.controlsReady && round12SelectionInstalled.Load() {
				a.postUI(func() {
					if a.hList == 0 {
						return
					}
					v452RemoveSubclass.Call(a.hList, round12HeaderVisualCallback, round12HeaderVisualSubclassID)
					v452SetWindowSubclass.Call(a.hList, round12HeaderVisualCallback, round12HeaderVisualSubclassID, 0)
					header := send(a.hList, LVM_GETHEADER, 0, 0)
					if header != 0 {
						procInvalidateRect.Call(header, 0, 1)
					}
				})
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
}

// Header controls send NM_CUSTOMDRAW to their direct parent, which is the
// ListView rather than the main window. Own that exact message boundary so the
// item renderer below is guaranteed to run for native hover/pressed paints.
func round12HeaderListSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	a := app
	if a == nil || hwnd != a.hList {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
	switch message {
	case WM_NOTIFY:
		if lParam != 0 {
			hdr := (*nmhdr)(unsafe.Pointer(lParam))
			header := send(a.hList, LVM_GETHEADER, 0, 0)
			if header != 0 && hdr.HwndFrom == header && hdr.Code == NM_CUSTOMDRAW {
				return round12DrawHeaderItemTop((*nmCustomDraw)(unsafe.Pointer(lParam)))
			}
		}
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round12HeaderVisualCallback, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

// round12DrawHeaderItemTop keeps the native Header in charge of hit testing,
// column resizing and click/sort notifications, while Round12 owns the final
// item pixels. Native pressed bevels used to replace the whole top edge of the
// active column; drawing the item ourselves makes all states share one border
// geometry without changing Header interaction semantics.
func round12DrawHeaderItemTop(cd *nmCustomDraw) uintptr {
	if cd == nil {
		return CDRF_DODEFAULT
	}
	switch cd.DrawStage {
	case CDDS_PREPAINT:
		return CDRF_NOTIFYITEMDRAW
	case CDDS_ITEMPREPAINT:
		cell := cd.Rc
		if cd.HDC == 0 || cell.Right <= cell.Left || cell.Bottom <= cell.Top {
			return CDRF_SKIPDEFAULT
		}

		background := round12HeaderBackground
		if cd.ItemState&CDIS_SELECTED != 0 {
			background = round12HeaderDownBackground
		} else if cd.ItemState&round12CDISHot != 0 {
			background = round12HeaderHotBackground
		}
		fillSolid(cd.HDC, cell, background)

		fillSolid(cd.HDC, rect{
			Left: cell.Left, Top: cell.Top,
			Right: cell.Right, Bottom: cell.Top + 1,
		}, round12HeaderTopSeparator)
		fillSolid(cd.HDC, rect{
			Left: cell.Right - 1, Top: cell.Top + 1,
			Right: cell.Right, Bottom: cell.Bottom,
		}, round12HeaderTopSeparator)

		index := int(cd.ItemSpec)
		if index >= 0 && index < len(round12Columns) {
			textRect := cell
			textRect.Left += scaleDPI(8)
			textRect.Right -= scaleDPI(5)
			old, _, _ := procSelectObject.Call(cd.HDC, uiFontBold)
			procSetBkMode.Call(cd.HDC, TRANSPARENT)
			procSetTextColor.Call(cd.HDC, round12HeaderText)
			label := round12Columns[index].name
			procDrawTextW.Call(
				cd.HDC,
				uintptr(unsafe.Pointer(p(label))),
				^uintptr(0),
				uintptr(unsafe.Pointer(&textRect)),
				DT_LEFT|DT_VCENTER|DT_SINGLELINE,
			)
			if old != 0 {
				procSelectObject.Call(cd.HDC, old)
			}
		}
		return CDRF_SKIPDEFAULT
	}
	return CDRF_DODEFAULT
}

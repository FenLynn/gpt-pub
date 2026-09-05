//go:build windows

package main

import (
	"sync/atomic"
	"syscall"
	"unsafe"
)

const (
	round12CDISHot                = 0x0040
	round12HeaderVisualSubclassID = 0x45C6
	round12HDMGetItemRect         = 0x1207
	round12WMThumbnailScan        = WM_APP + 0x58C
	round12WMColumnGeometryCommit = WM_APP + 0x58D
	round12HDNFirst               = ^uint32(299)
	round12HDNItemChangingA       = round12HDNFirst
	round12HDNItemChangedA        = round12HDNFirst - 1
	round12HDNDividerDblClickA    = round12HDNFirst - 5
	round12HDNBeginTrackA         = round12HDNFirst - 6
	round12HDNEndTrackA           = round12HDNFirst - 7
	round12HDNTrackA              = round12HDNFirst - 8
	round12HDNItemChangingW       = round12HDNFirst - 20
	round12HDNItemChangedW        = round12HDNFirst - 21
	round12HDNDividerDblClickW    = round12HDNFirst - 25
	round12HDNBeginTrackW         = round12HDNFirst - 26
	round12HDNEndTrackW           = round12HDNFirst - 27
	round12HDNTrackW              = round12HDNFirst - 28
)

type round12NMHeader struct {
	Hdr            nmhdr
	IItem, IButton int32
	PItem          uintptr
}

var (
	round12HeaderTopSeparator   = colorRef(207, 214, 223)
	round12HeaderBackground     = colorRef(245, 246, 248)
	round12HeaderHotBackground  = colorRef(248, 250, 252)
	round12HeaderDownBackground = colorRef(231, 243, 255)
	round12HeaderText           = colorRef(28, 39, 52)
	round12HeaderVisualCallback uintptr
	round12ThumbnailScanPosted  atomic.Bool
	round12ColumnCommitPosted   atomic.Bool
)

func init() {
	round12HeaderVisualCallback = syscall.NewCallback(round12HeaderListSubclassProc)
}

func round12InstallHeaderVisual(a *application) {
	if a == nil || a.hList == 0 || round12HeaderVisualCallback == 0 {
		return
	}
	v452RemoveSubclass.Call(a.hList, round12HeaderVisualCallback, round12HeaderVisualSubclassID)
	v452SetWindowSubclass.Call(a.hList, round12HeaderVisualCallback, round12HeaderVisualSubclassID, 0)
	if header := send(a.hList, LVM_GETHEADER, 0, 0); header != 0 {
		procInvalidateRect.Call(header, 0, 1)
	}
}

func round12HeaderWidthChanging(code uint32) bool {
	switch code {
	case round12HDNItemChangingA, round12HDNDividerDblClickA, round12HDNBeginTrackA, round12HDNTrackA,
		round12HDNItemChangingW, round12HDNDividerDblClickW, round12HDNBeginTrackW, round12HDNTrackW:
		return true
	default:
		return false
	}
}

func round12HeaderWidthCommitted(code uint32) bool {
	switch code {
	case round12HDNItemChangedA, round12HDNEndTrackA, round12HDNItemChangedW, round12HDNEndTrackW:
		return true
	default:
		return false
	}
}

func round12PostColumnGeometryCommit(hwnd uintptr) {
	if hwnd == 0 || !round12ColumnCommitPosted.CompareAndSwap(false, true) {
		return
	}
	if ok, _, _ := procPostMessageW.Call(hwnd, round12WMColumnGeometryCommit, 0, 0); ok == 0 {
		round12ColumnCommitPosted.Store(false)
	}
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
			if header != 0 && hdr.HwndFrom == header {
				if hdr.Code == NM_CUSTOMDRAW {
					return round12DrawHeaderItemTop((*nmCustomDraw)(unsafe.Pointer(lParam)))
				}
				n := (*round12NMHeader)(unsafe.Pointer(lParam))
				if round12ProfileApplyDepth.Load() == 0 && n.IItem >= 0 && int(n.IItem) < round12ColumnCount && !round12ProfileFor(a.currentKind).Visible[n.IItem] && round12HeaderWidthChanging(hdr.Code) {
					// Hidden columns are a configuration choice, not merely a saved
					// width. Cancel native tracking/double-click attempts on their
					// stacked zero-width Header dividers.
					return 1
				}
				if round12HeaderWidthCommitted(hdr.Code) {
					result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
					round12PostColumnGeometryCommit(hwnd)
					return result
				}
			}
		}
	case LVM_SETCOLUMNWIDTH:
		column, width := int(wParam), int(int32(lParam))
		if !round12ColumnWidthChangeAllowed(round12ProfileFor(a.currentKind), column, width) {
			return 0
		}
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if round12ProfileApplyDepth.Load() == 0 {
			round12PostColumnGeometryCommit(hwnd)
		}
		return result
	case WM_PAINT, WM_SIZE, WM_VSCROLL, WM_MOUSEWHEEL, LVM_INSERTITEMW, LVM_DELETEALLITEMS:
		// Observe the completed native operation without owning scroll geometry,
		// but never start thumbnail work while the ListView is still handling its
		// input/paint message. queueThumbnail can update the list synchronously;
		// doing that from this stack deadlocks a real row mouse-down.
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if round12ThumbnailScanPosted.CompareAndSwap(false, true) {
			if ok, _, _ := procPostMessageW.Call(hwnd, round12WMThumbnailScan, 0, 0); ok == 0 {
				round12ThumbnailScanPosted.Store(false)
			}
		}
		return result
	case round12WMThumbnailScan:
		round12ThumbnailScanPosted.Store(false)
		round9EnsureVisibleThumbnails(a, hwnd)
		return 0
	case round12WMColumnGeometryCommit:
		round12ColumnCommitPosted.Store(false)
		round12EnforceProfileVisibility(a)
		round12CaptureProfile(a, a.currentKind, true)
		round12SyncHeaderLine(a)
		return 0
	case v452WMNCDestroy:
		round12ThumbnailScanPosted.Store(false)
		round12ColumnCommitPosted.Store(false)
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
		return CDRF_NOTIFYITEMDRAW | CDRF_NOTIFYPOSTPAINT
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
	case CDDS_POSTPAINT:
		// Compact profiles leave intentional space to the right of the last
		// visible column. The native Header paints that area differently from
		// owner-drawn items, which made the top edge look broken and exposed stray
		// vertical seams. Finish the unused area and one continuous top separator
		// after all item states have painted.
		header := cd.Hdr.HwndFrom
		if cd.HDC == 0 || header == 0 {
			return CDRF_DODEFAULT
		}
		var client rect
		if ok, _, _ := procGetClientRect.Call(header, uintptr(unsafe.Pointer(&client))); ok == 0 {
			return CDRF_DODEFAULT
		}
		lastRight := client.Left
		count := int(send(header, round12HDMGetItemCount, 0, 0))
		for index := 0; index < count; index++ {
			var item rect
			if send(header, round12HDMGetItemRect, uintptr(index), uintptr(unsafe.Pointer(&item))) != 0 && item.Right > lastRight {
				lastRight = item.Right
			}
		}
		if lastRight < client.Right {
			fillSolid(cd.HDC, rect{Left: lastRight, Top: client.Top, Right: client.Right, Bottom: client.Bottom}, round12HeaderBackground)
		}
		fillSolid(cd.HDC, rect{Left: client.Left, Top: client.Top, Right: client.Right, Bottom: client.Top + 1}, round12HeaderTopSeparator)
		return CDRF_DODEFAULT
	}
	return CDRF_DODEFAULT
}

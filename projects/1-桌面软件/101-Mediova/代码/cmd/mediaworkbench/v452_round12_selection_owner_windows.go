//go:build windows

package main

import (
	"sync/atomic"
	"syscall"
	"unsafe"
)

const (
	round12SelectionSubclassID = 0x45C2
	round12HeaderSubclassID    = 0x45C3
	round12IDCColumnSettings   = 1072
	round12ColumnMenuBase      = 2600

	round12LVMDeleteColumn = LVM_FIRST + 28
	round12LVMSetColumnW   = LVM_FIRST + 96
	round12HDMGetItemCount = 0x1200
)

const (
	round12ColNumber = iota
	round12ColPreview
	round12ColFile
	round12ColResolution
	round12ColDuration
	round12ColDirection
	round12ColOutputResolution
	round12ColQuality
	round12ColRotation
	round12ColInputSize
	round12ColOutputSize
	round12ColProgress
	round12ColStatus
	round12ColTimeCrop
	round12ColPictureCrop
	round12ColumnCount
)

type round12ColumnDefinition struct {
	name  string
	width int
}

var round12Columns = []round12ColumnDefinition{
	{"#", 44}, {"预览", 100}, {"文件名", 230}, {"分辨率", 100}, {"时长", 76},
	{"方向", 66}, {"输出分辨率", 116}, {"质量", 58}, {"旋转", 88}, {"体积", 92},
	{"压缩后", 140}, {"进度", 105}, {"状态", 124}, {"时间剪裁", 118}, {"画面剪裁", 92},
}

var (
	round12SelectionBorder    = colorRef(50, 118, 205)
	round12SelectionText      = colorRef(42, 55, 70)
	round12CellSeparator      = colorRef(232, 237, 243)
	round12SelectionInstalled atomic.Bool
	round12HeaderInstalled    atomic.Bool
	round12SelectionCallback  uintptr
	round12HeaderCallback     uintptr
)

func init() {
	round12SelectionCallback = syscall.NewCallback(round12SelectionMainSubclassProc)
	round12HeaderCallback = syscall.NewCallback(round12HeaderSubclassProc)
}

func round12SelectionMainSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	a := app
	if a == nil || hwnd != a.hwnd {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}

	switch message {
	case WM_NOTIFY:
		if lParam != 0 {
			hdr := (*nmhdr)(unsafe.Pointer(lParam))
			header := send(a.hList, LVM_GETHEADER, 0, 0)
			if hdr.Code == NM_CUSTOMDRAW && header != 0 && hdr.HwndFrom == header {
				return round12DrawHeaderItemTop((*nmCustomDraw)(unsafe.Pointer(lParam)))
			}
			if hdr.HwndFrom == a.hList {
				switch hdr.Code {
				case NM_CUSTOMDRAW:
					return round12DrawTaskListCell(a, (*nmListViewCustomDraw)(unsafe.Pointer(lParam)))
				case LVN_ITEMCHANGED:
					n := (*nmListView)(unsafe.Pointer(lParam))
					if n.IItem >= 0 && (n.UNewState^n.UOldState)&LVIS_SELECTED != 0 {
						// The selection owns only its outline. Repaint the changed row and
						// its neighbours because joining or splitting a contiguous group
						// changes the group's top and bottom boundary.
						round12InvalidateTaskSelectionNeighborhood(a, int(n.IItem))
					}
				case LVN_COLUMNCLICK:
					n := (*nmListView)(unsafe.Pointer(lParam))
					if legacy, ok := round12LegacySortColumn(int(n.IItemSub)); ok {
						a.toggleTaskSort(legacy)
					}
					return 0
				}
			}
		}
	case WM_COMMAND:
		id := int(loWord(wParam))
		if id == IDC_TRIM_CROP || id == ID_CTX_TRIM {
			// Arm only the exclusive preview owner before the inherited handler
			// creates the modal editor. The retired watcher must never start its
			// own bounded fallback loop in the current Round12 path.
			round12ArmExclusiveTrimPreviewOwner()
		}
		if id == round12IDCColumnSettings {
			round12ShowColumnSettings(a)
			return 0
		}
		if id == ID_VIEW_RESET_COLUMNS {
			round12SetProfile(a.currentKind, round12DefaultProfileFor(a.currentKind))
			round12ApplyProfile(a, a.currentKind)
			round12PersistProfiles(a)
			round12SyncHeaderLine(a)
			return 0
		}
		if column := id - round12ColumnMenuBase; round12ToggleAllowed(column) {
			round12ToggleColumn(a, column)
			round12SyncHeaderLine(a)
			return 0
		}
		if id == IDC_TAB_VIDEO || id == IDC_TAB_IMAGE {
			a.beginAtomicUIRefresh()
			defer a.endAtomicUIRefresh()
			round12CaptureProfile(a, a.currentKind, true)
			result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
			round12EnsureListStructure(a)
			round12ApplyProfile(a, a.currentKind)
			round12LayoutTopButtons(a)
			round12SyncHeaderLine(a)
			return result
		}
		if id == IDC_RIGHT_TOGGLE {
			result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
			round12LayoutTopButtons(a)
			round12SyncHeaderLine(a)
			return result
		}
	case WM_DRAWITEM:
		if lParam != 0 {
			dis := (*drawItemStruct)(unsafe.Pointer(lParam))
			if round12DrawBufferedOverallProgress(a, dis) {
				return 1
			}
			if dis.HwndItem == a.hHeaderLine {
				fillSolid(dis.HDC, dis.RcItem, round12HeaderBottomSeparator)
				return 1
			}
			if round12DrawColumnButton(dis) {
				return 1
			}
		}
	case round7FeedbackWMInit:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round12EnsureListStructure(a)
		round12ApplyProfile(a, a.currentKind)
		round12LayoutTopButtons(a)
		round12InstallPreviewThumbnails(a)
		round12SyncHeaderLine(a)
		return result
	case WM_SIZE:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		// Resizing the window does not change the user's column profile. Reapplying
		// all 15 widths here caused 15 synchronous ListView geometry transactions
		// for every size message and made native scroll recalculation visibly lag.
		round12EnsureListStructure(a)
		round12LayoutTopButtons(a)
		round12InstallPreviewThumbnails(a)
		round12SyncHeaderLine(a)
		return result
	case WM_APP_REFRESH:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if !round12ListStructureReady(a) {
			round12EnsureListStructure(a)
			round12ApplyProfile(a, a.currentKind)
		}
		round12InstallPreviewThumbnails(a)
		round12SyncHeaderLine(a)
		return result
	case WM_DESTROY:
		round12CaptureProfile(a, a.currentKind, true)
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round12SelectionCallback, subclassID)
		round12SelectionInstalled.Store(false)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round12LegacySortColumn(column int) (int, bool) {
	switch {
	case column == round12ColNumber:
		return taskColNumber, true
	case column == round12ColPreview:
		return taskColNumber, true
	case column >= round12ColFile && column <= round12ColStatus:
		return column - 1, true
	default:
		return 0, false
	}
}

func round12ListStructureReady(a *application) bool {
	if a == nil || a.hList == 0 {
		return false
	}
	header := send(a.hList, LVM_GETHEADER, 0, 0)
	if header == 0 {
		return false
	}
	return int(send(header, round12HDMGetItemCount, 0, 0)) == round12ColumnCount
}

func round12EnsureListStructure(a *application) {
	if a == nil || a.hList == 0 {
		return
	}
	header := send(a.hList, LVM_GETHEADER, 0, 0)
	count := 0
	if header != 0 {
		count = int(send(header, round12HDMGetItemCount, 0, 0))
	}
	structureChanged := count != round12ColumnCount
	if structureChanged {
		for count > 0 {
			send(a.hList, round12LVMDeleteColumn, 0, 0)
			count--
		}
		for index, definition := range round12Columns {
			text := p(definition.name)
			column := lvColumn{Mask: LVCF_TEXT | LVCF_WIDTH | LVCF_FMT, Fmt: LVCFMT_LEFT, Cx: int32(definition.width), PszText: text}
			send(a.hList, LVM_INSERTCOLUMNW, uintptr(index), uintptr(unsafe.Pointer(&column)))
		}
	}
	if header = send(a.hList, LVM_GETHEADER, 0, 0); header != 0 && (structureChanged || !round12HeaderInstalled.Load()) {
		v452RemoveSubclass.Call(header, round7FeedbackHeaderSubclassCB, round7FeedbackHeaderSubclassID)
		if ok, _, _ := v452SetWindowSubclass.Call(header, round12HeaderCallback, round12HeaderSubclassID, 0); ok != 0 {
			round12HeaderInstalled.Store(true)
		}
		send(header, WM_SETFONT, uiFontBold, 1)
		procInvalidateRect.Call(header, 0, 1)
	}
	round12LoadProfiles()
	round12SyncHeaderLine(a)
}

func round12SyncHeaderLine(a *application) {
	if a == nil || a.hwnd == 0 || a.hList == 0 || a.hHeaderLine == 0 {
		return
	}
	header := send(a.hList, LVM_GETHEADER, 0, 0)
	if header == 0 {
		show(a.hHeaderLine, false)
		return
	}
	var wr rect
	if ok, _, _ := procGetWindowRect.Call(header, uintptr(unsafe.Pointer(&wr))); ok == 0 {
		return
	}
	topLeft := point{X: wr.Left, Y: wr.Top}
	bottomRight := point{X: wr.Right, Y: wr.Bottom}
	procScreenToClient.Call(a.hwnd, uintptr(unsafe.Pointer(&topLeft)))
	procScreenToClient.Call(a.hwnd, uintptr(unsafe.Pointer(&bottomRight)))
	width := bottomRight.X - topLeft.X
	if width <= 0 || bottomRight.Y <= topLeft.Y {
		return
	}
	move(a.hHeaderLine, topLeft.X, bottomRight.Y-1, width, 1)
	show(a.hHeaderLine, true)
	procInvalidateRect.Call(a.hHeaderLine, 0, 1)
}

func round12HeaderSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case WM_PAINT:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if app != nil {
			round12SyncHeaderLine(app)
		}
		return result
	case WM_LBUTTONUP:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if app != nil {
			round12CaptureProfile(app, app.currentKind, true)
			round12SyncHeaderLine(app)
		}
		return result
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round12HeaderCallback, subclassID)
		round12HeaderInstalled.Store(false)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

//go:build windows

package main

import (
	"sync/atomic"
	"syscall"
	"time"
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
	round12SelectionBackground = colorRef(231, 243, 255)
	round12SelectionText       = colorRef(42, 55, 70)
	round12CellSeparator       = colorRef(232, 237, 243)
	round12SelectionInstalled  atomic.Bool
	round12SelectionCallback   uintptr
	round12HeaderCallback      uintptr
)

func init() {
	round12SelectionCallback = syscall.NewCallback(round12SelectionMainSubclassProc)
	round12HeaderCallback = syscall.NewCallback(round12HeaderSubclassProc)
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
						round12EnsureListStructure(a)
						round12LayoutTopButtons(a)
						round12InstallPreviewThumbnails(a)
						procInvalidateRect.Call(a.hList, 0, 1)
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
	if a == nil || hwnd != a.hwnd {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}

	switch message {
	case WM_NOTIFY:
		if lParam != 0 {
			hdr := (*nmhdr)(unsafe.Pointer(lParam))
			if hdr.HwndFrom == a.hList {
				switch hdr.Code {
				case NM_CUSTOMDRAW:
					return round12DrawTaskListCell(a, (*nmListViewCustomDraw)(unsafe.Pointer(lParam)))
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
		if id == round12IDCColumnSettings {
			round12ShowColumnSettings(a)
			return 0
		}
		if column := id - round12ColumnMenuBase; round12ToggleAllowed(column) {
			round12ToggleColumn(a, column)
			return 0
		}
		if id == IDC_TAB_VIDEO || id == IDC_TAB_IMAGE {
			round12CaptureProfile(a, a.currentKind, true)
			result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
			round12EnsureListStructure(a)
			round12ApplyProfile(a, a.currentKind)
			round12LayoutTopButtons(a)
			return result
		}
		if id == IDC_RIGHT_TOGGLE {
			result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
			round12LayoutTopButtons(a)
			return result
		}
	case WM_DRAWITEM:
		if lParam != 0 && round12DrawColumnButton((*drawItemStruct)(unsafe.Pointer(lParam))) {
			return 1
		}
	case WM_SIZE, WM_APP_REFRESH, round7FeedbackWMInit:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round12EnsureListStructure(a)
		round12ApplyProfile(a, a.currentKind)
		round12LayoutTopButtons(a)
		round12InstallPreviewThumbnails(a)
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

func round12EnsureListStructure(a *application) {
	if a == nil || a.hList == 0 {
		return
	}
	header := send(a.hList, LVM_GETHEADER, 0, 0)
	count := 0
	if header != 0 {
		count = int(send(header, round12HDMGetItemCount, 0, 0))
	}
	if count != round12ColumnCount {
		for count > 0 {
			send(a.hList, round12LVMDeleteColumn, 0, 0)
			count--
		}
		for index, definition := range round12Columns {
			text := p(definition.name)
			column := lvColumn{Mask: LVCF_TEXT | LVCF_WIDTH | LVCF_FMT, Fmt: LVCFMT_LEFT, Cx: int32(definition.width), PszText: text}
			send(a.hList, LVM_INSERTCOLUMNW, uintptr(index), uintptr(unsafe.Pointer(&column)))
		}
	} else {
		for index, definition := range round12Columns {
			text := p(definition.name)
			column := lvColumn{Mask: LVCF_TEXT, PszText: text}
			send(a.hList, round12LVMSetColumnW, uintptr(index), uintptr(unsafe.Pointer(&column)))
		}
	}
	if header = send(a.hList, LVM_GETHEADER, 0, 0); header != 0 {
		v452RemoveSubclass.Call(header, round7FeedbackHeaderSubclassCB, round7FeedbackHeaderSubclassID)
		v452SetWindowSubclass.Call(header, round12HeaderCallback, round12HeaderSubclassID, 0)
		send(header, WM_SETFONT, uiFontBold, 1)
		procInvalidateRect.Call(header, 0, 1)
	}
	if a.hHeaderLine != 0 {
		show(a.hHeaderLine, false)
	}
	round12LoadProfiles()
}

func round12HeaderSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case WM_LBUTTONUP:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if app != nil {
			round12CaptureProfile(app, app.currentKind, true)
		}
		return result
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round12HeaderCallback, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

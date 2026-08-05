//go:build windows

package main

import (
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"

	"mediaworkbench/internal/model"
)

const (
	round7FeedbackMainSubclassID     = 0x4581
	round7FeedbackListSubclassID     = 0x4582
	round7FeedbackHeaderSubclassID   = 0x4583
	round7FeedbackEditorSubclassID   = 0x4584
	round7FeedbackTimelineSubclassID = 0x4585
	round7FeedbackCanvasSubclassID   = 0x4586
	round7FeedbackOutputSubclassID   = 0x4587

	round7FeedbackWMInit           = WM_APP + 0x581
	round7FeedbackWMEditorInit     = WM_APP + 0x583
	round7FeedbackWMFinalizeSwitch = WM_APP + 0x584

	round7FeedbackScrollTimer = 0x4582
	round7FeedbackScrollDelay = 500

	round7FeedbackWMMouseLeave  = 0x02A3
	round7FeedbackWMPrint       = 0x0317
	round7FeedbackWMPrintClient = 0x0318
	round7FeedbackTMELeave      = 0x00000002
	round7FeedbackLVMCountPerPage = LVM_FIRST + 40
	round7FeedbackLVMGetTopIndex  = LVM_FIRST + 39
	round7FeedbackLVMScroll       = LVM_FIRST + 20
	round7FeedbackSSEtchedHorz    = 0x00000010

	round7FeedbackGWLStyle   = ^uintptr(15) // -16
	round7FeedbackGWLExStyle = ^uintptr(19) // -20
	round7FeedbackWSHScroll  = 0x00100000
	round7FeedbackWSVScroll  = 0x00200000
	round7FeedbackWSBorder   = 0x00800000
	round7FeedbackWSExClientEdge = 0x00000200

	round7FeedbackSWPNoSize       = 0x0001
	round7FeedbackSWPNoMove       = 0x0002
	round7FeedbackSWPNoZOrder     = 0x0004
	round7FeedbackSWPNoActivate   = 0x0010
	round7FeedbackSWPFrameChanged = 0x0020

	round7FeedbackWMInitMenuPopup = 0x0117
	round7FeedbackWMKillFocus     = 0x0008
	round7FeedbackWMLButtonDown   = 0x0201
	round7FeedbackEMSetSel        = 0x00B1
)

type round7FeedbackTrackMouseEvent struct {
	CbSize      uint32
	DwFlags     uint32
	HwndTrack   uintptr
	DwHoverTime uint32
}

type round7FeedbackComboBoxInfo struct {
	CbSize      uint32
	RcItem      rect
	RcButton    rect
	StateButton uint32
	HwndCombo   uintptr
	HwndItem    uintptr
	HwndList    uintptr
}

type round7FeedbackEditorDecor struct {
	timeTitle uintptr
	timeLine  uintptr
	cropTitle uintptr
	cropLine  uintptr
}

type round7FeedbackLampKey struct {
	diameter int
	lamp     uintptr
	back     uintptr
}

var (
	round7FeedbackMainEventCB      uintptr
	round7FeedbackMainSubclassCB   uintptr
	round7FeedbackListSubclassCB   uintptr
	round7FeedbackHeaderSubclassCB uintptr
	round7FeedbackOutputSubclassCB uintptr
	round7FeedbackEditorEventCB    uintptr
	round7FeedbackEditorSubclassCB uintptr
	round7FeedbackTimelineCB       uintptr
	round7FeedbackCanvasCB         uintptr

	round7FeedbackMainHook      uintptr
	round7FeedbackEditorHook    uintptr
	round7FeedbackMainInstalled atomic.Bool
	round7FeedbackEditorHookMu  sync.Mutex
	round7FeedbackDecor         sync.Map
	round7FeedbackLampCache     sync.Map

	round7FeedbackHeaderWidths []int
	round7FeedbackSwitchFocus  uintptr
	round7FeedbackSwitchPending int
	round7FeedbackInLayout     bool

	round7FeedbackUnhookWinEvent      = user32.NewProc("UnhookWinEvent")
	round7FeedbackTrackMouseEventProc = user32.NewProc("TrackMouseEvent")
	round7FeedbackCreateCompatibleBmp = gdi32.NewProc("CreateCompatibleBitmap")
	round7FeedbackBitBlt              = gdi32.NewProc("BitBlt")
	round7FeedbackGetWindowLongPtr    = user32.NewProc("GetWindowLongPtrW")
	round7FeedbackSetWindowLongPtr    = user32.NewProc("SetWindowLongPtrW")
	round7FeedbackSetWindowPos        = user32.NewProc("SetWindowPos")
	round7FeedbackBeginDeferWindowPos = user32.NewProc("BeginDeferWindowPos")
	round7FeedbackDeferWindowPos      = user32.NewProc("DeferWindowPos")
	round7FeedbackEndDeferWindowPos   = user32.NewProc("EndDeferWindowPos")
	round7FeedbackGetComboBoxInfo     = user32.NewProc("GetComboBoxInfo")
	round7FeedbackHideCaret           = user32.NewProc("HideCaret")
	round7FeedbackModifyMenu          = user32.NewProc("ModifyMenuW")
)

func init() {
	round7FeedbackMainEventCB = syscall.NewCallback(round7FeedbackMainEventProc)
	round7FeedbackMainSubclassCB = syscall.NewCallback(round7FeedbackMainSubclassProc)
	round7FeedbackListSubclassCB = syscall.NewCallback(round7FeedbackListSubclassProc)
	round7FeedbackHeaderSubclassCB = syscall.NewCallback(round7FeedbackHeaderSubclassProc)
	round7FeedbackOutputSubclassCB = syscall.NewCallback(round7FeedbackOutputSubclassProc)
	round7FeedbackEditorEventCB = syscall.NewCallback(round7FeedbackEditorEventProc)
	round7FeedbackEditorSubclassCB = syscall.NewCallback(round7FeedbackEditorSubclassProc)
	round7FeedbackTimelineCB = syscall.NewCallback(round7FeedbackTimelineSubclassProc)
	round7FeedbackCanvasCB = syscall.NewCallback(round7FeedbackCanvasSubclassProc)

	round7FeedbackMainHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		round7FeedbackMainEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func round7FeedbackMainEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	if round7FeedbackMainInstalled.Load() || app == nil || app.hwnd == 0 || app.hList == 0 || !app.controlsReady {
		return 0
	}
	if ok, _, _ := v452SetWindowSubclass.Call(app.hwnd, round7FeedbackMainSubclassCB, round7FeedbackMainSubclassID, 0); ok == 0 {
		return 0
	}
	v452SetWindowSubclass.Call(app.hList, round7FeedbackListSubclassCB, round7FeedbackListSubclassID, 0)
	if header := send(app.hList, LVM_GETHEADER, 0, 0); header != 0 {
		v452SetWindowSubclass.Call(header, round7FeedbackHeaderSubclassCB, round7FeedbackHeaderSubclassID, 0)
		send(header, WM_SETFONT, uiFontBold, 1)
	}
	if edit := round7FeedbackOutputEdit(app.hOutputEdit); edit != 0 {
		v452SetWindowSubclass.Call(edit, round7FeedbackOutputSubclassCB, round7FeedbackOutputSubclassID, 0)
	}
	round7FeedbackStripListChrome(app)
	round7FeedbackMainInstalled.Store(true)
	procPostMessageW.Call(app.hwnd, round7FeedbackWMInit, 0, 0)
	if round7FeedbackMainHook != 0 {
		round7FeedbackUnhookWinEvent.Call(round7FeedbackMainHook)
		round7FeedbackMainHook = 0
	}
	return 0
}

func round7FeedbackMainSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	a := app
	if a == nil || a.hwnd != hwnd {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}

	switch message {
	case round7FeedbackWMInit:
		setText(a.hTrimCrop, "剪裁")
		round7FeedbackLoadColumnProfiles(a)
		round7FeedbackEnsureColumnProfile(a)
		round7FeedbackStripListChrome(a)
		round7FeedbackLayoutFooter(a)
		for _, control := range []uintptr{
			a.hAddFiles, a.hAddFolder, a.hRemove, a.hClear, a.hSelectAll,
			a.hInvert, a.hSourceDir, a.hOutputDir, a.hAllDefault,
			a.hFFStatus, a.hGPUStatus, a.hPotStatus, a.hConcurrencyStatus,
			a.hProgress, a.hStart, a.hPause, a.hStop,
		} {
			if control != 0 {
				procInvalidateRect.Call(control, 0, 0)
			}
		}
		return 0

	case round7FeedbackWMFinalizeSwitch:
		round7FeedbackEnsureColumnProfile(a)
		round7FeedbackFinalizeOutputFocus(a)
		return 0

	case WM_COMMAND:
		id := int(loWord(wParam))
		if id == IDC_TRIM_CROP || id == ID_CTX_TRIM {
			round7FeedbackEditSelected(a)
			return 0
		}
		if id == IDC_TAB_VIDEO || id == IDC_TAB_IMAGE {
			target := model.KindVideo
			round7FeedbackSwitchFocus = a.hVideo
			if id == IDC_TAB_IMAGE {
				target = model.KindImage
				round7FeedbackSwitchFocus = a.hImage
			}
			result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
			round7FeedbackApplyColumnProfile(a, target)
			round7FeedbackSwitchPending = 3
			procPostMessageW.Call(hwnd, round7FeedbackWMFinalizeSwitch, 0, 0)
			return result
		}
		if id == ID_VIEW_RESET_COLUMNS {
			result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
			round7FeedbackResetColumnProfile(a, a.currentKind)
			return result
		}

	case round7FeedbackWMInitMenuPopup:
		if wParam != 0 {
			round7FeedbackModifyMenu.Call(wParam, ID_CTX_TRIM, 0, ID_CTX_TRIM, uintptr(unsafe.Pointer(p("剪裁..."))))
			round7FeedbackModifyMenu.Call(wParam, ID_CTX_COPY_TRIM_CROP, 0, ID_CTX_COPY_TRIM_CROP, uintptr(unsafe.Pointer(p("仅复制第一项的剪裁设置"))))
		}

	case WM_DRAWITEM:
		if lParam != 0 {
			dis := (*drawItemStruct)(unsafe.Pointer(lParam))
			if round7FeedbackDrawOverallProgress(a, dis) ||
				round7FeedbackDrawFlatToolbarButton(a, dis) ||
				round7FeedbackDrawAllDefault(a, dis) ||
				round7FeedbackDrawStatusChip(a, dis) ||
				round7FeedbackDrawFooterButton(a, dis) {
				return 1
			}
		}

	case WM_APP_REFRESH:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round7FeedbackEnsureColumnProfile(a)
		round7FeedbackStripListChrome(a)
		if round7FeedbackSwitchPending > 0 {
			procPostMessageW.Call(hwnd, round7FeedbackWMFinalizeSwitch, 0, 0)
		}
		return result

	case WM_SIZE:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round7FeedbackStripListChrome(a)
		round7FeedbackEnsureColumnProfile(a)
		round7FeedbackLayoutFooter(a)
		return result

	case WM_DESTROY:
		round7FeedbackSaveColumnProfiles()

	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round7FeedbackMainSubclassCB, subclassID)
	}

	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round7FeedbackHeaderSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case round7FeedbackWMLButtonDown:
		if app != nil {
			round7FeedbackHeaderWidths = round7FeedbackCurrentWidths(app)
		}
	case WM_LBUTTONUP:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if app != nil && !round7FeedbackApplyingColumns {
			after := round7FeedbackCurrentWidths(app)
			if !round7FeedbackEqualWidths(round7FeedbackHeaderWidths, after) {
				round7FeedbackCaptureColumnProfile(app, app.currentKind, true)
			}
		}
		round7FeedbackHeaderWidths = nil
		return result
	case WM_PAINT:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		hdc, _, _ := round7ListGetDC.Call(hwnd)
		if hdc != 0 {
			var rc rect
			procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
			fillSolid(hdc, rect{Left: rc.Left, Top: rc.Bottom - 1, Right: rc.Right, Bottom: rc.Bottom}, colorRef(194, 203, 214))
			round7ListReleaseDC.Call(hwnd, hdc)
		}
		return result
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round7FeedbackHeaderSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round7FeedbackOutputSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case round7FeedbackWMLButtonDown:
		round7FeedbackSwitchPending = 0
	case round7FeedbackWMKillFocus:
		send(hwnd, round7FeedbackEMSetSel, ^uintptr(0), ^uintptr(0))
		round7FeedbackHideCaret.Call(hwnd)
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round7FeedbackOutputSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round7FeedbackOutputEdit(combo uintptr) uintptr {
	if combo == 0 {
		return 0
	}
	info := round7FeedbackComboBoxInfo{CbSize: uint32(unsafe.Sizeof(round7FeedbackComboBoxInfo{}))}
	if ok, _, _ := round7FeedbackGetComboBoxInfo.Call(combo, uintptr(unsafe.Pointer(&info))); ok != 0 && info.HwndItem != 0 {
		return info.HwndItem
	}
	return combo
}

func round7FeedbackFinalizeOutputFocus(a *application) {
	if a == nil || a.hOutputEdit == 0 || round7FeedbackSwitchPending <= 0 {
		return
	}
	edit := round7FeedbackOutputEdit(a.hOutputEdit)
	if edit != 0 {
		send(edit, round7FeedbackEMSetSel, ^uintptr(0), ^uintptr(0))
		round7FeedbackHideCaret.Call(edit)
		procInvalidateRect.Call(edit, 0, 0)
	}
	procInvalidateRect.Call(a.hOutputEdit, 0, 0)
	if round7FeedbackSwitchFocus != 0 {
		procSetFocus.Call(round7FeedbackSwitchFocus)
	} else if a.hList != 0 {
		procSetFocus.Call(a.hList)
	}
	round7FeedbackSwitchPending--
}

func round7FeedbackStripListChrome(a *application) {
	if a == nil || a.hList == 0 {
		return
	}
	style, _, _ := round7FeedbackGetWindowLongPtr.Call(a.hList, round7FeedbackGWLStyle)
	newStyle := style &^ uintptr(round7FeedbackWSHScroll|round7FeedbackWSVScroll|round7FeedbackWSBorder)
	exStyle, _, _ := round7FeedbackGetWindowLongPtr.Call(a.hList, round7FeedbackGWLExStyle)
	newExStyle := exStyle &^ uintptr(round7FeedbackWSExClientEdge)
	changed := false
	if newStyle != style {
		round7FeedbackSetWindowLongPtr.Call(a.hList, round7FeedbackGWLStyle, newStyle)
		changed = true
	}
	if newExStyle != exStyle {
		round7FeedbackSetWindowLongPtr.Call(a.hList, round7FeedbackGWLExStyle, newExStyle)
		changed = true
	}
	if changed {
		round7FeedbackSetWindowPos.Call(a.hList, 0, 0, 0, 0, 0,
			round7FeedbackSWPNoMove|round7FeedbackSWPNoSize|round7FeedbackSWPNoZOrder|round7FeedbackSWPNoActivate|round7FeedbackSWPFrameChanged)
	}
	send(a.hList, LVM_FIRST+1, 0, colorRef(255, 255, 255))
	send(a.hList, LVM_FIRST+36, 0, colorRef(50, 60, 74))
	send(a.hList, LVM_FIRST+38, 0, colorRef(255, 255, 255))
}

func round7FeedbackLayoutFooter(a *application) {
	if a == nil || a.hwnd == 0 || a.hStatusText == 0 || a.hStart == 0 || a.hPause == 0 || a.hStop == 0 || round7FeedbackInLayout {
		return
	}
	round7FeedbackInLayout = true
	defer func() { round7FeedbackInLayout = false }()

	var client rect
	procGetClientRect.Call(a.hwnd, uintptr(unsafe.Pointer(&client)))
	statusRect, ok := childClientRect(a.hStatusText, a.hwnd)
	if !ok {
		return
	}
	margin := scaleDPI(8)
	gap := scaleDPI(8)
	rowH := statusRect.Bottom - statusRect.Top
	if rowH < scaleDPI(34) {
		rowH = scaleDPI(36)
	}
	y := statusRect.Top
	if y < 0 || y+rowH > client.Bottom {
		y = client.Bottom - rowH - scaleDPI(6)
	}
	startW, pauseW, stopW := scaleDPI(132), scaleDPI(118), scaleDPI(110)
	if client.Right < scaleDPI(1180) {
		startW, pauseW, stopW = scaleDPI(116), scaleDPI(106), scaleDPI(100)
	}
	stopX := client.Right - margin - stopW
	pauseX := stopX - gap - pauseW
	startX := pauseX - gap - startW
	statusW := startX - gap - margin
	if statusW < scaleDPI(120) {
		return
	}

	hdwp, _, _ := round7FeedbackBeginDeferWindowPos.Call(4)
	if hdwp == 0 {
		procMoveWindow.Call(a.hStatusText, uintptr(margin), uintptr(y), uintptr(statusW), uintptr(rowH), 1)
		procMoveWindow.Call(a.hStart, uintptr(startX), uintptr(y), uintptr(startW), uintptr(rowH), 1)
		procMoveWindow.Call(a.hPause, uintptr(pauseX), uintptr(y), uintptr(pauseW), uintptr(rowH), 1)
		procMoveWindow.Call(a.hStop, uintptr(stopX), uintptr(y), uintptr(stopW), uintptr(rowH), 1)
		return
	}
	flags := uintptr(round7FeedbackSWPNoZOrder | round7FeedbackSWPNoActivate)
	for _, item := range []struct {
		h       uintptr
		x, y, w, hgt int32
	}{
		{a.hStatusText, margin, y, statusW, rowH},
		{a.hStart, startX, y, startW, rowH},
		{a.hPause, pauseX, y, pauseW, rowH},
		{a.hStop, stopX, y, stopW, rowH},
	} {
		next, _, _ := round7FeedbackDeferWindowPos.Call(hdwp, item.h, 0, uintptr(item.x), uintptr(item.y), uintptr(item.w), uintptr(item.hgt), flags)
		if next != 0 {
			hdwp = next
		}
	}
	round7FeedbackEndDeferWindowPos.Call(hdwp)
}

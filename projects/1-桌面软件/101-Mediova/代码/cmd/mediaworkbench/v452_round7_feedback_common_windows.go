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

	round7FeedbackWMInit        = WM_APP + 0x581
	round7FeedbackWMSaveColumns = WM_APP + 0x582
	round7FeedbackWMEditorInit  = WM_APP + 0x583

	round7FeedbackScrollTimer = 0x4582
	round7FeedbackScrollDelay = 500

	round7FeedbackSBHorz = 0
	round7FeedbackSBVert = 1
	round7FeedbackSBBoth = 3

	round7FeedbackWMMouseLeave    = 0x02A3
	round7FeedbackWMNCMouseMove   = 0x00A0
	round7FeedbackWMNCLButtonDown = 0x00A1
	round7FeedbackWMNCLButtonUp   = 0x00A2
	round7FeedbackWMVScroll       = 0x0115
	round7FeedbackHTHScroll       = 6
	round7FeedbackHTVScroll       = 7
	round7FeedbackTMELeave        = 0x00000002
	round7FeedbackLVMCountPerPage = LVM_FIRST + 40
	round7FeedbackSSEtchedHorz    = 0x00000010
)

type round7FeedbackTrackMouseEvent struct {
	CbSize      uint32
	DwFlags     uint32
	HwndTrack   uintptr
	DwHoverTime uint32
}

type round7FeedbackScrollState struct {
	wantH    bool
	wantV    bool
	visibleH bool
	visibleV bool
	dragging bool
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
	round7FeedbackEditorEventCB    uintptr
	round7FeedbackEditorSubclassCB uintptr
	round7FeedbackTimelineCB       uintptr
	round7FeedbackCanvasCB         uintptr

	round7FeedbackMainHook      uintptr
	round7FeedbackEditorHook    uintptr
	round7FeedbackMainInstalled atomic.Bool
	round7FeedbackEditorHookMu  sync.Mutex
	round7FeedbackProfilesMu    sync.Mutex
	round7FeedbackProfiles      round7FeedbackColumnProfiles
	round7FeedbackProfilesReady bool
	round7FeedbackScroll        round7FeedbackScrollState
	round7FeedbackDecor         sync.Map
	round7FeedbackLampCache     sync.Map

	round7FeedbackUnhookWinEvent      = user32.NewProc("UnhookWinEvent")
	round7FeedbackShowScrollBar       = user32.NewProc("ShowScrollBar")
	round7FeedbackTrackMouseEventProc = user32.NewProc("TrackMouseEvent")
	round7FeedbackCreateCompatibleBmp = gdi32.NewProc("CreateCompatibleBitmap")
	round7FeedbackBitBlt              = gdi32.NewProc("BitBlt")
)

func init() {
	round7FeedbackMainEventCB = syscall.NewCallback(round7FeedbackMainEventProc)
	round7FeedbackMainSubclassCB = syscall.NewCallback(round7FeedbackMainSubclassProc)
	round7FeedbackListSubclassCB = syscall.NewCallback(round7FeedbackListSubclassProc)
	round7FeedbackHeaderSubclassCB = syscall.NewCallback(round7FeedbackHeaderSubclassProc)
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
	ok, _, _ := v452SetWindowSubclass.Call(app.hwnd, round7FeedbackMainSubclassCB, round7FeedbackMainSubclassID, 0)
	if ok == 0 {
		return 0
	}
	v452SetWindowSubclass.Call(app.hList, round7FeedbackListSubclassCB, round7FeedbackListSubclassID, 0)
	if header := send(app.hList, LVM_GETHEADER, 0, 0); header != 0 {
		v452SetWindowSubclass.Call(header, round7FeedbackHeaderSubclassCB, round7FeedbackHeaderSubclassID, 0)
	}
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
		// Reinsert once after every one-shot v4.5.2 hook has installed. This
		// keeps the final visual policy above the older owner-draw handlers
		// without polling, timers or repeated invalidation.
		v452RemoveSubclass.Call(hwnd, round7FeedbackMainSubclassCB, subclassID)
		v452SetWindowSubclass.Call(hwnd, round7FeedbackMainSubclassCB, round7FeedbackMainSubclassID, 0)
		round7FeedbackLoadColumnProfiles(a)
		round7FeedbackApplyColumnProfile(a, a.currentKind)
		round7FeedbackHideScrollbars(a.hList)
		if a.selfTest {
			round7FeedbackArmEditorHook()
		}
		for _, control := range []uintptr{
			a.hAddFiles, a.hAddFolder, a.hRemove, a.hClear, a.hSelectAll,
			a.hInvert, a.hSourceDir, a.hOutputDir, a.hAllDefault,
			a.hFFStatus, a.hGPUStatus, a.hPotStatus, a.hConcurrencyStatus,
		} {
			if control != 0 {
				procInvalidateRect.Call(control, 0, 0)
			}
		}
		return 0

	case round7FeedbackWMSaveColumns:
		round7FeedbackCaptureColumnProfile(a, a.currentKind, true)
		return 0

	case WM_COMMAND:
		id := int(loWord(wParam))
		if id == IDC_TRIM_CROP || id == ID_CTX_TRIM {
			round7FeedbackEditSelected(a)
			return 0
		}
		if id == IDC_TAB_VIDEO || id == IDC_TAB_IMAGE {
			outgoing := a.currentKind
			target := model.KindVideo
			targetFocus := a.hVideo
			if id == IDC_TAB_IMAGE {
				target = model.KindImage
				targetFocus = a.hImage
			}
			if outgoing != target {
				round7FeedbackCaptureColumnProfile(a, outgoing, false)
			}
			result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
			round7FeedbackApplyColumnProfile(a, target)
			v452ClearComboSelection(a, a.hOutputEdit, a.v420OutputLocked(target))
			if targetFocus != 0 {
				procSetFocus.Call(targetFocus)
			}
			procInvalidateRect.Call(a.hOutputEdit, 0, 0)
			round7FeedbackSaveColumnProfiles()
			return result
		}
		if id == ID_VIEW_RESET_COLUMNS {
			result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
			round7FeedbackCaptureColumnProfile(a, a.currentKind, true)
			return result
		}

	case WM_DRAWITEM:
		if lParam != 0 {
			dis := (*drawItemStruct)(unsafe.Pointer(lParam))
			if round7FeedbackDrawFlatToolbarButton(a, dis) ||
				round7FeedbackDrawAllDefault(a, dis) ||
				round7FeedbackDrawStatusChip(a, dis) {
				return 1
			}
		}

	case WM_DESTROY:
		round7FeedbackCaptureColumnProfile(a, a.currentKind, true)

	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round7FeedbackMainSubclassCB, subclassID)
	}

	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round7FeedbackHeaderSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	switch message {
	case WM_LBUTTONUP:
		if app != nil && app.hwnd != 0 {
			procPostMessageW.Call(app.hwnd, round7FeedbackWMSaveColumns, 0, 0)
		}
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round7FeedbackHeaderSubclassCB, subclassID)
	}
	return result
}

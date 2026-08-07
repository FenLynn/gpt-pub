//go:build windows

package main

import (
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

const round12BridgeSubclassID = 0x45C4

var (
	round12BridgeCallback  uintptr
	round12BridgeInstalled atomic.Bool
)

func init() {
	round12BridgeCallback = syscall.NewCallback(round12BridgeMainSubclassProc)
	go round12BridgeInstallLoop()
}

// round12BridgeInstallLoop removes the start-order dependency between the
// round-7 WinEvent hook and the final round-12 list owner. The old installer
// waited for round7FeedbackMainInstalled, which is not guaranteed to become
// true before UI-preview/self-test captures the window. Reconcile directly
// once controls are ready, then keep a short startup guard window so any late
// legacy layout pass is overwritten by the final 15-column structure.
func round12BridgeInstallLoop() {
	deadline := time.Now().Add(30 * time.Second)
	var activeSince time.Time
	for time.Now().Before(deadline) {
		a := app
		if a != nil && a.hwnd != 0 && a.hList != 0 && a.controlsReady && round12SelectionCallback != 0 {
			round12BridgeScheduleReconcile(a)
			if round12SelectionInstalled.Load() && round12BridgeInstalled.Load() {
				if activeSince.IsZero() {
					activeSince = time.Now()
				}
				if time.Since(activeSince) >= 5*time.Second {
					return
				}
			} else {
				activeSince = time.Time{}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func round12BridgeScheduleReconcile(a *application) {
	if a == nil || a.hwnd == 0 {
		return
	}
	a.postUI(func() {
		if app != a || a.hwnd == 0 || a.hList == 0 || !a.controlsReady {
			return
		}
		round12BridgeReconcile(a)
	})
}

func round12BridgeReconcile(a *application) {
	if a == nil || a.hwnd == 0 || a.hList == 0 || round12SelectionCallback == 0 {
		return
	}
	if !round12SelectionInstalled.Load() {
		if ok, _, _ := v452SetWindowSubclass.Call(a.hwnd, round12SelectionCallback, round12SelectionSubclassID, 0); ok != 0 {
			round12SelectionInstalled.Store(true)
		}
	}
	if !round12SelectionInstalled.Load() {
		return
	}
	if !round12BridgeInstalled.Load() && round12BridgeCallback != 0 {
		if ok, _, _ := v452SetWindowSubclass.Call(a.hwnd, round12BridgeCallback, round12BridgeSubclassID, 0); ok != 0 {
			round12BridgeInstalled.Store(true)
		}
	}

	round12EnsureListStructure(a)
	round12ApplyProfile(a, a.currentKind)
	round12LayoutTopButtons(a)
	round12InstallPreviewThumbnails(a)
	procInvalidateRect.Call(a.hList, 0, 1)
}

// The bridge stays outside the round-12 owner in the subclass chain. Besides
// scheduling a final reconcile after legacy layout-sensitive messages, it
// observes the same NM_CUSTOMDRAW notifications used by the native self-test.
// The actual pixels are still rendered by round12DrawTaskListCell; these
// counters only prove that the compression/progress subitems reached that path.
func round12BridgeMainSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	a := app
	if a == nil || hwnd != a.hwnd {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}

	switch message {
	case WM_NOTIFY:
		if lParam != 0 {
			hdr := (*nmhdr)(unsafe.Pointer(lParam))
			if hdr.HwndFrom == a.hList && hdr.Code == NM_CUSTOMDRAW {
				cd := (*nmListViewCustomDraw)(unsafe.Pointer(lParam))
				if cd.NMCD.DrawStage == CDDS_ITEMPREPAINT|CDDS_SUBITEM {
					switch int(cd.ISubItem) {
					case round12ColOutputSize:
						listCompressionDrawCount.Add(1)
					case round12ColProgress:
						listProgressDrawCount.Add(1)
					}
				}
			}
		}
	case WM_SIZE, WM_APP_REFRESH:
		round12BridgeScheduleReconcile(a)
	case WM_COMMAND:
		id := int(loWord(wParam))
		if id == IDC_TAB_VIDEO || id == IDC_TAB_IMAGE || id == IDC_RIGHT_TOGGLE || id == ID_VIEW_RESET_COLUMNS || id == round12IDCColumnSettings || (id >= round12ColumnMenuBase && id < round12ColumnMenuBase+round12ColumnCount) {
			round12BridgeScheduleReconcile(a)
		}
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round12BridgeCallback, subclassID)
		round12BridgeInstalled.Store(false)
	}

	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

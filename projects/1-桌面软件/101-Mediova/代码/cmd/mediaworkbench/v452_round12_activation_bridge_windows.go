//go:build windows

package main

import (
	"sync/atomic"
	"syscall"
	"unsafe"
)

const round12BridgeSubclassID = 0x45C4

var (
	round12BridgeCallback  uintptr
	round12BridgeInstalled atomic.Bool
)

func init() {
	round12BridgeCallback = syscall.NewCallback(round12BridgeMainSubclassProc)
}

func round12BridgeReconcile(a *application) {
	if a == nil || a.hwnd == 0 || a.hList == 0 || round12SelectionCallback == 0 {
		return
	}
	firstInstall := false
	if !round12SelectionInstalled.Load() {
		if ok, _, _ := v452SetWindowSubclass.Call(a.hwnd, round12SelectionCallback, round12SelectionSubclassID, 0); ok != 0 {
			round12SelectionInstalled.Store(true)
			firstInstall = true
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
	if firstInstall {
		procInvalidateRect.Call(a.hList, 0, 1)
	}
}

// The bridge stays outside the round-12 owner in the subclass chain and
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
	case WM_APP_UI:
		// Every asynchronous preview worker returns to the UI through WM_APP_UI.
		// Reconcile the exclusive Round12 preview owner here so an inherited
		// watcher cannot regain navigation ownership after a worker completes.
		if e := round7ActiveEditor; e != nil && e.hwnd != 0 && e.dialog != nil && e.dialog.hCanvas != 0 {
			round12InstallExclusiveTrimPreviewOwner(e)
		}
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round12BridgeCallback, subclassID)
		round12BridgeInstalled.Store(false)
	}

	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

//go:build windows

package main

import (
	"syscall"
	"time"
)

const (
	round8EditorInstallerSubclassID = 0x4589
	round8WMInstallEditor           = WM_APP + 0x589
)

var round8EditorInstallerCB uintptr

func init() {
	// Replace the old timing-sensitive WinEvent callback before any editor hook
	// is armed. The callback only posts one installer message; all real work is
	// performed on the editor UI thread after WM_CREATE has finished.
	round7FeedbackEditorEventCB = syscall.NewCallback(round8EditorInstallEventProc)
	round8EditorInstallerCB = syscall.NewCallback(round8EditorInstallerSubclassProc)

	// Native self-test opens the editor directly. Arm the same one-shot product
	// installer once the main UI exists; this branch is never active normally.
	if round7NativeEnabled {
		go func() {
			for attempt := 0; attempt < 400; attempt++ {
				if app != nil && app.hwnd != 0 && app.controlsReady {
					app.postUI(func() { round7FeedbackArmEditorHook() })
					return
				}
				time.Sleep(25 * time.Millisecond)
			}
		}()
	}
}

func round8EditorInstallEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	e := round7ActiveEditor
	if e == nil || e.hwnd == 0 {
		return 0
	}
	if ok, _, _ := v452SetWindowSubclass.Call(e.hwnd, round8EditorInstallerCB, round8EditorInstallerSubclassID, 0); ok == 0 {
		return 0
	}
	procPostMessageW.Call(e.hwnd, round8WMInstallEditor, 0, 0)

	round7FeedbackEditorHookMu.Lock()
	if round7FeedbackEditorHook != 0 {
		round7FeedbackUnhookWinEvent.Call(round7FeedbackEditorHook)
		round7FeedbackEditorHook = 0
	}
	round7FeedbackEditorHookMu.Unlock()
	return 0
}

func round8EditorInstallerSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == round8WMInstallEditor {
		e := round7ActiveEditor
		if e != nil && e.hwnd == hwnd && e.dialog != nil && e.hTimeline != 0 && e.dialog.hCanvas != 0 {
			v452SetWindowSubclass.Call(hwnd, round7FeedbackEditorSubclassCB, round7FeedbackEditorSubclassID, 0)
			v452SetWindowSubclass.Call(e.hTimeline, round7FeedbackTimelineCB, round7FeedbackTimelineSubclassID, 0)
			v452SetWindowSubclass.Call(e.dialog.hCanvas, round7FeedbackCanvasCB, round7FeedbackCanvasSubclassID, 0)
			round7FeedbackApplyEditorLayout(e)
			procRedrawWindow.Call(hwnd, 0, 0, RDW_INVALIDATE|RDW_ALLCHILDREN|RDW_UPDATENOW)
			v452RemoveSubclass.Call(hwnd, round8EditorInstallerCB, subclassID)
			return 0
		}
		// Controls are still being created. Requeue once without a timer; the
		// message cannot run until the current creation call unwinds.
		procPostMessageW.Call(hwnd, round8WMInstallEditor, 0, 0)
		return 0
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, round8EditorInstallerCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

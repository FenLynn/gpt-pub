//go:build windows

package main

import (
	"path/filepath"
	"syscall"
	"time"
)

const (
	round8EditorInstallerSubclassID = 0x4589
	round8WMInstallEditor           = WM_APP + 0x589
)

var round8EditorInstallerCB uintptr

func init() {
	round7FeedbackEditorEventCB = syscall.NewCallback(round8EditorInstallEventProc)
	round8EditorInstallerCB = syscall.NewCallback(round8EditorInstallerSubclassProc)

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
			// Round 11 owns layout, parent painting, timeline input/painting and
			// crop interaction. The inherited round-7 layout chain is deliberately
			// not installed, eliminating the two-layout WM_SIZE loop.
			round11InstallEditor(e)
			// Round 12 owns navigation preview. Install it after the final Round 11
			// editor/timeline chain so no later inherited subclass can regain
			// navigation ownership.
			round12FinalizeExclusiveTrimPreviewOwner(e)
			// The title belongs to the final installer and is written once. It no
			// longer depends on either inherited layout subclass.
			round11SetTextIfChanged(e.hwnd, "剪裁 · "+filepath.Base(e.dialog.task.Input))
			v452RemoveSubclass.Call(hwnd, round8EditorInstallerCB, subclassID)
			return 0
		}
		procPostMessageW.Call(hwnd, round8WMInstallEditor, 0, 0)
		return 0
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, round8EditorInstallerCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

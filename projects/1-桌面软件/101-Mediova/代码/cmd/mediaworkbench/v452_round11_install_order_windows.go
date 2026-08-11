//go:build windows

package main

import "time"

// Install the final task-list ownership chain deterministically on the UI
// thread. Round7 performs the inherited one-time initialization, then its
// ListView subclass is removed. Round11's main/list scrollbar owners are never
// installed. Round12 keeps one ListView scroll/input owner; the parent bridge only
// supplies the control-final post-paint notification.
func init() {
	go func() {
		for attempt := 0; attempt < 800; attempt++ {
			a := app
			if a != nil && a.hwnd != 0 && a.hList != 0 && a.controlsReady {
				a.postUI(func() {
					// Finish inherited initialization once so column profiles, header,
					// output controls and fonts keep their established behavior.
					round7FeedbackMainEventProc(0, 0, 0, 0, 0, 0, 0)

					// The task list itself must have exactly one runtime owner. Remove
					// every inherited ListView/main owner before Round12 is installed.
					v452RemoveSubclass.Call(a.hList, round7FeedbackListSubclassCB, round7FeedbackListSubclassID)
					v452RemoveSubclass.Call(a.hList, round11ListSubclassCB, round11ListSubclassID)
					v452RemoveSubclass.Call(a.hwnd, round11MainSubclassCB, round11MainSubclassID)
					round11MainInstalled.Store(true)
					if round11MainHook != 0 {
						round7FeedbackUnhookWinEvent.Call(round11MainHook)
						round11MainHook = 0
					}

					// Destroy every inherited scrollbar child HWND before the new
					// in-place ListView thumb owner and its post-paint bridge are attached.
					round11RetireLegacyOverlayWindows()
					round8EnsureListStyleGuard(a.hList)
					round12InstallInlineListScroll(a)
					round12InstallPostPaintOwner(a)

					if round11EditorPreviewEnabled && round11EditorPreviewStarted.CompareAndSwap(false, true) {
						round11OpenEditorPreview(a)
					}
				})
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
}

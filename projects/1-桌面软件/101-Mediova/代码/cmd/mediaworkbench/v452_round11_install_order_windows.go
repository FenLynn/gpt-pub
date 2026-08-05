//go:build windows

package main

import "time"

// WinEvent ordering is not deterministic. Previously round 11 could install
// first, then round 7 could re-add its list subclass after the final owner had
// removed it. Disable the round-11 WinEvent path before controls become ready,
// then coordinate the entire transition once on the UI thread.
func init() {
	go func() {
		for attempt := 0; attempt < 800; attempt++ {
			if round11MainHook != 0 {
				round7FeedbackUnhookWinEvent.Call(round11MainHook)
				round11MainHook = 0
				break
			}
			time.Sleep(2 * time.Millisecond)
		}
	}()

	go func() {
		for attempt := 0; attempt < 800; attempt++ {
			a := app
			if a != nil && a.hwnd != 0 && a.hList != 0 && a.controlsReady {
				a.postUI(func() {
					// Remove any premature final installation before sequencing.
					v452RemoveSubclass.Call(a.hList, round11ListSubclassCB, round11ListSubclassID)
					v452RemoveSubclass.Call(a.hwnd, round11MainSubclassCB, round11MainSubclassID)
					round11MainInstalled.Store(false)

					// Complete inherited initialization first. This sets its marker
					// and disables the inherited WinEvent hook.
					round7FeedbackMainEventProc(0, 0, 0, 0, 0, 0, 0)

					// Final ownership is always installed last. Remove the inherited
					// list subclass explicitly as well as from the finalize message,
					// so there is no frame in which both owners coexist.
					v452RemoveSubclass.Call(a.hList, round7FeedbackListSubclassCB, round7FeedbackListSubclassID)
					round11MainEventProc(0, 0, 0, 0, 0, 0, 0)

					// The dynamic editor gate is opened from the same UI transaction,
					// after final ownership has been established. Normal launches never
					// enter this branch.
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

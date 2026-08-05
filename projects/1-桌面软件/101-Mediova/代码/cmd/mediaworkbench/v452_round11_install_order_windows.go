//go:build windows

package main

import "time"

// WinEvent ordering is not deterministic. Previously round 7 could install its
// list subclass after round 11 had already removed it, briefly restoring the
// native scrollbars and sometimes reviving the old repaint path. Coordinate
// both compatibility and final ownership explicitly on the UI thread.
func init() {
	go func() {
		for attempt := 0; attempt < 800; attempt++ {
			a := app
			if a != nil && a.hwnd != 0 && a.hList != 0 && a.controlsReady {
				a.postUI(func() {
					// Complete the inherited initialization first. This sets its
					// installed marker and unhooks the old WinEvent callback.
					round7FeedbackMainEventProc(0, 0, 0, 0, 0, 0, 0)
					// Final ownership is installed second and removes the inherited
					// list subclass exactly once.
					round11MainEventProc(0, 0, 0, 0, 0, 0, 0)
				})
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
}

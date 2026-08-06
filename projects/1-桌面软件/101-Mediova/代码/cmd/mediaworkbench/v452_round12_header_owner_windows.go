//go:build windows

package main

import "time"

// Round 12 gives the native Header control sole ownership of column captions.
// Earlier layers painted a second bottom line with GetDC after WM_PAINT and a
// separate STATIC line covered the same boundary. Remove both once inherited
// initialization has completed; no runtime resize/refresh path re-adds them.
func init() {
	go func() {
		for attempt := 0; attempt < 800; attempt++ {
			a := app
			if a != nil && a.hwnd != 0 && a.hList != 0 && a.controlsReady && round7FeedbackMainInstalled.Load() {
				a.postUI(func() {
					header := send(a.hList, LVM_GETHEADER, 0, 0)
					if header != 0 {
						v452RemoveSubclass.Call(header, round7FeedbackHeaderSubclassCB, round7FeedbackHeaderSubclassID)
						send(header, WM_SETFONT, uiFontBold, 1)
						procInvalidateRect.Call(header, 0, 1)
					}
					if a.hHeaderLine != 0 {
						show(a.hHeaderLine, false)
					}
				})
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
}

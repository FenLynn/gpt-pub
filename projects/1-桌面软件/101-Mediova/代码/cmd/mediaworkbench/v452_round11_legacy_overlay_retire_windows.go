//go:build windows

package main

import (
	"time"
)

// round11RetireLegacyOverlayWindows permanently removes the inherited round-9
// cover windows after the round-11 surfaces have taken ownership. The stale
// overlay objects intentionally keep their non-zero, now-invalid HWND values:
// legacy code therefore cannot satisfy its own "create when missing" path,
// while any later ShowWindow/SetWindowPos call becomes a harmless no-op.
func round11RetireLegacyOverlayWindows() {
	round9ScrollMu.Lock()
	legacy := []*round9ScrollOverlay{round9ScrollH, round9ScrollV}
	round9ScrollMu.Unlock()
	for _, overlay := range legacy {
		if overlay == nil || overlay.hwnd == 0 {
			continue
		}
		procKillTimer.Call(overlay.hwnd, round7FeedbackScrollTimer)
		procKillTimer.Call(overlay.hwnd, round9FeedbackHideTimer)
		procShowWindow.Call(overlay.hwnd, round9FeedbackSWHide)
		overlay.visible = false
		overlay.machine = round9OverlayMachine{}
		procDestroyWindow.Call(overlay.hwnd)
	}
}

func init() {
	go func() {
		deadline := time.Now().Add(20 * time.Second)
		for time.Now().Before(deadline) {
			a := app
			if a != nil && a.hwnd != 0 && a.hList != 0 && a.controlsReady &&
				round11StableCoverH != nil && round11StableCoverV != nil {
				// Repeat only during startup convergence so a late legacy WinEvent
				// callback cannot resurrect an overlapping child after the first pass.
				for _, delay := range []time.Duration{0, 120 * time.Millisecond, 400 * time.Millisecond, time.Second} {
					time.Sleep(delay)
					a.postUI(round11RetireLegacyOverlayWindows)
				}
				return
			}
			time.Sleep(50 * time.Millisecond)
		}
	}()
}

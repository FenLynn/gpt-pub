//go:build windows

package main

// Permanently remove every inherited scrollbar child window. There is no
// sentinel HWND and no replacement surface. Once the Round7/Round11 ListView
// subclasses are removed by the install-order owner, no legacy creation path
// remains reachable.
func round11RetireLegacyOverlayWindows() {
	if app != nil {
		v452RemoveSubclass.Call(app.hwnd, round11StableCoverMainCB, round11StableCoverMainSubclassID)
		v452RemoveSubclass.Call(app.hList, round11StableCoverListCB, round11StableCoverListSubclassID)
	}

	round9DestroyScrollOverlays()

	for _, cover := range []*round11StableCover{round11StableCoverH, round11StableCoverV} {
		if cover == nil || cover.hwnd == 0 {
			continue
		}
		procKillTimer.Call(cover.hwnd, round11StableCoverShowTimer)
		procKillTimer.Call(cover.hwnd, round11StableCoverHideTimer)
		round11StableCoverByHWND.Delete(cover.hwnd)
		procDestroyWindow.Call(cover.hwnd)
	}
	round11StableCoverH = nil
	round11StableCoverV = nil
}

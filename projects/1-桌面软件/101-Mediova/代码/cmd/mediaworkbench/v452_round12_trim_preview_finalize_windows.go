//go:build windows

package main

// round12FinalizeExclusiveTrimPreviewOwner runs from the deterministic final
// editor installer after Round11 has established its parent/timeline/canvas
// subclass chain. Re-adding the Round12 navigation subclasses here makes them
// the final owners without relying on a timed reinstall loop.
func round12FinalizeExclusiveTrimPreviewOwner(e *round7Editor) {
	if e == nil || e.hwnd == 0 || e.hTimeline == 0 || e.dialog == nil || e.dialog.hCanvas == 0 {
		return
	}
	round12InstallExclusiveTrimPreviewOwner(e)
	if _, ok := round12TrimPreviewOwnerStates.Load(e.hwnd); !ok {
		return
	}

	v452RemoveSubclass.Call(e.hwnd, round12TrimPreviewOwnerEditorCB, round12TrimPreviewOwnerEditorSubclassID)
	v452RemoveSubclass.Call(e.hTimeline, round12TrimPreviewOwnerTimelineCB, round12TrimPreviewOwnerTimelineSubclassID)
	v452SetWindowSubclass.Call(e.hwnd, round12TrimPreviewOwnerEditorCB, round12TrimPreviewOwnerEditorSubclassID, 0)
	v452SetWindowSubclass.Call(e.hTimeline, round12TrimPreviewOwnerTimelineCB, round12TrimPreviewOwnerTimelineSubclassID, 0)
}

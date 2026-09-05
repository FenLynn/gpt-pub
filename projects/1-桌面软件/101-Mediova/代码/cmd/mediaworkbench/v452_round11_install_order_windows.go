//go:build windows

package main

const round12ListWSClipSiblings uintptr = 0x04000000

// round12InstallNativeListScroll establishes the ListView as the only scroll
// owner. There are no overlay windows, frozen columns, paint finalizers or
// compatibility subclasses to retire later.
func round12InstallNativeListScroll(a *application) {
	if a == nil || a.hList == 0 {
		return
	}
	style, _, _ := round7FeedbackGetWindowLongPtr.Call(a.hList, round7FeedbackGWLStyle)
	nativeStyle := style | uintptr(round7FeedbackWSHScroll|round7FeedbackWSVScroll) | round12ListWSClipSiblings
	if nativeStyle != style {
		round7FeedbackSetWindowLongPtr.Call(a.hList, round7FeedbackGWLStyle, nativeStyle)
		round7FeedbackSetWindowPos.Call(
			a.hList,
			0,
			0,
			0,
			0,
			0,
			round7FeedbackSWPNoMove|round7FeedbackSWPNoSize|round7FeedbackSWPNoZOrder|
				round7FeedbackSWPNoActivate|round7FeedbackSWPFrameChanged,
		)
	}
	send(a.hList, LVM_SETEXTENDEDLISTVIEWSTYLE, LVS_EX_DOUBLEBUFFER, LVS_EX_DOUBLEBUFFER)
}

// round12InstallFinalUIOwners is called from WM_CREATE after controlsReady is
// set. Keeping installation on that UI thread makes the owner chain independent
// of startup speed and removes every bounded installer loop.
func round12InstallFinalUIOwners(a *application) {
	if a == nil || a.hwnd == 0 || a.hList == 0 || !a.controlsReady {
		return
	}
	round7FeedbackMainEventProc(0, 0, 0, 0, 0, 0, 0)
	round12BridgeReconcile(a)
	round12InstallNativeListScroll(a)
	round12InstallHeaderVisual(a)
	round12InstallFooterOwner(a)
	round9EnsureOutputDisplay()
	round9EnsureVisibleThumbnails(a, a.hList)

	if round11EditorPreviewEnabled && round11EditorPreviewStarted.CompareAndSwap(false, true) {
		round11OpenEditorPreview(a)
	}
}

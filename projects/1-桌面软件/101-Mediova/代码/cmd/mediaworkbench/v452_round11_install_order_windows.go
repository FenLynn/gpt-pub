//go:build windows

package main

import (
	"syscall"
	"time"
)

const (
	round12ListWSClipSiblings                uintptr = 0x04000000
	round12ScrollVisualFinalizerSubclassID           = 0x45D0
)

var round12ScrollVisualFinalizerCB uintptr

func round12EnsureListSiblingClipping(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	style, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle)
	if style&round12ListWSClipSiblings != 0 {
		return
	}
	round7FeedbackSetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle, style|round12ListWSClipSiblings)
	round7FeedbackSetWindowPos.Call(
		hwnd,
		0,
		0,
		0,
		0,
		0,
		round7FeedbackSWPNoMove|round7FeedbackSWPNoSize|round7FeedbackSWPNoZOrder|
			round7FeedbackSWPNoActivate|round7FeedbackSWPFrameChanged,
	)
}

// The thumb visual is already hit-transparent through WM_NCHITTEST. Keeping
// WS_EX_TRANSPARENT as well makes Windows defer its paint behind sibling
// controls, which can let a ListView scroll repaint temporarily cover the
// thumb. Remove only that paint-order hint; the visual remains a tiny,
// non-activating, input-transparent child whose rectangle is the thumb itself.
func round12NormalizeThumbVisualPaintOrder(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	exStyle, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLExStyle)
	if exStyle&round12ThumbVisualExTransparent == 0 {
		return
	}
	round7FeedbackSetWindowLongPtr.Call(
		hwnd,
		round7FeedbackGWLExStyle,
		exStyle &^ round12ThumbVisualExTransparent,
	)
	round7FeedbackSetWindowPos.Call(
		hwnd,
		0,
		0,
		0,
		0,
		0,
		round7FeedbackSWPNoMove|round7FeedbackSWPNoSize|round7FeedbackSWPNoZOrder|
			round7FeedbackSWPNoActivate|round7FeedbackSWPFrameChanged,
	)
}

// This subclass is intentionally installed last. It lets the functional scroll
// owner, capture guard, thumbnail refresh and ListView paint complete first,
// then commits the thumb visual as the last step of the same physical drag
// transaction. The strict gate therefore observes the same stable thumb after
// every WM_MOUSEMOVE rather than a transient gap between two repaint owners.
func round12InstallScrollVisualFinalizer(a *application) {
	if a == nil || a.hList == 0 {
		return
	}
	round12NormalizeThumbVisualPaintOrder(round12ThumbVisualH)
	round12NormalizeThumbVisualPaintOrder(round12ThumbVisualV)
	v452RemoveSubclass.Call(
		a.hList,
		round12ScrollVisualFinalizerCB,
		round12ScrollVisualFinalizerSubclassID,
	)
	v452SetWindowSubclass.Call(
		a.hList,
		round12ScrollVisualFinalizerCB,
		round12ScrollVisualFinalizerSubclassID,
		0,
	)
	round12SyncThumbVisual(a.hList)
}

func round12ScrollVisualFinalizerSubclassProc(
	hwnd uintptr,
	message uint32,
	wParam, lParam uintptr,
	subclassID, refData uintptr,
) uintptr {
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, round12ScrollVisualFinalizerCB, subclassID)
		result, _, _ := v452DefSubclassProc.Call(
			hwnd,
			uintptr(message),
			wParam,
			lParam,
		)
		return result
	}

	wasDragging := round12InlineState.dragging
	result, _, _ := v452DefSubclassProc.Call(
		hwnd,
		uintptr(message),
		wParam,
		lParam,
	)

	if message == LVM_SETITEMSTATE {
		// Selection can change synchronously through keyboard navigation,
		// bulk actions or tests without waiting for a later paint callback.
		// Refresh the frozen sequence-number sibling before SendMessage returns
		// so its selection background never lags the ListView body.
		round12SyncFrozenNumberVisual(hwnd)
	}
	if message == WM_MOUSEMOVE && (wasDragging || round12InlineState.dragging) {
		round12FinalizeInlineScrollVisual(hwnd)
	}
	return result
}

// Install the final task-list ownership chain deterministically on the UI
// thread. Round7 performs the inherited one-time initialization, then its
// ListView subclass is removed. Round11's main/list scrollbar owners are never
// installed. Round12 keeps one ListView scroll/input owner; the parent bridge
// supplies the control-final post-paint notification and the finalizer commits
// the thumb after the complete drag transaction.
func init() {
	round12ScrollVisualFinalizerCB = syscall.NewCallback(round12ScrollVisualFinalizerSubclassProc)

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
					round12EnsureListSiblingClipping(a.hList)
					round12InstallInlineListScroll(a)
					round12InstallPostPaintOwner(a)
					round12InstallScrollVisualFinalizer(a)

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

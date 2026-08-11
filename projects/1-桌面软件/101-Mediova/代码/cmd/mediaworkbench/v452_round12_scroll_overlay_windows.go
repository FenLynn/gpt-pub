//go:build windows

package main

import (
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"
)

// Round12 keeps the task ListView as the only scroll/input owner. Native H/V
// scrollbar styles are rejected by the existing style guard. Two tiny sibling
// visual windows are allowed only for the visible thumb itself. Their window
// rectangles are exactly the thumb rectangles, so there is no track surface,
// gutter, border, or second interactive scrollbar.
const (
	round12ScrollSBBoth                       = 3
	round12WMDeferredScrollScrub              = WM_APP + 0x5CF
	round12PostPaintMainSubclassID            = 0x45CE
	round12CaptureGuardListSubclassID         = 0x45CF
	round12VKLeftButton                       = 0x01
	round12ThumbVisualClassName               = "MWRound12ThumbVisual"
	round12ThumbVisualExTransparent   uintptr = 0x00000020
	round12ThumbVisualWSClipSiblings  uintptr = 0x04000000
	round12ThumbVisualHTTransparent   uintptr = ^uintptr(0)
	round12CDDSPostPaint              uint32  = 0x00000002
	round12CDRFNotifyPostPaint        uintptr = 0x00000010
)

var (
	round12DeferredScrollScrubPending atomic.Bool
	round12PostPaintMainCB            uintptr
	round12CaptureGuardListCB         uintptr
	round12ThumbVisualWndProc         uintptr
	round12ThumbVisualOnce            sync.Once
	round12ThumbVisualH               uintptr
	round12ThumbVisualV               uintptr
)

func init() {
	round12PostPaintMainCB = syscall.NewCallback(round12PostPaintMainSubclassProc)
	round12CaptureGuardListCB = syscall.NewCallback(round12CaptureGuardListSubclassProc)
	round12ThumbVisualWndProc = syscall.NewCallback(round12ThumbVisualProc)
}

// Kept only for compatibility with older source contracts. The rebuilt scroll
// owner does not call ShowScrollBar because toggling native scrollbar state is
// itself a source of non-client relayout and visible flashing.
var round12ShowScrollBar = user32.NewProc("ShowScrollBar")

func round12RegisterThumbVisualClass() {
	hInst, _, _ := procGetModuleHandleW.Call(0)
	wc := wndClassEx{
		CbSize:        uint32(unsafe.Sizeof(wndClassEx{})),
		LpfnWndProc:   round12ThumbVisualWndProc,
		HInstance:     hInst,
		HbrBackground: 0,
		LpszClassName: p(round12ThumbVisualClassName),
	}
	procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
}

func round12CreateThumbVisual(parent uintptr) uintptr {
	if parent == 0 {
		return 0
	}
	round12ThumbVisualOnce.Do(round12RegisterThumbVisualClass)
	hInst, _, _ := procGetModuleHandleW.Call(0)
	hwnd, _, _ := procCreateWindowExW.Call(
		round12ThumbVisualExTransparent|WS_EX_NOACTIVATE,
		uintptr(unsafe.Pointer(p(round12ThumbVisualClassName))),
		uintptr(unsafe.Pointer(p(""))),
		WS_CHILD|round12ThumbVisualWSClipSiblings,
		0, 0, 1, 1,
		parent, 0, hInst, 0,
	)
	if hwnd != 0 {
		procShowWindow.Call(hwnd, SW_HIDE)
	}
	return hwnd
}

func round12EnsureThumbVisuals(a *application) {
	if a == nil || a.hwnd == 0 {
		return
	}
	if round12ThumbVisualH == 0 {
		round12ThumbVisualH = round12CreateThumbVisual(a.hwnd)
	}
	if round12ThumbVisualV == 0 {
		round12ThumbVisualV = round12CreateThumbVisual(a.hwnd)
	}
}

func round12ThumbVisualForAxis(axis uint8) uintptr {
	switch axis {
	case round9AxisHorizontal:
		return round12ThumbVisualH
	case round9AxisVertical:
		return round12ThumbVisualV
	default:
		return 0
	}
}

func round12HideThumbVisual(hwnd uintptr) {
	if hwnd != 0 {
		procShowWindow.Call(hwnd, SW_HIDE)
	}
}

func round12HideThumbVisuals() {
	round12HideThumbVisual(round12ThumbVisualH)
	round12HideThumbVisual(round12ThumbVisualV)
}

func round12SyncThumbVisual(listHwnd uintptr) {
	a := app
	if a == nil || a.hwnd == 0 || listHwnd == 0 || a.hList != listHwnd {
		round12HideThumbVisuals()
		return
	}
	round12EnsureThumbVisuals(a)

	axis := round12InlineState.visibleAxis
	if round12InlineState.dragging {
		axis = round12InlineState.dragAxis
	}
	visual := round12ThumbVisualForAxis(axis)
	if axis == round9AxisNone || visual == 0 {
		round12HideThumbVisuals()
		return
	}
	thumb, ok := round12InlineThumbRect(listHwnd, axis)
	if !ok {
		round12HideThumbVisuals()
		return
	}

	points := [2]point{
		{X: thumb.Left, Y: thumb.Top},
		{X: thumb.Right, Y: thumb.Bottom},
	}
	procMapWindowPoints.Call(
		listHwnd,
		a.hwnd,
		uintptr(unsafe.Pointer(&points[0])),
		uintptr(len(points)),
	)
	width := points[1].X - points[0].X
	height := points[1].Y - points[0].Y
	if width <= 0 || height <= 0 {
		round12HideThumbVisuals()
		return
	}

	if axis == round9AxisHorizontal {
		round12HideThumbVisual(round12ThumbVisualV)
	} else {
		round12HideThumbVisual(round12ThumbVisualH)
	}
	round7FeedbackSetWindowPos.Call(
		visual,
		0,
		uintptr(points[0].X),
		uintptr(points[0].Y),
		uintptr(width),
		uintptr(height),
		round7FeedbackSWPNoActivate|round9FeedbackSWPShowWindow,
	)
	procInvalidateRect.Call(visual, 0, 0)
	procUpdateWindow.Call(visual)
}

func round12ThumbVisualProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	switch message {
	case WM_NCHITTEST:
		return round12ThumbVisualHTTransparent
	case WM_ERASEBKGND:
		return 1
	case WM_PAINT:
		var ps paintStruct
		hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		if hdc != 0 {
			var rc rect
			procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
			color := colorRef(160, 171, 184)
			if round12InlineState.dragging && hwnd == round12ThumbVisualForAxis(round12InlineState.dragAxis) {
				color = colorRef(110, 132, 158)
			}
			fillSolid(hdc, rc, color)
			procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		}
		return 0
	case v452WMNCDestroy:
		if hwnd == round12ThumbVisualH {
			round12ThumbVisualH = 0
		}
		if hwnd == round12ThumbVisualV {
			round12ThumbVisualV = 0
		}
	}
	result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round12InstallPostPaintOwner(a *application) {
	if a == nil || a.hwnd == 0 || a.hList == 0 {
		return
	}
	round12EnsureThumbVisuals(a)
	v452RemoveSubclass.Call(a.hwnd, round12PostPaintMainCB, round12PostPaintMainSubclassID)
	v452SetWindowSubclass.Call(a.hwnd, round12PostPaintMainCB, round12PostPaintMainSubclassID, 0)
	v452RemoveSubclass.Call(a.hList, round12CaptureGuardListCB, round12CaptureGuardListSubclassID)
	v452SetWindowSubclass.Call(a.hList, round12CaptureGuardListCB, round12CaptureGuardListSubclassID, 0)
	round12SyncThumbVisual(a.hList)
}

func round12PostPaintMainSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == WM_NOTIFY && lParam != 0 {
		a := app
		if a != nil && a.hList != 0 {
			hdr := (*nmhdr)(unsafe.Pointer(lParam))
			if hdr.HwndFrom == a.hList && hdr.Code == NM_CUSTOMDRAW {
				cd := (*nmListViewCustomDraw)(unsafe.Pointer(lParam))
				switch cd.NMCD.DrawStage {
				case CDDS_PREPAINT:
					result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
					// Keep the existing per-item custom draw contract and ask the
					// ListView for one final callback after the whole control paint.
					return result | round12CDRFNotifyPostPaint
				case round12CDDSPostPaint:
					result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
					// The thumb visual is a sibling of the ListView rather than
					// paint inside it, so later ListView bit-blits cannot erase it.
					round12SyncThumbVisual(a.hList)
					return result
				}
			}
		}
	}

	if message == v452WMNCDestroy {
		round12HideThumbVisuals()
		v452RemoveSubclass.Call(hwnd, round12PostPaintMainCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round12RecoverTransientListCapture(hwnd, newCapture uintptr) bool {
	if hwnd == 0 || newCapture != 0 || !round12InlineState.dragging {
		return false
	}
	keyState, _, _ := procGetKeyState.Call(round12VKLeftButton)
	if uint16(keyState)&0x8000 == 0 {
		return false
	}
	var cursor point
	if ok, _, _ := round9FeedbackGetCursorPos.Call(uintptr(unsafe.Pointer(&cursor))); ok == 0 {
		return false
	}
	var bounds rect
	if ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&bounds))); ok == 0 {
		return false
	}
	if cursor.X < bounds.Left || cursor.X >= bounds.Right || cursor.Y < bounds.Top || cursor.Y >= bounds.Bottom {
		return false
	}

	// ListView style/non-client reconciliation can transiently release capture
	// while the physical drag is still active. Reacquire only for the narrow
	// no-new-owner case above; a real capture transfer still ends the drag in
	// the functional scroll owner.
	procSetCapture.Call(hwnd)
	round12InlineInvalidateAxis(hwnd, round12InlineState.dragAxis)
	procUpdateWindow.Call(hwnd)
	round12SyncThumbVisual(hwnd)
	return true
}

func round12CaptureGuardListSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == round7FeedbackWMCaptureChanged && round12RecoverTransientListCapture(hwnd, lParam) {
		return 0
	}
	if message == v452WMNCDestroy {
		round12HideThumbVisuals()
		v452RemoveSubclass.Call(hwnd, round12CaptureGuardListCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round12ScrubNativeListScrollStyles(hwnd uintptr) bool {
	if hwnd == 0 {
		return false
	}
	round8EnsureListStyleGuard(hwnd)

	style, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle)
	newStyle := style &^ uintptr(round7FeedbackWSHScroll|round7FeedbackWSVScroll|round7FeedbackWSBorder)
	exStyle, _, _ := round7FeedbackGetWindowLongPtr.Call(hwnd, round7FeedbackGWLExStyle)
	newExStyle := exStyle &^ uintptr(round7FeedbackWSExClientEdge)
	if newStyle == style && newExStyle == exStyle {
		return false
	}

	if newStyle != style {
		round7FeedbackSetWindowLongPtr.Call(hwnd, round7FeedbackGWLStyle, newStyle)
	}
	if newExStyle != exStyle {
		round7FeedbackSetWindowLongPtr.Call(hwnd, round7FeedbackGWLExStyle, newExStyle)
	}
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
	return true
}

func round12QueueDeferredNativeScrollScrub(hwnd uintptr) {
	if hwnd == 0 || !round12DeferredScrollScrubPending.CompareAndSwap(false, true) {
		return
	}
	if ok, _, _ := procPostMessageW.Call(hwnd, uintptr(round12WMDeferredScrollScrub), 0, 0); ok == 0 {
		round12DeferredScrollScrubPending.Store(false)
	}
}

func round12PerformDeferredNativeScrollScrub(hwnd uintptr) {
	round12DeferredScrollScrubPending.Store(false)
	round12ScrubNativeListScrollStyles(hwnd)
	round12SyncThumbVisual(hwnd)
}

func round12FinalizeInlineScrollVisual(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	axis := round12InlineState.visibleAxis
	if round12InlineState.dragging {
		axis = round12InlineState.dragAxis
	}
	if axis == round9AxisNone {
		round12HideThumbVisuals()
		return
	}

	// Keep the in-ListView paint as a same-geometry fallback, but the stable
	// visible owner is the tiny sibling visual window. Its rectangle is only
	// the thumb itself, never a track or gutter.
	round12InlineInvalidateAxis(hwnd, axis)
	procUpdateWindow.Call(hwnd)
	round12SyncThumbVisual(hwnd)
}

func round12HideNativeListScrollbars(hwnd uintptr) bool {
	changed := round12ScrubNativeListScrollStyles(hwnd)

	// Callers such as round12InlineScrollPixels invoke this immediately after
	// LVM_SCROLL, so the independent visual thumb follows the new position in
	// the same input transaction.
	round12FinalizeInlineScrollVisual(hwnd)

	// LVM_SCROLL may still queue a non-client update that restores native H/V
	// style bits. The queued path is style cleanup only; it also resynchronizes
	// the tiny visual thumb but never creates a track surface.
	round12QueueDeferredNativeScrollScrub(hwnd)
	return changed
}

// Compatibility entrypoint retained for callers created during earlier
// v4.5.2 rounds. It installs the ListView input owner plus the thumb-only
// sibling visual owner.
func round12InstallTransparentScrollOverlays(a *application) {
	round12InstallInlineListScroll(a)
	round12InstallPostPaintOwner(a)
}

// Retired track-window overlay hooks. They intentionally do nothing.
func round12SyncAllCoverRegions()   {}
func round12DriveScrollHover() bool { return false }

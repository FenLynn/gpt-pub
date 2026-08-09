//go:build windows

package main

import (
	"syscall"
	"time"
	"unsafe"
)

const (
	round12FunctionalScrollSubclassID = 0x45CD
	round12FunctionalSIFRange         = 0x0001
	round12FunctionalSIFPage          = 0x0002
	round12FunctionalSIFPos           = 0x0004
	round12FunctionalWheelDelta       = 120
	round12FunctionalWheelRows        = 3
)

var (
	round12FunctionalScrollCB       uintptr
	round12FunctionalWheelRemainder int
)

func init() {
	round12FunctionalScrollCB = syscall.NewCallback(round12FunctionalListSubclassProc)
	go func() {
		for attempt := 0; attempt < 800; attempt++ {
			a := app
			if a != nil && a.hwnd != 0 && a.hList != 0 && a.controlsReady &&
				round11StableCoverH != nil && round11StableCoverV != nil &&
				round11StableCoverH.hwnd != 0 && round11StableCoverV.hwnd != 0 {
				// The visual Round12 installer is also asynchronous. Let it finish
				// first, then replace only its ListView input subclass. The overlay
				// windows and their 500 ms visual lifecycle remain untouched.
				time.Sleep(750 * time.Millisecond)
				a.postUI(func() {
					if a.hList == 0 {
						return
					}
					round12InstallTransparentScrollOverlays(a)
					v452RemoveSubclass.Call(a.hList, round12ScrollListCallback, round12ScrollListSubclassID)
					v452RemoveSubclass.Call(a.hList, round12FunctionalScrollCB, round12FunctionalScrollSubclassID)
					v452SetWindowSubclass.Call(a.hList, round12FunctionalScrollCB, round12FunctionalScrollSubclassID, 0)
					round12FunctionalSyncScrollInfo(a.hList)
					round12HideNativeListScrollbars(a.hList)
					round11InvalidateStableCoverThumbs()
				})
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
}

type round12FunctionalMetrics struct {
	min  int
	max  int
	page int
	pos  int
}

func round12FunctionalMaxPosition(metrics round12FunctionalMetrics) int {
	maxPos := metrics.max - metrics.page + 1
	if maxPos < metrics.min {
		maxPos = metrics.min
	}
	return maxPos
}

func round12FunctionalCurrentHorizontalOffset(hwnd uintptr) int {
	if hwnd == 0 {
		return 0
	}
	logicalLeft := 0
	for subItem := range taskListColumns {
		width := int(send(hwnd, LVM_GETCOLUMNWIDTH, uintptr(subItem), 0))
		if subItem > 0 && width > 0 {
			if bounds, ok := listSubItemBounds(hwnd, 0, subItem); ok {
				offset := logicalLeft - int(bounds.Left)
				if offset >= 0 {
					return offset
				}
			}
		}
		logicalLeft += width
	}
	return 0
}

func round12FunctionalMetricsFor(hwnd uintptr, axis uint8) (round12FunctionalMetrics, bool) {
	if hwnd == 0 {
		return round12FunctionalMetrics{}, false
	}
	if axis == round9AxisVertical {
		count := int(send(hwnd, LVM_GETITEMCOUNT, 0, 0))
		page := int(send(hwnd, round7FeedbackLVMCountPerPage, 0, 0))
		pos := int(send(hwnd, round7FeedbackLVMGetTopIndex, 0, 0))
		if count <= 0 || page <= 0 {
			return round12FunctionalMetrics{}, false
		}
		if pos < 0 {
			pos = 0
		}
		return round12FunctionalMetrics{min: 0, max: count - 1, page: page, pos: pos}, true
	}

	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	clientWidth := int(rc.Right - rc.Left)
	if clientWidth <= 0 {
		return round12FunctionalMetrics{}, false
	}
	total := 0
	for i := range taskListColumns {
		total += int(send(hwnd, LVM_GETCOLUMNWIDTH, uintptr(i), 0))
	}
	if total <= clientWidth {
		return round12FunctionalMetrics{}, false
	}
	pos := round12FunctionalCurrentHorizontalOffset(hwnd)
	maxPos := total - clientWidth
	if pos > maxPos {
		pos = maxPos
	}
	if pos < 0 {
		pos = 0
	}
	return round12FunctionalMetrics{min: 0, max: total - 1, page: clientWidth, pos: pos}, true
}

func round12FunctionalRowHeight(hwnd uintptr) int {
	top := int(send(hwnd, round7FeedbackLVMGetTopIndex, 0, 0))
	if top < 0 {
		top = 0
	}
	if bounds, ok := listSubItemBounds(hwnd, top, 0); ok {
		if height := int(bounds.Bottom - bounds.Top); height > 1 {
			return height
		}
	}
	height := int(scaleDPI(50))
	if height < 24 {
		height = 24
	}
	return height
}

func round12FunctionalSignedParam(value int) uintptr {
	return uintptr(int64(value))
}

func round12FunctionalScrollPixels(hwnd uintptr, dx, dy int) {
	if hwnd == 0 || (dx == 0 && dy == 0) {
		return
	}
	send(hwnd, round7FeedbackLVMScroll, round12FunctionalSignedParam(dx), round12FunctionalSignedParam(dy))
}

func round12FunctionalSyncAxis(hwnd uintptr, axis uint8) {
	metrics, ok := round12FunctionalMetricsFor(hwnd, axis)
	if !ok {
		return
	}
	bar := round7FeedbackSBHorz
	if axis == round9AxisVertical {
		bar = round7FeedbackSBVert
	}
	info := round7FeedbackScrollInfo{
		CbSize: uint32(unsafe.Sizeof(round7FeedbackScrollInfo{})),
		FMask:  round12FunctionalSIFRange | round12FunctionalSIFPage | round12FunctionalSIFPos,
		NMin:   int32(metrics.min),
		NMax:   int32(metrics.max),
		NPage:  uint32(metrics.page),
		NPos:   int32(metrics.pos),
	}
	round7FeedbackSetScrollInfo.Call(hwnd, uintptr(bar), uintptr(unsafe.Pointer(&info)), 0)
}

func round12FunctionalSyncScrollInfo(hwnd uintptr) {
	round12FunctionalSyncAxis(hwnd, round9AxisHorizontal)
	round12FunctionalSyncAxis(hwnd, round9AxisVertical)
	round12HideNativeListScrollbars(hwnd)
}

func round12FunctionalAfterScroll(hwnd uintptr) {
	round12FunctionalSyncScrollInfo(hwnd)
	round11InvalidateStableCoverThumbs()
	if app != nil {
		round9EnsureVisibleThumbnails(app, hwnd)
	}
	procInvalidateRect.Call(hwnd, 0, 0)
}

func round12FunctionalSetScrollFromCover(cover *round11StableCover, coordinate int) {
	if cover == nil || app == nil || app.hList == 0 {
		return
	}
	metrics, ok := round12FunctionalMetricsFor(app.hList, cover.axis)
	if !ok {
		return
	}
	var rc rect
	procGetClientRect.Call(cover.hwnd, uintptr(unsafe.Pointer(&rc)))
	margin := int(scaleDPI(3))
	trackLength := int(rc.Right-rc.Left) - margin*2
	if cover.axis == round9AxisVertical {
		trackLength = int(rc.Bottom-rc.Top) - margin*2
	}
	if trackLength <= 0 {
		return
	}
	start, thumbLength := round7FeedbackThumbGeometry(
		margin,
		trackLength,
		metrics.min,
		metrics.max,
		metrics.page,
		metrics.pos,
	)
	_ = start
	movable := trackLength - thumbLength
	if movable <= 0 {
		return
	}
	relative := coordinate - cover.dragOffset - margin
	if relative < 0 {
		relative = 0
	}
	if relative > movable {
		relative = movable
	}
	target := metrics.min
	maxPos := round12FunctionalMaxPosition(metrics)
	if maxPos > metrics.min {
		target += relative * (maxPos-metrics.min) / movable
	}
	if target < metrics.min {
		target = metrics.min
	}
	if target > maxPos {
		target = maxPos
	}

	if cover.axis == round9AxisVertical {
		deltaRows := target - metrics.pos
		round12FunctionalScrollPixels(app.hList, 0, deltaRows*round12FunctionalRowHeight(app.hList))
	} else {
		round12FunctionalScrollPixels(app.hList, target-metrics.pos, 0)
	}
	round12FunctionalAfterScroll(app.hList)
}

func round12FunctionalDriveScrollHover() bool {
	dragging := false
	for _, cover := range []*round11StableCover{round11StableCoverH, round11StableCoverV} {
		if cover == nil || cover.hwnd == 0 {
			continue
		}
		pt, inside := round12ScrollCursorPoint(cover)
		if cover.phase == round11CoverDragging {
			coordinate := int(pt.X)
			if cover.axis == round9AxisVertical {
				coordinate = int(pt.Y)
			}
			round12FunctionalSetScrollFromCover(cover, coordinate)
			dragging = true
			continue
		}
		if inside {
			if cover.phase == round11CoverHidden {
				cover.phase = round11CoverPending
				procKillTimer.Call(cover.hwnd, round11StableCoverShowTimer)
				procSetTimer.Call(cover.hwnd, round11StableCoverShowTimer, round11StableCoverShowDelay, 0)
			} else if cover.phase == round11CoverVisible {
				round11ArmStableCoverHideWatch(cover)
			}
			continue
		}
		if cover.phase == round11CoverPending {
			procKillTimer.Call(cover.hwnd, round11StableCoverShowTimer)
			cover.phase = round11CoverHidden
		} else if cover.phase == round11CoverVisible {
			round11ArmStableCoverHideWatch(cover)
		}
	}
	return dragging
}

func round12FunctionalHandleMouseWheel(hwnd uintptr, wParam uintptr) bool {
	delta := int(int16(uint16((wParam >> 16) & 0xffff)))
	if delta == 0 {
		return true
	}
	round12FunctionalWheelRemainder += delta
	notches := round12FunctionalWheelRemainder / round12FunctionalWheelDelta
	round12FunctionalWheelRemainder -= notches * round12FunctionalWheelDelta
	if notches == 0 {
		return true
	}
	metrics, ok := round12FunctionalMetricsFor(hwnd, round9AxisVertical)
	if !ok {
		return true
	}
	target := metrics.pos - notches*round12FunctionalWheelRows
	maxPos := round12FunctionalMaxPosition(metrics)
	if target < metrics.min {
		target = metrics.min
	}
	if target > maxPos {
		target = maxPos
	}
	deltaRows := target - metrics.pos
	if deltaRows != 0 {
		round12FunctionalScrollPixels(hwnd, 0, deltaRows*round12FunctionalRowHeight(hwnd))
		round12FunctionalAfterScroll(hwnd)
	}
	return true
}

func round12FunctionalListSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case WM_PAINT, round7FeedbackWMPrint, round7FeedbackWMPrintClient:
		round12HideNativeListScrollbars(hwnd)
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round12FunctionalSyncScrollInfo(hwnd)
		return result
	case WM_MOUSEMOVE:
		if round12FunctionalDriveScrollHover() {
			return 0
		}
	case round7FeedbackWMMouseWheel:
		if round12FunctionalHandleMouseWheel(hwnd, wParam) {
			return 0
		}
	case round7FeedbackWMLButtonDown:
		round12FunctionalSyncScrollInfo(hwnd)
		if round12BeginScrollDrag(hwnd) {
			return 0
		}
	case WM_LBUTTONUP:
		if round12FinishScrollDrag(true) {
			round12FunctionalAfterScroll(hwnd)
			return 0
		}
	case round7FeedbackWMCaptureChanged:
		if round12FinishScrollDrag(false) {
			round12FunctionalAfterScroll(hwnd)
		}
	case WM_SIZE, round9FeedbackWMWindowPosChanged, LVM_SETCOLUMNWIDTH, LVM_INSERTITEMW, LVM_DELETEALLITEMS:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round11PositionStableScrollSurfaces(app)
		round12FunctionalSyncScrollInfo(hwnd)
		round11InvalidateStableCoverThumbs()
		return result
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round12FunctionalScrollCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

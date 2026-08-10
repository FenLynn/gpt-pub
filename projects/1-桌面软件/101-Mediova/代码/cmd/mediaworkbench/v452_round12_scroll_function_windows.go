//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

const (
	round12FunctionalScrollSubclassID = 0x45CD
	round12InlineWMNCPaint            = 0x0085
	round12InlineHoverDelay           = 0 // immediate by design; retained as a source-contract marker
	round12InlineLVMSetExtendedStyle  = LVM_FIRST + 54
	round12InlineLVSExDoubleBuffer    = 0x00010000
)

type round12InlineScrollState struct {
	hoverAxis      uint8
	visibleAxis    uint8
	dragAxis       uint8
	dragOffset     int
	dragging       bool
	wheelRemainder int
}

type round12InlineMetrics struct {
	min  int
	max  int
	page int
	pos  int
}

var (
	round12FunctionalScrollCB uintptr
	round12InlineState        = round12InlineScrollState{
		hoverAxis:   round9AxisNone,
		visibleAxis: round9AxisNone,
		dragAxis:    round9AxisNone,
	}
)

func init() {
	round12FunctionalScrollCB = syscall.NewCallback(round12InlineListSubclassProc)
}

func round12InstallInlineListScroll(a *application) {
	if a == nil || a.hList == 0 {
		return
	}

	// Remove every inherited scrollbar child window before the ListView becomes
	// the sole scroll paint/input owner.
	round11RetireLegacyOverlayWindows()

	v452RemoveSubclass.Call(a.hList, round12FunctionalScrollCB, round12FunctionalScrollSubclassID)
	v452SetWindowSubclass.Call(a.hList, round12FunctionalScrollCB, round12FunctionalScrollSubclassID, 0)
	round12InlineState = round12InlineScrollState{
		hoverAxis:   round9AxisNone,
		visibleAxis: round9AxisNone,
		dragAxis:    round9AxisNone,
	}

	// Double buffering is owned by the ListView itself. No transparent child
	// HWND, layered surface, window region, or external redraw loop is used.
	send(
		a.hList,
		round12InlineLVMSetExtendedStyle,
		uintptr(round12InlineLVSExDoubleBuffer),
		uintptr(round12InlineLVSExDoubleBuffer),
	)
	round8EnsureListStyleGuard(a.hList)
	round12HideNativeListScrollbars(a.hList)
}

func round12InlineTrackMouse(hwnd uintptr) {
	track := round7FeedbackTrackMouseEvent{
		CbSize:    uint32(unsafe.Sizeof(round7FeedbackTrackMouseEvent{})),
		DwFlags:   round7FeedbackTMELeave,
		HwndTrack: hwnd,
	}
	round7FeedbackTrackMouseEventProc.Call(uintptr(unsafe.Pointer(&track)))
}

func round12InlineHeaderBottom(hwnd uintptr) int32 {
	header := send(hwnd, LVM_GETHEADER, 0, 0)
	if header == 0 {
		return 1
	}
	var wr rect
	if ok, _, _ := procGetWindowRect.Call(header, uintptr(unsafe.Pointer(&wr))); ok == 0 {
		return 1
	}
	pt := point{X: wr.Left, Y: wr.Bottom}
	if ok, _, _ := round9FeedbackScreenToClient.Call(hwnd, uintptr(unsafe.Pointer(&pt))); ok == 0 {
		return 1
	}
	return pt.Y
}

func round12InlineCurrentHorizontalOffset(hwnd uintptr) int {
	if hwnd == 0 {
		return 0
	}
	row := int(send(hwnd, round7FeedbackLVMGetTopIndex, 0, 0))
	if row < 0 {
		row = 0
	}
	logicalLeft := 0
	for subItem := 0; subItem < round12ColumnCount; subItem++ {
		width := int(send(hwnd, LVM_GETCOLUMNWIDTH, uintptr(subItem), 0))
		if width <= 0 {
			continue
		}
		if subItem > 0 {
			if bounds, ok := listSubItemBounds(hwnd, row, subItem); ok {
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

func round12InlineMetricsFor(hwnd uintptr, axis uint8) (round12InlineMetrics, bool) {
	if hwnd == 0 {
		return round12InlineMetrics{}, false
	}
	if axis == round9AxisVertical {
		count := int(send(hwnd, LVM_GETITEMCOUNT, 0, 0))
		page := int(send(hwnd, round7FeedbackLVMCountPerPage, 0, 0))
		pos := int(send(hwnd, round7FeedbackLVMGetTopIndex, 0, 0))
		if count <= 0 || page <= 0 || count <= page {
			return round12InlineMetrics{}, false
		}
		if pos < 0 {
			pos = 0
		}
		return round12InlineMetrics{min: 0, max: count - 1, page: page, pos: pos}, true
	}

	var client rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	clientWidth := int(client.Right - client.Left)
	if clientWidth <= 0 {
		return round12InlineMetrics{}, false
	}
	total := 0
	for column := 0; column < round12ColumnCount; column++ {
		total += int(send(hwnd, LVM_GETCOLUMNWIDTH, uintptr(column), 0))
	}
	if total <= clientWidth {
		return round12InlineMetrics{}, false
	}
	pos := round12InlineCurrentHorizontalOffset(hwnd)
	maxPos := total - clientWidth
	if pos < 0 {
		pos = 0
	}
	if pos > maxPos {
		pos = maxPos
	}
	return round12InlineMetrics{min: 0, max: total - 1, page: clientWidth, pos: pos}, true
}

func round12InlineMaxPosition(metrics round12InlineMetrics) int {
	maxPos := metrics.max - metrics.page + 1
	if maxPos < metrics.min {
		maxPos = metrics.min
	}
	return maxPos
}

func round12InlineTrackRect(hwnd uintptr, axis uint8) (rect, bool) {
	if hwnd == 0 {
		return rect{}, false
	}
	var client rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	width := client.Right - client.Left
	height := client.Bottom - client.Top
	if width <= 0 || height <= 0 {
		return rect{}, false
	}

	// The hit strip is intentionally wider than the visible thumb. Nothing is
	// painted for the strip itself, so it remains a transparent overlay area.
	zone := scaleDPI(17)
	if zone < 14 {
		zone = 14
	}
	_, needH := round12InlineMetricsFor(hwnd, round9AxisHorizontal)
	_, needV := round12InlineMetricsFor(hwnd, round9AxisVertical)

	switch axis {
	case round9AxisHorizontal:
		if !needH {
			return rect{}, false
		}
		right := client.Right - 1
		if needV {
			right -= zone
		}
		if right <= client.Left+zone {
			return rect{}, false
		}
		return rect{
			Left:   client.Left + 1,
			Top:    client.Bottom - zone,
			Right:  right,
			Bottom: client.Bottom - 1,
		}, true
	case round9AxisVertical:
		if !needV {
			return rect{}, false
		}
		top := round12InlineHeaderBottom(hwnd) + 1
		bottom := client.Bottom - 1
		if needH {
			bottom -= zone
		}
		if bottom <= top+zone {
			return rect{}, false
		}
		return rect{
			Left:   client.Right - zone,
			Top:    top,
			Right:  client.Right - 1,
			Bottom: bottom,
		}, true
	}
	return rect{}, false
}

func round12InlineThumbRect(hwnd uintptr, axis uint8) (rect, bool) {
	track, ok := round12InlineTrackRect(hwnd, axis)
	if !ok {
		return rect{}, false
	}
	metrics, ok := round12InlineMetricsFor(hwnd, axis)
	if !ok {
		return rect{}, false
	}

	margin := int(scaleDPI(3))
	trackStart := 0
	trackLength := 0
	if axis == round9AxisVertical {
		trackStart = int(track.Top) + margin
		trackLength = int(track.Bottom-track.Top) - margin*2
	} else {
		trackStart = int(track.Left) + margin
		trackLength = int(track.Right-track.Left) - margin*2
	}
	if trackLength <= 0 {
		return rect{}, false
	}
	start, length := round7FeedbackThumbGeometry(
		trackStart,
		trackLength,
		metrics.min,
		metrics.max,
		metrics.page,
		metrics.pos,
	)
	thickness := scaleDPI(7)
	if thickness < 6 {
		thickness = 6
	}
	if axis == round9AxisVertical {
		x := track.Left + (track.Right-track.Left-thickness)/2
		return rect{Left: x, Top: int32(start), Right: x + thickness, Bottom: int32(start + length)}, true
	}
	y := track.Top + (track.Bottom-track.Top-thickness)/2
	return rect{Left: int32(start), Top: y, Right: int32(start + length), Bottom: y + thickness}, true
}

func round12InlineAxisAtPoint(hwnd uintptr, pt point) uint8 {
	if track, ok := round12InlineTrackRect(hwnd, round9AxisVertical); ok && round7FeedbackPointInRect(pt, track) {
		return round9AxisVertical
	}
	if track, ok := round12InlineTrackRect(hwnd, round9AxisHorizontal); ok && round7FeedbackPointInRect(pt, track) {
		return round9AxisHorizontal
	}
	return round9AxisNone
}

func round12InlineCursorAxis(hwnd uintptr) uint8 {
	if hwnd == 0 {
		return round9AxisNone
	}
	var pt point
	if ok, _, _ := round9FeedbackGetCursorPos.Call(uintptr(unsafe.Pointer(&pt))); ok == 0 {
		return round9AxisNone
	}
	if ok, _, _ := round9FeedbackScreenToClient.Call(hwnd, uintptr(unsafe.Pointer(&pt))); ok == 0 {
		return round9AxisNone
	}
	return round12InlineAxisAtPoint(hwnd, pt)
}

func round12InlineInvalidateAxis(hwnd uintptr, axis uint8) {
	if hwnd == 0 || axis == round9AxisNone {
		return
	}
	if track, ok := round12InlineTrackRect(hwnd, axis); ok {
		procInvalidateRect.Call(hwnd, uintptr(unsafe.Pointer(&track)), 0)
	}
}

func round12InlineSetVisibleAxis(hwnd uintptr, axis uint8) {
	old := round12InlineState.visibleAxis
	if old == axis {
		return
	}
	round12InlineState.visibleAxis = axis
	round12InlineInvalidateAxis(hwnd, old)
	round12InlineInvalidateAxis(hwnd, axis)
}

func round12InlineUpdateHover(hwnd uintptr, pt point) {
	round12InlineTrackMouse(hwnd)
	axis := round12InlineAxisAtPoint(hwnd, pt)
	round12InlineState.hoverAxis = axis
	if round12InlineState.dragging {
		return
	}
	// No timer and no delayed transition. Entering the edge hit strip makes the
	// single in-place thumb visible in the same mouse-move transaction.
	round12InlineSetVisibleAxis(hwnd, axis)
}

func round12InlineDrawThumb(hwnd, hdc uintptr) {
	if hwnd == 0 || hdc == 0 {
		return
	}
	axis := round12InlineState.visibleAxis
	if round12InlineState.dragging {
		axis = round12InlineState.dragAxis
	}
	if axis == round9AxisNone {
		return
	}
	thumb, ok := round12InlineThumbRect(hwnd, axis)
	if !ok {
		return
	}
	color := colorRef(160, 171, 184)
	if round12InlineState.dragging {
		color = colorRef(110, 132, 158)
	}
	brush, _, _ := procCreateSolidBrush.Call(color)
	if brush == 0 {
		return
	}
	oldBrush, _, _ := procSelectObject.Call(hdc, brush)
	nullPen, _, _ := procGetStockObject.Call(8)
	oldPen, _, _ := procSelectObject.Call(hdc, nullPen)
	radius := scaleDPI(6)
	procRoundRect.Call(
		hdc,
		uintptr(thumb.Left), uintptr(thumb.Top), uintptr(thumb.Right), uintptr(thumb.Bottom),
		uintptr(radius), uintptr(radius),
	)
	if oldPen != 0 {
		procSelectObject.Call(hdc, oldPen)
	}
	if oldBrush != 0 {
		procSelectObject.Call(hdc, oldBrush)
	}
	procDeleteObject.Call(brush)
}

func round12InlinePaintAfterDefault(hwnd uintptr, message uint32, hdc uintptr) {
	if hwnd == 0 || hdc == 0 {
		return
	}
	if app != nil {
		round7DrawListOverlay(app, hdc)
	}
	round9FeedbackDrawListBoundary(hwnd, hdc)
	round12InlineDrawThumb(hwnd, hdc)
	if message == WM_PAINT && app != nil {
		round9EnsureVisibleThumbnails(app, hwnd)
	}
}

func round12InlineRowHeight(hwnd uintptr) int {
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

func round12InlineSignedParam(value int) uintptr {
	return uintptr(int64(value))
}

func round12InlineScrollPixels(hwnd uintptr, dx, dy int) {
	if hwnd == 0 || (dx == 0 && dy == 0) {
		return
	}
	send(hwnd, round7FeedbackLVMScroll, round12InlineSignedParam(dx), round12InlineSignedParam(dy))
	// LVM_SCROLL is allowed to move content, but native H/V non-client chrome is
	// never allowed to become a second visual scrollbar.
	round12HideNativeListScrollbars(hwnd)
	if app != nil {
		round9EnsureVisibleThumbnails(app, hwnd)
	}
}

func round12InlineSetScrollFromPoint(hwnd uintptr, axis uint8, coordinate int) {
	metrics, ok := round12InlineMetricsFor(hwnd, axis)
	if !ok {
		return
	}
	track, ok := round12InlineTrackRect(hwnd, axis)
	if !ok {
		return
	}
	thumb, ok := round12InlineThumbRect(hwnd, axis)
	if !ok {
		return
	}

	margin := int(scaleDPI(3))
	trackStart := int(track.Left) + margin
	trackLength := int(track.Right-track.Left) - margin*2
	thumbLength := int(thumb.Right - thumb.Left)
	if axis == round9AxisVertical {
		trackStart = int(track.Top) + margin
		trackLength = int(track.Bottom-track.Top) - margin*2
		thumbLength = int(thumb.Bottom - thumb.Top)
	}
	movable := trackLength - thumbLength
	if movable <= 0 {
		return
	}
	relative := coordinate - round12InlineState.dragOffset - trackStart
	if relative < 0 {
		relative = 0
	}
	if relative > movable {
		relative = movable
	}
	minPos := metrics.min
	maxPos := round12InlineMaxPosition(metrics)
	target := minPos
	if maxPos > minPos {
		target += relative * (maxPos - minPos) / movable
	}
	delta := target - metrics.pos
	if delta == 0 {
		return
	}

	round12InlineInvalidateAxis(hwnd, axis)
	if axis == round9AxisVertical {
		round12InlineScrollPixels(hwnd, 0, delta*round12InlineRowHeight(hwnd))
	} else {
		round12InlineScrollPixels(hwnd, delta, 0)
	}
	round12InlineInvalidateAxis(hwnd, axis)
}

func round12InlineBeginDrag(hwnd uintptr, pt point) bool {
	axis := round12InlineState.visibleAxis
	if axis == round9AxisNone {
		return false
	}
	thumb, ok := round12InlineThumbRect(hwnd, axis)
	if !ok || !round7FeedbackPointInRect(pt, thumb) {
		return false
	}
	round12InlineState.dragging = true
	round12InlineState.dragAxis = axis
	if axis == round9AxisVertical {
		round12InlineState.dragOffset = int(pt.Y - thumb.Top)
	} else {
		round12InlineState.dragOffset = int(pt.X - thumb.Left)
	}
	procSetCapture.Call(hwnd)
	round12InlineInvalidateAxis(hwnd, axis)
	return true
}

func round12InlineFinishDrag(hwnd uintptr, releaseCapture bool) bool {
	if !round12InlineState.dragging {
		return false
	}
	axis := round12InlineState.dragAxis
	round12InlineState.dragging = false
	round12InlineState.dragAxis = round9AxisNone
	round12InlineState.dragOffset = 0
	if releaseCapture {
		procReleaseCapture.Call()
	}
	round12InlineInvalidateAxis(hwnd, axis)
	current := round12InlineCursorAxis(hwnd)
	round12InlineState.hoverAxis = current
	round12InlineSetVisibleAxis(hwnd, current)
	return true
}

func round12InlineHandleDragMove(hwnd uintptr, pt point) bool {
	if !round12InlineState.dragging {
		return false
	}
	coordinate := int(pt.X)
	if round12InlineState.dragAxis == round9AxisVertical {
		coordinate = int(pt.Y)
	}
	round12InlineSetScrollFromPoint(hwnd, round12InlineState.dragAxis, coordinate)
	return true
}

func round12InlineHandleMouseWheel(hwnd uintptr, wParam uintptr) bool {
	delta := int(int16(uint16((wParam >> 16) & 0xffff)))
	if delta == 0 {
		return true
	}
	round12InlineState.wheelRemainder += delta
	notches := round12InlineState.wheelRemainder / 120
	round12InlineState.wheelRemainder -= notches * 120
	if notches == 0 {
		return true
	}
	metrics, ok := round12InlineMetricsFor(hwnd, round9AxisVertical)
	if !ok {
		return true
	}
	target := metrics.pos - notches*3
	maxPos := round12InlineMaxPosition(metrics)
	if target < metrics.min {
		target = metrics.min
	}
	if target > maxPos {
		target = maxPos
	}
	if deltaRows := target - metrics.pos; deltaRows != 0 {
		round12InlineScrollPixels(hwnd, 0, deltaRows*round12InlineRowHeight(hwnd))
		if round12InlineState.visibleAxis != round9AxisNone {
			round12InlineInvalidateAxis(hwnd, round12InlineState.visibleAxis)
		}
	}
	return true
}

func round12InlineListSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	switch message {
	case WM_PAINT:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		hdc, _, _ := round7ListGetDC.Call(hwnd)
		if hdc != 0 {
			round12InlinePaintAfterDefault(hwnd, message, hdc)
			round7ListReleaseDC.Call(hwnd, hdc)
		}
		return result

	case round7FeedbackWMPrint, round7FeedbackWMPrintClient:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if wParam != 0 {
			round12InlinePaintAfterDefault(hwnd, message, wParam)
		}
		return result

	case round12InlineWMNCPaint:
		// The style guard is authoritative. This is only a fail-safe check and is
		// a no-op during normal paints because the forbidden styles are absent.
		round12HideNativeListScrollbars(hwnd)
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result

	case WM_MOUSEMOVE:
		pt := mousePoint(lParam)
		if round12InlineHandleDragMove(hwnd, pt) {
			return 0
		}
		round12InlineUpdateHover(hwnd, pt)

	case round7FeedbackWMLButtonDown:
		if round12InlineBeginDrag(hwnd, mousePoint(lParam)) {
			return 0
		}

	case WM_LBUTTONUP:
		if round12InlineFinishDrag(hwnd, true) {
			return 0
		}

	case round7FeedbackWMCaptureChanged:
		if round12InlineFinishDrag(hwnd, false) {
			return 0
		}

	case round7FeedbackWMMouseLeave:
		round12InlineState.hoverAxis = round9AxisNone
		if !round12InlineState.dragging {
			round12InlineSetVisibleAxis(hwnd, round9AxisNone)
		}
		return 0

	case round7FeedbackWMMouseWheel:
		if round12InlineHandleMouseWheel(hwnd, wParam) {
			return 0
		}

	case WM_HSCROLL, round7FeedbackWMVScroll:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round12HideNativeListScrollbars(hwnd)
		if app != nil {
			round9EnsureVisibleThumbnails(app, hwnd)
		}
		if round12InlineState.visibleAxis != round9AxisNone {
			round12InlineInvalidateAxis(hwnd, round12InlineState.visibleAxis)
		}
		return result

	case WM_SIZE, round9FeedbackWMWindowPosChanged, LVM_SETCOLUMNWIDTH, LVM_INSERTITEMW, LVM_DELETEALLITEMS:
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		round12HideNativeListScrollbars(hwnd)
		if app != nil {
			round9EnsureVisibleThumbnails(app, hwnd)
		}
		if round12InlineState.visibleAxis != round9AxisNone {
			round12InlineInvalidateAxis(hwnd, round12InlineState.visibleAxis)
		}
		return result

	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, round12FunctionalScrollCB, subclassID)
	}

	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

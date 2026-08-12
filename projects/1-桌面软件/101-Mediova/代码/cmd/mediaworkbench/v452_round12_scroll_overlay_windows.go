//go:build windows

package main

import (
	"strconv"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"
)

// Round12 keeps the task ListView as the only scroll/input owner. Native H/V
// scrollbar styles are rejected by the existing style guard. Tiny sibling
// windows own only the moving thumb pixels plus the frozen sequence-number
// strip. No sibling owns a scrollbar track, gutter, or scroll input.
const (
	round12ScrollSBBoth                       = 3
	round12WMDeferredScrollScrub              = WM_APP + 0x5CF
	round12PostPaintMainSubclassID            = 0x45CE
	round12CaptureGuardListSubclassID         = 0x45CF
	round12VKLeftButton                       = 0x01
	round12ThumbVisualClassName               = "MWRound12ThumbVisual"
	round12FrozenNumberClassName              = "MWRound12FrozenNumber"
	round12ThumbVisualExTransparent   uintptr = 0x00000020
	round12ThumbVisualWSClipSiblings  uintptr = 0x04000000
	round12ThumbVisualHTTransparent   uintptr = ^uintptr(0)
	round12ThumbTransitionTimerID     uintptr = 0x45D0
	round12ThumbTransitionIntervalMS          = 16
	round12ThumbTransitionSteps               = 4
	round12WheelRevealHoldTicks               = 42
	round12CDDSPostPaint              uint32  = 0x00000002
	round12CDRFNotifyPostPaint        uintptr = 0x00000010
)

var (
	round12DeferredScrollScrubPending atomic.Bool
	round12PostPaintMainCB            uintptr
	round12CaptureGuardListCB         uintptr
	round12ThumbVisualWndProc         uintptr
	round12FrozenNumberWndProc        uintptr
	round12ThumbVisualOnce            sync.Once
	round12ThumbVisualH               uintptr
	round12ThumbVisualV               uintptr
	round12FrozenNumberVisual         uintptr
	round12ThumbPhaseH                int
	round12ThumbPhaseV                int
	round12ThumbTimerActive           bool
	round12WheelRevealTicks           int
)

func init() {
	round12PostPaintMainCB = syscall.NewCallback(round12PostPaintMainSubclassProc)
	round12CaptureGuardListCB = syscall.NewCallback(round12CaptureGuardListSubclassProc)
	round12ThumbVisualWndProc = syscall.NewCallback(round12ThumbVisualProc)
	round12FrozenNumberWndProc = syscall.NewCallback(round12FrozenNumberVisualProc)
}

// Kept only for compatibility with older source contracts. The rebuilt scroll
// owner does not call ShowScrollBar because toggling native scrollbar state is
// itself a source of non-client relayout and visible flashing.
var round12ShowScrollBar = user32.NewProc("ShowScrollBar")

func round12RegisterThumbVisualClass() {
	hInst, _, _ := procGetModuleHandleW.Call(0)
	classes := []wndClassEx{
		{
			CbSize:        uint32(unsafe.Sizeof(wndClassEx{})),
			LpfnWndProc:   round12ThumbVisualWndProc,
			HInstance:     hInst,
			HbrBackground: 0,
			LpszClassName: p(round12ThumbVisualClassName),
		},
		{
			CbSize:        uint32(unsafe.Sizeof(wndClassEx{})),
			LpfnWndProc:   round12FrozenNumberWndProc,
			HInstance:     hInst,
			HbrBackground: 0,
			LpszClassName: p(round12FrozenNumberClassName),
		},
	}
	for index := range classes {
		procRegisterClassExW.Call(uintptr(unsafe.Pointer(&classes[index])))
	}
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

func round12CreateFrozenNumberVisual(parent uintptr) uintptr {
	if parent == 0 {
		return 0
	}
	round12ThumbVisualOnce.Do(round12RegisterThumbVisualClass)
	hInst, _, _ := procGetModuleHandleW.Call(0)
	hwnd, _, _ := procCreateWindowExW.Call(
		WS_EX_NOACTIVATE,
		uintptr(unsafe.Pointer(p(round12FrozenNumberClassName))),
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
	if round12FrozenNumberVisual == 0 {
		round12FrozenNumberVisual = round12CreateFrozenNumberVisual(a.hwnd)
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

func round12ThumbPhaseForAxis(axis uint8) int {
	switch axis {
	case round9AxisHorizontal:
		return round12ThumbPhaseH
	case round9AxisVertical:
		return round12ThumbPhaseV
	default:
		return 0
	}
}

func round12SetThumbPhase(axis uint8, phase int) {
	if phase < 0 {
		phase = 0
	}
	if phase > round12ThumbTransitionSteps {
		phase = round12ThumbTransitionSteps
	}
	switch axis {
	case round9AxisHorizontal:
		round12ThumbPhaseH = phase
	case round9AxisVertical:
		round12ThumbPhaseV = phase
	}
}

func round12ThumbTargetAxis() uint8 {
	if round12InlineState.dragging {
		return round12InlineState.dragAxis
	}
	return round12InlineState.visibleAxis
}

func round12StartThumbTimer(hwnd uintptr) {
	if hwnd == 0 || round12ThumbTimerActive {
		return
	}
	if timer, _, _ := procSetTimer.Call(
		hwnd,
		round12ThumbTransitionTimerID,
		round12ThumbTransitionIntervalMS,
		0,
	); timer != 0 {
		round12ThumbTimerActive = true
	}
}

func round12StopThumbTimer(hwnd uintptr) {
	if hwnd != 0 && round12ThumbTimerActive {
		procKillTimer.Call(hwnd, round12ThumbTransitionTimerID)
	}
	round12ThumbTimerActive = false
	round12WheelRevealTicks = 0
}

func round12WheelRevealActive() bool {
	return round12WheelRevealTicks > 0
}

func round12CancelWheelReveal() {
	round12WheelRevealTicks = 0
}

func round12StartThumbTransition(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	round12StartThumbTimer(hwnd)
	round12SyncThumbVisual(hwnd)
}

func round12ForceThumbVisible(hwnd uintptr, axis uint8) {
	if hwnd == 0 || axis == round9AxisNone {
		return
	}
	round12CancelWheelReveal()
	round12SetThumbPhase(axis, round12ThumbTransitionSteps)
	round12StartThumbTimer(hwnd)
	round12SyncThumbVisual(hwnd)
}

func round12RevealVerticalThumbForWheel(hwnd uintptr) {
	if hwnd == 0 || round12InlineState.dragging {
		return
	}
	round12InlineState.visibleAxis = round9AxisVertical
	round12WheelRevealTicks = round12WheelRevealHoldTicks
	round12StartThumbTimer(hwnd)
	round12SyncThumbVisual(hwnd)
}

func round12AdvanceThumbPhase(axis uint8, targetAxis uint8) bool {
	current := round12ThumbPhaseForAxis(axis)
	target := 0
	if targetAxis == axis {
		target = round12ThumbTransitionSteps
	}
	if current < target {
		current++
		round12SetThumbPhase(axis, current)
		return true
	}
	if current > target {
		current--
		round12SetThumbPhase(axis, current)
		return true
	}
	return false
}

func round12HandleThumbTimer(hwnd uintptr, timerID uintptr) bool {
	if timerID != round12ThumbTransitionTimerID {
		return false
	}
	if hwnd == 0 {
		return true
	}

	if round12WheelRevealTicks > 0 && !round12InlineState.dragging {
		round12WheelRevealTicks--
		if round12WheelRevealTicks == 0 {
			round12InlineState.visibleAxis = round12InlineState.hoverAxis
		}
	}

	targetAxis := round12ThumbTargetAxis()
	changed := round12AdvanceThumbPhase(round9AxisHorizontal, targetAxis)
	if round12AdvanceThumbPhase(round9AxisVertical, targetAxis) {
		changed = true
	}
	if changed || round12WheelRevealTicks > 0 {
		round12SyncThumbVisual(hwnd)
	}

	hDone := round12ThumbPhaseForAxis(round9AxisHorizontal)
	vDone := round12ThumbPhaseForAxis(round9AxisVertical)
	targetH, targetV := 0, 0
	if targetAxis == round9AxisHorizontal {
		targetH = round12ThumbTransitionSteps
	} else if targetAxis == round9AxisVertical {
		targetV = round12ThumbTransitionSteps
	}
	if round12WheelRevealTicks == 0 && hDone == targetH && vDone == targetV {
		procKillTimer.Call(hwnd, round12ThumbTransitionTimerID)
		round12ThumbTimerActive = false
	}
	return true
}

func round12AnimatedThumbRect(listHwnd uintptr, axis uint8, phase int) (rect, bool) {
	thumb, ok := round12InlineThumbRect(listHwnd, axis)
	if !ok || phase <= 0 {
		return rect{}, false
	}
	if phase >= round12ThumbTransitionSteps {
		return thumb, true
	}

	if axis == round9AxisVertical {
		full := thumb.Right - thumb.Left
		current := full * int32(phase) / int32(round12ThumbTransitionSteps)
		if current < 1 {
			current = 1
		}
		center := (thumb.Left + thumb.Right) / 2
		thumb.Left = center - current/2
		thumb.Right = thumb.Left + current
		return thumb, true
	}

	full := thumb.Bottom - thumb.Top
	current := full * int32(phase) / int32(round12ThumbTransitionSteps)
	if current < 1 {
		current = 1
	}
	center := (thumb.Top + thumb.Bottom) / 2
	thumb.Top = center - current/2
	thumb.Bottom = thumb.Top + current
	return thumb, true
}

func round12FrozenNumberWidth(listHwnd uintptr) int32 {
	if listHwnd == 0 {
		return 0
	}
	width := int32(send(listHwnd, LVM_GETCOLUMNWIDTH, uintptr(round12ColNumber), 0))
	if width <= 0 {
		return 0
	}
	var client rect
	if ok, _, _ := procGetClientRect.Call(listHwnd, uintptr(unsafe.Pointer(&client))); ok == 0 {
		return 0
	}
	if width > client.Right-client.Left {
		width = client.Right - client.Left
	}
	return width
}

func round12SyncFrozenNumberVisual(listHwnd uintptr) {
	a := app
	if a == nil || a.hwnd == 0 || listHwnd == 0 || a.hList != listHwnd {
		round12HideThumbVisual(round12FrozenNumberVisual)
		return
	}
	round12EnsureThumbVisuals(a)
	if round12FrozenNumberVisual == 0 {
		return
	}

	width := round12FrozenNumberWidth(listHwnd)
	var client rect
	if width <= 0 {
		round12HideThumbVisual(round12FrozenNumberVisual)
		return
	}
	if ok, _, _ := procGetClientRect.Call(listHwnd, uintptr(unsafe.Pointer(&client))); ok == 0 || client.Bottom <= client.Top {
		round12HideThumbVisual(round12FrozenNumberVisual)
		return
	}
	points := [2]point{
		{X: client.Left, Y: client.Top},
		{X: client.Left + width, Y: client.Bottom},
	}
	procMapWindowPoints.Call(
		listHwnd,
		a.hwnd,
		uintptr(unsafe.Pointer(&points[0])),
		uintptr(len(points)),
	)
	round7FeedbackSetWindowPos.Call(
		round12FrozenNumberVisual,
		0,
		uintptr(points[0].X),
		uintptr(points[0].Y),
		uintptr(points[1].X-points[0].X),
		uintptr(points[1].Y-points[0].Y),
		round7FeedbackSWPNoActivate|round9FeedbackSWPShowWindow,
	)
	procInvalidateRect.Call(round12FrozenNumberVisual, 0, 0)
	procUpdateWindow.Call(round12FrozenNumberVisual)
}

func round12FrozenNumberVisualProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	switch message {
	case WM_NCHITTEST:
		return round12ThumbVisualHTTransparent
	case WM_ERASEBKGND:
		return 1
	case WM_PAINT:
		var ps paintStruct
		hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		if hdc != 0 {
			round12PaintFrozenNumberVisual(hwnd, hdc)
			procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		}
		return 0
	case v452WMNCDestroy:
		if hwnd == round12FrozenNumberVisual {
			round12FrozenNumberVisual = 0
		}
	}
	result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func round12PaintFrozenNumberVisual(hwnd, hdc uintptr) {
	a := app
	if a == nil || a.hList == 0 || hwnd == 0 || hdc == 0 {
		return
	}
	var client rect
	if ok, _, _ := procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client))); ok == 0 ||
		client.Right <= client.Left || client.Bottom <= client.Top {
		return
	}

	headerBottom := round12InlineHeaderBottom(a.hList)
	if headerBottom < client.Top {
		headerBottom = client.Top
	}
	if headerBottom > client.Bottom {
		headerBottom = client.Bottom
	}
	header := rect{Left: client.Left, Top: client.Top, Right: client.Right, Bottom: headerBottom}
	if header.Bottom > header.Top {
		fillSolid(hdc, header, round12HeaderBackground)
		fillSolid(hdc, rect{
			Left: header.Left, Top: header.Top,
			Right: header.Right, Bottom: header.Top + 1,
		}, round12HeaderTopSeparator)
		fillSolid(hdc, rect{
			Left: header.Left, Top: header.Bottom - 1,
			Right: header.Right, Bottom: header.Bottom,
		}, round12HeaderTopSeparator)
		textRect := header
		textRect.Left += scaleDPI(8)
		textRect.Right -= scaleDPI(5)
		old, _, _ := procSelectObject.Call(hdc, uiFontBold)
		procSetBkMode.Call(hdc, TRANSPARENT)
		procSetTextColor.Call(hdc, round12HeaderText)
		procDrawTextW.Call(
			hdc,
			uintptr(unsafe.Pointer(p(round12Columns[round12ColNumber].name))),
			^uintptr(0),
			uintptr(unsafe.Pointer(&textRect)),
			DT_LEFT|DT_VCENTER|DT_SINGLELINE,
		)
		if old != 0 {
			procSelectObject.Call(hdc, old)
		}
	}

	body := rect{Left: client.Left, Top: headerBottom, Right: client.Right, Bottom: client.Bottom}
	if body.Bottom > body.Top {
		fillSolid(hdc, body, colorRef(255, 255, 255))
		count := int(send(a.hList, LVM_GETITEMCOUNT, 0, 0))
		top := int(send(a.hList, round7FeedbackLVMGetTopIndex, 0, 0))
		page := int(send(a.hList, round7FeedbackLVMCountPerPage, 0, 0))
		if top < 0 {
			top = 0
		}
		if page < 1 {
			page = count
		}
		end := top + page + 2
		if end > count {
			end = count
		}
		for row := top; row < end; row++ {
			item := rect{Left: LVIR_BOUNDS}
			if send(a.hList, LVM_GETITEMRECT, uintptr(row), uintptr(unsafe.Pointer(&item))) == 0 {
				continue
			}
			cell := rect{Left: client.Left, Top: item.Top, Right: client.Right, Bottom: item.Bottom}
			if cell.Top < body.Top {
				cell.Top = body.Top
			}
			if cell.Bottom > body.Bottom {
				cell.Bottom = body.Bottom
			}
			if cell.Bottom <= cell.Top {
				continue
			}
			background := colorRef(255, 255, 255)
			if listItemSelected(a.hList, row) {
				background = round12SelectionBackground
			}
			round12DrawTextCell(
				hdc,
				cell,
				strconv.Itoa(row+1),
				background,
				round12SelectionText,
				true,
			)
		}
	}

	if client.Right > client.Left {
		fillSolid(hdc, rect{
			Left: client.Right - 1, Top: client.Top,
			Right: client.Right, Bottom: client.Bottom,
		}, round12HeaderTopSeparator)
	}
}

func round12SyncThumbVisual(listHwnd uintptr) {
	a := app
	if a == nil || a.hwnd == 0 || listHwnd == 0 || a.hList != listHwnd {
		round12HideThumbVisuals()
		return
	}
	round12EnsureThumbVisuals(a)

	for _, axis := range []uint8{round9AxisHorizontal, round9AxisVertical} {
		visual := round12ThumbVisualForAxis(axis)
		phase := round12ThumbPhaseForAxis(axis)
		if round12InlineState.dragging && round12InlineState.dragAxis == axis {
			phase = round12ThumbTransitionSteps
		}
		if visual == 0 || phase <= 0 {
			round12HideThumbVisual(visual)
			continue
		}
		thumb, ok := round12AnimatedThumbRect(listHwnd, axis, phase)
		if !ok {
			round12HideThumbVisual(visual)
			continue
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
			round12HideThumbVisual(visual)
			continue
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
	round12SyncFrozenNumberVisual(a.hList)
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
					// Final sibling ownership keeps both the frozen sequence
					// column and moving thumb outside ListView partial repaint debris.
					round12SyncFrozenNumberVisual(a.hList)
					round12SyncThumbVisual(a.hList)
					return result
				}
			}
		}
	}

	if message == v452WMNCDestroy {
		round12HideThumbVisuals()
		round12HideThumbVisual(round12FrozenNumberVisual)
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
	round12SyncFrozenNumberVisual(hwnd)
	round12SyncThumbVisual(hwnd)
}

func round12FinalizeInlineScrollVisual(hwnd uintptr) {
	if hwnd == 0 {
		return
	}

	// The ListView owns content paint only. Scroll chrome is synchronized as
	// sibling windows, so old thumb positions cannot remain as row fragments.
	round12SyncFrozenNumberVisual(hwnd)
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

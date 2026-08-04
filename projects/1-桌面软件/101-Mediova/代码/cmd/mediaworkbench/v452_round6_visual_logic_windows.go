//go:build windows

package main

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"unsafe"

	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

const (
	v452Round6MainSubclassID     = 0x4561
	v452Round6TrimSubclassID     = 0x4562
	v452Round6TimelineSubclassID = 0x4563
	v452Round6RepairMessage      = 0x8000 + 0x526
	v452Round6ENKillFocus        = 0x0200
	v452Round6LVSExSubItemImages = 0x00000002
	v452Round6LVMSetExtended     = 0x1036
)

var (
	v452Round6EventCB      uintptr
	v452Round6MainCB       uintptr
	v452Round6TrimCB       uintptr
	v452Round6TimelineCB   uintptr
	v452Round6EventHook    uintptr
	v452Round6MainOnce     sync.Once
	v452Round6TrimWindows  sync.Map
	v452Round6TrackWindows sync.Map
	v452Round6ThumbQueued  sync.Map

	v452Round6FindWindowEx = user32.NewProc("FindWindowExW")
	v452Round6GetDlgItem   = user32.NewProc("GetDlgItem")
	v452Round6IsChild      = user32.NewProc("IsChild")
)

func init() {
	v452Round6EventCB = syscall.NewCallback(v452Round6EventProc)
	v452Round6MainCB = syscall.NewCallback(v452Round6MainSubclassProc)
	v452Round6TrimCB = syscall.NewCallback(v452Round6TrimSubclassProc)
	v452Round6TimelineCB = syscall.NewCallback(v452Round6TimelineSubclassProc)
	v452Round6EventHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		v452Round6EventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func v452Round6EventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	if app != nil && app.hwnd != 0 && app.controlsReady {
		v452Round6MainOnce.Do(func() {
			v452SetWindowSubclass.Call(app.hwnd, v452Round6MainCB, v452Round6MainSubclassID, 0)
		})
		setText(app.hwnd, "Mediova v4.5.2")
		procPostMessageW.Call(app.hwnd, v452Round6RepairMessage, 0, 0)
	}
	if d := activeTrim; d != nil && d.hwnd != 0 {
		// Preserve the existing crop-sync protection and install this final visual
		// layer only after the fourth/fifth-round subclasses are present.
		v452TryInstallTrimEditor(d)
		v452Round6InstallTrimDialog(d)
	}
	return 0
}

func v452Round6MainSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == v452Round6RepairMessage {
		if app != nil && app.hwnd == hwnd {
			v452Round6RepairMainWindow(app)
		}
		return 0
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	if app != nil && app.hwnd == hwnd {
		switch message {
		case WM_COMMAND:
			id := int(loWord(wParam))
			if id == IDC_TAB_VIDEO || id == IDC_TAB_IMAGE {
				v452Round6ClearOutputSelection(app)
			}
			procPostMessageW.Call(hwnd, v452Round6RepairMessage, 0, 0)
		case WM_APP_UI, WM_APP_REFRESH, WM_APP_ROW, WM_APP_PROBE:
			procPostMessageW.Call(hwnd, v452Round6RepairMessage, 0, 0)
		case v452WMNCDestroy:
			v452RemoveSubclass.Call(hwnd, v452Round6MainCB, subclassID)
		}
	}
	return result
}

func v452Round6RepairMainWindow(a *application) {
	if a == nil || a.hwnd == 0 || !a.controlsReady {
		return
	}
	setText(a.hwnd, "Mediova v4.5.2")
	v452Round6ClearOutputSelection(a)
	v452Round6RepairListRows(a)
}

func v452Round6ClearOutputSelection(a *application) {
	if a == nil || a.hOutputEdit == 0 {
		return
	}
	v452ClearComboSelection(a, a.hOutputEdit, false)
	focus, _, _ := procGetFocus.Call()
	isChild := uintptr(0)
	if focus != 0 {
		isChild, _, _ = v452Round6IsChild.Call(a.hOutputEdit, focus)
	}
	if focus == a.hOutputEdit || isChild != 0 {
		if a.hList != 0 {
			procSetFocus.Call(a.hList)
		} else {
			procSetFocus.Call(a.hwnd)
		}
	}
	procInvalidateRect.Call(a.hOutputEdit, 0, 1)
}

func v452Round6RepairListRows(a *application) {
	if a == nil || a.hList == 0 {
		return
	}
	send(a.hList, v452Round6LVMSetExtended, v452Round6LVSExSubItemImages, v452Round6LVSExSubItemImages)
	count := int(send(a.hList, LVM_GETITEMCOUNT, 0, 0))
	if count <= 0 {
		return
	}

	type rowTask struct {
		row  int
		task model.Task
	}
	rows := make([]rowTask, 0, count)
	a.mu.Lock()
	for row := 0; row < count && row < len(a.visible); row++ {
		idx := a.visible[row]
		if idx >= 0 && idx < len(a.tasks) && a.tasks[idx] != nil {
			rows = append(rows, rowTask{row: row, task: *a.tasks[idx]})
		}
	}
	a.mu.Unlock()

	ffmpeg, _, _, _, _ := a.componentSnapshot()
	for _, item := range rows {
		number := p(strconv.Itoa(item.row + 1))
		first := lvItem{Mask: LVIF_TEXT, IItem: int32(item.row), ISubItem: int32(taskColNumber), PszText: number}
		send(a.hList, LVM_SETITEMW, 0, uintptr(unsafe.Pointer(&first)))

		imageIndex := item.task.ThumbnailIndex
		imageItem := lvItem{Mask: LVIF_IMAGE, IItem: int32(item.row), ISubItem: int32(taskColFile), IImage: int32(imageIndex)}
		send(a.hList, LVM_SETITEMW, 0, uintptr(unsafe.Pointer(&imageItem)))
		if imageIndex > 0 {
			v452Round6ThumbQueued.Delete(item.task.ID)
			continue
		}
		if ffmpeg == "" || item.task.Width <= 0 || item.task.Height <= 0 {
			continue
		}
		key := fmt.Sprintf("%d|%s", item.task.ID, item.task.Input)
		if _, loaded := v452Round6ThumbQueued.LoadOrStore(key, true); loaded {
			continue
		}
		probe := media.ProbeInfo{
			Width:    item.task.Width,
			Height:   item.task.Height,
			Rotation: item.task.Rotation,
			Duration: item.task.Duration,
			FPS:      item.task.FPS,
		}
		if !a.queueThumbnail(item.task.ID, item.task.Input, probe) {
			v452Round6ThumbQueued.Delete(key)
		}
	}
	procInvalidateRect.Call(a.hList, 0, 0)
}

func v452Round6InstallTrimDialog(d *trimDialog) {
	if d == nil || d.hwnd == 0 {
		return
	}
	if _, loaded := v452Round6TrimWindows.LoadOrStore(d.hwnd, true); !loaded {
		v452SetWindowSubclass.Call(d.hwnd, v452Round6TrimCB, v452Round6TrimSubclassID, 0)
	}
	setText(d.hwnd, "裁剪 · "+filepathBase(d.task.Input))
	v452Round6RelayoutTrimDialog(d)
	if d.hTrack != 0 {
		if _, loaded := v452Round6TrackWindows.LoadOrStore(d.hTrack, true); !loaded {
			v452SetWindowSubclass.Call(d.hTrack, v452Round6TimelineCB, v452Round6TimelineSubclassID, 0)
		}
		procInvalidateRect.Call(d.hTrack, 0, 1)
	}
}

func filepathBase(path string) string {
	path = strings.ReplaceAll(path, "/", "\\")
	if i := strings.LastIndex(path, "\\"); i >= 0 {
		return path[i+1:]
	}
	return path
}

func v452Round6ChildByID(parent uintptr, id int) uintptr {
	h, _, _ := v452Round6GetDlgItem.Call(parent, uintptr(id))
	return h
}

func v452Round6ChildByText(parent uintptr, text string) uintptr {
	var after uintptr
	for {
		h, _, _ := v452Round6FindWindowEx.Call(parent, after, 0, 0)
		if h == 0 {
			return 0
		}
		if strings.TrimSpace(getText(h)) == text {
			return h
		}
		after = h
	}
}

func v452Round6RelayoutTrimDialog(d *trimDialog) {
	if d == nil || d.hwnd == 0 || d.hTrack == 0 {
		return
	}
	move(d.hTrack, 15, 606, 700, 52)
	if h := v452Round6ChildByID(d.hwnd, IDC_TRIM_START+100); h != 0 {
		setText(h, "设为起点")
	}
	if h := v452Round6ChildByID(d.hwnd, IDC_TRIM_END+100); h != 0 {
		setText(h, "设为终点")
	}

	// The old aspect row started inside the Height edit control. Move the
	// complete row and the information panel down as one unit.
	if h := v452Round6ChildByText(d.hwnd, "裁剪比例"); h != 0 {
		move(h, 735, 346, 70, 26)
	}
	if d.hAspect != 0 {
		move(d.hAspect, 807, 340, 120, 200)
	}
	if h := v452Round6ChildByID(d.hwnd, IDC_CROP_CENTER); h != 0 {
		move(h, 935, 340, 132, 32)
	}
	if d.hInfo != 0 {
		move(d.hInfo, 735, 382, 332, 118)
	}
	if h := v452Round6ChildByID(d.hwnd, IDC_FRAME_PREVIEW); h != 0 {
		move(h, 735, 512, 332, 36)
	}
}

func v452Round6TrimSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	d := activeTrim
	if d != nil && d.hwnd == hwnd && message == WM_COMMAND {
		id := int(loWord(wParam))
		if id == IDC_TRIM_OK || id == IDC_CROP_APPLY_SELECTED {
			v452Round6NormalizeTrimInputs(d, 0)
		}
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	if d != nil && d.hwnd == hwnd {
		switch message {
		case WM_COMMAND:
			id := int(loWord(wParam))
			notify := int(hiWord(wParam))
			switch id {
			case IDC_FULL_TIME:
				v452Round6NormalizeTrimInputs(d, IDC_FULL_TIME)
			case IDC_TRIM_START + 100:
				v452Round6NormalizeTrimInputs(d, IDC_TRIM_START)
			case IDC_TRIM_END + 100:
				v452Round6NormalizeTrimInputs(d, IDC_TRIM_END)
			case IDC_TRIM_START, IDC_TRIM_END:
				if notify == v452Round6ENKillFocus {
					v452Round6NormalizeTrimInputs(d, id)
				}
			}
			procInvalidateRect.Call(d.hTrack, 0, 1)
		case WM_SIZE:
			v452Round6RelayoutTrimDialog(d)
		case v452WMNCDestroy:
			v452RemoveSubclass.Call(hwnd, v452Round6TrimCB, subclassID)
			v452Round6TrimWindows.Delete(hwnd)
		}
	}
	return result
}

func v452Round6NormalizeTrimInputs(d *trimDialog, changed int) {
	if d == nil || d.task == nil || d.task.Kind == model.KindImage || d.task.Duration <= 0 {
		return
	}
	start, startErr := parseTimeValue(getText(d.hStart))
	end, endErr := parseTimeValue(getText(d.hEnd))
	if startErr != nil || endErr != nil {
		return
	}
	duration := d.task.Duration
	minimum := media.MinimumTrimSpan(duration, d.safeFPS())
	if changed == IDC_FULL_TIME {
		start, end = 0, duration
	} else if changed == IDC_TRIM_START {
		if end <= 0 || end > duration {
			end = duration
		}
		if start < 0 {
			start = 0
		}
		maximum := end - minimum
		if maximum < 0 {
			maximum = 0
		}
		if start > maximum {
			start = maximum
		}
	} else if changed == IDC_TRIM_END {
		if start < 0 {
			start = 0
		}
		if start > duration-minimum {
			start = duration - minimum
		}
		if end > duration {
			end = duration
		}
		minimumEnd := start + minimum
		if end < minimumEnd {
			end = minimumEnd
		}
	}
	state := media.NormalizeTrimRange(duration, d.safeFPS(), media.TrimRangeState{
		Start:    start,
		End:      end,
		Playhead: d.currentAt,
	})
	v452WriteTrimRange(d, state, false)
}

func v452Round6TimelineSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	d := activeTrim
	if d == nil || d.hTrack != hwnd {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
	switch message {
	case WM_PAINT:
		v452Round6PaintTimeline(d, hwnd)
		return 0
	case WM_ERASEBKGND:
		return 1
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, v452Round6TimelineCB, subclassID)
		v452Round6TrackWindows.Delete(hwnd)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func v452Round6PaintTimeline(d *trimDialog, hwnd uintptr) {
	var ps paintStruct
	hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	defer procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	client, left, right := v452TrimTimelineGeometry(hwnd)
	fillSolid(hdc, client, rgb(255, 255, 255))

	if d.task.Kind == model.KindImage || d.task.Duration <= 0 {
		procSetBkMode.Call(hdc, TRANSPARENT)
		procSetTextColor.Call(hdc, rgb(126, 134, 144))
		procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p("图片无时间轴"))), ^uintptr(0), uintptr(unsafe.Pointer(&client)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
		return
	}

	state := v452ReadTrimRange(d)
	startX := media.TimelineTimeToX(state.Start, d.task.Duration, left, right)
	endX := media.TimelineTimeToX(state.End, d.task.Duration, left, right)
	playX := media.TimelineTimeToX(state.Playhead, d.task.Duration, left, right)

	bar := rect{Left: int32(left), Top: 29, Right: int32(right), Bottom: 39}
	fillSolid(hdc, bar, rgb(231, 235, 240))
	if startX > left {
		fillSolid(hdc, rect{Left: int32(left), Top: 27, Right: int32(startX), Bottom: 41}, rgb(242, 244, 247))
	}
	if endX < right {
		fillSolid(hdc, rect{Left: int32(endX), Top: 27, Right: int32(right), Bottom: 41}, rgb(242, 244, 247))
	}
	selected := rect{Left: int32(startX), Top: 26, Right: int32(endX), Bottom: 42}
	fillSolid(hdc, selected, rgb(207, 226, 250))
	drawRoundedBorder(hdc, selected, 2, rgb(108, 157, 219))

	// Distinct bracket-like handles make the two trim boundaries readable even
	// when the selected interval touches the source edges.
	startHandle := rect{Left: int32(startX - 5), Top: 20, Right: int32(startX + 3), Bottom: 47}
	endHandle := rect{Left: int32(endX - 2), Top: 20, Right: int32(endX + 6), Bottom: 47}
	fillSolid(hdc, startHandle, rgb(43, 111, 201))
	fillSolid(hdc, endHandle, rgb(43, 111, 201))

	playPen, _, _ := procCreatePen.Call(PS_SOLID, 2, rgb(218, 58, 58))
	oldPen, _, _ := procSelectObject.Call(hdc, playPen)
	procMoveToEx.Call(hdc, uintptr(playX), 17, 0)
	procLineTo.Call(hdc, uintptr(playX), 49)
	procSelectObject.Call(hdc, oldPen)
	procDeleteObject.Call(playPen)
	fillSolid(hdc, rect{Left: int32(playX - 4), Top: 16, Right: int32(playX + 5), Bottom: 20}, rgb(218, 58, 58))

	startText := "起 " + formatSecondsClock(state.Start)
	endText := "止 " + formatSecondsClock(state.End)
	labelWidth := int32(155)
	startLeft := int32(startX)
	if startLeft+labelWidth > int32(right) {
		startLeft = int32(right) - labelWidth
	}
	if startLeft < int32(left) {
		startLeft = int32(left)
	}
	endRight := int32(endX)
	if endRight-labelWidth < int32(left) {
		endRight = int32(left) + labelWidth
	}
	if endRight > int32(right) {
		endRight = int32(right)
	}
	startLabel := rect{Left: startLeft, Top: 0, Right: startLeft + labelWidth, Bottom: 18}
	endLabel := rect{Left: endRight - labelWidth, Top: 0, Right: endRight, Bottom: 18}
	if startLabel.Right > endLabel.Left {
		startLabel.Top, startLabel.Bottom = 0, 14
		endLabel.Top, endLabel.Bottom = 13, 27
	}
	procSetBkMode.Call(hdc, TRANSPARENT)
	procSetTextColor.Call(hdc, rgb(62, 76, 96))
	procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(startText))), ^uintptr(0), uintptr(unsafe.Pointer(&startLabel)), DT_LEFT|DT_VCENTER|DT_SINGLELINE)
	procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(endText))), ^uintptr(0), uintptr(unsafe.Pointer(&endLabel)), DT_RIGHT|DT_VCENTER|DT_SINGLELINE)
}

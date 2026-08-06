//go:build windows

package main

import (
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

const (
	round7IDCStartCurrent = 4701
	round7IDCStartInitial = 4702
	round7IDCEndCurrent   = 4703
	round7IDCEndTerminal  = 4704
	round7IDCTimeline     = 4705
	round7IDCSourceRange  = 4706

	round7ENKillFocus = 0x0200
	round7CBNSelChange = 1
)

type round7TimelineDrag int

const (
	round7DragNone round7TimelineDrag = iota
	round7DragTrimStart
	round7DragCurrent
	round7DragTrimEnd
)

type round7Editor struct {
	owner       *application
	dialog      *trimDialog
	selected    []int
	hwnd        uintptr
	hTimeline   uintptr
	hInstruction uintptr
	hCurrentLabel uintptr
	hJump       uintptr
	hFileLabel  uintptr
	hStartLabel uintptr
	hStartCurrent uintptr
	hStartInitial uintptr
	hEndLabel   uintptr
	hEndCurrent uintptr
	hEndTerminal uintptr
	hSourceRange uintptr
	hCropFrameLabel uintptr
	hFullFrame  uintptr
	hAspectLabel uintptr
	hCenter     uintptr
	hPreview    uintptr
	hApplySelected uintptr
	hApplyCurrent uintptr
	hCancel     uintptr
	hSeekMinusSec uintptr
	hSeekMinusFrame uintptr
	hSeekPlusFrame uintptr
	hSeekPlusSec uintptr
	cropLabels  [4]uintptr

	drag          round7TimelineDrag
	updating      bool
	done          bool
	accepted      bool
	applySelected bool
	lastPreviewAt time.Time
}

var (
	round7EditorRegisterOnce sync.Once
	round7EditorWndProcCB    uintptr
	round7TimelineWndProcCB  uintptr
	round7ActiveEditor       *round7Editor
)

func round7EditSelected(a *application) {
	if a == nil {
		return
	}
	idxs := a.selectedTaskIndices()
	if len(idxs) == 0 {
		messageBox(a.hwnd, "剪辑 / 画面", "请先选择一个任务。", MB_OK|MB_ICONINFORMATION)
		return
	}

	a.mu.Lock()
	idx := idxs[0]
	if idx < 0 || idx >= len(a.tasks) || a.tasks[idx] == nil {
		a.mu.Unlock()
		return
	}
	if a.tasks[idx].IsLocked() {
		a.mu.Unlock()
		messageBox(a.hwnd, "剪辑 / 画面", "该任务当前处于队列、转换或暂停状态。请先通过右键“临时操作 → 搁置并修改参数”解锁。", MB_OK|MB_ICONINFORMATION)
		return
	}
	taskSnapshot := *a.tasks[idx]
	opts := a.settings.EffectiveOptions(a.tasks[idx])
	a.mu.Unlock()

	result, accepted, applySelected := round7ShowEditor(a, &taskSnapshot, opts, idxs)
	if !accepted {
		return
	}
	result.FollowDefaults = false

	a.mu.Lock()
	applied := 0
	if idx >= 0 && idx < len(a.tasks) && a.tasks[idx] != nil && !a.tasks[idx].IsLocked() {
		a.tasks[idx].Options = result
		resetTaskAfterOptionChange(a.tasks[idx])
		applied++
	}
	if applySelected {
		for _, targetIndex := range idxs[1:] {
			if targetIndex < 0 || targetIndex >= len(a.tasks) || a.tasks[targetIndex] == nil || a.tasks[targetIndex].IsLocked() {
				continue
			}
			target := a.tasks[targetIndex]
			targetOpts := a.settings.EffectiveOptions(target)
			targetOpts.FollowDefaults = false
			targetOpts.TrimStart, targetOpts.TrimEnd = trimRangeForTarget(result, target)
			targetOpts.Crop = scaledCropForTarget(&taskSnapshot, result, target, targetOpts)
			target.Options = targetOpts
			resetTaskAfterOptionChange(target)
			applied++
		}
	}
	a.mu.Unlock()

	a.saveSession()
	a.refreshList()
	a.updateRightPanel()
	if applySelected {
		setText(a.hStatusText, fmt.Sprintf("剪辑 / 画面设置已应用到 %d 个可修改任务。", applied))
	} else {
		setText(a.hStatusText, "剪辑 / 画面设置已应用到当前任务。")
	}
}

func round7ShowEditor(owner *application, task *model.Task, opts model.TaskOptions, selected []int) (model.TaskOptions, bool, bool) {
	if owner == nil || task == nil {
		return opts, false, false
	}
	frameW, frameH := effectiveFrameSize(task, opts.Rotation)
	if task.Kind == model.KindImage {
		opts.TrimStart, opts.TrimEnd = 0, 0
	} else {
		if opts.TrimStart < 0 || opts.TrimStart >= task.Duration {
			opts.TrimStart = 0
		}
		if opts.TrimEnd <= opts.TrimStart || opts.TrimEnd > task.Duration {
			opts.TrimEnd = task.Duration
		}
	}
	if opts.Crop.Width <= 0 || opts.Crop.Height <= 0 || opts.Crop.X+opts.Crop.Width > frameW || opts.Crop.Y+opts.Crop.Height > frameH {
		opts.Crop = model.Crop{Enabled: false, X: 0, Y: 0, Width: evenSize(frameW), Height: evenSize(frameH)}
	}

	d := &trimDialog{
		owner: owner,
		task: task,
		opts: opts,
		frameW: frameW,
		frameH: frameH,
		currentAt: opts.TrimStart,
	}
	e := &round7Editor{owner: owner, dialog: d, selected: append([]int(nil), selected...)}
	round7ActiveEditor = e
	activeTrim = d

	round7EditorRegisterOnce.Do(func() {
		round7EditorWndProcCB = syscall.NewCallback(round7EditorWndProc)
		round7TimelineWndProcCB = syscall.NewCallback(round7TimelineWndProc)
		hInst, _, _ := procGetModuleHandleW.Call(0)
		cursor, _, _ := procLoadCursorW.Call(0, 32512)
		editorClass := wndClassEx{
			CbSize: uint32(unsafe.Sizeof(wndClassEx{})),
			LpfnWndProc: round7EditorWndProcCB,
			HInstance: hInst,
			HIcon: owner.hIcon,
			HIconSm: owner.hIcon,
			HCursor: cursor,
			HbrBackground: COLOR_WINDOW + 1,
			LpszClassName: p("MWRound7Editor"),
		}
		procRegisterClassExW.Call(uintptr(unsafe.Pointer(&editorClass)))
		timelineClass := wndClassEx{
			CbSize: uint32(unsafe.Sizeof(wndClassEx{})),
			LpfnWndProc: round7TimelineWndProcCB,
			HInstance: hInst,
			HCursor: cursor,
			HbrBackground: COLOR_WINDOW + 1,
			LpszClassName: p("MWRound7Timeline"),
		}
		procRegisterClassExW.Call(uintptr(unsafe.Pointer(&timelineClass)))
	})
	if !trimPreviewClassRegistered {
		registerTrimPreviewClass()
		trimPreviewClassRegistered = true
	}

	title := "剪辑 / 画面 · " + filepath.Base(task.Input)
	if task.Kind == model.KindImage {
		title = "画面调整 · " + filepath.Base(task.Input)
	}
	hInst, _, _ := procGetModuleHandleW.Call(0)
	style := uintptr(WS_OVERLAPPEDWINDOW &^ (WS_THICKFRAME | WS_MAXIMIZEBOX))
	hwnd, _, _ := procCreateWindowExW.Call(
		WS_EX_DLGMODALFRAME|WS_EX_TOOLWINDOW,
		uintptr(unsafe.Pointer(p("MWRound7Editor"))),
		uintptr(unsafe.Pointer(p(title))),
		style|WS_VISIBLE|WS_CLIPCHILDREN,
		80, 50, uintptr(scaleDPI(1180)), uintptr(scaleDPI(750)),
		owner.hwnd, 0, hInst, 0,
	)
	if hwnd == 0 {
		activeTrim = nil
		round7ActiveEditor = nil
		return opts, false, false
	}
	e.hwnd = hwnd
	d.hwnd = hwnd
	enable(owner.hwnd, false)
	procSetForegroundWindow.Call(hwnd)

	var m msg
	for !e.done {
		r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}

	d.closed.Store(true)
	d.cleanup()
	enable(owner.hwnd, true)
	procSetForegroundWindow.Call(owner.hwnd)
	result, accepted, applySelected := d.opts, e.accepted, e.applySelected
	activeTrim = nil
	round7ActiveEditor = nil
	return result, accepted, applySelected
}

func round7EditorWndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	e := round7ActiveEditor
	switch message {
	case WM_CREATE:
		if e != nil {
			e.hwnd = hwnd
			e.dialog.hwnd = hwnd
			e.initControls()
		}
		return 0
	case WM_COMMAND:
		if e != nil && e.hwnd == hwnd {
			e.command(int(loWord(wParam)), int(hiWord(wParam)))
			return 0
		}
	case WM_KEYDOWN:
		if e != nil && e.hwnd == hwnd && e.keyDown(int(wParam)) {
			return 0
		}
	case WM_CLOSE:
		if e != nil && e.hwnd == hwnd {
			e.close(false, false)
		}
		return 0
	case WM_DESTROY:
		if e != nil && e.hwnd == hwnd {
			e.done = true
		}
		return 0
	}
	result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func (e *round7Editor) initControls() {
	if e == nil || e.dialog == nil {
		return
	}
	d := e.dialog

	d.hCanvas = createControlEx(WS_EX_CLIENTEDGE, "MWTrimPreviewCanvas", "", WS_CHILD|WS_VISIBLE, 18, 18, 700, 400, e.hwnd, IDC_PREVIEW_CANVAS)
	e.hInstruction = createControl("STATIC", "拖动红色当前游标预览画面；拖动蓝色剪辑起点和剪辑终点调整保留片段。", WS_CHILD|WS_VISIBLE, 18, 426, 700, 24, e.hwnd, 0)
	e.hCurrentLabel = createControl("STATIC", "当前时间", WS_CHILD|WS_VISIBLE, 18, 460, 72, 28, e.hwnd, 0)
	d.hNow = createControlEx(WS_EX_CLIENTEDGE, "EDIT", formatSecondsClock(d.currentAt), WS_CHILD|WS_VISIBLE|WS_TABSTOP|ES_AUTOHSCROLL, 92, 456, 145, 30, e.hwnd, IDC_CURRENT_TIME)
	e.hJump = createControl("BUTTON", "跳转", WS_CHILD|WS_VISIBLE|WS_TABSTOP, 244, 456, 70, 30, e.hwnd, IDC_JUMP_TIME)
	e.hFileLabel = createControl("STATIC", filepath.Base(d.task.Input)+" · "+formatSecondsClock(d.task.Duration), WS_CHILD|WS_VISIBLE, 326, 460, 392, 28, e.hwnd, 0)
	e.hTimeline = createControl("MWRound7Timeline", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP, 18, 494, 700, 86, e.hwnd, round7IDCTimeline)
	e.hSeekMinusSec = createControl("BUTTON", "−1 秒", WS_CHILD|WS_VISIBLE|WS_TABSTOP, 210, 590, 90, 32, e.hwnd, IDC_SEEK_MINUS_SEC)
	e.hSeekMinusFrame = createControl("BUTTON", "−1 帧", WS_CHILD|WS_VISIBLE|WS_TABSTOP, 308, 590, 90, 32, e.hwnd, IDC_SEEK_MINUS_FRAME)
	e.hSeekPlusFrame = createControl("BUTTON", "+1 帧", WS_CHILD|WS_VISIBLE|WS_TABSTOP, 406, 590, 90, 32, e.hwnd, IDC_SEEK_PLUS_FRAME)
	e.hSeekPlusSec = createControl("BUTTON", "+1 秒", WS_CHILD|WS_VISIBLE|WS_TABSTOP, 504, 590, 90, 32, e.hwnd, IDC_SEEK_PLUS_SEC)

	x := int32(748)
	e.hStartLabel = createControl("STATIC", "设定起始时间", WS_CHILD|WS_VISIBLE, x, 24, 96, 28, e.hwnd, 0)
	d.hStart = createControlEx(WS_EX_CLIENTEDGE, "EDIT", formatSecondsClock(d.opts.TrimStart), WS_CHILD|WS_VISIBLE|WS_TABSTOP|ES_AUTOHSCROLL, x+98, 20, 140, 30, e.hwnd, IDC_TRIM_START)
	e.hStartCurrent = createControl("BUTTON", "设为当前", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x+246, 20, 78, 30, e.hwnd, round7IDCStartCurrent)
	e.hStartInitial = createControl("BUTTON", "设为初始", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x+330, 20, 78, 30, e.hwnd, round7IDCStartInitial)
	e.hEndLabel = createControl("STATIC", "设定结束时间", WS_CHILD|WS_VISIBLE, x, 64, 96, 28, e.hwnd, 0)
	d.hEnd = createControlEx(WS_EX_CLIENTEDGE, "EDIT", formatSecondsClock(d.opts.TrimEnd), WS_CHILD|WS_VISIBLE|WS_TABSTOP|ES_AUTOHSCROLL, x+98, 60, 140, 30, e.hwnd, IDC_TRIM_END)
	e.hEndCurrent = createControl("BUTTON", "设为当前", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x+246, 60, 78, 30, e.hwnd, round7IDCEndCurrent)
	e.hEndTerminal = createControl("BUTTON", "设为终止", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x+330, 60, 78, 30, e.hwnd, round7IDCEndTerminal)
	e.hSourceRange = createControl("STATIC", "源时间范围："+formatSecondsClock(0)+" → "+formatSecondsClock(d.task.Duration), WS_CHILD|WS_VISIBLE, x, 102, 408, 28, e.hwnd, round7IDCSourceRange)

	d.hCrop = createControl("BUTTON", "启用画面选区", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_AUTOCHECKBOX, x, 138, 160, 30, e.hwnd, IDC_CROP_ON)
	labels := []string{"左 X", "上 Y", "宽度", "高度"}
	vals := []int{d.opts.Crop.X, d.opts.Crop.Y, d.opts.Crop.Width, d.opts.Crop.Height}
	ids := []int{IDC_CROP_X, IDC_CROP_Y, IDC_CROP_W, IDC_CROP_H}
	handles := []*uintptr{&d.hX, &d.hY, &d.hW, &d.hH}
	for i := range labels {
		y := int32(176 + i*36)
		e.cropLabels[i] = createControl("STATIC", labels[i], WS_CHILD|WS_VISIBLE, x, y+4, 68, 26, e.hwnd, 0)
		*handles[i] = createControlEx(WS_EX_CLIENTEDGE, "EDIT", strconv.Itoa(vals[i]), WS_CHILD|WS_VISIBLE|WS_TABSTOP|ES_AUTOHSCROLL|ES_NUMBER, x+72, y, 118, 30, e.hwnd, ids[i])
	}
	e.hCropFrameLabel = createControl("STATIC", fmt.Sprintf("转正后画面：%d × %d", d.frameW, d.frameH), WS_CHILD|WS_VISIBLE, x+204, 180, 204, 48, e.hwnd, 0)
	e.hFullFrame = createControl("BUTTON", "恢复全画面", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x+204, 244, 132, 32, e.hwnd, IDC_FULL_FRAME)
	e.hAspectLabel = createControl("STATIC", "选区比例", WS_CHILD|WS_VISIBLE, x, 326, 70, 26, e.hwnd, 0)
	d.hAspect = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, x+72, 320, 118, 200, e.hwnd, IDC_CROP_ASPECT)
	for _, label := range []string{"自由", "16:9", "9:16", "1:1", "4:3"} {
		send(d.hAspect, CB_ADDSTRING, 0, uintptr(unsafe.Pointer(p(label))))
	}
	send(d.hAspect, CB_SETCURSEL, 0, 0)
	e.hCenter = createControl("BUTTON", "居中适配", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x+204, 320, 132, 32, e.hwnd, IDC_CROP_CENTER)
	d.hInfo = createControlEx(WS_EX_CLIENTEDGE, "EDIT", "", WS_CHILD|WS_VISIBLE|ES_MULTILINE|ES_READONLY|WS_VSCROLL, x, 366, 408, 130, e.hwnd, 0)
	e.hPreview = createControl("BUTTON", "生成高清预览", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x, 506, 408, 36, e.hwnd, IDC_FRAME_PREVIEW)
	e.hApplySelected = createControl("BUTTON", "应用到已选任务", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x, 594, 408, 36, e.hwnd, IDC_CROP_APPLY_SELECTED)
	e.hApplyCurrent = createControl("BUTTON", "应用到当前任务", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_DEFPUSHBUTTON, x, 640, 250, 40, e.hwnd, IDC_TRIM_OK)
	e.hCancel = createControl("BUTTON", "取消", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x+260, 640, 148, 40, e.hwnd, IDC_TRIM_CANCEL)

	all := []uintptr{
		d.hCanvas, e.hInstruction, e.hCurrentLabel, d.hNow, e.hJump, e.hFileLabel, e.hTimeline,
		e.hSeekMinusSec, e.hSeekMinusFrame, e.hSeekPlusFrame, e.hSeekPlusSec,
		e.hStartLabel, d.hStart, e.hStartCurrent, e.hStartInitial,
		e.hEndLabel, d.hEnd, e.hEndCurrent, e.hEndTerminal, e.hSourceRange,
		d.hCrop, d.hX, d.hY, d.hW, d.hH, e.hCropFrameLabel, e.hFullFrame,
		e.hAspectLabel, d.hAspect, e.hCenter, d.hInfo, e.hPreview,
		e.hApplySelected, e.hApplyCurrent, e.hCancel,
	}
	all = append(all, e.cropLabels[:]...)
	for _, h := range all {
		if h != 0 {
			send(h, WM_SETFONT, uiFont, 1)
		}
	}

	if d.opts.Crop.Enabled {
		send(d.hCrop, BM_SETCHECK, BST_CHECKED, 0)
	}
	if d.task.Kind == model.KindImage {
		for _, h := range []uintptr{d.hNow, e.hJump, e.hTimeline, d.hStart, d.hEnd, e.hStartCurrent, e.hStartInitial, e.hEndCurrent, e.hEndTerminal, e.hSeekMinusSec, e.hSeekMinusFrame, e.hSeekPlusFrame, e.hSeekPlusSec} {
			enable(h, false)
		}
		setText(d.hStart, "图片")
		setText(d.hEnd, "无时间轴")
		setText(e.hSourceRange, "图片任务只调整画面选区。")
	}
	e.updateInfo()
	procInvalidateRect.Call(e.hTimeline, 0, 1)
	d.generatePreviewFrame()
}

func (e *round7Editor) command(id, notify int) {
	if e == nil || e.dialog == nil || e.updating {
		return
	}
	d := e.dialog
	switch id {
	case round7IDCStartCurrent:
		e.setTrimStart(d.currentAt)
	case round7IDCStartInitial:
		e.setTrimStart(0)
	case round7IDCEndCurrent:
		e.setTrimEnd(d.currentAt)
	case round7IDCEndTerminal:
		e.setTrimEnd(d.task.Duration)
	case IDC_JUMP_TIME:
		if value, err := parseTimeValue(getText(d.hNow)); err == nil {
			e.setCurrent(value, true)
		} else {
			messageBox(e.hwnd, "当前时间", "无法识别当前时间。", MB_OK|MB_ICONERROR)
		}
	case IDC_SEEK_MINUS_SEC:
		e.setCurrent(d.currentAt-1, true)
	case IDC_SEEK_PLUS_SEC:
		e.setCurrent(d.currentAt+1, true)
	case IDC_SEEK_MINUS_FRAME:
		e.setCurrent(d.currentAt-1/d.safeFPS(), true)
	case IDC_SEEK_PLUS_FRAME:
		e.setCurrent(d.currentAt+1/d.safeFPS(), true)
	case IDC_TRIM_START:
		if notify == round7ENKillFocus {
			e.syncTimesFromEdits(IDC_TRIM_START)
		}
	case IDC_TRIM_END:
		if notify == round7ENKillFocus {
			e.syncTimesFromEdits(IDC_TRIM_END)
		}
	case IDC_CROP_ON:
		d.cropFromControls(false)
		e.updateInfo()
		procInvalidateRect.Call(d.hCanvas, 0, 1)
	case IDC_CROP_X, IDC_CROP_Y, IDC_CROP_W, IDC_CROP_H:
		if notify == round7ENKillFocus {
			d.cropFromControls(true)
			e.updateInfo()
			procInvalidateRect.Call(d.hCanvas, 0, 1)
		}
	case IDC_FULL_FRAME:
		d.opts.Crop = model.Crop{Enabled: false, X: 0, Y: 0, Width: evenSize(d.frameW), Height: evenSize(d.frameH)}
		e.withUpdate(func() { d.cropToControls() })
		e.updateInfo()
	case IDC_CROP_ASPECT:
		if notify == round7CBNSelChange {
			e.updateInfo()
		}
	case IDC_CROP_CENTER:
		d.fitSelectedAspect()
		e.updateInfo()
	case IDC_FRAME_PREVIEW:
		d.openHighQualityPreview()
	case IDC_CROP_APPLY_SELECTED:
		if e.read() {
			e.close(true, true)
		}
	case IDC_TRIM_OK:
		if e.read() {
			e.close(true, false)
		}
	case IDC_TRIM_CANCEL:
		e.close(false, false)
	}
}

func (e *round7Editor) keyDown(key int) bool {
	if e == nil || e.dialog == nil || e.dialog.task.Kind == model.KindImage {
		return false
	}
	shiftState, _, _ := procGetKeyState.Call(0x10)
	shifted := int16(shiftState&0xffff) < 0
	switch key {
	case 0x25:
		step := -1 / e.dialog.safeFPS()
		if shifted {
			step = -1
		}
		e.setCurrent(e.dialog.currentAt+step, true)
		return true
	case 0x27:
		step := 1 / e.dialog.safeFPS()
		if shifted {
			step = 1
		}
		e.setCurrent(e.dialog.currentAt+step, true)
		return true
	}
	return false
}

func (e *round7Editor) withUpdate(action func()) {
	if e == nil || action == nil {
		return
	}
	e.updating = true
	defer func() { e.updating = false }()
	action()
}

func (e *round7Editor) close(accepted, applySelected bool) {
	if e == nil || e.done {
		return
	}
	e.accepted = accepted
	e.applySelected = applySelected
	e.done = true
	e.dialog.closed.Store(true)
	procDestroyWindow.Call(e.hwnd)
}

func (e *round7Editor) setTrimStart(value float64) {
	if e == nil || e.dialog == nil || e.dialog.task.Kind == model.KindImage {
		return
	}
	d := e.dialog
	minimum := media.MinimumTrimSpan(d.task.Duration, d.safeFPS())
	end := d.opts.TrimEnd
	if end <= 0 || end > d.task.Duration {
		end = d.task.Duration
	}
	if value < 0 {
		value = 0
	}
	if value > end-minimum {
		value = end - minimum
	}
	if value < 0 {
		value = 0
	}
	d.opts.TrimStart = value
	e.withUpdate(func() { setText(d.hStart, formatSecondsClock(value)) })
	e.updateInfo()
	procInvalidateRect.Call(e.hTimeline, 0, 1)
}

func (e *round7Editor) setTrimEnd(value float64) {
	if e == nil || e.dialog == nil || e.dialog.task.Kind == model.KindImage {
		return
	}
	d := e.dialog
	minimum := media.MinimumTrimSpan(d.task.Duration, d.safeFPS())
	start := d.opts.TrimStart
	if value > d.task.Duration {
		value = d.task.Duration
	}
	if value < start+minimum {
		value = start + minimum
	}
	if value > d.task.Duration {
		value = d.task.Duration
	}
	d.opts.TrimEnd = value
	e.withUpdate(func() { setText(d.hEnd, formatSecondsClock(value)) })
	e.updateInfo()
	procInvalidateRect.Call(e.hTimeline, 0, 1)
}

func (e *round7Editor) setCurrent(value float64, generate bool) {
	if e == nil || e.dialog == nil || e.dialog.task.Kind == model.KindImage {
		return
	}
	d := e.dialog
	if value < 0 {
		value = 0
	}
	if value > d.task.Duration {
		value = d.task.Duration
	}
	d.currentAt = value
	e.withUpdate(func() { setText(d.hNow, formatSecondsClock(value)) })
	procInvalidateRect.Call(e.hTimeline, 0, 1)
	if generate {
		e.lastPreviewAt = time.Now()
		d.generatePreviewFrame()
	}
}

func (e *round7Editor) syncTimesFromEdits(changed int) {
	if e == nil || e.dialog == nil || e.dialog.task.Kind == model.KindImage {
		return
	}
	d := e.dialog
	start, startErr := parseTimeValue(strings.TrimSpace(getText(d.hStart)))
	end, endErr := parseTimeValue(strings.TrimSpace(getText(d.hEnd)))
	if startErr != nil || endErr != nil {
		e.withUpdate(func() {
			setText(d.hStart, formatSecondsClock(d.opts.TrimStart))
			setText(d.hEnd, formatSecondsClock(d.opts.TrimEnd))
		})
		return
	}
	if changed == IDC_TRIM_START {
		d.opts.TrimEnd = end
		e.setTrimStart(start)
	} else {
		d.opts.TrimStart = start
		e.setTrimEnd(end)
	}
}

func (e *round7Editor) read() bool {
	if e == nil || e.dialog == nil {
		return false
	}
	d := e.dialog
	if d.task.Kind != model.KindImage {
		start, startErr := parseTimeValue(strings.TrimSpace(getText(d.hStart)))
		end, endErr := parseTimeValue(strings.TrimSpace(getText(d.hEnd)))
		if startErr != nil || endErr != nil {
			messageBox(e.hwnd, "剪辑时间", "无法识别起始时间或结束时间。", MB_OK|MB_ICONERROR)
			return false
		}
		minimum := media.MinimumTrimSpan(d.task.Duration, d.safeFPS())
		if start < 0 || end > d.task.Duration+0.05 || end-start < minimum {
			messageBox(e.hwnd, "剪辑时间", "起始时间必须早于结束时间，且二者必须位于源视频范围内。", MB_OK|MB_ICONERROR)
			return false
		}
		d.opts.TrimStart, d.opts.TrimEnd = start, end
	} else {
		d.opts.TrimStart, d.opts.TrimEnd = 0, 0
	}
	d.cropFromControls(true)
	if d.opts.Crop.Enabled {
		crop := d.opts.Crop
		if crop.Width < 2 || crop.Height < 2 || crop.X < 0 || crop.Y < 0 || crop.X+crop.Width > d.frameW || crop.Y+crop.Height > d.frameH {
			messageBox(e.hwnd, "画面选区", "画面选区必须位于转正后的画面范围内，且宽高至少为 2 像素。", MB_OK|MB_ICONERROR)
			return false
		}
	}
	return true
}

func (e *round7Editor) updateInfo() {
	if e == nil || e.dialog == nil || e.dialog.hInfo == 0 {
		return
	}
	d := e.dialog
	d.cropFromControls(false)
	crop := d.opts.Crop
	area := d.frameW * d.frameH
	keep := crop.Width * crop.Height
	percent := 100.0
	cropText := fmt.Sprintf("全画面 %d × %d", d.frameW, d.frameH)
	if crop.Enabled {
		if area > 0 {
			percent = float64(keep) / float64(area) * 100
		}
		cropText = fmt.Sprintf("%d × %d @ (%d,%d)\r\n保留画面 %.1f%%", crop.Width, crop.Height, crop.X, crop.Y, percent)
	}
	if d.task.Kind == model.KindImage {
		setText(d.hInfo, fmt.Sprintf("保留画面：%s\r\n\r\n处理顺序：转正 → 画面截取 → 缩放 → 编码", cropText))
		return
	}
	start, _ := parseTimeValue(getText(d.hStart))
	end, _ := parseTimeValue(getText(d.hEnd))
	setText(d.hInfo, fmt.Sprintf("保留片段：%s → %s\r\n输出时长：%s\r\n\r\n保留画面：%s\r\n处理顺序：转正 → 画面截取 → 缩放", formatSecondsClock(start), formatSecondsClock(end), formatSecondsClock(end-start), cropText))
}

func round7TimelineWndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	e := round7ActiveEditor
	if e == nil || e.hTimeline != hwnd {
		result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
	switch message {
	case WM_PAINT:
		e.paintTimeline(hwnd)
		return 0
	case WM_ERASEBKGND:
		return 1
	case WM_LBUTTONDOWN:
		if e.dialog.task.Kind == model.KindImage {
			return 0
		}
		pt := mousePoint(lParam)
		e.drag = e.timelineHit(int(pt.X), int(pt.Y))
		procSetCapture.Call(hwnd)
		e.updateTimelineDrag(int(pt.X), false)
		return 0
	case WM_MOUSEMOVE:
		if e.drag != round7DragNone {
			pt := mousePoint(lParam)
			e.updateTimelineDrag(int(pt.X), false)
			return 0
		}
	case WM_LBUTTONUP:
		if e.drag != round7DragNone {
			pt := mousePoint(lParam)
			drag := e.drag
			e.updateTimelineDrag(int(pt.X), true)
			e.drag = round7DragNone
			procReleaseCapture.Call()
			if drag == round7DragCurrent {
				e.dialog.generatePreviewFrame()
			}
			return 0
		}
	}
	result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func (e *round7Editor) timelineGeometry() (left, right, trackY int32) {
	var rc rect
	procGetClientRect.Call(e.hTimeline, uintptr(unsafe.Pointer(&rc)))
	left = scaleDPI(26)
	right = rc.Right - scaleDPI(26)
	if right <= left {
		right = left + 1
	}
	trackY = scaleDPI(42)
	return
}

func (e *round7Editor) timeToX(value float64) int32 {
	left, right, _ := e.timelineGeometry()
	duration := e.dialog.task.Duration
	if duration <= 0 {
		return left
	}
	if value < 0 {
		value = 0
	}
	if value > duration {
		value = duration
	}
	return left + int32(value/duration*float64(right-left))
}

func (e *round7Editor) xToTime(x int) float64 {
	left, right, _ := e.timelineGeometry()
	if int32(x) < left {
		x = int(left)
	}
	if int32(x) > right {
		x = int(right)
	}
	if right <= left || e.dialog.task.Duration <= 0 {
		return 0
	}
	return float64(int32(x)-left) / float64(right-left) * e.dialog.task.Duration
}

func (e *round7Editor) timelineHit(x, y int) round7TimelineDrag {
	_, _, trackY := e.timelineGeometry()
	startX := int(e.timeToX(e.dialog.opts.TrimStart))
	endX := int(e.timeToX(e.dialog.opts.TrimEnd))
	currentX := int(e.timeToX(e.dialog.currentAt))
	abs := func(value int) int {
		if value < 0 {
			return -value
		}
		return value
	}
	if int32(y) <= trackY-scaleDPI(2) {
		if abs(x-startX) <= int(scaleDPI(12)) {
			return round7DragTrimStart
		}
		if abs(x-endX) <= int(scaleDPI(12)) {
			return round7DragTrimEnd
		}
	}
	if abs(x-currentX) <= int(scaleDPI(12)) {
		return round7DragCurrent
	}
	return round7DragCurrent
}

func (e *round7Editor) updateTimelineDrag(x int, final bool) {
	value := e.xToTime(x)
	switch e.drag {
	case round7DragTrimStart:
		e.setTrimStart(value)
	case round7DragTrimEnd:
		e.setTrimEnd(value)
	default:
		e.setCurrent(value, false)
		if final {
			e.lastPreviewAt = time.Now()
		}
	}
}

func (e *round7Editor) paintTimeline(hwnd uintptr) {
	var ps paintStruct
	hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	defer procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	fillSolid(hdc, rc, colorRef(255, 255, 255))

	left, right, trackY := e.timelineGeometry()
	track := rect{Left: left, Top: trackY - scaleDPI(5), Right: right, Bottom: trackY + scaleDPI(6)}
	fillSolid(hdc, track, colorRef(232, 236, 241))
	startX := e.timeToX(e.dialog.opts.TrimStart)
	endX := e.timeToX(e.dialog.opts.TrimEnd)
	currentX := e.timeToX(e.dialog.currentAt)
	selected := track
	selected.Left = startX
	selected.Right = endX
	fillSolid(hdc, selected, colorRef(209, 226, 248))
	round7TimelineLine(hdc, left, trackY, right, trackY, colorRef(142, 153, 168), 1)

	// Fixed source endpoints: first and fifth markers.
	round7TimelineLine(hdc, left, trackY-scaleDPI(12), left, trackY+scaleDPI(13), colorRef(91, 101, 114), 2)
	round7TimelineLine(hdc, right, trackY-scaleDPI(12), right, trackY+scaleDPI(13), colorRef(91, 101, 114), 2)

	// Movable trim boundaries: second and fourth markers.
	blue := colorRef(48, 112, 196)
	round7TimelineLine(hdc, startX, trackY-scaleDPI(22), startX, trackY+scaleDPI(18), blue, 2)
	round7TimelineLine(hdc, endX, trackY-scaleDPI(22), endX, trackY+scaleDPI(18), blue, 2)
	startHandle := rect{Left: startX - scaleDPI(6), Top: trackY - scaleDPI(27), Right: startX + scaleDPI(7), Bottom: trackY - scaleDPI(17)}
	endHandle := rect{Left: endX - scaleDPI(6), Top: trackY - scaleDPI(27), Right: endX + scaleDPI(7), Bottom: trackY - scaleDPI(17)}
	fillSolid(hdc, startHandle, blue)
	fillSolid(hdc, endHandle, blue)

	// Current playhead: the primary third marker.
	red := colorRef(217, 62, 55)
	round7TimelineLine(hdc, currentX, trackY-scaleDPI(28), currentX, trackY+scaleDPI(25), red, 2)
	points := []point{
		{X: currentX - scaleDPI(6), Y: trackY + scaleDPI(18)},
		{X: currentX + scaleDPI(6), Y: trackY + scaleDPI(18)},
		{X: currentX, Y: trackY + scaleDPI(27)},
	}
	round7FillPolygon(hdc, points, red)

	round7TimelineText(hdc, "源起点", rect{Left: left, Top: trackY + scaleDPI(29), Right: left + scaleDPI(74), Bottom: rc.Bottom}, DT_LEFT, colorRef(92, 102, 116))
	round7TimelineText(hdc, "源终点", rect{Left: right - scaleDPI(74), Top: trackY + scaleDPI(29), Right: right, Bottom: rc.Bottom}, DT_RIGHT, colorRef(92, 102, 116))
	round7TimelineText(hdc, "剪辑起点", round7MarkerLabelRect(startX, rc.Right, trackY-scaleDPI(45)), DT_CENTER, blue)
	round7TimelineText(hdc, "剪辑终点", round7MarkerLabelRect(endX, rc.Right, trackY-scaleDPI(45)), DT_CENTER, blue)
	round7TimelineText(hdc, "当前", round7MarkerLabelRect(currentX, rc.Right, trackY+scaleDPI(29)), DT_CENTER, red)
}

func round7MarkerLabelRect(center, clientRight, top int32) rect {
	width := scaleDPI(74)
	left := center - width/2
	if left < 0 {
		left = 0
	}
	if left+width > clientRight {
		left = clientRight - width
	}
	return rect{Left: left, Top: top, Right: left + width, Bottom: top + scaleDPI(20)}
}

func round7TimelineText(hdc uintptr, text string, rc rect, alignment uintptr, color uintptr) {
	oldFont, _, _ := procSelectObject.Call(hdc, uiFontSmall)
	procSetBkMode.Call(hdc, TRANSPARENT)
	procSetTextColor.Call(hdc, color)
	procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(text))), ^uintptr(0), uintptr(unsafe.Pointer(&rc)), alignment|DT_VCENTER|DT_SINGLELINE)
	if oldFont != 0 {
		procSelectObject.Call(hdc, oldFont)
	}
}

func round7TimelineLine(hdc uintptr, x1, y1, x2, y2 int32, color uintptr, width int32) {
	pen, _, _ := procCreatePen.Call(PS_SOLID, uintptr(width), color)
	oldPen, _, _ := procSelectObject.Call(hdc, pen)
	drawGDIline(hdc, x1, y1, x2, y2)
	procSelectObject.Call(hdc, oldPen)
	procDeleteObject.Call(pen)
}

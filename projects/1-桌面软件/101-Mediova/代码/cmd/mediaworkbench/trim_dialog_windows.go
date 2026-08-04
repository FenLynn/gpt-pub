//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

const (
	IDC_TRIM_START          = 4001
	IDC_TRIM_END            = 4002
	IDC_CROP_ON             = 4003
	IDC_CROP_X              = 4004
	IDC_CROP_Y              = 4005
	IDC_CROP_W              = 4006
	IDC_CROP_H              = 4007
	IDC_FRAME_PREVIEW       = 4008
	IDC_FULL_FRAME          = 4009
	IDC_FULL_TIME           = 4010
	IDC_TRIM_OK             = 4011
	IDC_TRIM_CANCEL         = 4012
	IDC_PREVIEW_CANVAS      = 4013
	IDC_TIMELINE            = 4014
	IDC_CURRENT_TIME        = 4015
	IDC_JUMP_TIME           = 4016
	IDC_SEEK_MINUS_SEC      = 4017
	IDC_SEEK_MINUS_FRAME    = 4018
	IDC_SEEK_PLUS_FRAME     = 4019
	IDC_SEEK_PLUS_SEC       = 4020
	IDC_CROP_ASPECT         = 4021
	IDC_CROP_CENTER         = 4022
	IDC_CROP_APPLY_SELECTED = 4023
)

type trimDialog struct {
	owner  *application
	hwnd   uintptr
	task   *model.Task
	opts   model.TaskOptions
	done   bool
	closed atomic.Bool

	accepted bool
	hStart   uintptr
	hEnd     uintptr
	hCrop    uintptr
	hX       uintptr
	hY       uintptr
	hW       uintptr
	hH       uintptr
	hInfo    uintptr
	hCanvas  uintptr
	hTrack   uintptr
	hNow     uintptr
	hAspect  uintptr

	frameW, frameH int
	currentAt      float64
	bitmap         uintptr
	bitmapW        int32
	bitmapH        int32
	previewSeq     atomic.Int64
	dragging       bool
	dragStart      point
	applySelected  bool
	cropSyncDepth  int
}

var activeTrim *trimDialog
var trimClassRegistered bool
var trimPreviewClassRegistered bool

func showTrimCropDialog(owner *application, task *model.Task, opts model.TaskOptions) (model.TaskOptions, bool, bool) {
	if task == nil {
		return opts, false, false
	}
	frameW, frameH := effectiveFrameSize(task, opts.Rotation)
	if task.Kind == model.KindImage {
		opts.TrimStart = 0
		opts.TrimEnd = 0
	} else if opts.TrimEnd <= 0 || opts.TrimEnd > task.Duration {
		opts.TrimEnd = task.Duration
	}
	if opts.Crop.Width <= 0 || opts.Crop.Height <= 0 || opts.Crop.X+opts.Crop.Width > frameW || opts.Crop.Y+opts.Crop.Height > frameH {
		opts.Crop = model.Crop{Enabled: false, X: 0, Y: 0, Width: frameW, Height: frameH}
	}
	d := &trimDialog{owner: owner, task: task, opts: opts, frameW: frameW, frameH: frameH, currentAt: opts.TrimStart}
	activeTrim = d
	if !trimClassRegistered {
		registerTrimClass(owner.hIcon)
		trimClassRegistered = true
	}
	if !trimPreviewClassRegistered {
		registerTrimPreviewClass()
		trimPreviewClassRegistered = true
	}
	hInst, _, _ := procGetModuleHandleW.Call(0)
	title := "时长与画面裁剪 · " + filepath.Base(task.Input)
	if task.Kind == model.KindImage {
		title = "图片画面裁剪 · " + filepath.Base(task.Input)
	}
	h, _, _ := procCreateWindowExW.Call(WS_EX_DLGMODALFRAME|WS_EX_TOOLWINDOW, uintptr(unsafe.Pointer(p("MWTrimCropDialog"))), uintptr(unsafe.Pointer(p(title))), WS_OVERLAPPEDWINDOW|WS_VISIBLE|WS_CLIPCHILDREN, 120, 70, 1120, 800, owner.hwnd, 0, hInst, 0)
	if h == 0 {
		activeTrim = nil
		return opts, false, false
	}
	d.hwnd = h
	enable(owner.hwnd, false)
	procSetForegroundWindow.Call(h)
	var m msg
	for !d.done {
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
	activeTrim = nil
	return d.opts, d.accepted, d.applySelected
}

func effectiveFrameSize(task *model.Task, rotation string) (int, int) {
	w, h := task.Width, task.Height
	r := 0
	switch rotation {
	case "90°右转", "90°左转":
		r = 90
	case "自动":
		r = task.Rotation
	}
	if r == 90 || r == 270 {
		w, h = h, w
	}
	if w < 2 {
		w = 2
	}
	if h < 2 {
		h = 2
	}
	return w, h
}

func registerTrimClass(icon uintptr) {
	hInst, _, _ := procGetModuleHandleW.Call(0)
	name := p("MWTrimCropDialog")
	wc := wndClassEx{CbSize: uint32(unsafe.Sizeof(wndClassEx{})), LpfnWndProc: syscall.NewCallback(trimWndProc), HInstance: hInst, HIcon: icon, HIconSm: icon, HCursor: func() uintptr { r, _, _ := procLoadCursorW.Call(0, 32512); return r }(), HbrBackground: COLOR_WINDOW + 1, LpszClassName: name}
	procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
}

func registerTrimPreviewClass() {
	hInst, _, _ := procGetModuleHandleW.Call(0)
	name := p("MWTrimPreviewCanvas")
	wc := wndClassEx{CbSize: uint32(unsafe.Sizeof(wndClassEx{})), LpfnWndProc: syscall.NewCallback(trimPreviewWndProc), HInstance: hInst, HCursor: func() uintptr { r, _, _ := procLoadCursorW.Call(0, 32515); return r }(), HbrBackground: COLOR_WINDOW + 1, LpszClassName: name}
	procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
}

func trimWndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	d := activeTrim
	switch message {
	case WM_CREATE:
		if d != nil {
			d.hwnd = hwnd
			d.init()
		}
		return 0
	case WM_COMMAND:
		if d != nil {
			d.command(int(loWord(wParam)))
		}
		return 0
	case WM_HSCROLL:
		if d != nil && lParam == d.hTrack {
			d.timelineChanged(int(loWord(wParam)))
		}
		return 0
	case WM_KEYDOWN:
		if d != nil && d.keyDown(int(wParam)) {
			return 0
		}
	case WM_CLOSE:
		if d != nil {
			d.done = true
			d.accepted = false
			d.closed.Store(true)
		}
		procDestroyWindow.Call(hwnd)
		return 0
	case WM_DESTROY:
		if d != nil {
			d.done = true
		}
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return r
}

func trimPreviewWndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	d := activeTrim
	if d == nil || hwnd != d.hCanvas {
		r, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
		return r
	}
	switch message {
	case WM_PAINT:
		d.paintPreview(hwnd)
		return 0
	case WM_LBUTTONDOWN:
		if pt, ok := d.imagePoint(lParam); ok {
			d.dragging = true
			d.dragStart = pt
			d.opts.Crop = model.Crop{Enabled: true, X: int(pt.X), Y: int(pt.Y), Width: 2, Height: 2}
			send(d.hCrop, BM_SETCHECK, BST_CHECKED, 0)
			d.cropToControls()
			procSetCapture.Call(hwnd)
		}
		return 0
	case WM_MOUSEMOVE:
		if d.dragging {
			if pt, ok := d.imagePointClamped(lParam); ok {
				d.setDragCrop(d.dragStart, pt)
			}
		}
		return 0
	case WM_LBUTTONUP:
		if d.dragging {
			d.dragging = false
			procReleaseCapture.Call()
			if pt, ok := d.imagePointClamped(lParam); ok {
				d.setDragCrop(d.dragStart, pt)
			}
		}
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return r
}

func (d *trimDialog) init() {
	// Large integrated preview, matching the original v2.8.4 workflow.
	d.hCanvas = createControlEx(WS_EX_CLIENTEDGE, "MWTrimPreviewCanvas", "", WS_CHILD|WS_VISIBLE, 15, 20, 700, 520, d.hwnd, IDC_PREVIEW_CANVAS)
	createControl("STATIC", "拖动时间轴快速预览；在画面中拖动鼠标可框选保留区域。", WS_CHILD|WS_VISIBLE, 15, 548, 700, 24, d.hwnd, 0)
	createControl("STATIC", "当前位置", WS_CHILD|WS_VISIBLE, 15, 580, 78, 26, d.hwnd, 0)
	d.hNow = createControlEx(WS_EX_CLIENTEDGE, "EDIT", formatSecondsClock(d.currentAt), WS_CHILD|WS_VISIBLE|WS_TABSTOP|ES_AUTOHSCROLL, 96, 576, 145, 30, d.hwnd, IDC_CURRENT_TIME)
	createControl("BUTTON", "跳转", WS_CHILD|WS_VISIBLE|WS_TABSTOP, 248, 576, 70, 30, d.hwnd, IDC_JUMP_TIME)
	createControl("STATIC", filepath.Base(d.task.Input)+" · "+formatSecondsClock(d.task.Duration), WS_CHILD|WS_VISIBLE, 328, 580, 380, 26, d.hwnd, 0)
	d.hTrack = createControl("msctls_trackbar32", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP, 15, 615, 700, 38, d.hwnd, IDC_TIMELINE)
	send(d.hTrack, TBM_SETRANGE, 1, uintptr(uint32(10000)<<16))
	send(d.hTrack, TBM_SETTICFREQ, 1000, 0)
	d.setTimelineFromTime()
	if d.task.Kind == model.KindImage {
		for _, h := range []uintptr{d.hNow, d.hTrack} {
			enable(h, false)
		}
	}
	createControl("BUTTON", "−1 秒", WS_CHILD|WS_VISIBLE|WS_TABSTOP, 210, 660, 90, 32, d.hwnd, IDC_SEEK_MINUS_SEC)
	createControl("BUTTON", "−1 帧", WS_CHILD|WS_VISIBLE|WS_TABSTOP, 308, 660, 90, 32, d.hwnd, IDC_SEEK_MINUS_FRAME)
	createControl("BUTTON", "+1 帧", WS_CHILD|WS_VISIBLE|WS_TABSTOP, 406, 660, 90, 32, d.hwnd, IDC_SEEK_PLUS_FRAME)
	createControl("BUTTON", "+1 秒", WS_CHILD|WS_VISIBLE|WS_TABSTOP, 504, 660, 90, 32, d.hwnd, IDC_SEEK_PLUS_SEC)

	x := int32(735)
	createControl("STATIC", "开始时间", WS_CHILD|WS_VISIBLE, x, 24, 80, 26, d.hwnd, 0)
	d.hStart = createControlEx(WS_EX_CLIENTEDGE, "EDIT", formatSecondsClock(d.opts.TrimStart), WS_CHILD|WS_VISIBLE|WS_TABSTOP|ES_AUTOHSCROLL, x+82, 20, 135, 30, d.hwnd, IDC_TRIM_START)
	createControl("STATIC", "结束时间", WS_CHILD|WS_VISIBLE, x, 62, 80, 26, d.hwnd, 0)
	d.hEnd = createControlEx(WS_EX_CLIENTEDGE, "EDIT", formatSecondsClock(d.opts.TrimEnd), WS_CHILD|WS_VISIBLE|WS_TABSTOP|ES_AUTOHSCROLL, x+82, 58, 135, 30, d.hwnd, IDC_TRIM_END)
	createControl("BUTTON", "设为当前", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x+222, 20, 110, 30, d.hwnd, IDC_TRIM_START+100)
	createControl("BUTTON", "设为当前", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x+222, 58, 110, 30, d.hwnd, IDC_TRIM_END+100)
	createControl("BUTTON", "恢复完整时长", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x, 98, 332, 32, d.hwnd, IDC_FULL_TIME)
	if d.task.Kind == model.KindImage {
		enable(d.hStart, false)
		enable(d.hEnd, false)
		setText(d.hStart, "图片")
		setText(d.hEnd, "无时间轴")
	}

	d.hCrop = createControl("BUTTON", "启用画面裁剪", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_AUTOCHECKBOX, x, 146, 150, 30, d.hwnd, IDC_CROP_ON)
	if d.opts.Crop.Enabled {
		send(d.hCrop, BM_SETCHECK, BST_CHECKED, 0)
	}
	labels := []string{"左 X", "上 Y", "宽度", "高度"}
	vals := []int{d.opts.Crop.X, d.opts.Crop.Y, d.opts.Crop.Width, d.opts.Crop.Height}
	ids := []int{IDC_CROP_X, IDC_CROP_Y, IDC_CROP_W, IDC_CROP_H}
	handles := []*uintptr{&d.hX, &d.hY, &d.hW, &d.hH}
	for i := range labels {
		y := int32(184 + i*38)
		createControl("STATIC", labels[i], WS_CHILD|WS_VISIBLE, x, y+4, 70, 26, d.hwnd, 0)
		*handles[i] = createControlEx(WS_EX_CLIENTEDGE, "EDIT", strconv.Itoa(vals[i]), WS_CHILD|WS_VISIBLE|WS_TABSTOP|ES_AUTOHSCROLL|ES_NUMBER, x+72, y, 120, 30, d.hwnd, ids[i])
	}
	createControl("STATIC", fmt.Sprintf("转正后画面：%d×%d", d.frameW, d.frameH), WS_CHILD|WS_VISIBLE, x+200, 188, 132, 52, d.hwnd, 0)
	createControl("BUTTON", "恢复全画面", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x+200, 260, 132, 32, d.hwnd, IDC_FULL_FRAME)
	createControl("STATIC", "裁剪比例", WS_CHILD|WS_VISIBLE, x, 312, 70, 26, d.hwnd, 0)
	d.hAspect = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, x+72, 306, 120, 200, d.hwnd, IDC_CROP_ASPECT)
	for _, label := range []string{"自由", "16:9", "9:16", "1:1", "4:3"} {
		send(d.hAspect, CB_ADDSTRING, 0, uintptr(unsafe.Pointer(p(label))))
	}
	send(d.hAspect, CB_SETCURSEL, 0, 0)
	createControl("BUTTON", "居中适配", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x+200, 306, 132, 32, d.hwnd, IDC_CROP_CENTER)
	d.hInfo = createControlEx(WS_EX_CLIENTEDGE, "EDIT", "", WS_CHILD|WS_VISIBLE|ES_MULTILINE|ES_READONLY|WS_VSCROLL, x, 350, 332, 138, d.hwnd, 0)
	createControl("BUTTON", "生成高清预览", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x, 500, 332, 36, d.hwnd, IDC_FRAME_PREVIEW)
	createControl("BUTTON", "应用到已选任务", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x, 614, 332, 36, d.hwnd, IDC_CROP_APPLY_SELECTED)
	createControl("BUTTON", "应用到当前任务", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_DEFPUSHBUTTON, x, 660, 200, 40, d.hwnd, IDC_TRIM_OK)
	createControl("BUTTON", "取消", WS_CHILD|WS_VISIBLE|WS_TABSTOP, x+208, 660, 124, 40, d.hwnd, IDC_TRIM_CANCEL)
	d.updateInfo()
	d.generatePreviewFrame()
}

func (d *trimDialog) command(id int) {
	if d.cropSyncDepth > 0 {
		switch id {
		case IDC_CROP_X, IDC_CROP_Y, IDC_CROP_W, IDC_CROP_H:
			return
		}
	}
	switch id {
	case IDC_FULL_TIME:
		setText(d.hStart, "00:00:00.000")
		setText(d.hEnd, formatSecondsClock(d.task.Duration))
		d.updateInfo()
	case IDC_FULL_FRAME:
		d.opts.Crop = model.Crop{Enabled: false, X: 0, Y: 0, Width: evenSize(d.frameW), Height: evenSize(d.frameH)}
		send(d.hCrop, BM_SETCHECK, 0, 0)
		d.cropToControls()
	case IDC_CROP_ASPECT:
		d.updateInfo()
	case IDC_CROP_CENTER:
		d.fitSelectedAspect()
	case IDC_FRAME_PREVIEW:
		d.openHighQualityPreview()
	case IDC_JUMP_TIME:
		if v, err := parseTimeValue(getText(d.hNow)); err == nil {
			d.setCurrentTime(v, true)
		} else {
			messageBox(d.hwnd, "跳转时间", "无法识别当前位置。", MB_OK|MB_ICONERROR)
		}
	case IDC_SEEK_MINUS_SEC:
		d.seek(-1)
	case IDC_SEEK_PLUS_SEC:
		d.seek(1)
	case IDC_SEEK_MINUS_FRAME:
		d.seek(-1 / d.safeFPS())
	case IDC_SEEK_PLUS_FRAME:
		d.seek(1 / d.safeFPS())
	case IDC_TRIM_START + 100:
		setText(d.hStart, formatSecondsClock(d.currentAt))
		d.updateInfo()
	case IDC_TRIM_END + 100:
		setText(d.hEnd, formatSecondsClock(d.currentAt))
		d.updateInfo()
	case IDC_CROP_APPLY_SELECTED:
		if d.read() {
			d.applySelected = true
			d.accepted = true
			d.done = true
			d.closed.Store(true)
			procDestroyWindow.Call(d.hwnd)
		}
	case IDC_TRIM_OK:
		if d.read() {
			d.applySelected = false
			d.accepted = true
			d.done = true
			d.closed.Store(true)
			procDestroyWindow.Call(d.hwnd)
		}
	case IDC_TRIM_CANCEL:
		d.accepted = false
		d.done = true
		d.closed.Store(true)
		procDestroyWindow.Call(d.hwnd)
	case IDC_CROP_X, IDC_CROP_Y, IDC_CROP_W, IDC_CROP_H, IDC_CROP_ON, IDC_TRIM_START, IDC_TRIM_END:
		d.cropFromControls(false)
		d.updateInfo()
		procInvalidateRect.Call(d.hCanvas, 0, 0)
	}
}

func (d *trimDialog) selectedAspect() (int, int, bool) {
	if d.hAspect == 0 {
		return 0, 0, false
	}
	return media.CropAspect(comboText(d.hAspect))
}

func (d *trimDialog) fitSelectedAspect() {
	ratioW, ratioH, ok := d.selectedAspect()
	if !ok {
		return
	}
	d.opts.Crop = media.FitAspectCrop(d.frameW, d.frameH, ratioW, ratioH)
	send(d.hCrop, BM_SETCHECK, BST_CHECKED, 0)
	d.cropToControls()
}

func (d *trimDialog) keyDown(key int) bool {
	shiftState, _, _ := procGetKeyState.Call(0x10)
	shifted := int16(shiftState&0xffff) < 0
	switch key {
	case 0x25: // Left
		if shifted {
			d.seek(-1)
		} else {
			d.seek(-1 / d.safeFPS())
		}
		return true
	case 0x27: // Right
		if shifted {
			d.seek(1)
		} else {
			d.seek(1 / d.safeFPS())
		}
		return true
	case 'I':
		setText(d.hStart, formatSecondsClock(d.currentAt))
		d.updateInfo()
		return true
	case 'O':
		setText(d.hEnd, formatSecondsClock(d.currentAt))
		d.updateInfo()
		return true
	case 'R':
		d.opts.Crop = model.Crop{Enabled: false, X: 0, Y: 0, Width: evenSize(d.frameW), Height: evenSize(d.frameH)}
		d.cropToControls()
		return true
	}
	return false
}

func (d *trimDialog) timelineChanged(code int) {
	pos := int(send(d.hTrack, TBM_GETPOS, 0, 0))
	v := 0.0
	if d.task.Duration > 0 {
		v = float64(pos) / 10000 * d.task.Duration
	}
	d.currentAt = v
	setText(d.hNow, formatSecondsClock(v))
	if code == 4 || code == 8 || code == 0 || code == 1 {
		d.generatePreviewFrame()
	}
}

func (d *trimDialog) safeFPS() float64 {
	if d.task.FPS > 0.1 {
		return d.task.FPS
	}
	return 25
}

func (d *trimDialog) seek(delta float64) { d.setCurrentTime(d.currentAt+delta, true) }

func (d *trimDialog) setCurrentTime(v float64, generate bool) {
	if v < 0 {
		v = 0
	}
	if v > d.task.Duration {
		v = d.task.Duration
	}
	d.currentAt = v
	setText(d.hNow, formatSecondsClock(v))
	d.setTimelineFromTime()
	if generate {
		d.generatePreviewFrame()
	}
}

func (d *trimDialog) setTimelineFromTime() {
	pos := 0
	if d.task.Duration > 0 {
		pos = int(d.currentAt / d.task.Duration * 10000)
	}
	if pos < 0 {
		pos = 0
	}
	if pos > 10000 {
		pos = 10000
	}
	send(d.hTrack, TBM_SETPOS, 1, uintptr(pos))
}

func (d *trimDialog) read() bool {
	start, end := 0.0, 0.0
	if d.task.Kind == model.KindImage {
		d.cropFromControls(true)
		if d.opts.Crop.Enabled {
			c := d.opts.Crop
			if c.Width < 2 || c.Height < 2 || c.X < 0 || c.Y < 0 || c.X+c.Width > d.frameW || c.Y+c.Height > d.frameH {
				messageBox(d.hwnd, "裁剪区域", "裁剪区域必须位于图片范围内，且宽高至少为 2 像素。", MB_OK|MB_ICONERROR)
				return false
			}
		}
		d.opts.TrimStart = 0
		d.opts.TrimEnd = 0
		return true
	}
	start, err := parseTimeValue(getText(d.hStart))
	if err != nil {
		messageBox(d.hwnd, "开始时间", "无法识别开始时间。", MB_OK|MB_ICONERROR)
		return false
	}
	end, err = parseTimeValue(getText(d.hEnd))
	if err != nil {
		messageBox(d.hwnd, "结束时间", "无法识别结束时间。", MB_OK|MB_ICONERROR)
		return false
	}
	if end <= start || start < 0 || end > d.task.Duration+0.1 {
		messageBox(d.hwnd, "时间范围", "结束时间必须晚于开始时间，并且不能超过源视频时长。", MB_OK|MB_ICONERROR)
		return false
	}
	d.cropFromControls(true)
	if d.opts.Crop.Enabled {
		c := d.opts.Crop
		if c.Width < 2 || c.Height < 2 || c.X < 0 || c.Y < 0 || c.X+c.Width > d.frameW || c.Y+c.Height > d.frameH {
			messageBox(d.hwnd, "裁剪区域", "裁剪区域必须位于转正后的画面内，且宽高至少为 2 像素。", MB_OK|MB_ICONERROR)
			return false
		}
	}
	d.opts.TrimStart = start
	d.opts.TrimEnd = end
	return true
}

func evenCoord(v int) int {
	if v < 0 {
		return 0
	}
	return v &^ 1
}

func evenSize(v int) int {
	if v < 2 {
		return 2
	}
	return v &^ 1
}

func (d *trimDialog) cropFromControls(normalize bool) {
	x, _ := strconv.Atoi(strings.TrimSpace(getText(d.hX)))
	y, _ := strconv.Atoi(strings.TrimSpace(getText(d.hY)))
	w, _ := strconv.Atoi(strings.TrimSpace(getText(d.hW)))
	h, _ := strconv.Atoi(strings.TrimSpace(getText(d.hH)))
	enabled := send(d.hCrop, BM_GETCHECK, 0, 0) == BST_CHECKED
	if normalize && enabled {
		if x < 0 {
			x = 0
		}
		if y < 0 {
			y = 0
		}
		x = evenCoord(x)
		y = evenCoord(y)
		if x >= d.frameW {
			x = evenCoord(d.frameW - 2)
		}
		if y >= d.frameH {
			y = evenCoord(d.frameH - 2)
		}
		w = evenSize(w)
		h = evenSize(h)
		if x+w > d.frameW {
			w = evenSize(d.frameW - x)
		}
		if y+h > d.frameH {
			h = evenSize(d.frameH - y)
		}
	}
	d.opts.Crop = model.Crop{Enabled: enabled, X: x, Y: y, Width: w, Height: h}
	if normalize {
		d.cropToControls()
	}
}

func (d *trimDialog) cropToControls() {
	d.cropSyncDepth++
	defer func() { d.cropSyncDepth-- }()
	setText(d.hX, strconv.Itoa(d.opts.Crop.X))
	setText(d.hY, strconv.Itoa(d.opts.Crop.Y))
	setText(d.hW, strconv.Itoa(d.opts.Crop.Width))
	setText(d.hH, strconv.Itoa(d.opts.Crop.Height))
	if d.opts.Crop.Enabled {
		send(d.hCrop, BM_SETCHECK, BST_CHECKED, 0)
	} else {
		send(d.hCrop, BM_SETCHECK, 0, 0)
	}
	d.updateInfo()
	procInvalidateRect.Call(d.hCanvas, 0, 0)
}

func (d *trimDialog) updateInfo() {
	start, end := 0.0, 0.0
	if d.task.Kind != model.KindImage {
		start, _ = parseTimeValue(getText(d.hStart))
		end, _ = parseTimeValue(getText(d.hEnd))
	}
	d.cropFromControls(false)
	c := d.opts.Crop
	area := d.frameW * d.frameH
	keep := c.Width * c.Height
	pct := 100.0
	if area > 0 && c.Enabled {
		pct = float64(keep) / float64(area) * 100
	}
	crop := fmt.Sprintf("全画面 %d×%d", d.frameW, d.frameH)
	if c.Enabled {
		crop = fmt.Sprintf("%d×%d @ (%d,%d)\r\n保留画面面积 %.1f%%", c.Width, c.Height, c.X, c.Y, pct)
	}
	if d.task.Kind == model.KindImage {
		setText(d.hInfo, fmt.Sprintf("图片输入：%s\r\n保留区域：%s\r\n处理顺序：转正 → 裁剪 → 缩放 → 编码\r\n拍摄时间与文件时间按全局设置保留。", filepath.Ext(d.task.Input), crop))
		return
	}
	setText(d.hInfo, fmt.Sprintf("保留片段：%s → %s\r\n输出时长：%s\r\n\r\n保留区域：%s\r\n编码顺序：转正 → 裁剪 → 缩放", formatSecondsClock(start), formatSecondsClock(end), formatSecondsClock(end-start), crop))
}

func (d *trimDialog) generatePreviewFrame() {
	if d.owner.ffmpeg == "" || d.closed.Load() {
		return
	}
	seq := d.previewSeq.Add(1)
	dir, _ := config.TempDir()
	out := filepath.Join(dir, fmt.Sprintf("trim_frame_%d_%d.bmp", d.task.ID, seq))
	at, rotation, input := d.currentAt, d.opts.Rotation, d.task.Input
	go func() {
		err := media.GenerateFramePreview(context.Background(), d.owner.ffmpeg, input, out, at, rotation, 960, 680)
		d.owner.postUI(func() {
			defer os.Remove(out)
			if d.closed.Load() || d.previewSeq.Load() != seq {
				return
			}
			if err != nil {
				setText(d.hInfo, "预览帧生成失败："+short(err.Error(), 240))
				return
			}
			h, _, _ := procLoadImageW.Call(0, uintptr(unsafe.Pointer(p(out))), IMAGE_BITMAP, 0, 0, LR_LOADFROMFILE|LR_CREATEDIBSECTION)
			if h == 0 {
				setText(d.hInfo, "预览帧加载失败。")
				return
			}
			if d.bitmap != 0 {
				procDeleteObject.Call(d.bitmap)
			}
			d.bitmap = h
			var bm bitmapInfo
			procGetObjectW.Call(h, unsafe.Sizeof(bm), uintptr(unsafe.Pointer(&bm)))
			d.bitmapW, d.bitmapH = bm.Width, bm.Height
			procInvalidateRect.Call(d.hCanvas, 0, 1)
		})
	}()
}

func (d *trimDialog) openHighQualityPreview() {
	if d.owner.ffmpeg == "" {
		messageBox(d.hwnd, "预览", "尚未配置 FFmpeg。", MB_OK|MB_ICONERROR)
		return
	}
	d.cropFromControls(true)
	dir, _ := config.TempDir()
	out := filepath.Join(dir, fmt.Sprintf("crop_preview_%d.jpg", time.Now().UnixNano()))
	req := media.ConvertRequest{Input: d.task.Input, Output: out, Kind: d.task.Kind, Probe: media.ProbeInfo{Width: d.task.Width, Height: d.task.Height, Rotation: d.task.Rotation, Duration: d.task.Duration, FPS: d.task.FPS}, Options: d.opts, Settings: d.owner.settings}
	at := d.currentAt
	setText(d.hInfo, "正在生成高清处理后预览，请稍候…")
	go func() {
		err := media.GenerateProcessedFrame(context.Background(), d.owner.ffmpeg, req, at)
		d.owner.postUI(func() {
			if err != nil {
				messageBox(d.hwnd, "高清预览", err.Error(), MB_OK|MB_ICONERROR)
				d.updateInfo()
				return
			}
			shellOpen(out)
			d.updateInfo()
		})
	}()
}

func (d *trimDialog) previewDrawRect(hwnd uintptr) rect {
	var rc rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	if d.bitmapW <= 0 || d.bitmapH <= 0 {
		return rc
	}
	cw, ch := rc.Right-rc.Left, rc.Bottom-rc.Top
	scale := float64(cw) / float64(d.bitmapW)
	if v := float64(ch) / float64(d.bitmapH); v < scale {
		scale = v
	}
	w := int32(float64(d.bitmapW) * scale)
	h := int32(float64(d.bitmapH) * scale)
	x := (cw - w) / 2
	y := (ch - h) / 2
	return rect{Left: x, Top: y, Right: x + w, Bottom: y + h}
}

func rgb(r, g, b byte) uintptr { return uintptr(uint32(r) | uint32(g)<<8 | uint32(b)<<16) }

func (d *trimDialog) paintPreview(hwnd uintptr) {
	var ps paintStruct
	hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	defer procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	var client rect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	bg, _, _ := procCreateSolidBrush.Call(rgb(20, 24, 29))
	procFillRect.Call(hdc, uintptr(unsafe.Pointer(&client)), bg)
	procDeleteObject.Call(bg)
	if d.bitmap == 0 || d.bitmapW <= 0 || d.bitmapH <= 0 {
		return
	}
	dr := d.previewDrawRect(hwnd)
	mem, _, _ := procCreateCompatibleDC.Call(hdc)
	old, _, _ := procSelectObject.Call(mem, d.bitmap)
	procSetStretchBltMode.Call(hdc, HALFTONE)
	procStretchBlt.Call(hdc, uintptr(dr.Left), uintptr(dr.Top), uintptr(dr.Right-dr.Left), uintptr(dr.Bottom-dr.Top), mem, 0, 0, uintptr(d.bitmapW), uintptr(d.bitmapH), SRCCOPY)
	procSelectObject.Call(mem, old)
	procDeleteDC.Call(mem)
	if !d.opts.Crop.Enabled || d.frameW <= 0 || d.frameH <= 0 {
		return
	}
	c := d.opts.Crop
	sx := float64(dr.Right-dr.Left) / float64(d.frameW)
	sy := float64(dr.Bottom-dr.Top) / float64(d.frameH)
	r := rect{Left: dr.Left + int32(float64(c.X)*sx), Top: dr.Top + int32(float64(c.Y)*sy), Right: dr.Left + int32(float64(c.X+c.Width)*sx), Bottom: dr.Top + int32(float64(c.Y+c.Height)*sy)}
	pen, _, _ := procCreatePen.Call(PS_SOLID, 3, rgb(25, 205, 110))
	oldPen, _, _ := procSelectObject.Call(hdc, pen)
	nullBrush, _, _ := procGetStockObject.Call(NULL_BRUSH)
	oldBrush, _, _ := procSelectObject.Call(hdc, nullBrush)
	procRectangle.Call(hdc, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right), uintptr(r.Bottom))
	procSelectObject.Call(hdc, oldBrush)
	procSelectObject.Call(hdc, oldPen)
	procDeleteObject.Call(pen)
	handleBrush, _, _ := procCreateSolidBrush.Call(rgb(25, 205, 110))
	for _, pt := range []point{{r.Left, r.Top}, {r.Right, r.Top}, {r.Left, r.Bottom}, {r.Right, r.Bottom}} {
		hr := rect{Left: pt.X - 5, Top: pt.Y - 5, Right: pt.X + 6, Bottom: pt.Y + 6}
		procFillRect.Call(hdc, uintptr(unsafe.Pointer(&hr)), handleBrush)
	}
	procDeleteObject.Call(handleBrush)
}

func mousePoint(lParam uintptr) point {
	return point{X: int32(int16(loWord(lParam))), Y: int32(int16(hiWord(lParam)))}
}

func (d *trimDialog) imagePoint(lParam uintptr) (point, bool) {
	pt := mousePoint(lParam)
	dr := d.previewDrawRect(d.hCanvas)
	if pt.X < dr.Left || pt.X >= dr.Right || pt.Y < dr.Top || pt.Y >= dr.Bottom {
		return point{}, false
	}
	return point{X: int32(float64(pt.X-dr.Left) / float64(dr.Right-dr.Left) * float64(d.frameW)), Y: int32(float64(pt.Y-dr.Top) / float64(dr.Bottom-dr.Top) * float64(d.frameH))}, true
}

func (d *trimDialog) imagePointClamped(lParam uintptr) (point, bool) {
	pt := mousePoint(lParam)
	dr := d.previewDrawRect(d.hCanvas)
	if dr.Right <= dr.Left || dr.Bottom <= dr.Top {
		return point{}, false
	}
	if pt.X < dr.Left {
		pt.X = dr.Left
	}
	if pt.X >= dr.Right {
		pt.X = dr.Right - 1
	}
	if pt.Y < dr.Top {
		pt.Y = dr.Top
	}
	if pt.Y >= dr.Bottom {
		pt.Y = dr.Bottom - 1
	}
	return d.imagePoint(uintptr(uint16(pt.X)) | uintptr(uint16(pt.Y))<<16)
}

func (d *trimDialog) setDragCrop(a, b point) {
	ratioW, ratioH, locked := d.selectedAspect()
	d.opts.Crop = media.DragCropWithAspect(d.frameW, d.frameH, int(a.X), int(a.Y), int(b.X), int(b.Y), ratioW, ratioH, locked)
	d.cropToControls()
}

func (d *trimDialog) cleanup() {
	if d.bitmap != 0 {
		procDeleteObject.Call(d.bitmap)
		d.bitmap = 0
	}
}

func parseTimeValue(s string) (float64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}
	if !strings.Contains(s, ":") {
		return strconv.ParseFloat(s, 64)
	}
	parts := strings.Split(s, ":")
	var h, m, sec float64
	var err error
	switch len(parts) {
	case 2:
		m, err = strconv.ParseFloat(parts[0], 64)
		if err != nil {
			return 0, err
		}
		sec, err = strconv.ParseFloat(parts[1], 64)
	case 3:
		h, err = strconv.ParseFloat(parts[0], 64)
		if err != nil {
			return 0, err
		}
		m, err = strconv.ParseFloat(parts[1], 64)
		if err != nil {
			return 0, err
		}
		sec, err = strconv.ParseFloat(parts[2], 64)
	default:
		return 0, fmt.Errorf("invalid time")
	}
	if err != nil {
		return 0, err
	}
	return h*3600 + m*60 + sec, nil
}

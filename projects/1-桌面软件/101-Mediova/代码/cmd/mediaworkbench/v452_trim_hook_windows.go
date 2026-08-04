//go:build windows

package main

import (
	"path/filepath"
	"syscall"
	"unsafe"
)

const (
	v452EventObjectCreate   = 0x8000
	v452EventObjectShow     = 0x8002
	v452WineventOutofcontext = 0x0000
	v452TrimDialogSubclassID  = 0x4541
	v452TrimTrackSubclassID   = 0x4542
	v452TrimPreviewSubclassID = 0x4543
)

var (
	v452SetWinEventHook        = user32.NewProc("SetWinEventHook")
	v452GetDC                  = user32.NewProc("GetDC")
	v452ReleaseDC              = user32.NewProc("ReleaseDC")
	v452TrimWinEventCB         = syscall.NewCallback(v452TrimWinEventProc)
	v452TrimDialogSubclassCB   = syscall.NewCallback(v452TrimDialogSubclassProc)
	v452TrimTrackSubclassCB    = syscall.NewCallback(v452TrimTrackSubclassProc)
	v452TrimPreviewSubclassCB  = syscall.NewCallback(v452TrimPreviewSubclassProc)
	v452TrimWinEventHook       uintptr
)

func init() {
	v452TrimWinEventHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		v452TrimWinEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func v452TrimWinEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	if d := activeTrim; d != nil && hwnd != 0 {
		v452TryInstallTrimEditor(d)
	}
	return 0
}

func v452TryInstallTrimEditor(d *trimDialog) {
	if d == nil {
		return
	}
	state := v452TrimStateFor(d)
	if d.hwnd != 0 && !state.dialogInstalled {
		state.dialogInstalled = true
		setText(d.hwnd, "裁剪 · "+filepath.Base(d.task.Input))
		v452SetWindowSubclass.Call(d.hwnd, v452TrimDialogSubclassCB, v452TrimDialogSubclassID, 0)
	}
	if d.hTrack != 0 && !state.trackInstalled {
		state.trackInstalled = true
		move(d.hTrack, 15, 609, 700, 47)
		v452SetWindowSubclass.Call(d.hTrack, v452TrimTrackSubclassCB, v452TrimTrackSubclassID, 0)
		procInvalidateRect.Call(d.hTrack, 0, 1)
	}
	if d.hCanvas != 0 && !state.previewInstalled {
		state.previewInstalled = true
		v452SetWindowSubclass.Call(d.hCanvas, v452TrimPreviewSubclassCB, v452TrimPreviewSubclassID, 0)
	}
}

func v452TrimDialogSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == WM_CTLCOLORSTATIC {
		return v452TrimStaticBrush(wParam)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	if d := activeTrim; d != nil && d.hwnd == hwnd {
		switch message {
		case WM_COMMAND:
			switch int(loWord(wParam)) {
			case IDC_FULL_TIME, IDC_TRIM_START, IDC_TRIM_END,
				IDC_TRIM_START + 100, IDC_TRIM_END + 100,
				IDC_JUMP_TIME, IDC_SEEK_MINUS_SEC, IDC_SEEK_MINUS_FRAME,
				IDC_SEEK_PLUS_FRAME, IDC_SEEK_PLUS_SEC:
				v452InvalidateTrimTimeline(d)
			}
		case WM_KEYDOWN:
			v452InvalidateTrimTimeline(d)
		case v452WMNCDestroy:
			v452RemoveSubclass.Call(hwnd, v452TrimDialogSubclassCB, subclassID)
			v452ReleaseTrimState(d)
		}
	}
	return result
}

func v452TrimTrackSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	d := activeTrim
	if d == nil || d.hTrack != hwnd {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
	switch message {
	case WM_PAINT:
		v452PaintTrimTimeline(d, hwnd)
		return 0
	case WM_ERASEBKGND:
		return 1
	case WM_LBUTTONDOWN:
		if d.task.Kind == "image" || d.task.Duration <= 0 {
			return 0
		}
		_, left, right := v452TrimTimelineGeometry(hwnd)
		x := int(mousePoint(lParam).X)
		initial := v452ReadTrimRange(d)
		hit := media.HitTrimTimeline(initial, d.task.Duration, x, left, right, 9)
		if hit == media.TrimTimelineNone {
			hit = media.TrimTimelinePlayhead
		}
		state := v452TrimStateFor(d)
		state.timelineDragging = true
		state.timelineHit = hit
		state.timelineInitial = initial
		state.timelineAnchor = media.TimelineXToTime(float64(x), d.task.Duration, left, right)
		procSetCapture.Call(hwnd)
		v452ApplyTimelineDrag(d, x, false)
		return 0
	case WM_MOUSEMOVE:
		state := v452TrimStateFor(d)
		if state.timelineDragging {
			v452ApplyTimelineDrag(d, int(mousePoint(lParam).X), false)
		}
		return 0
	case WM_LBUTTONUP:
		state := v452TrimStateFor(d)
		if state.timelineDragging {
			v452ApplyTimelineDrag(d, int(mousePoint(lParam).X), true)
			state.timelineDragging = false
			procReleaseCapture.Call()
		}
		return 0
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, v452TrimTrackSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func v452TrimPreviewSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	d := activeTrim
	if d == nil || d.hCanvas != hwnd {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
	switch message {
	case WM_LBUTTONDOWN:
		if v452TrimPreviewMouseDown(d, hwnd, lParam) {
			return 0
		}
	case WM_MOUSEMOVE:
		if v452TrimPreviewMouseMove(d, lParam) {
			return 0
		}
	case WM_LBUTTONUP:
		if v452TrimPreviewMouseUp(d, lParam) {
			return 0
		}
	case v452WMNCDestroy:
		v452RemoveSubclass.Call(hwnd, v452TrimPreviewSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	if message == WM_PAINT && d.opts.Crop.Enabled && d.frameW > 0 && d.frameH > 0 {
		dr := d.previewDrawRect(hwnd)
		sx := float64(dr.Right-dr.Left) / float64(d.frameW)
		sy := float64(dr.Bottom-dr.Top) / float64(d.frameH)
		crop := d.opts.Crop
		cropRect := rect{
			Left:   dr.Left + int32(float64(crop.X)*sx),
			Top:    dr.Top + int32(float64(crop.Y)*sy),
			Right:  dr.Left + int32(float64(crop.X+crop.Width)*sx),
			Bottom: dr.Top + int32(float64(crop.Y+crop.Height)*sy),
		}
		hdc, _, _ := v452GetDC.Call(hwnd)
		if hdc != 0 {
			v452PaintCropHandles(hdc, cropRect)
			v452ReleaseDC.Call(hwnd, hdc)
		}
	}
	return result
}

var _ = unsafe.Pointer(nil)

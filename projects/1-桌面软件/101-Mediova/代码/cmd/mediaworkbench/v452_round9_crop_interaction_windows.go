//go:build windows

package main

import (
	"time"
	"unsafe"

	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

func round9CropClientRect(d *trimDialog) (rect, bool) {
	if d == nil || !d.opts.Crop.Enabled || d.frameW <= 0 || d.frameH <= 0 {
		return rect{}, false
	}
	dr := d.previewDrawRect(d.hCanvas)
	if dr.Right <= dr.Left || dr.Bottom <= dr.Top {
		return rect{}, false
	}
	c := d.opts.Crop
	sx := float64(dr.Right-dr.Left) / float64(d.frameW)
	sy := float64(dr.Bottom-dr.Top) / float64(d.frameH)
	return rect{
		Left:   dr.Left + int32(float64(c.X)*sx),
		Top:    dr.Top + int32(float64(c.Y)*sy),
		Right:  dr.Left + int32(float64(c.X+c.Width)*sx),
		Bottom: dr.Top + int32(float64(c.Y+c.Height)*sy),
	}, true
}

func round9CropHitTest(d *trimDialog, pt point) round9CropMode {
	r, ok := round9CropClientRect(d)
	if !ok {
		return round9CropCreate
	}
	tol := scaleDPI(8)
	nearX := func(x int32) bool { return pt.X >= x-tol && pt.X <= x+tol }
	nearY := func(y int32) bool { return pt.Y >= y-tol && pt.Y <= y+tol }
	if nearX(r.Left) && nearY(r.Top) {
		return round9CropResizeNW
	}
	if nearX(r.Right) && nearY(r.Top) {
		return round9CropResizeNE
	}
	if nearX(r.Left) && nearY(r.Bottom) {
		return round9CropResizeSW
	}
	if nearX(r.Right) && nearY(r.Bottom) {
		return round9CropResizeSE
	}
	if nearY(r.Top) && pt.X >= r.Left && pt.X <= r.Right {
		return round9CropResizeN
	}
	if nearY(r.Bottom) && pt.X >= r.Left && pt.X <= r.Right {
		return round9CropResizeS
	}
	if nearX(r.Left) && pt.Y >= r.Top && pt.Y <= r.Bottom {
		return round9CropResizeW
	}
	if nearX(r.Right) && pt.Y >= r.Top && pt.Y <= r.Bottom {
		return round9CropResizeE
	}
	if pt.X > r.Left && pt.X < r.Right && pt.Y > r.Top && pt.Y < r.Bottom {
		return round9CropMove
	}
	return round9CropCreate
}

func round9CropBoxFromModel(c model.Crop) round9CropBox {
	return round9CropBox{X: c.X, Y: c.Y, Width: c.Width, Height: c.Height}
}

func round9CropBoxToModel(box round9CropBox) model.Crop {
	return model.Crop{Enabled: true, X: box.X, Y: box.Y, Width: box.Width, Height: box.Height}
}

func round9UpdateCanvasDrag(e *round7Editor, hwnd, lParam uintptr, final bool) {
	value, ok := round9CanvasDragMap.Load(hwnd)
	if !ok || e == nil || e.dialog == nil {
		return
	}
	state := value.(*round9CanvasDragState)
	if !state.active {
		return
	}
	d := e.dialog
	clientPt := mousePoint(lParam)
	imagePt, valid := d.imagePointClamped(lParam)
	if !valid {
		return
	}
	if state.mode == round9CropCreate && !state.started {
		dx := clientPt.X - state.startClient.X
		dy := clientPt.Y - state.startClient.Y
		if dx < 0 {
			dx = -dx
		}
		if dy < 0 {
			dy = -dy
		}
		if dx < scaleDPI(3) && dy < scaleDPI(3) && !final {
			return
		}
		state.started = dx >= scaleDPI(3) || dy >= scaleDPI(3)
	}

	box := state.original
	switch state.mode {
	case round9CropCreate:
		if !state.started {
			box = state.original
			break
		}
		ratioW, ratioH, locked := d.selectedAspect()
		crop := media.DragCropWithAspect(d.frameW, d.frameH, int(state.startImage.X), int(state.startImage.Y), int(imagePt.X), int(imagePt.Y), ratioW, ratioH, locked)
		box = round9CropBoxFromModel(crop)
	case round9CropMove:
		box = round9MoveCropBox(state.original, int(imagePt.X-state.startImage.X), int(imagePt.Y-state.startImage.Y), d.frameW, d.frameH)
	default:
		box = round9ResizeCropBox(state.original, state.mode, int(imagePt.X), int(imagePt.Y), d.frameW, d.frameH)
	}
	if final {
		box = round9NormalizeEvenCrop(box, d.frameW, d.frameH)
	}
	d.opts.Crop = round9CropBoxToModel(box)
	send(d.hCrop, BM_SETCHECK, BST_CHECKED, 0)
	now := time.Now()
	if final || now.Sub(state.lastSync) >= 40*time.Millisecond {
		round7FeedbackSyncCropControls(e, final)
		state.lastSync = now
	}
	procInvalidateRect.Call(hwnd, 0, 0)
}

func round9SetCanvasCursor(mode round9CropMode) {
	id := uintptr(32515)
	switch mode {
	case round9CropMove:
		id = 32646
	case round9CropResizeN, round9CropResizeS:
		id = 32645
	case round9CropResizeW, round9CropResizeE:
		id = 32644
	case round9CropResizeNW, round9CropResizeSE:
		id = 32642
	case round9CropResizeNE, round9CropResizeSW:
		id = 32643
	}
	cursor, _, _ := procLoadCursorW.Call(0, id)
	if cursor != 0 {
		round9SetCursor.Call(cursor)
	}
}

func round9CanvasSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	e := round7ActiveEditor
	if e == nil || e.dialog == nil || e.dialog.hCanvas != hwnd {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
	d := e.dialog
	switch message {
	case WM_LBUTTONDOWN:
		imagePt, ok := d.imagePoint(lParam)
		if !ok {
			return 0
		}
		clientPt := mousePoint(lParam)
		state := &round9CanvasDragState{
			active:      true,
			mode:        round9CropHitTest(d, clientPt),
			startImage:  imagePt,
			startClient: clientPt,
			original:    round9CropBoxFromModel(d.opts.Crop),
		}
		round9CanvasDragMap.Store(hwnd, state)
		procSetCapture.Call(hwnd)
		round9SetCanvasCursor(state.mode)
		return 0
	case WM_MOUSEMOVE:
		if value, ok := round9CanvasDragMap.Load(hwnd); ok && value.(*round9CanvasDragState).active {
			round9UpdateCanvasDrag(e, hwnd, lParam, false)
			return 0
		}
		pt := mousePoint(lParam)
		round9SetCanvasCursor(round9CropHitTest(d, pt))
		return 0
	case WM_LBUTTONUP:
		if value, ok := round9CanvasDragMap.Load(hwnd); ok {
			state := value.(*round9CanvasDragState)
			if state.active {
				round9UpdateCanvasDrag(e, hwnd, lParam, true)
				state.active = false
				procReleaseCapture.Call()
				round9CanvasDragMap.Delete(hwnd)
				return 0
			}
		}
	case round9WMSetCursor:
		var pt point
		if ok, _, _ := procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt))); ok != 0 {
			procScreenToClient.Call(hwnd, uintptr(unsafe.Pointer(&pt)))
			round9SetCanvasCursor(round9CropHitTest(d, pt))
			return 1
		}
	case v452WMNCDestroy:
		round9CanvasDragMap.Delete(hwnd)
		v452RemoveSubclass.Call(hwnd, round9CanvasSubclassCB, subclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

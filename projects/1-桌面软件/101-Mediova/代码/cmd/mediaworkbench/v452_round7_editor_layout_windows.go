//go:build windows

package main

import (
	"path/filepath"
	"sync"
	"syscall"
	"unsafe"

	"mediaworkbench/internal/model"
)

var (
	round7LayoutEventCB uintptr
	round7LayoutHook    uintptr
	round7LayoutApplied sync.Map // map[*round7Editor]bool
)

func init() {
	round7LayoutEventCB = syscall.NewCallback(round7LayoutEventProc)
	round7LayoutHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		round7LayoutEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func round7LayoutEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	e := round7ActiveEditor
	if e == nil || e.hwnd == 0 || e.dialog == nil || e.dialog.hCanvas == 0 || e.hTimeline == 0 || e.hApplyCurrent == 0 {
		return 0
	}
	if _, loaded := round7LayoutApplied.LoadOrStore(e, true); loaded {
		return 0
	}
	round7ApplyCompactEditorLayout(e)
	return 0
}

func round7ApplyCompactEditorLayout(e *round7Editor) {
	if e == nil || e.hwnd == 0 || e.dialog == nil {
		return
	}
	d := e.dialog

	// Keep the complete editor inside a 1024-wide desktop. The rejected build
	// required more than 1150 px and silently clipped the right-side controls.
	var window rect
	procGetWindowRect.Call(e.hwnd, uintptr(unsafe.Pointer(&window)))
	width := int32(1016)
	height := int32(750)
	procMoveWindow.Call(e.hwnd, uintptr(window.Left), uintptr(window.Top), uintptr(width), uintptr(height), 1)

	leftWidth := int32(590)
	procMoveWindow.Call(d.hCanvas, 18, 18, uintptr(leftWidth), 400, 1)
	procMoveWindow.Call(e.hInstruction, 18, 426, uintptr(leftWidth), 24, 1)
	procMoveWindow.Call(e.hCurrentLabel, 18, 460, 72, 28, 1)
	procMoveWindow.Call(d.hNow, 92, 456, 145, 30, 1)
	procMoveWindow.Call(e.hJump, 244, 456, 70, 30, 1)
	procMoveWindow.Call(e.hFileLabel, 326, 460, 282, 28, 1)
	procMoveWindow.Call(e.hTimeline, 18, 494, uintptr(leftWidth), 86, 1)
	procMoveWindow.Call(e.hSeekMinusSec, 137, 590, 82, 32, 1)
	procMoveWindow.Call(e.hSeekMinusFrame, 227, 590, 82, 32, 1)
	procMoveWindow.Call(e.hSeekPlusFrame, 317, 590, 82, 32, 1)
	procMoveWindow.Call(e.hSeekPlusSec, 407, 590, 82, 32, 1)

	// One-line time rows, exactly matching the approved interaction wording.
	x := int32(620)
	procMoveWindow.Call(e.hStartLabel, uintptr(x), 24, 96, 28, 1)
	procMoveWindow.Call(d.hStart, uintptr(x+98), 20, 120, 30, 1)
	procMoveWindow.Call(e.hStartCurrent, uintptr(x+224), 20, 70, 30, 1)
	procMoveWindow.Call(e.hStartInitial, uintptr(x+296), 20, 70, 30, 1)
	procMoveWindow.Call(e.hEndLabel, uintptr(x), 64, 96, 28, 1)
	procMoveWindow.Call(d.hEnd, uintptr(x+98), 60, 120, 30, 1)
	procMoveWindow.Call(e.hEndCurrent, uintptr(x+224), 60, 70, 30, 1)
	procMoveWindow.Call(e.hEndTerminal, uintptr(x+296), 60, 70, 30, 1)
	procMoveWindow.Call(e.hSourceRange, uintptr(x), 102, 366, 28, 1)

	procMoveWindow.Call(d.hCrop, uintptr(x), 138, 154, 30, 1)
	for i := range e.cropLabels {
		y := uintptr(180 + i*36)
		procMoveWindow.Call(e.cropLabels[i], uintptr(x), y, 64, 26, 1)
	}
	procMoveWindow.Call(d.hX, uintptr(x+68), 176, 112, 30, 1)
	procMoveWindow.Call(d.hY, uintptr(x+68), 212, 112, 30, 1)
	procMoveWindow.Call(d.hW, uintptr(x+68), 248, 112, 30, 1)
	procMoveWindow.Call(d.hH, uintptr(x+68), 284, 112, 30, 1)
	procMoveWindow.Call(e.hCropFrameLabel, uintptr(x+190), 180, 176, 48, 1)
	procMoveWindow.Call(e.hFullFrame, uintptr(x+190), 244, 130, 32, 1)
	procMoveWindow.Call(e.hAspectLabel, uintptr(x), 326, 68, 26, 1)
	procMoveWindow.Call(d.hAspect, uintptr(x+68), 320, 112, 200, 1)
	procMoveWindow.Call(e.hCenter, uintptr(x+190), 320, 130, 32, 1)
	procMoveWindow.Call(d.hInfo, uintptr(x), 366, 366, 130, 1)
	procMoveWindow.Call(e.hPreview, uintptr(x), 506, 366, 36, 1)
	procMoveWindow.Call(e.hApplySelected, uintptr(x), 594, 366, 36, 1)
	procMoveWindow.Call(e.hApplyCurrent, uintptr(x), 640, 226, 40, 1)
	procMoveWindow.Call(e.hCancel, uintptr(x+236), 640, 130, 40, 1)

	// The stable compatibility hook renames any active trimDialog to “裁剪”
	// once during child creation. Restore the approved name after all children
	// exist; the compatibility hook has already marked this dialog installed
	// and will not rewrite it again.
	title := "剪辑 / 画面 · " + filepath.Base(d.task.Input)
	if d.task.Kind == model.KindImage {
		title = "画面调整 · " + filepath.Base(d.task.Input)
	}
	setText(e.hwnd, title)
	procInvalidateRect.Call(e.hwnd, 0, 1)
}

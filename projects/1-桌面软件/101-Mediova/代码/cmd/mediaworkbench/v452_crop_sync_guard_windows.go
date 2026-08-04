//go:build windows

package main

import (
	"sync"
	"sync/atomic"
	"syscall"
)

const (
	v452CropSyncParentSubclassID = 0x4553
	v452CropSyncEditSubclassID   = 0x4554
	v452ENChange                 = 0x0300
	v452WMSetTextMessage         = 0x000C
)

type v452CropSyncState struct {
	pending atomic.Uint32
}

var (
	v452CropSyncEventCB      uintptr
	v452CropSyncParentCB     uintptr
	v452CropSyncEditCB       uintptr
	v452CropSyncHook         uintptr
	v452CropSyncStates       sync.Map // map[dialog HWND]*v452CropSyncState
	v452CropSyncParents      sync.Map // map[dialog HWND]bool, only after successful subclassing
	v452CropSyncEdits        sync.Map // map[edit HWND]bool, only after successful subclassing
	v452CropSyncGetParent    = user32.NewProc("GetParent")
	v452CropSyncGetID        = user32.NewProc("GetDlgCtrlID")
	v452CropSyncInstallTries atomic.Int32
	v452CropSyncParentsOK    atomic.Int32
	v452CropSyncEditsOK      atomic.Int32
	v452CropSyncIntercepted  atomic.Int32
)

func init() {
	v452CropSyncEventCB = syscall.NewCallback(v452CropSyncEventProc)
	v452CropSyncParentCB = syscall.NewCallback(v452CropSyncParentSubclassProc)
	v452CropSyncEditCB = syscall.NewCallback(v452CropSyncEditSubclassProc)
	v452CropSyncHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		v452CropSyncEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func v452CropSyncEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	v452InstallCropSyncGuard(activeTrim)
	if hwnd == 0 {
		return 0
	}
	id, _, _ := v452CropSyncGetID.Call(hwnd)
	if !v452IsCropEditID(int(id)) {
		return 0
	}
	parent, _, _ := v452CropSyncGetParent.Call(hwnd)
	v452InstallCropSyncHandles(parent, []uintptr{hwnd})
	return 0
}

func v452InstallCropSyncGuard(d *trimDialog) {
	if d == nil || d.hwnd == 0 {
		return
	}
	v452InstallCropSyncHandles(d.hwnd, []uintptr{d.hX, d.hY, d.hW, d.hH})
}

func v452InstallCropSyncHandles(parent uintptr, edits []uintptr) {
	if parent == 0 {
		return
	}
	v452CropSyncInstallTries.Add(1)
	if _, installed := v452CropSyncParents.Load(parent); !installed {
		state := &v452CropSyncState{}
		v452CropSyncStates.Store(parent, state)
		ok, _, _ := v452SetWindowSubclass.Call(parent, v452CropSyncParentCB, v452CropSyncParentSubclassID, 0)
		if ok != 0 {
			v452CropSyncParents.Store(parent, true)
			v452CropSyncParentsOK.Add(1)
		} else {
			v452CropSyncStates.Delete(parent)
		}
	}
	for _, hwnd := range edits {
		if hwnd == 0 {
			continue
		}
		if _, installed := v452CropSyncEdits.Load(hwnd); installed {
			continue
		}
		ok, _, _ := v452SetWindowSubclass.Call(hwnd, v452CropSyncEditCB, v452CropSyncEditSubclassID, 0)
		if ok != 0 {
			v452CropSyncEdits.Store(hwnd, true)
			v452CropSyncEditsOK.Add(1)
		}
	}
}

func v452CropSyncParentSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == WM_COMMAND && int(hiWord(wParam)) == v452ENChange {
		id := int(loWord(wParam))
		if value, ok := v452CropSyncStates.Load(hwnd); ok && value.(*v452CropSyncState).consume(id) {
			v452CropSyncIntercepted.Add(1)
			return 0
		}
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, v452CropSyncParentCB, subclassID)
		v452CropSyncStates.Delete(hwnd)
		v452CropSyncParents.Delete(hwnd)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func v452CropSyncEditSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == v452WMSetTextMessage {
		parent, _, _ := v452CropSyncGetParent.Call(hwnd)
		id, _, _ := v452CropSyncGetID.Call(hwnd)
		if value, ok := v452CropSyncStates.Load(parent); ok {
			value.(*v452CropSyncState).mark(int(id))
		}
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, v452CropSyncEditCB, subclassID)
		v452CropSyncEdits.Delete(hwnd)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func (s *v452CropSyncState) mark(id int) {
	bit := v452CropSyncBit(id)
	if bit == 0 {
		return
	}
	for {
		old := s.pending.Load()
		if s.pending.CompareAndSwap(old, old|bit) {
			return
		}
	}
}

func (s *v452CropSyncState) consume(id int) bool {
	bit := v452CropSyncBit(id)
	if bit == 0 {
		return false
	}
	for {
		old := s.pending.Load()
		if old&bit == 0 {
			return false
		}
		if s.pending.CompareAndSwap(old, old&^bit) {
			return true
		}
	}
}

func v452CropSyncBit(id int) uint32 {
	switch id {
	case IDC_CROP_X:
		return 1 << 0
	case IDC_CROP_Y:
		return 1 << 1
	case IDC_CROP_W:
		return 1 << 2
	case IDC_CROP_H:
		return 1 << 3
	default:
		return 0
	}
}

func v452IsCropEditID(id int) bool {
	return v452CropSyncBit(id) != 0
}

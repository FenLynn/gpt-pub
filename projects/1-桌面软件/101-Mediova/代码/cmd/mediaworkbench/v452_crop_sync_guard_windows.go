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
)

type v452CropSyncState struct {
	depth atomic.Int32
}

var (
	v452CropSyncEventCB   uintptr
	v452CropSyncParentCB  uintptr
	v452CropSyncEditCB    uintptr
	v452CropSyncHook      uintptr
	v452CropSyncStates    sync.Map // map[dialog HWND]*v452CropSyncState
	v452CropSyncParents   sync.Map // map[dialog HWND]bool
	v452CropSyncEdits     sync.Map // map[edit HWND]bool
	v452CropSyncGetParent = user32.NewProc("GetParent")
	v452CropSyncGetID     = user32.NewProc("GetDlgCtrlID")
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
	if hwnd == 0 {
		return 0
	}
	id, _, _ := v452CropSyncGetID.Call(hwnd)
	if !v452IsCropEditID(int(id)) {
		return 0
	}
	parent, _, _ := v452CropSyncGetParent.Call(hwnd)
	if parent == 0 {
		return 0
	}
	if _, loaded := v452CropSyncParents.LoadOrStore(parent, true); !loaded {
		v452CropSyncStates.Store(parent, &v452CropSyncState{})
		v452SetWindowSubclass.Call(parent, v452CropSyncParentCB, v452CropSyncParentSubclassID, 0)
	}
	if _, loaded := v452CropSyncEdits.LoadOrStore(hwnd, true); !loaded {
		v452SetWindowSubclass.Call(hwnd, v452CropSyncEditCB, v452CropSyncEditSubclassID, 0)
	}
	return 0
}

func v452CropSyncParentSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == WM_COMMAND && int(hiWord(wParam)) == v452ENChange && v452IsCropEditID(int(loWord(wParam))) {
		if value, ok := v452CropSyncStates.Load(hwnd); ok && value.(*v452CropSyncState).depth.Load() > 0 {
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
	if message == v452WMSetText {
		parent, _, _ := v452CropSyncGetParent.Call(hwnd)
		if value, ok := v452CropSyncStates.Load(parent); ok {
			state := value.(*v452CropSyncState)
			state.depth.Add(1)
			result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
			state.depth.Add(-1)
			return result
		}
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, v452CropSyncEditCB, subclassID)
		v452CropSyncEdits.Delete(hwnd)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func v452IsCropEditID(id int) bool {
	switch id {
	case IDC_CROP_X, IDC_CROP_Y, IDC_CROP_W, IDC_CROP_H:
		return true
	default:
		return false
	}
}

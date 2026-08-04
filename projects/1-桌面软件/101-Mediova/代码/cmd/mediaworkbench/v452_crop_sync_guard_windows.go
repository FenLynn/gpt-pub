//go:build windows

package main

import (
	"sync"
	"sync/atomic"
	"syscall"

	"mediaworkbench/internal/model"
)

const (
	v452CropSyncParentSubclassID = 0x4553
	v452CropSyncEditSubclassID   = 0x4554
	v452WMSetTextMessage         = 0x000C
	v452WHCBT                    = 5
	v452HCBTCreateWnd            = 3
	v452HCBTActivate             = 5
)

type v452CropSyncState struct {
	writing      atomic.Uint32
	initializing atomic.Bool
}

var (
	v452CropSyncEventCB      uintptr
	v452CropSyncParentCB     uintptr
	v452CropSyncEditCB       uintptr
	v452CropSyncCBTCB        uintptr
	v452CropSyncHook         uintptr
	v452CropSyncCBTHook      atomic.Uintptr
	v452CropSyncStates       sync.Map // map[dialog HWND]*v452CropSyncState
	v452CropSyncParents      sync.Map // map[dialog HWND]bool, only after successful subclassing
	v452CropSyncEdits        sync.Map // map[edit HWND]bool, only after successful subclassing
	v452CropSyncInitial      sync.Map // map[dialog HWND]model.Crop, captured before WM_CREATE
	v452CropSyncRepaired     sync.Map // map[dialog HWND]bool, after the captured crop is restored
	v452CropSyncSnapshotMu   sync.Mutex
	v452CropSyncPending      *trimDialog
	v452CropSyncPendingValue model.Crop
	v452CropSyncGetParent    = user32.NewProc("GetParent")
	v452CropSyncGetID        = user32.NewProc("GetDlgCtrlID")
	v452CropSyncSetHook      = user32.NewProc("SetWindowsHookExW")
	v452CropSyncNextHook     = user32.NewProc("CallNextHookEx")
	v452CropSyncUnhook       = user32.NewProc("UnhookWindowsHookEx")
	v452CropSyncGetThreadID  = kernel32.NewProc("GetCurrentThreadId")
	v452CropSyncInstallTries atomic.Int32
	v452CropSyncParentsOK    atomic.Int32
	v452CropSyncEarlyOK      atomic.Int32
	v452CropSyncEditsOK      atomic.Int32
	v452CropSyncEditorUIOK   atomic.Int32
	v452CropSyncIntercepted  atomic.Int32
	v452CropSyncCBTCallbacks atomic.Int32
	v452CropSyncActivations  atomic.Int32
	v452CropSyncSnapshots    atomic.Int32
	v452CropSyncRepairs      atomic.Int32
)

func init() {
	v452CropSyncEventCB = syscall.NewCallback(v452CropSyncEventProc)
	v452CropSyncParentCB = syscall.NewCallback(v452CropSyncParentSubclassProc)
	v452CropSyncEditCB = syscall.NewCallback(v452CropSyncEditSubclassProc)
	v452CropSyncCBTCB = syscall.NewCallback(v452CropSyncCBTProc)
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
	v452EnsureCropSyncCBTHook()
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
	v452RestoreInitialCropState(activeTrim)
	return 0
}

func v452EnsureCropSyncCBTHook() {
	if v452CropSyncCBTHook.Load() != 0 || app == nil || app.hwnd == 0 {
		return
	}
	threadID, _, _ := v452CropSyncGetThreadID.Call()
	if threadID == 0 {
		return
	}
	hook, _, _ := v452CropSyncSetHook.Call(v452WHCBT, v452CropSyncCBTCB, 0, threadID)
	if hook == 0 {
		return
	}
	if !v452CropSyncCBTHook.CompareAndSwap(0, hook) {
		v452CropSyncUnhook.Call(hook)
	}
}

func v452CropSyncCBTProc(code int32, wParam, lParam uintptr) uintptr {
	if code == v452HCBTCreateWnd {
		v452CropSyncCBTCallbacks.Add(1)
		d := activeTrim
		if d != nil && d.hwnd == 0 && d.opts.Crop.Width >= 2 && d.opts.Crop.Height >= 2 {
			v452CropSyncSnapshotMu.Lock()
			if v452CropSyncPending != d {
				v452CropSyncPending = d
				v452CropSyncPendingValue = d.opts.Crop
				v452CropSyncSnapshots.Add(1)
			}
			v452CropSyncSnapshotMu.Unlock()
			v452InstallCropSyncParentEarly(wParam, d)
		}
	}
	if code == v452HCBTActivate {
		d := activeTrim
		if d != nil && d.hwnd != 0 && d.hwnd == wParam {
			v452CropSyncActivations.Add(1)
			v452BindPendingCropSnapshot(d)
			v452InstallTrimEditorUIThread(d)
			v452InstallCropSyncHandles(d.hwnd, []uintptr{d.hX, d.hY, d.hW, d.hH})
			v452RestoreInitialCropState(d)
		}
	}
	result, _, _ := v452CropSyncNextHook.Call(v452CropSyncCBTHook.Load(), uintptr(code), wParam, lParam)
	return result
}

func v452InstallCropSyncParentEarly(parent uintptr, d *trimDialog) {
	if parent == 0 || d == nil {
		return
	}
	if _, installed := v452CropSyncParents.Load(parent); installed {
		return
	}
	v452CropSyncInstallTries.Add(1)
	state := &v452CropSyncState{}
	state.initializing.Store(true)
	v452CropSyncStates.Store(parent, state)
	ok, _, _ := v452SetWindowSubclass.Call(parent, v452CropSyncParentCB, v452CropSyncParentSubclassID, 0)
	if ok == 0 {
		v452CropSyncStates.Delete(parent)
		return
	}
	v452CropSyncParents.Store(parent, true)
	v452CropSyncInitial.Store(parent, d.opts.Crop)
	v452CropSyncParentsOK.Add(1)
	v452CropSyncEarlyOK.Add(1)
}

func v452InstallTrimEditorUIThread(d *trimDialog) {
	if d == nil {
		return
	}
	state := v452TrimInstallStateFor(d)
	if d.hTrack != 0 {
		move(d.hTrack, 15, 609, 700, 47)
		ok, _, _ := v452SetWindowSubclass.Call(d.hTrack, v452TrimTrackSubclassCB, v452TrimTrackSubclassID, 0)
		if ok != 0 {
			state.trackInstalled = true
			v452CropSyncEditorUIOK.Add(1)
			procInvalidateRect.Call(d.hTrack, 0, 1)
		}
	}
	if d.hCanvas != 0 {
		ok, _, _ := v452SetWindowSubclass.Call(d.hCanvas, v452TrimPreviewSubclassCB, v452TrimPreviewSubclassID, 0)
		if ok != 0 {
			state.previewInstalled = true
			v452CropSyncEditorUIOK.Add(1)
		}
	}
}

func v452InstallCropSyncGuard(d *trimDialog) {
	if d == nil || d.hwnd == 0 {
		return
	}
	v452BindPendingCropSnapshot(d)
	v452InstallCropSyncHandles(d.hwnd, []uintptr{d.hX, d.hY, d.hW, d.hH})
	v452RestoreInitialCropState(d)
}

func v452BindPendingCropSnapshot(d *trimDialog) {
	if d == nil || d.hwnd == 0 {
		return
	}
	if _, exists := v452CropSyncInitial.Load(d.hwnd); exists {
		return
	}
	v452CropSyncSnapshotMu.Lock()
	defer v452CropSyncSnapshotMu.Unlock()
	if v452CropSyncPending != d {
		return
	}
	v452CropSyncInitial.Store(d.hwnd, v452CropSyncPendingValue)
	v452CropSyncPending = nil
	v452CropSyncPendingValue = model.Crop{}
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

func v452RestoreInitialCropState(d *trimDialog) {
	if d == nil || d.hwnd == 0 || d.hX == 0 || d.hY == 0 || d.hW == 0 || d.hH == 0 {
		return
	}
	if _, ok := v452CropSyncParents.Load(d.hwnd); !ok {
		return
	}
	for _, hwnd := range []uintptr{d.hX, d.hY, d.hW, d.hH} {
		if _, ok := v452CropSyncEdits.Load(hwnd); !ok {
			return
		}
	}
	if _, repaired := v452CropSyncRepaired.Load(d.hwnd); repaired {
		return
	}
	value, ok := v452CropSyncInitial.Load(d.hwnd)
	if !ok {
		return
	}
	initial := value.(model.Crop)
	d.opts.Crop = initial
	d.cropToControls()
	v452CropSyncRepaired.Store(d.hwnd, true)
	v452CropSyncRepairs.Add(1)
}

func v452CropSyncParentSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == WM_CREATE {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		if d := activeTrim; d != nil && d.hwnd == hwnd {
			v452BindPendingCropSnapshot(d)
			v452InstallTrimEditorUIThread(d)
			v452InstallCropSyncHandles(hwnd, []uintptr{d.hX, d.hY, d.hW, d.hH})
			v452RestoreInitialCropState(d)
		}
		if value, ok := v452CropSyncStates.Load(hwnd); ok {
			value.(*v452CropSyncState).initializing.Store(false)
		}
		return result
	}
	if message == WM_COMMAND {
		id := int(loWord(wParam))
		if value, ok := v452CropSyncStates.Load(hwnd); ok {
			state := value.(*v452CropSyncState)
			if (state.initializing.Load() && v452IsCropEditID(id)) || state.isWriting(id) {
				v452CropSyncIntercepted.Add(1)
				return 0
			}
		}
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, v452CropSyncParentCB, subclassID)
		v452CropSyncStates.Delete(hwnd)
		v452CropSyncParents.Delete(hwnd)
		v452CropSyncInitial.Delete(hwnd)
		v452CropSyncRepaired.Delete(hwnd)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func v452CropSyncEditSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == v452WMSetTextMessage {
		parent, _, _ := v452CropSyncGetParent.Call(hwnd)
		id, _, _ := v452CropSyncGetID.Call(hwnd)
		if value, ok := v452CropSyncStates.Load(parent); ok {
			state := value.(*v452CropSyncState)
			state.beginWriting(int(id))
			result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
			state.endWriting(int(id))
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

func (s *v452CropSyncState) beginWriting(id int) {
	bit := v452CropSyncBit(id)
	if bit == 0 {
		return
	}
	for {
		old := s.writing.Load()
		if s.writing.CompareAndSwap(old, old|bit) {
			return
		}
	}
}

func (s *v452CropSyncState) endWriting(id int) {
	bit := v452CropSyncBit(id)
	if bit == 0 {
		return
	}
	for {
		old := s.writing.Load()
		if s.writing.CompareAndSwap(old, old&^bit) {
			return
		}
	}
}

func (s *v452CropSyncState) isWriting(id int) bool {
	bit := v452CropSyncBit(id)
	return bit != 0 && s.writing.Load()&bit != 0
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

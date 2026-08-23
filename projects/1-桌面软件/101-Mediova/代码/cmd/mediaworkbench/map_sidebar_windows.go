//go:build windows

package main

import (
	"fmt"
	"strconv"
	"sync"
	"syscall"
	"unsafe"
)

const mapSidebarSubclassID = 0x45D2

type mapSidebarState struct {
	width         int32
	dragging      bool
	columnsActive bool
	savedWidths   []int
}

var (
	mapSidebarStates    sync.Map
	mapSidebarCallback  uintptr
	mapSidebarSetCursor = user32.NewProc("SetCursor")
)

func init() {
	mapSidebarCallback = syscall.NewCallback(mapSidebarSplitterProc)
}

func mapSidebarStateFor(a *application) *mapSidebarState {
	if a == nil {
		return nil
	}
	value, _ := mapSidebarStates.LoadOrStore(a, &mapSidebarState{width: 320})
	state, _ := value.(*mapSidebarState)
	return state
}

func (a *application) installMapSidebarSplitter() {
	if a == nil || a.hMapSplitter == 0 {
		return
	}
	mapSidebarStateFor(a)
	v452RemoveSubclass.Call(a.hMapSplitter, mapSidebarCallback, mapSidebarSubclassID)
	v452SetWindowSubclass.Call(a.hMapSplitter, mapSidebarCallback, mapSidebarSubclassID, 0)
}

func (a *application) mapSidebarWidthFor(available int32) int32 {
	state := mapSidebarStateFor(a)
	width := int32(320)
	if state != nil {
		width = state.width
	}
	maxWidth := available - 360
	if maxWidth > available*45/100 {
		maxWidth = available * 45 / 100
	}
	if maxWidth < 220 {
		maxWidth = 220
	}
	if width < 220 {
		width = 220
	}
	if width > maxWidth {
		width = maxWidth
	}
	if state != nil {
		state.width = width
	}
	return width
}

func (a *application) applyMapSidebarColumns() {
	if a == nil || a.hList == 0 {
		return
	}
	state := mapSidebarStateFor(a)
	if state == nil {
		return
	}
	if a.viewMode != mapViewSidebar {
		if state.columnsActive {
			for column, width := range state.savedWidths {
				send(a.hList, LVM_SETCOLUMNWIDTH, uintptr(column), uintptr(width))
			}
			state.savedWidths = nil
			state.columnsActive = false
		}
		return
	}
	count := len(round12Columns)
	if count == 0 {
		count = len(taskListColumns)
	}
	if !state.columnsActive {
		state.savedWidths = make([]int, count)
		for column := 0; column < count; column++ {
			state.savedWidths[column] = int(send(a.hList, LVM_GETCOLUMNWIDTH, uintptr(column), 0))
		}
		state.columnsActive = true
	}
	sidebarPhysical := scaleDPI(state.width)
	widths := []int32{scaleDPI(44), scaleDPI(96), sidebarPhysical - scaleDPI(148)}
	if widths[2] < scaleDPI(96) {
		widths[2] = scaleDPI(96)
	}
	for column := 0; column < count; column++ {
		width := int32(0)
		if column < len(widths) {
			width = widths[column]
		}
		send(a.hList, LVM_SETCOLUMNWIDTH, uintptr(column), uintptr(width))
	}
}

func (a *application) setMapBottomControlsVisible(visible bool) {
	if a == nil {
		return
	}
	mandatory := []uintptr{a.hOutputBrowse, a.hOutputEdit, a.hOutputPick, a.hResolution, a.hProgress, a.hStatusText, a.hTimeText, a.hStart, a.hPause, a.hStop}
	if !visible {
		for _, h := range mandatory {
			show(h, false)
		}
		for _, h := range []uintptr{a.hCodec, a.hQuality, a.hSpeedMode, a.hVolume, a.hRotation, a.hAllDefault, a.hSmartPlan} {
			show(h, false)
		}
		for _, h := range a.globalLabels {
			show(h, false)
		}
		return
	}
	for _, h := range mandatory {
		show(h, true)
	}
	simple := a.settings.InterfaceMode == "简洁"
	show(a.hSpeedMode, simple)
	show(a.hSmartPlan, simple)
	for _, h := range []uintptr{a.hCodec, a.hQuality, a.hVolume, a.hRotation, a.hAllDefault} {
		show(h, !simple)
	}
	for _, h := range a.globalLabels {
		show(h, !simple)
	}
}

func mapSidebarSplitterProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	a := app
	if a == nil || hwnd != a.hMapSplitter {
		result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
		return result
	}
	state := mapSidebarStateFor(a)
	switch message {
	case WM_SETCURSOR:
		cursor, _, _ := procLoadCursorW.Call(0, 32644) // IDC_SIZEWE
		if cursor != 0 {
			mapSidebarSetCursor.Call(cursor)
		}
		return 1
	case WM_LBUTTONDOWN:
		state.dragging = true
		procSetCapture.Call(hwnd)
		return 0
	case WM_MOUSEMOVE:
		if state.dragging {
			var cursor point
			if ok, _, _ := procGetCursorPos.Call(uintptr(unsafe.Pointer(&cursor))); ok != 0 {
				procScreenToClient.Call(a.hwnd, uintptr(unsafe.Pointer(&cursor)))
				state.width = unscaleDPI(cursor.X) - 8
				a.relayoutForMapMode()
			}
			return 0
		}
	case WM_LBUTTONUP:
		if state.dragging {
			state.dragging = false
			procReleaseCapture.Call()
			return 0
		}
	case WM_DESTROY:
		v452RemoveSubclass.Call(hwnd, mapSidebarCallback, mapSidebarSubclassID)
		mapSidebarStates.Delete(a)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func (a *application) selectedTaskHasMapLocation() bool {
	task, _ := a.selectedTask()
	return task != nil && task.Location.Valid()
}

func (a *application) showSelectedTaskOnMap() {
	task, _ := a.selectedTask()
	if task == nil || !task.Location.Valid() {
		setText(a.hStatusText, "所选媒体没有可用的 GPS 坐标。")
		return
	}
	latitude, longitude := task.Location.Latitude, task.Location.Longitude
	a.viewMode = mapViewSidebar
	setText(a.hViewMode, mapViewLabel(a.viewMode))
	a.ensureMapRuntime()
	a.relayoutForMapMode()
	if runtime := mapRuntimeFor(a); runtime != nil {
		runtime.pushPoints(false)
		runtime.focus(longitude, latitude)
	}
	setText(a.hStatusText, fmt.Sprintf("已在地图中央显示所选媒体（%.5f, %.5f）。", latitude, longitude))
}

func (r *mapRuntime) focus(longitude, latitude float64) {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.focusLongitude, r.focusLatitude, r.hasFocus = longitude, latitude, true
	browser := r.browser
	r.mu.Unlock()
	if browser != nil {
		browser.Eval("if(window.mediovaFocus){window.mediovaFocus(" + strconv.FormatFloat(longitude, 'f', 7, 64) + "," + strconv.FormatFloat(latitude, 'f', 7, 64) + ")}")
	}
}

func (r *mapRuntime) pushPendingFocus() {
	if r == nil {
		return
	}
	r.mu.Lock()
	longitude, latitude, pending := r.focusLongitude, r.focusLatitude, r.hasFocus
	r.mu.Unlock()
	if pending {
		r.focus(longitude, latitude)
	}
}

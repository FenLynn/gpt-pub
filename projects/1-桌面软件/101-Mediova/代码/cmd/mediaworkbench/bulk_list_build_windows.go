//go:build windows

package main

import (
	"fmt"

	"mediaworkbench/internal/model"
)

const (
	listBuildThreshold = 320
	listBuildChunkSize = 64
	listBuildInterval  = 30
)

type listRowSnapshot struct {
	index int
	task  model.Task
}

type listBuildState struct {
	rows        []listRowSnapshot
	selectedIDs map[int64]bool
	next        int
}

func shouldBatchTaskListBuild(rowCount int, controlsReady, selfTest bool) bool {
	return controlsReady && !selfTest && rowCount >= listBuildThreshold
}

func nextListBuildEnd(current, total, chunk int) int {
	if current < 0 {
		current = 0
	}
	if total < current {
		return current
	}
	if chunk <= 0 || current+chunk >= total {
		return total
	}
	return current + chunk
}

func cloneSelectedTaskIDs(ids map[int64]bool) map[int64]bool {
	cloned := make(map[int64]bool, len(ids))
	for id, selected := range ids {
		if selected {
			cloned[id] = true
		}
	}
	return cloned
}

func (a *application) cancelBatchedListBuild() {
	if a == nil {
		return
	}
	if a.hwnd != 0 {
		procKillTimer.Call(a.hwnd, TIMER_LIST_BUILD)
	}
	a.listBuild = nil
}

func (a *application) startBatchedListBuild(rows []listRowSnapshot, selectedIDs map[int64]bool) {
	if a == nil || a.hList == 0 {
		return
	}
	a.cancelBatchedListBuild()
	a.listBuild = &listBuildState{
		rows:        rows,
		selectedIDs: cloneSelectedTaskIDs(selectedIDs),
	}

	localRedraw := a.redrawDepth == 0
	if localRedraw {
		send(a.hList, WM_SETREDRAW, 0, 0)
	}
	send(a.hList, LVM_DELETEALLITEMS, 0, 0)
	if localRedraw {
		send(a.hList, WM_SETREDRAW, 1, 0)
		procRedrawWindow.Call(a.hList, 0, 0, RDW_INVALIDATE|RDW_UPDATENOW)
	}
	setText(a.hStatusText, fmt.Sprintf("正在载入任务列表：0/%d；媒体信息继续在后台读取。", len(rows)))
	if timer, _, _ := procSetTimer.Call(a.hwnd, TIMER_LIST_BUILD, listBuildInterval, 0); timer == 0 {
		a.flushBatchedListBuild(0)
	}
}

func (a *application) listBuildTaskSnapshots(rows []listRowSnapshot, start, end int) []model.Task {
	snapshots := make([]model.Task, end-start)
	a.mu.Lock()
	defer a.mu.Unlock()
	for pos := start; pos < end; pos++ {
		row := rows[pos]
		task := row.task
		if row.index >= 0 && row.index < len(a.tasks) && a.tasks[row.index] != nil {
			task = *a.tasks[row.index]
		}
		snapshots[pos-start] = task
	}
	return snapshots
}

func (a *application) flushBatchedListBuild(chunk int) bool {
	if a == nil || a.listBuild == nil {
		return true
	}
	state := a.listBuild
	total := len(state.rows)
	start := state.next
	end := nextListBuildEnd(start, total, chunk)
	if end > start {
		snapshots := a.listBuildTaskSnapshots(state.rows, start, end)
		localRedraw := a.redrawDepth == 0
		if localRedraw {
			send(a.hList, WM_SETREDRAW, 0, 0)
		}
		for pos := start; pos < end; pos++ {
			a.insertRow(pos, &snapshots[pos-start])
		}
		state.next = end
		if localRedraw {
			send(a.hList, WM_SETREDRAW, 1, 0)
			procRedrawWindow.Call(a.hList, 0, 0, RDW_INVALIDATE|RDW_UPDATENOW)
		}
	}
	if state.next < total {
		setText(a.hStatusText, fmt.Sprintf("正在载入任务列表：%d/%d；媒体信息继续在后台读取。", state.next, total))
		return false
	}

	for id := range a.selectedTaskIDsSnapshot() {
		state.selectedIDs[id] = true
	}
	rowTasks := a.listBuildTaskSnapshots(state.rows, 0, total)
	a.beginAtomicUIRefresh()
	a.restoreTaskSelection(rowTasks, state.selectedIDs)
	a.endAtomicUIRefresh()

	a.listBuild = nil
	a.refreshStatusFilterOptions()
	a.updateRightPanel()
	a.syncSelectedTaskToMap()
	a.invalidateMapView()
	setText(a.hStatusText, fmt.Sprintf("任务列表载入完成：%d 项；媒体信息仍会在后台补充。", total))
	return true
}

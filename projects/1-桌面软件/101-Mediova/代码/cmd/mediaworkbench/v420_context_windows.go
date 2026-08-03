//go:build windows

package main

import "mediaworkbench/internal/model"

func (a *application) v420ContextMenuFlags() (editFlags, removeFlags uintptr) {
	editFlags, removeFlags = MF_STRING|MF_GRAYED, MF_STRING|MF_GRAYED
	idxs := a.selectedTaskIndices()
	if len(idxs) == 0 {
		return editFlags, removeFlags
	}
	locked := 0
	editableLocked := 0
	removable := 0
	a.mu.Lock()
	for _, idx := range idxs {
		if idx < 0 || idx >= len(a.tasks) || a.tasks[idx] == nil {
			continue
		}
		task := a.tasks[idx]
		if task.IsLocked() {
			locked++
		}
		if task.CanHoldForEdit() || (task.Status == model.StatusHeld && task.Hold != nil) {
			editableLocked++
		}
		if task.CanRemoveSafely() {
			removable++
		}
	}
	a.mu.Unlock()
	if len(idxs) == 1 && locked == 1 && editableLocked == 1 {
		editFlags = MF_STRING
	}
	if removable > 0 {
		removeFlags = MF_STRING
	}
	return editFlags, removeFlags
}

func v420LockedSelectionCanBulkEdit(tasks []*model.Task) bool {
	locked := 0
	for _, task := range tasks {
		if task != nil && task.IsLocked() {
			locked++
		}
	}
	return locked <= 1
}

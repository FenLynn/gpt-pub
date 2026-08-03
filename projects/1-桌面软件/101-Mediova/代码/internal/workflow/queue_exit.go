package workflow

import (
	"time"

	"mediaworkbench/internal/model"
)

type QueueExitResult struct {
	Exited  int
	Skipped int
}

// ExitQueuedForEdit moves only waiting queued tasks into a non-running held
// state. Processing and paused tasks require the existing safe interruption
// path and are deliberately skipped.
func ExitQueuedForEdit(tasks []*model.Task, selectedIDs map[int64]bool, now time.Time) QueueExitResult {
	result := QueueExitResult{}
	for _, task := range tasks {
		if task == nil || !selectedIDs[task.ID] {
			continue
		}
		if task.Status != model.StatusQueued {
			result.Skipped++
			continue
		}
		if err := HoldForEdit(task, now); err != nil {
			result.Skipped++
			continue
		}
		task.Engine = "已退出队列 · 等待修改"
		result.Exited++
	}
	return result
}

func CanExitQueuedSelection(tasks []*model.Task, selectedIDs map[int64]bool) bool {
	for _, task := range tasks {
		if task != nil && selectedIDs[task.ID] && task.Status == model.StatusQueued {
			return true
		}
	}
	return false
}

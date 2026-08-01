package media

import (
	"fmt"
	"time"

	"mediaworkbench/internal/model"
)

const RunIntegrityFailureCategory = "队列状态异常"

// PrepareTaskForRun clears every result field that belongs to an earlier
// attempt before the task enters a new queue. This prevents stale output paths
// or a previous 100% result from being displayed during a retry.
func PrepareTaskForRun(task *model.Task) {
	if task == nil {
		return
	}
	task.Status = model.StatusQueued
	task.Progress = 0
	task.Error = ""
	task.FailureCategory = ""
	task.ValidationWarning = ""
	task.OutputPath = ""
	task.OutputSize = 0
	task.Engine = ""
	task.StartedAt = time.Time{}
	task.FinishedAt = time.Time{}
}

func IsTerminalTaskStatus(status model.Status) bool {
	switch status {
	case model.StatusDone, model.StatusFailed, model.StatusSkipped, model.StatusCancelled:
		return true
	default:
		return false
	}
}

// ReconcileRunTasks enforces the queue accounting invariant: every task that
// belonged to a finished run must have one explicit terminal result.
func ReconcileRunTasks(tasks []*model.Task, runIDs map[int64]bool, now time.Time) []int64 {
	var reconciled []int64
	for _, task := range tasks {
		if task == nil || runIDs == nil || !runIDs[task.ID] || IsTerminalTaskStatus(task.Status) {
			continue
		}
		task.Status = model.StatusFailed
		if task.Progress >= 100 {
			task.Progress = 99
		}
		task.Error = "任务未产生明确结果，已由队列收尾保护标记失败"
		task.FailureCategory = RunIntegrityFailureCategory
		task.ValidationWarning = ""
		// Never leave a failed reconciliation pointing at a partial or stale
		// output that the application does not consider successful.
		task.OutputPath = ""
		task.OutputSize = 0
		task.Engine = "失败 · " + RunIntegrityFailureCategory
		task.FinishedAt = now
		reconciled = append(reconciled, task.ID)
	}
	return reconciled
}

// ValidateRunAccounting verifies the final queue invariant after reconciliation.
func ValidateRunAccounting(total, done, failed, skipped, cancelled int) error {
	accounted := done + failed + skipped + cancelled
	if accounted != total {
		return fmt.Errorf("任务结果数量不闭合: 总数 %d，完成 %d，失败 %d，跳过 %d，停止 %d，已计数 %d", total, done, failed, skipped, cancelled, accounted)
	}
	return nil
}

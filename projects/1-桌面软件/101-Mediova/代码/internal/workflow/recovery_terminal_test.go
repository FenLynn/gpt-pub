package workflow

import (
	"testing"

	"mediaworkbench/internal/model"
)

func TestRecoverTasksPreservesTerminalResultsWhenSourceMissing(t *testing.T) {
	done := &model.Task{
		Input:             "moved-done.mp4",
		Status:            model.StatusDone,
		Progress:          100,
		OutputPath:        "done-output.mp4",
		OutputSize:        4096,
		Engine:            "CPU",
		ValidationWarning: "kept-warning",
	}
	skipped := &model.Task{
		Input:      "moved-skipped.mp4",
		Status:     model.StatusSkipped,
		Error:      "existing output",
		OutputPath: "existing-output.mp4",
	}
	failed := &model.Task{
		Input:           "moved-failed.mp4",
		Status:          model.StatusFailed,
		Error:           "encoder failed",
		FailureCategory: "编码器失败",
		OutputPath:      "partial-output.mp4",
	}
	summary := RecoverTasks([]*model.Task{done, skipped, failed}, func(string) bool { return false })

	if summary.Total != 3 || summary.Completed != 1 || summary.Skipped != 1 || summary.Failed != 1 || summary.Missing != 0 {
		t.Fatalf("terminal summary changed: %+v", summary)
	}
	if done.Status != model.StatusDone || done.Progress != 100 || done.OutputPath != "done-output.mp4" || done.OutputSize != 4096 || done.Engine != "CPU" || done.ValidationWarning != "kept-warning" {
		t.Fatalf("completed result was rewritten: %+v", done)
	}
	if skipped.Status != model.StatusSkipped || skipped.Error != "existing output" || skipped.OutputPath != "existing-output.mp4" {
		t.Fatalf("skipped result was rewritten: %+v", skipped)
	}
	if failed.Status != model.StatusFailed || failed.Error != "encoder failed" || failed.FailureCategory != "编码器失败" || failed.OutputPath != "partial-output.mp4" {
		t.Fatalf("failed result was rewritten: %+v", failed)
	}
}

func TestRecoverTasksStillMarksMissingNonTerminalSource(t *testing.T) {
	task := &model.Task{
		Input:      "moved-queued.mp4",
		Status:     model.StatusQueued,
		Progress:   42,
		OutputPath: "partial.mp4",
		OutputSize: 1024,
		Engine:     "GPU",
	}
	summary := RecoverTasks([]*model.Task{task}, func(string) bool { return false })

	if summary.Total != 1 || summary.Missing != 1 || summary.Failed != 0 {
		t.Fatalf("missing non-terminal summary mismatch: %+v", summary)
	}
	if task.Status != model.StatusFailed || task.FailureCategory != "源文件缺失" || task.Progress != 0 || task.OutputPath != "" || task.OutputSize != 0 || task.Engine != "" {
		t.Fatalf("missing non-terminal task was not normalized: %+v", task)
	}
}

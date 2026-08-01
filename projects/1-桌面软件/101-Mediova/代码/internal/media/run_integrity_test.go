package media

import (
	"testing"
	"time"

	"mediaworkbench/internal/model"
)

func TestReconcileRunTasksMakesEveryRunTaskTerminal(t *testing.T) {
	now := time.Date(2026, 8, 1, 8, 0, 0, 0, time.UTC)
	tasks := []*model.Task{
		{ID: 1, Status: model.StatusDone, Progress: 100},
		{ID: 2, Status: model.StatusQueued},
		{ID: 3, Status: model.StatusProcessing, Progress: 100, OutputPath: "partial.mp4", OutputSize: 123},
		{ID: 4, Status: model.StatusReady},
		{ID: 5, Status: model.StatusPaused, Progress: 42},
		{ID: 6, Status: model.StatusReady},
	}
	runIDs := map[int64]bool{1: true, 2: true, 3: true, 4: true, 5: true}

	got := ReconcileRunTasks(tasks, runIDs, now)
	if len(got) != 4 {
		t.Fatalf("reconciled=%v, want four non-terminal run tasks", got)
	}
	for _, task := range tasks[:5] {
		if !IsTerminalTaskStatus(task.Status) {
			t.Fatalf("task %d remains non-terminal: %s", task.ID, task.Status)
		}
	}
	if tasks[0].Status != model.StatusDone || !tasks[0].FinishedAt.IsZero() {
		t.Fatalf("terminal task was modified: %+v", tasks[0])
	}
	if tasks[2].Progress != 99 {
		t.Fatalf("false 100%% was not reduced: %+v", tasks[2])
	}
	if tasks[2].OutputPath != "" || tasks[2].OutputSize != 0 {
		t.Fatalf("stale reconciled output was not cleared: %+v", tasks[2])
	}
	if tasks[5].Status != model.StatusReady {
		t.Fatalf("task outside run was modified: %+v", tasks[5])
	}
	for _, task := range tasks[1:5] {
		if task.FailureCategory != RunIntegrityFailureCategory || task.Error == "" || !task.FinishedAt.Equal(now) {
			t.Fatalf("task lacks explicit reconciliation result: %+v", task)
		}
	}
}

func TestReconcileRunTasksNilRunSetDoesNothing(t *testing.T) {
	task := &model.Task{ID: 1, Status: model.StatusProcessing}
	if got := ReconcileRunTasks([]*model.Task{task}, nil, time.Now()); len(got) != 0 || task.Status != model.StatusProcessing {
		t.Fatalf("nil run set modified task: got=%v task=%+v", got, task)
	}
}

func TestPrepareTaskForRunClearsStaleResult(t *testing.T) {
	started := time.Now().Add(-time.Minute)
	finished := time.Now()
	task := &model.Task{
		ID: 7, Status: model.StatusDone, Progress: 100,
		OutputPath: "old-output.mp4", OutputSize: 1234,
		Error: "old error", FailureCategory: "old category",
		ValidationWarning: "old warning", Engine: "old engine",
		StartedAt: started, FinishedAt: finished,
	}
	PrepareTaskForRun(task)
	if task.Status != model.StatusQueued || task.Progress != 0 || task.OutputPath != "" || task.OutputSize != 0 {
		t.Fatalf("stale result was not cleared: %+v", task)
	}
	if task.Error != "" || task.FailureCategory != "" || task.ValidationWarning != "" || task.Engine != "" {
		t.Fatalf("stale diagnostics were not cleared: %+v", task)
	}
	if !task.StartedAt.IsZero() || !task.FinishedAt.IsZero() {
		t.Fatalf("stale timestamps were not cleared: %+v", task)
	}
}

func TestValidateRunAccounting(t *testing.T) {
	if err := ValidateRunAccounting(8, 3, 2, 1, 2); err != nil {
		t.Fatalf("valid accounting rejected: %v", err)
	}
	if err := ValidateRunAccounting(8, 3, 2, 1, 1); err == nil {
		t.Fatal("non-closed accounting was accepted")
	}
}

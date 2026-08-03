package workflow

import (
	"testing"
	"time"

	"mediaworkbench/internal/model"
)

func queuedTask(id int64) *model.Task {
	return &model.Task{
		ID:      id,
		Kind:    model.KindVideo,
		Status:  model.StatusQueued,
		Options: model.TaskOptions{Resolution: "1080P", Codec: "H.265"},
		Queue: &model.QueueSnapshot{
			Options:    model.TaskOptions{Resolution: "1080P", Codec: "H.265"},
			OutputRoot: "Z:/out",
			Sequence:   id,
		},
	}
}

func TestExitQueuedForEditHandlesEligibleSubset(t *testing.T) {
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	one := queuedTask(1)
	two := queuedTask(2)
	processing := queuedTask(3)
	processing.Status = model.StatusProcessing
	ready := queuedTask(4)
	ready.Status = model.StatusReady
	tasks := []*model.Task{one, two, processing, ready}

	result := ExitQueuedForEdit(tasks, map[int64]bool{1: true, 2: true, 3: true, 4: true}, now)
	if result.Exited != 2 || result.Skipped != 2 {
		t.Fatalf("result=%+v", result)
	}
	for _, task := range []*model.Task{one, two} {
		if task.Status != model.StatusHeld || task.Hold == nil {
			t.Fatalf("task %d was not held: %+v", task.ID, task)
		}
		if task.Hold.FromStatus != model.StatusQueued || task.Hold.ReservedSlot {
			t.Fatalf("task %d hold=%+v", task.ID, task.Hold)
		}
		if task.Queue == nil || task.Queue.OutputRoot != "Z:/out" {
			t.Fatalf("task %d lost queue snapshot", task.ID)
		}
	}
	if processing.Status != model.StatusProcessing {
		t.Fatal("processing task must use safe interruption path")
	}
	if ready.Status != model.StatusReady {
		t.Fatal("ready task must remain ready")
	}
}

func TestCanExitQueuedSelectionRequiresAtLeastOneQueuedTask(t *testing.T) {
	queued := queuedTask(1)
	processing := queuedTask(2)
	processing.Status = model.StatusProcessing
	if !CanExitQueuedSelection([]*model.Task{queued, processing}, map[int64]bool{1: true, 2: true}) {
		t.Fatal("queued selection should be eligible")
	}
	if CanExitQueuedSelection([]*model.Task{queued, processing}, map[int64]bool{2: true}) {
		t.Fatal("processing-only selection should be ineligible")
	}
}

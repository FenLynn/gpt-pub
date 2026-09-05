package workflow

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"mediaworkbench/internal/model"
)

func TestQueueInterleavingStress(t *testing.T) {
	const total = 1200
	settings := model.DefaultSettings()
	errs := make(chan error, total)
	var wg sync.WaitGroup
	for i := 0; i < total; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			task := &model.Task{ID: int64(i + 1), Input: fmt.Sprintf("input-%d.mp4", i), Kind: model.KindVideo, Status: model.StatusReady}
			if err := FreezeForQueue(task, settings, "out", int64(i+1), time.Unix(int64(i), 0)); err != nil {
				errs <- fmt.Errorf("freeze %d: %w", i, err)
				return
			}
			switch i % 4 {
			case 0:
				task.Status = model.StatusProcessing
			case 1:
				task.Status = model.StatusPaused
			default:
				task.Status = model.StatusQueued
			}
			original := task.Options
			sequence := task.Queue.Sequence
			if err := HoldForEdit(task, time.Now()); err != nil {
				errs <- fmt.Errorf("hold %d: %w", i, err)
				return
			}
			switch i % 3 {
			case 0:
				updated := original
				updated.Resolution = "720P"
				immediate, err := ApplyHeldOptions(task, updated, time.Now())
				if err != nil || task.Status != model.StatusQueued || task.Queue == nil || task.Queue.Sequence != sequence || task.Queue.Options.Resolution != "720P" {
					errs <- fmt.Errorf("apply %d immediate=%v err=%v task=%+v", i, immediate, err, task)
					return
				}
				wantImmediate := i%4 == 0
				if immediate != wantImmediate {
					errs <- fmt.Errorf("apply %d immediate=%v want=%v", i, immediate, wantImmediate)
				}
			case 1:
				immediate, err := CancelHeldEdit(task, time.Now())
				if err != nil || task.Status != model.StatusQueued || task.Queue == nil || task.Queue.Sequence != sequence || task.Options != original {
					errs <- fmt.Errorf("cancel %d immediate=%v err=%v task=%+v", i, immediate, err, task)
					return
				}
				wantImmediate := i%4 == 0
				if immediate != wantImmediate {
					errs <- fmt.Errorf("cancel %d immediate=%v want=%v", i, immediate, wantImmediate)
				}
			case 2:
				if !StopRunReturnsHeldToReady(task, settings) || task.Status != model.StatusReady || task.Queue != nil || task.Hold != nil {
					errs <- fmt.Errorf("stop %d task=%+v", i, task)
				}
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}

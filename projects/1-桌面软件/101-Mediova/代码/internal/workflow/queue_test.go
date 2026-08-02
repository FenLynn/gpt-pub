package workflow

import (
	"errors"
	"testing"
	"time"

	"mediaworkbench/internal/model"
)

func readyTask(kind model.Kind) *model.Task {
	return &model.Task{ID: 1, Kind: kind, Status: model.StatusReady}
}

func TestApplyGlobalFieldOnlyTouchesReadySameKind(t *testing.T) {
	s := model.DefaultSettings()
	s.Resolution = "4K"
	readyVideo := readyTask(model.KindVideo)
	readyVideo.Options = model.TaskOptions{Resolution: "720P", Codec: "H.264", Quality: "低"}
	queuedVideo := &model.Task{ID: 2, Kind: model.KindVideo, Status: model.StatusQueued, Options: model.TaskOptions{Resolution: "1080P"}}
	readyImage := readyTask(model.KindImage)
	readyImage.Options = model.TaskOptions{ImageSize: "最大边 1000px"}

	changed := ApplyGlobalField([]*model.Task{readyVideo, queuedVideo, readyImage}, model.KindVideo, s, FieldResolution)
	if changed != 1 {
		t.Fatalf("changed = %d, want 1", changed)
	}
	if readyVideo.Options.Resolution != "4K" {
		t.Fatalf("ready video resolution = %q", readyVideo.Options.Resolution)
	}
	if readyVideo.Options.Codec != "H.264" || readyVideo.Options.Quality != "低" {
		t.Fatalf("unrelated individual fields were overwritten: %+v", readyVideo.Options)
	}
	if queuedVideo.Options.Resolution != "1080P" {
		t.Fatal("queued task was modified by global defaults")
	}
	if readyImage.Options.ImageSize != "最大边 1000px" {
		t.Fatal("other media kind was modified")
	}
}

func TestResetReadyToDefaultsSkipsLockedTasks(t *testing.T) {
	s := model.DefaultSettings()
	s.Resolution = "4K"
	ready := &model.Task{Kind: model.KindVideo, Status: model.StatusReady, Options: model.TaskOptions{Resolution: "720P"}}
	queued := &model.Task{Kind: model.KindVideo, Status: model.StatusQueued, Options: model.TaskOptions{Resolution: "720P"}}

	if got := ResetReadyToDefaults([]*model.Task{ready, queued}, model.KindVideo, s); got != 1 {
		t.Fatalf("reset count = %d", got)
	}
	if ready.Options.Resolution != "4K" {
		t.Fatalf("ready resolution = %q", ready.Options.Resolution)
	}
	if queued.Options.Resolution != "720P" {
		t.Fatal("queued task was reset")
	}
}

func TestFreezeForQueueCreatesImmutableSnapshot(t *testing.T) {
	s := model.DefaultSettings()
	s.Resolution = "1080P"
	task := readyTask(model.KindVideo)
	now := time.Date(2026, 8, 2, 12, 0, 0, 0, time.UTC)

	if err := FreezeForQueue(task, s, `D:\Output`, 17, now); err != nil {
		t.Fatal(err)
	}
	if task.Status != model.StatusQueued || task.Queue == nil {
		t.Fatalf("task not queued: %+v", task)
	}
	if task.Queue.OutputRoot != `D:\Output` || task.Queue.Sequence != 17 || !task.Queue.QueuedAt.Equal(now) {
		t.Fatalf("invalid queue snapshot: %+v", task.Queue)
	}
	s.Resolution = "4K"
	if got := s.EffectiveOptions(task).Resolution; got != "1080P" {
		t.Fatalf("queue snapshot changed with defaults: %q", got)
	}
}

func TestAppendQueueRejectsMixedMedia(t *testing.T) {
	if err := CanAppendToActiveQueue(model.KindVideo, model.KindVideo); err != nil {
		t.Fatal(err)
	}
	if err := CanAppendToActiveQueue(model.KindVideo, model.KindImage); !errors.Is(err, ErrMixedMediaQueue) {
		t.Fatalf("mixed queue error = %v", err)
	}
}

func TestQueuedTaskHoldApplyReturnsToQueue(t *testing.T) {
	original := model.TaskOptions{Resolution: "1080P", Codec: "H.265", Quality: "中"}
	task := &model.Task{
		Kind:    model.KindVideo,
		Status:  model.StatusQueued,
		Options: original,
		Queue:   &model.QueueSnapshot{Options: original, OutputRoot: `D:\Out`, Sequence: 8},
	}
	now := time.Now()
	if err := HoldForEdit(task, now); err != nil {
		t.Fatal(err)
	}
	if task.Status != model.StatusHeld || task.Hold == nil || task.Hold.ReservedSlot {
		t.Fatalf("invalid queued hold state: %+v", task.Hold)
	}
	updated := original
	updated.Resolution = "4K"
	immediate, err := ApplyHeldOptions(task, updated, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if immediate || task.Status != model.StatusQueued || task.Hold != nil {
		t.Fatalf("queued apply result invalid: immediate=%v task=%+v", immediate, task)
	}
	if task.Queue == nil || task.Queue.Options.Resolution != "4K" || task.Queue.Sequence != 8 {
		t.Fatalf("queue order/snapshot not preserved: %+v", task.Queue)
	}
}

func TestProcessingTaskHoldApplyReservesImmediateRestart(t *testing.T) {
	original := model.TaskOptions{Resolution: "1080P", Codec: "H.265"}
	task := &model.Task{
		Kind:       model.KindVideo,
		Status:     model.StatusProcessing,
		Progress:   61,
		OutputPath: `D:\Out\partial.mp4`,
		OutputSize: 1234,
		Options:    original,
		Queue:      &model.QueueSnapshot{Options: original, Sequence: 2},
	}
	if err := HoldForEdit(task, time.Now()); err != nil {
		t.Fatal(err)
	}
	if task.Hold == nil || !task.Hold.ReservedSlot {
		t.Fatal("processing task did not reserve a slot")
	}
	updated := original
	updated.Codec = "H.264"
	immediate, err := ApplyHeldOptions(task, updated, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if !immediate || task.Status != model.StatusQueued {
		t.Fatalf("processing task did not request immediate restart: %v / %s", immediate, task.Status)
	}
	if task.Progress != 0 || task.OutputPath != "" || task.OutputSize != 0 {
		t.Fatalf("restart did not clear partial result: %+v", task)
	}
}

func TestCancelHeldProcessingRestoresOriginalAndRestarts(t *testing.T) {
	original := model.TaskOptions{Resolution: "1080P", Codec: "H.265"}
	task := &model.Task{Kind: model.KindVideo, Status: model.StatusProcessing, Options: original, Queue: &model.QueueSnapshot{Options: original}}
	if err := HoldForEdit(task, time.Now()); err != nil {
		t.Fatal(err)
	}
	task.Options.Codec = "H.264"
	immediate, err := CancelHeldEdit(task, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if !immediate || task.Options.Codec != "H.265" || task.Status != model.StatusQueued {
		t.Fatalf("cancel result invalid: immediate=%v task=%+v", immediate, task)
	}
}

func TestStopReturnsHeldTaskToReady(t *testing.T) {
	s := model.DefaultSettings()
	original := model.TaskOptions{Resolution: "1080P", Codec: "H.265"}
	task := &model.Task{Kind: model.KindVideo, Status: model.StatusQueued, Options: original, Queue: &model.QueueSnapshot{Options: original}}
	if err := HoldForEdit(task, time.Now()); err != nil {
		t.Fatal(err)
	}
	if !StopRunReturnsHeldToReady(task, s) {
		t.Fatal("held task not returned to ready")
	}
	if task.Status != model.StatusReady || task.Queue != nil || task.Hold != nil {
		t.Fatalf("invalid stopped held task: %+v", task)
	}
}

func TestLockedBulkEditIsRejected(t *testing.T) {
	one := []*model.Task{{Status: model.StatusQueued}}
	if err := ValidateLockedEditSelection(one); err != nil {
		t.Fatal(err)
	}
	two := []*model.Task{{Status: model.StatusQueued}, {Status: model.StatusProcessing}}
	if err := ValidateLockedEditSelection(two); !errors.Is(err, ErrBulkEditLocked) {
		t.Fatalf("bulk locked edit error = %v", err)
	}
}

//go:build windows

package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mediaworkbench/internal/model"
)

func TestImageStartUsesSharedActiveScheduler(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("v420_windows.go"))
	if err != nil {
		t.Fatal(err)
	}
	source := string(b)
	if strings.Contains(source, "CanAppendToActiveQueue") {
		t.Fatal("image queue is still rejected while video is active")
	}
	for _, want := range []string{"activeRuns", "v420WorkerCapacity", "!activeKinds[task.Kind]", "!pausedKinds[task.Kind]"} {
		if !strings.Contains(source, want) {
			t.Fatalf("shared scheduler contract missing %q", want)
		}
	}
}

func TestSharedWorkerTakesImageWhileVideoIsProcessing(t *testing.T) {
	ctx := context.Background()
	a := &application{
		running:    true,
		ctx:        ctx,
		runTaskIDs: map[int64]bool{1: true, 2: true},
		activeRuns: map[model.Kind]*activeQueueRun{
			model.KindVideo: {kind: model.KindVideo, ctx: ctx},
			model.KindImage: {kind: model.KindImage, ctx: ctx},
		},
		tasks: []*model.Task{
			{ID: 1, Kind: model.KindVideo, Status: model.StatusProcessing},
			{ID: 2, Kind: model.KindImage, Status: model.StatusQueued},
		},
	}
	id, task, _, ok := a.v420TakeNext()
	if !ok || id != 2 || task == nil || task.Kind != model.KindImage {
		t.Fatalf("shared worker did not take ready image: id=%d task=%#v ok=%v", id, task, ok)
	}
}

package media

import (
	"mediaworkbench/internal/model"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTaskBundleRoundTripAndPrepare(t *testing.T) {
	d := t.TempDir()
	input := filepath.Join(d, "a.mp4")
	if err := osWriteFile(input, []byte("x")); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(d, "queue.json")
	tasks := []*model.Task{{ID: 9, Input: input, Kind: model.KindVideo, Status: model.StatusDone, Progress: 100, OutputPath: "old.mp4", OutputSize: 99, Error: "old"}}
	if err := WriteTaskBundle(path, "3.7.0", model.KindVideo, tasks); err != nil {
		t.Fatal(err)
	}
	bundle, err := ReadTaskBundle(path)
	if err != nil {
		t.Fatal(err)
	}
	id := int64(100)
	prepared, dup, missing := PrepareImportedTasks(bundle.Tasks, nil, func() int64 { id++; return id })
	if dup != 0 || missing != 0 || len(prepared) != 1 {
		t.Fatalf("prepared=%d dup=%d missing=%d", len(prepared), dup, missing)
	}
	got := prepared[0]
	if got.ID != 101 || got.Status != model.StatusReady || got.Progress != 0 || got.OutputPath != "" || got.OutputSize != 0 || got.Error != "" {
		t.Fatalf("task was not reset: %+v", got)
	}
	_, dup, _ = PrepareImportedTasks(bundle.Tasks, map[string]bool{strings.ToLower(filepath.Clean(input)): true}, func() int64 { return 1 })
	if dup != 1 {
		t.Fatalf("duplicate=%d", dup)
	}
}

func osWriteFile(path string, b []byte) error { return os.WriteFile(path, b, 0o644) }

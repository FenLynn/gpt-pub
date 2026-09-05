package media

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestPreflightInputAndOutputDirectory(t *testing.T) {
	root := t.TempDir()
	input := filepath.Join(root, "source.bin")
	if err := os.WriteFile(input, []byte("media"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := PreflightInput(input); err != nil {
		t.Fatalf("valid input rejected: %v", err)
	}
	for name, path := range map[string]string{
		"missing":   filepath.Join(root, "missing.bin"),
		"directory": root,
	} {
		if err := PreflightInput(path); err == nil {
			t.Fatalf("%s input unexpectedly accepted", name)
		}
	}
	empty := filepath.Join(root, "empty.bin")
	if err := os.WriteFile(empty, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := PreflightInput(empty); err == nil {
		t.Fatal("empty input unexpectedly accepted")
	}
	output := filepath.Join(root, "nested", "output")
	if err := PreflightOutputDirectory(output); err != nil {
		t.Fatalf("writable output rejected: %v", err)
	}
	entries, err := os.ReadDir(output)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("write preflight left garbage: %v", entries)
	}
}

func TestStagedOutputCommitPublishesOnlyCompleteFile(t *testing.T) {
	root := t.TempDir()
	final := filepath.Join(root, "result.mp4")
	staged := StagedOutputPath(final)
	if filepath.Dir(staged) != root || filepath.Ext(staged) != ".mp4" {
		t.Fatalf("unexpected staged path %q", staged)
	}
	if err := os.WriteFile(staged, []byte("complete"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(final); !os.IsNotExist(err) {
		t.Fatal("final name became visible before commit")
	}
	if err := CommitStagedOutput(staged, final); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(final); err != nil || string(data) != "complete" {
		t.Fatalf("committed output mismatch: %q %v", data, err)
	}
	replacement := StagedOutputPath(final)
	if err := os.WriteFile(replacement, []byte("replacement"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := CommitStagedOutput(replacement, final); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(final); err != nil || string(data) != "replacement" {
		t.Fatalf("replacement output mismatch: %q %v", data, err)
	}
}

func TestCleanupStagedOutputsIsBoundedAndAgeGated(t *testing.T) {
	root := t.TempDir()
	oldPart := filepath.Join(root, ".mediova-part-1-1.mp4")
	newPart := filepath.Join(root, ".mediova-part-1-2.mp4")
	userFile := filepath.Join(root, "ordinary.mp4")
	for _, path := range []string{oldPart, newPart, userFile} {
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(oldPart, old, old); err != nil {
		t.Fatal(err)
	}
	if removed := CleanupStagedOutputs(root, 24*time.Hour); removed != 1 {
		t.Fatalf("removed=%d want 1", removed)
	}
	if _, err := os.Stat(oldPart); !os.IsNotExist(err) {
		t.Fatal("old Mediova part was not removed")
	}
	for _, path := range []string{newPart, userFile} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("protected file %q changed: %v", path, err)
		}
	}
}

func TestStagedOutputPathIsUniqueUnderConcurrency(t *testing.T) {
	const workers = 32
	const perWorker = 256
	root := t.TempDir()
	seen := make(map[string]bool, workers*perWorker)
	var mu sync.Mutex
	var wait sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			for i := 0; i < perWorker; i++ {
				path := StagedOutputPath(filepath.Join(root, "output.mp4"))
				mu.Lock()
				if seen[path] {
					t.Errorf("duplicate staged path: %s", path)
				}
				seen[path] = true
				mu.Unlock()
			}
		}()
	}
	wait.Wait()
	if len(seen) != workers*perWorker {
		t.Fatalf("unique paths=%d want %d", len(seen), workers*perWorker)
	}
}

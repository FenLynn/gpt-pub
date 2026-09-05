//go:build windows

package main

import "testing"

func TestShouldBatchTaskListBuild(t *testing.T) {
	tests := []struct {
		name          string
		rows          int
		controlsReady bool
		selfTest      bool
		want          bool
	}{
		{name: "small list stays synchronous", rows: listBuildThreshold - 1, controlsReady: true, want: false},
		{name: "large list batches", rows: listBuildThreshold, controlsReady: true, want: true},
		{name: "controls not ready", rows: 1268, controlsReady: false, want: false},
		{name: "native self test remains deterministic", rows: 1268, controlsReady: true, selfTest: true, want: false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := shouldBatchTaskListBuild(tc.rows, tc.controlsReady, tc.selfTest); got != tc.want {
				t.Fatalf("shouldBatchTaskListBuild(%d, %v, %v) = %v, want %v", tc.rows, tc.controlsReady, tc.selfTest, got, tc.want)
			}
		})
	}
}

func TestNextListBuildEndCoversLargeListExactly(t *testing.T) {
	const total = 1268
	current := 0
	batches := 0
	for current < total {
		next := nextListBuildEnd(current, total, listBuildChunkSize)
		if next <= current || next > total {
			t.Fatalf("invalid batch boundary %d -> %d of %d", current, next, total)
		}
		current = next
		batches++
	}
	if current != total {
		t.Fatalf("ended at %d, want %d", current, total)
	}
	if batches != 20 {
		t.Fatalf("got %d batches, want 20", batches)
	}
}

func TestNextListBuildEndUnlimitedAndBounds(t *testing.T) {
	if got := nextListBuildEnd(64, 1268, 0); got != 1268 {
		t.Fatalf("unlimited batch ended at %d, want 1268", got)
	}
	if got := nextListBuildEnd(-5, 20, 8); got != 8 {
		t.Fatalf("negative start ended at %d, want 8", got)
	}
	if got := nextListBuildEnd(25, 20, 8); got != 25 {
		t.Fatalf("past-end start changed to %d, want 25", got)
	}
}

func TestCloneSelectedTaskIDsDropsFalseEntries(t *testing.T) {
	original := map[int64]bool{1: true, 2: false}
	cloned := cloneSelectedTaskIDs(original)
	original[1] = false
	if !cloned[1] {
		t.Fatal("clone did not preserve selected task")
	}
	if _, exists := cloned[2]; exists {
		t.Fatal("clone retained a false selection entry")
	}
}

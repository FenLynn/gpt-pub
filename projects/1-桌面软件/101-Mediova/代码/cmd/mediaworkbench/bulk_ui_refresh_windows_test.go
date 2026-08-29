//go:build windows

package main

import "testing"

func TestTakePendingProbeBatchIsBoundedAndStable(t *testing.T) {
	pending := map[int64]struct{}{9: {}, 2: {}, 7: {}, 1: {}, 5: {}}
	got := takePendingProbeBatch(pending, 3)
	want := []int64{1, 2, 5}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("batch=%v want=%v", got, want)
		}
	}
	if len(pending) != 2 {
		t.Fatalf("remaining=%d want=2", len(pending))
	}
}

func TestBulkImportSelectionCapsAutomaticNativeSelection(t *testing.T) {
	small := map[int64]bool{1: true, 2: true}
	if got := bulkImportSelectionIDs(small, 1, 128); len(got) != 2 {
		t.Fatalf("small selection=%v", got)
	}
	large := make(map[int64]bool, 1268)
	for id := int64(1); id <= 1268; id++ {
		large[id] = true
	}
	got := bulkImportSelectionIDs(large, 42, 128)
	if len(got) != 1 || !got[42] {
		t.Fatalf("large selection=%v want only first item", got)
	}
}

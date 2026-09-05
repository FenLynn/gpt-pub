//go:build windows

package main

import "testing"

func TestProgressRowsCoalesceUntilUIFlush(t *testing.T) {
	a := &application{}
	if !a.queueProgressRow(7) {
		t.Fatal("first progress row did not schedule a UI flush")
	}
	if a.queueProgressRow(7) {
		t.Fatal("duplicate progress row scheduled a second UI flush")
	}
	if a.queueProgressRow(9) {
		t.Fatal("same batch scheduled a second UI flush")
	}

	a.progressMu.Lock()
	pending := len(a.pendingProgressRows)
	scheduled := a.progressFlushScheduled
	a.progressMu.Unlock()
	if pending != 2 || !scheduled {
		t.Fatalf("pending=%d scheduled=%v", pending, scheduled)
	}
}

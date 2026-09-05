package main

import (
	"testing"
	"time"
)

func TestActiveRunClockFreezesDuringPause(t *testing.T) {
	start := time.Date(2026, 8, 3, 10, 0, 0, 0, time.UTC)
	var clock activeRunClock
	clock.Reset(start)

	clock.SetPaused(true, start.Add(12*time.Second))
	if got := clock.Elapsed(start.Add(42 * time.Second)); got != 12*time.Second {
		t.Fatalf("paused elapsed=%v, want 12s", got)
	}
	if !clock.Paused() {
		t.Fatal("clock should report paused")
	}

	clock.SetPaused(false, start.Add(42*time.Second))
	if got := clock.Elapsed(start.Add(50 * time.Second)); got != 20*time.Second {
		t.Fatalf("resumed elapsed=%v, want 20s", got)
	}
	if clock.Paused() {
		t.Fatal("clock should report resumed")
	}
}

func TestActiveRunClockAccumulatesMultiplePauseIntervals(t *testing.T) {
	start := time.Unix(1000, 0)
	var clock activeRunClock
	clock.Reset(start)
	clock.SetPaused(true, start.Add(5*time.Second))
	clock.SetPaused(false, start.Add(15*time.Second))
	clock.SetPaused(true, start.Add(20*time.Second))
	clock.SetPaused(false, start.Add(25*time.Second))

	if got := clock.Elapsed(start.Add(35 * time.Second)); got != 20*time.Second {
		t.Fatalf("elapsed=%v, want 20s", got)
	}
}

func TestActiveRunClockIgnoresDuplicateTransitions(t *testing.T) {
	start := time.Unix(2000, 0)
	var clock activeRunClock
	clock.Reset(start)
	clock.SetPaused(true, start.Add(3*time.Second))
	clock.SetPaused(true, start.Add(9*time.Second))
	clock.SetPaused(false, start.Add(13*time.Second))
	clock.SetPaused(false, start.Add(18*time.Second))

	if got := clock.Elapsed(start.Add(20 * time.Second)); got != 10*time.Second {
		t.Fatalf("elapsed=%v, want 10s", got)
	}
}

func TestV452ProgressInvalidationIsContentDriven(t *testing.T) {
	if v452ShouldInvalidateProgress(20, 20.01, "same", "same", false, false) {
		t.Fatal("tiny unchanged update should not repaint")
	}
	if !v452ShouldInvalidateProgress(20, 20.1, "same", "same", false, false) {
		t.Fatal("visible percentage change should repaint")
	}
	if !v452ShouldInvalidateProgress(20, 20, "old", "new", false, false) {
		t.Fatal("text change should repaint")
	}
	if !v452ShouldInvalidateProgress(20, 20, "same", "same", false, true) {
		t.Fatal("pause-state change should repaint")
	}
}

func TestV452StatusLampDiameterStaysSquareAndBounded(t *testing.T) {
	for _, tc := range []struct {
		row, text, want int32
	}{
		{20, 14, 14},
		{20, 30, 18},
		{16, 0, 12},
		{3, 0, 4},
	} {
		if got := v452StatusLampDiameter(tc.row, tc.text); got != tc.want {
			t.Fatalf("row=%d text=%d got=%d want=%d", tc.row, tc.text, got, tc.want)
		}
	}
}

package main

import (
	"math"
	"testing"
)

func round7AlmostEqual(a, b float64) bool {
	return math.Abs(a-b) < 1e-9
}

func TestRound7FiveMarkerIdentity(t *testing.T) {
	model := round7NormalizeTimeModel(120, 30, 12, 45, 98)
	markers := round7MarkerOrder(model)
	want := [5]float64{0, 12, 45, 98, 120}
	for i := range want {
		if !round7AlmostEqual(markers[i], want[i]) {
			t.Fatalf("marker %d=%v, want %v; all=%v", i, markers[i], want[i], markers)
		}
	}
}

func TestRound7MoveCurrentDoesNotMoveTrimBoundaries(t *testing.T) {
	before := round7NormalizeTimeModel(100, 25, 20, 30, 80)
	after := round7MoveCurrent(before, 67)
	if !round7AlmostEqual(after.TrimStart, before.TrimStart) || !round7AlmostEqual(after.TrimEnd, before.TrimEnd) {
		t.Fatalf("current movement changed trim range: before=%+v after=%+v", before, after)
	}
	if !round7AlmostEqual(after.Current, 67) {
		t.Fatalf("current=%v, want 67", after.Current)
	}
	if !round7AlmostEqual(after.SourceStart, 0) || !round7AlmostEqual(after.SourceEnd, 100) {
		t.Fatalf("source endpoints changed: %+v", after)
	}
}

func TestRound7MoveTrimStartDoesNotMoveCurrentOrEnd(t *testing.T) {
	before := round7NormalizeTimeModel(100, 25, 20, 60, 80)
	after := round7MoveTrimStart(before, 25, 42)
	if !round7AlmostEqual(after.TrimStart, 42) {
		t.Fatalf("trim start=%v, want 42", after.TrimStart)
	}
	if !round7AlmostEqual(after.Current, before.Current) || !round7AlmostEqual(after.TrimEnd, before.TrimEnd) {
		t.Fatalf("trim-start movement changed current/end: before=%+v after=%+v", before, after)
	}
}

func TestRound7MoveTrimEndDoesNotMoveCurrentOrStart(t *testing.T) {
	before := round7NormalizeTimeModel(100, 25, 20, 60, 80)
	after := round7MoveTrimEnd(before, 25, 74)
	if !round7AlmostEqual(after.TrimEnd, 74) {
		t.Fatalf("trim end=%v, want 74", after.TrimEnd)
	}
	if !round7AlmostEqual(after.Current, before.Current) || !round7AlmostEqual(after.TrimStart, before.TrimStart) {
		t.Fatalf("trim-end movement changed current/start: before=%+v after=%+v", before, after)
	}
}

func TestRound7TrimBoundariesClampWithoutCrossing(t *testing.T) {
	model := round7NormalizeTimeModel(10, 25, 2, 5, 8)
	start := round7MoveTrimStart(model, 25, 20)
	if start.TrimStart >= start.TrimEnd {
		t.Fatalf("start crossed end: %+v", start)
	}
	end := round7MoveTrimEnd(model, 25, -4)
	if end.TrimEnd <= end.TrimStart {
		t.Fatalf("end crossed start: %+v", end)
	}
}

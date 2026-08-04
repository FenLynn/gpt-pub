package media

import (
	"math"
	"testing"
)

func almostEqual(a, b float64) bool {
	return math.Abs(a-b) < 1e-6
}

func TestNormalizeTrimRangeDefaultsAndMinimumSpan(t *testing.T) {
	if got := NormalizeTrimRange(0, 25, TrimRangeState{Start: 1, End: 2, Playhead: 1.5}); got != (TrimRangeState{}) {
		t.Fatalf("zero duration=%+v", got)
	}

	got := NormalizeTrimRange(10, 25, TrimRangeState{Start: 9.99, End: 0, Playhead: 20})
	if !almostEqual(got.End, 10) || !almostEqual(got.Start, 9.96) || !almostEqual(got.Playhead, 10) {
		t.Fatalf("normalized=%+v", got)
	}

	got = NormalizeTrimRange(10, 50, TrimRangeState{Start: -3, End: 0.001, Playhead: -1})
	if !almostEqual(got.Start, 0) || !almostEqual(got.End, 0.02) || !almostEqual(got.Playhead, 0) {
		t.Fatalf("minimum frame span=%+v", got)
	}
}

func TestTimelineCoordinatesRoundTrip(t *testing.T) {
	for _, value := range []float64{0, 1.25, 5, 9.9, 10} {
		x := TimelineTimeToX(value, 10, 20, 1020)
		back := TimelineXToTime(float64(x), 10, 20, 1020)
		if math.Abs(value-back) > 0.011 {
			t.Fatalf("value=%v x=%d back=%v", value, x, back)
		}
	}
	if got := TimelineTimeToX(-1, 10, 20, 1020); got != 20 {
		t.Fatalf("left clamp=%d", got)
	}
	if got := TimelineXToTime(2000, 10, 20, 1020); !almostEqual(got, 10) {
		t.Fatalf("right clamp=%v", got)
	}
}

func TestHitTrimTimelinePrioritizesEndsAndPlayhead(t *testing.T) {
	state := TrimRangeState{Start: 2, End: 8, Playhead: 5}
	if got := HitTrimTimeline(state, 10, 200, 0, 1000, 8); got != TrimTimelineStart {
		t.Fatalf("start hit=%v", got)
	}
	if got := HitTrimTimeline(state, 10, 800, 0, 1000, 8); got != TrimTimelineEnd {
		t.Fatalf("end hit=%v", got)
	}
	if got := HitTrimTimeline(state, 10, 500, 0, 1000, 8); got != TrimTimelinePlayhead {
		t.Fatalf("playhead hit=%v", got)
	}
	if got := HitTrimTimeline(state, 10, 600, 0, 1000, 8); got != TrimTimelineRange {
		t.Fatalf("range hit=%v", got)
	}
	if got := HitTrimTimeline(state, 10, 50, 0, 1000, 8); got != TrimTimelineNone {
		t.Fatalf("outside hit=%v", got)
	}
}

func TestDragTrimTimelineClampsEndsAndMovesRange(t *testing.T) {
	initial := TrimRangeState{Start: 2, End: 6, Playhead: 4}

	start := DragTrimTimeline(initial, 10, 25, TrimTimelineStart, 2, 9)
	if !almostEqual(start.Start, 5.96) || !almostEqual(start.End, 6) {
		t.Fatalf("start drag=%+v", start)
	}

	end := DragTrimTimeline(initial, 10, 25, TrimTimelineEnd, 6, 1)
	if !almostEqual(end.Start, 2) || !almostEqual(end.End, 2.04) {
		t.Fatalf("end drag=%+v", end)
	}

	movedRight := DragTrimTimeline(initial, 10, 25, TrimTimelineRange, 3, 20)
	if !almostEqual(movedRight.Start, 6) || !almostEqual(movedRight.End, 10) || !almostEqual(movedRight.Playhead, 8) {
		t.Fatalf("range right=%+v", movedRight)
	}

	movedLeft := DragTrimTimeline(initial, 10, 25, TrimTimelineRange, 5, -10)
	if !almostEqual(movedLeft.Start, 0) || !almostEqual(movedLeft.End, 4) || !almostEqual(movedLeft.Playhead, 2) {
		t.Fatalf("range left=%+v", movedLeft)
	}

	playhead := DragTrimTimeline(initial, 10, 25, TrimTimelinePlayhead, 4, 9.5)
	if !almostEqual(playhead.Playhead, 9.5) || !almostEqual(playhead.Start, 2) || !almostEqual(playhead.End, 6) {
		t.Fatalf("playhead=%+v", playhead)
	}
}

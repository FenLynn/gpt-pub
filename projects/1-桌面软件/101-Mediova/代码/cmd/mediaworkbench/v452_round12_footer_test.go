package main

import "testing"

func TestRound12FooterGeometryIsStableAndNonOverlapping(t *testing.T) {
	widths := []int32{900, 960, 1039, 1040, 1120, 1320, 1600, 1920, 2560}
	for _, compact := range []bool{false, true} {
		for _, width := range widths {
			first := footerGeometryFor(width, 700, compact)
			second := footerGeometryFor(width, 700, compact)
			if first != second {
				t.Fatalf("footer geometry is not deterministic: width=%d compact=%v first=%+v second=%+v", width, compact, first, second)
			}
			buttons := []footerRect{first.Start, first.Pause, first.Stop}
			if first.Status.Y != first.Start.Y || first.Start.Y != first.Pause.Y || first.Pause.Y != first.Stop.Y {
				t.Fatalf("footer controls are not on one row: width=%d compact=%v geometry=%+v", width, compact, first)
			}
			if first.Status.H != first.Start.H || first.Start.H != first.Pause.H || first.Pause.H != first.Stop.H {
				t.Fatalf("footer controls have different heights: width=%d compact=%v geometry=%+v", width, compact, first)
			}
			if first.Status.X < 0 || first.Status.W < 120 || first.Status.X+first.Status.W > width {
				t.Fatalf("status rectangle invalid: width=%d compact=%v rect=%+v", width, compact, first.Status)
			}
			if first.Progress.X < 0 || first.Progress.W <= 0 || first.Progress.X+first.Progress.W > width {
				t.Fatalf("progress rectangle invalid: width=%d compact=%v rect=%+v", width, compact, first.Progress)
			}
			if first.Progress.Y+first.Progress.H > first.Status.Y {
				t.Fatalf("progress overlaps action row: width=%d compact=%v geometry=%+v", width, compact, first)
			}
			for i, r := range buttons {
				if r.X < 0 || r.W <= 0 || r.X+r.W > width {
					t.Fatalf("button %d outside client: width=%d compact=%v rect=%+v", i, width, compact, r)
				}
			}
			if footerRectsOverlap(first.Status, first.Start) || footerRectsOverlap(first.Start, first.Pause) || footerRectsOverlap(first.Pause, first.Stop) {
				t.Fatalf("footer controls overlap: width=%d compact=%v geometry=%+v", width, compact, first)
			}
			if !(first.Status.X+first.Status.W < first.Start.X && first.Start.X+first.Start.W < first.Pause.X && first.Pause.X+first.Pause.W < first.Stop.X) {
				t.Fatalf("footer control order is unstable: width=%d compact=%v geometry=%+v", width, compact, first)
			}
		}
	}
}

package main

import (
	"testing"
	"time"
)

func assertFooterSafe(t *testing.T, width, barY int32, compact bool) footerGeometry {
	t.Helper()
	g := footerGeometryFor(width, barY, compact)
	buttons := []footerRect{g.Start, g.Pause, g.Stop}
	for i, button := range buttons {
		if button.Y != g.Start.Y || button.H != g.Start.H {
			t.Fatalf("width=%d compact=%v button %d is not on shared baseline: %+v start=%+v", width, compact, i, button, g.Start)
		}
		if button.X < 0 || button.W <= 0 || button.X+button.W > width {
			t.Fatalf("width=%d compact=%v button %d outside client: %+v", width, compact, i, button)
		}
		if footerRectsOverlap(g.Progress, button) || footerRectsOverlap(g.Status, button) || footerRectsOverlap(g.Timing, button) {
			t.Fatalf("width=%d compact=%v button %d overlaps footer content: %+v", width, compact, i, button)
		}
	}
	if g.Status.X < 0 || g.Status.W < 120 || g.Status.X+g.Status.W > width {
		t.Fatalf("width=%d compact=%v invalid status geometry: %+v", width, compact, g.Status)
	}
	if g.Timing.X < 0 || g.Timing.W < 220 || g.Timing.X+g.Timing.W > width {
		t.Fatalf("width=%d compact=%v invalid timing geometry: %+v", width, compact, g.Timing)
	}
	if footerRectsOverlap(g.Status, g.Timing) || !(g.Status.X+g.Status.W < g.Timing.X && g.Timing.X+g.Timing.W < g.Start.X) {
		t.Fatalf("width=%d compact=%v footer content order/overlap invalid: %+v", width, compact, g)
	}
	if g.Progress.X != 12 || g.Progress.W != width-24 || g.Progress.X+g.Progress.W > width {
		t.Fatalf("width=%d compact=%v invalid progress geometry: %+v", width, compact, g.Progress)
	}
	if footerRectsOverlap(g.Start, g.Pause) || footerRectsOverlap(g.Pause, g.Stop) || footerRectsOverlap(g.Start, g.Stop) {
		t.Fatalf("width=%d compact=%v action buttons overlap: %+v", width, compact, g)
	}
	if g.Pause.X-(g.Start.X+g.Start.W) != 10 || g.Stop.X-(g.Pause.X+g.Pause.W) != 10 {
		t.Fatalf("width=%d compact=%v action gaps changed: %+v", width, compact, g)
	}
	if width-(g.Stop.X+g.Stop.W) != 12 {
		t.Fatalf("width=%d compact=%v stop button right safety margin changed: %+v", width, compact, g.Stop)
	}
	if g.Progress.Y+g.Progress.H+8 != g.Start.Y {
		t.Fatalf("width=%d compact=%v progress/action gap changed: progress=%+v start=%+v", width, compact, g.Progress, g.Start)
	}
	if g.Start.H != 34 {
		t.Fatalf("width=%d compact=%v action height changed: %+v", width, compact, g)
	}
	return g
}

func TestFooterMinuteText(t *testing.T) {
	tests := []struct {
		duration time.Duration
		roundUp  bool
		want     string
	}{
		{0, false, "—"},
		{20 * time.Second, false, "<1m"},
		{89 * time.Second, false, "1m"},
		{89 * time.Second, true, "2m"},
		{65*time.Minute + 2*time.Second, false, "1h 05m"},
		{65*time.Minute + 2*time.Second, true, "1h 06m"},
	}
	for _, tc := range tests {
		if got := footerMinuteText(tc.duration, tc.roundUp); got != tc.want {
			t.Fatalf("footerMinuteText(%v, %v)=%q want %q", tc.duration, tc.roundUp, got, tc.want)
		}
	}
}

func TestFooterOverallLabelContainsOnlyCompletionAndPercent(t *testing.T) {
	if got, want := footerOverallLabel(3, 7, 77.2), "已完成 3/7      77.2%"; got != want {
		t.Fatalf("footerOverallLabel=%q want %q", got, want)
	}
}

func TestFooterGeometryKeepsActionButtonsAligned(t *testing.T) {
	cases := []struct {
		name    string
		width   int32
		barY    int32
		compact bool
	}{
		{"980x700", 980, 536, true},
		{"1039-narrow", 1039, 556, true},
		{"1040-threshold", 1040, 556, true},
		{"1120x720", 1120, 556, true},
		{"1280x720", 1280, 556, true},
		{"1450x820", 1450, 701, false},
		{"1650x930", 1650, 811, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assertFooterSafe(t, tc.width, tc.barY, tc.compact)
		})
	}
}

func TestFooterGeometryContinuousHorizontalMatrix(t *testing.T) {
	for width := int32(900); width <= 1920; width += 7 {
		for _, compact := range []bool{false, true} {
			assertFooterSafe(t, width, 600, compact)
		}
	}
}

func TestFooterGeometryUsesCompactActionWidthsOnlyWhenNeeded(t *testing.T) {
	narrow := assertFooterSafe(t, 1039, 600, true)
	if narrow.Start.W != 126 || narrow.Pause.W != 94 || narrow.Stop.W != 94 {
		t.Fatalf("unexpected narrow action widths: %+v", narrow)
	}
	wide := assertFooterSafe(t, 1040, 600, true)
	if wide.Start.W != 142 || wide.Pause.W != 106 || wide.Stop.W != 100 {
		t.Fatalf("unexpected wide action widths: %+v", wide)
	}
}

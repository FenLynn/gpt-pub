package main

import "testing"

func TestFooterGeometryKeepsActionButtonsAligned(t *testing.T) {
	cases := []struct {
		name    string
		width   int32
		barY    int32
		compact bool
	}{
		{"1120x720", 1120, 556, true},
		{"1280x720", 1280, 556, true},
		{"1450x820", 1450, 701, false},
		{"1650x930", 1650, 811, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			g := footerGeometryFor(tc.width, tc.barY, tc.compact)
			buttons := []footerRect{g.Start, g.Pause, g.Stop}
			for i, button := range buttons {
				if button.Y != g.Start.Y || button.H != g.Start.H {
					t.Fatalf("button %d is not on shared baseline: %+v start=%+v", i, button, g.Start)
				}
				if footerRectsOverlap(g.Progress, button) || footerRectsOverlap(g.Status, button) {
					t.Fatalf("button %d overlaps footer content: %+v", i, button)
				}
			}
			if g.Pause.X-(g.Start.X+g.Start.W) != 8 || g.Stop.X-(g.Pause.X+g.Pause.W) != 8 {
				t.Fatalf("button gaps changed: start=%+v pause=%+v stop=%+v", g.Start, g.Pause, g.Stop)
			}
			if g.Stop.X+g.Stop.W != tc.width-8 {
				t.Fatalf("button group is not right aligned: %+v width=%d", g.Stop, tc.width)
			}
			if g.Progress.Y+g.Progress.H+8 != g.Start.Y {
				t.Fatalf("progress/action gap changed: progress=%+v start=%+v", g.Progress, g.Start)
			}
		})
	}
}

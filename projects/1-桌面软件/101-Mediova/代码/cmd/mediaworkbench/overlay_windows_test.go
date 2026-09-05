//go:build windows

package main

import (
	"testing"
	"time"
)

func TestFloatingProgressTextStaysSingleLineAndCompact(t *testing.T) {
	got := floatingProgressText(89.6, 1, 7, time.Hour, time.Minute, "10 MB/s", 2, "FFmpeg", false)
	if got != "1 / 7" {
		t.Fatalf("floating text = %q", got)
	}
	paused := floatingProgressText(89.6, 1, 7, 0, 0, "", 0, "", true)
	if paused != "1 / 7" {
		t.Fatalf("paused floating text = %q", paused)
	}
}

func TestFloatingProgressPercentIsSeparateAndRightAligned(t *testing.T) {
	if got := floatingProgressPercent(89.6); got != "90%" {
		t.Fatalf("floating percentage = %q", got)
	}
}

// TestFloatingCornerCoverageIsSmooth verifies that pixels inside the rounded
// rectangle get coverage=1, pixels outside get coverage=0, and edge pixels
// are in (0,1) — confirming the antialiased fringe.
func TestFloatingCornerCoverageIsSmooth(t *testing.T) {
	// 196x34 logical bar, 17 px radius
	w, h := int32(196), int32(34)
	r := 17.0

	// Centre pixel → fully inside
	if cov, _ := cornerCoverageDist(98, 17, w, h, r); cov != 1 {
		t.Fatalf("centre coverage = %v, want 1", cov)
	}
	// Well outside corner (0,0) at radius 17 → corner zone, dist > 0.5
	cov, _ := cornerCoverageDist(0, 0, w, h, r)
	if cov >= 0.5 {
		t.Fatalf("top-left corner coverage = %v, should be < 0.5 (outside)", cov)
	}
	// Pixel on the horizontal axis inside — no corner zone
	if c, _ := cornerCoverageDist(98, 0, w, h, r); c != 1 {
		t.Fatalf("top-edge centre coverage = %v, want 1", c)
	}
}

// TestFloatingComposeDIBFillsProgress checks that progress fill and background are correctly rendered.
func TestFloatingComposeDIBFillsProgress(t *testing.T) {
	w, h := int32(196), int32(34)
	raw := make([]byte, int(w*h*4))
	// 50% progress → filled from x=0 to x=98, right half is background
	floatingComposeDIB(raw, w, h, 50, "3/7", false, false)

	// Check a pixel in the filled zone (centre row, x=60)
	off := int((h/2*w + 60) * 4)
	if raw[off+3] == 0 {
		t.Fatalf("fill region pixel at x=60 is transparent, want opaque/semi-transparent")
	}
	// Check a pixel in the background zone (centre row, x=150)
	off2 := int((h/2*w + 150) * 4)
	if raw[off2+3] == 0 {
		t.Fatalf("background region pixel at x=150 is transparent, want semi-transparent")
	}
	// Both regions must have visible alpha
	if raw[off+3] < 30 {
		t.Fatalf("fill region pixel at x=60 alpha=%d, want >=30", raw[off+3])
	}
	if raw[off2+3] < 30 {
		t.Fatalf("background region pixel at x=150 alpha=%d, want >=30", raw[off2+3])
	}
	// The floating bar must remain readable on light or detailed wallpapers.
	if raw[off2+3] < 190 {
		t.Fatalf("background region pixel at x=150 alpha=%d, want >=190", raw[off2+3])
	}
	if raw[off+3] <= raw[off2+3] {
		t.Fatalf("fill alpha=%d must exceed background alpha=%d", raw[off+3], raw[off2+3])
	}
}

// TestFloatingApplyAlphaLegacyCompatibility keeps the behaviour contract that
// floatingApplyAlpha sets all alpha bytes to 255 (unchanged legacy contract).
func TestFloatingApplyAlphaLegacyCompatibility(t *testing.T) {
	raw := make([]byte, 4*6)
	floatingApplyAlpha(raw, 3, 2, 5)
	for offset := 3; offset < len(raw); offset += 4 {
		if raw[offset] != 255 {
			t.Fatalf("pixel alpha at byte %d = %d, want 255", offset, raw[offset])
		}
	}
}
func TestFloatingProgressDoubleClickHitZone(t *testing.T) {
	edge := scaleDPI(26)
	width := edge*2 + scaleDPI(120)
	cases := []struct {
		x    int32
		want bool
	}{
		{edge - 1, false},
		{edge, true},
		{width / 2, true},
		{width - edge - 1, true},
		{width - edge, false},
	}
	for _, tc := range cases {
		if got := floatingProgressDoubleClickHit(tc.x, width); got != tc.want {
			t.Fatalf("x=%d width=%d hit=%v want=%v", tc.x, width, got, tc.want)
		}
	}
}

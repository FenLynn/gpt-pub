//go:build windows

package main

import (
	"testing"
	"time"
)

func TestFloatingProgressTextStaysSingleLineAndCompact(t *testing.T) {
	got := floatingProgressText(89.6, 1, 7, time.Hour, time.Minute, "10 MB/s", 2, "FFmpeg", false)
	if got != "1/7" {
		t.Fatalf("floating text = %q", got)
	}
	paused := floatingProgressText(89.6, 1, 7, 0, 0, "", 0, "", true)
	if paused != "1/7" {
		t.Fatalf("paused floating text = %q", paused)
	}
}

func TestFloatingProgressPercentIsSeparateAndRightAligned(t *testing.T) {
	if got := floatingProgressPercent(89.6); got != "90%" {
		t.Fatalf("floating percentage = %q", got)
	}
}

func TestFloatingLayerIsFullyOpaque(t *testing.T) {
	raw := make([]byte, 4*6)
	floatingApplyAlpha(raw, 3, 2, 5)
	for offset := 3; offset < len(raw); offset += 4 {
		if raw[offset] != 255 {
			t.Fatalf("pixel alpha at byte %d = %d, want 255", offset, raw[offset])
		}
	}
}

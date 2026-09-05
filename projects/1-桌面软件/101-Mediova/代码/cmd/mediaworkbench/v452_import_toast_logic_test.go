package main

import (
	"testing"
	"time"
)

func TestV452ImportToastFramesFadeAndRise(t *testing.T) {
	duration := 200 * time.Millisecond
	start := v452ImportToastFrameAt(0, duration, false)
	middle := v452ImportToastFrameAt(duration/2, duration, false)
	end := v452ImportToastFrameAt(duration, duration, false)
	if start.Alpha != 0 || start.OffsetY != 16 || start.Done {
		t.Fatalf("opening start=%+v", start)
	}
	if middle.Alpha <= start.Alpha || middle.Alpha >= end.Alpha || middle.OffsetY >= start.OffsetY {
		t.Fatalf("opening middle=%+v", middle)
	}
	if end.Alpha != 255 || end.OffsetY != 0 || !end.Done {
		t.Fatalf("opening end=%+v", end)
	}
	closing := v452ImportToastFrameAt(duration, duration, true)
	if closing.Alpha != 0 || closing.OffsetY != -8 || !closing.Done {
		t.Fatalf("closing end=%+v", closing)
	}
}

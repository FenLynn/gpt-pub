//go:build windows

package main

import "testing"

func TestDPIScalingRoundTrip(t *testing.T) {
	old := uiDPI
	defer func() { uiDPI = old }()
	for _, dpi := range []uint32{96, 120, 144, 168, 192} {
		uiDPI = dpi
		for _, v := range []int32{1, 8, 32, 980, 1650} {
			got := unscaleDPI(scaleDPI(v))
			if got < v-1 || got > v+1 {
				t.Fatalf("dpi=%d v=%d roundtrip=%d", dpi, v, got)
			}
		}
	}
}

func TestMinimumWindowGrowsWithDPI(t *testing.T) {
	if scaleDPIValue(980, 168) <= scaleDPIValue(980, 96) {
		t.Fatal("width did not grow")
	}
	if scaleDPIValue(700, 168) <= scaleDPIValue(700, 96) {
		t.Fatal("height did not grow")
	}
}

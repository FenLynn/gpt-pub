package main

import (
	"math"
	"reflect"
	"testing"
)

func TestCompressionVisualNearOneToOneIsYellow(t *testing.T) {
	v := compressionVisualFor(1000, 1037)
	if v.Tone != compressionYellow {
		t.Fatalf("tone=%v, want yellow", v.Tone)
	}
	if math.Abs(v.InputFraction-1000.0/2037.0) > 1e-6 {
		t.Fatalf("input fraction=%f", v.InputFraction)
	}
}

func TestCompressionVisualSmallGrowthIsYellow(t *testing.T) {
	v := compressionVisualFor(2*1024*1024, 14*1024*1024)
	if v.Tone != compressionYellow {
		t.Fatalf("tone=%v, want yellow", v.Tone)
	}
}

func TestCompressionVisualGreenAndRed(t *testing.T) {
	if v := compressionVisualFor(100, 40); v.Tone != compressionGreen || v.Intensity <= 0 {
		t.Fatalf("green visual=%+v", v)
	}
	if v := compressionVisualFor(10*1024*1024, 26*1024*1024); v.Tone != compressionRed || v.Intensity <= 0 {
		t.Fatalf("red visual=%+v", v)
	}
}

func TestRememberRecentDirectory(t *testing.T) {
	got := rememberRecentDirectory(`D:\\Output`, []string{`d:\\output\\`, `E:\\Media`, `F:\\Archive`}, 3)
	want := []string{`D:\\Output`, `E:\\Media`, `F:\\Archive`}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got=%q want=%q", got, want)
	}
}

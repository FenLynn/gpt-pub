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

func TestToolbarDefaultIsTransparentAndHoverIsVisible(t *testing.T) {
	base := toolbarSurfaceTreatment(controlVisualState{})
	if base.Fill || !base.Border || base.Strength != 1 {
		t.Fatalf("default treatment=%+v", base)
	}
	hover := toolbarSurfaceTreatment(controlVisualState{Hovered: true})
	if !hover.Fill || !hover.Border || hover.Strength <= base.Strength {
		t.Fatalf("hover treatment=%+v base=%+v", hover, base)
	}
	active := toolbarSurfaceTreatment(controlVisualState{Active: true})
	if !active.Fill || !active.Accent || active.Strength < 2 {
		t.Fatalf("active treatment=%+v", active)
	}
}

func TestSecondaryDefaultIsTransparent(t *testing.T) {
	base := secondarySurfaceTreatment(controlVisualState{})
	if base.Fill || !base.Border || base.Strength != 1 {
		t.Fatalf("default treatment=%+v", base)
	}
	pressed := secondarySurfaceTreatment(controlVisualState{Pressed: true})
	if !pressed.Fill || pressed.Strength < 3 {
		t.Fatalf("pressed treatment=%+v", pressed)
	}
}

func TestBottomParameterWidthsArePurposeSized(t *testing.T) {
	w := bottomParameterWidths()
	if w.Resolution >= w.Volume || w.Quality <= 68 || w.Codec >= w.Rotation {
		t.Fatalf("unexpected widths=%+v", w)
	}
	if w.Volume > 132 || w.Rotation > 104 || w.Resolution > 88 {
		t.Fatalf("controls remain over-wide: %+v", w)
	}
}

func TestListCellBarUsesFullWidthWithFivePixelVerticalInset(t *testing.T) {
	insets := listCellBarInsets()
	if insets.Horizontal > 1 || insets.Vertical != 5 || insets.MinimumHeight != 14 {
		t.Fatalf("unexpected insets=%+v", insets)
	}
}

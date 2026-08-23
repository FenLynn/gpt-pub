package main

import (
	"math"
	"reflect"
	"testing"

	"mediaworkbench/internal/model"
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

func TestRememberRecentSearch(t *testing.T) {
	previous := []string{"片名", "  路径  ", "片名", "失败", "完成"}
	got := rememberRecentSearch("  路径  ", previous, 3)
	want := []string{"路径", "片名", "失败"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("rememberRecentSearch()=%v, want %v", got, want)
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
	video := bottomParameterWidths(model.KindVideo)
	image := bottomParameterWidths(model.KindImage)
	if video.Resolution >= video.Volume || video.Quality <= 68 || video.Codec >= video.Rotation {
		t.Fatalf("unexpected video widths=%+v", video)
	}
	if image.Resolution <= video.Resolution || image.Resolution <= image.Volume || image.Codec >= video.Codec || image.Quality >= video.Quality || image.Volume >= video.Volume {
		t.Fatalf("image controls are not purpose-sized: video=%+v image=%+v", video, image)
	}
	if image.Resolution < 116 || image.Volume > 88 || image.Quality > 62 {
		t.Fatalf("image bottom widths remain unbalanced: %+v", image)
	}
}

func TestListCellBarUsesFullWidthWithFivePixelVerticalInset(t *testing.T) {
	insets := listCellBarInsets()
	if insets.Horizontal > 1 || insets.Vertical != 2 || insets.MinimumHeight != 20 {
		t.Fatalf("unexpected insets=%+v", insets)
	}
}

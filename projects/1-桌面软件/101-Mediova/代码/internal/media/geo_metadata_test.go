package media

import (
	"math"
	"testing"
)

func TestParseISO6709AppleQuickTime(t *testing.T) {
	location, ok := ParseISO6709("+36.1741+120.3865+022.970/")
	if !ok || location == nil {
		t.Fatal("Apple ISO 6709 coordinate was not parsed")
	}
	if math.Abs(location.Latitude-36.1741) > 0.000001 ||
		math.Abs(location.Longitude-120.3865) > 0.000001 {
		t.Fatalf("unexpected coordinates: %+v", location)
	}
	if !location.HasAltitude || math.Abs(location.Altitude-22.970) > 0.000001 {
		t.Fatalf("unexpected altitude: %+v", location)
	}
	if location.Raw != "+36.1741+120.3865+022.970/" {
		t.Fatalf("raw coordinate was not retained: %q", location.Raw)
	}
}

func TestParseISO6709RejectsInvalidCoordinates(t *testing.T) {
	for _, raw := range []string{"", "36.1,120.2", "+91.0+120.0/", "+36.0+181.0/"} {
		if _, ok := ParseISO6709(raw); ok {
			t.Fatalf("invalid ISO 6709 coordinate accepted: %q", raw)
		}
	}
}

func TestLocationFromQuickTimeTagsKeepsAccuracyAndCaptureTime(t *testing.T) {
	location, capture := locationFromTags(map[string]string{
		"com.apple.quicktime.location.ISO6709":             "+36.1741+120.3865+022.970/",
		"com.apple.quicktime.location.accuracy.horizontal": "18.467719",
		"creation_time": "2026-03-22T15:18:27Z",
	})
	if location == nil || math.Abs(location.Accuracy-18.467719) > 0.000001 {
		t.Fatalf("accuracy was not parsed: %+v", location)
	}
	if capture != "2026-03-22T15:18:27Z" {
		t.Fatalf("capture time=%q", capture)
	}
}

func TestPlaceSummaryDistinguishesDescriptionFromCoordinates(t *testing.T) {
	got := placeSummary("五四广场", "青岛市", "山东省", "中国", "青岛市", "36.0671, 120.3826")
	if got != "五四广场 · 青岛市 · 山东省 · 中国" {
		t.Fatalf("place summary=%q", got)
	}
}

func TestLocationFromQuickTimeTagsKeepsPlaceName(t *testing.T) {
	location, _ := locationFromTags(map[string]string{
		"com.apple.quicktime.location.iso6709": "+36.0671+120.3826/",
		"com.apple.quicktime.location.name":    "五四广场",
	})
	if location == nil || location.Place != "五四广场" || location.PlaceSource != "embedded" {
		t.Fatalf("place metadata was not retained: %+v", location)
	}
}

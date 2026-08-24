//go:build windows

package main

import (
	"fmt"
	"testing"

	"mediaworkbench/internal/model"
)

func TestReverseGeocodeCacheKeyDeduplicatesNearbyCoordinates(t *testing.T) {
	first := reverseGeocodeCacheKey(36.123451, 120.987651)
	second := reverseGeocodeCacheKey(36.123452, 120.987652)
	if first != second {
		t.Fatalf("nearby coordinates were not deduplicated: %q != %q", first, second)
	}
}

func TestReversePlaceSummaryUsesAdministrativeOrderAndDeduplicates(t *testing.T) {
	got := reversePlaceSummary(nominatimReverseResponse{Address: map[string]string{
		"country": "中国",
		"state":   "山东省",
		"city":    "青岛市",
		"county":  "青岛市",
		"suburb":  "市南区",
		"road":    "澳门路",
	}})
	want := "中国 · 山东省 · 青岛市 · 市南区 · 澳门路"
	if got != want {
		t.Fatalf("summary=%q, want %q", got, want)
	}
}

func TestReverseGeocodeJobsDeduplicateAndSkipExistingPlaces(t *testing.T) {
	app := &application{currentKind: model.KindImage, tasks: []*model.Task{
		{ID: 1, Kind: model.KindImage, Location: &model.GeoLocation{Latitude: 36.123451, Longitude: 120.987651}},
		{ID: 2, Kind: model.KindImage, Location: &model.GeoLocation{Latitude: 36.123452, Longitude: 120.987652}},
		{ID: 3, Kind: model.KindImage, Location: &model.GeoLocation{Latitude: 35, Longitude: 119, Place: "已有地名"}},
		{ID: 4, Kind: model.KindVideo, Location: &model.GeoLocation{Latitude: 34, Longitude: 118}},
	}}
	jobs := app.reverseGeocodeJobs(nil, true)
	if len(jobs) != 1 {
		t.Fatalf("jobs=%d, want 1: %+v", len(jobs), jobs)
	}
	if len(jobs[0].taskIDs) != 2 {
		t.Fatalf("deduplicated job task IDs=%v, want two", jobs[0].taskIDs)
	}
}

func TestReverseGeocodeCachePrunesOldestEntries(t *testing.T) {
	manager := &reverseGeocodeManager{entries: map[string]reverseGeocodeCacheEntry{}}
	for index := 0; index < reverseGeocodeMaxEntries+3; index++ {
		manager.entries[fmt.Sprintf("%05d", index)] = reverseGeocodeCacheEntry{Place: "地点", LastUsed: int64(index)}
	}
	manager.pruneLocked()
	if len(manager.entries) != reverseGeocodeMaxEntries {
		t.Fatalf("entries=%d, want %d", len(manager.entries), reverseGeocodeMaxEntries)
	}
	for _, key := range []string{"00000", "00001", "00002"} {
		if _, exists := manager.entries[key]; exists {
			t.Fatalf("old cache entry %s was not pruned", key)
		}
	}
}

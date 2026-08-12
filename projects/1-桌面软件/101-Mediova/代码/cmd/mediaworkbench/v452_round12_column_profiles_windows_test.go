//go:build windows

package main

import (
	"encoding/json"
	"testing"
)

func TestRound12NormalizeProfileRepairsCollapsedEssentialWidths(t *testing.T) {
	profile := round12DefaultProfile()
	profile.Widths[round12ColNumber] = 73
	profile.Widths[round12ColPreview] = 40
	profile.Widths[round12ColFile] = 120
	profile.Widths[round12ColStatus] = 72

	normalized := round12NormalizeProfile(profile)
	if got, want := normalized.Widths[round12ColNumber], round12Columns[round12ColNumber].width; got != want {
		t.Fatalf("number width=%d want=%d", got, want)
	}
	if got, want := normalized.Widths[round12ColPreview], round12Columns[round12ColPreview].width; got != want {
		t.Fatalf("preview width=%d want=%d", got, want)
	}
	if got, want := normalized.Widths[round12ColFile], round12Columns[round12ColFile].width; got != want {
		t.Fatalf("file width=%d want=%d", got, want)
	}
	if got, want := normalized.Widths[round12ColStatus], round12Columns[round12ColStatus].width; got != want {
		t.Fatalf("status width=%d want=%d", got, want)
	}
}

func TestRound12NormalizeProfileKeepsUsefulCustomWidths(t *testing.T) {
	profile := round12DefaultProfile()
	profile.Widths[round12ColPreview] = 128
	profile.Widths[round12ColFile] = 310
	profile.Widths[round12ColStatus] = 96

	normalized := round12NormalizeProfile(profile)
	for column, want := range map[int]int{
		round12ColPreview: 128,
		round12ColFile:    310,
		round12ColStatus:  96,
	} {
		if got := normalized.Widths[column]; got != want {
			t.Fatalf("column %d width=%d want=%d", column, got, want)
		}
	}
}

func TestRound12DecodeStoredProfilesMigratesVersion1(t *testing.T) {
	legacy := round12ColumnProfiles{
		Version: 1,
		Video:   round12DefaultProfile(),
		Image:   round12DefaultProfile(),
	}
	legacy.Video.Widths[round12ColPreview] = 40
	legacy.Video.Widths[round12ColFile] = 120
	legacy.Video.Widths[round12ColStatus] = 88
	data, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}

	profiles, accepted, migrated := round12DecodeStoredProfiles(data)
	if !accepted || !migrated {
		t.Fatalf("accepted=%v migrated=%v", accepted, migrated)
	}
	if profiles.Version != round12ColumnProfileVersion {
		t.Fatalf("version=%d want=%d", profiles.Version, round12ColumnProfileVersion)
	}
	for _, column := range []int{round12ColPreview, round12ColFile} {
		if got, want := profiles.Video.Widths[column], round12Columns[column].width; got != want {
			t.Fatalf("column %d migrated width=%d want=%d", column, got, want)
		}
	}
	if got := profiles.Video.Widths[round12ColStatus]; got != 88 {
		t.Fatalf("valid status width should survive migration, got=%d", got)
	}
}

func TestRound12DecodeStoredProfilesRejectsUnknownVersion(t *testing.T) {
	data := []byte(`{"version":99,"video":{"widths":[],"visible":[]},"image":{"widths":[],"visible":[]}}`)
	_, accepted, migrated := round12DecodeStoredProfiles(data)
	if accepted || migrated {
		t.Fatalf("accepted=%v migrated=%v", accepted, migrated)
	}
}

//go:build windows

package main

import (
	"path/filepath"
	"strings"
	"testing"

	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

func TestV455PathInFolderBoundary(t *testing.T) {
	root := filepath.Join("C:\\", "media", "trip")
	if !v455PathInFolder(filepath.Join(root, "a.mp4"), root, false) {
		t.Fatal("exact folder should match")
	}
	if v455PathInFolder(filepath.Join(root, "day1", "a.mp4"), root, false) {
		t.Fatal("child should not match without include")
	}
	if !v455PathInFolder(filepath.Join(root, "day1", "a.mp4"), root, true) {
		t.Fatal("child should match with include")
	}
	if v455PathInFolder(filepath.Join("C:\\", "media", "trip-old", "a.mp4"), root, true) {
		t.Fatal("sibling prefix must not match")
	}
}

func TestV455HistoryAndSpecialFilters(t *testing.T) {
	path := filepath.Join("C:\\", "media", "a.mp4")
	record := media.HistoryRecord{Input: path, InputSize: 123, Status: model.StatusDone}
	if !v455HistoryMatches(record, strings.ToUpper(path), 123) {
		t.Fatal("same Windows path and size should match")
	}
	if v455HistoryMatches(record, path, 124) {
		t.Fatal("changed source size must not match old conversion")
	}
	duplicate := &model.Task{DuplicateOf: "other.mp4"}
	if !v455TaskMatchesSpecialFilter(duplicate, "duplicate") || v455TaskMatchesSpecialFilter(duplicate, "converted") {
		t.Fatal("special recognition filters are inconsistent")
	}
}

func TestV455ImportOverviewText(t *testing.T) {
	text := (v455ImportOverview{Video: 2, Image: 3, Folders: 4, SuspectedDuplicates: 1, PreviouslyConverted: 2}).text()
	for _, want := range []string{"视频 2", "图片 3", "目录 4", "疑似重复 1", "此前已转换 2"} {
		if !strings.Contains(text, want) {
			t.Fatalf("overview missing %q: %s", want, text)
		}
	}
}

package main

import (
	"path/filepath"
	"reflect"
	"testing"

	"mediaworkbench/internal/model"
)

func TestV452ColumnMigrationPrependsNumberWithoutShiftingLegacyValues(t *testing.T) {
	current := []int{280, 100, 76, 70, 116, 58, 90, 92, 140, 105, 124}
	got := v452NormalizedColumnWidths(current)
	want := append([]int{48}, current...)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("current migration=%v want=%v", got, want)
	}

	legacy := []int{280, 100, 70, 116, 58, 90, 92, 140, 105, 124}
	got = v452NormalizedColumnWidths(legacy)
	want = []int{48, 280, 100, 76, 70, 116, 58, 90, 92, 140, 105, 124}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("legacy migration=%v want=%v", got, want)
	}
}

func TestV452ColumnNumberCanRemainNarrow(t *testing.T) {
	widths := v452NormalizedColumnWidths([]int{36, 300, 100, 76, 70, 116, 58, 90, 92, 140, 105, 124})
	if widths[taskColNumber] != 36 {
		t.Fatalf("number width=%d want=36", widths[taskColNumber])
	}
	if len(widths) != taskColumnCount {
		t.Fatalf("columns=%d want=%d", len(widths), taskColumnCount)
	}
}

func TestV452DirectoryResolverUsesLastSelectedThenLastTask(t *testing.T) {
	tasks := []*model.Task{
		{ID: 1, Kind: model.KindVideo, Input: filepath.Join("D:", "A", "one.mp4"), OutputPath: filepath.Join("Z:", "outA", "one.mp4")},
		{ID: 2, Kind: model.KindVideo, Input: filepath.Join("D:", "B", "two.mp4"), Queue: &model.QueueSnapshot{OutputRoot: filepath.Join("Z:", "queued")}},
		{ID: 3, Kind: model.KindImage, Input: filepath.Join("E:", "Images", "three.jpg")},
	}
	if got := v452ResolveTaskDirectory(tasks, map[int64]bool{1: true, 2: true}, model.KindVideo, false, directoryFallback{}); got != filepath.Join("D:", "B") {
		t.Fatalf("selected source=%q", got)
	}
	if got := v452ResolveTaskDirectory(tasks, map[int64]bool{1: true, 2: true}, model.KindVideo, true, directoryFallback{}); got != filepath.Join("Z:", "queued") {
		t.Fatalf("selected output=%q", got)
	}
	if got := v452ResolveTaskDirectory(tasks, nil, model.KindVideo, false, directoryFallback{}); got != filepath.Join("D:", "B") {
		t.Fatalf("last source=%q", got)
	}
}

func TestV452DirectoryResolverFallsBackToRecentSettings(t *testing.T) {
	fallback := directoryFallback{
		LastInputDir:       filepath.Join("D:", "last-video"),
		LastImageInputDir:  filepath.Join("E:", "last-image"),
		LastOutputDir:      filepath.Join("Z:", "last-video-out"),
		LastImageOutputDir: filepath.Join("Z:", "last-image-out"),
		OutputDir:          filepath.Join("Z:", "video-default"),
		ImageOutputDir:     filepath.Join("Z:", "image-default"),
	}
	if got := v452ResolveTaskDirectory(nil, nil, model.KindImage, false, fallback); got != fallback.LastImageInputDir {
		t.Fatalf("image source fallback=%q", got)
	}
	if got := v452ResolveTaskDirectory(nil, nil, model.KindImage, true, fallback); got != fallback.LastImageOutputDir {
		t.Fatalf("image output fallback=%q", got)
	}
	if got := v452ResolveTaskDirectory(nil, nil, model.KindVideo, true, fallback); got != fallback.LastOutputDir {
		t.Fatalf("video output fallback=%q", got)
	}
}

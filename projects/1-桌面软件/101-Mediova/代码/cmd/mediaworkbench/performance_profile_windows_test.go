//go:build windows

package main

import (
	"testing"

	"mediaworkbench/internal/model"
)

func TestPerformanceProfilesBoundHeavyWork(t *testing.T) {
	cases := []struct {
		mode    string
		kind    model.Kind
		workers int
		want    int
	}{
		{"", model.KindVideo, 12, 12},
		{model.PerformanceModeStandard, model.KindImage, 8, 8},
		{model.PerformanceModeLargeBatch, model.KindVideo, 12, 12},
		{model.PerformanceModeLargeBatch, model.KindImage, 8, 4},
		{model.PerformanceModeLowMemory, model.KindVideo, 12, 2},
		{model.PerformanceModeLowMemory, model.KindImage, 8, 2},
	}
	for _, tc := range cases {
		if got := performanceWorkerCap(tc.mode, tc.kind, tc.workers); got != tc.want {
			t.Fatalf("mode=%q kind=%q workers=%d got=%d want=%d", tc.mode, tc.kind, tc.workers, got, tc.want)
		}
	}
}

func TestPerformanceProfilesLimitOnlyEagerOffscreenThumbnails(t *testing.T) {
	if got := performanceThumbnailEagerLimit(""); got != 600 {
		t.Fatalf("legacy/default limit=%d", got)
	}
	if got := performanceThumbnailEagerLimit(model.PerformanceModeLargeBatch); got != 128 {
		t.Fatalf("batch limit=%d", got)
	}
	if got := performanceThumbnailEagerLimit(model.PerformanceModeLowMemory); got != 48 {
		t.Fatalf("low-memory limit=%d", got)
	}
	if got := model.NormalizePerformanceMode("future-or-invalid"); got != model.PerformanceModeStandard {
		t.Fatalf("invalid profile normalized to %q", got)
	}
}

func TestLowMemoryModeRestoresUserConcurrency(t *testing.T) {
	a := &application{settings: model.DefaultSettings()}
	a.settings.AutoConcurrency = false
	a.settings.Concurrency = 5
	a.applyPerformanceMode(model.PerformanceModeLowMemory)
	if a.settings.AutoConcurrency || a.settings.Concurrency != 2 || !a.settings.PerfOverrideSet {
		t.Fatalf("low-memory mode did not enforce safe slots: %+v", a.settings)
	}
	a.applyPerformanceMode(model.PerformanceModeStandard)
	if a.settings.AutoConcurrency || a.settings.Concurrency != 5 || a.settings.PerfOverrideSet {
		t.Fatalf("user concurrency was not restored: %+v", a.settings)
	}
}

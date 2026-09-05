//go:build windows

package main

import (
	"testing"

	"mediaworkbench/internal/model"
)

func TestTaskVolumeFilterBoundaries(t *testing.T) {
	cases := []struct {
		name       string
		input, out int64
		want       string
	}{
		{"larger at upper boundary", 100, 110, volumeFilterLarger},
		{"smaller at lower boundary", 100, 90, volumeFilterSmaller},
		{"unchanged midpoint", 100, 100, volumeFilterUnchanged},
		{"unknown without output", 100, 0, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			task := &model.Task{InputSize: tc.input, OutputSize: tc.out, Status: model.StatusDone}
			if got := taskVolumeFilter(task); got != tc.want {
				t.Fatalf("taskVolumeFilter(%d,%d)=%q want %q", tc.input, tc.out, got, tc.want)
			}
			if tc.want != "" && !taskMatchesStatusFilter(task, tc.want) {
				t.Fatalf("task did not match its volume filter %q", tc.want)
			}
		})
	}
}

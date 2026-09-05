//go:build windows

package main

import (
	"os"
	"strings"
	"testing"
)

func TestMapSelectionUsesIncrementalBridge(t *testing.T) {
	runtimeSource, err := os.ReadFile("map_runtime_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	mainSource, err := os.ReadFile("main_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"window.mediovaSelection=function", "func (r *mapRuntime) pushSelection()", "r.pushSelection()"} {
		if !strings.Contains(string(runtimeSource), want) {
			t.Fatalf("map runtime missing %q", want)
		}
	}
	selectionCase := string(mainSource)
	start := strings.Index(selectionCase, "case WM_APP_SELECTION:")
	if start < 0 {
		t.Fatal("selection message branch not found")
	}
	end := strings.Index(selectionCase[start:], "case WM_APP_KIND_SYNC:")
	if end < 0 {
		t.Fatal("selection message branch not found")
	}
	branch := selectionCase[start : start+end]
	if !strings.Contains(branch, "runtime.pushSelection()") || strings.Contains(branch, "invalidateMapView()") {
		t.Fatalf("selection branch still performs a full map refresh: %s", branch)
	}
}

package main

import (
	"os"
	"strings"
	"testing"
)

func TestV452UIBootstrapDoesNotUseBackgroundPolling(t *testing.T) {
	data, err := os.ReadFile("v452_ui_state_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	for _, forbidden := range []string{
		"go func(",
		"time.NewTicker(",
		"time.Tick(",
		"for {\n\t\ttime.Sleep",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("Windows UI bootstrap must stay on the UI thread; found %q", forbidden)
		}
	}
	for _, required := range []string{
		"v452FinalizeInitialToolbar",
		"RDW_ALLCHILDREN|RDW_UPDATENOW",
		"v452DrawSolidPrimaryGlyph",
		"v452DrawTrueStatusLamp",
		"v452ClearComboSelection",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("missing v4.5.2 UI contract %q", required)
		}
	}
}

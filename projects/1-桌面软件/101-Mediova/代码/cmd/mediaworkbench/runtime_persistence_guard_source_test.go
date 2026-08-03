package main

import (
	"os"
	"strings"
	"testing"
)

func TestRuntimePersistenceGuardWindowsSourceContract(t *testing.T) {
	content, err := os.ReadFile("runtime_persistence_guard_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(content)
	for _, required := range []string{
		"syscall.NewCallback(runtimePersistenceTimerProc)",
		"procSetTimer.Call",
		"workflow.SaveSessionAtomic",
		"media.AppendHistory",
		"config.Save(settings)",
		"setText(current.hStatusText, text)",
		"runtimePersistenceIntervalMS",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("missing runtime persistence contract %q", required)
		}
	}
	for _, forbidden := range []string{
		"go func",
		"time.NewTicker",
		"for current := app",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("runtime persistence guard contains forbidden polling pattern %q", forbidden)
		}
	}
}

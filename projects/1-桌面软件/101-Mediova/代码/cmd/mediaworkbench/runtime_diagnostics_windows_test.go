//go:build windows

package main

import (
	"os"
	"strings"
	"testing"
	"time"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/model"
)

func TestRecoverableErrorsCannotOverwriteCrashEvidence(t *testing.T) {
	root := t.TempDir()
	t.Setenv("APPDATA", root)
	t.Setenv("LOCALAPPDATA", root)

	writeRuntimeError("thumbnail fallback", "expected decode miss")
	if crashPath, err := config.CrashPath(); err != nil {
		t.Fatal(err)
	} else if _, err := os.Stat(crashPath); !os.IsNotExist(err) {
		t.Fatalf("recoverable error unexpectedly created crash.log: %v", err)
	}

	writeRuntimeIncident("panic", "worker task 42", "boom", []byte("test stack"))
	crashPath, err := config.CrashPath()
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(crashPath)
	if err != nil {
		t.Fatal(err)
	}
	writeRuntimeError("thumbnail retry", "still recoverable")
	after, err := os.ReadFile(crashPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("recoverable error overwrote serious crash evidence")
	}
	incidentPath, err := runtimeIncidentPath()
	if err != nil {
		t.Fatal(err)
	}
	incidents, err := os.ReadFile(incidentPath)
	if err != nil {
		t.Fatal(err)
	}
	text := string(incidents)
	for _, want := range []string{"recoverable_error", "panic", "worker task 42", "thumbnail retry"} {
		if !strings.Contains(text, want) {
			t.Fatalf("incidents.log missing %q", want)
		}
	}
}

func TestRuntimeMemoryWorkerCapProtectsLargeImageBatches(t *testing.T) {
	const gib = uint64(1024 * 1024 * 1024)
	cases := []struct {
		name   string
		status runtimeMemoryStatus
		want   int
	}{
		{"healthy", runtimeMemoryStatus{MemoryLoad: 45, AvailablePhysical: 8 * gib, AvailablePageFile: 10 * gib}, 6},
		{"image pressure", runtimeMemoryStatus{MemoryLoad: 80, AvailablePhysical: 3 * gib, AvailablePageFile: 5 * gib}, 3},
		{"high pressure", runtimeMemoryStatus{MemoryLoad: 87, AvailablePhysical: 2 * gib, AvailablePageFile: 3 * gib}, 2},
		{"critical", runtimeMemoryStatus{MemoryLoad: 94, AvailablePhysical: gib / 2, AvailablePageFile: gib / 2}, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := runtimeMemoryWorkerCapForStatus(model.KindImage, 6, tc.status); got != tc.want {
				t.Fatalf("workers=%d want %d", got, tc.want)
			}
		})
	}
}

func TestRuntimeDiagnosticsReportsPreviousUncleanRun(t *testing.T) {
	root := t.TempDir()
	t.Setenv("APPDATA", root)
	t.Setenv("LOCALAPPDATA", root)
	previousApp := app
	app = nil
	defer func() { app = previousApp }()

	saveRuntimeHealth(runtimeHealthSnapshot{
		RunID: "interrupted-large-batch", Version: appVersion, PID: 1234,
		StartedAt: time.Now().Add(-time.Minute), UpdatedAt: time.Now(),
		CleanExit: false, ExitReason: "running", TaskCount: 700,
		TaskStates: map[string]int{"转换中": 3, "队列中": 697},
	})
	stop := startRuntimeDiagnostics(false)
	stop(true)

	path, err := runtimeIncidentPath()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if text := string(data); !strings.Contains(text, "unclean_exit") || !strings.Contains(text, "interrupted-large-batch") {
		t.Fatalf("previous unclean run was not recorded: %s", text)
	}
	current, err := readRuntimeHealth()
	if err != nil {
		t.Fatal(err)
	}
	if !current.CleanExit || current.ExitReason != "normal_exit" {
		t.Fatalf("current run was not closed cleanly: %+v", current)
	}
}

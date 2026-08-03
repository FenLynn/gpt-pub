package main

import (
	"os"
	"strings"
	"testing"
)

func TestV450RecoverySourceContracts(t *testing.T) {
	main, err := os.ReadFile("main_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	s := string(main)
	for _, want := range []string{"workflow.NewSessionEnvelope", "workflow.SaveSessionAtomic", "workflow.DecodeSession", "workflow.RecoverTasks", "saveSessionClean", `path + ".bak"`} {
		if !strings.Contains(s, want) {
			t.Fatalf("missing v4.5.0 recovery contract %q", want)
		}
	}
	if strings.Contains(s, "cp.Status = model.StatusReady") {
		t.Fatal("legacy save-time status rewriting returned")
	}
}

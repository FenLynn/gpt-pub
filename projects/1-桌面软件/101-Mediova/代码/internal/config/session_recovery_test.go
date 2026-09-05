package config

import (
	"os"
	"path/filepath"
	"testing"
)

const testSessionSnapshot = `{"schema":2,"version":"4.5.0","tasks":[]}`

func TestRestoreMissingSessionPrimaryPrefersValidTemp(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.json")
	if err := os.WriteFile(path+".tmp", []byte(testSessionSnapshot), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".bak", []byte(`{"schema":2,"version":"old","tasks":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	source, err := restoreMissingSessionPrimary(path)
	if err != nil || source != "tmp" {
		t.Fatalf("source=%q err=%v", source, err)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != testSessionSnapshot {
		t.Fatalf("primary=%q err=%v", data, err)
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Fatalf("completed temp snapshot remained: %v", err)
	}
}

func TestRestoreMissingSessionPrimaryUsesBackup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.json")
	if err := os.WriteFile(path+".bak", []byte(testSessionSnapshot), 0o644); err != nil {
		t.Fatal(err)
	}
	source, err := restoreMissingSessionPrimary(path)
	if err != nil || source != "backup" {
		t.Fatalf("source=%q err=%v", source, err)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != testSessionSnapshot {
		t.Fatalf("primary=%q err=%v", data, err)
	}
}

func TestRestoreMissingSessionPrimaryFallsBackFromInvalidTemp(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.json")
	if err := os.WriteFile(path+".tmp", []byte("partial"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".bak", []byte(testSessionSnapshot), 0o644); err != nil {
		t.Fatal(err)
	}
	source, err := restoreMissingSessionPrimary(path)
	if err != nil || source != "backup" {
		t.Fatalf("source=%q err=%v", source, err)
	}
}

func TestRestoreMissingSessionPrimaryNeverOverwritesPrimary(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.json")
	if err := os.WriteFile(path, []byte(`{"schema":2,"version":"primary","tasks":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".tmp", []byte(testSessionSnapshot), 0o644); err != nil {
		t.Fatal(err)
	}
	source, err := restoreMissingSessionPrimary(path)
	if err != nil || source != "" {
		t.Fatalf("source=%q err=%v", source, err)
	}
	data, _ := os.ReadFile(path)
	if string(data) != `{"schema":2,"version":"primary","tasks":[]}` {
		t.Fatalf("primary was overwritten: %s", data)
	}
}

func TestRestoreMissingSessionPrimaryLeavesNoFilesWhenAbsent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.json")
	source, err := restoreMissingSessionPrimary(path)
	if err != nil || source != "" {
		t.Fatalf("source=%q err=%v", source, err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("unexpected primary: %v", err)
	}
}

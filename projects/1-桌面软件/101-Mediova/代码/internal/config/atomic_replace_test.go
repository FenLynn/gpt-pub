package config

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReplaceAtomicFileReplacesExistingDestination(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	temp := filepath.Join(dir, ".replacement.tmp")
	if err := os.WriteFile(path, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(temp, []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := replaceAtomicFile(path, temp); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, []byte("new")) {
		t.Fatalf("destination=%q want new", got)
	}
	if _, err := os.Stat(temp); !os.IsNotExist(err) {
		t.Fatalf("temporary source still exists: %v", err)
	}
}

func TestAtomicWriteSourceKeepsPrimaryInPlaceUntilReplacement(t *testing.T) {
	content, err := os.ReadFile("config.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(content)
	for _, required := range []string{
		"replaceAtomicFile(path, tmpName)",
		"_ = os.Remove(path + \".bak\")",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("missing atomic write contract %q", required)
		}
	}
	for _, forbidden := range []string{
		"os.Rename(path, bak)",
		"os.Rename(bak, path)",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("unsafe pre-move atomic write pattern remains: %q", forbidden)
		}
	}
}

func TestWindowsAtomicReplacementSourceContract(t *testing.T) {
	content, err := os.ReadFile("atomic_replace_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(content)
	for _, required := range []string{
		"ReplaceFileW",
		"MoveFileExW",
		"replaceFileWriteThrough",
		"moveFileWriteThrough",
		"failed replacement leaves the existing",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("missing Windows atomic replacement contract %q", required)
		}
	}
	if strings.Contains(source, "os.Rename(path") {
		t.Fatal("Windows replacement must not move the destination before replacement")
	}
}

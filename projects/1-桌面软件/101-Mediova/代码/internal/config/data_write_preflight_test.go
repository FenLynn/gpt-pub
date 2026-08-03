package config

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInspectDataDirectoryAccessWritableWithoutBusinessFiles(t *testing.T) {
	dir := t.TempDir()
	access := InspectDataDirectoryAccess(dir)
	if !access.Writable || access.Err != nil || access.Target != filepath.Clean(dir) {
		t.Fatalf("unexpected access: %+v", access)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("write probe left files behind: %v", entries)
	}
	if notice := DataDirectoryAccessNotice(access); notice != "" {
		t.Fatalf("writable directory produced notice: %q", notice)
	}
}

func TestInspectDataDirectoryAccessDoesNotCreateMissingDirectory(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "missing", "Mediova")
	access := InspectDataDirectoryAccess(dir)
	if access.Writable || access.Err == nil {
		t.Fatalf("missing directory accepted: %+v", access)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("preflight created missing directory: %v", err)
	}
}

func TestInspectDataDirectoryAccessDetectsFileBlocker(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "Mediova")
	want := []byte("do-not-touch")
	if err := os.WriteFile(path, want, 0o644); err != nil {
		t.Fatal(err)
	}

	access := InspectDataDirectoryAccess(path)
	if access.Writable || access.Err == nil || !strings.Contains(access.Err.Error(), "occupied by a file") {
		t.Fatalf("file blocker accepted: %+v", access)
	}
	notice := DataDirectoryAccessNotice(access)
	if !strings.Contains(notice, "数据目录当前不可写") || !strings.Contains(notice, "配置、任务会话和历史记录") {
		t.Fatalf("unexpected notice: %q", notice)
	}
	got, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("blocker changed=%q err=%v", got, err)
	}
}

func TestInspectDataDirectoryAccessPreservesExistingFiles(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")
	want := []byte(`{"output_dir":"D:\\output"}`)
	if err := os.WriteFile(configPath, want, 0o644); err != nil {
		t.Fatal(err)
	}

	access := InspectDataDirectoryAccess(dir)
	if !access.Writable || access.Err != nil {
		t.Fatalf("unexpected access: %+v", access)
	}
	got, err := os.ReadFile(configPath)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("config changed=%q err=%v", got, err)
	}
}

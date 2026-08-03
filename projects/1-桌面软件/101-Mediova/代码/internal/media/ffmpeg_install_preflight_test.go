package media

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFFmpegImportFixture(t *testing.T, path string) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for _, name := range []string{
		"ffmpeg-release/bin/ffmpeg.exe",
		"ffmpeg-release/bin/ffprobe.exe",
	} {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(name)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestInstallFFmpegZipReportsBlockedRuntimeWithoutDamage(t *testing.T) {
	root := t.TempDir()
	runtimeDir := filepath.Join(root, "Runtime")
	if err := os.MkdirAll(runtimeDir, 0o755); err != nil {
		t.Fatal(err)
	}
	blocker := filepath.Join(runtimeDir, "Components")
	if err := os.WriteFile(blocker, []byte("keep-me"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MEDIOVA_RUNTIME_DIR", runtimeDir)

	zipPath := filepath.Join(root, "ffmpeg.zip")
	writeFFmpegImportFixture(t, zipPath)
	_, _, err := InstallFFmpegZip(zipPath)
	if err == nil || !strings.Contains(err.Error(), "Runtime 组件目录不可写") || !strings.Contains(err.Error(), "FFmpeg 菜单") {
		t.Fatalf("unexpected error: %v", err)
	}
	got, readErr := os.ReadFile(blocker)
	if readErr != nil || string(got) != "keep-me" {
		t.Fatalf("blocked Runtime was modified: %q %v", got, readErr)
	}
}

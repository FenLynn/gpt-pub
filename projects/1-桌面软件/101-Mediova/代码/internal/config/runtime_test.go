package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRuntimeComponentMigrationIsCopyOnly(t *testing.T) {
	root := t.TempDir()
	runtimeDir := filepath.Join(root, "Runtime")
	legacyDir := filepath.Join(root, "Legacy", "bin")
	if err := os.MkdirAll(legacyDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"ffmpeg.exe", "ffprobe.exe", "avcodec.dll"} {
		if err := os.WriteFile(filepath.Join(legacyDir, name), []byte("legacy-"+name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("MEDIOVA_RUNTIME_DIR", runtimeDir)
	t.Setenv("MEDIOVA_LEGACY_FFMPEG_DIR", legacyDir)
	migrated, err := MigrateLegacyRuntimeComponents()
	if err != nil || !migrated {
		t.Fatalf("migrated=%v err=%v", migrated, err)
	}
	bin, _ := RuntimeFFmpegBinDir()
	if !ffmpegPairExists(bin) {
		t.Fatal("runtime pair missing")
	}
	if _, err := os.Stat(filepath.Join(legacyDir, "ffmpeg.exe")); err != nil {
		t.Fatalf("legacy component was removed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(bin, "ffmpeg.exe"), []byte("runtime-new"), 0o755); err != nil {
		t.Fatal(err)
	}
	migrated, err = MigrateLegacyRuntimeComponents()
	if err != nil || migrated {
		t.Fatalf("second migration=%v err=%v", migrated, err)
	}
	got, _ := os.ReadFile(filepath.Join(bin, "ffmpeg.exe"))
	if string(got) != "runtime-new" {
		t.Fatalf("runtime file overwritten: %q", got)
	}
}

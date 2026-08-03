package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mediaworkbench/internal/model"
)

func writeComponentFile(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("component"), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestNormalizeInheritedFFmpegDirectory(t *testing.T) {
	dir := t.TempDir()
	writeComponentFile(t, filepath.Join(dir, "ffmpeg.exe"))
	writeComponentFile(t, filepath.Join(dir, "ffprobe.exe"))
	got, valid, rewrite := normalizeInheritedFFmpegPath(dir)
	if !valid || !rewrite || got != filepath.Join(dir, "ffmpeg.exe") {
		t.Fatalf("got=%q valid=%v rewrite=%v", got, valid, rewrite)
	}
}

func TestNormalizeInheritedFFmpegBinDirectory(t *testing.T) {
	root := t.TempDir()
	bin := filepath.Join(root, "bin")
	writeComponentFile(t, filepath.Join(bin, "ffmpeg.exe"))
	writeComponentFile(t, filepath.Join(bin, "ffprobe.exe"))
	got, valid, rewrite := normalizeInheritedFFmpegPath(root)
	if !valid || !rewrite || got != filepath.Join(bin, "ffmpeg.exe") {
		t.Fatalf("got=%q valid=%v rewrite=%v", got, valid, rewrite)
	}
}

func TestNormalizeInheritedFFprobePath(t *testing.T) {
	dir := t.TempDir()
	ffmpeg := filepath.Join(dir, "ffmpeg.exe")
	ffprobe := filepath.Join(dir, "ffprobe.exe")
	writeComponentFile(t, ffmpeg)
	writeComponentFile(t, ffprobe)
	got, valid, rewrite := normalizeInheritedFFmpegPath(ffprobe)
	if !valid || !rewrite || got != ffmpeg {
		t.Fatalf("got=%q valid=%v rewrite=%v", got, valid, rewrite)
	}
}

func TestNormalizeInheritedInvalidFFmpegPreservesAuthority(t *testing.T) {
	original := filepath.Join(t.TempDir(), "missing", "ffmpeg.exe")
	got, valid, rewrite := normalizeInheritedFFmpegPath(original)
	if valid || rewrite || got != original {
		t.Fatalf("got=%q valid=%v rewrite=%v", got, valid, rewrite)
	}
	settings := model.DefaultSettings()
	settings.FFmpegPath = original
	changed, notices := NormalizeInheritedComponentSettings(&settings)
	if changed || settings.FFmpegPath != original || len(notices) != 1 || !strings.Contains(notices[0], "已保留设置") {
		t.Fatalf("changed=%v path=%q notices=%v", changed, settings.FFmpegPath, notices)
	}
}

func TestNormalizeInheritedPlayerDirectory(t *testing.T) {
	dir := t.TempDir()
	player := filepath.Join(dir, "PotPlayerMini64.exe")
	writeComponentFile(t, player)
	got, valid, rewrite := normalizeInheritedPlayerPath(dir)
	if !valid || !rewrite || got != player {
		t.Fatalf("got=%q valid=%v rewrite=%v", got, valid, rewrite)
	}
}

func TestNormalizeInheritedComponentSettingsMixed(t *testing.T) {
	ffdir := filepath.Join(t.TempDir(), "ff")
	playerDir := filepath.Join(t.TempDir(), "player")
	writeComponentFile(t, filepath.Join(ffdir, "ffmpeg.exe"))
	writeComponentFile(t, filepath.Join(ffdir, "ffprobe.exe"))
	writeComponentFile(t, filepath.Join(playerDir, "PotPlayerMini.exe"))

	settings := model.DefaultSettings()
	settings.FFmpegPath = ffdir
	settings.PlayerPath = playerDir
	changed, notices := NormalizeInheritedComponentSettings(&settings)
	if !changed || settings.FFmpegPath != filepath.Join(ffdir, "ffmpeg.exe") || settings.PlayerPath != filepath.Join(playerDir, "PotPlayerMini.exe") {
		t.Fatalf("changed=%v settings=%+v", changed, settings)
	}
	if len(notices) != 2 {
		t.Fatalf("notices=%v", notices)
	}
}

func TestNormalizeInheritedComponentSettingsEmpty(t *testing.T) {
	settings := model.DefaultSettings()
	changed, notices := NormalizeInheritedComponentSettings(&settings)
	if changed || len(notices) != 0 {
		t.Fatalf("changed=%v notices=%v", changed, notices)
	}
}

package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"mediaworkbench/internal/model"
)

func TestLoadJSONFallsBackToBackup(t *testing.T) {
	d := t.TempDir()
	path := filepath.Join(d, "session.json")
	want := []model.Task{{ID: 7, Input: "a.mp4", Status: model.StatusReady}}
	if err := SaveJSON(path, want); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".bak", b, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("{broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	var got []model.Task
	if err := LoadJSON(path, &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != 7 || got[0].Input != "a.mp4" {
		t.Fatalf("unexpected backup payload: %+v", got)
	}
}

func TestLoadFallsBackToValidBackupWhenPrimaryIsCorrupt(t *testing.T) {
	d := t.TempDir()
	t.Setenv("APPDATA", d)
	t.Setenv("XDG_CONFIG_HOME", d)

	path, err := Path()
	if err != nil {
		t.Fatal(err)
	}
	want := model.DefaultSettings()
	want.OutputDir = filepath.Join(d, "restored-output")
	want.Concurrency = 3
	backup, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".bak", backup, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("{truncated"), 0o644); err != nil {
		t.Fatal(err)
	}

	got := Load()
	if got.OutputDir != want.OutputDir || got.Concurrency != NormalizeConcurrency(want.Concurrency) {
		t.Fatalf("backup settings not restored: got output=%q concurrency=%d", got.OutputDir, got.Concurrency)
	}
}

func TestAtomicWriteLeavesValidJSON(t *testing.T) {
	d := t.TempDir()
	path := filepath.Join(d, "history.json")
	for i := 0; i < 20; i++ {
		if err := SaveJSON(path, map[string]int{"value": i}); err != nil {
			t.Fatal(err)
		}
		var got map[string]int
		if err := LoadJSON(path, &got); err != nil {
			t.Fatal(err)
		}
		if got["value"] != i {
			t.Fatalf("value=%d want %d", got["value"], i)
		}
	}
}

func TestLoadMigratesV284Schema(t *testing.T) {
	d := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", d)
	t.Setenv("APPDATA", d)
	cfgDir := filepath.Join(d, "VideoUpright")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		t.Fatal(err)
	}
	legacy := `{
  "config_version": 11,
  "video_output": "Y:\\FFout1\\v8",
  "last_folder": "D:\\media",
  "recursive": true,
  "profile": 1,
  "codec": 0,
  "quality": 0,
  "rate_mode": "quality",
  "override": "auto",
  "parallel": 5,
  "ffmpeg_dir": "C:\\Tools\\ffmpeg\\bin",
  "video_engine": "cpu",
  "gpu_fallback": true,
  "naming_mode": 0,
  "collision_mode": 0,
  "keep_history": true,
  "restore_session": true,
  "image_format": "jpg",
  "image_max_edge": 0,
  "image_quality": 88,
  "image_target_kb": 0,
  "player_mode": "auto",
  "potplayer_path": "C:\\PotPlayer\\PotPlayerMini64.exe"
}`
	if err := os.WriteFile(filepath.Join(cfgDir, "config.json"), []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}
	s := Load()
	if s.OutputDir != `Y:\FFout1\v8` || s.LastInputDir != `D:\media` {
		t.Fatalf("paths not migrated: output=%q input=%q", s.OutputDir, s.LastInputDir)
	}
	if s.Resolution != "1080P" || s.Codec != "H.265" || s.Quality != "高" || s.Rotation != "自动" {
		t.Fatalf("media settings not migrated: %+v", s)
	}
	if s.Concurrency != NormalizeConcurrency(5) || s.AutoConcurrency || s.UseGPU {
		t.Fatalf("execution settings not migrated: concurrency=%d auto=%v gpu=%v", s.Concurrency, s.AutoConcurrency, s.UseGPU)
	}
	if s.FFmpegPath != filepath.Join(`C:\Tools\ffmpeg\bin`, "ffmpeg.exe") {
		t.Fatalf("ffmpeg path=%q", s.FFmpegPath)
	}
	if s.InterfaceMode != "完整" || s.ImageFormat != "JPG" || s.ImageSize != "保持原尺寸" || s.ImageQuality != "高" {
		t.Fatalf("interface/image settings not migrated: %+v", s)
	}
}

func TestMediovaCopiesLegacyConfigWithoutDeletingSource(t *testing.T) {
	d := t.TempDir()
	t.Setenv("APPDATA", d)
	t.Setenv("XDG_CONFIG_HOME", d)
	legacy := filepath.Join(d, "VideoUpright")
	if err := os.MkdirAll(legacy, 0o755); err != nil {
		t.Fatal(err)
	}
	payload := []byte(`{"output_dir":"D:\\legacy-output"}`)
	if err := os.WriteFile(filepath.Join(legacy, "config.json"), payload, 0o644); err != nil {
		t.Fatal(err)
	}
	dir, err := Dir()
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(dir) != "Mediova" {
		t.Fatalf("unexpected data directory: %s", dir)
	}
	got, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Fatalf("copied config mismatch: %q", got)
	}
	if _, err := os.Stat(filepath.Join(legacy, "config.json")); err != nil {
		t.Fatalf("legacy config must be preserved: %v", err)
	}
}

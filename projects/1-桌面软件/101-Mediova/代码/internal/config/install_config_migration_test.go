package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"mediaworkbench/internal/model"
)

func loadModernSettingsFile(t *testing.T, path string) model.Settings {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	settings := model.DefaultSettings()
	if err := json.Unmarshal(data, &settings); err != nil {
		t.Fatal(err)
	}
	normalize(&settings)
	return settings
}

func TestInstalledConfigMigrationLeavesFreshInstallUntouched(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Mediova", "config.json")
	migrated, err := migrateGoNamedInstalledConfig(path)
	if err != nil || migrated {
		t.Fatalf("migrated=%v err=%v", migrated, err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("fresh install unexpectedly created config: %v", err)
	}
	if _, err := os.Stat(path + ".legacy"); !os.IsNotExist(err) {
		t.Fatalf("fresh install unexpectedly created legacy copy: %v", err)
	}
}

func TestInstalledConfigMigrationPreservesGoNamedSettings(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	legacy := map[string]any{
		"OutputDir":              `D:\video-output`,
		"ImageOutputDir":         `E:\image-output`,
		"RecentOutputDirs":       []string{`D:\video-output`, `F:\archive`},
		"RecentImageOutputDirs":  []string{`E:\image-output`},
		"Resolution":             "720P",
		"Codec":                  "H.264",
		"Quality":                "低",
		"VolumeMode":             "固定码率",
		"TargetSizeMB":           333,
		"BitrateMbps":            7.5,
		"Rotation":               "90°右转",
		"IncludeSubdirs":         false,
		"Concurrency":            6,
		"AutoConcurrency":        false,
		"SmartEngine":            false,
		"SpeedMode":              "高质量",
		"InterfaceMode":          "精简",
		"ShowPerformanceStats":   true,
		"RightPanelVisible":      false,
		"UILayoutRevision":       430,
		"TaskColumnWidths":       []int{320, 130, 90, 140, 80, 110, 125, 150, 130, 135},
		"AutoBenchmark":          false,
		"FFmpegPath":             `C:\Tools\ffmpeg\bin\ffmpeg.exe`,
		"PlayerPath":             `C:\PotPlayer\PotPlayerMini64.exe`,
		"AutoDetectPlayer":       false,
		"UseGPU":                 false,
		"GPUFallback":            false,
		"ExactTargetSize":        false,
		"ClearMetadata":          true,
		"AllowUpscale":           true,
		"PreserveTimes":          false,
		"FilenameMode":           "添加规格后缀",
		"ConflictPolicy":         "跳过已有",
		"SaveHistory":            false,
		"RestoreSession":         false,
		"NotifyOnDone":           false,
		"ShowFloatingBar":        false,
		"CompletionToastSeconds": 45,
		"VerifyOutput":           false,
		"ThumbnailCache":         false,
		"EstimateDiskSpace":      false,
		"SmartStreamCopy":        true,
		"AudioMode":              "复制原音频",
		"SubtitleMode":           "保留文本字幕",
		"OpenOutputOnDone":       true,
		"ImageFormat":            "PNG",
		"ImageSize":              "最大边 1280px",
		"ImageQuality":           "低",
		"ImageLimit":             "约 1MB",
		"LastInputDir":           `D:\source`,
		"LastImageInputDir":      `E:\photos`,
		"LastOutputDir":          `D:\video-output`,
		"LastImageOutputDir":     `E:\image-output`,
	}
	original, err := json.MarshalIndent(legacy, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, original, 0o644); err != nil {
		t.Fatal(err)
	}

	migrated, err := migrateGoNamedInstalledConfig(path)
	if err != nil || !migrated {
		t.Fatalf("migrated=%v err=%v", migrated, err)
	}
	got := loadModernSettingsFile(t, path)

	checks := map[string]bool{
		"video output":      got.OutputDir == `D:\video-output`,
		"image output":      got.ImageOutputDir == `E:\image-output`,
		"recent video dirs": reflect.DeepEqual(got.RecentOutputDirs, []string{`D:\video-output`, `F:\archive`}),
		"recent image dirs": reflect.DeepEqual(got.RecentImageOutputDirs, []string{`E:\image-output`}),
		"resolution":        got.Resolution == "720P",
		"codec":             got.Codec == "H.264",
		"quality":           got.Quality == "低",
		"volume mode":       got.VolumeMode == "固定码率",
		"target size":       got.TargetSizeMB == 333,
		"bitrate":           got.BitrateMbps == 7.5,
		"rotation":          got.Rotation == "90°右转",
		"recursive":         !got.IncludeSubdirs,
		"concurrency":       got.Concurrency == NormalizeConcurrency(6),
		"auto concurrency":  !got.AutoConcurrency,
		"smart engine":      !got.SmartEngine,
		"speed mode":        got.SpeedMode == "高质量",
		"interface":         got.InterfaceMode == "精简",
		"performance":       got.ShowPerformanceStats,
		"right panel":       !got.RightPanelVisible,
		"layout revision":   got.UILayoutRevision == 430,
		"ffmpeg path":       got.FFmpegPath == `C:\Tools\ffmpeg\bin\ffmpeg.exe`,
		"player path":       got.PlayerPath == `C:\PotPlayer\PotPlayerMini64.exe`,
		"player detection":  !got.AutoDetectPlayer,
		"gpu":               !got.UseGPU && !got.GPUFallback,
		"exact target":      !got.ExactTargetSize,
		"metadata":          got.ClearMetadata,
		"upscale":           got.AllowUpscale,
		"preserve times":    !got.PreserveTimes,
		"filename":          got.FilenameMode == "添加规格后缀",
		"conflict":          got.ConflictPolicy == "跳过已有",
		"history":           !got.SaveHistory,
		"session":           !got.RestoreSession,
		"notification":      !got.NotifyOnDone,
		"floating":          !got.ShowFloatingBar,
		"toast seconds":     got.CompletionToastSeconds == 45,
		"verification":      !got.VerifyOutput,
		"thumbnail cache":   !got.ThumbnailCache,
		"disk estimate":     !got.EstimateDiskSpace,
		"stream copy":       got.SmartStreamCopy,
		"audio":             got.AudioMode == "复制原音频",
		"subtitle":          got.SubtitleMode == "保留文本字幕",
		"open output":       got.OpenOutputOnDone,
		"image format":      got.ImageFormat == "PNG",
		"image size":        got.ImageSize == "最大边 1280px",
		"image quality":     got.ImageQuality == "低",
		"image limit":       got.ImageLimit == "约 1MB",
		"last video input":  got.LastInputDir == `D:\source`,
		"last image input":  got.LastImageInputDir == `E:\photos`,
		"last video output": got.LastOutputDir == `D:\video-output`,
		"last image output": got.LastImageOutputDir == `E:\image-output`,
		"column widths":     reflect.DeepEqual(got.TaskColumnWidths, legacy["TaskColumnWidths"]),
	}
	for name, ok := range checks {
		if !ok {
			t.Errorf("%s not inherited: %+v", name, got)
		}
	}

	backup, err := os.ReadFile(path + ".legacy")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(backup, original) {
		t.Fatal("exact pre-migration config was not preserved")
	}

	var modern map[string]json.RawMessage
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &modern); err != nil {
		t.Fatal(err)
	}
	if _, ok := modern["Resolution"]; ok {
		t.Fatal("legacy Go-name key remained after migration")
	}
	if _, ok := modern["resolution"]; !ok {
		t.Fatal("modern resolution key missing after migration")
	}
}

func TestInstalledConfigMigrationUsesLegacyBackupWhenPrimaryCorrupt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte("{broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	legacy := []byte(`{"Resolution":"480P","Codec":"H.264","Concurrency":4}`)
	if err := os.WriteFile(path+".bak", legacy, 0o644); err != nil {
		t.Fatal(err)
	}

	migrated, err := migrateGoNamedInstalledConfig(path)
	if err != nil || !migrated {
		t.Fatalf("migrated=%v err=%v", migrated, err)
	}
	got := loadModernSettingsFile(t, path)
	if got.Resolution != "480P" || got.Codec != "H.264" || got.Concurrency != NormalizeConcurrency(4) {
		t.Fatalf("backup settings not inherited: %+v", got)
	}
	preserved, err := os.ReadFile(path + ".legacy")
	if err != nil {
		t.Fatal(err)
	}
	if string(preserved) != string(legacy) {
		t.Fatalf("preserved backup=%q", preserved)
	}
}

func TestInstalledConfigMigrationLeavesModernConfigByteExact(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	settings := model.DefaultSettings()
	settings.OutputDir = `D:\modern`
	settings.Resolution = "4K"
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}

	migrated, err := migrateGoNamedInstalledConfig(path)
	if err != nil || migrated {
		t.Fatalf("migrated=%v err=%v", migrated, err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(after, data) {
		t.Fatal("modern config was rewritten")
	}
	if _, err := os.Stat(path + ".legacy"); !os.IsNotExist(err) {
		t.Fatalf("modern config unexpectedly created legacy copy: %v", err)
	}
}

func TestFreshInstallDefaultsAndFirstSaveRoundTrip(t *testing.T) {
	root := t.TempDir()
	t.Setenv("APPDATA", root)
	t.Setenv("XDG_CONFIG_HOME", root)
	t.Setenv("MEDIOVA_PORTABLE", "")
	t.Setenv("MEDIAWORKBENCH_PORTABLE", "")

	fresh := Load()
	wantDefaults := model.DefaultSettings()
	if fresh.Resolution != wantDefaults.Resolution ||
		fresh.Codec != wantDefaults.Codec ||
		fresh.Quality != wantDefaults.Quality ||
		fresh.Concurrency != NormalizeConcurrency(wantDefaults.Concurrency) ||
		fresh.RestoreSession != wantDefaults.RestoreSession {
		t.Fatalf("fresh defaults changed: %+v", fresh)
	}

	fresh.OutputDir = filepath.Join(root, "video")
	fresh.ImageOutputDir = filepath.Join(root, "images")
	fresh.Resolution = "720P"
	fresh.Codec = "H.264"
	fresh.Quality = "低"
	fresh.Concurrency = 3
	fresh.AutoConcurrency = false
	fresh.RestoreSession = false
	fresh.PlayerPath = filepath.Join(root, "PotPlayer.exe")
	if err := Save(fresh); err != nil {
		t.Fatal(err)
	}
	reloaded := Load()
	if reloaded.OutputDir != fresh.OutputDir ||
		reloaded.ImageOutputDir != fresh.ImageOutputDir ||
		reloaded.Resolution != fresh.Resolution ||
		reloaded.Codec != fresh.Codec ||
		reloaded.Quality != fresh.Quality ||
		reloaded.Concurrency != NormalizeConcurrency(fresh.Concurrency) ||
		reloaded.AutoConcurrency != fresh.AutoConcurrency ||
		reloaded.RestoreSession != fresh.RestoreSession ||
		reloaded.PlayerPath != fresh.PlayerPath {
		t.Fatalf("first-save round trip lost settings: got=%+v want=%+v", reloaded, fresh)
	}
}

func TestLoadInheritsOriginalV284ConfigInCurrentDataDirectory(t *testing.T) {
	root := t.TempDir()
	t.Setenv("APPDATA", root)
	t.Setenv("XDG_CONFIG_HOME", root)
	t.Setenv("MEDIOVA_PORTABLE", "")
	t.Setenv("MEDIAWORKBENCH_PORTABLE", "")
	dir := filepath.Join(root, "Mediova")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	legacy := `{
  "config_version": 11,
  "video_output": "D:\\video-output",
  "image_output": "E:\\image-output",
  "last_folder": "F:\\source",
  "recursive": false,
  "profile": 3,
  "codec": 1,
  "quality": 2,
  "rate_mode": "quality",
  "override": "left",
  "parallel": 4,
  "clear_metadata": true,
  "upscale": true,
  "ffmpeg_dir": "C:\\Tools\\ffmpeg\\bin",
  "video_engine": "cpu",
  "gpu_fallback": false,
  "naming_mode": 1,
  "collision_mode": 1,
  "keep_history": false,
  "restore_session": false,
  "open_output_done": true,
  "image_format": "png",
  "image_max_edge": 1280,
  "image_quality": 60,
  "image_target_kb": 900,
  "player_mode": "windows",
  "potplayer_path": "C:\\PotPlayer\\PotPlayerMini64.exe"
}`
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}

	got := Load()
	if got.OutputDir != `D:\video-output` ||
		got.ImageOutputDir != `E:\image-output` ||
		got.LastInputDir != `F:\source` ||
		got.LastImageInputDir != `F:\source` {
		t.Fatalf("paths not inherited: %+v", got)
	}
	if got.IncludeSubdirs ||
		got.Resolution != "480P" ||
		got.Codec != "H.264" ||
		got.Quality != "低" ||
		got.Rotation != "90°左转" {
		t.Fatalf("media settings not inherited: %+v", got)
	}
	if got.Concurrency != NormalizeConcurrency(4) ||
		got.AutoConcurrency ||
		got.UseGPU ||
		got.GPUFallback {
		t.Fatalf("execution settings not inherited: %+v", got)
	}
	if got.FFmpegPath != filepath.Join(`C:\Tools\ffmpeg\bin`, "ffmpeg.exe") ||
		got.FilenameMode != "添加规格后缀" ||
		got.ConflictPolicy != "跳过已有" {
		t.Fatalf("paths/policies not inherited: %+v", got)
	}
	if got.SaveHistory ||
		got.RestoreSession ||
		!got.OpenOutputOnDone ||
		got.ImageFormat != "PNG" ||
		got.ImageSize != "最大边 1280px" ||
		got.ImageQuality != "低" ||
		got.ImageLimit != "约 1MB" ||
		got.AutoDetectPlayer ||
		got.PlayerPath != `C:\PotPlayer\PotPlayerMini64.exe` {
		t.Fatalf("image/player settings not inherited: %+v", got)
	}
}

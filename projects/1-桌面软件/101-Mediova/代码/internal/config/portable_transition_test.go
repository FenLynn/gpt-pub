package config

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mediaworkbench/internal/model"
)

func setPortableSwitchTestDirs(t *testing.T) (standard, portable string) {
	t.Helper()
	root := t.TempDir()
	standard = filepath.Join(root, "standard")
	portable = filepath.Join(root, "portable")
	t.Setenv("MEDIOVA_STANDARD_DATA_DIR", standard)
	t.Setenv("MEDIOVA_PORTABLE_DATA_DIR", portable)
	return standard, portable
}

func writePortableFixture(t *testing.T, path, value string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(value), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestPreparePortableModeSwitchCurrentDataWinsAndTargetIsBackedUp(t *testing.T) {
	standard, portable := setPortableSwitchTestDirs(t)
	writePortableFixture(t, filepath.Join(standard, "session.json"), `{"schema":2,"tasks":[]}`)
	writePortableFixture(t, filepath.Join(standard, "history.json"), `[{"result":"current"}]`)
	writePortableFixture(t, filepath.Join(portable, "config.json"), `{"output_dir":"stale"}`)
	writePortableFixture(t, filepath.Join(portable, "history.json"), `[{"result":"stale"}]`)
	writePortableFixture(t, filepath.Join(portable, "cache.keep"), "unmanaged")

	settings := model.DefaultSettings()
	settings.OutputDir = `D:\current-output`
	now := time.Date(2026, 8, 3, 17, 0, 0, 123, time.Local)
	result, err := PreparePortableModeSwitch(true, settings, now)
	if err != nil {
		t.Fatal(err)
	}
	if result.SourceDir != filepath.Clean(standard) || result.TargetDir != filepath.Clean(portable) {
		t.Fatalf("unexpected directories: %+v", result)
	}
	if result.BackupDir == "" || result.ReplacedFiles < 4 {
		t.Fatalf("target replacement was not backed up: %+v", result)
	}

	var loaded model.Settings
	content, err := os.ReadFile(filepath.Join(portable, "config.json"))
	if err != nil || json.Unmarshal(content, &loaded) != nil {
		t.Fatalf("target config unreadable: %v %q", err, content)
	}
	if loaded.OutputDir != settings.OutputDir {
		t.Fatalf("target config did not use current settings: %q", loaded.OutputDir)
	}
	history, _ := os.ReadFile(filepath.Join(portable, "history.json"))
	if !bytes.Contains(history, []byte("current")) || bytes.Contains(history, []byte("stale")) {
		t.Fatalf("target history authority incorrect: %q", history)
	}
	backupConfig, _ := os.ReadFile(filepath.Join(result.BackupDir, "config.json"))
	backupHistory, _ := os.ReadFile(filepath.Join(result.BackupDir, "history.json"))
	if !bytes.Contains(backupConfig, []byte("stale")) || !bytes.Contains(backupHistory, []byte("stale")) {
		t.Fatalf("stale target was not preserved: %q %q", backupConfig, backupHistory)
	}
	unmanaged, _ := os.ReadFile(filepath.Join(portable, "cache.keep"))
	if string(unmanaged) != "unmanaged" {
		t.Fatalf("unmanaged target data changed: %q", unmanaged)
	}
	sourceHistory, _ := os.ReadFile(filepath.Join(standard, "history.json"))
	if !bytes.Contains(sourceHistory, []byte("current")) {
		t.Fatalf("source data changed: %q", sourceHistory)
	}
}

func TestPreparePortableModeSwitchRemovesStaleManagedFilesMissingFromSource(t *testing.T) {
	standard, portable := setPortableSwitchTestDirs(t)
	if err := os.MkdirAll(standard, 0o755); err != nil {
		t.Fatal(err)
	}
	writePortableFixture(t, filepath.Join(portable, "config.json.bak"), `{"output_dir":"stale-backup"}`)
	writePortableFixture(t, filepath.Join(portable, "session.json"), `{"schema":2,"tasks":[{"id":1}]}`)
	writePortableFixture(t, filepath.Join(portable, "session.json.tmp"), `{"schema":2,"tasks":[{"id":2}]}`)
	writePortableFixture(t, filepath.Join(portable, "history.json"), `[{"result":"stale"}]`)

	result, err := PreparePortableModeSwitch(true, model.DefaultSettings(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if result.RemovedFiles < 4 || result.BackupDir == "" {
		t.Fatalf("stale target files were not removed safely: %+v", result)
	}
	for _, name := range []string{"config.json.bak", "session.json", "session.json.tmp", "history.json"} {
		if _, err := os.Stat(filepath.Join(portable, name)); !os.IsNotExist(err) {
			t.Fatalf("stale %s remained: %v", name, err)
		}
		if _, err := os.Stat(filepath.Join(result.BackupDir, name)); err != nil {
			t.Fatalf("backup missing %s: %v", name, err)
		}
	}
}

func TestPreparePortableModeSwitchRejectsBlockedTargetWithoutChangingIt(t *testing.T) {
	standard, portable := setPortableSwitchTestDirs(t)
	if err := os.MkdirAll(standard, 0o755); err != nil {
		t.Fatal(err)
	}
	writePortableFixture(t, portable, "blocking-file")
	_, err := PreparePortableModeSwitch(true, model.DefaultSettings(), time.Now())
	if err == nil {
		t.Fatal("blocked target was accepted")
	}
	got, readErr := os.ReadFile(portable)
	if readErr != nil || string(got) != "blocking-file" {
		t.Fatalf("blocked target changed: %q %v", got, readErr)
	}
}

func TestPortableModeSwitchDirectoriesAndSummary(t *testing.T) {
	standard, portable := setPortableSwitchTestDirs(t)
	source, target, err := PortableModeSwitchDirectories(false)
	if err != nil {
		t.Fatal(err)
	}
	if source != filepath.Clean(portable) || target != filepath.Clean(standard) {
		t.Fatalf("unexpected disable direction: %q -> %q", source, target)
	}
	summary := PortableModeSwitchSummary(PortableModeSwitchResult{
		Enable: true, ReplacedFiles: 4, RemovedFiles: 2, BackupDir: "backup",
	})
	for _, want := range []string{"便携模式数据已准备完成", "写入 4 个文件", "清理 2 个目标旧文件", "目标旧数据已备份", "重启 Mediova 后生效"} {
		if !strings.Contains(summary, want) {
			t.Fatalf("summary missing %q: %q", want, summary)
		}
	}
}

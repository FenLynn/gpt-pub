package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"mediaworkbench/internal/model"
)

var portableModeManagedFiles = []string{
	"config.json",
	"config.json.bak",
	"config.json.lastgood",
	"config.json.legacy",
	"session.json",
	"session.json.tmp",
	"session.json.bak",
	"history.json",
	"history.json.lastgood",
	"history.json.bak",
}

type PortableModeSwitchResult struct {
	Enable        bool
	SourceDir     string
	TargetDir     string
	BackupDir     string
	ReplacedFiles int
	RemovedFiles  int
}

func portableSwitchStandardDataDir() (string, error) {
	if override := strings.TrimSpace(os.Getenv("MEDIOVA_STANDARD_DATA_DIR")); override != "" {
		return filepath.Abs(override)
	}
	if runtime.GOOS == "windows" {
		if value := strings.TrimSpace(os.Getenv("APPDATA")); value != "" {
			return filepath.Join(value, "Mediova"), nil
		}
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "Mediova"), nil
}

func portableSwitchPortableDataDir() (string, error) {
	if override := strings.TrimSpace(os.Getenv("MEDIOVA_PORTABLE_DATA_DIR")); override != "" {
		return filepath.Abs(override)
	}
	dir := executableDir()
	if dir == "" {
		return "", errors.New("cannot resolve executable directory")
	}
	return filepath.Join(dir, "MediovaData"), nil
}

func PortableModeSwitchDirectories(enable bool) (source, target string, err error) {
	standard, err := portableSwitchStandardDataDir()
	if err != nil {
		return "", "", err
	}
	portable, err := portableSwitchPortableDataDir()
	if err != nil {
		return "", "", err
	}
	if enable {
		source, target = standard, portable
	} else {
		source, target = portable, standard
	}
	source = filepath.Clean(source)
	target = filepath.Clean(target)
	if source == target {
		return "", "", fmt.Errorf("portable mode source and target are identical: %s", source)
	}
	return source, target, nil
}

func portableSwitchRegularFile(path string) (os.FileInfo, bool, error) {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, false, nil
		}
		return nil, false, err
	}
	if !info.Mode().IsRegular() {
		return nil, false, fmt.Errorf("managed data path is not a regular file: %s", path)
	}
	return info, true, nil
}

func writePortableSwitchData(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".mediova-switch-write-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	ok := false
	defer func() {
		_ = tmp.Close()
		if !ok {
			_ = os.Remove(tmpPath)
		}
	}()
	if err := tmp.Chmod(mode.Perm()); err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		return err
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}

	old := path + ".mode-switch-old"
	_ = os.Remove(old)
	if _, err := os.Stat(path); err == nil {
		if err := os.Rename(path, old); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Rename(old, path)
		return err
	}
	_ = os.Remove(old)
	ok = true
	return nil
}

func copyPortableSwitchFile(src, dst string, mode os.FileMode) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return writePortableSwitchData(dst, data, mode)
}

func backupPortableManagedFiles(target, backup string) (int, error) {
	count := 0
	for _, name := range portableModeManagedFiles {
		src := filepath.Join(target, name)
		info, exists, err := portableSwitchRegularFile(src)
		if err != nil {
			return count, err
		}
		if !exists {
			continue
		}
		if err := copyPortableSwitchFile(src, filepath.Join(backup, name), info.Mode()); err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

func stagePortableManagedFiles(stage, source string, settings model.Settings) error {
	if err := os.MkdirAll(stage, 0o755); err != nil {
		return err
	}
	normalize(&settings)
	configData, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	configData = append(configData, '\n')
	for _, name := range []string{"config.json", "config.json.lastgood"} {
		if err := writePortableSwitchData(filepath.Join(stage, name), configData, 0o644); err != nil {
			return err
		}
	}

	for _, name := range portableModeManagedFiles {
		if name == "config.json" || name == "config.json.lastgood" {
			continue
		}
		src := filepath.Join(source, name)
		info, exists, err := portableSwitchRegularFile(src)
		if err != nil {
			return err
		}
		if !exists {
			continue
		}
		if err := copyPortableSwitchFile(src, filepath.Join(stage, name), info.Mode()); err != nil {
			return err
		}
	}
	return nil
}

func restorePortableManagedFiles(target, backup string) error {
	var first error
	for _, name := range portableModeManagedFiles {
		if err := os.Remove(filepath.Join(target, name)); err != nil && !os.IsNotExist(err) && first == nil {
			first = err
		}
	}
	if strings.TrimSpace(backup) == "" {
		return first
	}
	for _, name := range portableModeManagedFiles {
		src := filepath.Join(backup, name)
		info, exists, err := portableSwitchRegularFile(src)
		if err != nil {
			if first == nil {
				first = err
			}
			continue
		}
		if !exists {
			continue
		}
		if err := copyPortableSwitchFile(src, filepath.Join(target, name), info.Mode()); err != nil && first == nil {
			first = err
		}
	}
	return first
}

func applyPortableManagedFiles(stage, target, backup string) (replaced, removed int, err error) {
	for _, name := range portableModeManagedFiles {
		staged := filepath.Join(stage, name)
		info, exists, statErr := portableSwitchRegularFile(staged)
		if statErr != nil {
			err = statErr
			break
		}
		targetPath := filepath.Join(target, name)
		if exists {
			if writeErr := copyPortableSwitchFile(staged, targetPath, info.Mode()); writeErr != nil {
				err = writeErr
				break
			}
			replaced++
			continue
		}
		if removeErr := os.Remove(targetPath); removeErr == nil {
			removed++
		} else if !os.IsNotExist(removeErr) {
			err = removeErr
			break
		}
	}
	if err != nil {
		rollbackErr := restorePortableManagedFiles(target, backup)
		if rollbackErr != nil {
			return replaced, removed, fmt.Errorf("%w; rollback failed: %v", err, rollbackErr)
		}
	}
	return replaced, removed, err
}

func PreparePortableModeSwitch(enable bool, settings model.Settings, now time.Time) (PortableModeSwitchResult, error) {
	source, target, err := PortableModeSwitchDirectories(enable)
	result := PortableModeSwitchResult{Enable: enable, SourceDir: source, TargetDir: target}
	if err != nil {
		return result, err
	}
	if err := os.MkdirAll(source, 0o755); err != nil {
		return result, fmt.Errorf("prepare source data directory: %w", err)
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		return result, fmt.Errorf("prepare target data directory: %w", err)
	}

	parent := filepath.Dir(target)
	stageRoot, err := os.MkdirTemp(parent, ".mediova-mode-switch-*")
	if err != nil {
		return result, err
	}
	defer os.RemoveAll(stageRoot)
	stage := filepath.Join(stageRoot, "data")
	if err := stagePortableManagedFiles(stage, source, settings); err != nil {
		return result, fmt.Errorf("stage portable mode data: %w", err)
	}

	backupRoot := filepath.Join(target, ".mode-switch-backups")
	backup := filepath.Join(backupRoot, now.Format("20060102-150405.000000000"))
	existing, err := backupPortableManagedFiles(target, backup)
	if err != nil {
		return result, fmt.Errorf("backup target data: %w", err)
	}
	if existing > 0 {
		result.BackupDir = backup
	} else {
		_ = os.RemoveAll(backup)
		_ = os.Remove(backupRoot)
		backup = ""
	}

	result.ReplacedFiles, result.RemovedFiles, err = applyPortableManagedFiles(stage, target, backup)
	if err != nil {
		return result, fmt.Errorf("apply portable mode data: %w", err)
	}
	return result, nil
}

func PortableModeSwitchSummary(result PortableModeSwitchResult) string {
	mode := "便携模式"
	if !result.Enable {
		mode = "普通模式"
	}
	parts := []string{
		fmt.Sprintf("%s数据已准备完成", mode),
		fmt.Sprintf("写入 %d 个文件", result.ReplacedFiles),
	}
	if result.RemovedFiles > 0 {
		parts = append(parts, fmt.Sprintf("清理 %d 个目标旧文件", result.RemovedFiles))
	}
	if result.BackupDir != "" {
		parts = append(parts, "目标旧数据已备份")
	}
	sort.Strings(parts[1:])
	return strings.Join(parts, "；") + "。重启 Mediova 后生效。"
}

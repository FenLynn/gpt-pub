package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type RuntimeFFmpegAccess struct {
	Target      string
	PairPresent bool
	Writable    bool
	Err         error
}

// InspectRuntimeFFmpegAccess checks whether the Runtime FFmpeg tree can be
// created or updated without creating directories as a side effect.
func InspectRuntimeFFmpegAccess() RuntimeFFmpegAccess {
	target, err := RuntimeFFmpegBinDir()
	if err != nil {
		return RuntimeFFmpegAccess{Err: err}
	}
	return inspectRuntimeFFmpegAccess(target)
}

func inspectRuntimeFFmpegAccess(target string) RuntimeFFmpegAccess {
	result := RuntimeFFmpegAccess{
		Target:      filepath.Clean(strings.TrimSpace(target)),
		PairPresent: ffmpegPairExists(target),
	}
	if strings.TrimSpace(target) == "" {
		result.Err = errors.New("empty Runtime FFmpeg directory")
		return result
	}

	anchor, err := nearestExistingRuntimeDirectory(target)
	if err != nil {
		result.Err = err
		return result
	}
	probe, err := os.CreateTemp(anchor, ".mediova-runtime-write-*.tmp")
	if err != nil {
		result.Err = err
		return result
	}
	name := probe.Name()
	closeErr := probe.Close()
	removeErr := os.Remove(name)
	if closeErr != nil {
		result.Err = closeErr
		return result
	}
	if removeErr != nil {
		result.Err = removeErr
		return result
	}
	result.Writable = true
	return result
}

func nearestExistingRuntimeDirectory(path string) (string, error) {
	current := filepath.Clean(path)
	for {
		info, err := os.Stat(current)
		if err == nil {
			if !info.IsDir() {
				return "", fmt.Errorf("Runtime path is occupied by a file: %s", current)
			}
			return current, nil
		}
		if !os.IsNotExist(err) {
			return "", err
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", err
		}
		current = parent
	}
}

func RuntimeFFmpegAccessNotice(access RuntimeFFmpegAccess) string {
	if access.Writable || access.Err == nil {
		return ""
	}
	if access.PairPresent {
		return "Runtime 组件目录当前不可写；现有 FFmpeg 可继续使用，但无法导入或更新组件。"
	}
	return "Runtime 组件目录当前不可写且未发现完整 FFmpeg；请在 FFmpeg 菜单选择外部组件，或将软件放到可写目录。"
}

func EnsureRuntimeFFmpegWritable() error {
	access := InspectRuntimeFFmpegAccess()
	if access.Writable {
		return nil
	}
	reason := access.Err
	if reason == nil {
		reason = errors.New("unknown Runtime write failure")
	}
	return fmt.Errorf(
		"Runtime 组件目录不可写（%s）：%w。请将 Mediova 放到可写目录，或在 FFmpeg 菜单中选择外部组件",
		access.Target,
		reason,
	)
}

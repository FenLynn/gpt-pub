package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type DataDirectoryAccess struct {
	Target   string
	Writable bool
	Err      error
}

// InspectDataDirectoryAccess verifies that an already-resolved application
// data directory can durably create and remove a small file. It never creates
// the target directory and never modifies config, session or history files.
func InspectDataDirectoryAccess(dir string) DataDirectoryAccess {
	clean := filepath.Clean(strings.TrimSpace(dir))
	result := DataDirectoryAccess{Target: clean}
	if strings.TrimSpace(dir) == "" {
		result.Err = errors.New("empty data directory")
		return result
	}
	info, err := os.Stat(clean)
	if err != nil {
		result.Err = err
		return result
	}
	if !info.IsDir() {
		result.Err = fmt.Errorf("data path is occupied by a file: %s", clean)
		return result
	}

	probe, err := os.CreateTemp(clean, ".mediova-data-write-*.tmp")
	if err != nil {
		result.Err = err
		return result
	}
	name := probe.Name()
	ok := false
	defer func() {
		_ = probe.Close()
		if !ok {
			_ = os.Remove(name)
		}
	}()
	if _, err := probe.Write([]byte("Mediova data directory write probe\n")); err != nil {
		result.Err = err
		return result
	}
	if err := probe.Sync(); err != nil {
		result.Err = err
		return result
	}
	if err := probe.Close(); err != nil {
		result.Err = err
		return result
	}
	if err := os.Remove(name); err != nil {
		result.Err = err
		return result
	}
	ok = true
	result.Writable = true
	return result
}

func DataDirectoryAccessNotice(access DataDirectoryAccess) string {
	if access.Writable || access.Err == nil {
		return ""
	}
	return "数据目录当前不可写；配置、任务会话和历史记录的更改可能无法保存。已保持现有文件不变，请检查目录权限、磁盘空间或安全软件占用。"
}

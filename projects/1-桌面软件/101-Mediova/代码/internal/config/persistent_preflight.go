package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type persistentSnapshotResult struct {
	Source string
	Notice string
}

func validHistorySnapshot(data []byte) bool {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || trimmed[0] != '[' || !json.Valid(trimmed) {
		return false
	}
	var records []json.RawMessage
	return json.Unmarshal(trimmed, &records) == nil
}

func readPersistentSnapshot(path string, validator func([]byte) bool) ([]byte, bool, bool, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, false, false, nil
		}
		return nil, false, false, err
	}
	return data, true, validator(data), nil
}

func nextPersistentCorruptPath(path string) string {
	candidate := path + ".corrupt"
	if _, err := os.Stat(candidate); os.IsNotExist(err) {
		return candidate
	}
	for i := 1; i <= 99; i++ {
		candidate = fmt.Sprintf("%s.corrupt.%d", path, i)
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
	return path + ".corrupt.latest"
}

func quarantinePersistentSnapshot(path string, validator func([]byte) bool) (string, error) {
	_, exists, valid, err := readPersistentSnapshot(path, validator)
	if err != nil {
		return "", err
	}
	if !exists || valid {
		return "", nil
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("persistent snapshot path is a directory: %s", path)
	}
	target := nextPersistentCorruptPath(path)
	if err := os.Rename(path, target); err != nil {
		return "", err
	}
	return target, nil
}

func refreshPersistentLastGood(path string, data []byte, validator func([]byte) bool) error {
	if !validator(data) {
		return errors.New("refusing to refresh invalid persistent snapshot")
	}
	lastGood := path + ".lastgood"
	if current, err := os.ReadFile(lastGood); err == nil && bytes.Equal(current, data) {
		return nil
	}
	return atomicWrite(lastGood, data, 0o644)
}

func restorePersistentSnapshot(path string, data []byte, validator func([]byte) bool) error {
	if !validator(data) {
		return errors.New("refusing to restore invalid persistent snapshot")
	}
	return atomicWrite(path, data, 0o644)
}

func prepareHistorySnapshot(path string) (persistentSnapshotResult, error) {
	primary, exists, valid, err := readPersistentSnapshot(path, validHistorySnapshot)
	if err != nil {
		return persistentSnapshotResult{}, err
	}
	if valid {
		if err := refreshPersistentLastGood(path, primary, validHistorySnapshot); err != nil {
			return persistentSnapshotResult{
				Source: "primary",
				Notice: "历史记录可读取，但最近有效副本未能刷新；本次仍使用主历史文件。",
			}, nil
		}
		return persistentSnapshotResult{Source: "primary"}, nil
	}

	type candidate struct {
		name string
		path string
	}
	for _, item := range []candidate{
		{name: "backup", path: path + ".bak"},
		{name: "lastgood", path: path + ".lastgood"},
	} {
		data, candidateExists, candidateValid, candidateErr := readPersistentSnapshot(item.path, validHistorySnapshot)
		if candidateErr != nil {
			return persistentSnapshotResult{}, candidateErr
		}
		if !candidateExists || !candidateValid {
			continue
		}
		if exists {
			if _, err := quarantinePersistentSnapshot(path, validHistorySnapshot); err != nil {
				return persistentSnapshotResult{}, err
			}
		}
		if err := restorePersistentSnapshot(path, data, validHistorySnapshot); err != nil {
			return persistentSnapshotResult{}, err
		}
		_ = refreshPersistentLastGood(path, data, validHistorySnapshot)
		return persistentSnapshotResult{
			Source: item.name,
			Notice: "历史记录主文件异常，已从有效副本恢复；异常原文件已隔离保留。",
		}, nil
	}

	if exists {
		if _, err := quarantinePersistentSnapshot(path, validHistorySnapshot); err != nil {
			return persistentSnapshotResult{}, err
		}
		return persistentSnapshotResult{
			Source: "quarantined",
			Notice: "历史记录文件损坏且无有效副本，已隔离原文件；软件将从空历史继续，不影响配置和任务会话。",
		}, nil
	}
	return persistentSnapshotResult{}, nil
}

func prepareSessionSnapshot(path string) (persistentSnapshotResult, error) {
	_, exists, valid, err := readPersistentSnapshot(path, validSessionSnapshot)
	if err != nil {
		return persistentSnapshotResult{}, err
	}
	if valid {
		return persistentSnapshotResult{Source: "primary"}, nil
	}

	type candidate struct {
		name string
		path string
	}
	for _, item := range []candidate{
		{name: "temporary", path: path + ".tmp"},
		{name: "backup", path: path + ".bak"},
	} {
		data, candidateExists, candidateValid, candidateErr := readPersistentSnapshot(item.path, validSessionSnapshot)
		if candidateErr != nil {
			return persistentSnapshotResult{}, candidateErr
		}
		if !candidateExists || !candidateValid {
			continue
		}
		if exists {
			if _, err := quarantinePersistentSnapshot(path, validSessionSnapshot); err != nil {
				return persistentSnapshotResult{}, err
			}
		}
		if err := restorePersistentSnapshot(path, data, validSessionSnapshot); err != nil {
			return persistentSnapshotResult{}, err
		}
		if item.name == "temporary" {
			_ = os.Remove(item.path)
		}
		return persistentSnapshotResult{
			Source: item.name,
			Notice: "任务会话主文件异常，已从有效快照恢复；异常原文件已隔离保留。",
		}, nil
	}

	if exists {
		if _, err := quarantinePersistentSnapshot(path, validSessionSnapshot); err != nil {
			return persistentSnapshotResult{}, err
		}
		return persistentSnapshotResult{
			Source: "quarantined",
			Notice: "任务会话文件损坏且无有效快照，已隔离原文件；软件将从空队列启动，不影响配置和历史记录。",
		}, nil
	}
	return persistentSnapshotResult{}, nil
}

func preparePersistentSnapshots(dir string) []string {
	if dir == "" {
		return nil
	}
	var notices []string
	for _, item := range []struct {
		path    string
		prepare func(string) (persistentSnapshotResult, error)
		label   string
	}{
		{path: filepath.Join(dir, "session.json"), prepare: prepareSessionSnapshot, label: "任务会话"},
		{path: filepath.Join(dir, "history.json"), prepare: prepareHistorySnapshot, label: "历史记录"},
	} {
		result, err := item.prepare(item.path)
		if err != nil {
			notices = append(notices, item.label+"预检失败，已保持其他数据文件独立加载："+err.Error())
			continue
		}
		if result.Notice != "" {
			notices = append(notices, result.Notice)
		}
	}
	return notices
}

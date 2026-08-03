package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

func validSessionSnapshot(data []byte) bool {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || !json.Valid(trimmed) {
		return false
	}
	if trimmed[0] == '[' {
		var legacy []json.RawMessage
		return json.Unmarshal(trimmed, &legacy) == nil
	}
	var envelope struct {
		Schema int             `json:"schema"`
		Tasks  json.RawMessage `json:"tasks"`
	}
	if json.Unmarshal(trimmed, &envelope) != nil || envelope.Schema <= 0 {
		return false
	}
	tasks := bytes.TrimSpace(envelope.Tasks)
	return len(tasks) > 0 && !bytes.Equal(tasks, []byte("null"))
}

func writeRecoveredSession(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".recover"
	file, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// restoreMissingSessionPrimary heals the narrow atomic-save interruption window
// in which session.json has already moved to .bak but the completed .tmp file has
// not yet been renamed into place. The newest valid .tmp snapshot wins; a valid
// .bak remains the fallback. Existing primary files are never overwritten.
func restoreMissingSessionPrimary(path string) (string, error) {
	if path == "" {
		return "", errors.New("empty session path")
	}
	if info, err := os.Stat(path); err == nil {
		if info.IsDir() {
			return "", fmt.Errorf("session primary is a directory: %s", path)
		}
		return "", nil
	} else if !os.IsNotExist(err) {
		return "", err
	}

	tmpPath := path + ".tmp"
	if data, err := os.ReadFile(tmpPath); err == nil && validSessionSnapshot(data) {
		if err := os.Rename(tmpPath, path); err == nil {
			return "tmp", nil
		}
		if err := writeRecoveredSession(path, data); err != nil {
			return "", err
		}
		return "tmp", nil
	}

	backupPath := path + ".bak"
	data, err := os.ReadFile(backupPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	if !validSessionSnapshot(data) {
		return "", errors.New("backup session snapshot is invalid")
	}
	if err := writeRecoveredSession(path, data); err != nil {
		return "", err
	}
	return "backup", nil
}

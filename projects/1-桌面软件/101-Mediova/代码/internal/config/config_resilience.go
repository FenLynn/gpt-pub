package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

const installedConfigLastGoodSuffix = ".lastgood"

var (
	startupConfigNoticeMu sync.RWMutex
	startupConfigNotice   string
)

// StartupConfigNotice returns the startup recovery or inheritance notice.
// The Windows UI may surface it once after the main window is ready.
func StartupConfigNotice() string {
	startupConfigNoticeMu.RLock()
	defer startupConfigNoticeMu.RUnlock()
	return startupConfigNotice
}

func setStartupConfigNotice(notice string) {
	startupConfigNoticeMu.Lock()
	startupConfigNotice = notice
	startupConfigNoticeMu.Unlock()
}

func validInstalledConfig(data []byte) bool {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || trimmed[0] != '{' || !json.Valid(trimmed) {
		return false
	}
	var object map[string]json.RawMessage
	return json.Unmarshal(trimmed, &object) == nil
}

func readValidInstalledConfig(path string) ([]byte, bool, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, false, nil
		}
		return nil, false, err
	}
	return data, validInstalledConfig(data), nil
}

func writeInstalledConfigSnapshot(path string, data []byte) error {
	if !validInstalledConfig(data) {
		return errors.New("refusing to write invalid installed config")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".mediova-config-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	ok := false
	defer func() {
		_ = tmp.Close()
		if !ok {
			_ = os.Remove(tmpName)
		}
	}()
	if err := tmp.Chmod(0o644); err != nil {
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
	if err := os.Rename(tmpName, path); err != nil {
		return err
	}
	ok = true
	return nil
}

func refreshInstalledConfigLastGood(path string, data []byte) error {
	lastGood := path + installedConfigLastGoodSuffix
	previous := lastGood + ".previous"
	_ = os.Remove(previous)
	if _, err := os.Stat(lastGood); err == nil {
		if err := os.Rename(lastGood, previous); err != nil {
			return err
		}
	}
	if err := writeInstalledConfigSnapshot(lastGood, data); err != nil {
		_ = os.Rename(previous, lastGood)
		return err
	}
	_ = os.Remove(previous)
	return nil
}

func nextCorruptConfigPath(path string) string {
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

func quarantineInvalidInstalledConfig(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	if validInstalledConfig(data) {
		return "", nil
	}
	target := nextCorruptConfigPath(path)
	if err := os.Rename(path, target); err != nil {
		return "", err
	}
	return target, nil
}

// prepareInstalledConfig validates the current config before Load runs.
// A valid primary refreshes a separate last-known-good copy. A missing or
// invalid primary is recovered from the atomic-write backup first, then from
// the last-known-good copy. Invalid primary bytes are preserved for diagnosis.
func prepareInstalledConfig(path string) (string, error) {
	if path == "" {
		return "", errors.New("empty config path")
	}
	primary, primaryValid, primaryErr := readValidInstalledConfig(path)
	if primaryErr != nil {
		return "", primaryErr
	}
	if primaryValid {
		if err := refreshInstalledConfigLastGood(path, primary); err != nil {
			return "primary", fmt.Errorf("refresh last-known-good config: %w", err)
		}
		return "primary", nil
	}

	type candidate struct {
		name string
		path string
	}
	for _, item := range []candidate{
		{name: "backup", path: path + ".bak"},
		{name: "lastgood", path: path + installedConfigLastGoodSuffix},
	} {
		data, valid, err := readValidInstalledConfig(item.path)
		if err != nil {
			return "", err
		}
		if !valid {
			continue
		}
		if _, err := quarantineInvalidInstalledConfig(path); err != nil {
			return "", fmt.Errorf("preserve invalid config: %w", err)
		}
		if err := writeInstalledConfigSnapshot(path, data); err != nil {
			return "", fmt.Errorf("restore config from %s: %w", item.name, err)
		}
		if err := refreshInstalledConfigLastGood(path, data); err != nil {
			return "", fmt.Errorf("refresh recovered config backup: %w", err)
		}
		return item.name, nil
	}

	if primary != nil {
		return "", errors.New("installed config is invalid and no valid recovery copy exists")
	}
	return "", nil
}

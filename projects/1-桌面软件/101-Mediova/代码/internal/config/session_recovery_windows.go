//go:build windows

package config

import "path/filepath"

func init() {
	dir, err := appDataDir()
	if err != nil {
		return
	}
	_, _ = restoreMissingSessionPrimary(filepath.Join(dir, "session.json"))
}

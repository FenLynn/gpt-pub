//go:build !windows

package config

import "os"

func replaceAtomicFile(path, tempPath string) error {
	return os.Rename(tempPath, path)
}

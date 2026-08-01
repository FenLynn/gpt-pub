package media

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"mediaworkbench/internal/config"
)

var thumbnailCacheMu sync.Mutex

// ThumbnailCachePath is stable for an unchanged source file and rendering
// request. Size and mtime are part of the key, so replacing a file at the same
// path automatically invalidates the old thumbnail.
func ThumbnailCachePath(input, rotation string, width, height int) (string, error) {
	st, err := os.Stat(input)
	if err != nil {
		return "", err
	}
	key := fmt.Sprintf("%s\n%d\n%d\n%s\n%d\n%d\nv2", filepath.Clean(input), st.Size(), st.ModTime().UnixNano(), rotation, width, height)
	sum := sha256.Sum256([]byte(key))
	dir, err := config.ThumbnailCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, hex.EncodeToString(sum[:])+".bmp"), nil
}

func GenerateThumbnailBMPCached(ctx context.Context, ffmpeg, input string, at float64, rotation string, width, height int) (string, error) {
	path, err := ThumbnailCachePath(input, rotation, width, height)
	if err != nil {
		return "", err
	}
	if st, err := os.Stat(path); err == nil && st.Size() > 64 {
		return path, nil
	}

	thumbnailCacheMu.Lock()
	defer thumbnailCacheMu.Unlock()
	if st, err := os.Stat(path); err == nil && st.Size() > 64 {
		return path, nil
	}
	tmp := path + fmt.Sprintf(".%d.tmp.bmp", time.Now().UnixNano())
	defer os.Remove(tmp)
	if err := GenerateThumbnailBMP(ctx, ffmpeg, input, tmp, at, rotation, width, height); err != nil {
		return "", err
	}
	if FileSize(tmp) <= 64 {
		return "", fmt.Errorf("thumbnail output is empty")
	}
	_ = os.Remove(path)
	if err := os.Rename(tmp, path); err != nil {
		if err := copyFile(tmp, path); err != nil {
			return "", err
		}
	}
	return path, nil
}

// CleanupThumbnailCache keeps the cache bounded without blocking startup.
func CleanupThumbnailCache(maxFiles int, maxAge time.Duration) error {
	dir, err := config.ThumbnailCacheDir()
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	type item struct {
		path string
		mod  time.Time
	}
	items := make([]item, 0, len(entries))
	cutoff := time.Now().Add(-maxAge)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		path := filepath.Join(dir, e.Name())
		if maxAge > 0 && info.ModTime().Before(cutoff) {
			_ = os.Remove(path)
			continue
		}
		items = append(items, item{path: path, mod: info.ModTime()})
	}
	if maxFiles <= 0 || len(items) <= maxFiles {
		return nil
	}
	// Small insertion sort is sufficient for the normal cache size and avoids
	// importing a heavier cache dependency.
	for i := 1; i < len(items); i++ {
		for j := i; j > 0 && items[j].mod.Before(items[j-1].mod); j-- {
			items[j], items[j-1] = items[j-1], items[j]
		}
	}
	for _, it := range items[:len(items)-maxFiles] {
		_ = os.Remove(it.path)
	}
	return nil
}

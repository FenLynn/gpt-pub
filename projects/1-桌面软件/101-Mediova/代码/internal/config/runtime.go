package config

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const runtimeProductName = "Mediova"

func RuntimeDir() (string, error) {
	if override := strings.TrimSpace(os.Getenv("MEDIOVA_RUNTIME_DIR")); override != "" {
		return filepath.Abs(override)
	}
	dir := executableDir()
	if dir == "" {
		return "", errors.New("cannot resolve Mediova runtime directory")
	}
	return filepath.Clean(dir), nil
}

func RuntimeComponentsDir() (string, error) {
	dir, err := RuntimeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "Components"), nil
}

func RuntimeFFmpegBinDir() (string, error) {
	dir, err := RuntimeComponentsDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "FFmpeg", "bin"), nil
}

func legacyFFmpegDirs() []string {
	var result []string
	if override := strings.TrimSpace(os.Getenv("MEDIOVA_LEGACY_FFMPEG_DIR")); override != "" {
		result = append(result, filepath.Clean(override))
	}
	if local, err := LocalDir(); err == nil {
		result = append(result, filepath.Join(local, "ffmpeg", "bin"), filepath.Join(local, "ffmpeg"))
	}
	return result
}

func ffmpegPairExists(dir string) bool {
	if strings.TrimSpace(dir) == "" {
		return false
	}
	for _, name := range []string{"ffmpeg.exe", "ffprobe.exe"} {
		info, err := os.Stat(filepath.Join(dir, name))
		if err != nil || info.IsDir() || info.Size() == 0 {
			return false
		}
	}
	return true
}

func copyTreeMissing(src, dst string) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("legacy component path is not a directory: %s", src)
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	return filepath.Walk(src, func(path string, entry os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(src, path)
		if err != nil || rel == "." {
			return err
		}
		target := filepath.Join(dst, rel)
		if entry.IsDir() {
			return os.MkdirAll(target, entry.Mode().Perm())
		}
		if !entry.Mode().IsRegular() {
			return nil
		}
		return copyFileIfMissing(path, target, entry.Mode())
	})
}

// MigrateLegacyRuntimeComponents copies the old AppData FFmpeg component into
// the transparent Runtime only when the Runtime pair is absent. Existing files
// are never overwritten and the legacy component is never deleted.
func MigrateLegacyRuntimeComponents() (bool, error) {
	target, err := RuntimeFFmpegBinDir()
	if err != nil {
		return false, err
	}
	if ffmpegPairExists(target) {
		return false, nil
	}
	for _, legacy := range legacyFFmpegDirs() {
		if !ffmpegPairExists(legacy) {
			continue
		}
		if err := copyTreeMissing(legacy, target); err != nil {
			return false, fmt.Errorf("copy legacy FFmpeg into Runtime: %w", err)
		}
		if ffmpegPairExists(target) {
			return true, nil
		}
	}
	return false, nil
}

// NormalizeConfiguredFFmpegPath moves only an old private AppData component
// reference to the verified Runtime pair. User-selected external paths remain
// authoritative.
func NormalizeConfiguredFFmpegPath(configured string) string {
	configured = strings.TrimSpace(configured)
	runtimeBin, err := RuntimeFFmpegBinDir()
	if err != nil || !ffmpegPairExists(runtimeBin) {
		return configured
	}
	cleanConfigured := strings.ToLower(filepath.Clean(configured))
	for _, legacy := range legacyFFmpegDirs() {
		cleanLegacy := strings.ToLower(filepath.Clean(legacy))
		if cleanConfigured == cleanLegacy || strings.HasPrefix(cleanConfigured, cleanLegacy+string(os.PathSeparator)) {
			return filepath.Join(runtimeBin, "ffmpeg.exe")
		}
	}
	return configured
}

type RuntimeManifestFile struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type RuntimeManifest struct {
	Product    string                `json:"product"`
	Version    string                `json:"version"`
	Platform   string                `json:"platform"`
	Deployment string                `json:"deployment"`
	Files      []RuntimeManifestFile `json:"files"`
}

func ValidateRuntimeManifest(expectedVersion string) error {
	runtimeDir, err := RuntimeDir()
	if err != nil {
		return err
	}
	content, err := os.ReadFile(filepath.Join(runtimeDir, "runtime-manifest.json"))
	if err != nil {
		return err
	}
	var manifest RuntimeManifest
	if err := json.Unmarshal(content, &manifest); err != nil {
		return err
	}
	if manifest.Product != runtimeProductName || manifest.Version != expectedVersion || manifest.Deployment != "folder-runtime" {
		return fmt.Errorf("runtime identity mismatch: product=%q version=%q deployment=%q", manifest.Product, manifest.Version, manifest.Deployment)
	}
	if len(manifest.Files) == 0 {
		return errors.New("runtime manifest has no files")
	}
	for _, entry := range manifest.Files {
		if strings.TrimSpace(entry.Path) == "" || strings.Contains(entry.Path, "..") {
			return fmt.Errorf("invalid runtime path: %q", entry.Path)
		}
		path := filepath.Join(runtimeDir, filepath.FromSlash(entry.Path))
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		h := sha256.New()
		_, copyErr := io.Copy(h, file)
		closeErr := file.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		info, err := os.Stat(path)
		if err != nil {
			return err
		}
		if info.Size() != entry.Size || !strings.EqualFold(hex.EncodeToString(h.Sum(nil)), entry.SHA256) {
			return fmt.Errorf("runtime manifest mismatch: %s", entry.Path)
		}
	}
	return nil
}

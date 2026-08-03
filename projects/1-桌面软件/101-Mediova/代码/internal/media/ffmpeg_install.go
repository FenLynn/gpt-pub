package media

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"mediaworkbench/internal/config"
)

// InstallFFmpegZip imports a downloaded Windows FFmpeg ZIP into the application's
// transparent Runtime component directory. It accepts both "bin/ffmpeg.exe"
// archives and release archives wrapped in a version-named top-level folder.
func InstallFFmpegZip(zipPath string) (ffmpegPath, ffprobePath string, err error) {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return "", "", fmt.Errorf("打开 ZIP 失败: %w", err)
	}
	defer r.Close()

	var ffmpegEntry, ffprobeEntry *zip.File
	for _, f := range r.File {
		base := strings.ToLower(filepath.Base(filepath.ToSlash(f.Name)))
		switch base {
		case "ffmpeg.exe":
			if ffmpegEntry == nil || zipPathScore(f.Name) > zipPathScore(ffmpegEntry.Name) {
				ffmpegEntry = f
			}
		case "ffprobe.exe":
			if ffprobeEntry == nil || zipPathScore(f.Name) > zipPathScore(ffprobeEntry.Name) {
				ffprobeEntry = f
			}
		}
	}
	if ffmpegEntry == nil || ffprobeEntry == nil {
		return "", "", errors.New("ZIP 中未同时找到 ffmpeg.exe 和 ffprobe.exe")
	}
	if err := config.EnsureRuntimeFFmpegWritable(); err != nil {
		return "", "", err
	}
	finalDir, err := config.RuntimeFFmpegBinDir()
	if err != nil {
		return "", "", err
	}
	componentRoot := filepath.Dir(finalDir)
	if err := os.MkdirAll(componentRoot, 0o755); err != nil {
		return "", "", fmt.Errorf("无法写入 Runtime 组件目录: %w", err)
	}
	stage, err := os.MkdirTemp(componentRoot, ".ffmpeg-import-*")
	if err != nil {
		return "", "", err
	}
	defer os.RemoveAll(stage)
	stageBin := filepath.Join(stage, "bin")
	if err := os.MkdirAll(stageBin, 0o755); err != nil {
		return "", "", err
	}

	// Extract the two programs plus DLLs from the same archive bin directory.
	binPrefix := strings.TrimSuffix(filepath.ToSlash(ffmpegEntry.Name), filepath.Base(filepath.ToSlash(ffmpegEntry.Name)))
	var selected []*zip.File
	for _, f := range r.File {
		name := filepath.ToSlash(f.Name)
		if f.FileInfo().IsDir() || !strings.HasPrefix(name, binPrefix) {
			continue
		}
		base := filepath.Base(name)
		ext := strings.ToLower(filepath.Ext(base))
		if strings.EqualFold(base, "ffmpeg.exe") || strings.EqualFold(base, "ffprobe.exe") || ext == ".dll" {
			selected = append(selected, f)
		}
	}
	sort.Slice(selected, func(i, j int) bool { return selected[i].Name < selected[j].Name })
	for _, f := range selected {
		if err := extractZipFile(f, filepath.Join(stageBin, filepath.Base(filepath.ToSlash(f.Name)))); err != nil {
			return "", "", err
		}
	}
	stagedFF := filepath.Join(stageBin, "ffmpeg.exe")
	stagedFP := filepath.Join(stageBin, "ffprobe.exe")
	if _, err := os.Stat(stagedFF); err != nil {
		return "", "", errors.New("导入后缺少 ffmpeg.exe")
	}
	if _, err := os.Stat(stagedFP); err != nil {
		return "", "", errors.New("导入后缺少 ffprobe.exe")
	}

	parent := filepath.Dir(finalDir)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return "", "", err
	}
	backup := finalDir + ".bak"
	_ = os.RemoveAll(backup)
	if _, err := os.Stat(finalDir); err == nil {
		if err := os.Rename(finalDir, backup); err != nil {
			return "", "", fmt.Errorf("备份旧组件失败: %w", err)
		}
	}
	if err := os.Rename(stageBin, finalDir); err != nil {
		_ = os.Rename(backup, finalDir)
		return "", "", fmt.Errorf("安装组件失败: %w", err)
	}
	_ = os.RemoveAll(backup)
	return filepath.Join(finalDir, "ffmpeg.exe"), filepath.Join(finalDir, "ffprobe.exe"), nil
}

func zipPathScore(name string) int {
	name = strings.ToLower(filepath.ToSlash(name))
	score := 0
	if strings.Contains(name, "/bin/") || strings.HasPrefix(name, "bin/") {
		score += 100
	}
	score -= strings.Count(name, "/")
	return score
}

func extractZipFile(f *zip.File, dst string) error {
	r, err := f.Open()
	if err != nil {
		return err
	}
	defer r.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	ok := false
	defer func() {
		_ = out.Close()
		if !ok {
			_ = os.Remove(dst)
		}
	}()
	if _, err := io.Copy(out, r); err != nil {
		return err
	}
	if err := out.Sync(); err != nil {
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	ok = true
	return nil
}

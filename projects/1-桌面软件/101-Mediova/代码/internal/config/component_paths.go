package config

import (
	"os"
	"path/filepath"
	"strings"

	"mediaworkbench/internal/model"
)

func regularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Size() > 0
}

func firstExistingFile(paths ...string) string {
	for _, path := range paths {
		if regularFile(path) {
			return filepath.Clean(path)
		}
	}
	return ""
}

func ffmpegPairFromDir(dir string) (string, bool) {
	if strings.TrimSpace(dir) == "" {
		return "", false
	}
	for _, pair := range [][2]string{
		{"ffmpeg.exe", "ffprobe.exe"},
		{"ffmpeg", "ffprobe"},
	} {
		ffmpeg := filepath.Join(dir, pair[0])
		ffprobe := filepath.Join(dir, pair[1])
		if regularFile(ffmpeg) && regularFile(ffprobe) {
			return filepath.Clean(ffmpeg), true
		}
	}
	return "", false
}

func normalizeInheritedFFmpegPath(configured string) (string, bool, bool) {
	original := strings.TrimSpace(configured)
	if original == "" {
		return "", false, false
	}
	clean := filepath.Clean(original)
	info, err := os.Stat(clean)
	if err == nil && info.IsDir() {
		if ffmpeg, ok := ffmpegPairFromDir(clean); ok {
			return ffmpeg, true, ffmpeg != original
		}
		if ffmpeg, ok := ffmpegPairFromDir(filepath.Join(clean, "bin")); ok {
			return ffmpeg, true, ffmpeg != original
		}
		return original, false, false
	}
	if err == nil && !info.IsDir() {
		base := strings.ToLower(filepath.Base(clean))
		switch base {
		case "ffprobe.exe":
			if ffmpeg, ok := ffmpegPairFromDir(filepath.Dir(clean)); ok {
				return ffmpeg, true, ffmpeg != original
			}
		case "ffprobe":
			if ffmpeg, ok := ffmpegPairFromDir(filepath.Dir(clean)); ok {
				return ffmpeg, true, ffmpeg != original
			}
		case "ffmpeg.exe", "ffmpeg":
			_, ok := ffmpegPairFromDir(filepath.Dir(clean))
			return clean, ok, clean != original
		}
		return original, false, false
	}
	return original, false, false
}

func normalizeInheritedPlayerPath(configured string) (string, bool, bool) {
	original := strings.TrimSpace(configured)
	if original == "" {
		return "", false, false
	}
	clean := filepath.Clean(original)
	info, err := os.Stat(clean)
	if err == nil && info.IsDir() {
		candidate := firstExistingFile(
			filepath.Join(clean, "PotPlayerMini64.exe"),
			filepath.Join(clean, "PotPlayerMini.exe"),
			filepath.Join(clean, "PotPlayer64.exe"),
			filepath.Join(clean, "PotPlayer.exe"),
		)
		if candidate != "" {
			return candidate, true, candidate != original
		}
		return original, false, false
	}
	if err == nil && !info.IsDir() {
		return clean, true, clean != original
	}
	return original, false, false
}

// NormalizeInheritedComponentSettings keeps explicit user paths authoritative.
// It only rewrites unambiguous directory/ffprobe inputs into their colocated
// executable. Invalid paths remain stored so the user can repair the original
// location; runtime discovery may still provide a temporary fallback.
func NormalizeInheritedComponentSettings(settings *model.Settings) (bool, []string) {
	if settings == nil {
		return false, nil
	}
	changed := false
	var notices []string

	if strings.TrimSpace(settings.FFmpegPath) != "" {
		normalized, valid, rewrite := normalizeInheritedFFmpegPath(settings.FFmpegPath)
		if rewrite {
			settings.FFmpegPath = normalized
			changed = true
			notices = append(notices, "已将原 FFmpeg 组件目录规范为同目录可执行文件。")
		} else if !valid {
			notices = append(notices, "原 FFmpeg 路径当前不可用，已保留设置并将尝试 Runtime 或系统组件。")
		}
	}
	if strings.TrimSpace(settings.PlayerPath) != "" {
		normalized, valid, rewrite := normalizeInheritedPlayerPath(settings.PlayerPath)
		if rewrite {
			settings.PlayerPath = normalized
			changed = true
			notices = append(notices, "已将原播放器目录规范为可执行文件。")
		} else if !valid {
			notices = append(notices, "原播放器路径当前不可用，已保留设置并将尝试自动查找或系统默认播放器。")
		}
	}
	return changed, notices
}

func appendStartupConfigNotices(notices ...string) {
	var clean []string
	for _, notice := range notices {
		notice = strings.TrimSpace(notice)
		if notice != "" {
			clean = append(clean, notice)
		}
	}
	if len(clean) == 0 {
		return
	}
	startupConfigNoticeMu.Lock()
	defer startupConfigNoticeMu.Unlock()
	if strings.TrimSpace(startupConfigNotice) != "" {
		startupConfigNotice += " "
	}
	startupConfigNotice += strings.Join(clean, " ")
}

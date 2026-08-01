package config

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"mediaworkbench/internal/model"
)

func executableDir() string {
	if exe, err := os.Executable(); err == nil {
		return filepath.Dir(exe)
	}
	return ""
}

// PortableModeEnabled is intentionally marker based so the setting can be
// resolved before config.json itself is loaded. Create portable.mode beside
// the EXE, or set MEDIAWORKBENCH_PORTABLE=1, to store all user data locally.
func PortableModeEnabled() bool {
	if os.Getenv("MEDIOVA_PORTABLE") == "1" || os.Getenv("MEDIAWORKBENCH_PORTABLE") == "1" {
		return true
	}
	dir := executableDir()
	if dir == "" {
		return false
	}
	_, err := os.Stat(filepath.Join(dir, "portable.mode"))
	return err == nil
}

func SetPortableMode(enable bool) error {
	dir := executableDir()
	if dir == "" {
		return errors.New("cannot resolve executable directory")
	}
	marker := filepath.Join(dir, "portable.mode")
	if enable {
		if err := os.WriteFile(marker, []byte("Mediova portable mode\r\n"), 0o644); err != nil {
			return err
		}
		_, err := portableDataDir()
		return err
	}
	if err := os.Remove(marker); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func copyFileIfMissing(src, dst string, mode os.FileMode) error {
	if _, err := os.Stat(dst); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode.Perm())
	if err != nil {
		if os.IsExist(err) {
			return nil
		}
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(dst)
		return copyErr
	}
	return closeErr
}

func copyLegacyTreeIfNeeded(legacy, target string) error {
	if legacy == "" || target == "" || legacy == target {
		return nil
	}
	if _, err := os.Stat(target); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	info, err := os.Stat(legacy)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if !info.IsDir() {
		return nil
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		return err
	}
	return filepath.Walk(legacy, func(path string, entry os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(legacy, path)
		if err != nil || rel == "." {
			return err
		}
		dst := filepath.Join(target, rel)
		if entry.IsDir() {
			return os.MkdirAll(dst, entry.Mode().Perm())
		}
		if !entry.Mode().IsRegular() {
			return nil
		}
		return copyFileIfMissing(path, dst, entry.Mode())
	})
}

func portableDataDir() (string, error) {
	dir := executableDir()
	if dir == "" {
		return "", errors.New("cannot resolve executable directory")
	}
	target := filepath.Join(dir, "MediovaData")
	legacy := filepath.Join(dir, "VideoUprightData")
	if err := copyLegacyTreeIfNeeded(legacy, target); err != nil {
		return "", err
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		return "", err
	}
	return target, nil
}

func appDataDir() (string, error) {
	if PortableModeEnabled() {
		return portableDataDir()
	}
	if runtime.GOOS == "windows" {
		if v := os.Getenv("APPDATA"); v != "" {
			target := filepath.Join(v, "Mediova")
			if err := copyLegacyTreeIfNeeded(filepath.Join(v, "VideoUpright"), target); err != nil {
				return "", err
			}
			if err := os.MkdirAll(target, 0o755); err != nil {
				return "", err
			}
			return target, nil
		}
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	target := filepath.Join(dir, "Mediova")
	if err := copyLegacyTreeIfNeeded(filepath.Join(dir, "VideoUpright"), target); err != nil {
		return "", err
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		return "", err
	}
	return target, nil
}

func LocalDir() (string, error) {
	if PortableModeEnabled() {
		return portableDataDir()
	}
	if runtime.GOOS == "windows" {
		if v := os.Getenv("LOCALAPPDATA"); v != "" {
			target := filepath.Join(v, "Mediova")
			if err := copyLegacyTreeIfNeeded(filepath.Join(v, "VideoUpright"), target); err != nil {
				return "", err
			}
			if err := os.MkdirAll(target, 0o755); err != nil {
				return "", err
			}
			return target, nil
		}
	}
	return appDataDir()
}

func Dir() (string, error) { return appDataDir() }
func Path() (string, error) {
	dir, err := appDataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.json"), nil
}
func HistoryPath() (string, error) {
	dir, err := appDataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "history.json"), nil
}
func SessionPath() (string, error) {
	dir, err := appDataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "session.json"), nil
}
func CrashPath() (string, error) {
	dir, err := appDataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "crash.log"), nil
}
func HistoryHTMLPath() (string, error) {
	dir, err := appDataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "history.html"), nil
}
func TempDir() (string, error) {
	dir, err := LocalDir()
	if err != nil {
		return "", err
	}
	dir = filepath.Join(dir, "temp")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func CacheDir() (string, error) {
	dir, err := LocalDir()
	if err != nil {
		return "", err
	}
	dir = filepath.Join(dir, "cache")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func ThumbnailCacheDir() (string, error) {
	dir, err := CacheDir()
	if err != nil {
		return "", err
	}
	dir = filepath.Join(dir, "thumbnails")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func Load() model.Settings {
	s := model.DefaultSettings()
	path, err := Path()
	if err != nil {
		return s
	}
	b, err := readPrimaryOrBackup(path)
	if err != nil {
		return s
	}
	var raw map[string]json.RawMessage
	_ = json.Unmarshal(b, &raw)
	_, hasOldVersion := raw["config_version"]
	_, hasOldOutput := raw["video_output"]
	if !hasOldVersion && !hasOldOutput {
		if json.Unmarshal(b, &s) != nil {
			return model.DefaultSettings()
		}
	}
	// v1.x-v2.8.4 used Go field names in some builds. Merge those keys so the rebuilt
	// version can continue using the user's existing local configuration.
	var legacy struct {
		OutputDir        string
		Resolution       string
		Codec            string
		Quality          string
		Rotation         string
		IncludeSubdirs   bool
		Concurrency      int
		FFmpegPath       string
		PlayerPath       string
		UseGPU           bool
		GPUFallback      bool
		ClearMetadata    bool
		AllowUpscale     bool
		PreserveTimes    bool
		FilenameMode     string
		ConflictPolicy   string
		SaveHistory      bool
		RestoreSession   bool
		NotifyOnDone     bool
		OpenOutputOnDone bool
		ImageFormat      string
		ImageSize        string
		ImageQuality     string
		ImageLimit       string
	}
	_ = json.Unmarshal(b, &legacy)
	if s.OutputDir == "" {
		s.OutputDir = legacy.OutputDir
	}
	if s.Resolution == "" {
		s.Resolution = legacy.Resolution
	}
	if s.Codec == "" {
		s.Codec = legacy.Codec
	}
	if s.Quality == "" {
		s.Quality = legacy.Quality
	}
	if s.Rotation == "" {
		s.Rotation = legacy.Rotation
	}
	if s.Concurrency == 0 {
		s.Concurrency = legacy.Concurrency
	}
	if s.FFmpegPath == "" {
		s.FFmpegPath = legacy.FFmpegPath
	}
	if s.PlayerPath == "" {
		s.PlayerPath = legacy.PlayerPath
	}
	if s.FilenameMode == "" {
		s.FilenameMode = legacy.FilenameMode
	}
	if s.ConflictPolicy == "" {
		s.ConflictPolicy = legacy.ConflictPolicy
	}
	if s.ImageFormat == "" {
		s.ImageFormat = legacy.ImageFormat
	}
	if s.ImageSize == "" {
		s.ImageSize = legacy.ImageSize
	}
	if s.ImageQuality == "" {
		s.ImageQuality = legacy.ImageQuality
	}
	if s.ImageLimit == "" {
		s.ImageLimit = legacy.ImageLimit
	}
	// Boolean legacy values are only applied when the JSON explicitly contains the key.
	copyBool := func(key string, dst *bool, v bool) {
		if _, ok := raw[key]; ok {
			*dst = v
		}
	}
	copyBool("IncludeSubdirs", &s.IncludeSubdirs, legacy.IncludeSubdirs)
	copyBool("UseGPU", &s.UseGPU, legacy.UseGPU)
	copyBool("GPUFallback", &s.GPUFallback, legacy.GPUFallback)
	copyBool("ClearMetadata", &s.ClearMetadata, legacy.ClearMetadata)
	copyBool("AllowUpscale", &s.AllowUpscale, legacy.AllowUpscale)
	copyBool("PreserveTimes", &s.PreserveTimes, legacy.PreserveTimes)
	copyBool("SaveHistory", &s.SaveHistory, legacy.SaveHistory)
	copyBool("RestoreSession", &s.RestoreSession, legacy.RestoreSession)
	copyBool("NotifyOnDone", &s.NotifyOnDone, legacy.NotifyOnDone)
	copyBool("OpenOutputOnDone", &s.OpenOutputOnDone, legacy.OpenOutputOnDone)

	// Exact migration for the original v2.8.4 config schema. Those builds used
	// compact numeric enums and snake_case names such as profile/codec/parallel.
	// Keep this path explicit so existing users do not lose output paths,
	// component paths or media preferences after moving to the recovered source.
	var old struct {
		ConfigVersion  int    `json:"config_version"`
		Output         string `json:"output"`
		VideoOutput    string `json:"video_output"`
		ImageOutput    string `json:"image_output"`
		LastFolder     string `json:"last_folder"`
		Recursive      bool   `json:"recursive"`
		Profile        int    `json:"profile"`
		Codec          int    `json:"codec"`
		Quality        int    `json:"quality"`
		RateMode       string `json:"rate_mode"`
		Override       string `json:"override"`
		Parallel       int    `json:"parallel"`
		ClearMetadata  bool   `json:"clear_metadata"`
		Upscale        bool   `json:"upscale"`
		FFmpegDir      string `json:"ffmpeg_dir"`
		VideoEngine    string `json:"video_engine"`
		GPUFallback    bool   `json:"gpu_fallback"`
		NamingMode     int    `json:"naming_mode"`
		CollisionMode  int    `json:"collision_mode"`
		KeepHistory    bool   `json:"keep_history"`
		RestoreSession bool   `json:"restore_session"`
		OpenOutputDone bool   `json:"open_output_done"`
		ImageFormat    string `json:"image_format"`
		ImageMaxEdge   int    `json:"image_max_edge"`
		ImageQuality   int    `json:"image_quality"`
		ImageTargetKB  int    `json:"image_target_kb"`
		ImageWorkers   int    `json:"image_workers"`
		PlayerMode     string `json:"player_mode"`
		PotPlayerPath  string `json:"potplayer_path"`
	}
	_ = json.Unmarshal(b, &old)
	if hasOldVersion || hasOldOutput {
		if old.VideoOutput != "" {
			s.OutputDir = old.VideoOutput
		} else if old.Output != "" {
			s.OutputDir = old.Output
		}
		if old.LastFolder != "" {
			s.LastInputDir = old.LastFolder
			s.LastImageInputDir = old.LastFolder
		}
		if _, ok := raw["recursive"]; ok {
			s.IncludeSubdirs = old.Recursive
		}
		if v, ok := map[int]string{0: "4K", 1: "1080P", 2: "720P", 3: "480P", 4: "原尺寸"}[old.Profile]; ok {
			s.Resolution = v
		}
		if old.Codec == 1 {
			s.Codec = "H.264"
		} else {
			s.Codec = "H.265"
		}
		if v, ok := map[int]string{0: "高", 1: "中", 2: "低"}[old.Quality]; ok {
			s.Quality = v
		}
		switch strings.ToLower(old.RateMode) {
		case "target", "size", "volume":
			s.VolumeMode = "目标体积 100MB"
		default:
			s.VolumeMode = "质量优先"
		}
		if v, ok := map[string]string{"auto": "自动", "none": "0°", "0": "0°", "right": "90°右转", "left": "90°左转", "180": "180°", "hflip": "左右翻转", "vflip": "上下翻转"}[strings.ToLower(old.Override)]; ok {
			s.Rotation = v
		}
		if old.Parallel >= 1 {
			s.Concurrency = NormalizeConcurrency(old.Parallel)
			s.AutoConcurrency = false
		}
		if _, ok := raw["clear_metadata"]; ok {
			s.ClearMetadata = old.ClearMetadata
		}
		if _, ok := raw["upscale"]; ok {
			s.AllowUpscale = old.Upscale
		}
		if old.FFmpegDir != "" {
			candidate := old.FFmpegDir
			if filepath.Ext(candidate) == "" {
				candidate = filepath.Join(candidate, "ffmpeg.exe")
			}
			s.FFmpegPath = candidate
		}
		if strings.EqualFold(old.VideoEngine, "cpu") {
			s.UseGPU = false
		} else if old.VideoEngine != "" {
			s.UseGPU = true
		}
		if _, ok := raw["gpu_fallback"]; ok {
			s.GPUFallback = old.GPUFallback
		}
		if old.NamingMode == 1 {
			s.FilenameMode = "添加规格后缀"
		} else {
			s.FilenameMode = "保持原文件名"
		}
		switch old.CollisionMode {
		case 1:
			s.ConflictPolicy = "跳过已有"
		case 2:
			s.ConflictPolicy = "覆盖已有"
		default:
			s.ConflictPolicy = "自动编号"
		}
		if _, ok := raw["keep_history"]; ok {
			s.SaveHistory = old.KeepHistory
		}
		if _, ok := raw["restore_session"]; ok {
			s.RestoreSession = old.RestoreSession
		}
		if _, ok := raw["open_output_done"]; ok {
			s.OpenOutputOnDone = old.OpenOutputDone
		}
		if strings.EqualFold(old.ImageFormat, "png") {
			s.ImageFormat = "PNG"
		} else if old.ImageFormat != "" {
			s.ImageFormat = "JPG"
		}
		switch old.ImageMaxEdge {
		case 3840:
			s.ImageSize = "最大边 3840px"
		case 2560:
			s.ImageSize = "最大边 2560px"
		case 1920:
			s.ImageSize = "最大边 1920px"
		case 1280:
			s.ImageSize = "最大边 1280px"
		case 1000:
			s.ImageSize = "最大边 1000px"
		default:
			s.ImageSize = "保持原尺寸"
		}
		if old.ImageQuality >= 85 {
			s.ImageQuality = "高"
		} else if old.ImageQuality >= 70 {
			s.ImageQuality = "中"
		} else if old.ImageQuality > 0 {
			s.ImageQuality = "低"
		}
		switch {
		case old.ImageTargetKB <= 0:
			s.ImageLimit = "不限"
		case old.ImageTargetKB <= 600:
			s.ImageLimit = "约 500KB"
		case old.ImageTargetKB <= 1200:
			s.ImageLimit = "约 1MB"
		case old.ImageTargetKB <= 2500:
			s.ImageLimit = "约 2MB"
		default:
			s.ImageLimit = "约 5MB"
		}
		if old.PotPlayerPath != "" {
			s.PlayerPath = old.PotPlayerPath
		}
		s.AutoDetectPlayer = !strings.EqualFold(old.PlayerMode, "windows")
		// The original interface was the complete v2.8.4 layout.
		s.InterfaceMode = "完整"
	}
	normalize(&s)
	return s
}

func normalize(s *model.Settings) {
	s.Concurrency = NormalizeConcurrency(s.Concurrency)
	if s.Resolution == "" {
		s.Resolution = "1080P"
	}
	if s.Codec == "" {
		s.Codec = "H.265"
	}
	if s.Quality == "" {
		s.Quality = "高"
	}
	if s.VolumeMode == "" {
		s.VolumeMode = "质量优先"
	}
	if s.TargetSizeMB <= 0 {
		s.TargetSizeMB = 100
	}
	if s.BitrateMbps <= 0 {
		s.BitrateMbps = 5
	}
	if s.Rotation == "" {
		s.Rotation = "自动"
	}
	if s.FilenameMode == "" {
		s.FilenameMode = "保持原文件名"
	}
	if s.ConflictPolicy == "" {
		s.ConflictPolicy = "自动编号"
	}
	if s.ImageFormat == "" {
		s.ImageFormat = "JPG"
	}
	if s.ImageSize == "" {
		s.ImageSize = "保持原尺寸"
	}
	if s.ImageQuality == "" {
		s.ImageQuality = "高"
	}
	if s.ImageLimit == "" {
		s.ImageLimit = "不限"
	}
	if s.CompletionToastSeconds < 5 || s.CompletionToastSeconds > 300 {
		s.CompletionToastSeconds = 30
	}
	if s.SpeedMode == "" {
		s.SpeedMode = "均衡"
	}
	if s.InterfaceMode == "" {
		s.InterfaceMode = "完整"
	}
	if s.AudioMode == "" {
		s.AudioMode = "AAC 192k"
	}
	if s.SubtitleMode == "" {
		s.SubtitleMode = "不保留字幕"
	}
	if len(s.TaskColumnWidths) > 0 {
		normalized := make([]int, 10)
		defaults := []int{300, 125, 80, 135, 75, 105, 120, 145, 125, 130}
		for i := range normalized {
			w := defaults[i]
			if i < len(s.TaskColumnWidths) && s.TaskColumnWidths[i] >= 45 && s.TaskColumnWidths[i] <= 900 {
				w = s.TaskColumnWidths[i]
			}
			normalized[i] = w
		}
		s.TaskColumnWidths = normalized
	}
}

var saveMu sync.Mutex

func Save(s model.Settings) error {
	normalize(&s)
	path, err := Path()
	if err != nil {
		return err
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if len(b) == 0 {
		return errors.New("empty config")
	}
	saveMu.Lock()
	defer saveMu.Unlock()
	return atomicWrite(path, b, 0o644)
}

func SaveJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	saveMu.Lock()
	defer saveMu.Unlock()
	return atomicWrite(path, b, 0o644)
}

func atomicWrite(path string, data []byte, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".mw-write-*.tmp")
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
	if err := tmp.Chmod(perm); err != nil {
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
	// Windows cannot atomically replace an existing file with os.Rename. Keep a
	// short-lived backup so a power loss never leaves a half-written JSON file.
	bak := path + ".bak"
	_ = os.Remove(bak)
	if _, err := os.Stat(path); err == nil {
		if err := os.Rename(path, bak); err != nil {
			return err
		}
	}
	if err := os.Rename(tmpName, path); err != nil {
		_ = os.Rename(bak, path)
		return err
	}
	_ = os.Remove(bak)
	ok = true
	return nil
}

func readPrimaryOrBackup(path string) ([]byte, error) {
	primary, primaryErr := os.ReadFile(path)
	if primaryErr == nil && json.Valid(primary) {
		return primary, nil
	}

	backup, backupErr := os.ReadFile(path + ".bak")
	if backupErr == nil && json.Valid(backup) {
		return backup, nil
	}

	// Preserve the original failure mode when neither copy is valid. Returning
	// invalid bytes lets the caller report the JSON error instead of hiding it
	// behind an unrelated backup read failure.
	if primaryErr == nil {
		return primary, nil
	}
	if backupErr == nil {
		return backup, nil
	}
	return nil, primaryErr
}

func LoadJSON(path string, v any) error {
	b, err := readPrimaryOrBackup(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// MigrateLegacyTransientData moves preview folders accidentally created by
// earlier recovered builds under Roaming AppData into the machine-local cache.
// They contain generated images only; config/history/session remain untouched.
func MigrateLegacyTransientData() {
	if PortableModeEnabled() {
		return
	}
	roaming, err := appDataDir()
	if err != nil {
		return
	}
	local, err := CacheDir()
	if err != nil || filepath.Clean(roaming) == filepath.Clean(local) {
		return
	}
	legacyRoot := filepath.Join(local, "legacy_previews")
	_ = os.MkdirAll(legacyRoot, 0o755)
	for _, name := range []string{"preview", "edit_preview", "edit_preview_cache"} {
		src := filepath.Join(roaming, name)
		info, statErr := os.Stat(src)
		if statErr != nil || !info.IsDir() {
			continue
		}
		dst := filepath.Join(legacyRoot, name)
		if _, dstErr := os.Stat(dst); os.IsNotExist(dstErr) {
			if os.Rename(src, dst) == nil {
				continue
			}
		}
		// A previous migration may already have created the target. Preview
		// filenames are disposable, so move non-conflicting entries and leave
		// any unexpected files in place rather than deleting user data.
		entries, _ := os.ReadDir(src)
		_ = os.MkdirAll(dst, 0o755)
		for _, entry := range entries {
			from := filepath.Join(src, entry.Name())
			to := filepath.Join(dst, entry.Name())
			if _, e := os.Stat(to); os.IsNotExist(e) {
				_ = os.Rename(from, to)
			}
		}
		_ = os.Remove(src)
	}
}

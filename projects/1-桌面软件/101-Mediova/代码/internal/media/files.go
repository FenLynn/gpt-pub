package media

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"mediaworkbench/internal/model"
)

var videoExts = map[string]bool{
	".mp4": true, ".mov": true, ".m4v": true, ".avi": true, ".mkv": true,
	".wmv": true, ".flv": true, ".webm": true, ".mts": true, ".m2ts": true,
	".3gp": true, ".ts": true, ".mpg": true, ".mpeg": true, ".vob": true,
}
var imageExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".bmp": true, ".webp": true,
	".tif": true, ".tiff": true, ".heic": true, ".heif": true, ".avif": true,
}

func DetectKind(path string) (model.Kind, bool) {
	ext := strings.ToLower(filepath.Ext(path))
	if videoExts[ext] {
		return model.KindVideo, true
	}
	if imageExts[ext] {
		return model.KindImage, true
	}
	return "", false
}

// ImportTreeRoot returns the parent of a selected folder. Using this value as
// Task.Root keeps the selected top-level folder itself in the output tree:
// importing A/sub/file produces <output>/A/sub/file rather than <output>/sub/file.
func ImportTreeRoot(selectedFolder string) string {
	selectedFolder = filepath.Clean(strings.TrimSpace(selectedFolder))
	if selectedFolder == "." || selectedFolder == "" {
		return ""
	}
	parent := filepath.Dir(selectedFolder)
	if parent == selectedFolder {
		return selectedFolder
	}
	return parent
}

// ScanResult contains every supported media file discovered during one folder
// traversal. Video and image files are deliberately collected together so the
// desktop application can route them to their respective workspaces without
// scanning the disk twice.
type ScanResult struct {
	Videos      []string
	Images      []string
	Unsupported int
	Unreadable  int
}

func ListMixedFiles(root string, recursive bool) (ScanResult, error) {
	var result ScanResult
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			result.Unreadable++
			return nil
		}
		if d.IsDir() {
			if path != root && !recursive {
				return filepath.SkipDir
			}
			return nil
		}
		kind, ok := DetectKind(path)
		if !ok {
			result.Unsupported++
			return nil
		}
		if kind == model.KindVideo {
			result.Videos = append(result.Videos, path)
		} else {
			result.Images = append(result.Images, path)
		}
		return nil
	})
	return result, err
}

func ListFiles(root string, recursive bool, wanted model.Kind) ([]string, error) {
	var out []string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if path != root && !recursive {
				return filepath.SkipDir
			}
			return nil
		}
		kind, ok := DetectKind(path)
		if ok && kind == wanted {
			out = append(out, path)
		}
		return nil
	})
	return out, err
}

func FormatBytes(n int64) string {
	if n < 0 {
		return "—"
	}
	const unit = int64(1024)
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := unit, 0
	for x := n / unit; x >= unit && exp < 4; x /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
}

func sanitizeSuffix(s string) string {
	s = strings.TrimSpace(s)
	s = strings.NewReplacer("/", "-", "\\", "-", ":", "-", "*", "", "?", "", "\"", "", "<", "", ">", "", "|", "").Replace(s)
	return s
}

func OutputExtension(kind model.Kind, opts model.TaskOptions) string {
	if kind == model.KindVideo {
		return ".mp4"
	}
	if strings.EqualFold(opts.ImageFormat, "PNG") {
		return ".png"
	}
	return ".jpg"
}

func ResolveOutputPath(input, root, outputDir string, kind model.Kind, opts model.TaskOptions, settings model.Settings) (path string, skip bool, err error) {
	return ResolveOutputPathAvoiding(input, root, outputDir, kind, opts, settings, nil)
}

// ResolveOutputPathAvoiding is the concurrency-safe form used by the queue. The
// unavailable callback marks paths already reserved by another worker, even when
// the file has not yet been created on disk.
func ResolveOutputPathAvoiding(input, root, outputDir string, kind model.Kind, opts model.TaskOptions, settings model.Settings, unavailable func(string) bool) (path string, skip bool, err error) {
	base := strings.TrimSuffix(filepath.Base(input), filepath.Ext(input))
	ext := OutputExtension(kind, opts)
	if settings.FilenameMode == "添加规格后缀" {
		if kind == model.KindVideo {
			codec := strings.ReplaceAll(opts.Codec, ".", "")
			base += "_" + sanitizeSuffix(opts.Resolution) + "_" + sanitizeSuffix(codec)
		} else {
			base += "_" + sanitizeSuffix(opts.ImageSize)
		}
	}
	root, outputPrefix := ResolveRootContext(input, root, settings.LastInputDir)
	outputDir = OutputRootWithPrefix(outputDir, outputPrefix)
	dir := outputDir
	if root != "" {
		rel, e := filepath.Rel(root, filepath.Dir(input))
		if e == nil && rel != "." && !strings.HasPrefix(rel, "..") {
			dir = filepath.Join(outputDir, rel)
		}
	}
	if err = os.MkdirAll(dir, 0o755); err != nil {
		return "", false, err
	}
	candidate := filepath.Join(dir, base+ext)
	if filepath.Clean(candidate) == filepath.Clean(input) {
		candidate = filepath.Join(dir, base+"_converted"+ext)
	}
	exists := func(p string) bool {
		if unavailable != nil && unavailable(p) {
			return true
		}
		_, e := os.Stat(p)
		return e == nil || !os.IsNotExist(e)
	}
	if !exists(candidate) {
		return candidate, false, nil
	}
	switch settings.ConflictPolicy {
	case "覆盖已有":
		// Never allow two concurrent workers to overwrite the same path. If the
		// path is merely on disk, overwrite it; if reserved, allocate a suffix.
		if unavailable == nil || !unavailable(candidate) {
			return candidate, false, nil
		}
	case "跳过已有":
		return candidate, true, nil
	}
	for i := 1; ; i++ {
		c := filepath.Join(dir, fmt.Sprintf("%s_%d%s", base, i, ext))
		if !exists(c) {
			return c, false, nil
		}
	}
}

const maxOutputReservationAttempts = 64

// ResolveAndReserveOutput closes the race between choosing an output path and
// reserving it. Multiple workers with the same basename may all observe the
// same free candidate; losers keep resolving until each task owns a unique
// path or an explicit error/skip result is reached.
func ResolveAndReserveOutput(
	input, root, outputDir string,
	kind model.Kind,
	opts model.TaskOptions,
	settings model.Settings,
	unavailable func(string) bool,
	reserve func(string) bool,
) (path string, skip bool, err error) {
	if reserve == nil {
		return ResolveOutputPathAvoiding(input, root, outputDir, kind, opts, settings, unavailable)
	}
	for attempt := 0; attempt < maxOutputReservationAttempts; attempt++ {
		path, skip, err = ResolveOutputPathAvoiding(input, root, outputDir, kind, opts, settings, unavailable)
		if err != nil || skip {
			return path, skip, err
		}
		if reserve(path) {
			return path, false, nil
		}
	}
	return "", false, fmt.Errorf("无法为并发任务分配唯一输出路径（已重试 %d 次）", maxOutputReservationAttempts)
}

func PreserveTimes(src, dst string) error { return preserveTimesPlatform(src, dst) }

// PreserveOutputTreeTimes restores all recreated source directories below root.
// It walks deepest-first so setting a child directory cannot dirty an already
// restored parent directory. Root itself is excluded because it is the parent
// of the user-selected top-level folder.
func PreserveOutputTreeTimes(input, root, outputRoot string) error {
	root, outputPrefix := DecodeRootContext(root)
	outputRoot = OutputRootWithPrefix(outputRoot, outputPrefix)
	if strings.TrimSpace(root) == "" || strings.TrimSpace(outputRoot) == "" {
		return nil
	}
	sourceDir := filepath.Dir(input)
	rel, err := filepath.Rel(root, sourceDir)
	if err != nil || rel == "." || rel == "" || strings.HasPrefix(rel, "..") {
		return err
	}
	parts := strings.FieldsFunc(filepath.Clean(rel), func(r rune) bool { return r == '/' || r == '\\' })
	var first error
	for i := len(parts); i >= 1; i-- {
		relDir := filepath.Join(parts[:i]...)
		src := filepath.Join(root, relDir)
		dst := filepath.Join(outputRoot, relDir)
		if err := preserveTimesPlatform(src, dst); err != nil && first == nil {
			first = err
		}
	}
	return first
}

func FileSize(path string) int64 {
	if st, err := os.Stat(path); err == nil {
		return st.Size()
	}
	return 0
}

func RemoveOldFiles(dir string, olderThan time.Duration) {
	entries, _ := os.ReadDir(dir)
	cut := time.Now().Add(-olderThan)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		p := filepath.Join(dir, e.Name())
		if st, err := e.Info(); err == nil && st.ModTime().Before(cut) {
			_ = os.Remove(p)
		}
	}
}

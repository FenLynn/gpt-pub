package media

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func IsModernImageInput(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".heic", ".heif", ".avif":
		return true
	default:
		return false
	}
}

func ExplainModernImageFailure(path string, err error) error {
	if err == nil || !IsModernImageInput(path) {
		return err
	}
	return fmt.Errorf("Windows HEIF 图像扩展无法解码 %s。请检查系统的 HEIF 图像扩展与 HEVC 视频扩展；源文件未被修改：%w", strings.ToUpper(strings.TrimPrefix(filepath.Ext(path), ".")), err)
}

func PreflightModernImage(parent context.Context, ffmpeg, input string) error {
	if !IsModernImageInput(input) {
		return nil
	}
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	_, err := ProbeModernImageWIC(ctx, input)
	if err == nil {
		return nil
	}
	return ExplainModernImageFailure(input, fmt.Errorf("Windows 解码预检失败：%w", err))
}

// DecodeModernImageForFFmpeg leaves the source untouched. The temporary PNG
// lives beside the requested output so its space usage is visible and its
// lifetime is bound to the conversion task.
func DecodeModernImageForFFmpeg(ctx context.Context, ffmpeg, input, output string) (string, int, error) {
	dir := filepath.Dir(output)
	file, err := os.CreateTemp(dir, ".mediova-heif-*.png")
	if err != nil {
		return "", 0, fmt.Errorf("创建 HEIC 临时文件失败：%w", err)
	}
	temporary := file.Name()
	if closeErr := file.Close(); closeErr != nil {
		_ = os.Remove(temporary)
		return "", 0, closeErr
	}
	// WIC creates the file itself. Leaving an existing empty file can make a
	// codec treat it as a read/write stream rather than a new PNG target.
	_ = os.Remove(temporary)
	if _, err := DecodeModernImageToPNG(ctx, input, temporary); err != nil {
		_ = os.Remove(temporary)
		return "", 0, ExplainModernImageFailure(input, err)
	}
	return temporary, modernImageOrientation(ctx, ffmpeg, input), nil
}

func modernImageOrientation(parent context.Context, ffmpeg, input string) int {
	tool := FindExifTool(ffmpeg)
	if tool == "" {
		return 1
	}
	ctx, cancel := context.WithTimeout(parent, 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, tool, "-s3", "-n", "-Orientation#", input)
	configureCommand(cmd)
	b, err := cmd.Output()
	if err != nil {
		return 1
	}
	v, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil || v < 1 || v > 8 {
		return 1
	}
	return v
}

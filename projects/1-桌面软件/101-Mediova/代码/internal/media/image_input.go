package media

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
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
	return fmt.Errorf("当前 FFmpeg 无法解码 %s。请更换支持 HEIC/HEIF/AVIF 的完整 FFmpeg 构建；源文件未被修改：%w", strings.ToUpper(strings.TrimPrefix(filepath.Ext(path), ".")), err)
}

func PreflightModernImage(parent context.Context, ffmpeg, input string) error {
	if !IsModernImageInput(input) {
		return nil
	}
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-v", "error", "-i", input, "-frames:v", "1", "-f", "null", nullDevice())
	configureCommand(cmd)
	output, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}
	detail := strings.TrimSpace(string(output))
	if len(detail) > 500 {
		detail = detail[len(detail)-500:]
	}
	if detail == "" {
		detail = err.Error()
	}
	return ExplainModernImageFailure(input, fmt.Errorf("解码预检失败：%s", detail))
}

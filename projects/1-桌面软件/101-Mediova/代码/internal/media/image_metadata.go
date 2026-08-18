package media

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"mediaworkbench/internal/config"
)

func existingExifTool(path string) string {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "." || path == "" {
		return ""
	}
	if info, err := os.Stat(path); err == nil && !info.IsDir() && info.Size() > 0 {
		return path
	}
	return ""
}

// FindExifTool locates the bundled metadata writer first. Keeping it separate
// from FFmpeg is deliberate: FFmpeg preserves container tags but does not
// reliably rewrite EXIF/IPTC/XMP/ICC blocks when an image changes format.
func FindExifTool(ffmpeg string) string {
	var candidates []string
	if configured := strings.TrimSpace(os.Getenv("MEDIOVA_EXIFTOOL_PATH")); configured != "" {
		if info, err := os.Stat(configured); err == nil && info.IsDir() {
			candidates = append(candidates, filepath.Join(configured, executableName("exiftool")))
		} else {
			candidates = append(candidates, configured)
		}
	}
	if components, err := config.RuntimeComponentsDir(); err == nil {
		candidates = append(candidates, filepath.Join(components, "ExifTool", executableName("exiftool")))
	}
	if strings.TrimSpace(ffmpeg) != "" {
		bin := filepath.Dir(ffmpeg)
		candidates = append(candidates,
			filepath.Join(bin, executableName("exiftool")),
			filepath.Join(bin, "..", "..", "ExifTool", executableName("exiftool")),
		)
	}
	if found, err := exec.LookPath(executableName("exiftool")); err == nil {
		candidates = append(candidates, found)
	}
	seen := map[string]bool{}
	for _, candidate := range candidates {
		candidate = filepath.Clean(candidate)
		key := strings.ToLower(candidate)
		if seen[key] {
			continue
		}
		seen[key] = true
		if found := existingExifTool(candidate); found != "" {
			return found
		}
	}
	return ""
}

// PreserveImageMetadata copies every writable EXIF/IPTC/XMP/ICC tag while
// keeping tag groups intact. Orientation is normalized because FFmpeg has
// already applied it to the pixels. File creation/access/write times are
// restored separately by PreserveTimes after output verification.
func PreserveImageMetadata(ctx context.Context, ffmpeg, src, dst string) (string, error) {
	tool := FindExifTool(ffmpeg)
	if tool == "" {
		if strings.EqualFold(filepath.Ext(src), ".jpg") && strings.EqualFold(filepath.Ext(dst), ".jpg") {
			if err := CopyJPEGExif(src, dst); err != nil {
				return "JPEG EXIF兼容保留", err
			}
			return "JPEG EXIF兼容保留", nil
		}
		return "ExifTool完整元数据", errors.New("缺少 ExifTool，无法保证完整保留图片 EXIF/IPTC/XMP/ICC；为避免静默丢失元数据，本次没有接受转换结果")
	}
	cmd := exec.CommandContext(ctx, tool,
		"-m", "-q", "-P", "-overwrite_original",
		"-TagsFromFile", src,
		"-All:All", "-unsafe", "-icc_profile",
		"-Orientation#=1",
		dst,
	)
	configureCommand(cmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		detail := strings.TrimSpace(string(output))
		if len(detail) > 600 {
			detail = detail[len(detail)-600:]
		}
		if detail == "" {
			detail = err.Error()
		}
		return "ExifTool完整元数据", fmt.Errorf("复制图片 EXIF/IPTC/XMP/ICC 失败：%s", detail)
	}
	return "ExifTool完整元数据", nil
}

// PreserveVideoDateMetadata restores writable container date tags after
// FFmpeg has written the output. FFmpeg's -map_metadata keeps ordinary tags,
// while this pass covers QuickTime track/media dates and XMP/EXIF dates that
// are commonly present in phone and camera video. Rotation is deliberately
// excluded because FFmpeg has already applied it to the pixels.
func PreserveVideoDateMetadata(ctx context.Context, ffmpeg, src, dst string) (string, error) {
	tool := FindExifTool(ffmpeg)
	if tool == "" {
		return "视频日期元数据", errors.New("缺少 ExifTool，无法保证完整保留视频容器日期元数据")
	}
	args := []string{
		"-m", "-q", "-P", "-overwrite_original",
		"-TagsFromFile", src,
		"-QuickTime:CreateDate", "-QuickTime:ModifyDate",
		"-QuickTime:TrackCreateDate", "-QuickTime:TrackModifyDate",
		"-QuickTime:MediaCreateDate", "-QuickTime:MediaModifyDate",
		"-QuickTime:DateTimeOriginal",
		"-XMP:CreateDate", "-XMP:ModifyDate", "-XMP:DateTimeOriginal",
		"-EXIF:CreateDate", "-EXIF:ModifyDate", "-EXIF:DateTimeOriginal",
		dst,
	}
	cmd := exec.CommandContext(ctx, tool, args...)
	configureCommand(cmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		detail := strings.TrimSpace(string(output))
		if len(detail) > 600 {
			detail = detail[len(detail)-600:]
		}
		if detail == "" {
			detail = err.Error()
		}
		return "视频日期元数据", fmt.Errorf("复制视频日期元数据失败：%s", detail)
	}
	return "视频日期元数据保留", nil
}

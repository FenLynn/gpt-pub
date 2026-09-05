package media

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
)

type FormatCapabilities struct {
	H264 bool
	H265 bool
	WebP bool
	AVIF bool
}

func ParseFormatCapabilities(encoders, muxers string) FormatCapabilities {
	encoders = strings.ToLower(encoders)
	muxers = strings.ToLower(muxers)
	containsEncoder := func(names ...string) bool {
		for _, name := range names {
			if strings.Contains(encoders, name) {
				return true
			}
		}
		return false
	}
	return FormatCapabilities{
		H264: containsEncoder("libx264", "h264_nvenc", "h264_qsv", "h264_amf"),
		H265: containsEncoder("libx265", "hevc_nvenc", "hevc_qsv", "hevc_amf"),
		WebP: containsEncoder("libwebp") && strings.Contains(muxers, "webp"),
		AVIF: containsEncoder("libaom-av1", "libsvtav1", "librav1e") && strings.Contains(muxers, "avif"),
	}
}

func capabilityCommand(ctx context.Context, path string, args ...string) string {
	if strings.TrimSpace(path) == "" {
		return ""
	}
	cmd := exec.CommandContext(ctx, path, args...)
	configureCommand(cmd)
	data, err := cmd.CombinedOutput()
	if err != nil && len(data) == 0 {
		return ""
	}
	return string(data)
}

func firstCapabilityLine(value string) string {
	for _, line := range strings.Split(strings.ReplaceAll(value, "\r", ""), "\n") {
		if strings.TrimSpace(line) != "" {
			return strings.TrimSpace(line)
		}
	}
	return "不可用"
}

func yesNo(value bool) string {
	if value {
		return "可用"
	}
	return "不可用"
}

// DetectCapabilityReport is an explicit, bounded diagnostic. It is never run
// during startup, preserving the instant main-window behaviour for large jobs.
func DetectCapabilityReport(ctx context.Context, ffmpeg, ffprobe string, hardware Hardware, player string, playerOK bool) string {
	version := capabilityCommand(ctx, ffmpeg, "-version")
	encoders := capabilityCommand(ctx, ffmpeg, "-hide_banner", "-encoders")
	muxers := capabilityCommand(ctx, ffmpeg, "-hide_banner", "-muxers")
	ffprobeVersion := capabilityCommand(ctx, ffprobe, "-version")
	caps := ParseFormatCapabilities(encoders, muxers)
	exifTool := FindExifTool(ffmpeg)
	exifVersion := "不可用"
	if exifTool != "" {
		exifVersion = firstCapabilityLine(capabilityCommand(ctx, exifTool, "-ver"))
	}
	playerLabel := "不可用"
	if playerOK {
		playerLabel = filepath.Base(player)
	}
	gpu := "不可用"
	if hardware.Available {
		gpu = strings.TrimSpace(hardware.Detail)
		if gpu == "" {
			gpu = strings.TrimSpace(hardware.Vendor)
		}
	}
	return fmt.Sprintf("FFmpeg：%s\r\nFFprobe：%s\r\n\r\n视频输出\r\n  H.264：%s\r\n  H.265/HEVC：%s\r\n\r\n图片输出\r\n  JPG / PNG：%s\r\n  WebP：%s\r\n  AVIF：%s\r\n\r\n现代图片输入\r\n  HEIC / HEIF：使用 Windows WIC，按实际文件逐个验证\r\n  AVIF：FFmpeg/WIC 能力取决于文件与系统扩展\r\n\r\n元数据：ExifTool %s\r\nGPU：%s\r\n播放器：%s\r\n\r\n说明：能力检测只核对本机组件，不修改任务、文件或设置。", firstCapabilityLine(version), firstCapabilityLine(ffprobeVersion), yesNo(caps.H264), yesNo(caps.H265), yesNo(strings.TrimSpace(ffmpeg) != ""), yesNo(caps.WebP), yesNo(caps.AVIF), exifVersion, gpu, playerLabel)
}

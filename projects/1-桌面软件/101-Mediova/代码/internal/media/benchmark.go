package media

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"mediaworkbench/internal/model"
)

// BenchmarkEncoders measures short synthetic 720p encodes. The result is a
// relative real-time multiplier (2.0 means two times faster than playback).
// It is intentionally short so it can run once after a new FFmpeg/driver is
// detected without becoming a full stress test.
func BenchmarkEncoders(ctx context.Context, ffmpeg string, hw Hardware) model.BenchmarkProfile {
	result := model.BenchmarkProfile{TestedAt: time.Now().Format(time.RFC3339), GPUVendor: hw.Vendor, FFmpegPath: ffmpeg}
	if ffmpeg == "" {
		return result
	}
	result.CPUH264X = benchmarkOne(ctx, ffmpeg, "libx264", []string{"-preset", "veryfast", "-crf", "23"})
	result.CPUH265X = benchmarkOne(ctx, ffmpeg, "libx265", []string{"-preset", "fast", "-crf", "25"})
	if hw.Available {
		if hw.H264 != "" {
			result.GPUH264X = benchmarkOne(ctx, ffmpeg, hw.H264, benchmarkGPUArgs(hw.H264))
		}
		if hw.H265 != "" {
			result.GPUH265X = benchmarkOne(ctx, ffmpeg, hw.H265, benchmarkGPUArgs(hw.H265))
		}
	}
	return result
}

func benchmarkGPUArgs(enc string) []string {
	switch {
	case strings.Contains(enc, "nvenc"):
		return []string{"-preset", "p4", "-rc", "vbr", "-cq", "24", "-b:v", "0"}
	case strings.Contains(enc, "qsv"):
		return []string{"-preset", "medium", "-global_quality", "24"}
	case strings.Contains(enc, "amf"):
		return []string{"-quality", "balanced", "-rc", "cqp", "-qp_i", "24", "-qp_p", "24"}
	default:
		return nil
	}
}

func benchmarkOne(parent context.Context, ffmpeg, encoder string, encoderArgs []string) float64 {
	ctx, cancel := context.WithTimeout(parent, 18*time.Second)
	defer cancel()
	const mediaSeconds = 3.0
	args := []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", fmt.Sprintf("testsrc2=size=1280x720:rate=30:duration=%.0f", mediaSeconds),
		"-an", "-pix_fmt", "yuv420p", "-c:v", encoder,
	}
	args = append(args, encoderArgs...)
	args = append(args, "-f", "null", nullDevice())
	cmd := exec.CommandContext(ctx, ffmpeg, args...)
	configureCommand(cmd)
	start := time.Now()
	if err := cmd.Run(); err != nil {
		return 0
	}
	elapsed := time.Since(start).Seconds()
	if elapsed <= 0 {
		return 0
	}
	return mediaSeconds / elapsed
}

// PreferGPU reports whether the stored benchmark supports using the hardware
// encoder for the selected codec. A small margin avoids moving work to the GPU
// when the measured advantage is negligible.
func PreferGPU(profile model.BenchmarkProfile, codec string) bool {
	if strings.Contains(strings.ToUpper(codec), "264") {
		return profile.GPUH264X > 0 && (profile.CPUH264X <= 0 || profile.GPUH264X >= profile.CPUH264X*1.12)
	}
	return profile.GPUH265X > 0 && (profile.CPUH265X <= 0 || profile.GPUH265X >= profile.CPUH265X*1.12)
}

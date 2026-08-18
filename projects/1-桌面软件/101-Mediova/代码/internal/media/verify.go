package media

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"strings"
	"time"

	"mediaworkbench/internal/model"
)

type VerificationResult struct {
	Warning  string
	Category string
}

func ClassifyFailure(err error) string {
	if err == nil {
		return ""
	}
	s := strings.ToLower(err.Error())
	switch {
	case errors.Is(err, context.Canceled), strings.Contains(s, "context canceled"), strings.Contains(s, "任务已停止"):
		return "用户停止"
	case strings.Contains(s, "no such file"), strings.Contains(s, "cannot find"), strings.Contains(s, "找不到指定"), strings.Contains(s, "源文件不存在"):
		return "源文件缺失"
	case strings.Contains(s, "permission denied"), strings.Contains(s, "access is denied"), strings.Contains(s, "拒绝访问"):
		return "权限不足"
	case strings.Contains(s, "no space left"), strings.Contains(s, "disk full"), strings.Contains(s, "磁盘空间不足"):
		return "磁盘空间不足"
	case strings.Contains(s, "unknown encoder"), strings.Contains(s, "cannot load"), strings.Contains(s, "device setup failed"), strings.Contains(s, "no capable devices"):
		return "编码器不可用"
	case strings.Contains(s, "windows heif"), strings.Contains(s, "heic 图像扩展"), strings.Contains(s, "heif 图像扩展"):
		return "HEIC/HEIF 解码不可用"
	case strings.Contains(s, "invalid data"), strings.Contains(s, "moov atom not found"), strings.Contains(s, "could not find codec parameters"), strings.Contains(s, "检测失败"):
		return "输入媒体损坏或不支持"
	case strings.Contains(s, "目标体积"):
		return "目标体积处理失败"
	case strings.Contains(s, "输出路径"):
		return "输出路径错误"
	default:
		return "其他错误"
	}
}

// EstimateOutputBytes provides a conservative preflight estimate. It is used
// only for disk-space warnings and never changes encoding parameters.
func EstimateOutputBytes(t *model.Task, opts model.TaskOptions) int64 {
	if t == nil {
		return 0
	}
	if t.Kind == model.KindImage {
		limit := imageLimitBytes(opts.ImageLimit)
		if limit > 0 {
			return limit
		}
		if t.InputSize > 0 {
			if strings.EqualFold(opts.ImageFormat, "PNG") {
				return t.InputSize
			}
			return int64(float64(t.InputSize) * .75)
		}
		return 4 * 1024 * 1024
	}
	if opts.VolumeMode == "目标体积" && opts.TargetSizeMB > 0 {
		return int64(opts.TargetSizeMB) * 1024 * 1024
	}
	duration := t.Duration
	if opts.TrimEnd > opts.TrimStart {
		duration = opts.TrimEnd - opts.TrimStart
	}
	if duration > 0 && opts.VolumeMode == "码率优先" && opts.BitrateMbps > 0 {
		return int64(duration * (opts.BitrateMbps*1_000_000 + 192_000) / 8 * 1.04)
	}
	if t.InputSize > 0 {
		factor := .72
		if strings.Contains(strings.ToUpper(opts.Codec), "265") {
			factor = .58
		}
		return int64(float64(t.InputSize) * factor)
	}
	return 500 * 1024 * 1024
}

func ValidateOutputPresence(path string) error {
	st, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("输出文件不存在: %w", err)
	}
	if st.IsDir() {
		return fmt.Errorf("输出路径不是文件")
	}
	if st.Size() <= 64 {
		return fmt.Errorf("输出文件为空或不完整")
	}
	return nil
}

func VerifyOutput(ctx context.Context, ffmpeg, ffprobe string, req ConvertRequest) (VerificationResult, error) {
	if err := ValidateOutputPresence(req.Output); err != nil {
		return VerificationResult{Category: "输出文件无效"}, err
	}
	if req.Kind == model.KindImage {
		if ffmpeg != "" {
			vctx, cancel := context.WithTimeout(ctx, 20*time.Second)
			defer cancel()
			cmd := exec.CommandContext(vctx, ffmpeg, "-v", "error", "-i", req.Output, "-frames:v", "1", "-f", "null", nullDevice())
			configureCommand(cmd)
			if b, e := cmd.CombinedOutput(); e != nil {
				return VerificationResult{Category: "输出解码失败"}, fmt.Errorf("图片输出无法解码: %s", strings.TrimSpace(string(b)))
			}
		}
		return VerificationResult{}, nil
	}
	if ffprobe == "" {
		return VerificationResult{Warning: "未找到 FFprobe，已跳过输出参数核验"}, nil
	}
	p, err := Probe(ffprobe, req.Output)
	if err != nil {
		return VerificationResult{Category: "输出探测失败"}, fmt.Errorf("输出文件无法读取: %w", err)
	}
	expected := durationFor(req)
	tolerance := math.Max(2.0, expected*.05)
	var warnings []string
	if expected > 0 && math.Abs(p.Duration-expected) > tolerance {
		warnings = append(warnings, fmt.Sprintf("输出时长 %.2fs 与预期 %.2fs 偏差较大", p.Duration, expected))
	}
	if req.Probe.AudioStreams > 0 && req.Settings.AudioMode != "静音" && p.AudioStreams != req.Probe.AudioStreams {
		return VerificationResult{Category: "输出轨道不完整"}, fmt.Errorf("输出音轨数量 %d，与预期 %d 不一致", p.AudioStreams, req.Probe.AudioStreams)
	}
	expectedSubs := expectedTextSubtitleStreams(req)
	if p.SubtitleStreams != expectedSubs {
		return VerificationResult{Category: "输出轨道不完整"}, fmt.Errorf("输出文本字幕数量 %d，与预期 %d 不一致", p.SubtitleStreams, expectedSubs)
	}
	if req.Probe.VariableFrameRate && !p.VariableFrameRate {
		warnings = append(warnings, "源视频为可变帧率，输出未被 FFprobe 明确识别为 VFR")
	}
	// Decode three representative frames. This catches truncated MP4 files and
	// streams that ffprobe can list but FFmpeg cannot actually decode.
	if ffmpeg != "" && p.Duration > 0 {
		points := []float64{0, p.Duration * .5, math.Max(0, p.Duration-.2)}
		for _, at := range points {
			vctx, cancel := context.WithTimeout(ctx, 20*time.Second)
			cmd := exec.CommandContext(vctx, ffmpeg, "-v", "error", "-ss", formatSeconds(at), "-i", req.Output, "-frames:v", "1", "-f", "null", nullDevice())
			configureCommand(cmd)
			b, e := cmd.CombinedOutput()
			cancel()
			if e != nil {
				return VerificationResult{Category: "输出解码失败"}, fmt.Errorf("输出在 %.2fs 处无法解码: %s", at, strings.TrimSpace(string(b)))
			}
		}
	}
	return VerificationResult{Warning: strings.Join(warnings, "；")}, nil
}

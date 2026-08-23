package media

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/model"
)

type Hardware struct {
	Available bool
	Vendor    string
	H264      string
	H265      string
	Detail    string
}

type ConvertRequest struct {
	Input string
	// MetadataInput remains the original source when a modern image is decoded
	// by WIC into a temporary PNG for FFmpeg.
	MetadataInput    string
	Output           string
	Kind             model.Kind
	Probe            ProbeInfo
	Options          model.TaskOptions
	Settings         model.Settings
	Hardware         Hardware
	Preview          bool
	PreviewDur       float64
	VideoBitrateKbps int
	ExtraScale       float64
	// InputOrientation is an EXIF orientation value applied only after a WIC
	// HEIC decode. FFmpeg cannot see that metadata once the input is a PNG.
	InputOrientation int
}

type ProgressFunc func(percent float64, stage string)

func FindFFmpeg(configured string) (ffmpeg, ffprobe string, ok bool) {
	var candidates []string
	if configured != "" {
		candidates = append(candidates, configured)
	}
	if runtimeBin, err := config.RuntimeFFmpegBinDir(); err == nil {
		candidates = append(candidates, filepath.Join(runtimeBin, executableName("ffmpeg")))
	}
	// Legacy AppData remains a read-only compatibility fallback for one full
	// release cycle. New imports are always written into the transparent Runtime.
	if local, err := config.LocalDir(); err == nil {
		candidates = append(candidates,
			filepath.Join(local, "ffmpeg", "bin", executableName("ffmpeg")),
			filepath.Join(local, "ffmpeg", executableName("ffmpeg")))
	}
	if exe, err := os.Executable(); err == nil {
		d := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(d, executableName("ffmpeg")),
			filepath.Join(d, "tools", executableName("ffmpeg")),
			filepath.Join(d, "ffmpeg", "bin", executableName("ffmpeg")))
	}
	if q, err := exec.LookPath("ffmpeg"); err == nil {
		candidates = append(candidates, q)
	}
	seen := map[string]bool{}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		candidate = filepath.Clean(candidate)
		key := strings.ToLower(candidate)
		if seen[key] {
			continue
		}
		seen[key] = true
		if st, err := os.Stat(candidate); err != nil || st.IsDir() {
			continue
		}
		probe := filepath.Join(filepath.Dir(candidate), executableName("ffprobe"))
		if _, err := os.Stat(probe); err != nil {
			if q, e := exec.LookPath("ffprobe"); e == nil {
				probe = q
			} else {
				continue
			}
		}
		if !runnableFFmpegPair(candidate, probe) {
			continue
		}
		return candidate, probe, true
	}
	return "", "", false
}

const ffmpegVersionProbeTimeout = 2 * time.Second

func runnableFFmpegPair(ffmpeg, ffprobe string) bool {
	return runnableVersionBinary(ffmpeg) && runnableVersionBinary(ffprobe)
}

// runnableVersionBinary is deliberately much lighter than codec, decoder or
// GPU detection. It only rejects stale shims, corrupt downloads and binaries
// for the wrong operating system before they can become the active component.
func runnableVersionBinary(path string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), ffmpegVersionProbeTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "-version")
	configureCommand(cmd)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	err := cmd.Run()
	return err == nil && ctx.Err() == nil
}

func executableName(name string) string {
	if filepath.Ext(os.Args[0]) == ".exe" || os.PathSeparator == '\\' {
		return name + ".exe"
	}
	return name
}

// DetectHardwareQuick performs only a bounded encoder-list query. It is safe
// for background startup discovery and intentionally does not launch any real
// encode. Full hardware invocation testing remains an explicit user action.
func DetectHardwareQuick(parent context.Context, ffmpeg string) Hardware {
	if ffmpeg == "" {
		return Hardware{Detail: "未找到 FFmpeg"}
	}
	ctx, cancel := context.WithTimeout(parent, 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-encoders")
	configureCommand(cmd)
	b, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() != nil {
			return Hardware{Detail: "FFmpeg 编码器列表检测超时；不影响使用 CPU 转换。"}
		}
		return Hardware{Detail: "无法读取 FFmpeg 编码器列表；不影响使用 CPU 转换：" + err.Error()}
	}
	s := string(b)
	for _, h := range []Hardware{
		{Vendor: "NVIDIA NVENC", H264: "h264_nvenc", H265: "hevc_nvenc"},
		{Vendor: "Intel QSV", H264: "h264_qsv", H265: "hevc_qsv"},
		{Vendor: "AMD AMF", H264: "h264_amf", H265: "hevc_amf"},
	} {
		if strings.Contains(s, h.H264) || strings.Contains(s, h.H265) {
			// Listing an encoder is not proof that the current driver/session can
			// open it. Keep Available=false until the explicit benchmark succeeds.
			h.Detail = "FFmpeg 已列出 " + h.Vendor + "。尚未执行真实编码测试；当前默认使用 CPU，可在 FFmpeg 菜单中手动测速验证。"
			return h
		}
	}
	return Hardware{Detail: "FFmpeg 未列出 NVENC/QSV/AMF；当前使用 CPU。"}
}

func DetectHardware(ctx context.Context, ffmpeg string) Hardware {
	if ffmpeg == "" {
		return Hardware{Detail: "未找到 FFmpeg"}
	}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-encoders")
	configureCommand(cmd)
	b, err := cmd.CombinedOutput()
	if err != nil {
		return Hardware{Detail: "无法读取 FFmpeg 编码器列表: " + err.Error()}
	}
	s := string(b)
	candidates := []Hardware{
		{Vendor: "NVIDIA NVENC", H264: "h264_nvenc", H265: "hevc_nvenc"},
		{Vendor: "Intel QSV", H264: "h264_qsv", H265: "hevc_qsv"},
		{Vendor: "AMD AMF", H264: "h264_amf", H265: "hevc_amf"},
	}
	var listed []string
	for _, h := range candidates {
		enc := ""
		if strings.Contains(s, h.H265) {
			enc = h.H265
		} else if strings.Contains(s, h.H264) {
			enc = h.H264
		}
		if enc == "" {
			continue
		}
		listed = append(listed, h.Vendor)
		// “编码器出现在列表里”不代表当前机器真的能调用。执行一个极短的
		// 64×64 编码冒烟测试，避免驱动缺失、远程桌面或硬件不支持时误判。
		testCtx, testCancel := context.WithTimeout(ctx, 8*time.Second)
		test := exec.CommandContext(testCtx, ffmpeg,
			"-hide_banner", "-loglevel", "error",
			"-f", "lavfi", "-i", "color=c=black:s=64x64:r=10:d=0.25",
			"-frames:v", "2", "-pix_fmt", "yuv420p", "-c:v", enc,
			"-f", "null", nullDevice())
		configureCommand(test)
		testOut, testErr := test.CombinedOutput()
		testCancel()
		if testErr == nil {
			h.Available = true
			h.Detail = "检测到并通过调用测试：" + h.Vendor + "；任务失败时可自动回退 CPU。"
			return h
		}
		detail := strings.TrimSpace(string(testOut))
		if len(detail) > 220 {
			detail = detail[:220] + "…"
		}
		if detail == "" {
			detail = testErr.Error()
		}
		h.Detail = "检测到 " + h.Vendor + "，但本机调用测试未通过；当前将使用 CPU。原因：" + detail
		// 继续测试其他厂商编码器，部分 FFmpeg 构建会同时列出多个后端。
	}
	if len(listed) > 0 {
		return Hardware{Detail: "检测到 FFmpeg 硬件编码器（" + strings.Join(listed, "、") + "），但本机调用测试均未通过；当前将使用 CPU。"}
	}
	return Hardware{Detail: "FFmpeg 未列出 NVENC/QSV/AMF 硬件编码器。"}
}

func DetectPotPlayer(configured string) (string, bool, string) {
	var candidates []string
	if configured != "" {
		candidates = append(candidates, configured)
	}
	// Common executable names
	exeNames := []string{"PotPlayer64.exe", "PotPlayer.exe", "PotPlayerMini64.exe", "PotPlayerMini.exe"}
	for _, exe := range exeNames {
		if p, err := exec.LookPath(exe); err == nil && p != "" {
			candidates = append(candidates, p)
		}
	}
	var bases []string
	for _, env := range []string{"ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "LOCALAPPDATA", "APPDATA"} {
		if v := os.Getenv(env); v != "" {
			bases = append(bases, v)
		}
	}
	// Also check common fixed drive roots
	for _, drive := range []string{"C:", "D:", "E:", "F:"} {
		bases = append(bases,
			filepath.Join(drive, "Program Files"),
			filepath.Join(drive, "Program Files (x86)"),
			filepath.Join(drive, "PotPlayer"),
			filepath.Join(drive, "DAUM", "PotPlayer"),
			filepath.Join(drive, "Software", "PotPlayer"),
			filepath.Join(drive, "Tools", "PotPlayer"),
		)
	}
	for _, base := range bases {
		if base == "" {
			continue
		}
		for _, exe := range exeNames {
			candidates = append(candidates,
				filepath.Join(base, exe),
				filepath.Join(base, "DAUM", "PotPlayer", exe),
				filepath.Join(base, "PotPlayer", exe),
				filepath.Join(base, "DAUM", exe),
			)
		}
	}
	for _, p := range candidates {
		if p == "" {
			continue
		}
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p, true, "已找到 PotPlayer"
		}
	}
	return "", false, "未找到 PotPlayer，可手动指定或使用 Windows 默认播放器"
}

func qualityCRF(q string) string {
	switch q {
	case "高":
		return "18"
	case "低":
		return "28"
	default:
		return "23"
	}
}
func nvencCQ(q string) string {
	switch q {
	case "高":
		return "19"
	case "低":
		return "29"
	default:
		return "24"
	}
}
func imageQuality(q string) string {
	switch q {
	case "高":
		return "2"
	case "低":
		return "7"
	default:
		return "4"
	}
}

func MaxEdge(res string) int {
	switch res {
	case "4K", "高质量 4K":
		return 3840
	case "1080P", "手机视频 1080P":
		return 1920
	case "720P", "小体积 720P":
		return 1280
	case "480P":
		return 854
	case "原尺寸", "原始", "原尺寸仅转正":
		return 0
	default:
		if strings.HasPrefix(res, "最大边 ") {
			n, _ := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(res, "最大边 "), "px"))
			return n
		}
		return 1920
	}
}

func rotationFilter(rotation string) string {
	switch rotation {
	case "90°右转":
		return "transpose=1"
	case "90°左转":
		return "transpose=2"
	case "180°":
		return "hflip,vflip"
	case "左右翻转":
		return "hflip"
	case "上下翻转":
		return "vflip"
	default:
		return ""
	}
}

func scaleFilter(res string, allowUpscale bool) string {
	edge := MaxEdge(res)
	if edge <= 0 {
		return ""
	}
	if allowUpscale {
		return fmt.Sprintf("scale='if(gte(iw,ih),%d,-2)':'if(gte(iw,ih),-2,%d)':flags=lanczos", edge, edge)
	}
	return fmt.Sprintf("scale='if(gte(iw,ih),min(iw,%d),-2)':'if(gte(iw,ih),-2,min(ih,%d))':flags=lanczos", edge, edge)
}

func BuildFilters(req ConvertRequest) string {
	var filters []string
	if of := imageOrientationFilter(req.InputOrientation); of != "" {
		filters = append(filters, of)
	}
	if rf := rotationFilter(req.Options.Rotation); rf != "" {
		filters = append(filters, rf)
	}
	if req.Options.Crop.Enabled && req.Options.Crop.Width > 1 && req.Options.Crop.Height > 1 {
		filters = append(filters, fmt.Sprintf("crop=%d:%d:%d:%d", req.Options.Crop.Width, req.Options.Crop.Height, req.Options.Crop.X, req.Options.Crop.Y))
	}
	res := req.Options.Resolution
	if req.Kind == model.KindImage {
		res = req.Options.ImageSize
	}
	if sf := scaleFilter(res, req.Settings.AllowUpscale); sf != "" {
		filters = append(filters, sf)
	}
	if req.ExtraScale > 0 && req.ExtraScale < 0.999 {
		filters = append(filters, fmt.Sprintf("scale=trunc(iw*%.4f/2)*2:trunc(ih*%.4f/2)*2:flags=lanczos", req.ExtraScale, req.ExtraScale))
	}
	if req.Kind == model.KindVideo {
		filters = append(filters, "setsar=1")
	}
	return strings.Join(filters, ",")
}

func imageOrientationFilter(orientation int) string {
	switch orientation {
	case 2:
		return "hflip"
	case 3:
		return "hflip,vflip"
	case 4:
		return "vflip"
	case 5:
		return "transpose=0"
	case 6:
		return "transpose=1"
	case 7:
		return "transpose=3"
	case 8:
		return "transpose=2"
	default:
		return ""
	}
}

func commonInputArgs(req ConvertRequest) []string {
	args := []string{"-hide_banner", "-y"}
	if req.Options.TrimStart > 0 {
		args = append(args, "-ss", formatSeconds(req.Options.TrimStart))
	}
	if req.Options.Rotation != "自动" {
		args = append(args, "-noautorotate")
	}
	args = append(args, "-i", req.Input)
	end := req.Options.TrimEnd
	if end > 0 {
		d := end - req.Options.TrimStart
		if d > 0 {
			args = append(args, "-t", formatSeconds(d))
		}
	}
	if req.Preview && req.PreviewDur > 0 {
		args = append(args, "-t", formatSeconds(req.PreviewDur))
	}
	return args
}

func metadataArgs(clear bool) []string {
	if clear {
		return []string{"-map_metadata", "-1", "-map_chapters", "-1"}
	}
	return []string{"-map_metadata", "0", "-map_chapters", "0"}
}

func cpuPresetForCodec(codec, speedMode string) string {
	switch speedMode {
	case "极速":
		return "veryfast"
	case "高质量":
		return "slow"
	}
	// The recovered v2.8.4 H.265 path behaved much closer to x265's fast
	// preset than medium. Keeping H.264 on medium preserves its established
	// balance, while H.265 fast removes a roughly 20% avoidable throughput
	// penalty with only a small compression-efficiency trade-off.
	if strings.Contains(strings.ToUpper(codec), "265") {
		return "fast"
	}
	return "medium"
}

func cpuPreset(speedMode string) string {
	return cpuPresetForCodec("H.264", speedMode)
}

func gpuPreset(enc, speedMode string) string {
	switch {
	case strings.Contains(enc, "nvenc"):
		switch speedMode {
		case "极速":
			return "p2"
		case "高质量":
			return "p7"
		default:
			return "p5"
		}
	case strings.Contains(enc, "qsv"):
		switch speedMode {
		case "极速":
			return "veryfast"
		case "高质量":
			return "slow"
		default:
			return "medium"
		}
	case strings.Contains(enc, "amf"):
		switch speedMode {
		case "极速":
			return "speed"
		case "高质量":
			return "quality"
		default:
			return "balanced"
		}
	}
	return "medium"
}

func cpuCodecArgs(codec, quality, speedMode string) []string {
	preset := cpuPresetForCodec(codec, speedMode)
	if strings.Contains(strings.ToUpper(codec), "264") {
		return []string{"-c:v", "libx264", "-preset", preset, "-crf", qualityCRF(quality)}
	}
	return []string{"-c:v", "libx265", "-preset", preset, "-crf", qualityCRF(quality), "-tag:v", "hvc1"}
}

func gpuCodecArgs(h Hardware, codec, quality, speedMode string) ([]string, bool) {
	enc := h.H265
	if strings.Contains(strings.ToUpper(codec), "264") {
		enc = h.H264
	}
	if enc == "" {
		return nil, false
	}
	switch {
	case strings.Contains(enc, "nvenc"):
		return []string{"-c:v", enc, "-preset", gpuPreset(enc, speedMode), "-tune", "hq", "-rc", "vbr", "-cq", nvencCQ(quality), "-b:v", "0"}, true
	case strings.Contains(enc, "qsv"):
		return []string{"-c:v", enc, "-preset", gpuPreset(enc, speedMode), "-global_quality", nvencCQ(quality)}, true
	case strings.Contains(enc, "amf"):
		return []string{"-c:v", enc, "-quality", gpuPreset(enc, speedMode), "-rc", "cqp", "-qp_i", nvencCQ(quality), "-qp_p", nvencCQ(quality)}, true
	}
	return nil, false
}

func durationFor(req ConvertRequest) float64 {
	d := req.Probe.Duration
	if req.Options.TrimEnd > req.Options.TrimStart {
		d = req.Options.TrimEnd - req.Options.TrimStart
	}
	if req.Preview && req.PreviewDur > 0 && d > req.PreviewDur {
		d = req.PreviewDur
	}
	if d <= 0 {
		d = 1
	}
	return d
}

func bitrateKbps(req ConvertRequest) int {
	if req.VideoBitrateKbps > 0 {
		return req.VideoBitrateKbps
	}
	if req.Options.VolumeMode == "码率优先" && req.Options.BitrateMbps > 0 {
		return int(req.Options.BitrateMbps * 1000)
	}
	if req.Options.VolumeMode == "目标体积" && req.Options.TargetSizeMB > 0 {
		total := float64(req.Options.TargetSizeMB) * 8192 / durationFor(req)
		audio := 192.0
		if !req.Probe.HasAudio || req.Settings.AudioMode == "静音" {
			audio = 0
		} else if req.Settings.AudioMode == "复制音频" && req.Probe.AudioBitrateKbps > 0 {
			audio = float64(req.Probe.AudioBitrateKbps)
		}
		v := int(math.Floor(total - audio - total*0.015))
		if v < 120 {
			v = 120
		}
		return v
	}
	return 0
}

func baseVideoArgs(req ConvertRequest) []string {
	args := commonInputArgs(req)
	args = append(args, "-map", "0:v:0")
	args = append(args, audioMapArgs(req)...)
	args = append(args, subtitleMapArgs(req)...)
	if f := BuildFilters(req); f != "" {
		args = append(args, "-vf", f)
	}
	args = append(args, metadataArgs(req.Settings.ClearMetadata)...)
	return args
}

func audioCodecArgs(req ConvertRequest) []string {
	if expectedAudioStreams(req) == 0 {
		return []string{"-an"}
	}
	if req.Settings.AudioMode == "复制音频" {
		return []string{"-c:a", "copy"}
	}
	return []string{"-c:a", "aac", "-b:a", "192k"}
}

// audioMapArgs deliberately maps individual compatible streams rather than
// 0:a?. Some Apple recordings contain both an ordinary AAC fallback track and
// an Apple Positional Audio Codec (apple_apac) track. FFmpeg can identify that
// codec but the bundled build cannot decode it; mapping every audio stream then
// makes an otherwise playable video fail before progress starts.
func audioMapArgs(req ConvertRequest) []string {
	if !req.Probe.HasAudio || req.Settings.AudioMode == "静音" {
		return nil
	}
	if len(req.Probe.AudioDetails) == 0 {
		// Legacy/synthetic ProbeInfo values do not carry global stream indexes.
		// Real conversions with audio are re-probed immediately before execution.
		return []string{"-map", "0:a?"}
	}
	var args []string
	for _, stream := range req.Probe.AudioDetails {
		if !isCompatibleAudioStream(stream) {
			continue
		}
		args = append(args, "-map", fmt.Sprintf("0:%d?", stream.Index))
	}
	return args
}

func isCompatibleAudioStream(stream StreamInfo) bool {
	switch strings.ToLower(strings.TrimSpace(stream.Codec)) {
	case "apple_apac":
		return false
	default:
		return true
	}
}

func expectedAudioStreams(req ConvertRequest) int {
	if !req.Probe.HasAudio || req.Settings.AudioMode == "静音" {
		return 0
	}
	if len(req.Probe.AudioDetails) == 0 {
		return req.Probe.AudioStreams
	}
	count := 0
	for _, stream := range req.Probe.AudioDetails {
		if isCompatibleAudioStream(stream) {
			count++
		}
	}
	return count
}

func skippedAudioStreams(req ConvertRequest) int {
	if len(req.Probe.AudioDetails) == 0 || req.Settings.AudioMode == "静音" {
		return 0
	}
	skipped := req.Probe.AudioStreams - expectedAudioStreams(req)
	if skipped < 0 {
		return 0
	}
	return skipped
}

func subtitleMapArgs(req ConvertRequest) []string {
	if req.Settings.SubtitleMode != "保留文本字幕" {
		return nil
	}
	if len(req.Probe.SubtitleDetails) == 0 && req.Probe.SubtitleStreams > 0 {
		// Compatibility for synthetic/legacy ProbeInfo values. Real application
		// conversions re-probe before retaining subtitles and therefore use the
		// codec-aware per-stream mapping below.
		return []string{"-map", "0:s?"}
	}
	var args []string
	for _, stream := range req.Probe.SubtitleDetails {
		if stream.TextSubtitle {
			args = append(args, "-map", fmt.Sprintf("0:%d?", stream.Index))
		}
	}
	return args
}

func expectedTextSubtitleStreams(req ConvertRequest) int {
	if req.Settings.SubtitleMode != "保留文本字幕" {
		return 0
	}
	if req.Probe.TextSubtitles > 0 || len(req.Probe.SubtitleDetails) > 0 {
		return req.Probe.TextSubtitles
	}
	return req.Probe.SubtitleStreams
}

func subtitleCodecArgs(req ConvertRequest) []string {
	if expectedTextSubtitleStreams(req) > 0 {
		return []string{"-c:s", "mov_text"}
	}
	return []string{"-sn"}
}

func appendFrameRateMode(args []string, req ConvertRequest) []string {
	if req.Probe.VariableFrameRate {
		return append(args, "-fps_mode", "vfr")
	}
	return args
}

func streamCompatibilityLabel(req ConvertRequest) string {
	parts := []string{}
	if expected := expectedAudioStreams(req); expected > 1 {
		parts = append(parts, fmt.Sprintf("%d音轨", expected))
	}
	if skipped := skippedAudioStreams(req); skipped > 0 {
		parts = append(parts, fmt.Sprintf("跳过%d条不兼容音轨", skipped))
	}
	if req.Settings.SubtitleMode == "保留文本字幕" && req.Probe.SubtitleStreams > 0 {
		parts = append(parts, fmt.Sprintf("文本字幕%d/总%d", req.Probe.TextSubtitles, req.Probe.SubtitleStreams))
	}
	if req.Probe.VariableFrameRate {
		parts = append(parts, "VFR")
	}
	if len(parts) == 0 {
		return ""
	}
	return " · " + strings.Join(parts, " · ")
}

func codecMatchesCopyTarget(source, target string) bool {
	source = strings.ToLower(strings.TrimSpace(source))
	target = strings.ToUpper(strings.TrimSpace(target))
	if strings.Contains(target, "265") {
		return source == "hevc" || source == "h265"
	}
	if strings.Contains(target, "264") {
		return source == "h264" || source == "avc"
	}
	return false
}

func canSmartStreamCopy(req ConvertRequest) bool {
	if req.Kind != model.KindVideo || req.Preview || !req.Settings.SmartStreamCopy {
		return false
	}
	if req.Options.VolumeMode != "质量优先" || MaxEdge(req.Options.Resolution) != 0 {
		return false
	}
	if req.Options.Rotation != "自动" || req.Probe.Rotation != 0 || req.Options.Crop.Enabled {
		return false
	}
	if req.Options.TrimStart > 0 || req.Options.TrimEnd > 0 || req.ExtraScale > 0 {
		return false
	}
	return codecMatchesCopyTarget(req.Probe.VideoCodec, req.Options.Codec)
}

func buildStreamCopyArgs(req ConvertRequest) ([]string, string) {
	args := commonInputArgs(req)
	args = append(args, "-map", "0:v:0")
	args = append(args, audioMapArgs(req)...)
	args = append(args, subtitleMapArgs(req)...)
	args = append(args, metadataArgs(req.Settings.ClearMetadata)...)
	args = append(args, "-c:v", "copy")
	args = append(args, audioCodecArgs(req)...)
	args = append(args, subtitleCodecArgs(req)...)
	args = appendFrameRateMode(args, req)
	args = append(args, "-metadata:s:v:0", "rotate=0", "-movflags", "+faststart+use_metadata_tags", "-progress", "pipe:1", "-nostats", req.Output)
	return args, "视频流智能复制" + streamCompatibilityLabel(req)
}

func buildQualityVideoArgs(req ConvertRequest, useGPU bool) ([]string, string) {
	args := baseVideoArgs(req)
	engine := "CPU高质量"
	if useGPU {
		if c, ok := gpuCodecArgs(req.Hardware, req.Options.Codec, req.Options.Quality, req.Settings.SpeedMode); ok {
			args = append(args, c...)
			engine = req.Hardware.Vendor
		} else {
			args = append(args, cpuCodecArgs(req.Options.Codec, req.Options.Quality, req.Settings.SpeedMode)...)
		}
	} else {
		args = append(args, cpuCodecArgs(req.Options.Codec, req.Options.Quality, req.Settings.SpeedMode)...)
	}
	args = append(args, audioCodecArgs(req)...)
	args = append(args, subtitleCodecArgs(req)...)
	args = appendFrameRateMode(args, req)
	args = append(args, "-metadata:s:v:0", "rotate=0", "-movflags", "+faststart+use_metadata_tags", "-progress", "pipe:1", "-nostats", req.Output)
	return args, engine + streamCompatibilityLabel(req)
}

func buildBitrateVideoArgs(req ConvertRequest, useGPU bool) ([]string, string) {
	args := baseVideoArgs(req)
	kbps := bitrateKbps(req)
	engine := "CPU码率"
	if useGPU {
		enc := req.Hardware.H265
		if strings.Contains(strings.ToUpper(req.Options.Codec), "264") {
			enc = req.Hardware.H264
		}
		if enc != "" {
			args = append(args, "-c:v", enc, "-b:v", fmt.Sprintf("%dk", kbps), "-maxrate", fmt.Sprintf("%dk", int(float64(kbps)*1.15)), "-bufsize", fmt.Sprintf("%dk", kbps*2))
			engine = req.Hardware.Vendor + " 单遍VBR"
		} else {
			args = append(args, cpuCodecArgs(req.Options.Codec, req.Options.Quality, req.Settings.SpeedMode)...)
		}
	} else {
		if strings.Contains(strings.ToUpper(req.Options.Codec), "264") {
			args = append(args, "-c:v", "libx264")
		} else {
			args = append(args, "-c:v", "libx265", "-tag:v", "hvc1")
		}
		args = append(args, "-preset", cpuPresetForCodec(req.Options.Codec, req.Settings.SpeedMode), "-b:v", fmt.Sprintf("%dk", kbps), "-maxrate", fmt.Sprintf("%dk", int(float64(kbps)*1.15)), "-bufsize", fmt.Sprintf("%dk", kbps*2))
	}
	args = append(args, audioCodecArgs(req)...)
	args = append(args, subtitleCodecArgs(req)...)
	args = appendFrameRateMode(args, req)
	args = append(args, "-metadata:s:v:0", "rotate=0", "-movflags", "+faststart+use_metadata_tags", "-progress", "pipe:1", "-nostats", req.Output)
	return args, engine + streamCompatibilityLabel(req)
}

func twoPassArgs(req ConvertRequest, pass int, passlog string) []string {
	args := baseVideoArgs(req)
	kbps := bitrateKbps(req)
	codec := "libx265"
	if strings.Contains(strings.ToUpper(req.Options.Codec), "264") {
		codec = "libx264"
	}
	args = append(args, "-c:v", codec, "-preset", cpuPresetForCodec(req.Options.Codec, req.Settings.SpeedMode), "-b:v", fmt.Sprintf("%dk", kbps), "-pass", strconv.Itoa(pass), "-passlogfile", passlog)
	// Both passes must use the same video synchronization policy. With audio in
	// pass 2, FFmpeg's default CFR muxing can synthesize one trailing frame that
	// pass 1 never analyzed. Older Windows libx264 builds then crash with
	// 0xc0000005. Passthrough forbids that synthesis; real VFR stays explicit.
	if req.Probe.VariableFrameRate {
		args = append(args, "-fps_mode", "vfr")
	} else {
		args = append(args, "-fps_mode", "passthrough")
	}
	if pass == 1 {
		args = append(args, "-an", "-sn", "-f", "null", nullDevice())
	} else {
		args = append(args, audioCodecArgs(req)...)
		args = append(args, subtitleCodecArgs(req)...)
		if codec == "libx265" {
			args = append(args, "-tag:v", "hvc1")
		}
		args = append(args, "-metadata:s:v:0", "rotate=0", "-movflags", "+faststart+use_metadata_tags", "-progress", "pipe:1", "-nostats", req.Output)
	}
	return args
}

func nullDevice() string {
	if os.PathSeparator == '\\' {
		return "NUL"
	}
	return "/dev/null"
}

func BuildImageArgs(req ConvertRequest) []string {
	return buildImageArgsQ(req, imageQuality(req.Options.Quality))
}

func buildImageArgsQ(req ConvertRequest, q string) []string {
	args := commonInputArgs(req)
	args = append(args, "-frames:v", "1")
	if f := BuildFilters(req); f != "" {
		args = append(args, "-vf", f)
	}
	args = append(args, metadataArgs(req.Settings.ClearMetadata)...)
	// FFmpeg autorotates still images. Clear the orientation/rotation marker on
	// the encoded frame so viewers do not rotate the already-correct pixels a
	// second time. Other embedded metadata remains mapped when requested.
	args = append(args, "-metadata:s:v:0", "rotate=0")
	if strings.EqualFold(req.Options.ImageFormat, "PNG") {
		args = append(args, "-compression_level", "9")
	} else {
		args = append(args, "-q:v", q)
	}
	args = append(args, req.Output)
	return args
}

func imageLimitBytes(s string) int64 {
	s = strings.TrimSpace(strings.ToUpper(s))
	if s == "" || s == "不限" {
		return 0
	}
	s = strings.TrimPrefix(s, "约 ")
	if strings.HasSuffix(s, "KB") {
		v, _ := strconv.ParseFloat(strings.TrimSpace(strings.TrimSuffix(s, "KB")), 64)
		return int64(v * 1024)
	}
	if strings.HasSuffix(s, "MB") {
		v, _ := strconv.ParseFloat(strings.TrimSpace(strings.TrimSuffix(s, "MB")), 64)
		return int64(v * 1024 * 1024)
	}
	return 0
}

func Convert(ctx context.Context, ffmpeg string, req ConvertRequest, progress ProgressFunc) (engine string, err error) {
	if req.Kind == model.KindImage {
		metadataInput := req.Input
		if strings.TrimSpace(req.MetadataInput) != "" {
			metadataInput = req.MetadataInput
		}
		if err := PreflightModernImage(ctx, ffmpeg, req.Input); err != nil {
			return "Windows HEIF 解码预检", err
		}
		if IsModernImageInput(req.Input) {
			if progress != nil {
				progress(1, "正在读取 HEIC")
			}
			temporary, orientation, decodeErr := DecodeModernImageForFFmpeg(ctx, ffmpeg, req.Input, req.Output)
			if decodeErr != nil {
				return "Windows HEIF 图片解码", decodeErr
			}
			defer os.Remove(temporary)
			req.Input = temporary
			req.MetadataInput = metadataInput
			req.InputOrientation = orientation
		}
		engine, err := convertImage(ctx, ffmpeg, req, progress)
		if err != nil {
			return engine, err
		}
		if !req.Settings.ClearMetadata {
			if progress != nil {
				progress(99, "正在保留图片元数据")
			}
			metadataEngine, metadataErr := PreserveImageMetadata(ctx, ffmpeg, metadataInput, req.Output)
			if metadataErr != nil {
				return engine + " · " + metadataEngine, metadataErr
			}
			engine += " · " + metadataEngine
		}
		return engine, nil
	}
	if canSmartStreamCopy(req) {
		args, engine := buildStreamCopyArgs(req)
		err := Run(ctx, ffmpeg, args, durationFor(req), func(v float64) {
			if progress != nil {
				progress(v, "智能复制中")
			}
		})
		return engine, err
	}
	useGPU := req.Settings.UseGPU && req.Hardware.Available
	if req.Options.VolumeMode == "目标体积" && (!useGPU || req.Settings.ExactTargetSize) && !req.Preview {
		return convertExactTarget(ctx, ffmpeg, req, progress)
	}
	var args []string
	if req.Options.VolumeMode == "目标体积" || req.Options.VolumeMode == "码率优先" {
		args, engine = buildBitrateVideoArgs(req, useGPU)
	} else {
		args, engine = buildQualityVideoArgs(req, useGPU)
	}
	err = Run(ctx, ffmpeg, args, durationFor(req), func(v float64) {
		if progress != nil {
			progress(v, "编码中")
		}
	})
	return engine, err
}

func convertImage(ctx context.Context, ffmpeg string, req ConvertRequest, progress ProgressFunc) (string, error) {
	if progress != nil {
		progress(1, "图片处理中")
	}
	limit := imageLimitBytes(req.Options.ImageLimit)
	if limit > 0 && !req.Settings.ClearMetadata && strings.EqualFold(filepath.Ext(req.Input), ".jpg") && strings.EqualFold(filepath.Ext(req.Output), ".jpg") {
		if b, e := os.ReadFile(req.Input); e == nil {
			if exif, _ := extractExifAPP1(b); len(exif) > 0 && limit > int64(len(exif)+4096) {
				limit -= int64(len(exif) + 4)
			}
		}
	}
	if limit <= 0 {
		err := Run(ctx, ffmpeg, BuildImageArgs(req), 0, func(v float64) {
			if progress != nil {
				progress(v, "图片处理中")
			}
		})
		return "FFmpeg图片", err
	}

	ext := filepath.Ext(req.Output)
	if ext == "" {
		ext = ".jpg"
	}
	base := strings.TrimSuffix(req.Output, filepath.Ext(req.Output))
	tmp := base + fmt.Sprintf(".mwimg-%d%s", time.Now().UnixNano(), ext)
	candidate := base + fmt.Sprintf(".mwcandidate-%d%s", time.Now().UnixNano(), ext)
	fallback := base + fmt.Sprintf(".mwfallback-%d%s", time.Now().UnixNano(), ext)
	defer os.Remove(tmp)
	defer os.Remove(candidate)
	defer os.Remove(fallback)
	factors := []float64{1, .9, .8, .7, .6, .5, .42, .35, .28}
	maxAttempts := len(factors) * 6
	attempt := 0
	bestFallbackSize := int64(1<<63 - 1)

	try := func(factor float64, q string) (int64, error) {
		attempt++
		_ = os.Remove(tmp)
		trial := req
		trial.Output = tmp
		trial.ExtraScale = factor
		args := BuildImageArgs(trial)
		if q != "" && !strings.EqualFold(req.Options.ImageFormat, "PNG") {
			args = buildImageArgsQ(trial, q)
		}
		if err := Run(ctx, ffmpeg, args, 0, nil); err != nil {
			return 0, err
		}
		sz := FileSize(tmp)
		if sz > 0 && sz < bestFallbackSize {
			bestFallbackSize = sz
			_ = copyFile(tmp, fallback)
		}
		if progress != nil {
			progress(2+math.Min(float64(attempt)/float64(maxAttempts), 1)*94, fmt.Sprintf("目标体积优化 · %.0f%%尺寸", factor*100))
		}
		return sz, nil
	}

	for _, factor := range factors {
		if err := ctx.Err(); err != nil {
			return "FFmpeg图片目标体积", err
		}
		if strings.EqualFold(req.Options.ImageFormat, "PNG") {
			sz, err := try(factor, "")
			if err != nil {
				return "FFmpeg图片目标体积", err
			}
			if sz > 0 && sz <= limit {
				if err := replaceFile(tmp, req.Output); err != nil {
					return "FFmpeg图片目标体积", err
				}
				if progress != nil {
					progress(100, "完成")
				}
				return fmt.Sprintf("FFmpeg PNG目标体积 · %.0f%%尺寸", factor*100), nil
			}
			continue
		}

		// JPEG q:v is inverse quality. Binary-search the smallest q (best quality)
		// that satisfies the limit at the current, largest possible scale.
		lo, hi := 2, 31
		found := false
		bestQ := 31
		for lo <= hi {
			q := (lo + hi) / 2
			sz, err := try(factor, strconv.Itoa(q))
			if err != nil {
				return "FFmpeg图片目标体积", err
			}
			if sz > 0 && sz <= limit {
				found, bestQ = true, q
				_ = copyFile(tmp, candidate)
				hi = q - 1
			} else {
				lo = q + 1
			}
		}
		if found {
			// Re-run the selected q if the last binary-search trial was different.
			if FileSize(candidate) == 0 {
				if _, err := try(factor, strconv.Itoa(bestQ)); err != nil {
					return "FFmpeg图片目标体积", err
				}
				_ = copyFile(tmp, candidate)
			}
			if err := replaceFile(candidate, req.Output); err != nil {
				return "FFmpeg图片目标体积", err
			}
			if progress != nil {
				progress(100, "完成")
			}
			return fmt.Sprintf("FFmpeg图片目标体积 · %.0f%%尺寸 · q=%d", factor*100, bestQ), nil
		}
	}
	if FileSize(fallback) > 0 {
		if err := replaceFile(fallback, req.Output); err != nil {
			return "FFmpeg图片目标体积", err
		}
		if progress != nil {
			progress(100, "已尽量压缩")
		}
		return "FFmpeg图片目标体积 · 已达最小可用尺寸", nil
	}
	return "FFmpeg图片目标体积", errors.New("图片目标体积优化未生成有效文件")
}

func convertExactTarget(ctx context.Context, ffmpeg string, req ConvertRequest, progress ProgressFunc) (string, error) {
	target := int64(req.Options.TargetSizeMB) * 1024 * 1024
	if target <= 0 {
		return "CPU两遍精确体积", errors.New("目标体积无效")
	}
	kbps := bitrateKbps(req)
	if kbps < 120 {
		kbps = 120
	}
	const maxRounds = 4
	var lastSize int64
	for round := 1; round <= maxRounds; round++ {
		if err := ctx.Err(); err != nil {
			return "CPU两遍精确体积", err
		}
		_ = os.Remove(req.Output)
		trial := req
		trial.VideoBitrateKbps = kbps
		passlog := filepath.Join(filepath.Dir(req.Output), fmt.Sprintf(".mwpass_%d_%d", time.Now().UnixNano(), round))
		stagePrefix := fmt.Sprintf("体积校准 %d/%d", round, maxRounds)
		if progress != nil {
			progress(float64(round-1)/maxRounds*100, stagePrefix+" · 第一遍分析")
		}
		err := Run(ctx, ffmpeg, twoPassArgs(trial, 1, passlog), durationFor(trial), func(v float64) {
			if progress != nil {
				base := float64(round-1) / maxRounds * 100
				progress(base+v*0.45/maxRounds, stagePrefix+" · 第一遍分析")
			}
		})
		if err != nil {
			cleanupPasslog(passlog)
			return "CPU两遍精确体积", err
		}
		err = Run(ctx, ffmpeg, twoPassArgs(trial, 2, passlog), durationFor(trial), func(v float64) {
			if progress != nil {
				base := float64(round-1) / maxRounds * 100
				progress(base+(45+v*.55)/maxRounds, stagePrefix+" · 第二遍编码")
			}
		})
		cleanupPasslog(passlog)
		if err != nil {
			return "CPU两遍精确体积", err
		}
		lastSize = FileSize(req.Output)
		if lastSize <= 0 {
			return "CPU两遍精确体积", errors.New("两遍编码未生成有效输出")
		}
		tolerance := int64(float64(target) * .035)
		if tolerance < 64*1024 {
			tolerance = 64 * 1024
		}
		diff := lastSize - target
		if diff < 0 {
			diff = -diff
		}
		if diff <= tolerance {
			if progress != nil {
				progress(100, "目标体积校准完成")
			}
			deviation := (float64(lastSize)/float64(target) - 1) * 100
			return fmt.Sprintf("CPU两遍精确体积 · 偏差 %+.1f%%", deviation), nil
		}
		ratio := float64(target) / float64(lastSize)
		newKbps := int(math.Round(float64(kbps) * ratio))
		if newKbps < 120 {
			newKbps = 120
		}
		if newKbps > 500000 {
			newKbps = 500000
		}
		if newKbps == kbps {
			break
		}
		kbps = newKbps
	}
	if progress != nil {
		progress(100, "目标体积校准完成")
	}
	deviation := (float64(lastSize)/float64(target) - 1) * 100
	return fmt.Sprintf("CPU两遍精确体积 · 最终偏差 %+.1f%%", deviation), nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
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
	if _, err = io.Copy(out, in); err != nil {
		return err
	}
	if err = out.Sync(); err != nil {
		return err
	}
	if err = out.Close(); err != nil {
		return err
	}
	ok = true
	return nil
}

func replaceFile(src, dst string) error {
	_ = os.Remove(dst)
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	if err := copyFile(src, dst); err != nil {
		return err
	}
	_ = os.Remove(src)
	return nil
}

// ExplainConvertCommands returns the actual FFmpeg command plan used for a task.
// It is used by the GUI's diagnostics/copy-command action.
func ExplainConvertCommands(ffmpeg string, req ConvertRequest) []string {
	quote := func(v string) string {
		if strings.ContainsAny(v, " \t\"") {
			return strconv.Quote(v)
		}
		return v
	}
	join := func(args []string) string {
		parts := []string{quote(ffmpeg)}
		for _, a := range args {
			parts = append(parts, quote(a))
		}
		return strings.Join(parts, " ")
	}
	if req.Kind == model.KindImage {
		return []string{join(BuildImageArgs(req))}
	}
	if canSmartStreamCopy(req) {
		args, _ := buildStreamCopyArgs(req)
		return []string{join(args)}
	}
	useGPU := req.Settings.UseGPU && req.Hardware.Available
	if req.Options.VolumeMode == "目标体积" && (!useGPU || req.Settings.ExactTargetSize) && !req.Preview {
		passlog := filepath.Join(filepath.Dir(req.Output), ".mwpass_TASK")
		return []string{join(twoPassArgs(req, 1, passlog)), join(twoPassArgs(req, 2, passlog))}
	}
	if req.Options.VolumeMode == "目标体积" || req.Options.VolumeMode == "码率优先" {
		args, _ := buildBitrateVideoArgs(req, useGPU)
		return []string{join(args)}
	}
	args, _ := buildQualityVideoArgs(req, useGPU)
	return []string{join(args)}
}

func cleanupPasslog(prefix string) {
	matches, _ := filepath.Glob(prefix + "*")
	for _, p := range matches {
		_ = os.Remove(p)
	}
}

var ffmpegFailureLogMu sync.Mutex

const ffmpegFailureLogLimit = 4 << 20

// appendFFmpegFailureLog keeps one bounded rolling diagnostic file. It
// preserves the command, exit error and stderr without creating one large file
// per failed task or allowing diagnostics to grow without limit.
func appendFFmpegFailureLog(ffmpeg string, args []string, runErr error, stderrText string) string {
	dir, err := config.LocalDir()
	if err != nil {
		return ""
	}
	dir = filepath.Join(dir, "logs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return ""
	}
	path := filepath.Join(dir, "ffmpeg-failures.log")
	quote := func(value string) string {
		if strings.ContainsAny(value, " \t\r\n\"") {
			return strconv.Quote(value)
		}
		return value
	}
	parts := make([]string, 0, len(args)+1)
	parts = append(parts, quote(ffmpeg))
	for _, arg := range args {
		parts = append(parts, quote(arg))
	}
	entry := fmt.Sprintf("\r\n===== %s =====\r\nCommand: %s\r\nExit: %v\r\nStderr:\r\n%s\r\n", time.Now().Format(time.RFC3339), strings.Join(parts, " "), runErr, stderrText)

	ffmpegFailureLogMu.Lock()
	defer ffmpegFailureLogMu.Unlock()
	existing, _ := os.ReadFile(path)
	maxExisting := ffmpegFailureLogLimit - len(entry)
	if maxExisting < 0 {
		entry = entry[len(entry)-ffmpegFailureLogLimit:]
		existing = nil
	} else if len(existing) > maxExisting {
		existing = existing[len(existing)-maxExisting:]
	}
	payload := append(existing, []byte(entry)...)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o644); err != nil {
		return ""
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(path)
		if err = os.Rename(tmp, path); err != nil {
			_ = os.Remove(tmp)
			return ""
		}
	}
	return path
}

func Run(ctx context.Context, ffmpeg string, args []string, duration float64, progress func(float64)) error {
	cmd := exec.CommandContext(ctx, ffmpeg, args...)
	configureCommand(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	controller := processControllerFromContext(ctx)
	controller.register(cmd.Process)
	defer controller.unregister(cmd.Process)
	var stderrText strings.Builder
	doneErr := make(chan struct{})
	go func() { _, _ = io.Copy(&stderrText, io.LimitReader(stderr, 2<<20)); close(doneErr) }()
	if progress != nil && duration > 0 {
		s := bufio.NewScanner(stdout)
		for s.Scan() {
			line := s.Text()
			var sec float64
			if strings.HasPrefix(line, "out_time_us=") {
				v, _ := strconv.ParseFloat(strings.TrimPrefix(line, "out_time_us="), 64)
				sec = v / 1_000_000
			} else if strings.HasPrefix(line, "out_time_ms=") {
				v, _ := strconv.ParseFloat(strings.TrimPrefix(line, "out_time_ms="), 64)
				sec = v / 1_000_000
			}
			if sec > 0 {
				v := sec / duration * 100
				if v > 99.5 {
					v = 99.5
				}
				if v >= 0 {
					progress(v)
				}
			}
		}
	} else {
		_, _ = io.Copy(io.Discard, stdout)
	}
	err = cmd.Wait()
	<-doneErr
	if err != nil {
		fullMessage := strings.TrimSpace(stderrText.String())
		if errors.Is(ctx.Err(), context.Canceled) {
			return context.Canceled
		}
		logPath := appendFFmpegFailureLog(ffmpeg, args, err, fullMessage)
		msg := fullMessage
		if len(msg) > 1800 {
			msg = msg[len(msg)-1800:]
		}
		prefix := "FFmpeg 执行失败"
		if logPath != "" {
			prefix += "（完整诊断: " + logPath + "）"
		}
		if msg != "" {
			return fmt.Errorf("%s: %w: %s", prefix, err, msg)
		}
		return fmt.Errorf("%s: %w", prefix, err)
	}
	if progress != nil {
		progress(100)
	}
	return nil
}

func GenerateFrame(ctx context.Context, ffmpeg, input, output string, at float64, rotation string) error {
	args := []string{"-hide_banner", "-y", "-ss", formatSeconds(at)}
	if rotation != "自动" {
		args = append(args, "-noautorotate")
	}
	args = append(args, "-i", input, "-frames:v", "1")
	if f := rotationFilter(rotation); f != "" {
		args = append(args, "-vf", f)
	}
	args = append(args, output)
	return Run(ctx, ffmpeg, args, 0, nil)
}

func drawtextEscape(v string) string {
	r := strings.NewReplacer(
		`\\`, `\\\\`,
		`:`, `\\:`,
		`'`, `\\'`,
		`%`, `\\%`,
		`[`, `\\[`,
		`]`, `\\]`,
	)
	return r.Replace(v)
}

func comparisonLabel(prefix, path string) string {
	return drawtextEscape(prefix + " · " + filepath.Base(path) + " · " + FormatBytes(FileSize(path)))
}

func comparisonFontFile() string {
	var candidates []string
	if windowsDir := strings.TrimSpace(os.Getenv("WINDIR")); windowsDir != "" {
		candidates = append(candidates,
			filepath.Join(windowsDir, "Fonts", "msyh.ttc"),
			filepath.Join(windowsDir, "Fonts", "segoeui.ttf"),
			filepath.Join(windowsDir, "Fonts", "arial.ttf"),
		)
	}
	candidates = append(candidates,
		"/System/Library/Fonts/Supplemental/Arial.ttf",
		"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
		"/usr/share/fonts/dejavu/DejaVuSans.ttf",
	)
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func comparisonTextFilter(label string, fontSize int) string {
	font := comparisonFontFile()
	if font == "" {
		// Text is decoration. A missing system font must never block generation
		// of the actual visual comparison.
		return ""
	}
	// fontfile is parsed as a filter option, not as drawtext text. In particular
	// a Windows drive colon needs exactly one escaping backslash; the text
	// escaper intentionally emits two and would make FFmpeg fall back to
	// Fontconfig instead of opening the explicit file.
	font = strings.ReplaceAll(filepath.ToSlash(font), "'", `\'`)
	font = strings.ReplaceAll(font, ":", `\:`)
	return fmt.Sprintf(",drawtext=fontfile='%s':text='%s':x=20:y=20:fontsize=%d:fontcolor=white:box=1:boxcolor=black@0.55", font, label, fontSize)
}

func GenerateComparisonImage(ctx context.Context, ffmpeg, source, converted, output string, at float64) error {
	leftLabel := comparisonLabel("源文件", source)
	rightLabel := comparisonLabel("转换后", converted)
	filter := fmt.Sprintf("[0:v]scale=960:540:force_original_aspect_ratio=decrease:flags=lanczos,pad=960:540:(ow-iw)/2:(oh-ih)/2:black%s[left];[1:v]scale=960:540:force_original_aspect_ratio=decrease:flags=lanczos,pad=960:540:(ow-iw)/2:(oh-ih)/2:black%s[right];[left][right]hstack=inputs=2", comparisonTextFilter(leftLabel, 26), comparisonTextFilter(rightLabel, 26))
	args := []string{"-hide_banner", "-y", "-ss", formatSeconds(at), "-i", source, "-ss", formatSeconds(at), "-i", converted, "-filter_complex", filter, "-frames:v", "1", output}
	return Run(ctx, ffmpeg, args, 0, nil)
}

func GenerateComparisonVideo(ctx context.Context, ffmpeg, source, converted, output string, seconds float64, progress ProgressFunc) error {
	if seconds <= 0 {
		seconds = 30
	}
	leftLabel := comparisonLabel("源文件", source)
	rightLabel := comparisonLabel("转换后", converted)
	filter := fmt.Sprintf("[0:v]scale=960:540:force_original_aspect_ratio=decrease:flags=lanczos,pad=960:540:(ow-iw)/2:(oh-ih)/2:black%s[left];[1:v]scale=960:540:force_original_aspect_ratio=decrease:flags=lanczos,pad=960:540:(ow-iw)/2:(oh-ih)/2:black%s[right];[left][right]hstack=inputs=2,setsar=1[v]", comparisonTextFilter(leftLabel, 26), comparisonTextFilter(rightLabel, 26))
	args := []string{"-hide_banner", "-y", "-i", source, "-i", converted, "-t", formatSeconds(seconds), "-filter_complex", filter, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-crf", "20", "-preset", "fast", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", output}
	return Run(ctx, ffmpeg, args, seconds, func(v float64) {
		if progress != nil {
			progress(v, "生成对比视频")
		}
	})
}

func formatSeconds(v float64) string {
	if v < 0 {
		v = 0
	}
	return strconv.FormatFloat(v, 'f', 3, 64)
}

// GenerateProcessedFrame writes one frame after applying the same rotation, crop and scale chain used by conversion.
func GenerateProcessedFrame(ctx context.Context, ffmpeg string, req ConvertRequest, at float64) error {
	args := []string{"-hide_banner", "-y", "-ss", formatSeconds(at)}
	if req.Options.Rotation != "自动" {
		args = append(args, "-noautorotate")
	}
	args = append(args, "-i", req.Input, "-frames:v", "1")
	if f := BuildFilters(req); f != "" {
		args = append(args, "-vf", f)
	}
	args = append(args, req.Output)
	return Run(ctx, ffmpeg, args, 0, nil)
}

// GenerateFivePointComparisonImage creates a five-row contact sheet. Each row contains
// the source frame on the left and the converted frame on the right.
func GenerateFivePointComparisonImage(ctx context.Context, ffmpeg, source, converted, output string, duration float64) error {
	if duration <= 0 {
		duration = 1
	}
	fractions := []float64{0.05, 0.25, 0.5, 0.75, 0.95}
	leftBase := comparisonLabel("源文件", source)
	rightBase := comparisonLabel("转换后", converted)
	args := []string{"-hide_banner", "-y"}
	for _, f := range fractions {
		at := duration * f
		args = append(args, "-ss", formatSeconds(at), "-i", source, "-ss", formatSeconds(at), "-i", converted)
	}
	var parts []string
	for i := 0; i < 5; i++ {
		left, right := i*2, i*2+1
		leftText := comparisonTextFilter(fmt.Sprintf("%s · %d/5", leftBase, i+1), 24)
		rightText := comparisonTextFilter(fmt.Sprintf("%s · %d/5", rightBase, i+1), 24)
		parts = append(parts,
			fmt.Sprintf("[%d:v]scale=720:406:force_original_aspect_ratio=decrease:flags=lanczos,pad=720:406:(ow-iw)/2:(oh-ih)/2:black%s[l%d]", left, leftText, i),
			fmt.Sprintf("[%d:v]scale=720:406:force_original_aspect_ratio=decrease:flags=lanczos,pad=720:406:(ow-iw)/2:(oh-ih)/2:black%s[r%d]", right, rightText, i),
			fmt.Sprintf("[l%d][r%d]hstack=inputs=2[row%d]", i, i, i))
	}
	parts = append(parts, "[row0][row1][row2][row3][row4]vstack=inputs=5[out]")
	args = append(args, "-filter_complex", strings.Join(parts, ";"), "-map", "[out]", "-frames:v", "1", output)
	return Run(ctx, ffmpeg, args, 0, nil)
}

// GenerateFramePreview creates a display-sized BMP/JPEG frame after applying
// the selected rotation but before crop/encode. Crop coordinates therefore stay
// in the same post-rotation coordinate system used by conversion.
func GenerateFramePreview(ctx context.Context, ffmpeg, input, output string, at float64, rotation string, maxWidth, maxHeight int) error {
	args := []string{"-hide_banner", "-y", "-ss", formatSeconds(at)}
	if rotation != "自动" {
		args = append(args, "-noautorotate")
	}
	args = append(args, "-i", input, "-frames:v", "1")
	var filters []string
	if f := rotationFilter(rotation); f != "" {
		filters = append(filters, f)
	}
	if maxWidth > 0 && maxHeight > 0 {
		filters = append(filters, fmt.Sprintf("scale='min(iw,%d)':'min(ih,%d)':force_original_aspect_ratio=decrease:flags=lanczos", maxWidth, maxHeight))
	}
	if len(filters) > 0 {
		args = append(args, "-vf", strings.Join(filters, ","))
	}
	args = append(args, output)
	return Run(ctx, ffmpeg, args, 0, nil)
}

// GenerateThumbnailBMP creates an exact-size letterboxed BMP suitable for a
// Windows ImageList. Rotation is applied before the thumbnail is scaled.
func GenerateThumbnailBMP(ctx context.Context, ffmpeg, input, output string, at float64, rotation string, width, height int) error {
	if width < 8 {
		width = 80
	}
	if height < 8 {
		height = 48
	}
	args := []string{"-hide_banner", "-y", "-ss", formatSeconds(at)}
	if rotation != "自动" {
		args = append(args, "-noautorotate")
	}
	args = append(args, "-i", input, "-frames:v", "1")
	var filters []string
	if f := rotationFilter(rotation); f != "" {
		filters = append(filters, f)
	}
	filters = append(filters, fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease:flags=lanczos,pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=black", width, height, width, height))
	args = append(args, "-vf", strings.Join(filters, ","), output)
	return Run(ctx, ffmpeg, args, 0, nil)
}

// GenerateThumbnailJPEG creates a compact, durable preview for history pages.
// Unlike the BMP variant used by the Win32 ImageList, this is intentionally
// small on disk and is not part of the disposable task-list thumbnail cache.
func GenerateThumbnailJPEG(ctx context.Context, ffmpeg, input, output string, at float64, rotation string, width, height int) error {
	if width < 32 {
		width = 160
	}
	if height < 24 {
		height = 90
	}
	args := []string{"-hide_banner", "-y", "-ss", formatSeconds(at)}
	if rotation != "自动" {
		args = append(args, "-noautorotate")
	}
	args = append(args, "-i", input, "-frames:v", "1")
	var filters []string
	if f := rotationFilter(rotation); f != "" {
		filters = append(filters, f)
	}
	filters = append(filters, fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease:flags=lanczos,pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=0xf4f7fa", width, height, width, height))
	args = append(args, "-vf", strings.Join(filters, ","), "-q:v", "5", output)
	return Run(ctx, ffmpeg, args, 0, nil)
}

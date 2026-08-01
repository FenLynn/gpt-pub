package media

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"mediaworkbench/internal/model"
)

func TestEstimateAndFailureClassification(t *testing.T) {
	task := &model.Task{Kind: model.KindVideo, InputSize: 1000, Duration: 10}
	opts := model.TaskOptions{VolumeMode: "目标体积", TargetSizeMB: 25}
	if got := EstimateOutputBytes(task, opts); got != 25*1024*1024 {
		t.Fatalf("estimate=%d", got)
	}
	if got := ClassifyFailure(os.ErrPermission); got != "权限不足" {
		t.Fatalf("category=%q", got)
	}
	if got := ClassifyFailure(context.Canceled); got != "用户停止" {
		t.Fatalf("cancel category=%q", got)
	}
}

func TestEnhancedHistoryHTML(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	if err := AppendHistory(HistoryRecord{Input: "a.mov", Output: "a.mp4", InputSize: 1000, OutputSize: 400, Engine: "CPU高质量", Result: "转换完成"}); err != nil {
		t.Fatal(err)
	}
	path, err := WriteHistoryHTML()
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	for _, want := range []string{"导出当前结果 CSV", "累计节省", "CPU高质量", "function apply()"} {
		if !strings.Contains(s, want) {
			t.Fatalf("history html missing %q", want)
		}
	}
}

func TestThumbnailCacheAndVerifyOutput(t *testing.T) {
	ff, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg unavailable")
	}
	fp, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe unavailable")
	}
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	d := t.TempDir()
	in := filepath.Join(d, "in.mp4")
	cmd := exec.Command(ff, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15", "-t", "1.2", "-c:v", "libx264", in)
	if b, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("source: %v %s", e, b)
	}
	thumb1, err := GenerateThumbnailBMPCached(context.Background(), ff, in, .1, "自动", 80, 48)
	if err != nil {
		t.Fatal(err)
	}
	thumb2, err := GenerateThumbnailBMPCached(context.Background(), ff, in, .1, "自动", 80, 48)
	if err != nil {
		t.Fatal(err)
	}
	if thumb1 != thumb2 || FileSize(thumb1) <= 64 {
		t.Fatalf("cache mismatch: %q %q size=%d", thumb1, thumb2, FileSize(thumb1))
	}
	probe, err := Probe(fp, in)
	if err != nil {
		t.Fatal(err)
	}
	req := ConvertRequest{Input: in, Output: in, Kind: model.KindVideo, Probe: probe, Options: model.DefaultSettings().EffectiveOptions(&model.Task{Kind: model.KindVideo}), Settings: model.DefaultSettings()}
	if vr, err := VerifyOutput(context.Background(), ff, fp, req); err != nil || vr.Category != "" {
		t.Fatalf("verify: %+v %v", vr, err)
	}
	bad := filepath.Join(d, "bad.mp4")
	if err := os.WriteFile(bad, []byte("not a media file"), 0o644); err != nil {
		t.Fatal(err)
	}
	req.Output = bad
	if _, err := VerifyOutput(context.Background(), ff, fp, req); err == nil {
		t.Fatal("corrupt output unexpectedly verified")
	}
}

func TestSmartStreamCopyAudioSubtitleAndHDRPlanning(t *testing.T) {
	settings := model.DefaultSettings()
	settings.SmartStreamCopy = true
	settings.AudioMode = "复制音频"
	settings.SubtitleMode = "保留文本字幕"
	opts := settings.EffectiveOptions(&model.Task{Kind: model.KindVideo})
	opts.Resolution = "原尺寸"
	opts.Codec = "H.264"
	opts.VolumeMode = "质量优先"
	req := ConvertRequest{
		Input:  "in.mp4",
		Output: "out.mp4",
		Kind:   model.KindVideo,
		Probe: ProbeInfo{
			VideoCodec:      "h264",
			HasAudio:        true,
			AudioStreams:    2,
			SubtitleStreams: 1,
			Duration:        10,
		},
		Options:  opts,
		Settings: settings,
	}
	commands := ExplainConvertCommands("ffmpeg", req)
	joined := strings.Join(commands, " ")
	for _, want := range []string{"-c:v copy", "-c:a copy", "-c:s mov_text"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("smart-copy plan missing %q: %s", want, joined)
		}
	}
	req.Probe.Rotation = 90
	if got := strings.Join(ExplainConvertCommands("ffmpeg", req), " "); strings.Contains(got, "-c:v copy") {
		t.Fatalf("rotated source must not use smart copy: %s", got)
	}
	if got := detectHDR("smpte2084", "bt2020", "yuv420p10le"); got != "HDR10 / PQ" {
		t.Fatalf("HDR detection=%q", got)
	}
	if got := detectHDR("arib-std-b67", "bt2020", "yuv420p10le"); got != "HLG" {
		t.Fatalf("HLG detection=%q", got)
	}
}

func TestSmartStreamCopyIntegration(t *testing.T) {
	ff, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg unavailable")
	}
	fp, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe unavailable")
	}
	d := t.TempDir()
	in := filepath.Join(d, "smart-in.mp4")
	out := filepath.Join(d, "smart-out.mp4")
	cmd := exec.Command(ff, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10", "-t", "1", "-c:v", "libx264", "-an", in)
	if b, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("source: %v %s", e, b)
	}
	probe, err := Probe(fp, in)
	if err != nil {
		t.Fatal(err)
	}
	settings := model.DefaultSettings()
	settings.SmartStreamCopy = true
	settings.UseGPU = false
	opts := settings.EffectiveOptions(&model.Task{Kind: model.KindVideo})
	opts.Resolution = "原尺寸"
	opts.Codec = "H.264"
	opts.VolumeMode = "质量优先"
	req := ConvertRequest{Input: in, Output: out, Kind: model.KindVideo, Probe: probe, Options: opts, Settings: settings}
	engine, err := Convert(context.Background(), ff, req, nil)
	if err != nil {
		t.Fatal(err)
	}
	if engine != "视频流智能复制" {
		t.Fatalf("engine=%q", engine)
	}
	got, err := Probe(fp, out)
	if err != nil {
		t.Fatal(err)
	}
	if got.VideoCodec != "h264" || FileSize(out) <= 64 {
		t.Fatalf("unexpected smart-copy output: %+v size=%d", got, FileSize(out))
	}
}

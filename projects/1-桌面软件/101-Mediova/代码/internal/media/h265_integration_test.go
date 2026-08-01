package media

import (
	"context"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"mediaworkbench/internal/model"
)

func TestRealH265Pipeline(t *testing.T) {
	ff, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg missing")
	}
	fp, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe missing")
	}
	encoders, err := exec.Command(ff, "-hide_banner", "-encoders").CombinedOutput()
	if err != nil || !strings.Contains(string(encoders), "libx265") {
		t.Skip("libx265 unavailable")
	}
	d := t.TempDir()
	input := filepath.Join(d, "input.mp4")
	if out, err := exec.Command(ff, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=15:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", input).CombinedOutput(); err != nil {
		t.Fatalf("create input: %v %s", err, out)
	}
	probe, err := Probe(fp, input)
	if err != nil {
		t.Fatal(err)
	}
	settings := model.DefaultSettings()
	settings.UseGPU = false
	opts := settings.EffectiveOptions(&model.Task{Kind: model.KindVideo})
	opts.Codec = "H.265"
	opts.Resolution = "原尺寸"
	opts.Quality = "中"
	output := filepath.Join(d, "output.mp4")
	if _, err := Convert(context.Background(), ff, ConvertRequest{Input: input, Output: output, Kind: model.KindVideo, Probe: probe, Options: opts, Settings: settings}, nil); err != nil {
		t.Fatal(err)
	}
	codec, err := exec.Command(fp, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1", output).CombinedOutput()
	if err != nil {
		t.Fatalf("probe output: %v %s", err, codec)
	}
	if strings.TrimSpace(string(codec)) != "hevc" {
		t.Fatalf("codec=%q want hevc", strings.TrimSpace(string(codec)))
	}
}

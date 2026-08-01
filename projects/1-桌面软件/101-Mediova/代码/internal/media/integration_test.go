package media

import (
	"context"
	"mediaworkbench/internal/model"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestRealFFmpegPipeline(t *testing.T) {
	ff, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg missing")
	}
	fp, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe missing")
	}
	d := t.TempDir()
	in := filepath.Join(d, "in.mp4")
	cmd := exec.Command(ff, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25", "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=44100", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", in)
	if b, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("make input: %v %s", e, b)
	}
	p, e := Probe(fp, in)
	if e != nil || p.Width != 320 || p.Duration < 2.9 {
		t.Fatalf("probe %+v %v", p, e)
	}
	s := model.DefaultSettings()
	s.UseGPU = false
	o := s.EffectiveOptions(&model.Task{Kind: model.KindVideo})
	o.Resolution = "720P"
	o.Codec = "H.264"
	o.Quality = "中"
	o.TrimStart = .5
	o.TrimEnd = 2.5
	o.Crop = model.Crop{Enabled: true, X: 10, Y: 10, Width: 300, Height: 200}
	out := filepath.Join(d, "out.mp4")
	eng, e := Convert(context.Background(), ff, ConvertRequest{Input: in, Output: out, Kind: model.KindVideo, Probe: p, Options: o, Settings: s}, nil)
	if e != nil {
		t.Fatalf("convert %s: %v", eng, e)
	}
	if st, e := os.Stat(out); e != nil || st.Size() == 0 {
		t.Fatalf("output missing")
	}
	o.VolumeMode = "目标体积"
	o.TargetSizeMB = 1
	out2 := filepath.Join(d, "target.mp4")
	_, e = Convert(context.Background(), ff, ConvertRequest{Input: in, Output: out2, Kind: model.KindVideo, Probe: p, Options: o, Settings: s}, nil)
	if e != nil {
		t.Fatalf("target convert: %v", e)
	}
	img := filepath.Join(d, "in.png")
	cmd = exec.Command(ff, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:size=1200x800", "-frames:v", "1", img)
	if b, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("make image: %v %s", e, b)
	}
	io := s.EffectiveOptions(&model.Task{Kind: model.KindImage})
	io.ImageSize = "最大边 1000px"
	io.ImageFormat = "JPG"
	io.Quality = "高"
	jpg := filepath.Join(d, "out.jpg")
	_, e = Convert(context.Background(), ff, ConvertRequest{Input: img, Output: jpg, Kind: model.KindImage, Options: io, Settings: s}, nil)
	if e != nil {
		t.Fatalf("image: %v", e)
	}
}

func TestRealPreviewAndComparison(t *testing.T) {
	ff, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip()
	}
	fp, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip()
	}
	d := t.TempDir()
	a := filepath.Join(d, "a.mp4")
	b := filepath.Join(d, "b.mp4")
	for _, x := range []struct {
		p, c, size string
	}{{a, "blue", "320x240"}, {b, "red", "640x360"}} {
		cmd := exec.Command(ff, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c="+x.c+":size="+x.size+":rate=25", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", x.p)
		if out, e := cmd.CombinedOutput(); e != nil {
			t.Fatalf("video %v %s", e, out)
		}
	}
	p, _ := Probe(fp, a)
	s := model.DefaultSettings()
	o := s.EffectiveOptions(&model.Task{Kind: model.KindVideo})
	o.Crop = model.Crop{Enabled: true, X: 10, Y: 10, Width: 200, Height: 180}
	frame := filepath.Join(d, "frame.jpg")
	if e := GenerateProcessedFrame(context.Background(), ff, ConvertRequest{Input: a, Output: frame, Kind: model.KindVideo, Probe: p, Options: o, Settings: s}, .5); e != nil {
		t.Fatal(e)
	}
	sheet := filepath.Join(d, "sheet.jpg")
	if e := GenerateFivePointComparisonImage(context.Background(), ff, a, b, sheet, 2); e != nil {
		t.Fatal(e)
	}
	if FileSize(sheet) == 0 {
		t.Fatal("empty sheet")
	}
	pair := filepath.Join(d, "pair.jpg")
	if e := GenerateComparisonImage(context.Background(), ff, a, b, pair, .5); e != nil {
		t.Fatal(e)
	}
	video := filepath.Join(d, "compare.mp4")
	if e := GenerateComparisonVideo(context.Background(), ff, a, b, video, 1, nil); e != nil {
		t.Fatal(e)
	}
	thumb := filepath.Join(d, "thumb.bmp")
	if e := GenerateThumbnailBMP(context.Background(), ff, a, thumb, .5, "自动", 80, 48); e != nil {
		t.Fatal(e)
	}
	for _, path := range []string{pair, video, thumb} {
		if FileSize(path) == 0 {
			t.Fatalf("empty generated artifact: %s", path)
		}
	}
}

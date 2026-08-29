package media

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mediaworkbench/internal/model"
)

func TestDetectKind(t *testing.T) {
	if k, ok := DetectKind("a.MOV"); !ok || k != model.KindVideo {
		t.Fatalf("video detection failed")
	}
	if k, ok := DetectKind("a.HEIC"); !ok || k != model.KindImage {
		t.Fatalf("image detection failed")
	}
}

func TestResolveOutputPath(t *testing.T) {
	d := t.TempDir()
	s := model.DefaultSettings()
	o := s.EffectiveOptions(nil)
	p, skip, err := ResolveOutputPath(filepath.Join(d, "a.mov"), "", d, model.KindVideo, o, s)
	if err != nil || skip || !strings.HasSuffix(p, "a.mp4") {
		t.Fatalf("unexpected: %q %v %v", p, skip, err)
	}
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	p2, _, _ := ResolveOutputPath(filepath.Join(d, "a.mov"), "", d, model.KindVideo, o, s)
	if !strings.HasSuffix(p2, "a_1.mp4") {
		t.Fatalf("numbering failed: %s", p2)
	}
}

func TestFilters(t *testing.T) {
	s := model.DefaultSettings()
	o := s.EffectiveOptions(nil)
	o.Rotation = "90°右转"
	o.Crop = model.Crop{Enabled: true, X: 1, Y: 2, Width: 100, Height: 80}
	f := BuildFilters(ConvertRequest{Kind: model.KindVideo, Options: o, Settings: s})
	for _, needle := range []string{"transpose=1", "crop=100:80:1:2", "scale=", "setsar=1"} {
		if !strings.Contains(f, needle) {
			t.Fatalf("missing %q in %q", needle, f)
		}
	}
}

func TestImageArgs(t *testing.T) {
	s := model.DefaultSettings()
	o := s.EffectiveOptions(nil)
	o.ImageFormat = "JPG"
	o.ImageSize = "最大边 1000px"
	args := BuildImageArgs(ConvertRequest{Input: "in.png", Output: "out.jpg", Kind: model.KindImage, Options: o, Settings: s})
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-frames:v 1") || !strings.Contains(joined, "1000") {
		t.Fatalf("bad args: %s", joined)
	}
}

func TestModernImageOutputArgsAndExtensions(t *testing.T) {
	s := model.DefaultSettings()
	o := s.EffectiveOptions(nil)
	for _, tc := range []struct {
		format, output, extension string
		need                      []string
	}{
		{format: "WebP", output: "out.webp", extension: ".webp", need: []string{"-c:v libwebp", "-preset photo", "-quality"}},
		{format: "AVIF", output: "out.avif", extension: ".avif", need: []string{"-c:v libaom-av1", "-still-picture 1", "-crf", "-pix_fmt yuv420p"}},
	} {
		o.ImageFormat = tc.format
		joined := strings.Join(BuildImageArgs(ConvertRequest{Input: "in.png", Output: tc.output, Kind: model.KindImage, Options: o, Settings: s}), " ")
		for _, want := range tc.need {
			if !strings.Contains(joined, want) {
				t.Errorf("%s args missing %q: %s", tc.format, want, joined)
			}
		}
		if got := OutputExtension(model.KindImage, o); got != tc.extension {
			t.Errorf("%s extension=%q", tc.format, got)
		}
	}
}

func TestVolumeParsingMath(t *testing.T) {
	s := model.DefaultSettings()
	o := s.EffectiveOptions(nil)
	o.VolumeMode = "目标体积"
	o.TargetSizeMB = 100
	v := bitrateKbps(ConvertRequest{Probe: ProbeInfo{Duration: 100, HasAudio: true}, Options: o})
	if v < 7000 || v > 8500 {
		t.Fatalf("unexpected bitrate %d", v)
	}
}

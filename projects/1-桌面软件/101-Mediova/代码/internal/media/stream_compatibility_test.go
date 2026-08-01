package media

import (
	"strings"
	"testing"

	"mediaworkbench/internal/model"
)

func TestTextSubtitleCodecClassification(t *testing.T) {
	for _, codec := range []string{"subrip", "ass", "ssa", "webvtt", "mov_text", "ttml"} {
		if !isTextSubtitleCodec(codec) {
			t.Fatalf("expected text subtitle codec: %s", codec)
		}
	}
	for _, codec := range []string{"hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle"} {
		if isTextSubtitleCodec(codec) {
			t.Fatalf("expected bitmap subtitle codec: %s", codec)
		}
	}
}

func TestSubtitleMapOnlyUsesTextStreams(t *testing.T) {
	req := ConvertRequest{Settings: model.Settings{SubtitleMode: "保留文本字幕"}, Probe: ProbeInfo{
		SubtitleStreams: 3, TextSubtitles: 2, BitmapSubtitles: 1,
		SubtitleDetails: []StreamInfo{{Index: 3, TextSubtitle: true}, {Index: 4, TextSubtitle: false}, {Index: 7, TextSubtitle: true}},
	}}
	args := subtitleMapArgs(req)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "0:3?") || !strings.Contains(joined, "0:7?") || strings.Contains(joined, "0:4?") {
		t.Fatalf("unexpected subtitle maps: %q", joined)
	}
	if expectedTextSubtitleStreams(req) != 2 {
		t.Fatalf("wrong expected text subtitle count")
	}
}

func TestVariableFrameRateClassification(t *testing.T) {
	if !isVariableFrameRate(20, 30) {
		t.Fatal("expected VFR")
	}
	if isVariableFrameRate(29.97, 30) {
		t.Fatal("29.97/30 should be treated as CFR-compatible")
	}
}

func TestVFRAddsFPSMode(t *testing.T) {
	args := appendFrameRateMode([]string{"-c:v", "libx264"}, ConvertRequest{Probe: ProbeInfo{VariableFrameRate: true}})
	if strings.Join(args, " ") != "-c:v libx264 -fps_mode vfr" {
		t.Fatalf("unexpected args: %v", args)
	}
}

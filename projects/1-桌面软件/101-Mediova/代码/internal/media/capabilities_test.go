package media

import "testing"

func TestParseFormatCapabilities(t *testing.T) {
	got := ParseFormatCapabilities(" V..... libx264\n V..... libx265\n V..... libwebp\n V..... libaom-av1", " E avif\n E webp")
	if !got.H264 || !got.H265 || !got.WebP || !got.AVIF {
		t.Fatalf("unexpected capabilities: %+v", got)
	}
	missingMuxer := ParseFormatCapabilities("libwebp libaom-av1", "mp4")
	if missingMuxer.WebP || missingMuxer.AVIF {
		t.Fatalf("encoders alone must not claim writable formats: %+v", missingMuxer)
	}
}

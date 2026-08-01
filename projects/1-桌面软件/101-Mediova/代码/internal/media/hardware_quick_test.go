package media

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestDetectHardwareQuickNoFFmpeg(t *testing.T) {
	start := time.Now()
	hw := DetectHardwareQuick(context.Background(), "")
	if hw.Available {
		t.Fatal("empty FFmpeg path must not be available")
	}
	if time.Since(start) > time.Second {
		t.Fatal("empty-path quick detection should return immediately")
	}
}

func TestDetectHardwareQuickCatalog(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is for non-Windows unit tests; Windows behavior is covered by GUI self-test")
	}
	d := t.TempDir()
	path := filepath.Join(d, "ffmpeg")
	script := "#!/bin/sh\necho ' V..... h264_nvenc NVIDIA NVENC H.264 encoder'\necho ' V..... hevc_nvenc NVIDIA NVENC HEVC encoder'\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	hw := DetectHardwareQuick(context.Background(), path)
	if hw.Vendor != "NVIDIA NVENC" || hw.H264 != "h264_nvenc" || hw.H265 != "hevc_nvenc" {
		t.Fatalf("unexpected quick detection: %+v", hw)
	}
	if hw.Available {
		t.Fatal("quick catalogue detection must not claim the encoder was invoked")
	}
}

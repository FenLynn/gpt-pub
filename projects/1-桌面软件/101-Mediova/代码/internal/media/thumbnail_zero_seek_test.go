package media

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestGenerateStillImageThumbnailAtZero(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg unavailable")
	}
	dir := t.TempDir()
	input := filepath.Join(dir, "still.jpg")
	output := filepath.Join(dir, "thumb.bmp")
	if data, err := exec.Command(ffmpeg, "-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=navy:s=320x180", "-frames:v", "1", input).CombinedOutput(); err != nil {
		t.Fatalf("fixture: %v: %s", err, data)
	}
	if err := GenerateThumbnailBMP(context.Background(), ffmpeg, input, output, 0, "自动", 86, 48); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(output); err != nil || info.Size() <= 128 {
		t.Fatalf("zero-seek thumbnail missing or empty: info=%v err=%v", info, err)
	}
}

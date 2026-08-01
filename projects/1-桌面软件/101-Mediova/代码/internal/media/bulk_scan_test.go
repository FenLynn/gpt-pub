package media

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestMixedFolderScanFiveThousandFiles(t *testing.T) {
	root := t.TempDir()
	for d := 0; d < 10; d++ {
		dir := filepath.Join(root, fmt.Sprintf("album_%02d", d))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 250; i++ {
			if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("video_%03d.mp4", i)), nil, 0o644); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("image_%03d.jpg", i)), nil, 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	result, err := ListMixedFiles(root, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Videos) != 2500 || len(result.Images) != 2500 {
		t.Fatalf("videos=%d images=%d", len(result.Videos), len(result.Images))
	}
}

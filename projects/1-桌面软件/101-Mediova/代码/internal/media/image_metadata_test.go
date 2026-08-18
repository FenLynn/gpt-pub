package media

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestFindExifToolPrefersExplicitBundledPath(t *testing.T) {
	root := t.TempDir()
	tool := filepath.Join(root, executableName("exiftool"))
	if err := os.WriteFile(tool, []byte("test"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MEDIOVA_EXIFTOOL_PATH", tool)
	if got := FindExifTool(""); filepath.Clean(got) != filepath.Clean(tool) {
		t.Fatalf("FindExifTool=%q want=%q", got, tool)
	}
}

func TestPreserveImageMetadataDoesNotSilentlyDropNonJPEGMetadata(t *testing.T) {
	root := t.TempDir()
	t.Setenv("MEDIOVA_EXIFTOOL_PATH", filepath.Join(root, "missing-exiftool"))
	t.Setenv("MEDIOVA_RUNTIME_DIR", filepath.Join(root, "missing-runtime"))
	t.Setenv("PATH", "")
	src := filepath.Join(root, "source.heic")
	dst := filepath.Join(root, "output.jpg")
	if _, err := PreserveImageMetadata(context.Background(), "", src, dst); err == nil {
		t.Fatal("missing ExifTool must not silently accept metadata loss")
	}
}

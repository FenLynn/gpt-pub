package media

import (
	"os"
	"path/filepath"
	"testing"
)

func writeDropFixture(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("fixture"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestScanDroppedPathsRoutesFilesAndDirectories(t *testing.T) {
	root := filepath.Join(t.TempDir(), "中文素材")
	directBase := t.TempDir()
	direct := filepath.Join(directBase, "直接素材", "直接视频.mov")
	unsupportedDirect := filepath.Join(t.TempDir(), "说明.txt")
	missing := filepath.Join(t.TempDir(), "不存在.mp4")

	writeDropFixture(t, filepath.Join(root, "根视频.mp4"))
	writeDropFixture(t, filepath.Join(root, "根图片.jpg"))
	writeDropFixture(t, filepath.Join(root, "忽略.txt"))
	writeDropFixture(t, filepath.Join(root, "子目录", "子图片.png"))
	writeDropFixture(t, direct)
	writeDropFixture(t, unsupportedDirect)

	nonRecursive := ScanDroppedPaths([]string{root, direct, unsupportedDirect, missing}, false)
	if len(nonRecursive.Groups) != 2 {
		t.Fatalf("groups=%d, want direct + directory", len(nonRecursive.Groups))
	}
	if nonRecursive.Groups[0].Root != directBase || nonRecursive.Groups[0].OutputPrefix != "" || len(nonRecursive.Groups[0].Paths) != 1 || nonRecursive.Groups[0].Paths[0] != direct {
		t.Fatalf("unexpected direct group: %+v", nonRecursive.Groups[0])
	}
	if nonRecursive.Groups[1].Root != filepath.Dir(root) || nonRecursive.Groups[1].OutputPrefix != "" || len(nonRecursive.Groups[1].Paths) != 2 {
		t.Fatalf("unexpected directory group: %+v", nonRecursive.Groups[1])
	}
	if nonRecursive.Unsupported != 2 || nonRecursive.Unreadable != 1 || nonRecursive.ScanErrors != 0 {
		t.Fatalf("unexpected counters: %+v", nonRecursive)
	}

	recursive := ScanDroppedPaths([]string{root}, true)
	if len(recursive.Groups) != 1 || len(recursive.Groups[0].Paths) != 3 {
		t.Fatalf("recursive scan did not include subdirectory media: %+v", recursive)
	}
	if recursive.Unsupported != 1 || recursive.Unreadable != 0 || recursive.ScanErrors != 0 {
		t.Fatalf("unexpected recursive counters: %+v", recursive)
	}
}

func TestScanDroppedPathsEmptyInput(t *testing.T) {
	got := ScanDroppedPaths(nil, true)
	if len(got.Groups) != 0 || got.Unsupported != 0 || got.Unreadable != 0 || got.ScanErrors != 0 {
		t.Fatalf("unexpected empty result: %+v", got)
	}
}

package media

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"mediaworkbench/internal/model"
)

func TestImportTreeRootKeepsSelectedTopFolder(t *testing.T) {
	parent := t.TempDir()
	selected := filepath.Join(parent, "A")
	if err := os.MkdirAll(filepath.Join(selected, "一", "二"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := ImportTreeRoot(selected); got != parent {
		t.Fatalf("ImportTreeRoot(%q)=%q, want %q", selected, got, parent)
	}
	input := filepath.Join(selected, "一", "二", "clip.mov")
	if err := os.WriteFile(input, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	outRoot := filepath.Join(t.TempDir(), "out")
	settings := model.DefaultSettings()
	out, skip, err := ResolveOutputPath(input, parent, outRoot, model.KindVideo, settings.DefaultOptions(model.KindVideo), settings)
	if err != nil || skip {
		t.Fatalf("ResolveOutputPath err=%v skip=%v", err, skip)
	}
	want := filepath.Join(outRoot, "A", "一", "二", "clip.mp4")
	if out != want {
		t.Fatalf("output=%q, want %q", out, want)
	}
}

func TestPreserveOutputTreeTimesDeepestFirst(t *testing.T) {
	parent := t.TempDir()
	selected := filepath.Join(parent, "A")
	sourceLeaf := filepath.Join(selected, "sub", "leaf")
	if err := os.MkdirAll(sourceLeaf, 0o755); err != nil {
		t.Fatal(err)
	}
	input := filepath.Join(sourceLeaf, "clip.mov")
	if err := os.WriteFile(input, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	outRoot := filepath.Join(t.TempDir(), "out")
	outputLeaf := filepath.Join(outRoot, "A", "sub", "leaf")
	if err := os.MkdirAll(outputLeaf, 0o755); err != nil {
		t.Fatal(err)
	}
	base := time.Date(2019, 2, 3, 4, 5, 6, 0, time.Local)
	for i, dir := range []string{selected, filepath.Join(selected, "sub"), sourceLeaf} {
		stamp := base.Add(time.Duration(i) * time.Hour)
		if err := os.Chtimes(dir, stamp, stamp); err != nil {
			t.Fatal(err)
		}
	}
	if err := PreserveOutputTreeTimes(input, parent, outRoot); err != nil {
		t.Fatal(err)
	}
	for i, rel := range []string{"A", filepath.Join("A", "sub"), filepath.Join("A", "sub", "leaf")} {
		srcInfo, err := os.Stat(filepath.Join(parent, rel))
		if err != nil {
			t.Fatal(err)
		}
		dstInfo, err := os.Stat(filepath.Join(outRoot, rel))
		if err != nil {
			t.Fatal(err)
		}
		if delta := srcInfo.ModTime().Sub(dstInfo.ModTime()); delta > time.Second || delta < -time.Second {
			t.Fatalf("dir %d %s timestamp mismatch: src=%v dst=%v", i, rel, srcInfo.ModTime(), dstInfo.ModTime())
		}
	}
}

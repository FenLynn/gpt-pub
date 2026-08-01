package media

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"mediaworkbench/internal/model"
)

func TestListMixedFilesAndMirrorOutput(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "2026", "旅行")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	video := filepath.Join(nested, "A.MOV")
	image := filepath.Join(nested, "B.JPG")
	other := filepath.Join(nested, "readme.txt")
	for _, p := range []string{video, image, other} {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	result, err := ListMixedFiles(root, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Videos) != 1 || len(result.Images) != 1 || result.Unsupported != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	outRoot := filepath.Join(t.TempDir(), "output")
	settings := model.DefaultSettings()
	settings.ConflictPolicy = "自动编号"
	path, skip, err := ResolveOutputPath(video, root, outRoot, model.KindVideo, settings.EffectiveOptions(&model.Task{Kind: model.KindVideo}), settings)
	if err != nil || skip {
		t.Fatalf("resolve: %v skip=%v", err, skip)
	}
	wantDir := filepath.Join(outRoot, "2026", "旅行")
	if filepath.Dir(path) != wantDir {
		t.Fatalf("mirror dir=%q want=%q", filepath.Dir(path), wantDir)
	}
}

func TestPreserveModificationTime(t *testing.T) {
	dir := t.TempDir()
	src, dst := filepath.Join(dir, "src.jpg"), filepath.Join(dir, "dst.jpg")
	if err := os.WriteFile(src, []byte("source"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dst, []byte("dest"), 0o644); err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2020, 5, 6, 7, 8, 9, 0, time.Local)
	if err := os.Chtimes(src, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	if err := PreserveTimes(src, dst); err != nil {
		t.Fatal(err)
	}
	got, err := os.Stat(dst)
	if err != nil {
		t.Fatal(err)
	}
	if got.ModTime().Sub(stamp) > time.Second || stamp.Sub(got.ModTime()) > time.Second {
		t.Fatalf("mtime=%v want=%v", got.ModTime(), stamp)
	}
}

func TestPreferGPUUsesMeasuredMargin(t *testing.T) {
	p := model.BenchmarkProfile{CPUH265X: 2, GPUH265X: 3, CPUH264X: 4, GPUH264X: 4.2}
	if !PreferGPU(p, "H.265") {
		t.Fatal("expected GPU for H.265")
	}
	if PreferGPU(p, "H.264") {
		t.Fatal("small H.264 advantage should stay on CPU")
	}
}

func TestSpeedModePresets(t *testing.T) {
	if cpuPreset("极速") != "veryfast" || cpuPreset("均衡") != "medium" || cpuPreset("高质量") != "slow" {
		t.Fatalf("unexpected CPU presets")
	}
	if gpuPreset("hevc_nvenc", "极速") != "p2" || gpuPreset("hevc_nvenc", "高质量") != "p7" {
		t.Fatalf("unexpected NVENC presets")
	}
}

package media

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"mediaworkbench/internal/model"
)

func TestResolveOutputPathAvoidingConcurrent(t *testing.T) {
	d := t.TempDir()
	s := model.DefaultSettings()
	o := s.EffectiveOptions(nil)
	reserved := map[string]bool{}
	var mu sync.Mutex
	unavailable := func(p string) bool { mu.Lock(); defer mu.Unlock(); return reserved[p] }
	var got []string
	for i := 0; i < 3; i++ {
		p, skip, err := ResolveOutputPathAvoiding(filepath.Join(d, "a.mov"), "", d, model.KindVideo, o, s, unavailable)
		if err != nil || skip {
			t.Fatalf("resolve: %v %v", err, skip)
		}
		mu.Lock()
		reserved[p] = true
		mu.Unlock()
		got = append(got, p)
	}
	if got[0] == got[1] || got[1] == got[2] || got[0] == got[2] {
		t.Fatalf("paths are not unique: %v", got)
	}
}

func TestConcurrentHistoryAppend(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if err := AppendHistory(HistoryRecord{Input: filepath.Join("in", string(rune('A'+i%26))), Result: "转换完成"}); err != nil {
				t.Errorf("append: %v", err)
			}
		}(i)
	}
	wg.Wait()
	if n := len(LoadHistory()); n != 40 {
		t.Fatalf("history records=%d want 40", n)
	}
}

func fakeExifJPEG(orientation uint16) []byte {
	// Minimal JPEG container with a little-endian TIFF IFD containing Orientation.
	tiff := make([]byte, 8+2+12+4)
	copy(tiff[:2], "II")
	binary.LittleEndian.PutUint16(tiff[2:4], 42)
	binary.LittleEndian.PutUint32(tiff[4:8], 8)
	binary.LittleEndian.PutUint16(tiff[8:10], 1)
	binary.LittleEndian.PutUint16(tiff[10:12], 0x0112)
	binary.LittleEndian.PutUint16(tiff[12:14], 3)
	binary.LittleEndian.PutUint32(tiff[14:18], 1)
	binary.LittleEndian.PutUint16(tiff[18:20], orientation)
	payload := append(append([]byte{}, exifHeader...), tiff...)
	seg := []byte{0xff, 0xe1, 0, 0}
	binary.BigEndian.PutUint16(seg[2:4], uint16(len(payload)+2))
	return append(append(append([]byte{0xff, 0xd8}, seg...), payload...), 0xff, 0xd9)
}

func TestCopyJPEGExifNormalizesOrientation(t *testing.T) {
	d := t.TempDir()
	src, dst := filepath.Join(d, "src.jpg"), filepath.Join(d, "dst.jpg")
	if err := os.WriteFile(src, fakeExifJPEG(6), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dst, []byte{0xff, 0xd8, 0xff, 0xd9}, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := CopyJPEGExif(src, dst); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(dst)
	exif, err := extractExifAPP1(b)
	if err != nil || len(exif) == 0 {
		t.Fatalf("exif missing: %v", err)
	}
	tiff := exif[6:]
	if got := binary.LittleEndian.Uint16(tiff[18:20]); got != 1 {
		t.Fatalf("orientation=%d", got)
	}
}

func TestInstallFFmpegZip(t *testing.T) {
	dataRoot := t.TempDir()
	// LocalDir uses LOCALAPPDATA on Windows and UserConfigDir/XDG elsewhere.
	// Isolate both paths so this test can never overwrite a real or subsequent
	// test-run FFmpeg installation with its intentionally tiny fixture files.
	t.Setenv("LOCALAPPDATA", dataRoot)
	t.Setenv("APPDATA", dataRoot)
	t.Setenv("XDG_CONFIG_HOME", dataRoot)
	zpath := filepath.Join(t.TempDir(), "ff.zip")
	f, err := os.Create(zpath)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	for _, name := range []string{"ffmpeg-build/bin/ffmpeg.exe", "ffmpeg-build/bin/ffprobe.exe", "ffmpeg-build/bin/avcodec.dll"} {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte("test"))
	}
	_ = zw.Close()
	_ = f.Close()
	ff, fp, err := InstallFFmpegZip(zpath)
	if err != nil {
		t.Fatal(err)
	}
	if FileSize(ff) == 0 || FileSize(fp) == 0 {
		t.Fatalf("not installed: %s %s", ff, fp)
	}
	cleanRoot := strings.ToLower(filepath.Clean(dataRoot))
	if !strings.HasPrefix(strings.ToLower(filepath.Clean(ff)), cleanRoot) || !strings.HasPrefix(strings.ToLower(filepath.Clean(fp)), cleanRoot) {
		t.Fatalf("test escaped isolated data root: ffmpeg=%s ffprobe=%s root=%s", ff, fp, dataRoot)
	}
}

func TestRunnableVersionBinaryRejectsCorruptFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), executableName("broken-ffmpeg"))
	if err := os.WriteFile(path, []byte("not an executable"), 0o755); err != nil {
		t.Fatal(err)
	}
	if runnableVersionBinary(path) {
		t.Fatal("corrupt FFmpeg candidate must be rejected")
	}
}

func TestImageTargetLimitAndExactVideo(t *testing.T) {
	ff, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip()
	}
	fp, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip()
	}
	d := t.TempDir()
	img := filepath.Join(d, "noise.png")
	cmd := exec.Command(ff, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1600x1000", "-frames:v", "1", img)
	if b, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("image: %v %s", e, b)
	}
	pi, _ := Probe(fp, img)
	s := model.DefaultSettings()
	s.UseGPU = false
	o := s.EffectiveOptions(&model.Task{Kind: model.KindImage})
	o.ImageFormat = "JPG"
	o.ImageSize = "保持原尺寸"
	o.ImageLimit = "约 500KB"
	o.Quality = "高"
	out := filepath.Join(d, "limited.jpg")
	if _, e := Convert(context.Background(), ff, ConvertRequest{Input: img, Output: out, Kind: model.KindImage, Probe: pi, Options: o, Settings: s}, nil); e != nil {
		t.Fatal(e)
	}
	if size := FileSize(out); size <= 0 || size > 500*1024 {
		t.Fatalf("image size=%d", size)
	}

	in := filepath.Join(d, "in.mp4")
	cmd = exec.Command(ff, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-f", "lavfi", "-i", "sine=frequency=500", "-t", "5", "-c:v", "libx264", "-c:a", "aac", in)
	if b, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("video: %v %s", e, b)
	}
	pv, _ := Probe(fp, in)
	vo := s.EffectiveOptions(&model.Task{Kind: model.KindVideo})
	vo.Codec = "H.264"
	vo.Resolution = "480P"
	vo.VolumeMode = "目标体积"
	vo.TargetSizeMB = 1
	vout := filepath.Join(d, "exact.mp4")
	if _, e := Convert(context.Background(), ff, ConvertRequest{Input: in, Output: vout, Kind: model.KindVideo, Probe: pv, Options: vo, Settings: s}, nil); e != nil {
		t.Fatal(e)
	}
	sz := FileSize(vout)
	target := int64(1024 * 1024)
	if diff := float64(sz-target) / float64(target); diff < -.10 || diff > .10 {
		t.Fatalf("exact size=%d deviation=%.1f%%", sz, diff*100)
	}
}

func TestInsertExifKeepsJPEGEnvelope(t *testing.T) {
	out, err := insertExifAPP1([]byte{0xff, 0xd8, 0xff, 0xe0, 0, 4, 'J', 'F', 0xff, 0xd9}, append(exifHeader, bytes.Repeat([]byte{1}, 10)...))
	if err != nil {
		t.Fatal(err)
	}
	if len(out) < 10 || out[0] != 0xff || out[1] != 0xd8 || out[len(out)-2] != 0xff || out[len(out)-1] != 0xd9 {
		t.Fatalf("bad jpeg %x", out)
	}
}

func TestResolveAndReserveOutputConcurrentSameBasename(t *testing.T) {
	const workers = 8
	d := t.TempDir()
	outDir := filepath.Join(d, "out")
	s := model.DefaultSettings()
	s.ConflictPolicy = "自动编号"
	o := s.EffectiveOptions(nil)

	var mu sync.Mutex
	reserved := map[string]bool{}
	baseCandidate := strings.ToLower(filepath.Clean(filepath.Join(outDir, "same.mp4")))
	firstWave := 0
	firstWaveDone := make(chan struct{})

	unavailable := func(path string) bool {
		mu.Lock()
		defer mu.Unlock()
		return reserved[strings.ToLower(filepath.Clean(path))]
	}
	reserve := func(path string) bool {
		key := strings.ToLower(filepath.Clean(path))
		if key == baseCandidate {
			mu.Lock()
			firstWave++
			if firstWave == workers {
				reserved[key] = true
				close(firstWaveDone)
				mu.Unlock()
				return true
			}
			mu.Unlock()
			<-firstWaveDone
			return false
		}
		mu.Lock()
		defer mu.Unlock()
		if reserved[key] {
			return false
		}
		reserved[key] = true
		return true
	}

	start := make(chan struct{})
	results := make(chan string, workers)
	errs := make(chan error, workers)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			input := filepath.Join(d, fmt.Sprintf("source-%d", i), "same.mov")
			path, skip, err := ResolveAndReserveOutput(input, "", outDir, model.KindVideo, o, s, unavailable, reserve)
			if err != nil {
				errs <- err
				return
			}
			if skip {
				errs <- fmt.Errorf("worker %d unexpectedly skipped", i)
				return
			}
			results <- path
		}(i)
	}
	close(start)
	wg.Wait()
	close(results)
	close(errs)

	for err := range errs {
		t.Fatal(err)
	}
	unique := map[string]bool{}
	for path := range results {
		key := strings.ToLower(filepath.Clean(path))
		if unique[key] {
			t.Fatalf("duplicate reserved output: %s", path)
		}
		unique[key] = true
	}
	if len(unique) != workers {
		t.Fatalf("unique outputs=%d want %d: %v", len(unique), workers, unique)
	}
}

func TestResolveAndReserveOutputSkipPolicy(t *testing.T) {
	d := t.TempDir()
	s := model.DefaultSettings()
	s.ConflictPolicy = "跳过已有"
	o := s.EffectiveOptions(nil)
	candidate := filepath.Join(d, "same.mp4")
	reserved := map[string]bool{strings.ToLower(filepath.Clean(candidate)): true}
	unavailable := func(path string) bool { return reserved[strings.ToLower(filepath.Clean(path))] }
	reserveCalled := false
	path, skip, err := ResolveAndReserveOutput(filepath.Join(d, "same.mov"), "", d, model.KindVideo, o, s, unavailable, func(string) bool {
		reserveCalled = true
		return true
	})
	if err != nil || !skip || filepath.Clean(path) != filepath.Clean(candidate) {
		t.Fatalf("path=%q skip=%v err=%v", path, skip, err)
	}
	if reserveCalled {
		t.Fatal("skip policy must not reserve an existing path")
	}
}

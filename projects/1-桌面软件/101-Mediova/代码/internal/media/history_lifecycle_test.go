package media

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/model"
)

func TestTrimHistoryKeepsOneThousandPerMediaKind(t *testing.T) {
	items := make([]HistoryRecord, 0, HistoryLimitPerKind*2+2)
	for i := 0; i < HistoryLimitPerKind+1; i++ {
		items = append(items, HistoryRecord{ID: "v" + string(rune(0x1000+i)), Kind: model.KindVideo, Status: model.StatusDone})
	}
	for i := 0; i < HistoryLimitPerKind+1; i++ {
		items = append(items, HistoryRecord{ID: "i" + string(rune(0x2000+i)), Kind: model.KindImage, Status: model.StatusDone})
	}
	kept, removed := trimHistory(items)
	if len(kept) != HistoryLimitPerKind*2 || len(removed) != 2 {
		t.Fatalf("kept=%d removed=%d", len(kept), len(removed))
	}
	if kept[0].Kind != model.KindVideo || kept[HistoryLimitPerKind].Kind != model.KindImage {
		t.Fatalf("kind partition not preserved: %#v %#v", kept[0].Kind, kept[HistoryLimitPerKind].Kind)
	}
}

func TestClearHistoryKindDeletesOnlyMatchingHistoryThumbnails(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", root)
	t.Setenv("APPDATA", root)
	t.Setenv("LOCALAPPDATA", root)
	video := HistoryRecord{ID: "video-thumb", Kind: model.KindVideo, Status: model.StatusDone, CompletedAt: time.Now(), Thumbnail: historyThumbnailRelative("video-thumb")}
	image := HistoryRecord{ID: "image-thumb", Kind: model.KindImage, Status: model.StatusDone, CompletedAt: time.Now(), Thumbnail: historyThumbnailRelative("image-thumb")}
	if err := AppendHistory(video); err != nil {
		t.Fatal(err)
	}
	if err := AppendHistory(image); err != nil {
		t.Fatal(err)
	}
	for _, record := range []HistoryRecord{video, image} {
		path, err := historyThumbnailPath(record.ID)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("thumbnail"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	count, err := ClearHistoryKind(model.KindVideo)
	if err != nil || count != 1 {
		t.Fatalf("clear count=%d err=%v", count, err)
	}
	videoPath, _ := historyThumbnailPath(video.ID)
	imagePath, _ := historyThumbnailPath(image.ID)
	if _, err := os.Stat(videoPath); !os.IsNotExist(err) {
		t.Fatalf("video thumbnail remains: %v", err)
	}
	if _, err := os.Stat(imagePath); err != nil {
		t.Fatalf("image thumbnail removed: %v", err)
	}
	if records := LoadHistory(); len(records) != 1 || records[0].Kind != model.KindImage {
		t.Fatalf("history after clear=%+v", records)
	}
	if _, err := os.Stat(filepath.Dir(imagePath)); err != nil {
		t.Fatalf("history thumbnail directory disappeared: %v", err)
	}
}

func TestHistoryVolumeClassBoundaries(t *testing.T) {
	cases := []struct {
		input, output int64
		want          string
	}{
		{100, 110, "larger"},
		{100, 90, "smaller"},
		{100, 100, "unchanged"},
		{100, 0, "unknown"},
	}
	for _, tc := range cases {
		record := HistoryRecord{InputSize: tc.input, OutputSize: tc.output}
		if got := historyVolumeClass(record); got != tc.want {
			t.Fatalf("historyVolumeClass(%d,%d)=%q want %q", tc.input, tc.output, got, tc.want)
		}
	}
}

func TestHistoryBurstIsCoalescedAndFlushable(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", root)
	t.Setenv("APPDATA", root)
	t.Setenv("LOCALAPPDATA", root)
	for i := 0; i < 20; i++ {
		if err := AppendHistory(HistoryRecord{ID: fmt.Sprintf("burst-%02d", i), Kind: model.KindImage, Status: model.StatusDone, CompletedAt: time.Now()}); err != nil {
			t.Fatal(err)
		}
	}
	historyMu.Lock()
	dirty := historyDirtyChanges
	historyMu.Unlock()
	if dirty != 20 {
		t.Fatalf("dirty changes=%d want 20 before explicit flush", dirty)
	}
	if err := FlushHistory(); err != nil {
		t.Fatal(err)
	}
	path, err := config.HistoryPath()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var records []HistoryRecord
	if err := json.Unmarshal(data, &records); err != nil {
		t.Fatal(err)
	}
	if len(records) != 20 {
		t.Fatalf("persisted records=%d want 20", len(records))
	}
}

func TestHistoryHTMLIncludesSeparatePreciseStatusAndColumns(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", root)
	t.Setenv("APPDATA", root)
	t.Setenv("LOCALAPPDATA", root)
	if err := AppendHistory(HistoryRecord{ID: "failed-video", Kind: model.KindVideo, Status: model.StatusFailed, CompletedAt: time.Now(), Result: "转换失败", FailureCategory: "输入媒体", Error: "broken source"}); err != nil {
		t.Fatal(err)
	}
	path, err := WriteHistoryHTML()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"视频历史", "图片历史", "option value=\"failed\"", "选择列", "ratio-bar", "失败分类", "row-failed", ".c-'+name"} {
		if !strings.Contains(string(data), want) {
			t.Fatalf("history html missing %q", want)
		}
	}
}

func TestHistoryHTMLIncludesIndependentVolumeFilter(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", root)
	t.Setenv("APPDATA", root)
	t.Setenv("LOCALAPPDATA", root)
	if err := AppendHistory(HistoryRecord{ID: "large-video", Kind: model.KindVideo, Status: model.StatusDone, CompletedAt: time.Now(), InputSize: 100, OutputSize: 120}); err != nil {
		t.Fatal(err)
	}
	path, err := WriteHistoryHTML()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`volumeSelect.id='volume'`, `data-volume="larger"`, `wantVolume`, "体积增加"} {
		if !strings.Contains(string(data), want) {
			t.Fatalf("history html missing %q", want)
		}
	}
}

func TestFailureCenterContainsOnlyFailuresAndOverwritesOneReport(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", root)
	t.Setenv("APPDATA", root)
	t.Setenv("LOCALAPPDATA", root)
	if err := AppendHistory(HistoryRecord{ID: "failure-centre-bad", Kind: model.KindImage, Status: model.StatusFailed, CompletedAt: time.Now(), Input: `C:\in\bad.heic`, FailureCategory: "输入编码不受支持", Error: "decoder failed"}); err != nil {
		t.Fatal(err)
	}
	if err := AppendHistory(HistoryRecord{ID: "failure-centre-good", Kind: model.KindVideo, Status: model.StatusDone, CompletedAt: time.Now(), Input: `C:\in\good.mp4`}); err != nil {
		t.Fatal(err)
	}
	path, count, err := WriteFailureCenterHTML()
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 || filepath.Base(path) != "failure-center.html" {
		t.Fatalf("path=%q count=%d", path, count)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if !strings.Contains(text, "bad.heic") || !strings.Contains(text, "decoder failed") || strings.Contains(text, "good.mp4") {
		t.Fatalf("unexpected failure report: %s", text)
	}
}

func TestStoreHistoryThumbnailFollowsRecordLifecycle(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg unavailable")
	}
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", root)
	t.Setenv("APPDATA", root)
	t.Setenv("LOCALAPPDATA", root)
	input := filepath.Join(t.TempDir(), "sample.jpg")
	if output, err := exec.Command(ffmpeg, "-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=#2d78d5:s=320x180", "-frames:v", "1", input).CombinedOutput(); err != nil {
		t.Fatalf("create fixture: %v %s", err, output)
	}
	record := HistoryRecord{ID: "managed-thumb", Kind: model.KindImage, Status: model.StatusDone, CompletedAt: time.Now(), Input: input, Output: input}
	if err := AppendHistory(record); err != nil {
		t.Fatal(err)
	}
	relative, err := StoreHistoryThumbnail(context.Background(), ffmpeg, input, input, record.ID, "自动", 0)
	if err != nil {
		t.Fatal(err)
	}
	if relative == "" {
		t.Fatal("history thumbnail was not created")
	}
	if err := AttachHistoryThumbnail(record.ID, relative); err != nil {
		t.Fatal(err)
	}
	path, err := historyThumbnailPath(record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(path); err != nil || info.Size() <= 128 {
		t.Fatalf("thumbnail invalid: info=%+v err=%v", info, err)
	}
	if err := CleanupHistoryThumbnails(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("referenced thumbnail was cleaned: %v", err)
	}
	if _, err := ClearHistoryKind(model.KindImage); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("cleared history thumbnail remains: %v", err)
	}
}

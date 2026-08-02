package media

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mediaworkbench/internal/model"
)

func TestExportTasksCSV(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tasks.csv")
	tasks := []model.Task{{Input: `C:\Media\a.mp4`, Kind: model.KindVideo, Width: 1920, Height: 1080, InputSize: 1000, OutputSize: 400, OutputPath: `D:\Out\a.mp4`, Status: model.StatusDone, Progress: 100, Engine: "CPU", Options: model.TaskOptions{FollowDefaults: true}}}
	if err := ExportTasksCSV(path, tasks, model.DefaultSettings()); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(b, []byte{0xEF, 0xBB, 0xBF}) {
		t.Fatal("CSV BOM missing")
	}
	text := string(b[3:])
	for _, want := range []string{"源路径", "a.mp4", "40.0%", "完成", "CPU"} {
		if !strings.Contains(text, want) {
			t.Fatalf("CSV missing %q: %s", want, text)
		}
	}
}

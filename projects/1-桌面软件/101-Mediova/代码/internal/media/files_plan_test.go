package media

import (
	"os"
	"path/filepath"
	"testing"

	"mediaworkbench/internal/model"
)

func TestPlanOutputPathDoesNotCreateDirectories(t *testing.T) {
	root := t.TempDir()
	sourceDir := filepath.Join(root, "source")
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	input := filepath.Join(sourceDir, "clip.mov")
	if err := os.WriteFile(input, []byte("media"), 0o644); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(root, "output")
	settings := model.DefaultSettings()
	settings.ConflictPolicy = "自动编号"
	opts := settings.DefaultOptions(model.KindVideo)
	planned, skip, err := PlanOutputPath(input, "", output, model.KindVideo, opts, settings)
	if err != nil || skip {
		t.Fatalf("unexpected plan: path=%q skip=%v err=%v", planned, skip, err)
	}
	if _, statErr := os.Stat(output); !os.IsNotExist(statErr) {
		t.Fatalf("planning created output directory: %v", statErr)
	}
	if filepath.Ext(planned) != ".mp4" {
		t.Fatalf("unexpected output extension: %s", planned)
	}
}

func TestPlanOutputPathConflictActions(t *testing.T) {
	root := t.TempDir()
	input := filepath.Join(root, "clip.mov")
	if err := os.WriteFile(input, []byte("media"), 0o644); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(root, "out")
	if err := os.MkdirAll(output, 0o755); err != nil {
		t.Fatal(err)
	}
	settings := model.DefaultSettings()
	opts := settings.DefaultOptions(model.KindVideo)
	base := filepath.Join(output, "clip.mp4")
	if err := os.WriteFile(base, []byte("existing"), 0o644); err != nil {
		t.Fatal(err)
	}
	settings.ConflictPolicy = "跳过已有"
	planned, skip, err := PlanOutputPath(input, "", output, model.KindVideo, opts, settings)
	if err != nil || !skip || planned != base {
		t.Fatalf("skip plan mismatch: %q %v %v", planned, skip, err)
	}
	settings.ConflictPolicy = "自动编号"
	planned, skip, err = PlanOutputPath(input, "", output, model.KindVideo, opts, settings)
	if err != nil || skip || planned != filepath.Join(output, "clip_1.mp4") {
		t.Fatalf("number plan mismatch: %q %v %v", planned, skip, err)
	}
}

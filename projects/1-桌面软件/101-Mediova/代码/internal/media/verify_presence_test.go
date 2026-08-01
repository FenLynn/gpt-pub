package media

import (
	"os"
	"path/filepath"
	"testing"
)

func TestValidateOutputPresence(t *testing.T) {
	dir := t.TempDir()
	if err := ValidateOutputPresence(filepath.Join(dir, "missing.mp4")); err == nil {
		t.Fatal("missing output must fail")
	}
	if err := ValidateOutputPresence(dir); err == nil {
		t.Fatal("directory must not be accepted as output")
	}
	tiny := filepath.Join(dir, "tiny.mp4")
	if err := os.WriteFile(tiny, make([]byte, 64), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ValidateOutputPresence(tiny); err == nil {
		t.Fatal("tiny output must fail")
	}
	valid := filepath.Join(dir, "valid.mp4")
	if err := os.WriteFile(valid, make([]byte, 65), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ValidateOutputPresence(valid); err != nil {
		t.Fatalf("valid output rejected: %v", err)
	}
}

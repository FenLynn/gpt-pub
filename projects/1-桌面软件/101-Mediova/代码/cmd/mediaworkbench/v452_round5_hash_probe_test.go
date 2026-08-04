package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestV452Round5HashProbe(t *testing.T) {
	files := []struct {
		path string
		name string
	}{
		{filepath.Join("..", "..", "V452_ROUND4_TRIM_EDITOR_FILES_SHA256.txt"), "V452_ROUND4_TRIM_EDITOR_FILES_SHA256.txt"},
		{"v452_crop_sync_guard_windows.go", "cmd/mediaworkbench/v452_crop_sync_guard_windows.go"},
		{"v452_round5_closeout_windows.go", "cmd/mediaworkbench/v452_round5_closeout_windows.go"},
		{"v452_round5_compat_windows.go", "cmd/mediaworkbench/v452_round5_compat_windows.go"},
		{"v452_round5_report_finalize_windows.go", "cmd/mediaworkbench/v452_round5_report_finalize_windows.go"},
		{"v452_round5_source_test.go", "cmd/mediaworkbench/v452_round5_source_test.go"},
	}
	fmt.Println("V452_ROUND5_HASH_PROBE_BEGIN")
	for _, file := range files {
		data, err := os.ReadFile(file.path)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(data)
		fmt.Printf("%s  %s\n", hex.EncodeToString(sum[:]), file.name)
	}
	fmt.Println("V452_ROUND5_HASH_PROBE_END")
	t.Fatal("temporary hash probe: remove after recording digests")
}

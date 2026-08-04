package main

import (
	"crypto/sha256"
	"fmt"
	"os"
	"testing"
)

func TestRound7FreezeHashProbe(t *testing.T) {
	files := []struct {
		path string
		name string
	}{
		{"../../build_v4.5.2.ps1", "build_v4.5.2.ps1"},
		{"v452_round7_constants_windows.go", "cmd/mediaworkbench/v452_round7_constants_windows.go"},
		{"v452_round7_editor_layout_windows.go", "cmd/mediaworkbench/v452_round7_editor_layout_windows.go"},
		{"v452_round7_editor_windows.go", "cmd/mediaworkbench/v452_round7_editor_windows.go"},
		{"v452_round7_list_overlay_windows.go", "cmd/mediaworkbench/v452_round7_list_overlay_windows.go"},
		{"v452_round7_logic.go", "cmd/mediaworkbench/v452_round7_logic.go"},
		{"v452_round7_logic_test.go", "cmd/mediaworkbench/v452_round7_logic_test.go"},
		{"v452_round7_main_windows.go", "cmd/mediaworkbench/v452_round7_main_windows.go"},
		{"v452_round7_native_closeout_windows.go", "cmd/mediaworkbench/v452_round7_native_closeout_windows.go"},
		{"v452_round7_source_test.go", "cmd/mediaworkbench/v452_round7_source_test.go"},
	}
	fmt.Println("ROUND7_FREEZE_HASHES_BEGIN")
	for _, file := range files {
		data, err := os.ReadFile(file.path)
		if err != nil {
			t.Fatalf("read %s: %v", file.path, err)
		}
		fmt.Printf("%x  %s\n", sha256.Sum256(data), file.name)
	}
	fmt.Println("ROUND7_FREEZE_HASHES_END")
	t.Fatal("intentional round7 freeze hash probe")
}

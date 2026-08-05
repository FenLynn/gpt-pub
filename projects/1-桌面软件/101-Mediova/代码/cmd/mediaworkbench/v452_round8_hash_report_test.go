package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"testing"
)

func TestRound8HashReport(t *testing.T) {
	files := []string{
		"v452_round7_main_windows.go",
		"v452_round7_editor_layout_windows.go",
		"v452_round7_list_overlay_windows.go",
		"v452_round7_feedback_logic.go",
		"v452_round7_feedback_logic_test.go",
		"v452_round7_feedback_columns_windows.go",
		"v452_round7_feedback_common_windows.go",
		"v452_round7_feedback_scroll_windows.go",
		"v452_round7_feedback_visual_windows.go",
		"v452_round7_feedback_editor_windows.go",
		"v452_round7_feedback_timeline_windows.go",
		"v452_round7_native_closeout_windows.go",
		"v452_round7_source_test.go",
		"v452_round7_feedback_source_test.go",
		"v452_round7_manifest_test.go",
		"v452_round7_feedback_manifest_test.go",
		"v452_round8_tooltip_windows.go",
		"v452_round8_editor_install_windows.go",
		"v452_round8_list_style_guard_windows.go",
	}
	for _, name := range files {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(data)
		t.Logf("ROUND8_HASH %s  %s", hex.EncodeToString(sum[:]), name)
	}
	t.Fatal("ROUND8_HASH_REPORT_COMPLETE")
}

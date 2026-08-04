package main

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestV452Round4HashProbe(t *testing.T) {
	paths := []string{
		"cmd/mediaworkbench/v452_trim_constants_windows.go",
		"cmd/mediaworkbench/v452_trim_editor_windows.go",
		"cmd/mediaworkbench/v452_trim_hook_windows.go",
		"internal/media/crop_interaction.go",
		"internal/media/crop_interaction_test.go",
		"internal/media/trim_filter_order_test.go",
		"internal/media/trim_range.go",
		"internal/media/trim_range_test.go",
	}
	for _, rel := range paths {
		data, err := os.ReadFile(filepath.Join("..", "..", filepath.FromSlash(rel)))
		if err != nil {
			t.Fatal(err)
		}
		fmt.Printf("V452R4 %x  %s\n", sha256.Sum256(data), rel)
	}
	t.Fatal("round4 hash probe complete")
}

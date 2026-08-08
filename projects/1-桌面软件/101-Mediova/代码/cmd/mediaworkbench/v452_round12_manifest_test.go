package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRound12ListStructureManifest(t *testing.T) {
	root := filepath.Clean(filepath.Join("..", ".."))
	file, err := os.Open(filepath.Join(root, "V452_ROUND12_LIST_STRUCTURE_FILES_SHA256.txt"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	entries := 0
	seen := map[string]bool{}
	for scanner.Scan() {
		parts := strings.Fields(scanner.Text())
		if len(parts) != 2 || len(parts[0]) != 64 {
			t.Fatalf("invalid manifest row %q", scanner.Text())
		}
		data, readErr := os.ReadFile(filepath.Join(root, filepath.FromSlash(parts[1])))
		if readErr != nil {
			t.Fatal(readErr)
		}
		data = bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n"))
		sum := sha256.Sum256(data)
		if got := hex.EncodeToString(sum[:]); got != parts[0] {
			t.Fatalf("%s sha256=%s want=%s", parts[1], got, parts[0])
		}
		seen[parts[1]] = true
		entries++
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if entries != 29 {
		t.Fatalf("entries=%d want=29", entries)
	}
	for _, path := range []string{
		"cmd/mediaworkbench/v452_round7_feedback_columns_windows.go",
		"cmd/mediaworkbench/v452_round9_thumbnail_lifecycle_windows.go",
		"cmd/mediaworkbench/v452_round12_selection_owner_windows.go",
		"cmd/mediaworkbench/v452_round12_activation_bridge_windows.go",
		"cmd/mediaworkbench/v452_round12_list_draw_windows.go",
		"cmd/mediaworkbench/v452_round12_list_geometry_windows.go",
		"cmd/mediaworkbench/v452_round12_trim_preview_guard_windows.go",
		"cmd/mediaworkbench/v452_round12_column_profiles_windows.go",
		"cmd/mediaworkbench/v452_round12_preview_windows.go",
		"cmd/mediaworkbench/v452_round12_thumbnail_fallback_windows.go",
		"cmd/mediaworkbench/v452_thumbnail_lifecycle_windows.go",
		"scripts/round12_list_structure_gate.py",
		"scripts/round12_real_thumbnail_gate.py",
		"scripts/round12_trim_preview_gate.py",
		"scripts/round12_remote_memory.py",
		"scripts/round12_remote_header.py",
		"scripts/round12_list_gate_helpers.py",
		"scripts/round12_list_gate_visual.py",
	} {
		if !seen[path] {
			t.Fatalf("missing %s", path)
		}
	}
}

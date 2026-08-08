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

func round12ManifestSHA(t *testing.T, root, path string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(path)))
	if err != nil {
		t.Errorf("read %s: %v", path, err)
		return ""
	}
	data = bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n"))
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

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
			t.Errorf("invalid manifest row %q", scanner.Text())
			continue
		}
		got := round12ManifestSHA(t, root, parts[1])
		if got != "" && got != parts[0] {
			t.Errorf("%s sha256=%s want=%s", parts[1], got, parts[0])
		}
		seen[parts[1]] = true
		entries++
	}
	if err := scanner.Err(); err != nil {
		t.Error(err)
	}

	// One-run calibration only: print all changed/new Round12 topic files so the
	// strict receipt can be updated atomically instead of burning one CI per hash.
	for _, path := range []string{
		"cmd/mediaworkbench/v452_round12_selection_owner_windows.go",
		"cmd/mediaworkbench/v452_round12_list_draw_windows.go",
		"cmd/mediaworkbench/v452_round12_list_geometry_windows.go",
		"cmd/mediaworkbench/v452_round12_trim_preview_guard_windows.go",
		"scripts/round11_flicker_gate_runner.py",
		"scripts/round12_header_gate.py",
		"scripts/round12_list_structure_gate.py",
		"scripts/round12_list_gate_visual.py",
		"scripts/round12_trim_preview_gate.py",
	} {
		t.Logf("ROUND12_CALIBRATE %s %s", round12ManifestSHA(t, root, path), path)
	}
	if entries != 26 {
		t.Errorf("entries=%d want=26 during calibration", entries)
	}
}

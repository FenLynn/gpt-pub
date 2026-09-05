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

const v452Round11ManifestSHA256 = "8b1b19c35941d25cf9596a7630b668d43baeebb79e373aa84b6cf22c70853b3b"

var v452Round11Superseded = map[string]bool{
	"cmd/mediaworkbench/v452_list_visual_windows.go":                    true,
	"cmd/mediaworkbench/v452_round10_scroll_cover_windows.go":           true,
	"cmd/mediaworkbench/v452_round11_flicker_closeout_windows.go":       true,
	"cmd/mediaworkbench/v452_round11_install_order_windows.go":          true,
	"cmd/mediaworkbench/v452_round11_legacy_overlay_retire_windows.go":  true,
	"cmd/mediaworkbench/v452_round11_scroll_preview_windows.go":         true,
	"cmd/mediaworkbench/v452_round11_stable_scroll_surfaces_windows.go": true,
	"scripts/round11_flicker_gate_runner_base.py":                       true,
}

func TestRound11FlickerRootFixManifest(t *testing.T) {
	const manifestName = "V452_ROUND11_FLICKER_ROOT_FIX_FILES_SHA256.txt"
	root := filepath.Clean(filepath.Join("..", ".."))
	manifestPath := filepath.Join(root, manifestName)
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read %s: %v", manifestName, err)
	}
	manifestData = bytes.ReplaceAll(manifestData, []byte("\r\n"), []byte("\n"))
	manifestSum := sha256.Sum256(manifestData)
	if actual := hex.EncodeToString(manifestSum[:]); actual != v452Round11ManifestSHA256 {
		t.Fatalf("manifest sha256=%s want=%s", actual, v452Round11ManifestSHA256)
	}

	scanner := bufio.NewScanner(bytes.NewReader(manifestData))
	entries := 0
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) != 2 {
			t.Errorf("invalid manifest line: %q", line)
			continue
		}
		entries++
		if v452Round11Superseded[parts[1]] {
			continue
		}
		expected, relative := strings.ToLower(parts[0]), filepath.FromSlash(parts[1])
		data, readErr := os.ReadFile(filepath.Join(root, relative))
		if readErr != nil {
			t.Errorf("read %s: %v", parts[1], readErr)
			continue
		}
		// Git may materialize text files as CRLF on Windows. The manifest
		// freezes repository-normalized LF content so both CI platforms verify
		// the same source bytes rather than checkout-policy side effects.
		data = bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n"))
		sum := sha256.Sum256(data)
		actual := hex.EncodeToString(sum[:])
		if actual != expected {
			t.Errorf("ROUND11_SHA256  %s  %s", actual, parts[1])
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scan %s: %v", manifestName, err)
	}
	if entries != 11 {
		t.Fatalf("manifest entry count=%d, want=11", entries)
	}
}

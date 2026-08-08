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

const v452Round9InteractionManifestSHA256 = "9d8a397a6da3db6ffe838eae934962df663597da209a048b7955108acd2b0513"

var v452Round9SupersededByRound11 = map[string]bool{
	"cmd/mediaworkbench/v452_round8_editor_install_windows.go": true,
	"cmd/mediaworkbench/v452_round9_source_test.go":             true,
	"cmd/mediaworkbench/v452_round10_scroll_cover_windows.go":  true,
	// Round 12 clips the inherited list overlay to the real data viewport so
	// preview cells can never paint over Header captions. The round-9 digest
	// remains a historical receipt; the active file is frozen by round 12.
	"cmd/mediaworkbench/v452_round7_list_overlay_windows.go": true,
}

func TestV452Round9InteractionManifest(t *testing.T) {
	manifest := filepath.Join("..", "..", "V452_ROUND9_REAL_INTERACTION_CLOSEOUT_FILES_SHA256.txt")
	data, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != v452Round9InteractionManifestSHA256 {
		t.Fatalf("round9 manifest receipt sha256=%s want=%s", got, v452Round9InteractionManifestSHA256)
	}
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	entries := 0
	superseded := 0
	for scanner.Scan() {
		parts := strings.Fields(scanner.Text())
		if len(parts) != 2 || len(parts[0]) != 64 {
			t.Fatalf("invalid round9 manifest row %q", scanner.Text())
		}
		fileData, err := os.ReadFile(filepath.Join("..", "..", parts[1]))
		if err != nil {
			t.Fatalf("read %s: %v", parts[1], err)
		}
		fileData = bytes.ReplaceAll(fileData, []byte("\r\n"), []byte("\n"))
		fileSum := sha256.Sum256(fileData)
		got := hex.EncodeToString(fileSum[:])
		if got != parts[0] {
			if !v452Round9SupersededByRound11[parts[1]] {
				t.Fatalf("%s sha256=%s want=%s", parts[1], got, parts[0])
			}
			superseded++
		}
		entries++
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if entries != 16 {
		t.Fatalf("round9 manifest entries=%d want=16", entries)
	}
	if superseded != len(v452Round9SupersededByRound11) {
		t.Fatalf("round9 superseded entries=%d want=%d", superseded, len(v452Round9SupersededByRound11))
	}
}
